import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { z } from 'zod';
import { isEqual } from 'lodash';
import { zodResponseFormat } from 'openai/helpers/zod';

dotenv.config();

// Zod schema for LLM response
const responseSchema = z.object({
  institution: z.string(),
  sub_entity: z.string().nullable(),
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

Institution names may refer to universities, research institutes, hospitals, government public health bodies, or major pharmaceutical/biotech companies. They may contain typos, inconsistent casing, translations, internal divisions, or IDs from exported spreadsheets.

Your task is to return a cleaned, canonical representation of the institution provided as the 'org' field of the input. If applicable, include a major named or semi-autonomous school, faculty, division, or branded research institute as a 'sub_entity', otherwise return 'null'. Ordinary departments, research labs, or internal units without public-facing identity should be discarded and 'sub_entity' should be 'null'.

You will also be given an institution type ('org type') and country code ('country'). If either of these appear to be incorrect for the institution, you may correct them in your response. If in doubt, leave as-is but set flag_for_review: true.

Return structured JSON in the following format:

{
  institution: "Canonical name of the parent institution",
  sub_entity: "Major named sub-entity or null",
  country_clean: "Two-letter country code, corrected if appropriate",
  type_clean: "academic | government | industry | other (correct if appropriate)",
  flag_for_review: true or false,
  reason_for_concern: "Short explanation why this is flagged for review"
}

Set \`flag_for_review: true\` and provide a 'reason_for_concern' if:
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
    console.error('Usage: ts-node org_names.ts <input.xlsx> <output.xlsx>');
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
  const canonicalList: CleanedEntry[] = [];
  const outputEntries: FinalEntry[] = [];
  const threeBackTicks = "```";

  // wipe the temporary file
  try {
    fs.unlinkSync('/tmp/canonical.jsonl');
  } catch (error) { }
  
  for (const row of rows) {
    const key = generateKey(row);

    let cleaned!: CleanedEntry; // definite assignment assertion ensures TS knows we initialize before use
    if (mapping.has(key)) {
      cleaned = mapping.get(key)!;
    } else {
      // Build dynamic prompt
      const jsonlList = canonicalList.map(e => JSON.stringify(e)).join("\n");
      let userContent = '';
      if (canonicalList.length > 0) {
        userContent += `Here is a growing list of previously cleaned entries in JSONL format. Re-use them where appropriate, giving preference to entries not flagged for review:\n${threeBackTicks}jsonl\n${jsonlList}\n${threeBackTicks}\n\n`;
      }      
      userContent += `Here is the data for cleaning...\n${threeBackTicks}json\n${JSON.stringify(row, null, 2)}\n${threeBackTicks}`;

      // Retry logic
      let attempts = 0;
      let lastError: any;
      while (attempts < 5) {
        try {
          const resp = await openai.chat.completions.create({
            model: 'gpt-4o',
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

	  // LLM seems to put a lot of crap in the sub_entity output, so normalise/clean
          if (cleaned.sub_entity != null) {
	    // strip any leading and trailing non-alphanumerics (the model seems to like prefixing this with ., : or ;)
	    cleaned.sub_entity = cleaned.sub_entity.replace(/^\W+/, '');
	    cleaned.sub_entity = cleaned.sub_entity.replace(/\W+$/, '');
	    // strip any all-numeric values
	    cleaned.sub_entity = cleaned.sub_entity.replace(/^\d+$/, '');
	    // wipe anything starting with 'formerly '
	    cleaned.sub_entity = cleaned.sub_entity.replace(/^formerly .+$/, '');
	    // if no meaningful content (a capitalised English letter), or the word 'null' is found, return null
	    if (!cleaned.sub_entity.match(/[A-Z]/) ||
	      cleaned.sub_entity.match(/\bnull\b/i)) {
              cleaned.sub_entity = null;
	    }
          }

          // Store mapping and update canonical list
          mapping.set(key, cleaned);
          const exists = canonicalList.some(e => isEqual(e, cleaned));
          if (!exists) {
            canonicalList.push(cleaned);
            // Append to tmp JSONL
            fs.appendFileSync(
              path.resolve('/tmp', 'canonical.jsonl'),
              JSON.stringify(cleaned) + "\n"
            );
          }

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
          institution: row.org,
          sub_entity: null,
          country_clean: row.country,
          type_clean: row['org type'],
          flag_for_review: true,
	  reason_for_concern: 'AI error',
        };
        mapping.set(key, cleaned);
      }
    }

    outputEntries.push({ ...row, ...cleaned });
    if (outputEntries.length % 10 == 0) {
      console.log(`Processed ${outputEntries.length} of ${rows.length} entries...`);
    }
  }

  // Write output workbook
  const outSheet = XLSX.utils.json_to_sheet(outputEntries);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outSheet, 'Cleaned');
  XLSX.writeFile(outWb, outputXlsxFilename);

  console.log(`Cleaning complete. Wrote ${outputEntries.length} records to ${outputXlsxFilename}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
