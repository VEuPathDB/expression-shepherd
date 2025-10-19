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
     - Position bias frequency (% of genes with detected bias)
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
│       │   └── {geneId}/
│       │       ├── claude4-vs-gpt5.json
│       │       ├── gpt5-vs-claude4.json
│       │       ├── claude4-vs-gpt4o.json
│       │       ├── gpt4o-vs-claude4.json
│       │       ├── gpt5-vs-gpt4o.json
│       │       └── gpt4o-vs-gpt5.json
│       ├── condensed/
│       │   └── {geneId}/
│       │       ├── claude4-gpt4o.json
│       │       ├── claude4-gpt5.json
│       │       └── gpt4o-gpt5.json
│       └── aggregate-reports/
│           ├── claude4-gpt4o-report.json
│           ├── claude4-gpt5-report.json
│           └── gpt4o-gpt5-report.json
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
