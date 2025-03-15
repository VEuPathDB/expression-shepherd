import "dotenv/config"; // reads .env
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { parseStringPromise } from "xml2js";
// import { stringify } from 'yaml';

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
  console.error("Usage: yarn ts-node corral.ts data/local-analysisConfig-paths.txt");
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

async function processFiles(filenames: string[]) {

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

  const processedData = xmlData.map((datum: any) => {
    const [, componentDatabase, speciesAndStrain] = datum.fileName.match(/\/manualDelivery\/(\w+)\/(.+?)\//) || [];

    const properties: XMLProperty[] = asArray(datum.xml?.globalReferencable?.property ?? datum.xml?.step?.property);

    const experiment = properties.find(
      prop => prop.$.name === "profileSetName" // example filter condition
    )?.$.value;

    const rawSamples = asArray(
      properties.find(
	prop => prop.$.name === "samples" // example filter condition
      )?.value
    );

//    const sampleIdToLabel = rawSamples.reduce<Record<string,string>>(
//      (prev, curr) => {
//	const [ label, id ] = curr.split("|");
//	prev[id] = label;
//	return prev;
//      },
//      {}
//    );

    const samples = rawSamples.map(
      (str) => {
	const [ label, id ] = str.split("|");
	return { id, label };
      }
    );
    
    return {
      experiment,
      componentDatabase,
      speciesAndStrain,
      samples,
    };
  });
//  console.log(JSON.stringify(xmlData, null, 2));
  console.log(JSON.stringify(processedData, null, 2));
  process.exit(0);
  
  // Placeholder for OpenAI initialization
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });


}



processFiles(filenames).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
