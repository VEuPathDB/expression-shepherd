# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

- **Install dependencies**: `yarn`
- **Build TypeScript**: `yarn build` (compiles `src/main.ts` to `dist/main.js`)
- **Run with OpenAI**: `node dist/main.js GENE_ID` (default, requires OPENAI_API_KEY in .env)
- **Run with Claude**: `node dist/main.js GENE_ID --claude` (requires ANTHROPIC_API_KEY in .env)

**Important**: Use `node dist/main.js` directly instead of `yarn start` when passing the `--claude` flag, as npm/yarn scripts don't pass through additional arguments.

## Project Architecture

This is a Node.js/TypeScript tool that summarizes gene expression data from PlasmoDB using AI models (OpenAI GPT-4o or Anthropic Claude 4 Sonnet). 

### Core Components

- **Main entry point**: `src/main.ts` - handles command-line arguments, API calls, and orchestrates the two-step summarization process
- **Types**: `src/types.ts` - Zod schemas for API response validation
- **Utilities**: `src/utils.ts` - file writing, HTML generation, and data consolidation functions
- **API templates**: `src/post-templates/expression_data_request.ts` - PlasmoDB API request configuration

### Data Flow

1. **Data Retrieval**: Fetches gene expression data from PlasmoDB API (`https://plasmodb.org/plasmo/service`)
2. **Individual Summarization**: Each experiment gets summarized individually by AI (parallel processing)
3. **Summary Consolidation**: High-importance summaries (biological_importance > 3, confidence > 3) are grouped into topics
4. **Output Generation**: Creates JSON summaries and HTML visualization in `example-output/` directory

### Output Files

Generated files follow the pattern: `GENE_ID.01.MODEL.{summaries.json,summary.json,summary.html}`
- `summaries.json`: Individual experiment summaries
- `summary.json`: Consolidated summary with topics  
- `summary.html`: User-friendly HTML version

### API Configuration

- **OpenAI**: Model `gpt-4o-2024-11-20`, uses structured output with Zod validation
- **Claude**: Model `claude-sonnet-4-20250514`, requires manual JSON parsing with markdown stripping
- **Rate Limiting**: Currently no explicit rate limiting implemented
- **Cost Tracking**: Built-in cost calculation for both APIs

### Environment Setup

- Requires Node.js 18.20.5 (managed by Volta if available)
- Environment variables: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in `.env` file
- Target database: PlasmoDB (malaria parasite genome database)