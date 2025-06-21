import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { z } from 'zod';
import { isEqual, sum } from 'lodash';
import { zodResponseFormat } from 'openai/helpers/zod';

dotenv.config();

// Zod schema for LLM response
const responseSchema = z.object({
  org_clean: z.string(),
  country_clean: z.string(),
  type_clean: z.enum([
    'academic',
    'government',
    'industry',
    'other',
  ]),
  flag_for_review: z.boolean(),
  reason_for_concern: z.string(),
});
type CleanedEntry = z.infer<typeof responseSchema>;

type InputEntry = {
  org: string;
  "org type": 'academic' | 'government' | 'industry' | 'other';
  country: string;
};

// final entry has input columns additionally:
type FinalEntry = InputEntry & CleanedEntry;

// Static system prompt (instructions + examples)
const STATIC_PROMPT = `You are a data-cleaning assistant helping standardize institution names in the domain of public health, biomedical research, and human disease. The data comes from users of VEuPathDB, ClinEpiDB, MicrobiomeDB, and OrthoMCL.org.

The institution name, provided as the 'org' field below, may refer to a university, research institute, hospital, government public health body, major pharmaceutical/biotech company or start-up. It may be in a local script or language, and may contain typos, inconsistent casing, abbreviations, acronyms and unnecessary details. In some cases it is even randomly typed junk.

Your task is to return a cleaned, canonical representation ('org_clean') of the institution name as it would appear in English-language publications. If applicable, include in parentheses the major named or semi-autonomous school, faculty, division, or branded research institute. Ordinary departments, research labs, or internal units without public-facing identity should be discarded. For example, the cleaned version of "Penn Vet" would be "University of Pennsylvania (School of Veterinary Medicine)", while "Dept. of Mathematics, Oxford University" would be cleaned to "University of Oxford".

If an institution's name is not unique internationally, append a comma and the country name, as follows: "China Medical University, China" or "China Medical University, Taiwan".

You will also be given an institution type ('org type') and country code ('country'). If either of these appear to be incorrect for the institution, you may correct them in your response ('type_clean' and 'country_clean'). If in doubt, leave as-is but set flag_for_review: true.

Return structured JSON in the following format:

{
  org_clean: "Canonical institution name",
  country_clean: "Two-letter country code",
  type_clean: "academic | government | industry | other",
  flag_for_review: boolean,
  reason_for_concern: "Short explanation of why this is flagged for review"
}

Set 'flag_for_review' to 'true' and provide a 'reason_for_concern' if:
- The input is ambiguous or generic (e.g., "CDC", "Columbia")
- The user appears to have declared multiple affiliations
- Multiple plausible matches exist
- The country code or institution type cannot be fixed unambiguously
- The input is incomplete, corrupted, or unusually short
- You are unsure about any part of the canonical mapping`;

// Utility: generate a unique key for mapping from a row object
function generateKey(row: InputEntry): string {
  return `${row.org}|${row['org type']}|${row.country}`;
}

async function main() {
  const [,, inputXlsxFilename, outputXlsxFilename] = process.argv;
  if (!inputXlsxFilename || !outputXlsxFilename) {
    console.error('Usage: ts-node src/org_name_cleaner.ts <input.xlsx> <output.xlsx>');
    // you can also compile with `yarn tsc` and run with
    // node dist/org_name_cleaner.js ...
    process.exit(1);
  }

  // Read input
  const workbook = XLSX.readFile(inputXlsxFilename);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: InputEntry[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  // Pre-calculate key occurrence counts for sorting
  const countMap = new Map<string, number>();
  for (const row of rows) {
    const key = generateKey(row);
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }

  // Sort rows by descending frequency of occurrence
  rows.sort((a, b) => {
    const keyA = generateKey(a);
    const keyB = generateKey(b);
    return (countMap.get(keyB) || 0) - (countMap.get(keyA) || 0);
  });

  // Prepare OpenAI client
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // In-memory mapping of raw input key -> cleaned entry
  const mapping = new Map<string, CleanedEntry>();
  const canonicals: string[] = [];
  const outputEntries: FinalEntry[] = [];
  const threeBackTicks = "```";

  // wipe the temporary file
  const tempJsonlPath = path.resolve('data', 'responses.json');
  try {
    fs.unlinkSync(tempJsonlPath);
  } catch (error) { }
  
  for (const row of rows) {
    const key = generateKey(row);

    let cleaned!: CleanedEntry; // definite assignment assertion ensures TS knows we initialize before use
    if (mapping.has(key)) {
      cleaned = mapping.get(key)!;
    } else {
      // Build dynamic prompt
         let userContent = '';
      if (canonicals.length > 0) {
        userContent += `Here is a growing list of previously cleaned entries, which you should re-use where appropriate:\n${threeBackTicks}\n${canonicals.join("\n")}\n${threeBackTicks}\n\n`;
      }      
      userContent += `Here is the data for cleaning...\n${threeBackTicks}json\n${JSON.stringify(row, null, 2)}\n${threeBackTicks}`;

      // Retry logic
      let attempts = 0;
      let lastError: any;
      while (attempts < 5) {
        try {
          const resp = await openai.chat.completions.create({
            model: 'gpt-4.1',
            user: 'org_name_script',
            messages: [
              { role: 'system', content: STATIC_PROMPT },
              { role: 'user', content: userContent },
            ],
	    response_format: zodResponseFormat(responseSchema, 'cleaned_org_name')
          });
          const rawResponse = resp.choices[0].message.content;
	  if (!rawResponse) {
	    throw new Error("Empty response from model");
	  }
          cleaned = responseSchema.parse(JSON.parse(rawResponse));

          // Store mapping and update canonical list
          mapping.set(key, cleaned);
          if (
	    !cleaned.flag_for_review &&
	    !canonicals.includes(cleaned.org_clean)
	  ) {
            canonicals.push(cleaned.org_clean);
	  }
          // log all the responses
          fs.appendFileSync(
            tempJsonlPath,
            JSON.stringify({ ...row, ...cleaned }) + "\n"
          );

          break;
        } catch (err : unknown) {
          lastError = err;
          attempts++;
          console.warn(`Attempt ${attempts} failed for input '${JSON.stringify(row)}':`, err);
        }
      }

      if (!mapping.has(key)) {
        console.error(`Failed to clean '${JSON.stringify(row)}' after 5 attempts.`, lastError);
        // Fallback: mark for review with raw org as institution
        cleaned = {
          org_clean: row.org,
          country_clean: row.country,
          type_clean: row['org type'],
          flag_for_review: true,
	  reason_for_concern: 'AI error',
        };
        mapping.set(key, cleaned);
      }
    }

    outputEntries.push({ ...row, ...cleaned });
    if (outputEntries.length % 10 === 0) {
      console.log(`Processed ${outputEntries.length} of ${rows.length} entries. Canonical list: ${canonicals.length} lines, ${sum(canonicals.map(e => e.length)) + 1} chars.`);
    }
    // write the spreadsheet so far, every now and then
    if (outputEntries.length % 100 === 0) {
      writeXlsx(outputEntries, path.resolve('data', 'wip.xlsx'));
    }
  }

  writeXlsx(outputEntries, outputXlsxFilename);
  console.log(`Cleaning complete. Wrote ${outputEntries.length} records to ${outputXlsxFilename}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


function writeXlsx(outputEntries: FinalEntry[], outputXlsxFilename: string): void {
  // Write output workbook
  const outSheet = XLSX.utils.json_to_sheet(outputEntries);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outSheet, 'Cleaned');
  XLSX.writeFile(outWb, outputXlsxFilename);
}
