# Token Usage Estimate: Comparison Pipeline

**Scope:** 20 genes, full pipeline (comparison:fetch → comparison:compare → comparison:condense → comparison:aggregate)

**Accuracy:** ±15% — input estimate anchored on a real comparison call; output estimate confirmed by real data

---

## Model Configuration

The **analysis model** (the model doing the comparing, condensing and aggregating) is read from `comparison/config/sites.json`.
Currently set to: **GPT-5** (`gpt-5-2025-08-07`, platform: `openai`)

The **compared models** (the summaries being evaluated) depends on which sites have `skip: false`.
Current active sites: **claude4_5thinking** + **gpt5** → **1 model pair**
Full 3-model run (if gpt4o re-enabled): **3 model pairs**

Both scenarios are costed below.

---

## Phase 0: comparison:fetch

**AI tokens used: 0**

This phase makes HTTP requests to VEuPathDB dev sites to fetch pre-generated summaries. No AI calls are made by the script itself — the AI work is done server-side by the VEuPathDB backends. Summaries are typically cached, so this is fast.

---

## Phase 2: comparison:compare

### What it does
For each gene × model pair, runs **2 bidirectional AI comparisons** (A→B and B→A) to detect position bias.

### Input token estimate

Each call sends a prompt containing two **simplified summaries** in JSON. The `simplifySummary()` function strips per-experiment details down to just:
- `one_paragraph_summary` (full text, ~120–200 words)
- `headline` (~10–15 words)
- `topics[]` — each with headline + one-sentence summary + **experiment names only** (not the full per-experiment notes)

**Anchored on real data:** The actual token count for AGAP001212 was **5,572 input tokens** (recorded in the comparison JSON's `token_usage` field).

Full summary file sizes for all 20 claude4_5thinking genes were measured (`wc -c`):

| Statistic | Characters |
|-----------|-----------|
| Smallest (AGAP011434) | 57,681 |
| Largest (AGAP001212) | 68,242 |
| **Average** | **61,662** |
| Range / spread | ~18% |

The summaries are remarkably uniform. AGAP001212 is only 10.7% above average, so scaling the known token count gives a tight estimate for the average gene:

> **5,572 × (61,662 / 68,242) ≈ 5,040 tokens** input for the average gene

| Component | Tokens |
|-----------|--------|
| Static prompt text (intro, instructions, notes) | ~450 |
| Summary A (simplified JSON) | ~2,300 |
| Summary B (simplified JSON) | ~2,300 |
| **Total input per call** | **~5,050** |

*Note: simplified summaries are larger than intuitively expected because (a) many experiment names are 15–20+ words long, and (b) HTML markup (`<strong>`, `<ul>`, `<li>`, `<i>`) in the paragraph summary inflates token count beyond raw word count.*

### Output token estimate

The comparison produces:
- `biological_content`: observations (only_in_A, only_in_B, in_both) + insights (same) — typically ~5 items per bucket × 6 buckets × 15 words
- `qualitative_assessment`: 4 dimensions × 3 fields (summary_A, summary_B, comparison) × ~40 words each

**Confirmed by real data:** AGAP001212 actual output was **1,378 tokens** — essentially spot-on with the original estimate.

| Component | Tokens |
|-----------|--------|
| biological_content (observations + insights) | ~550 |
| qualitative_assessment (4 dimensions) | ~640 |
| quantitative_expression_mentions + JSON overhead | ~110 |
| **Total output per call** | **~1,380** |

(max_tokens is set to 4,000; typical output uses ~1,380)

### Call counts and totals

| Config | Genes | Pairs | Directions | Total calls | Input tokens | Output tokens |
|--------|-------|-------|------------|-------------|-------------|---------------|
| 2 models (current) | 20 | 1 | ×2 | 40 | 202,000 | 55,200 |
| 3 models | 20 | 3 | ×2 | 120 | 606,000 | 165,600 |

---

## Phase 2.5: comparison:condense

### What it does
For each gene × model pair, merges the two bidirectional qualitative assessments via one AI call.

### Input token estimate

The `mergeQualitativeAssessments()` prompt sends both qualitative assessments (already generated in Phase 2). Each `QualitativeAssessment` has 4 dimensions × 3 fields = 12 text fields, each ~40 words.

| Component | Tokens |
|-----------|--------|
| Static prompt (intro + instructions) | ~150 |
| Assessment 1 (4 dims × 3 fields × ~40 words) | ~640 |
| Assessment 2 (label-swapped, same size) | ~640 |
| Response format schema | ~200 |
| **Total input per call** | **~1,630** |

### Output token estimate

The merged output has the same 12-field structure plus `contradiction_detected` and `merge_notes`.

| Component | Tokens |
|-----------|--------|
| 4 dimensions × 3 fields × ~40 words | ~640 |
| contradiction_detected + merge_notes | ~80 |
| JSON overhead | ~80 |
| **Total output per call** | **~800** |

(max_tokens is set to 2,000)

### Call counts and totals

| Config | Genes | Pairs | Total calls | Input tokens | Output tokens |
|--------|-------|-------|-------------|-------------|---------------|
| 2 models (current) | 20 | 1 | 20 | 32,600 | 16,000 |
| 3 models | 20 | 3 | 60 | 97,800 | 48,000 |

---

## Phase 3: comparison:aggregate

### What it does
For each model pair, aggregates the 20 per-gene condensed assessments into a single report. The `aggregateQualitativeField()` function is called **12 times per model pair** (4 dimensions × 3 fields: summary_A, summary_B, comparison). The 3 field calls within each dimension run in parallel.

### Input token estimate

Each call receives all 20 gene statements for one field (e.g. all `tone_and_style.comparison` strings).

| Component | Tokens |
|-----------|--------|
| Static prompt (dimension name, task description) | ~250 |
| 20 gene statements (~gene_id + ": " + ~45 words each) | ~1,200 |
| Response format schema | ~200 |
| **Total input per call** | **~1,650** |

### Output token estimate

| Component | Tokens |
|-----------|--------|
| consensus_summary (~50 words) | ~70 |
| agreement_distribution (5 buckets, 20 gene IDs total) | ~120 |
| modal_representative (1 gene ID) | ~5 |
| disagreement_analysis (~50 words) | ~70 |
| JSON overhead | ~50 |
| **Total output per call** | **~315** |

(max_tokens is set to 2,000)

### Call counts and totals

| Config | Model pairs | Calls/pair | Total calls | Input tokens | Output tokens |
|--------|-------------|-----------|-------------|-------------|---------------|
| 2 models (current) | 1 | 12 | 12 | 19,800 | 3,780 |
| 3 models | 3 | 12 | 36 | 59,400 | 11,340 |

---

## Grand Total Summary

### Current config: 2 active models (claude4_5thinking + gpt5), 1 model pair

| Phase | AI Calls | Input tokens | Output tokens | Total tokens |
|-------|----------|-------------|---------------|-------------|
| comparison:fetch | 0 | 0 | 0 | 0 |
| comparison:compare | 40 | 202,000 | 55,200 | 257,200 |
| comparison:condense | 20 | 32,600 | 16,000 | 48,600 |
| comparison:aggregate | 12 | 19,800 | 3,780 | 23,580 |
| **TOTAL** | **72** | **~254,400** | **~74,980** | **~329,000** |

### Full 3-model config (if gpt4o re-enabled), 3 model pairs

| Phase | AI Calls | Input tokens | Output tokens | Total tokens |
|-------|----------|-------------|---------------|-------------|
| comparison:fetch | 0 | 0 | 0 | 0 |
| comparison:compare | 120 | 606,000 | 165,600 | 771,600 |
| comparison:condense | 60 | 97,800 | 48,000 | 145,800 |
| comparison:aggregate | 36 | 59,400 | 11,340 | 70,740 |
| **TOTAL** | **216** | **~763,200** | **~224,940** | **~988,000** |

---

## Key Assumptions and Data Sources

- **compare input:** anchored on real token data (5,572 tokens for AGAP001212) and scaled by measured file sizes across all 20 genes. Gene-to-gene variation is low (~18% size spread), so the average estimate of ~5,050 tokens/call is reliable.
- **compare output:** confirmed by real data (1,378 tokens for AGAP001212).
- **condense and aggregate:** estimated from code inspection only — no real token data available.
- **20 genes** as per `comparison/input/gene-list.txt`
- **JSON formatting:** `JSON.stringify(..., null, 2)` is used throughout — pretty-printing adds ~15% overhead vs compact JSON
- The estimate excludes any retries caused by API errors

## Scaling notes

- **comparison:compare** dominates cost (65–66% of total tokens), driven by passing both summaries per call
- The pipeline scales linearly with genes: double the genes → double the tokens for all phases
- The pipeline scales with O(n²) model pairs for phases 2 and 2.5: adding a 4th model would add 3 more pairs (doubling pairs from 3 to 6)
