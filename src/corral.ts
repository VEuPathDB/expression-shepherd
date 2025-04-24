import "dotenv/config"; // reads .env
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { parseStringPromise } from "xml2js";
import { corralledExperimentResponseType, CorralledExperimentResponseType, RehydratedCorralExperimentResponseType, UncorralledExperiment } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";
import { isEqual, omit, uniq } from "lodash";
import { writeToFile } from "./utils";
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { get_ncbi_attributes_async } from "./get_ncbi_attributes";

const modelId = "gpt-4.1";

// "gpt-4.1"
// "gpt-4.1-mini";
// "gpt-4.1-nano";
// "gpt-4o-2024-11-20";

const sraLookupJsonFilename = 'data/build70.json';

type XMLProperty = {
  $: { name: string; value?: string };
  value?: string | string[];
};

type SteveMetadata = {
  summary: string;
  analysisConfigFile: string;
  description: string;
  citation: string;
  displayName: string;
};

// Helper to ensure property is always an array
function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value !== undefined) return [value];
  return [];
}

const [,, steveJsonFilename, outputJsonFilename, skipNcbiArg = ''] = process.argv;

if (!steveJsonFilename && !outputJsonFilename) {
  console.error("Usage: yarn ts-node src/corral.ts data/inputs-from-steve.json data/output-filename.json");
  process.exit(1);
}

const filePath = path.resolve(steveJsonFilename);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const fileContents = fs.readFileSync(filePath, "utf-8");
const steveMetadata = JSON.parse(fileContents) as SteveMetadata[];

const metadataByFilename = new Map(
  steveMetadata.map(obj => [obj.analysisConfigFile, obj])
);

const filenames = steveMetadata.map(({analysisConfigFile}) => analysisConfigFile);
console.log(`Loaded ${filenames.length} filenames!`);


// load the SRA lookup
type SraLookupEntry = {
  component: string;
  name: string;
  release: number;
  runs: {
    accessions: string[];
    name: string;
  }[];
  species: string;
};

const sraLookup = JSON.parse(fs.readFileSync(sraLookupJsonFilename, "utf-8")) as SraLookupEntry[];

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

// species -> experimentName -> sampleName = [ accessions ]
type SampleNametoSraAccessions = Map<string, string[]>;
type SraLookup = Map<string, Map<string, SampleNametoSraAccessions>>;

const accessionsLookup = sraLookup.reduce<SraLookup>(
  (result, entry) => {
    const speciesToExperiment = getOrCreate(result, entry.species, () => new Map());

    // Primary experiment key
    const experimentKey = entry.name;
    // Alternate key: remove the _RNASeq_RSRC suffix if present
    const alternateKey = experimentKey.replace(/_RNASeq_RSRC$/, '');

    // Get (or create) the map for the primary key.
    const experimentToLookup = getOrCreate(speciesToExperiment, experimentKey, () => new Map());

    // Alias the alternate key to point to the same map.
    if (experimentKey !== alternateKey) {
      speciesToExperiment.set(alternateKey, experimentToLookup);
    }

    // Then fill in sample-level data.
    entry.runs.forEach(({ name, accessions }) => {
      experimentToLookup.set(name, accessions);
    });
    return result;
  },
  new Map()
);


async function processFiles(
  filenames: string[],
  metadataByFilename: Map<string, SteveMetadata>,
  accessionsLookup : SraLookup,
  outputFile: string,
  errorFile: string
) {

  // read in the XMLs into an array of objects
  const xmlData : any[] = [];
  for (const filename of filenames) {
    const xmlFilePath = path.join('data', filename);
    if (!fs.existsSync(xmlFilePath)) {
      console.error(`XML file not found: ${xmlFilePath}`);
      continue;
    }

    const xml = fs.readFileSync(xmlFilePath, "utf-8");
    try {
      const parsed = await parseStringPromise(xml, { explicitArray: true });
      parsed.fileName = filename;
      xmlData.push(parsed);
    } catch (err) {
      console.error(`Failed to parse ${filename}:`, err);
    }
  }

  // now process this into something structured that we'll pass to the AI

  const processedData : UncorralledExperiment[] = xmlData.flatMap((datum: any) => {
    const [, componentDatabase, speciesAndStrain] = datum.fileName.match(/\/manualDelivery\/(\w+)\/(.+?)\//) || [];

    const fileName = datum.fileName as string;

    const datasetName = fileName.split('/')[8];
    const steps = asArray(datum.xml.globalReferencable ?? datum.xml.step);

    return steps.map(
      (step) => {
	const properties : XMLProperty[] = asArray(step.property);
	const profileSetName = properties.find(
	  prop => prop.$.name === "profileSetName"
	)?.$.value;
	
	const rawSamples = asArray(
	  properties.find(
	    prop => prop.$.name === "samples"
	  )?.value
	);

	if (profileSetName == null || rawSamples.length === 0) {
	  console.warn(`Missing profileSetName or samples for 1 of ${steps.length} steps in '${fileName}'`);
	  return null; // will be filtered out below
	}
	
	const idsToLabel = rawSamples.reduce<Map<string, string>>(
	  (map, rawSample) => {
	    const [ label, id ] = rawSample.split("|");
	    map.set(id, label);
	    return map;
	  },
	  new Map()
	);

	const metadata = metadataByFilename.get(fileName);

	if (metadata == null)
	  throw new Error(`Can't find Steve's metadata for '${fileName}'`);
	
	return {
	  fileName,
	  datasetName,
	  componentDatabase,
	  speciesAndStrain,
	  experiment: {
	    name: metadata.displayName,
	    summary: metadata.summary,
	    description: metadata.description,
	  },
	  profileSetName,
	  idsToLabel,
	};
      }).filter((obj) => obj != null);
  });

//  console.log(JSON.stringify(xmlData, null, 2));
//  console.log(JSON.stringify(processedData, null, 2));
  console.log(`Going to do ${processedData.length} profileSets/experiments`);

//  const tempInput = processedData[123];
//  const prompt = getPrompt(tempInput, accessionsLookup);
//  console.log(prompt);
//  if (1>0) process.exit(0);

  
  // Placeholder for OpenAI initialization
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 5,
  });

  const queue = new PQueue({ concurrency: 1 }); // FIFO, single-threaded
  
  const aiResponses : CorralledExperimentResponseType[] = [];
  const aiErrors : {
    fileName : string,
    profileSetName: string,
    error : any
  }[] = [];

  const fileCounter = new Map<string, number>();

//  for (const input of processedData.filter(({ fileName }) => fileName.match(/Lind_SecondaryMetabolism_Anid/))) {
  for (const input of processedData) {
    queue.add(() =>
      pRetry((attemptNumber) => processCorralInput(input, accessionsLookup, openai, skipNcbiArg !== '' || attemptNumber > 2), {
	retries: 4,
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
	// NASTY prefix hack!
	const perExperimentOutputFile = 'data' + input.fileName.replace('.xml', ".ai." + counter + ".json");
	return writeToFile(
	  perExperimentOutputFile,
	  JSON.stringify(output, null, 2)
	);
      }).catch((error) => {
	console.error(`Final failure for ${input.fileName}`);
	aiErrors.push({ fileName: input.fileName, profileSetName: input.profileSetName, error });
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

async function getPrompt(input: UncorralledExperiment, lookup: SampleNametoSraAccessions, skipNcbi: boolean) : Promise<string> {

  const seen = new Set<string>();
  const samples = await Array.from(input.idsToLabel.entries()).reduce(
    async (promiseAcc, [id, label]) => {
      const acc = await promiseAcc;
      if (!seen.has(label)) {
	seen.add(label);
	const ncbi_attributes = skipNcbi ? [] : await get_ncbi_attributes_async(id, lookup);
	acc.push({ label, ncbi_attributes });
      }
      return acc;
    },
    Promise.resolve([] as { label: string; ncbi_attributes: string[] }[])
  );
  
  // AI doesn't need the id->label lookup
  // but it does need an array of label-based samples
  const aiInput = {
    ...omit(input, ['idsToLabel']),
    samples,
  };

  return [
    "Below in JSON format is information about a transcriptomics experiment and its samples.\n",
    "```json",
    JSON.stringify(aiInput, null, 2),
    "```\n",
    "For each sample, extract `annotations` from the `label` as (`attribute`,`value`) pairs. Be sure to represent all attributes that vary across samples, including timepoints if present. If there is no usable information, return an empty `annotations` array for that sample. For continuous variables, provide a top-level `units` lookup from attribute name to a unit name (singular noun) and strip any units from the value(s). Convert values to this unit if the provided values are mixed-unit. Sample identifiers should not be used as annotation values. Report missing values as the empty string. Omit all-missing annotations.\n",
    "Also provide an inputQuality score (integer from 0 to 5):",
    "• 0 = no usable information in the sample label",
    "• 5 = comprehensive, unambiguous annotation possible",
    "• 1–4 = partial or ambiguous information, where guesswork was required",
  ].join("\n");
}

const errorFile = outputJsonFilename.replace(/(?:\.json)?$/, '.err.json');
processFiles(filenames, metadataByFilename, accessionsLookup, outputJsonFilename, errorFile).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

async function processCorralInput(
  input: UncorralledExperiment,
  accessionsLookup: SraLookup,
  openai: OpenAI,
  skipNcbi: boolean,
): Promise<RehydratedCorralExperimentResponseType> {
  const {
    fileName,
    datasetName,
    experiment,
    profileSetName,
    speciesAndStrain,
    componentDatabase,
    idsToLabel,
  } = input;
  
  console.log(`Gonna send input for ${fileName}:`);

  // find the sample name to SRA accession lookup
  const lookup = accessionsLookup.get(speciesAndStrain)?.get(datasetName) ?? new Map();

  // supplement `lookup` where the keys of `idsToLabel` match /^[SED]R[RXS]\d+$/
  // with trivial "identity" lookups: id => [ id ]
  // but only if `lookup.get(id)` is nullish
  for (const id of idsToLabel.keys()) {
    if (/^[SED]R[RXS]\d+$/.test(id) && lookup?.get(id) == null) {
      lookup.set(id, [id]);
    }
  }

  const lookupHitCount = Array.from(idsToLabel.keys()).filter((id) => lookup.has(id)).length;
  
  const completion = await openai.chat.completions.create({
    model: modelId,
    messages: [
      {
        role: "system",
        content: "You are a bioinformatician working for VEuPathDB.org. You are an expert at wrangling 'omics metadata."
      },
      {
        role: "user",
        content: await getPrompt(input, lookup, skipNcbi),
      },
    ],
    max_tokens: 4096,
    response_format: zodResponseFormat(corralledExperimentResponseType, 'corral_experiment')
  });

  console.log(`Got a response for ${fileName}:`);

  const rawResponse = completion.choices[0].message.content;
  if (!rawResponse) {
    throw new Error("Empty response from model");
  }

  const parsedResponse = corralledExperimentResponseType.parse(JSON.parse(rawResponse));
  
  // Validate sample labels match
  const inputLabels = uniq(Array.from(idsToLabel.values()));
  const outputLabels = parsedResponse.samples.map(({ label }: { label: string }) => label);
  
  if (!isEqual(inputLabels, outputLabels)) {
    throw new Error(`Sample labels in AI response (${outputLabels}) do not match input (${inputLabels})`);
  }

  console.log(`total_tokens: ${completion.usage?.total_tokens}`);
  console.log(`finish_reason: ${completion.choices[0].finish_reason}`);

  return {
    ...parsedResponse,
    fileName,
    datasetName,
    experiment,
    profileSetName,
    speciesAndStrain,
    componentDatabase,
    usedNcbi: !skipNcbi && lookupHitCount > 0,
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
	  sra_ids: lookup.get(id)?.join(',') ?? '',
	  ...sample,
	});
      }
    ),
  };
}
