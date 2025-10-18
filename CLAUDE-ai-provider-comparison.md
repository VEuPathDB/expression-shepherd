# VectorBase AI Expression Summary Comparison Project

## Project Overview

Compare AI-generated gene expression summaries from three different models (Claude, GPT-5, GPT-4o) across ~20 VectorBase genes to characterize differences in style, content, and insights.

This work will be done within the existing `expression-shepherd` repository, leveraging its TypeScript setup and API key configuration.

## Sites and Configuration

### Three comparison sites:
1. **bmaccallum.vectorbase.org** - Claude-powered
2. **bmaccallum-b.vectorbase.org** - GPT-5-powered
3. **qa.vectorbase.org** - GPT-4o-powered

### Access Details:
- API endpoint: `/wdk-service/record-types/gene/searches/single_record_question_GeneRecordClasses_GeneRecordClass/reports/aiExpression`
- Proxy setup: Available for bmaccallum* sites (details TBD from user)
- Local development: Proxy endpoint is `http://localhost:8080/wdk-service/...` when using webpack local server

## Gene Set
- Format: VectorBase IDs (e.g., AGAP001234)
- Count: ~20 genes
- Source: User-provided list

## Workflow

### Phase 1: Trigger Summary Generation & Fetch Results
1. Read gene list from input file (format TBD by user)
2. For each gene, make API calls to all three sites:
   - Initial request with `populateIfNotPresent: true` to trigger generation
   - Poll with `populateIfNotPresent: false` until `resultStatus: "present"`
   - See `useAiExpressionSummary` in [AiExpressionSummary.tsx](https://raw.githubusercontent.com/VEuPathDB/web-monorepo/refs/heads/main/packages/sites/genomics-site/webapp/wdkCustomization/js/client/components/records/AiExpressionSummary.tsx) for orchestration details
3. Save JSON responses locally, organized by gene ID and model
4. Track progress and any errors

### Phase 2: AI-Powered Comparison
1. Create TypeScript scripts that use Anthropic API to compare summaries
2. Perform pairwise comparisons for each gene:
   - Claude vs GPT-5
   - Claude vs GPT-4o
   - GPT-5 vs GPT-4o
3. Comparison dimensions:
   - Specific biological insights mentioned
   - Tone and style
   - Level of technical detail
   - Length and structure
4. Output: JSON format for each comparison

### Phase 3: Aggregate Analysis
1. Collect all pairwise comparison JSONs
2. Feed into second-pass AI summarization
3. Identify themes and patterns across the gene set
4. Generate final report on systematic differences

## Project Structure

New files/directories within existing `expression-shepherd` repository:

```
expression-shepherd/
├── (existing files: src/main.ts, package.json, etc.)
├── comparison/
│   ├── config/
│   │   ├── sites.json (site configurations and endpoints)
│   │   └── proxy.json (proxy configuration for bmaccallum* sites)
│   ├── input/
│   │   └── gene-list.txt (VectorBase gene IDs, one per line)
│   ├── scripts/
│   │   ├── fetch-summaries.ts (Phase 1: API calls and JSON storage)
│   │   ├── compare-summaries.ts (Phase 2: AI-powered comparison)
│   │   └── aggregate-analysis.ts (Phase 3: theme identification)
│   └── data/
│       ├── summaries/
│       │   ├── claude/ (JSON response files)
│       │   ├── gpt5/
│       │   └── gpt4o/
│       ├── comparisons/
│       │   └── {geneId}/
│       │       ├── claude-vs-gpt5.json
│       │       ├── claude-vs-gpt4o.json
│       │       └── gpt5-vs-gpt4o.json
│       └── final-report.json (aggregated themes and patterns)
```

## Technical Notes

### API Integration

**Endpoint**: `{hostname}/wdk-service/record-types/gene/searches/single_record_question_GeneRecordClasses_GeneRecordClass/reports/aiExpression`

**Request format**:
```json
{
    "reportConfig": {
        "populateIfNotPresent": true  // true to trigger generation, false to poll
    },
    "searchConfig": {
        "parameters": {
            "primaryKeys": "AGAP001234,VectorBase"
        }
    }
}
```

**Response format**:
```json
{
    "AGAP001234": {
        "resultStatus": "present",  // or "in_progress" with additional progress info
        "expressionSummary": {
            "one_paragraph_summary": "Analysis of transcriptomic data...",
            "headline": "Stage-Specific and Condition-Responsive Expression of",
            "topics": []
        }
    }
}
```

**Orchestration**:
- Initial request with `populateIfNotPresent: true` triggers AI generation
- Subsequent polls with `populateIfNotPresent: false` check status
- Response includes progress information when not yet complete
- See `useAiExpressionSummary` hook for reference implementation

### Proxy Configuration
- User will provide webpack dev server proxy config
- Needed for bmaccallum* sites (firewall/proxy hurdles)
- Will be adapted for fetch calls in TypeScript

### AI Comparison Scripts
- Must be deterministic (TypeScript scripts calling Anthropic API)
- Not relying on Claude Code's ad-hoc responses
- Identical context and prompting for each comparison
- Structured JSON output for downstream processing

## Tasks for Claude Code

1. **Initial Setup**
   - Create `comparison/` directory structure
   - Set up config files (will need user input for proxy details)

2. **Phase 1 Implementation**
   - Create `comparison/scripts/fetch-summaries.ts` with API client
   - Implement proxy-aware fetch for all three sites
   - Implement progress monitoring and polling logic
   - Save JSON responses to `comparison/data/summaries/{model}/{geneId}.json`
   - Add retry logic for failed requests

3. **Phase 2 Implementation**
   - Create `comparison/scripts/compare-summaries.ts` with Anthropic API integration
   - Design comparison prompt for consistent results
   - Generate pairwise comparison JSONs for all genes

4. **Phase 3 Implementation**
   - Create `comparison/scripts/aggregate-analysis.ts`
   - Collect and structure all comparison data
   - Generate final thematic summary

## Next Steps

User needs to provide:
- Gene list (`comparison/input/gene-list.txt`)
- Proxy configuration details for bmaccallum* sites
- Confirm VectorBase project ID (e.g., "VectorBase") for gene primary keys

Already available in repository:
- Anthropic API key (in `.env` as `ANTHROPIC_API_KEY`)
- TypeScript build setup
- Node.js environment

## Success Criteria

- All 20 genes successfully processed through all three sites
- Complete set of JSON summaries saved locally (3 models × 20 genes = 60 files)
- Pairwise comparisons generated for each gene (3 comparisons × 20 genes = 60 files)
- Final aggregated report identifying systematic differences between models
- Reproducible process that can be re-run with new gene sets