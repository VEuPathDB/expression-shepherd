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
    datasetId: string;
    assayType: string;
  };
