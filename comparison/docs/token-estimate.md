# Token Usage Estimate: Comparison Pipeline

**Scope:** 20 genes, full pipeline (comparison:fetch → comparison:compare → comparison:condense → comparison:aggregate)

**Accuracy:** ±20% (rough estimate based on code inspection and real summary file sizes)

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

Based on actual summary files (AGAP001212 has ~41 experiments across 8 topics; typical genes have ~20–30 experiments across 4–7 topics), a realistic average **simplified summary is ~900 tokens**.

| Component | Tokens |
|-----------|--------|
| Static prompt text (intro, instructions, notes) | ~350 |
| JSON response schema embedded in prompt | ~100 |
| Summary A (simplified JSON) | ~900 |
| Summary B (simplified JSON) | ~900 |
| **Total input per call** | **~2,250** |

### Output token estimate

The comparison produces:
- `biological_content`: observations (only_in_A, only_in_B, in_both) + insights (same) — typically ~5 items per bucket × 6 buckets × 15 words
- `qualitative_assessment`: 4 dimensions × 3 fields (summary_A, summary_B, comparison) × ~40 words each

| Component | Tokens |
|-----------|--------|
| biological_content (observations + insights) | ~550 |
| qualitative_assessment (4 dimensions) | ~640 |
| quantitative_expression_mentions + JSON overhead | ~110 |
| **Total output per call** | **~1,300** |

(max_tokens is set to 4,000; typical output uses ~1,300)

### Call counts and totals

| Config | Genes | Pairs | Directions | Total calls | Input tokens | Output tokens |
|--------|-------|-------|------------|-------------|-------------|---------------|
| 2 models (current) | 20 | 1 | ×2 | 40 | 90,000 | 52,000 |
| 3 models | 20 | 3 | ×2 | 120 | 270,000 | 156,000 |

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
| comparison:compare | 40 | 90,000 | 52,000 | 142,000 |
| comparison:condense | 20 | 32,600 | 16,000 | 48,600 |
| comparison:aggregate | 12 | 19,800 | 3,780 | 23,580 |
| **TOTAL** | **72** | **~142,400** | **~71,780** | **~214,000** |

### Full 3-model config (if gpt4o re-enabled), 3 model pairs

| Phase | AI Calls | Input tokens | Output tokens | Total tokens |
|-------|----------|-------------|---------------|-------------|
| comparison:fetch | 0 | 0 | 0 | 0 |
| comparison:compare | 120 | 270,000 | 156,000 | 426,000 |
| comparison:condense | 60 | 97,800 | 48,000 | 145,800 |
| comparison:aggregate | 36 | 59,400 | 11,340 | 70,740 |
| **TOTAL** | **216** | **~427,200** | **~215,340** | **~642,500** |

---

## Key Assumptions

- **Average simplified summary size: ~900 tokens** — based on inspecting AGAP001212 (a complex gene, ~41 experiments → ~1,200 tokens simplified) and assuming most genes are simpler (~600–900 tokens simplified). Genes with unusually many experiments will push this higher.
- **20 genes** as per `comparison/input/gene-list.txt`
- **Tokenisation rate:** ~0.75 tokens/word (standard English prose), ~1 token/character for JSON keys
- **JSON formatting:** `JSON.stringify(..., null, 2)` is used throughout — whitespace adds ~15% token overhead vs compact JSON
- The estimate excludes any retries caused by API errors

## Scaling notes

- **comparison:compare** dominates cost (65–66% of total tokens), driven by passing both summaries per call
- The pipeline scales linearly with genes: double the genes → double the tokens for all phases
- The pipeline scales with O(n²) model pairs for phases 2 and 2.5: adding a 4th model would add 3 more pairs (doubling pairs from 3 to 6)
