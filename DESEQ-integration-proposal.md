# Proposed Four-Stage Gene Expression Summarisation Pipeline

The current two-stage pipeline (per-experiment AI summary → summary-of-summaries) works well but relies solely on normalised expression values and percentiles. We propose inserting two new steps between the existing stages: an AI-driven experiment and contrast selection step, followed by a DESeq2 enrichment step.

## Stage 1 — Per-experiment summaries *(existing)*
- Fetch expression data for all experiments for a given gene
- AI summarises each experiment individually, producing: one-sentence summary, biological importance score (0–5), confidence score (0–5), keywords, notes
- All experiment types supported (RNA-seq & microarray)

## Stage 2 — Experiment and contrast selection *(new)*
- AI reviews all Stage 1 summaries and selects 3–5 RNA-seq experiments most worthy of deeper statistical analysis (based on biological importance and confidence scores)
- For each selected experiment, the AI formulates one or more contrasts in natural language (e.g. *"quantify differential expression between timepoints 24h and 48h"*), informed by the sample metadata and experimental context already present in the Stage 1 data
- Each natural language contrast is then resolved into a concrete, structured contrast definition (variable + value pairs) via a short, bounded sequence of tool calls against the DESeq2 service's metadata endpoints — keeping the DESeq2 service itself deterministic and AI-free (see [Appendix A](#appendix-a--stage-2-contrast-resolution-tool-calls))
- Output: a structured list of `(dataset_id, contrast_definition)` pairs ready for deterministic DESeq2 execution

## DESeq2 enrichment *(new service call, parallel)*
- For each resolved `(dataset_id, contrast_definition)` pair, call the deterministic, AI-free DESeq2 service, which runs DESeq2 and returns per-contrast statistics for the gene of interest: log2 fold-change, adjusted p-value (FDR), base mean expression, and genome-wide effect-size percentile rank — the latter provides crucial context for interpreting whether a given fold-change is large or modest relative to all other genes in the same contrast, as Freyja's examples have shown
- Results are merged back into the relevant Stage 1 summary objects
- Runs in parallel; non-selected experiments are unaffected
- Runs are cached if the same contrasts are requested for other genes

## Stage 3 — Summary-of-summaries *(existing, enhanced)*
- AI synthesises all Stage 1 summaries (a subset now DESeq2-enriched) into a headline, one-paragraph overview, and grouped topic sections
- Updated prompt instructs the AI to weight DESeq2-enriched summaries more heavily and to include an overall confidence assessment of the final summary, explicitly referencing where statistically rigorous evidence (fold-change, FDR) supports or qualifies the conclusions
- Graceful degradation: if DESeq2 fails for any experiment, the Stage 1 summary is used as-is

---

```
Gene ID + Project
      │
      ▼
┌─────────────────────────────────┐
│  Stage 1: Per-experiment LLM    │
│  summary (all experiment types) │
└─────────────────┬───────────────┘
                  │  scores + summaries (all experiments)
                  ▼
┌─────────────────────────────────┐
│  Stage 2: LLM selects 3-5       │
│  RNA-seq experiments + resolves │
│  contrasts (see Appendix A)     │
└─────────────────┬───────────────┘
                  │  [(dataset_id, {variable=value pairs}), ...]
                  ▼
┌─────────────────────────────────┐
│  DESeq2 service (parallel,      │
│  AI-free): runs DESeq2,         │
│  returns log2FC + FDR per gene  │
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
- Contrast selection is delegated to the AI (Stage 2), which already has full experimental context from Stage 1 — no manual configuration required
- Natural language contrast formulation is translated into concrete variable + value pairs within Stage 2 via a bounded tool-call sequence, keeping the DESeq2 service deterministic and AI-free (separation of concerns, API key management, usage monitoring)
- DESeq2 enrichment is strictly opt-in per experiment: only RNA-seq datasets selected by the AI are processed
- The Stage 3 prompt is updated to incorporate a confidence assessment, giving end users a sense of how well the summary is supported by rigorous statistics
- Graceful degradation at every step: failures in Stage 2 or the DESeq2 service fall back to the existing two-stage output

## Open Questions
- **Caching**: the existing cache (in the production web implementation) already tolerates non-deterministic LLM outputs (Stage 2 in the old pipeline was cached on its LLM-derived inputs), so introducing Stage 2 contrast selection does not break the caching model. A real, but more minor, issue is that DESeq2 results depend on sample annotation data that sits outside the existing cache invalidation chain — if sample annotations were updated, cached Stage 1 enrichments would not be automatically invalidated. This is considered acceptable for now, as sample annotations change infrequently.

---

## Appendix A — Stage 2 contrast resolution tool calls

To translate each natural language contrast into a structured DESeq2 request without embedding AI logic in the DESeq2 service, Stage 2 executes a short, bounded sequence of tool calls — not an open-ended agentic loop:

1. **Fetch available sample annotation variables and sample counts** for the selected dataset
2. **Fetch the value distribution** for the variable(s) of interest
3. **LLM composes the contrast definition** in terms of concrete variable + value pairs (categorical: select groups; continuous: define two ranges)
4. **Send the resulting deterministic DESeq2 request**
