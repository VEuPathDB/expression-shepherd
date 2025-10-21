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
- Authentication: Cookie-based authentication using `auth_tkt` cookie (see Appendix for details)

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

**Runtime Expectations:**
- Polling timeout: 10 minutes per gene per site (MAX_POLL_ATTEMPTS = 120 × 5 seconds)
- For 20 genes × 3 sites: expect 60+ minutes total runtime due to:
  - AI generation time (varies by model and gene complexity)
  - Backend rate limiting (especially for Anthropic/Claude)
  - Sequential processing per gene, parallel across sites
- **Important for Claude Code**: When using Bash tool to run `yarn comparison:fetch`, set timeout to at least 3600000ms (1 hour) for full gene lists

### Phase 2: AI-Powered Comparison
1. Create TypeScript scripts that use Anthropic API to compare summaries
2. Perform bidirectional pairwise comparisons for each gene (to detect position bias):
   - Claude vs GPT-5 (both directions)
   - Claude vs GPT-4o (both directions)
   - GPT-5 vs GPT-4o (both directions)
3. Comparison dimensions:
   - Specific biological observations and insights (with only_in_A, only_in_B, in_both categorization)
   - Tone and style
   - Level of technical detail
   - Structure and organization
   - Deterministic metrics (word count, topic count, etc.)
   - Quantitative expression mentions (fold changes, TPM, percentiles)
4. Output: JSON format for each bidirectional comparison (6 files per gene)

### Phase 2.5: Condensation
1. Merge bidirectional comparison pairs into condensed summaries
2. For each model pair:
   - Calculate biological content averages (observations/insights counts only, not full text)
   - Calculate quantitative mention averages
   - Use AI to merge qualitative assessments and detect position bias
   - Preserve deterministic metrics from both models
3. Output: Condensed JSON files (3 files per gene: claude4-gpt4o, claude4-gpt5, gpt4o-gpt5)
4. Result: ~95% reduction in data volume by replacing detailed observation lists with summary counts

### Phase 3: Aggregate Analysis
1. For each model pair (claude4-gpt4o, claude4-gpt5, gpt4o-gpt5):
   - Collect all 20 condensed comparison files for that pair
   - Calculate aggregate statistics:
     - Average unique observations/insights per model across all genes
     - Average quantitative mentions per model
     - Average deterministic metrics (word count, topic count, etc.)
     - Position bias frequency (% of genes with AB/BA merge contradictions)
   - Feed all qualitative assessments into AI for pattern identification:
     - Consistent tone/style differences
     - Consistent technical detail level differences
     - Consistent organizational approach differences
     - Any systematic contradictions or themes
   - Generate model pair report with both quantitative stats and qualitative themes
2. Output: One aggregate report per model pair (3 reports total)
3. Model identities remain anonymous through aggregation; only revealed when saving final reports
4. Optional future step: Super-aggregation comparing all 3 pairwise reports

## Project Structure

New files/directories within existing `expression-shepherd` repository:

```
expression-shepherd/
├── (existing files: src/main.ts, package.json, etc.)
├── comparison/
│   ├── config/
│   │   └── sites.json (site configurations and endpoints)
│   ├── input/
│   │   └── gene-list.txt (VectorBase gene IDs, one per line, supports # comments)
│   ├── scripts/
│   │   ├── shared-utils.ts (shared utilities including authentication)
│   │   ├── fetch-summaries.ts (Phase 1: API calls and JSON storage)
│   │   ├── compare-summaries.ts (Phase 2: AI-powered bidirectional comparison)
│   │   ├── condense-comparisons.ts (Phase 2.5: merge bidirectional pairs)
│   │   └── aggregate-analysis.ts (Phase 3: theme identification)
│   └── data/
│       ├── summaries/
│       │   ├── claude4/ (JSON response files)
│       │   ├── gpt5/
│       │   └── gpt4o/
│       ├── comparisons/
│       │   └── {analysisModel}/  (e.g., claude4)
│       │       └── {geneId}/
│       │           ├── claude4-vs-gpt5.json
│       │           ├── gpt5-vs-claude4.json
│       │           ├── claude4-vs-gpt4o.json
│       │           ├── gpt4o-vs-claude4.json
│       │           ├── gpt5-vs-gpt4o.json
│       │           └── gpt4o-vs-gpt5.json
│       ├── condensed/
│       │   └── {analysisModel}/  (e.g., claude4)
│       │       └── {geneId}/
│       │           ├── claude4-gpt4o.json
│       │           ├── claude4-gpt5.json
│       │           └── gpt4o-gpt5.json
│       └── aggregate-reports/
│           └── {analysisModel}/  (e.g., claude4)
│               ├── claude4-gpt4o-report.json
│               ├── claude4-gpt5-report.json
│               └── gpt4o-gpt5-report.json
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

### Authentication
- VEuPathDB dev sites use cookie-based authentication
- Requires `auth_tkt` cookie obtained from login endpoint
- Credentials stored in `.env` file (see Appendix for implementation details)

### AI Comparison Scripts
- Must be deterministic (TypeScript scripts calling Anthropic API)
- Not relying on Claude Code's ad-hoc responses
- Identical context and prompting for each comparison
- Structured JSON output for downstream processing

## Tasks for Claude Code

1. **Initial Setup**
   - Create `comparison/` directory structure
   - Set up config files for site configurations

2. **Phase 1 Implementation**
   - Create `comparison/scripts/fetch-summaries.ts` with API client
   - Implement cookie-based authentication for all three sites
   - Implement progress monitoring and polling logic
   - Save JSON responses to `comparison/data/summaries/{model}/{geneId}.json`
   - Add retry logic for failed requests

3. **Phase 2 Implementation**
   - Create `comparison/scripts/compare-summaries.ts` with Anthropic API integration
   - Design comparison prompt for consistent, blind results (no model names revealed)
   - Generate bidirectional pairwise comparison JSONs for all genes (6 per gene)

4. **Phase 2.5 Implementation**
   - Create `comparison/scripts/condense-comparisons.ts`
   - Merge bidirectional pairs with AI-powered qualitative assessment synthesis
   - Calculate biological content statistics and detect position bias
   - Maintain model anonymity throughout condensation process

5. **Phase 3 Implementation**
   - Create `comparison/scripts/aggregate-analysis.ts`
   - Process one model pair at a time (3 separate aggregation runs)
   - Calculate aggregate statistics across all genes for each pair
   - Use AI to identify qualitative patterns and themes
   - Reveal model identities only when writing final reports

## Running the Scripts

NPM scripts are available in `package.json`:
- `yarn comparison:fetch` - Phase 1: Fetch summaries from all three sites
- `yarn comparison:compare` - Phase 2: Generate bidirectional pairwise comparisons
- `yarn comparison:condense` - Phase 2.5: Condense bidirectional pairs into merged summaries
- `yarn comparison:aggregate` - Phase 3: Generate aggregate analysis report

All scripts automatically run `yarn build` before execution.

**Note**: Use `#` comments in `gene-list.txt` to temporarily exclude genes during development/testing.

## Next Steps

User needs to provide:
- Gene list (`comparison/input/gene-list.txt`)

Already available in repository:
- VEuPathDB authentication credentials (in `.env` as `VEUPATHDB_LOGIN_USER` and `VEUPATHDB_LOGIN_PASS`)
- Anthropic API key (in `.env` as `ANTHROPIC_API_KEY`)
- TypeScript build setup
- Node.js environment

## Success Criteria

- All 20 genes successfully processed through all three sites
- Complete set of JSON summaries saved locally (3 models × 20 genes = 60 files)
- Bidirectional pairwise comparisons generated for each gene (6 comparisons × 20 genes = 120 files)
- Condensed comparison summaries for each gene (3 model pairs × 20 genes = 60 files)
- Three aggregate reports (one per model pair) identifying systematic differences:
  - Quantitative metrics (avg observations, insights, quantitative mentions, word counts, etc.)
  - Qualitative patterns (tone, technical detail, structure themes)
  - Position bias statistics
- Model anonymity maintained through all analysis phases until final report generation
- Reproducible process that can be re-run with new gene sets

---

# Development History

## Phase 1 (COMPLETED): Configurable Analysis Model

**Status**: ✅ Completed 2025-10-21

**Summary**: Added `analysis_model` configuration to enable switching between different AI models for comparison analysis (Phases 2-3). This allows comparing how different AI models (e.g., Claude 4 vs GPT-5) perform the analysis itself, independent of the source summaries being compared.

**Changes implemented**:
1. Added `analysis_model` config to `comparison/config/sites.json`:
   ```json
   {
     "analysis_model": {
       "model_string": "claude-sonnet-4-20250514",
       "name": "claude4",
       "platform": "anthropic"
     },
     "sites": [...],
     ...
   }
   ```

2. Updated TypeScript types (`comparison/scripts/types.ts`):
   - Added `AnalysisModelConfig` interface
   - Updated `Config` interface to include `analysis_model`

3. Refactored all comparison scripts to use config:
   - `compare-summaries.ts`: Uses `config.analysis_model.model_string` for API calls
   - `condense-comparisons.ts`: Uses `config.analysis_model.model_string` for AI merging
   - `aggregate-analysis.ts`: Uses `config.analysis_model.model_string` for aggregation

4. Updated output paths to include analysis model subdirectories:
   - `comparisons/{analysisModel}/{geneId}/...`
   - `condensed/{analysisModel}/{geneId}/...`
   - `aggregate-reports/{analysisModel}/...`

5. Migrated existing files into `claude4/` subdirectories (20 genes, all comparisons/condensed/aggregate-reports)

**Build verification**: ✅ TypeScript compiles without errors

---

## Phase 2 (TODO): Add OpenAI Platform Support

**Goal**: Enable using OpenAI models (GPT-4o, GPT-5) as the analysis model for comparison scripts, not just Anthropic Claude.

**Context**: Currently all three comparison scripts (`compare-summaries.ts`, `condense-comparisons.ts`, `aggregate-analysis.ts`) use Anthropic's API directly. To support OpenAI as an analysis model, we need platform abstraction.

### Implementation Strategy

**Approach**: Unified ad-hoc JSON prompting for both platforms (no `response_format` for OpenAI)

Rationale:
- Simplicity: One code path instead of platform-specific branching
- GPT-5/4o are excellent at following ad-hoc JSON instructions
- Methodologically cleaner: Identical prompting strategy across platforms
- Already battle-tested: Claude ad-hoc approach working well in comparison scripts

**Note**: Unlike `src/main.ts` (which uses OpenAI's `zodResponseFormat`), we intentionally use simpler ad-hoc JSON instructions for both platforms.

### Tasks

#### 1. Check/Upgrade OpenAI Package

```bash
# Check current version
yarn list --pattern openai

# Upgrade if needed for GPT-5 support
yarn add openai@latest
```

#### 2. Create Platform Abstraction (`comparison/scripts/shared-utils.ts`)

Add these functions to `shared-utils.ts`:

**a) AI Client Factory**
```typescript
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AnalysisModelConfig } from "./types";

export function createAIClient(analysisModel: AnalysisModelConfig): Anthropic | OpenAI {
  if (analysisModel.platform === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in .env");
    return new Anthropic({ apiKey });
  } else if (analysisModel.platform === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY in .env");
    return new OpenAI({ apiKey });
  } else {
    throw new Error(`Unsupported platform: ${analysisModel.platform}`);
  }
}
```

**b) Unified AI Call Function**
```typescript
export interface AICallResult {
  parsed: any;  // The parsed JSON response
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export async function callAI(
  client: Anthropic | OpenAI,
  platform: 'anthropic' | 'openai',
  modelString: string,
  prompt: string,
  maxTokens: number
): Promise<AICallResult> {
  let rawResponse: string;
  let usage: any;

  if (platform === "anthropic") {
    const anthropic = client as Anthropic;
    const message = await anthropic.messages.create({
      model: modelString,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    rawResponse = message.content[0].type === "text"
      ? message.content[0].text
      : JSON.stringify(message.content[0]);
    usage = message.usage;

    // Strip markdown for Anthropic
    rawResponse = stripMarkdownCodeBlocks(rawResponse);

    return {
      parsed: JSON.parse(rawResponse),
      token_usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.input_tokens + usage.output_tokens,
      },
    };
  } else {
    const openai = client as OpenAI;

    // Ad-hoc JSON instructions (no response_format)
    const completion = await openai.chat.completions.create({
      model: modelString,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });

    rawResponse = completion.choices[0].message.content || "";
    usage = completion.usage;

    // Apply markdown stripping to OpenAI too (just in case)
    rawResponse = stripMarkdownCodeBlocks(rawResponse);

    return {
      parsed: JSON.parse(rawResponse),
      token_usage: {
        input_tokens: usage?.prompt_tokens || 0,
        output_tokens: usage?.completion_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
      },
    };
  }
}
```

#### 3. Update Comparison Scripts

**For each script** (`compare-summaries.ts`, `condense-comparisons.ts`, `aggregate-analysis.ts`):

a) **Change imports**:
```typescript
// Before:
import Anthropic from "@anthropic-ai/sdk";

// After:
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createAIClient, callAI, type AICallResult } from "./shared-utils";
```

b) **Update `main()` function**:
```typescript
// Before:
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY in .env file");
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey });

// After:
const aiClient = createAIClient(config.analysis_model);
```

c) **Replace direct API calls** with `callAI()`:
```typescript
// Before:
const message = await anthropic.messages.create({
  model: analysisModelString,
  max_tokens: 4000,
  messages: [{ role: "user", content: prompt }],
});
const responseText = message.content[0].type === "text" ? message.content[0].text : ...;
const cleanedResponse = stripMarkdownCodeBlocks(responseText);
const parsed = JSON.parse(cleanedResponse);
// ... extract token_usage from message.usage

// After:
const { parsed, token_usage } = await callAI(
  aiClient,
  config.analysis_model.platform,
  config.analysis_model.model_string,
  prompt,
  4000
);
```

d) **Update function signatures** to accept generic client:
```typescript
// Before:
async function compareWithAI(..., anthropic: Anthropic, ...): Promise<...> {

// After:
async function compareWithAI(..., aiClient: Anthropic | OpenAI, platform: 'anthropic' | 'openai', ...): Promise<...> {
```

#### 4. Testing Strategy

1. **Build verification**: `yarn build` (check for TypeScript errors)
2. **Test with Anthropic** (baseline - should still work):
   ```json
   // sites.json
   "analysis_model": {
     "model_string": "claude-sonnet-4-20250514",
     "name": "claude4",
     "platform": "anthropic"
   }
   ```
   - Run: `yarn comparison:compare` on a single gene (comment out others in `gene-list.txt`)
   - Verify output in `comparisons/claude4/`

3. **Test with OpenAI**:
   ```json
   // sites.json
   "analysis_model": {
     "model_string": "gpt-4o-2024-11-20",  // or latest GPT-5 model
     "name": "gpt4o",
     "platform": "openai"
   }
   ```
   - Run: `yarn comparison:compare` on same test gene
   - Verify output in `comparisons/gpt4o/`
   - Compare JSON structure matches (same schema)
   - Check for JSON parsing errors in logs

4. **Regression test**: Run all three scripts end-to-end with both platforms

### GPT-5 Model String

When GPT-5 support is available, update model string:
```json
"analysis_model": {
  "model_string": "gpt-5-YYYY-MM-DD",  // TBD when GPT-5 launches
  "name": "gpt5",
  "platform": "openai"
}
```

Check OpenAI docs for exact model identifier and context window limits.

### Potential Issues & Solutions

**Issue**: OpenAI doesn't follow JSON format despite ad-hoc instructions
- **Solution**: Add retry logic with error message feedback, or fall back to `response_format` (add as Phase 2.1 if needed)

**Issue**: Different token limits between models
- **Solution**: Make `maxTokens` configurable per model in `analysis_model` config:
  ```json
  "analysis_model": {
    "model_string": "...",
    "name": "...",
    "platform": "...",
    "max_tokens": {
      "compare": 4000,
      "condense": 2000,
      "aggregate": 2000
    }
  }
  ```

**Issue**: Rate limiting differences between platforms
- **Solution**: Add platform-specific rate limiting in `callAI()` function

### Success Criteria

- ✅ All three comparison scripts work with both `platform: "anthropic"` and `platform: "openai"`
- ✅ No TypeScript compilation errors
- ✅ JSON parsing works reliably for both platforms
- ✅ Token usage tracking accurate for both platforms
- ✅ Can switch analysis models by editing `sites.json` alone (no code changes)
- ✅ Existing claude4 analysis results unchanged (regression test)

---

# Appendices



## VEuPathDB Dev Site Authentication

The VEuPathDB dev sites use cookie-based authentication. You need to obtain an `auth_tkt` cookie and include it with all requests.

### Prep.

Username and password have been added to `.env`:

```
VEUPATHDB_LOGIN_USER=apidb
VEUPATHDB_LOGIN_PASS=XXXXXXXXXXXXX
```

### Step 1: Obtain the auth_tkt Cookie

Make a POST request to the VEuPathDB login endpoint:

```typescript
import https from 'https';
import querystring from 'querystring';

async function getAuthCookie(username: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({ username, password });

    const req = https.request(
      'https://veupathdb.org/auth/bin/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Cookie': 'auth_probe=1',  // Required!
        },
      },
      (res) => {
        // Extract auth_tkt cookie from Set-Cookie headers
        const setCookieHeader = res.headers['set-cookie'];
        if (setCookieHeader) {
          const authCookie = setCookieHeader.find(cookie =>
            cookie.startsWith('auth_tkt=')
          );
          if (authCookie) {
            // Extract just the cookie value (between = and ;)
            const match = authCookie.match(/auth_tkt=([^;]+)/);
            if (match) {
              resolve(match[1]);
              return;
            }
          }
        }
        reject(new Error('Could not get auth_tkt cookie'));
      }
    );

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
```

### Step 2: Include the Cookie in All Requests

Once you have the `auth_tkt` value, include it as a cookie in all requests to the dev site:

```typescript
const authTkt = await getAuthCookie(username, password);

// For fetch API:
fetch('https://vectorbase.org/your-endpoint', {
  headers: {
    'Cookie': `auth_tkt=${authTkt}`
  }
});

// For axios:
axios.get('https://vectorbase.org/your-endpoint', {
  headers: {
    'Cookie': `auth_tkt=${authTkt}`
  }
});
```

### Key Points:
- The login endpoint requires `Cookie: auth_probe=1` in the request headers
- The credentials should be the VEuPathDB BRC Pre-Release username/password
- The `auth_tkt` cookie must be included in **all** subsequent requests to the dev sites
- The cookie is valid for a session - you may need to re-authenticate if it expires (expiry is days not hours, so no worries here)
