import "dotenv/config"; // reads .env
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { parseStringPromise } from "xml2js";
import { corralledExperimentResponseType, CorralledExperimentResponseType, RehydratedCorralExperimentResponseType, UncorralledSample } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";
import { isEqual, omit, uniqBy } from "lodash";
import { writeToFile } from "./utils";
import PQueue from 'p-queue';
import pRetry from 'p-retry';

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
  console.error("Usage: yarn ts-node src/corral.ts data/local-analysisConfig-paths.txt\n\nWrites data to data/local-analysisConfig-paths.json");
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



async function processFiles(filenames: string[], outputFile: string, errorFile: string) {

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
      const parsed = await parseStringPromise(xml, { explicitArray: true });
      parsed.fileName = filename;
      xmlData.push(parsed);
    } catch (err) {
      console.error(`Failed to parse ${filename}:`, err);
    }
  }

  // now process this into something structured that we'll pass to the AI

  const processedData : UncorralledSample[] = xmlData.flatMap((datum: any) => {
    const [, componentDatabase, speciesAndStrain] = datum.fileName.match(/\/manualDelivery\/(\w+)\/(.+?)\//) || [];

    const fileName = datum.fileName as string;

    const steps = asArray(datum.xml.globalReferencable ?? datum.xml.step);

    return steps.map(
      (step) => {
	const properties : XMLProperty[] = asArray(step.property);
	const experiment = properties.find(
	  prop => prop.$.name === "profileSetName" // example filter condition
	)?.$.value;

	if (experiment == null) throw new Error(`Unexpected item in the bagging area for ${fileName}`);
	
	const rawSamples = asArray(
	  properties.find(
	    prop => prop.$.name === "samples" // example filter condition
	  )?.value
	);

	const idsToLabel = new Map<string, string>();
	const samples =  uniqBy(
	  rawSamples.map(
	    (str) => {
	      const [ label, id ] = str.split("|");
	      idsToLabel.set(id, label);
	      return { label };
	    }
	  ),
	  'label'
	);
	
	return {
	  fileName,
	  experiment,
	  componentDatabase,
	  speciesAndStrain,
	  samples,
	  idsToLabel,
	};
      });
  });

//  console.log(JSON.stringify(xmlData, null, 2));
//  console.log(JSON.stringify(processedData, null, 2));
  console.log(`Going to do ${processedData.length} profileSets/experiments`);
//  if (1>0) process.exit(0);

  
  // Placeholder for OpenAI initialization
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 10,
  });

  const queue = new PQueue({ concurrency: 1 }); // FIFO, single-threaded
  
  const aiResponses : CorralledExperimentResponseType[] = [];
  const aiErrors : {
    fileName : string,
    profileSetName: string,
    error : any
  }[] = [];

  const fileCounter = new Map<string, number>();

  for (const input of processedData) {
    queue.add(() =>
      pRetry(() => processCorralInput(input, openai), {
	retries: 3,
	minTimeout: 10000,
	onFailedAttempt: (error) => {
          console.warn(
            `Retry failed for ${input.fileName}. Attempt ${error.attemptNumber} of ${error.attemptNumber + error.retriesLeft}. Reason: ${error.message}`
          );
	},
      }).then((output) => {
	aiResponses.push(output);
	const counter = (fileCounter.get(input.fileName) ?? 0) + 1;
	fileCounter.set(input.fileName, counter);
	// counter doesn't need zero padding, max per fileName is 5
	const perExperimentOutputFile = input.fileName.replace('.xml', ".ai." + counter + ".json");
	return writeToFile(
	  perExperimentOutputFile,
	  JSON.stringify(output, null, 2)
	);
      }).catch((error) => {
	console.error(`Final failure for ${input.fileName}`);
	aiErrors.push({ fileName: input.fileName, profileSetName: input.experiment, error });
      })
    );
  }

  // wait for the queue to be processed
  await queue.onIdle();
  
  await writeToFile(
    outputFile,
    JSON.stringify(aiResponses, null, 2)
  );

  if (aiErrors.length > 0) {
    console.error("There were errors!");
    console.error(JSON.stringify(aiErrors, null, 2));
    await writeToFile(
      errorFile,
      JSON.stringify(aiErrors, null, 2)
    );
  }

}

function getPrompt(input: UncorralledSample) : string {

  // AI doesn't need the id->label lookup
  const aiInput = omit(input, ['idsToLabel']);
  
  return [
    "Below in JSON format is information about a transcriptomics experiment and its samples.\n",
    "```json",
    JSON.stringify(aiInput, null, 2),
    "```\n",
    "For each sample, extract `annotations` from the `label`, where possible, as (`attribute`,`value`) pairs. If the `label` does not contain usable information, return an empty `annotations` array for that sample. For continuous variables, provide a top-level `units` lookup from attribute name to a unit name (singular noun) and strip any units from the value(s). Convert values to this unit if the provided values are mixed-unit.\n",
    "Also provide an inputQuality score (integer from 0 to 5):",
    "• 0 = no usable information in the sample label",
    "• 5 = comprehensive, unambiguous annotation possible",
    "• 1–4 = partial or ambiguous information, where guesswork was required",
  ].join("\n");
}

const { root, dir, name } = path.parse(filePath);
const outputFile = path.join(root, dir, name) + ".json";
const errorFile = path.join(root, dir, name) + ".errors";
processFiles(filenames, outputFile, errorFile).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});



async function processCorralInput(input: UncorralledSample, openai: OpenAI): Promise<RehydratedCorralExperimentResponseType> {
  const {
    fileName,
    experiment,
    speciesAndStrain,
    componentDatabase,
    idsToLabel,
  } = input;

  
  console.log(`Gonna send input for ${fileName}:`);

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
    max_tokens: 4096,
    response_format: zodResponseFormat(corralledExperimentResponseType, 'corral_experiment')
  });

  const rawResponse = completion.choices[0].message.content;
  if (!rawResponse) {
    throw new Error("Empty response from model");
  }

  const parsedResponse = corralledExperimentResponseType.parse(JSON.parse(rawResponse));

  // Validate sample labels match
  const inputLabels = input.samples.map(({ label }: { label: string }) => label);
  const outputLabels = parsedResponse.samples.map(({ label }: { label: string }) => label);
  
  if (!isEqual(inputLabels, outputLabels)) {
    throw new Error(`Sample labels in AI response (${outputLabels}) do not match input (${inputLabels})`);
  }

  console.log(`total_tokens: ${completion.usage?.total_tokens}`);
  console.log(`finish_reason: ${completion.choices[0].finish_reason}`);

  return {
    ...parsedResponse,
    fileName,
    experiment,
    speciesAndStrain,
    componentDatabase,
    // map samples from label-based to id-based array
    samples: Array.from(idsToLabel.keys()).map(
      (id) => {
	const label = idsToLabel.get(id) as string; // can't be missing, right?
	const sample = parsedResponse.samples.find((sample) => sample.label === label);
	if (sample == null) {
	  throw new Error(`Sample with label '${label}' missing from AI response for ${fileName}.`);
	}
	return ({
	  id,
	  ...sample,
	});
      }
    ),
  };
}
