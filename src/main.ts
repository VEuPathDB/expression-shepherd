import OpenAI from "openai";
import "dotenv/config";
import { expressionDataRequestPostData } from "./post-templates/expression_data_request";
import axios from "axios";
import { pick } from "lodash";
import { FullIndividualResponseType, individualResponseSchema, summaryResponseSchema } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";
import { summaryJSONtoHTML, writeToFile } from "./utils";

//
// yarn build && yarn start PF3D7_0616000
//

const args = process.argv.slice(2); // Skip the first two entries
const geneId = args[0];

// these could be ENV vars or commandline args in future
const projectId = 'PlasmoDB';
const serverUrl = 'https://plasmodb.org';
const serviceBaseUrl = 'https://plasmodb.org/plasmo/service';


console.log(`Going to work on ${projectId} gene ${geneId}...`);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in your environment
});

// use sleep to throttle requests
// max 5,000 requests per minute, and 800,000 tokens per minute
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepTime = 500; // a complete guess

interface SummariseExpressionArgs {
  geneId: string;
  projectId: string;
  serviceBaseUrl: string;
}

type SummariseExpressionReturnType = Promise<void>; // returns nothing at the moment

async function summariseExpression(
  { geneId, projectId, serviceBaseUrl } : SummariseExpressionArgs
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
      const experimentInfo =
	pick(expressionGraph, [
	  'y_axis', 'description', 'genus_species', 'project_id', 'summary',
	  'assay_type', 'x_axis', 'module', 'dataset_name', 'display_name', 'short_attribution', 'paralog_number'
	]);

      const experimentInfoWithData = {
	...experimentInfo,
	data: expressionGraphsDataTable.filter(
	  (entry : { dataset_id : string }) => dataset_id == entry.dataset_id
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
	  model: "gpt-4o",
	  messages: [
	    {
	      role: "system",
	      content: "You are a bioinformatician working for VEuPathDB.org. You are an expert at providing biologist-friendly summaries of transcriptomic data."
	    },
	    {
	      role: "user",
	      content: [
		"Below is information about the expression of one gene in one experiment, provided in JSON format.",
		"```json",
		JSON.stringify(experimentInfoWithData), // not pretty on purpose to save tokens
		"```",
		"Provide a one-sentence summary of this gene's expression profile based on the provided data. Additionally, estimate the biological relevance of this profile relative to other experiments, even though specific comparative data has not been included. Also estimate your confidence in making the estimate and add optional notes if there are peculiarities or caveats that may aid interpretation and further analysis. Provide up to five keywords to describe the experimental aims and design.",
		"Purpose: The one-sentence summary will be displayed to users in tabular form on our gene-page. Please wrap any species names in HTML italics tags in this summary. The notes and other information you provide will not be shown to users, but will be passed along with the summary to a second AI summarisation step that synthesizes insights from multiple experiments.",
		"Further guidance: Note that standard error statistics may not always be available. However, percentile-normalized values can guide your analysis. Genes with high `paralog_number` tend to have low unique counts and high non-unique counts in RNA-Seq experiments, making interpretation harder. Sample names are not always very informative. Please do your best deciphering them!"
	      ].join("\n")
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
      await sleep(sleepTime); // throttling
    }

    // write a pretty version to file, just for reference
    await writeToFile(`example-output/${geneId}.summaries.json`, JSON.stringify(individualResults, null, 2));

    if (individualErrors.length > 0) {
      console.error(
	"Some experiments failed to summarise. Not continuing to summary-of-summaries. Here is what happened:\n\n",
	JSON.stringify(individualErrors, null, 2)
      );
      process.exit(42);
    }
    
    console.log("Summarising the summaries...");

    const individualResultsJSON = JSON.stringify(individualResults);
    
    try {
      // Note that the LLM will not get the `geneId`. This is intentional.
      const completion = await openai.chat.completions.create({
	model: "gpt-4o",
	messages: [
	  {
	    role: "system",
	    content: "You are a bioinformatician working for VEuPathDB.org. You are an expert at providing biologist-friendly summaries of transcriptomic data."
	  },
	  {
	    role: "user",
	    content: [
	      "Below are AI-generated summaries of a gene's behaviour in multiple transcriptomics experiment, provided in JSON format.",
	      "```json",
	      individualResultsJSON,
	      "```",
	      "Provide a snappy headline and a one-paragraph summary of this gene's expression. Both are for human-consumption on the gene page of our website. Please also group the experimental results (identified by `dataset_id`) into sections using any criteria you deem appropriate. Order the sections with the most salient first, and provide a headline and one-sentence summary for each (also user-facing). Please wrap any user-facing species names in HTML italics tags."
	    ].join("\n")
	  },
	],
	response_format: zodResponseFormat(summaryResponseSchema, 'summary_response')
      });

      const rawResponse = completion.choices[0].message.content; // Raw text response

      if (rawResponse) {
	try {
	  const parsedResponse = JSON.parse(rawResponse); // make an object
	  const summaryResponse = summaryResponseSchema.parse(parsedResponse);

	  const html = summaryJSONtoHTML(summaryResponse, geneId, individualResults, expressionGraphs, serverUrl);
	  await writeToFile(`example-output/${geneId}.summary.html`, html);
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


summariseExpression({ geneId, projectId, serviceBaseUrl });
