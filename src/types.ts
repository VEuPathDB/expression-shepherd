import { z } from "zod";

export const individualResponseSchema = z.object({
  one_sentence_summary: z.string(),
  biological_importance: z.number().int(), // min and max not allowed by openai api?
  confidence: z.number().int(),
  experiment_keywords: z.string().array(),
  notes: z.string().optional(),  
})

// Infer the TypeScript type
export type IndividualResponseType = z.infer<typeof individualResponseSchema>;

export type FullIndividualResponseType =
  IndividualResponseType & {
    dataset_id: string;
    assay_type: string;
    experiment_name: string;
  };


export const summaryResponseSchema = z.object({
  headline: z.string(),
  one_paragraph_summary: z.string(),
  topics: z.array(
    z.object({
      headline: z.string(),
      one_sentence_summary: z.string(),
      dataset_ids: z.string().array()
    })
  )
});
export type SummaryResponseType = z.infer<typeof summaryResponseSchema>;


export type UncorralledSample = {
    fileName: string;
    experiment: string;
    componentDatabase: any;
    speciesAndStrain: any;
    samples: {
        id: string;
        label: string;
    }[];
};

export const corralledSample = z.object({
  id: z.string(),
  annotations: z.array(
    z.object({
      attribute: z.string(),
      value: z.string(),
      unit: z.optional(z.string()),
    })
  )
});
export type CorralledSample = z.infer<typeof corralledSample>;

// expected AI response to summarising 
export const corralledExperimentResponseType = z.object({
  inputQuality: z.number(),
  samples: z.array(corralledSample),
})
export type CorralledExperimentResponseType = z.infer<typeof corralledExperimentResponseType>;


export type RehydratedCorralledSample = CorralledSample & {
  label: string;
};

export type RehydratedCorralExperimentResponseType =
  Omit<CorralledExperimentResponseType, 'samples'> &
  Omit<UncorralledSample, 'samples'> & {
    samples: RehydratedCorralledSample[];
  };


