import OpenAI from "openai";
import "dotenv/config";
import { expressionDataRequestPostData } from "./post-templates/expression_data_request";
import axios from "axios";
import { omit, pick } from "lodash";
import { FullIndividualResponseType, individualResponseSchema, summaryResponseSchema } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";
import { consolidateSummary, summaryJSONtoHTML, writeToFile } from "./utils";

//
// yarn build && yarn start PF3D7_0616000
//
// or
//
// yarn start PF3D7_0716300 DS_87e4fcafff 10
//
// which will run 10 replicates of a single experiment and make numbered output files
// * it will NOT run the summary-of-summaries
// * these run in parallel asynchronously - not sure if client retries if hitting the rate-limit
//

const args = process.argv.slice(2); // Skip the first two entries
const geneId = args[0];
const datasetId = args[1];
const numReps = args[2] ? Number(args[2]) : 1;

const modelId = "gpt-4o-2024-11-20"; //  "gpt-4o-2024-08-06"

// these could be ENV vars or commandline args in future
const projectId = 'PlasmoDB';
const serverUrl = 'https://plasmodb.org';
const geneBaseUrl = 'https://plasmodb.org/plasmo/app/record/gene';
const serviceBaseUrl = 'https://plasmodb.org/plasmo/service';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in your environment
});

// use sleep to throttle requests
// max 5,000 requests per minute, and 800,000 tokens per minute
// const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// const sleepTime = 500; // a complete guess

interface SummariseExpressionArgs {
  geneId: string;
  projectId: string;
  serviceBaseUrl: string;
  datasetId?: string;
  rep?: number;
  prettyPrint?: boolean;
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
  const stripped = experiments.map((experiment) => omit(experiment, [ 'assay_type', 'display_name' ]));
  const json = JSON.stringify(stripped, null, prettyPrint ? 2 : 0);

  // const json = JSON.stringify(experiments, null, prettyPrint ? 2 : 0);
  
  return (
    "Below are AI-generated summaries of one gene's behavior in all the transcriptomics experiments available in VEuPathDB, provided in JSON format:\n\n" +
    "```json\n" + json + "\n```\n\n" +
    "Generate a one-paragraph summary (~100 words) describing the gene's expression. Structure it using <strong>, <ul>, and <li> tags with no attributes. If relevant, briefly speculate on the gene's potential function, but only if justified by the data. Also, generate a short, specific headline for the summary. The headline must reflect this gene's expression and **must not** include generic phrases like \"comprehensive insights into\" or the word \"gene\".\n\n" +
    "Additionally, organize the experimental results (identified by `dataset_id`) into sections, ordered by descending biological importance. For each section, provide:\n" +
    "- A headline summarizing the section's key findings\n" +
    "- A concise one-sentence summary of the experimental results\n\n" +
    "These sections will be displayed to users. In all generated text, wrap species names in `<i>` tags and use clear, precise scientific language accessible to non-native English speakers."
  );
}


async function summariseExpression(
  { geneId, projectId, serviceBaseUrl, datasetId, rep = 1, prettyPrint = false } : SummariseExpressionArgs
) : SummariseExpressionReturnType { 
  
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
      const { dataset_id, assay_type, display_name } = expressionGraph;

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
	  
      console.log(`Summarising '${experimentInfo['display_name']}' (${dataset_id})`)
      
      try {
	// Note that the LLM will not get the `geneId`. This is intentional.
	const completion = await openai.chat.completions.create({
	  model: modelId,
	  messages: [
	    {
	      role: "system",
	      content: "You are a bioinformatician working for VEuPathDB.org. You are an expert at providing biologist-friendly summaries of transcriptomic data."
	    },
	    {
	      role: "user",
	      content: getExperimentMessage(experimentInfoWithData, prettyPrint),
	    },
	  ],
	  response_format: zodResponseFormat(individualResponseSchema, 'individual_response')
	});

	const rawResponse = completion.choices[0].message.content; // Raw text response

	if (rawResponse) {
	  try {
	    const parsedResponse = JSON.parse(rawResponse); // make an object
	    const individualResponse = individualResponseSchema.parse(parsedResponse);
	    const fullIndividualResponse : FullIndividualResponseType = {
	      ...individualResponse,
	      dataset_id,
	      assay_type,
	      display_name,
	    };

	    individualResults.push(fullIndividualResponse); // SUCCESS!
	    console.log(`total_tokens: ${completion.usage?.total_tokens}`);
	  } catch (error) {
	    console.error("Response validation failed. Full report at end.");
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

    // write a pretty version to file, just for reference
    await writeToFile(
      `example-output/${geneId}.${rep.toString().padStart(2, "0")}.summaries.json`,
      JSON.stringify(individualResults, null, 2)
    );

    if (individualErrors.length > 0) {
      console.error(
	"Some experiments failed to summarise. Not continuing to summary-of-summaries. Here is what happened:\n\n",
	JSON.stringify(individualErrors, null, 2)
      );
      process.exit(42);
    }


    if (datasetId) return;
    
    console.log("Summarising the summaries...");

    try {
      // Note that the LLM will not get the `geneId`. This is intentional.
      const completion = await openai.chat.completions.create({
	model: modelId,
	messages: [
	  {
	    role: "system",
	    content: "You are a bioinformatician working for VEuPathDB.org. You are an expert at providing biologist-friendly summaries of transcriptomic data."
	  },
	  {
	    role: "user",
	    content: getFinalSummaryMessage(individualResults, prettyPrint),
	  },
	],
	response_format: zodResponseFormat(summaryResponseSchema, 'summary_response')
      });

      const rawResponse = completion.choices[0].message.content; // Raw text response

      if (rawResponse) {
	try {
	  const parsedResponse = JSON.parse(rawResponse); // make an object
	  const summaryResponse = summaryResponseSchema.parse(parsedResponse);

	  // write a pretty version to file, just for reference
	  await writeToFile(`example-output/${geneId}.summary.json`, JSON.stringify(summaryResponse, null, 2));

	  // remove any duplicates and add an "Others" section if any were missed
	  const summary = consolidateSummary(summaryResponse, individualResults);
	  
	  const html = summaryJSONtoHTML(summary, geneId, individualResults, expressionGraphs, serverUrl, geneBaseUrl);
	  await writeToFile(`example-output/${geneId}.${rep.toString().padStart(2, "0")}.summary.html`, html);
	  console.log(`total_tokens: ${completion.usage?.total_tokens}`);
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
}


const prettyPrint = true;
for (let rep = 1; rep <= numReps; rep++) {
  summariseExpression({ geneId, projectId, serviceBaseUrl, datasetId, rep, prettyPrint });
}
