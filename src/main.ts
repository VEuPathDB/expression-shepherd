import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { expressionDataRequestPostData } from "./post-templates/expression_data_request";
import axios from "axios";
import { omit, pick, orderBy } from "lodash";
import { FullIndividualResponseType, individualResponseSchema, summaryResponseSchema } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";
import { consolidateSummary, summaryJSONtoHTML, writeToFile } from "./utils";

// Project ID to server URL mapping
const PROJECT_URLS: Record<string, { serverUrl: string; geneBaseUrl: string; serviceBaseUrl: string }> = {
  'PlasmoDB': {
    serverUrl: 'https://plasmodb.org',
    geneBaseUrl: 'https://plasmodb.org/plasmo/app/record/gene',
    serviceBaseUrl: 'https://plasmodb.org/plasmo/service'
  },
  'VectorBase': {
    serverUrl: 'https://vectorbase.org',
    geneBaseUrl: 'https://vectorbase.org/vectorbase/app/record/gene',
    serviceBaseUrl: 'https://vectorbase.org/vectorbase/service'
  },
  'ToxoDB': {
    serverUrl: 'https://toxodb.org',
    geneBaseUrl: 'https://toxodb.org/toxo/app/record/gene',
    serviceBaseUrl: 'https://toxodb.org/toxo/service'
  },
  'CryptoDB': {
    serverUrl: 'https://cryptodb.org',
    geneBaseUrl: 'https://cryptodb.org/cryptodb/app/record/gene',
    serviceBaseUrl: 'https://cryptodb.org/cryptodb/service'
  },
  'FungiDB': {
    serverUrl: 'https://fungidb.org',
    geneBaseUrl: 'https://fungidb.org/fungidb/app/record/gene',
    serviceBaseUrl: 'https://fungidb.org/fungidb/service'
  },
  'GiardiaDB': {
    serverUrl: 'https://giardiadb.org',
    geneBaseUrl: 'https://giardiadb.org/giardiadb/app/record/gene',
    serviceBaseUrl: 'https://giardiadb.org/giardiadb/service'
  },
  'TrichDB': {
    serverUrl: 'https://trichdb.org',
    geneBaseUrl: 'https://trichdb.org/trichdb/app/record/gene',
    serviceBaseUrl: 'https://trichdb.org/trichdb/service'
  },
  'AmoebaDB': {
    serverUrl: 'https://amoebadb.org',
    geneBaseUrl: 'https://amoebadb.org/amoeba/app/record/gene',
    serviceBaseUrl: 'https://amoebadb.org/amoeba/service'
  },
  'MicrosporidiaDB': {
    serverUrl: 'https://microsporidiadb.org',
    geneBaseUrl: 'https://microsporidiadb.org/micro/app/record/gene',
    serviceBaseUrl: 'https://microsporidiadb.org/micro/service'
  },
  'PiroplasmaDB': {
    serverUrl: 'https://piroplasmadb.org',
    geneBaseUrl: 'https://piroplasmadb.org/piro/app/record/gene',
    serviceBaseUrl: 'https://piroplasmadb.org/piro/service'
  },
  'TriTrypDB': {
    serverUrl: 'https://tritrypdb.org',
    geneBaseUrl: 'https://tritrypdb.org/tritrypdb/app/record/gene',
    serviceBaseUrl: 'https://tritrypdb.org/tritrypdb/service'
  }
};

//
// yarn build && node dist/main.js PlasmoDB PF3D7_0616000
//
// or
//
// node dist/main.js PlasmoDB PF3D7_0716300 DS_e973eadd57 10 0
//
// or with Claude 4 Sonnet:
//
// node dist/main.js PlasmoDB PF3D7_0616000 --claude
//
// Note: Use 'node dist/main.js' directly instead of 'yarn start' to pass the --claude flag
// Set ANTHROPIC_API_KEY environment variable for Claude, OPENAI_API_KEY for OpenAI
// Output files will include model name: e.g., GENE.01.Claude.summary.html
//
// Arguments: <ProjectID> <GeneID> [DatasetID] [NumReps] [PrettyPrint] [--claude]
// * ProjectID: database project ID (PlasmoDB, VectorBase, ToxoDB, etc.)
// * GeneID: gene identifier 
// * DatasetID: optional specific dataset to process
// * NumReps: number of replicates (default: 1)
// * PrettyPrint: boolean for JSON formatting (default: true)  
// * --claude: use Claude 4 Sonnet instead of OpenAI GPT-4
// * if DatasetID specified, only that dataset will be processed (no summary-of-summaries)
// * these run in parallel asynchronously - not sure if client retries if hitting the rate-limit
//

const args = process.argv.slice(2); // Skip the first two entries

// Parse command line arguments
// Parse arguments, handling --claude flag
const filteredArgs = args.filter(arg => arg !== '--claude');
const useAnthropic = args.includes('--claude');

// Validate minimum arguments
if (filteredArgs.length < 2) {
  console.error('Usage: node dist/main.js <ProjectID> <GeneID> [DatasetID] [NumReps] [PrettyPrint] [--claude]');
  console.error('ProjectID must be one of:', Object.keys(PROJECT_URLS).join(', '));
  process.exit(1);
}

const projectId = filteredArgs[0];
const geneId = filteredArgs[1];
let datasetId: string | undefined;
let numReps = 1;
let prettyPrint = true;

// Validate project ID
if (!PROJECT_URLS[projectId]) {
  console.error(`Invalid ProjectID: ${projectId}`);
  console.error('Valid ProjectIDs are:', Object.keys(PROJECT_URLS).join(', '));
  process.exit(1);
}

// Parse remaining optional arguments
if (filteredArgs.length > 2) datasetId = filteredArgs[2];
if (filteredArgs.length > 3) numReps = Number(filteredArgs[3]);
if (filteredArgs.length > 4) prettyPrint = Boolean(filteredArgs[4]);

// Get URLs for the specified project
const { serverUrl, geneBaseUrl, serviceBaseUrl } = PROJECT_URLS[projectId];

console.log(`Using ${useAnthropic ? 'Claude' : 'OpenAI'} API`);

const openaiModelId = "gpt-4o-2024-11-20";
// "gpt-4o-2024-11-20";
// "gpt-4o-2024-08-06"

const anthropicModelId = "claude-sonnet-4-20250514";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in your environment
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // Ensure this is set in your environment
});

// use sleep to throttle requests
// max 5,000 requests per minute, and 800,000 tokens per minute
// const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// const sleepTime = 500; // a complete guess

interface SummariseExpressionArgs {
  geneId: string;
  projectId: string;
  serviceBaseUrl: string;
  serverUrl: string;
  geneBaseUrl: string;
  datasetId?: string;
  rep?: number;
  prettyPrint?: boolean;
  useAnthropic?: boolean;
}

const SYSTEM_MESSAGE = "You are a bioinformatician working for VEuPathDB.org. You are an expert at providing biologist-friendly summaries of transcriptomic data.";

function getIndividualResponseSchemaDescription(): string {
  return `

REQUIRED JSON SCHEMA:
{
  "one_sentence_summary": "string - one sentence summary of gene expression",
  "biological_importance": "integer - biological importance score 0-5",
  "confidence": "integer - confidence score 0-5", 
  "experiment_keywords": ["array", "of", "strings"],
  "notes": "optional string - any additional notes"
}`;
}

function getSummaryResponseSchemaDescription(): string {
  return `

REQUIRED JSON SCHEMA:
{
  "headline": "string - specific headline for the summary",
  "one_paragraph_summary": "string - ~100 word paragraph summary",
  "topics": [
    {
      "headline": "string - topic headline",
      "one_sentence_summary": "string - topic summary",
      "dataset_ids": ["array", "of", "dataset_id", "strings"]
    }
  ]
}`;
}

type SummariseExpressionReturnType = Promise<void>; // returns nothing at the moment


export function getExperimentMessage(experiment: any, prettyPrint = false): string {
  const json = JSON.stringify(experiment, null, prettyPrint ? 2 : 0);

  return (
    "The JSON below contains expression data for a single gene within a specific experiment, along with relevant experimental and bioinformatics metadata:\n\n" +
    "```json\n" + json + "\n```\n\n" +
    "**Task**: In one sentence, summarize how this gene is expressed in the given experiment. Do not describe the experiment itself—focus on whether the gene is, or is not, substantially and/or significantly upregulated or downregulated with respect to the experimental conditions tested. Take extreme care to assert the correct directionality of the response, especially in experiments with only one or two samples. Additionally, estimate the biological importance of this profile relative to other experiments on an integer scale of 0 (lowest, no differential expression) to 5 (highest, marked differential expression), even though specific comparative data has not been included. Also estimate your confidence (also 0 to 5) in making the estimate and add optional notes if there are peculiarities or caveats that may aid interpretation and further analysis. Finally, provide some general experiment-based keywords that provide a bit more context to the gene-based expression summary.\n" +
    "**Purpose**: The one-sentence summary will be displayed to users in tabular form on our gene-page. Please wrap user-facing species names in `<i>` tags and use clear, scientific language accessible to non-native English speakers. The notes, scores, and keywords will not be shown to users, but will be passed along with the summary to a second AI summarization step that synthesizes insights from multiple experiments.\n" +
    "**Further guidance**: The `y_axis` field describes the `value` field in the `data` array, which is the primary expression level datum. Note that standard error statistics are only available when biological replicates were performed. However, percentile-normalized values can also guide your assessment of importance. If this is a time-series experiment, consider if it is cyclical and assess periodicity as appropriate. Ignore all discussion of individual or groups of genes in the experiment `description`, as this is irrelevant to the gene you are summarizing. For RNA-Seq experiments, be aware that if `paralog_number` is high, interpretation may be tricky (consider both unique and non-unique counts if available). Ensure that each key appears exactly once in the JSON response. Do not include any duplicate fields."
  );
}


export function getFinalSummaryMessage(experiments: any[], prettyPrint = false): string {

  // remove things we're not passing to second level in the Java port at the moment.
  //const stripped = experiments.map((experiment) => omit(experiment, [ 'assay_type', 'display_name' ]));
  //const json = JSON.stringify(stripped, null, prettyPrint ? 2 : 0);

  const json = JSON.stringify(experiments, null, prettyPrint ? 2 : 0);
  
  return (
    "Below are AI-generated summaries of one gene's behavior in all the transcriptomics experiments available in VEuPathDB, provided in JSON format:\n\n" +
    "```json\n" + json + "\n```\n\n" +
    "Generate a one-paragraph summary (~100 words) describing the gene's expression. Structure it using <strong>, <ul>, and <li> tags with no attributes. If relevant, briefly speculate on the gene's potential function, but only if justified by the data. Also, generate a short, specific headline for the summary. The headline must reflect this gene's expression and **must not** include generic phrases like \"comprehensive insights into\" or the word \"gene\".\n\n" +
    "Additionally, group the per-experiment summaries (identified by `dataset_id`) with `biological_importance > 3` and `confidence > 3` into sections by topic. For each topic, provide:\n" +
    "- A headline summarizing the key experimental results within the topic\n" +
    "- A concise one-sentence summary of the topic's experimental results\n\n" +
    "These topics will be displayed to users. In all generated text, wrap species names in `<i>` tags and use clear, precise scientific language accessible to non-native English speakers."
  );
}


async function summariseExpression(
  { geneId, projectId, serviceBaseUrl, serverUrl, geneBaseUrl, datasetId, rep = 1, prettyPrint = false, useAnthropic = false } : SummariseExpressionArgs
) : SummariseExpressionReturnType {
  
  const modelSuffix = useAnthropic ? 'Claude' : 'OpenAI'; 
  
  const postData = {
    ...expressionDataRequestPostData,
    primaryKey: [
      {
	"name": "source_id",
	"value": geneId
      },
      {
	"name": "project_id",
	"value": projectId
      }
    ]
  };

  let sum_costs = 0;
  let num_costs = 0;
  
  try {
    const response = await axios.post(`${serviceBaseUrl}/record-types/gene/records`, postData);
    const {
      tables : {
	ExpressionGraphs : expressionGraphs,
	ExpressionGraphsDataTable : expressionGraphsDataTable
      }
    } = response.data;

    const individualResults : FullIndividualResponseType[] = [];
    const individualErrors : {
      dataset_id : string,
      error : any
    }[] = [];
    
    for (const expressionGraph of expressionGraphs) {
      const { dataset_id, assay_type, display_name : experiment_name } = expressionGraph;

      // single dataset mode:
      if (datasetId && dataset_id !== datasetId) continue;
      
      const experimentInfo =
	pick(expressionGraph, [
	  'y_axis', 'description', 'genus_species', 'project_id', 'summary',
	  'assay_type', 'x_axis', 'module', 'dataset_name', 'display_name', 'short_attribution', 'paralog_number'
	]);

      const experimentInfoWithData = {
	...experimentInfo,
	data: expressionGraphsDataTable.filter(
	  (entry : { sample_name: string, dataset_id : string }) =>
	    dataset_id == entry.dataset_id // && !entry.sample_name.match("antisense")
	).map(
	  (entry : Record<string, string>) =>
	    pick(entry, [
	      'sample_name',
	      'value',
	      'standard_error',
	      'percentile_channel1',
	      'percentile_channel2'
	    ])
	)
      };
	  
      console.log(`Summarising '${experiment_name}' (${dataset_id})`)
      
      try {
	// Note that the LLM will not get the `geneId`. This is intentional.
	let completion: any;
	let rawResponse: string | null = null;
	let usage: any = null;

	if (useAnthropic) {
	  const anthropicCompletion = await anthropic.messages.create({
	    model: anthropicModelId,
	    max_tokens: 1000,
	    system: SYSTEM_MESSAGE,
	    messages: [
	      {
	        role: "user",
	        content: getExperimentMessage(experimentInfoWithData, prettyPrint) + getIndividualResponseSchemaDescription() + "\n\nPlease respond with valid JSON matching the required schema exactly.",
	      },
	    ],
	  });
	  let claudeResponse = anthropicCompletion.content[0].type === 'text' ? anthropicCompletion.content[0].text : null;
	  // Strip markdown code blocks if present
	  if (claudeResponse?.startsWith('```json')) {
	    claudeResponse = claudeResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
	  } else if (claudeResponse?.startsWith('```')) {
	    claudeResponse = claudeResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
	  }
	  rawResponse = claudeResponse;
	  usage = anthropicCompletion.usage;
	} else {
	  completion = await openai.chat.completions.create({
	    model: openaiModelId,
	    messages: [
	      {
	        role: "system",
	        content: SYSTEM_MESSAGE
	      },
	      {
	        role: "user",
	        content: getExperimentMessage(experimentInfoWithData, prettyPrint),
	      },
	    ],
	    response_format: zodResponseFormat(individualResponseSchema, 'individual_response')
	  });
	  rawResponse = completion.choices[0].message.content;
	  usage = completion.usage;
	}

	// rawResponse is already set above

	if (rawResponse) {
	  try {
	    const parsedResponse = JSON.parse(rawResponse); // make an object
	    const individualResponse = individualResponseSchema.parse(parsedResponse);
	    const fullIndividualResponse : FullIndividualResponseType = {
	      ...individualResponse,
	      dataset_id,
	      assay_type,
	      experiment_name,
	    };

	    individualResults.push(fullIndividualResponse); // SUCCESS!
	    
	    if (useAnthropic) {
	      console.log(`input_tokens: ${usage?.input_tokens}, output_tokens: ${usage?.output_tokens}`);
	      // Anthropic pricing: $3/1M input tokens, $15/1M output tokens for Claude 4 Sonnet
	      const cost = ((usage?.input_tokens ?? 0)*3 + (usage?.output_tokens ?? 0)*15)/1000000;
	      console.log(`cost: ${cost}`);
	      sum_costs += cost;
	      num_costs++;
	    } else {
	      console.log(`total_tokens: ${usage?.total_tokens}`);
	      // OpenAI pricing for gpt-4o: $2.50/1M input, $10.00/1M output tokens
	      const cost = ((usage?.prompt_tokens ?? 0)*2.50 + (usage?.completion_tokens ?? 0)*10.00)/1000000;
	      console.log(`cost: ${cost}`);
	      sum_costs += cost;
	      num_costs++;
	      console.log(`finish_reason: ${completion.choices[0].finish_reason}`);
	    }
	  } catch (error) {
	    console.error("Response validation failed. Full report at end.");
	    if (useAnthropic) {
	      console.error("Raw Claude response:", rawResponse?.substring(0, 500) + "...");
	    }
	    individualErrors.push({ dataset_id, error });
	  }
	} else {
	  console.error(`Empty response. Full report at end.`);
	  individualErrors.push({ dataset_id, error: "empty response from model"});
	}
      } catch (error) {
	console.error("Error generating completion. Full report at end.");
	individualErrors.push({ dataset_id, error });
      }
    }

    if (individualErrors.length > 0) {
      console.error(
	"Some experiments failed to summarise. Not continuing to summary-of-summaries. Here is what happened:\n\n",
	JSON.stringify(individualErrors, null, 2)
      );
      process.exit(42);
    }

    const sortedIndividualResults = orderBy(individualResults, ['biological_importance', 'confidence'], ['desc', 'desc']);

    // write a pretty version to file, just for reference
    await writeToFile(
      `example-output/${geneId}.${rep.toString().padStart(2, "0")}.${modelSuffix}.summaries.json`,
      JSON.stringify(sortedIndividualResults, null, 2)
    );

    if (datasetId) return;
    
    console.log("Summarising the summaries...");
    
    try {
      // Note that the LLM will not get the `geneId`. This is intentional.
      let completion: any;
      let rawResponse: string | null = null;
      let usage: any = null;

      if (useAnthropic) {
        const anthropicCompletion = await anthropic.messages.create({
          model: anthropicModelId,
          max_tokens: 2000,
          system: SYSTEM_MESSAGE,
          messages: [
            {
              role: "user",
              content: getFinalSummaryMessage(sortedIndividualResults, prettyPrint) + getSummaryResponseSchemaDescription() + "\n\nPlease respond with valid JSON matching the required schema exactly.",
            },
          ],
        });
        let claudeResponse = anthropicCompletion.content[0].type === 'text' ? anthropicCompletion.content[0].text : null;
        // Strip markdown code blocks if present
        if (claudeResponse?.startsWith('```json')) {
          claudeResponse = claudeResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (claudeResponse?.startsWith('```')) {
          claudeResponse = claudeResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        rawResponse = claudeResponse;
        usage = anthropicCompletion.usage;
      } else {
        completion = await openai.chat.completions.create({
          model: openaiModelId,
          messages: [
            {
              role: "system",
              content: SYSTEM_MESSAGE
            },
            {
              role: "user",
              content: getFinalSummaryMessage(sortedIndividualResults, prettyPrint),
            },
          ],
          response_format: zodResponseFormat(summaryResponseSchema, 'summary_response')
        });
        rawResponse = completion.choices[0].message.content;
        usage = completion.usage;
      }

      // rawResponse is already set above

      if (rawResponse) {
	try {
	  const parsedResponse = JSON.parse(rawResponse); // make an object
	  const summaryResponse = summaryResponseSchema.parse(parsedResponse);

	  // write a pretty version to file, just for reference
	  await writeToFile(`example-output/${geneId}.${rep.toString().padStart(2, "0")}.${modelSuffix}.summary.json`, JSON.stringify(summaryResponse, null, 2));

	  // remove any duplicates and add an "Others" topic if any were missed
	  const summary = consolidateSummary(summaryResponse, sortedIndividualResults);
	  
	  const html = summaryJSONtoHTML(summary, geneId, sortedIndividualResults, expressionGraphs, serverUrl, geneBaseUrl);
	  await writeToFile(`example-output/${geneId}.${rep.toString().padStart(2, "0")}.${modelSuffix}.summary.html`, html);
	  
	  if (useAnthropic) {
	    console.log(`input_tokens: ${usage?.input_tokens}, output_tokens: ${usage?.output_tokens}`);
	    // Anthropic pricing: $3/1M input tokens, $15/1M output tokens for Claude 4 Sonnet
	    const cost = ((usage?.input_tokens ?? 0)*3 + (usage?.output_tokens ?? 0)*15)/1000000;
	    console.log(`cost: ${cost}`);
	  } else {
	    console.log(`total_tokens: ${usage?.total_tokens}`);
	    const cost = ((usage?.prompt_tokens ?? 0)*250 + (usage?.completion_tokens ?? 0)*1000)/1000000;
	    console.log(`cost: ${cost}`);
	    console.log(`finish_reason: ${completion.choices[0].finish_reason}`);
	  }
	} catch (error) {
	  console.error("Error in parsing response: ", error);
	}
      } else {
	console.error("Error: empty response from final summarisation step.");
      }
    } catch (error) {
      console.error("Summarisation error: ", error);
    } 
  } catch (error) {
    console.error("Error fetching or processing data for ${dataset_id}:", error);
  }

  const mean_expt_cost = sum_costs / num_costs;
  console.log(`mean_cost: ${mean_expt_cost}`);

}

for (let rep = 1; rep <= numReps; rep++) {
  summariseExpression({ geneId, projectId, serviceBaseUrl, serverUrl, geneBaseUrl, datasetId, rep, prettyPrint, useAnthropic });
}
