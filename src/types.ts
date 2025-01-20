import { z } from "zod";

export const individualResponseSchema = z.object({
  one_sentence_summary: z.string(),
  biological_relevance: z.enum(["low", "medium", "high"]),
  confidence: z.enum(["low", "medium", "high"]),
  experiment_keywords: z.string().array(),
  notes: z.string().optional(),  
})

// Infer the TypeScript type
export type IndividualResponseType = z.infer<typeof individualResponseSchema>;

export type FullIndividualResponseType =
  IndividualResponseType & {
    dataset_id: string;
    assay_type: string;
    display_name: string;
  };


export const summaryResponseSchema = z.object({
  headline: z.string(),
  one_paragraph_summary: z.string(),
  sections: z.array(
    z.object({
      headline: z.string(),
      one_sentence_summary: z.string(),
      dataset_ids: z.string().array()
    })
  )
});

export type SummaryResponseType = z.infer<typeof summaryResponseSchema>;
