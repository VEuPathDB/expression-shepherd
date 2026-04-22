# Proposed Four-Stage Gene Expression Summarisation Pipeline

The current two-stage pipeline (per-experiment AI summary → summary-of-summaries) works well but relies solely on normalised expression values and percentiles. We propose inserting two new steps between the existing stages: a contrast elucidation step, followed by DESeq2 enrichment via the EDA service.

## Stage 1 — Per-experiment summaries *(existing)*
- Fetch expression data for all experiments for a given gene
- AI summarises each experiment individually, producing: one-sentence summary, biological importance score (0–5), confidence score (0–5), keywords, notes
- All experiment types supported (RNA-seq & microarray)

## Stage 2 — Contrast elucidation *(new, parallel across all RNA-seq datasets)*
- For every RNA-seq dataset associated with the gene, run a short, bounded sequence of tool calls against the EDA service to determine whether DESeq2 is feasible and, if so, which contrast(s) to run (see [Appendix A](#appendix-a--stage-2-contrast-elucidation-tool-calls)); the EDA service distinguishes RNA-seq from microarray, so non-RNA-seq datasets are skipped without a tool call
- Each elucidation uses the individual Stage 1 summary for that dataset as context, so per-gene expression patterns (e.g. a peak at 3h rather than 24h in a time course) inform which contrast is most informative
- The tool call chain bails out as soon as it becomes clear that DESeq2 is not feasible — for example, if there are insufficient replicates for any meaningful grouping
- Output: a list of `(dataset_id, contrast_definition)` pairs, where each contrast definition is expressed as concrete variable + value pairs ready for deterministic DESeq2 execution

## DESeq2 enrichment via EDA service *(new, parallel)*
- For each `(dataset_id, contrast_definition)` pair produced by Stage 2, submit a DESeq2 computation to the EDA service (`/computes/differentialexpression`), which returns per-contrast statistics for the gene of interest: log2 fold-change, adjusted p-value (FDR), base mean expression, and genome-wide effect-size percentile rank — the latter provides crucial context for interpreting whether a given fold-change is large or modest relative to all other genes in the same contrast, as Freyja's examples have shown
- **Note**: the `/computes/differentialexpression` endpoint will need to be updated to expose the effect-size percentile rank outputs that this pipeline requires
- Per-gene statistics are retrieved via the `/apps/differentialexpression/visualizations/volcanoplot` endpoint, which currently returns data for all genes in the contrast (~5,000 for parasite species, ~13,000 for insect vectors). Since this pipeline only ever needs one gene's row per call, and calls run in parallel across all eligible datasets, fetching the full payload each time is substantially wasteful. We should add a gene filter argument to the volcanoplot endpoint so that the EDA service returns only the row(s) of interest
- Results are merged back into the relevant Stage 1 summary objects
- Runs in parallel; datasets for which Stage 2 bailed out are unaffected
- The EDA service caches computations by contrast configuration, so subsequent queries for the same contrast (e.g. for a different gene) are returned immediately

## Stage 3 — Summary-of-summaries *(existing, enhanced)*
- AI synthesises all Stage 1 summaries (a subset now DESeq2-enriched) into a headline, one-paragraph overview, and grouped topic sections
- Updated prompt instructs the AI to weight DESeq2-enriched summaries more heavily and to include an overall confidence assessment of the final summary, explicitly referencing where statistically rigorous evidence (fold-change, FDR) supports or qualifies the conclusions
- Graceful degradation: if DESeq2 enrichment fails for any experiment, the Stage 1 summary is used as-is

---

```
Gene ID + Project
      │
      ▼
┌─────────────────────────────────┐
│  Stage 1: Per-experiment LLM    │
│  summary (all experiment types) │
└─────────────────┬───────────────┘
                  │  individual summaries (all experiments)
                  ▼
┌─────────────────────────────────┐
│  Stage 2: Contrast elucidation  │
│  via EDA service tool calls     │
│  (parallel, all RNA-seq         │
│  datasets; see Appendix A)      │
└─────────────────┬───────────────┘
                  │  [(dataset_id, {variable=value pairs}), ...]
                  │  (infeasible datasets dropped)
                  ▼
┌─────────────────────────────────┐
│  EDA service DESeq2 (parallel,  │
│  AI-free): returns log2FC, FDR, │
│  effect-size percentile/gene    │
└─────────────────┬───────────────┘
                  │  enriched summaries merged back
                  ▼
┌─────────────────────────────────┐
│  Stage 3: Summary-of-summaries  │
│  LLM → headline + paragraph +   │
│  topics + overall confidence    │
└─────────────────────────────────┘
              │
              ▼
        HTML + JSON output
```

---

## Key design decisions
- Contrast elucidation runs for all RNA-seq datasets rather than a curated subset — feasibility is determined automatically by the tool call chain, not by LLM judgement of biological importance
- Each elucidation is informed by the per-gene Stage 1 summary for that dataset, ensuring that gene-specific expression patterns guide contrast selection
- Natural language contrast reasoning is translated into concrete variable + value pairs within Stage 2, keeping the EDA service's DESeq2 endpoint deterministic and AI-free (separation of concerns, API key management, usage monitoring)
- The Stage 3 prompt is updated to incorporate a confidence assessment, giving end users a sense of how well the summary is supported by rigorous statistics
- Graceful degradation at every step: failures in Stage 2 or the EDA service fall back to the existing two-stage output

## Open Questions
- **Caching**: the existing cache (in the production web implementation) already tolerates non-deterministic LLM outputs, so introducing Stage 2 contrast elucidation does not break the caching model. The EDA service caches DESeq2 computations by contrast configuration, which handles cross-gene re-use well. A residual risk is that EDA service results depend on sample annotation data that sits outside the pipeline's cache invalidation chain — if sample annotations were updated, cached enrichments would not be automatically invalidated. This is considered acceptable for now, as sample annotations change infrequently. The main unknown is how many distinct contrasts the LLM will generate across different genes for the same dataset; high contrast diversity would limit cache re-use and increase EDA service load.

---

## Appendix A — Stage 2 contrast elucidation tool calls

To translate each per-dataset natural language contrast into a structured DESeq2 request without embedding AI logic in the EDA service, Stage 2 executes a short, bounded sequence of tool calls — not an open-ended agentic loop. The chain bails out at any step if DESeq2 is determined to be infeasible.

**EDA service endpoints used:**

| Endpoint | Purpose |
|---|---|
| `GET /studies/<study_id>` | Fetch entities, variables, vocabularies or numeric ranges, and recommended bin widths |
| `GET /studies/<study_id>/entities/<entity_id>/variables/<variable_id>/distribution` | Get sample counts per variable value (categorical) or bin (continuous) |
| `POST /computes/differentialexpression` | Submit or poll a DESeq2 computation; payload includes study ID and contrast definition |
| `POST /apps/differentialexpression/visualizations/volcanoplot` | Retrieve volcano plot data for a completed computation (identified by the same contrast configuration) |

**Tool call sequence per dataset:**

1. **Fetch study metadata** (`GET /studies/<study_id>`) — identify candidate grouping variables (conditions, timepoints, treatments, etc.) and their types
2. **Fetch value distributions** (`GET .../distribution`) for the variable(s) of interest — check sample counts per group to assess whether sufficient replicates exist for a meaningful contrast; bail out if not
3. **LLM composes the contrast definition** using the Stage 1 summary as context — selects groups for categorical variables or defines two ranges for continuous variables; produces a structured contrast payload
4. **Submit the DESeq2 computation** (`POST /computes/differentialexpression`) and poll until complete
