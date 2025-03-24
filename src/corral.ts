import "dotenv/config"; // reads .env
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { parseStringPromise } from "xml2js";
import { corralledExperimentResponseType, CorralledExperimentResponseType, RehydratedCorralExperimentResponseType, UncorralledSample } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";
import { isEqual } from "lodash";
import { writeToFile } from "./utils";
// import { stringify } from 'yaml';

const modelId = "gpt-4o-2024-11-20";

type XMLProperty = {
  $: { name: string; value?: string };
  value?: string | string[];
};

// Helper to ensure property is always an array
function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value !== undefined) return [value];
  return [];
}

const [,, fileOfFilenames] = process.argv;

if (!fileOfFilenames) {
  console.error("Usage: yarn ts-node src/corral.ts data/local-analysisConfig-paths.txt");
  process.exit(1);
}

const filePath = path.resolve(fileOfFilenames);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const fileContents = fs.readFileSync(filePath, "utf-8");
const filenames = fileContents
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0);

console.log(`Loaded ${filenames.length} filenames!`);



async function processFiles(filenames: string[], outputFile: string) {

  // read in the XMLs into an array of objects
  const xmlData : any[] = [];
  for (const filename of filenames) {
    const xmlFilePath = path.resolve(filename);
    if (!fs.existsSync(xmlFilePath)) {
      console.error(`XML file not found: ${filename}`);
      continue;
    }

    const xml = fs.readFileSync(filename, "utf-8");
    try {
      const parsed = await parseStringPromise(xml, { explicitArray: false });
      parsed.fileName = filename;
      xmlData.push(parsed);
    } catch (err) {
      console.error(`Failed to parse ${filename}:`, err);
    }
  }

  // now process this into something structured that we'll pass to the AI

  const processedData : UncorralledSample[] = xmlData.map((datum: any) => {
    const [, componentDatabase, speciesAndStrain] = datum.fileName.match(/\/manualDelivery\/(\w+)\/(.+?)\//) || [];

    const fileName = datum.fileName as string;
   
    const properties: XMLProperty[] = asArray(datum.xml?.globalReferencable?.property ?? datum.xml?.step?.property);

    const experiment = properties.find(
      prop => prop.$.name === "profileSetName" // example filter condition
    )?.$.value;

    if (experiment == null) throw new Error("Unexpected item in the bagging area.");
    
    const rawSamples = asArray(
      properties.find(
	prop => prop.$.name === "samples" // example filter condition
      )?.value
    );

    const samples = rawSamples.map(
      (str) => {
	const [ label, id ] = str.split("|");
	return { id, label };
      }
    );
    
    return {
      fileName,
      experiment,
      componentDatabase,
      speciesAndStrain,
      samples,
    };
  });

//  console.log(JSON.stringify(xmlData, null, 2));
//  console.log(JSON.stringify(processedData, null, 2));
//  if (1>0) process.exit(0);

  
  // Placeholder for OpenAI initialization
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 10,
  });

  const aiResponses : CorralledExperimentResponseType[] = [];
  const aiErrors : {
    fileName : string,
    error : any
  }[] = [];

  for (const input of processedData) {

    const {
      fileName,
      experiment,
      speciesAndStrain,
      componentDatabase,
      samples
    } = input;
    
    console.log(`Gonna send input for ${fileName}:`);
    try {
      const completion = await openai.chat.completions.create({
	model: modelId,
	messages: [
	  {
	    role: "system",
	    content: "You are a bioinformatician working for VEuPathDB.org. You are an expert at wrangling 'omics metadata."
	  },
	  {
	    role: "user",
	    content: getPrompt(input),
	  },
	],
	response_format: zodResponseFormat(corralledExperimentResponseType, 'corral_experiment')
      });
      
      const rawResponse = completion.choices[0].message.content; // Raw text response

      if (rawResponse) {
	try {
	  const parsedResponse = corralledExperimentResponseType.parse(JSON.parse(rawResponse));

	  // check that the response contains the same sample IDs
	  if (!isEqual(
	    input.samples.map(({ id } : { id: string }) => id),
	    parsedResponse.samples.map(({ id } : { id: string }) => id)
	  )) {
	    throw new Error("Sample IDs in AI response do not match input");
	  }
	  
	  // merge the input data back into the response
	  // (more reliable than asking the AI to regurgitate it)
	  const rehydratedResponse : RehydratedCorralExperimentResponseType = {
	    ...parsedResponse,
	    fileName,
	    experiment,
	    speciesAndStrain,
	    componentDatabase,
	    samples: parsedResponse.samples.map(
	      (sample, index) => ({
		...sample,
		label: samples[index].label,
	      })
	    ),
	  };
	  
	  aiResponses.push(rehydratedResponse);
	  console.log(`total_tokens: ${completion.usage?.total_tokens}`);
	  console.log(`finish_reason: ${completion.choices[0].finish_reason}`);
	  } catch (error) {
	    console.error("Response validation failed. Full report at end.");
	    aiErrors.push({ fileName, error });
	  }
      } else {
	console.error(`Empty response. Full report at end.`);
	aiErrors.push({ fileName, error: "empty response from model"});
      }
    } catch (error) {
      console.error("Error generating completion. Full report at end.");
      aiErrors.push({ fileName, error });
    }
    
  }

  await writeToFile(
    outputFile,
    JSON.stringify(aiResponses, null, 2)
  );

  if (aiErrors.length > 0) {
    console.error("There were errors!");
    console.error(JSON.stringify(aiErrors, null, 2));
  }

}

function getPrompt(input: UncorralledSample) : string {
  return [
    "Below in JSON format is information about a transcriptomics experiment and its samples.\n",
    "```json",
    JSON.stringify(input, null, 2),
    "```\n",
    "For each `sample`, extract `annotations` from the `label`, where possible, as `attribute,value` pairs. If the `label` does not contain usable information, return an empty `annotations` array for that sample. Avoid using identifiers as annotation values.\n",
    "Also provide an inputQuality score (integer from 0 to 5):",
    "• 0 = no usable information in the sample label",
    "• 5 = comprehensive, unambiguous annotation possible",
    "• 1–4 = partial or ambiguous information, where guesswork was required",
  ].join("\n");
}

const { root, dir, name } = path.parse(filePath);
const outputFile = path.join(root, dir, name) + ".json";
processFiles(filenames, outputFile).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
