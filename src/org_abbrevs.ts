import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

dotenv.config();

type OrgType = 'academic' | 'government' | 'industry' | 'other';

// Input JSONL record format
type InputRecord = {
  org: string;
  "org type": OrgType;
  country: string;
  org_clean: string;
  type_clean: OrgType;
  country_clean: string;
  flag_for_review: boolean;
  reason_for_concern: string;
};

// Zod schema for LLM response
const responseSchema = z.object({
  institution: z.string(),
  short_forms: z.array(z.string()),
  notes: z.string().optional(),
});
type ResponseRecord = z.infer<typeof responseSchema>;

type FullOutput = ResponseRecord & { org_clean: string; };

// Static system prompt (instructions + examples)
const STATIC_PROMPT = `You are an expert in global academic and research institutions in the domain of public health, biomedical research, and human disease.

For the given institution name, return a JSON object containing a list of commonly used short forms, including:

* acronyms (e.g. LSHTM)
* initialisms (e.g. MIT)
* abbreviations or truncations (e.g. Unimelb, Caltech)
* any widely used local-language forms

Include both international and local-language variants if applicable. Only include names that are actually used in practice. Do not invent abbreviations based solely on initials—return an empty 'short_forms' array if necessary. Return the long form name in 'institution'. Optionally use 'notes' to explain any oddities.`;

async function main() {
  const [,, inputJsonlFilename, outputXlsxFilename] = process.argv;
  if (!inputJsonlFilename || !outputXlsxFilename) {
    console.error('Usage: ts-node src/org_abbrevs.ts <input.jsonl> <output.xlsx>');
    // you can also compile with `yarn tsc` and run with
    // node dist/org_abbrevs.ts ...
    process.exit(1);
  }

  // Read in the input JSONL file
  const raw = fs.readFileSync(inputJsonlFilename, 'utf-8');
  const allRecords: InputRecord[] = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as InputRecord);

  // extract a unique set of non-flagged cleaned org names
  const institutions = Array.from(
    new Set(
      allRecords
        .filter(r => r.flag_for_review === false)
        .map(r => r.org_clean)
    )
  );
  
  // Prepare OpenAI client
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Gather outputs in this array
  const outputEntries: FullOutput[] = [];
  
  for (const institution of institutions) {

    let shortForms: ResponseRecord | null = null;

    const userContent = `Institution name: ${institution}`;
    
    // Retry logic
    let attempts = 0;
    while (attempts < 5) {
      try {
        const resp = await openai.chat.completions.create({
          model: 'gpt-4.1',
          user: 'org_name_script',
          messages: [
            { role: 'system', content: STATIC_PROMPT },
            { role: 'user', content: userContent },
          ],
	  response_format: zodResponseFormat(responseSchema, 'short_forms')
        });
        const rawResponse = resp.choices[0].message.content;
	if (!rawResponse) {
	  throw new Error("Empty response from model");
	}
        shortForms = responseSchema.parse(JSON.parse(rawResponse));
	break;
      } catch (err : unknown) {
        attempts++;
        console.warn(`Attempt ${attempts} failed for input '${institution}':`, err);
      }
    }

    if (shortForms != null) {
      if (shortForms.institution !== institution) {
	console.warn(`Warning: Response institution '${shortForms.institution}' did not match input '${institution}'`);
      }

      // merge in the original just to be sure
      outputEntries.push({
	...shortForms,
	org_clean: institution,
      });

      if (outputEntries.length % 10 === 0) {
	console.log(`Processed ${outputEntries.length} of ${institutions.length} entries.`);
      }

      // write the spreadsheet so far, every now and then
      if (outputEntries.length % 100 === 0) {
	writeXlsx(outputEntries, path.resolve('data', 'wip.xlsx'));
      }
    }
  }

  writeXlsx(outputEntries, outputXlsxFilename);
  console.log(`Cleaning complete. Wrote ${outputEntries.length} records to ${outputXlsxFilename}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});


// Write output workbook
function writeXlsx(outputEntries: FullOutput[], outputXlsxFilename: string): void {

  // clean up the field order and join multi-values
  const rows = outputEntries.map(e => ({
    org_clean: e.org_clean,
    institution: e.institution,
    short_forms: e.short_forms.join(';'),
    notes: e.notes ?? ''
  }));

  const outSheet = XLSX.utils.json_to_sheet(rows);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outSheet, 'Short forms');
  XLSX.writeFile(outWb, outputXlsxFilename);
}
