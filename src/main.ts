import OpenAI from "openai";
import "dotenv/config";
import { expressionDataRequestPostData } from "./post-templates/expression_data_request";
import axios from "axios";
import { pick } from "lodash";
import { FullIndividualResponseType, individualResponseSchema } from "./types";
import { zodResponseFormat } from "openai/helpers/zod";

//
// yarn build && yarn start PF3D7_0616000
//

const args = process.argv.slice(2); // Skip the first two entries
const geneId = args[0];

// these could be ENV vars or commandline args in future
const projectId = 'PlasmoDB';
const serviceBaseUrl = 'https://plasmodb.org/plasmo/service';


console.log(`Going to work on ${projectId} gene ${geneId}...`);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in your environment
});


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

    // TEMPORARILY JUST DO ONE!
    const individualResults : FullIndividualResponseType[] = await Promise.all(
      expressionGraphs.slice(10,13).map(
	async (expressionGraph : Record<string, string>) => {
	  const { dataset_id : datasetId } = expressionGraph;
	  const experimentInfo =
	    pick(expressionGraph, [
	      'y_axis', 'description', 'genus_species', 'project_id', 'summary',
	      'assay_type', 'x_axis', 'module', 'dataset_name', 'display_name', 'short_attribution'
	    ]);

	  const experimentInfoWithData = {
	    ...experimentInfo,
	    data: expressionGraphsDataTable.filter(
	      ({ dataset_id } : { dataset_id : string }) => dataset_id == datasetId
	    ).map(
	      (entry : Record<string, string>) => pick(entry, [ 'sample_name', 'value', 'standard_error', 'percentile_channel1', 'percentile_channel2' ])
	    )
	  };

	  try {
	    // Note that the LLM will not get the `geneId`. This is intentional.
	    const jsonSummary = JSON.stringify(experimentInfoWithData); // not pretty on purpose to save tokens
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
		    jsonSummary,
		    "```",
		    "Provide a one-sentence summary of this gene's expression profile based on the provided data. Additionally, estimate the biological relevance of this profile relative to other experiments, even though specific comparative data has not been included. Note that standard error statistics may be unavailable, but percentile-normalized values can guide your analysis. Also estimate of your confidence in making the estimate and add optional notes if there are peculiarities or caveats.",
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
		  datasetId
		};

		return(fullIndividualResponse); // SUCCESS! Add to `individualResults` array

	      } catch (error) {
		console.error("Response validation failed:", error);
		return(emptyIndividualResponse(datasetId, error));
	      }
	    } else {
	      console.error(`Empty response from model for ${datasetId}`);
	      return(emptyIndividualResponse(datasetId, "empty response from model"));
	    }
	  } catch (error) {
	    console.error("Error generating completion: for ${datasetId}", error);
	    return(emptyIndividualResponse(datasetId, error));
	  }
	}
      )
    );

    // TEMPORARILY JUST LOG TO TERMINAL
    console.log(JSON.stringify(individualResults, null, 2));
  } catch (error) {
    console.error("Error fetching or processing data for ${datasetId}:", error);
  }
}


summariseExpression({ geneId, projectId, serviceBaseUrl });


export function emptyIndividualResponse(datasetId : string, error: any) : FullIndividualResponseType {
  const errorMessage =
    error instanceof Error // Check if it's an instance of Error
      ? error.message // Use the message property if available
      : typeof error === "string" // If it's a string, use it directly
      ? error
      : "An unknown error occurred"; // Fallback for non-standard errors

  return {
    datasetId,
    one_sentence_summary: "__AN_ERROR_OCCURRED__",
    biological_relevance: "low",
    confidence: "low",
    notes: `Error message: ${errorMessage}`,
  };
}
