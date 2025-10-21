import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { writeToFile, createAIClient, AIClient, loadGeneList, loadSitesConfig } from "./shared-utils";
import type {
  Config,
  SiteConfig,
  AnalysisModelConfig,
  ExperimentSummary,
  Topic,
  ExpressionSummary,
  SimplifiedTopic,
  SimplifiedSummary,
  DeterministicMetrics,
  BiologicalContent,
  QualitativeAssessment,
  QuantitativeMentions,
  ComparisonResult,
} from "./types";

// ============================================================================
// Deterministic Metrics Calculation
// ============================================================================

/**
 * Calculate deterministic metrics from a summary
 */
function calculateMetrics(summary: ExpressionSummary): DeterministicMetrics {
  const fullText = `${summary.headline} ${summary.one_paragraph_summary} ${summary.topics
    .map((t) => `${t.headline} ${t.one_sentence_summary}`)
    .join(" ")}`;

  // Character count (excluding whitespace)
  const character_count = fullText.replace(/\s/g, "").length;

  // Word count
  const words = fullText.trim().split(/\s+/);
  const word_count = words.length;

  // Sentence count (approximate - count periods, exclamation marks, question marks)
  const sentences = fullText.match(/[.!?]+/g) || [];
  const sentence_count = sentences.length;

  // Paragraph count (from one_paragraph_summary + topics)
  const paragraph_count = 1 + summary.topics.length;

  // Topic count
  const topic_count = summary.topics.length;

  // Has bullets (check for HTML list items)
  const has_bullets = /<li>/i.test(fullText);

  // Average sentence length
  const average_sentence_length = sentence_count > 0 ? word_count / sentence_count : 0;

  return {
    character_count,
    word_count,
    sentence_count,
    paragraph_count,
    topic_count,
    has_bullets,
    average_sentence_length: Math.round(average_sentence_length * 10) / 10,
  };
}

// ============================================================================
// Summary Transformation
// ============================================================================

/**
 * Simplify summary by replacing experiment summaries with just experiment names
 * This reduces token usage and context clutter
 */
function simplifySummary(summary: ExpressionSummary): SimplifiedSummary {
  return {
    one_paragraph_summary: summary.one_paragraph_summary,
    headline: summary.headline,
    topics: summary.topics.map((topic) => ({
      one_sentence_summary: topic.one_sentence_summary,
      headline: topic.headline,
      experiment_names: topic.summaries.map((s) => s.experiment_name),
    })),
  };
}

// ============================================================================
// AI-Powered Comparison
// ============================================================================

/**
 * Generate comparison using AI (Anthropic or OpenAI)
 */
async function compareWithAI(
  geneId: string,
  modelAName: string,
  modelBName: string,
  summaryA: ExpressionSummary,
  summaryB: ExpressionSummary,
  aiClient: AIClient
): Promise<{
  biological_content: BiologicalContent;
  qualitative_assessment: QualitativeAssessment;
  quantitative_expression_mentions: QuantitativeMentions;
  token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}> {
  // Simplify summaries to reduce token usage
  const simplifiedA = simplifySummary(summaryA);
  const simplifiedB = simplifySummary(summaryB);

  const prompt = `You are comparing two gene expression summaries for the same gene.

Summary A:
\`\`\`json
${JSON.stringify(simplifiedA, null, 2)}
\`\`\`

Summary B:
\`\`\`json
${JSON.stringify(simplifiedB, null, 2)}
\`\`\`

---

Please provide a detailed comparison in the following JSON format:

{
  "biological_content": {
    "observations": {
      "only_in_A": ["list of factual observations about expression patterns found ONLY in Summary A"],
      "only_in_B": ["list of factual observations about expression patterns found ONLY in Summary B"],
      "in_both": ["list of factual observations found in BOTH summaries"]
    },
    "insights": {
      "only_in_A": ["list of biological insights/interpretations found ONLY in Summary A"],
      "only_in_B": ["list of biological insights/interpretations found ONLY in Summary B"],
      "in_both": ["list of biological insights/interpretations found in BOTH summaries"]
    }
  },
  "qualitative_assessment": {
    "tone_and_style": {
      "summary_A": "description of tone and writing style in Summary A",
      "summary_B": "description of tone and writing style in Summary B",
      "comparison": "comparison of tones and styles (always refer to 'Summary A' and 'Summary B', never just 'A' or 'B')"
    },
    "technical_detail_level": {
      "summary_A": "assessment of technical detail in Summary A",
      "summary_B": "assessment of technical detail in Summary B",
      "comparison": "comparison of detail levels (always refer to 'Summary A' and 'Summary B', never just 'A' or 'B')"
    },
    "structure_and_organization": {
      "summary_A": "assessment of structure in Summary A",
      "summary_B": "assessment of structure in Summary B",
      "comparison": "comparison of organizational approaches (always refer to 'Summary A' and 'Summary B', never just 'A' or 'B')"
    }
  },
  "quantitative_expression_mentions": {
    "summary_A": ${Math.floor(Math.random() * 9)},
    "summary_B": ${Math.floor(Math.random() * 9)}
  }
}

Important notes for quantitative_expression_mentions:
- Count ONLY specific numerical mentions of gene expression levels or changes
- Include: fold changes (e.g., "28-fold", "3.5x"), TPM values (e.g., "35,270 TPM"), percentile ranks (e.g., "99th percentile", "97.5%ile")
- EXCLUDE: time points (e.g., "3h", "24 hours"), ages (e.g., "10 days old"), experimental conditions (e.g., "30% RH"), sample sizes, temperatures, or any other non-expression numerical values
- Return ONLY the integer count, not explanatory text

Important distinctions:
- **Observations** are factual statements about expression patterns (e.g., "high expression after blood feeding", "increased in salivary glands")
- **Insights** are interpretations or biological conclusions (e.g., "likely involved in digestion", "may play a role in immune response")

Respond ONLY with valid JSON, no other text.`;

  const { parsed, token_usage } = await aiClient.call(prompt, 4000);

  return {
    ...parsed,
    token_usage,
  };
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Load summary for a specific gene and model
 */
async function loadSummary(modelName: string, geneId: string): Promise<ExpressionSummary> {
  const summaryPath = path.join(process.cwd(), `comparison/data/summaries/${modelName}/${geneId}.json`);
  const content = await readFile(summaryPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Check that all required summary files exist before starting comparisons
 * Exits with error if any files are missing
 */
async function checkAvailableSummaries(geneIds: string[], modelNames: string[]): Promise<void> {
  const missingFiles: Array<{ geneId: string; modelName: string }> = [];

  for (const geneId of geneIds) {
    for (const modelName of modelNames) {
      const summaryPath = path.join(process.cwd(), `comparison/data/summaries/${modelName}/${geneId}.json`);
      try {
        await readFile(summaryPath, "utf-8");
      } catch {
        missingFiles.push({ geneId, modelName });
      }
    }
  }

  if (missingFiles.length > 0) {
    console.error("\nERROR: Missing summary files:");
    missingFiles.forEach(({ geneId, modelName }) => {
      console.error(`  - ${geneId} (${modelName})`);
    });
    console.error(
      `\nPlease run 'yarn comparison:fetch' to generate missing summaries, or update gene-list.txt to only include genes with complete summaries.`
    );
    process.exit(1);
  }
}

// ============================================================================
// Main Comparison Logic
// ============================================================================

/**
 * Compare two models for a specific gene
 */
async function comparePair(
  geneId: string,
  modelAName: string,
  modelBName: string,
  aiClient: AIClient
): Promise<ComparisonResult> {
  console.log(`  Comparing ${modelAName} vs ${modelBName}...`);

  // Load summaries
  const summaryA = await loadSummary(modelAName, geneId);
  const summaryB = await loadSummary(modelBName, geneId);

  // Calculate deterministic metrics
  const metricsA = calculateMetrics(summaryA);
  const metricsB = calculateMetrics(summaryB);

  // Get AI comparison
  const aiComparison = await compareWithAI(geneId, modelAName, modelBName, summaryA, summaryB, aiClient);

  return {
    model_A: modelAName,
    model_B: modelBName,
    gene_id: geneId,
    biological_content: aiComparison.biological_content,
    qualitative_assessment: aiComparison.qualitative_assessment,
    deterministic_metrics: {
      summary_A: metricsA,
      summary_B: metricsB,
    },
    quantitative_expression_mentions: aiComparison.quantitative_expression_mentions,
    token_usage: aiComparison.token_usage,
  };
}

/**
 * Main execution
 */
async function main() {
  console.log("Loading configuration...");
  const { config, activeSites, skippedSites } = await loadSitesConfig();

  if (skippedSites.length > 0) {
    console.log(`Skipping ${skippedSites.length} site(s) with skip=true:`);
    skippedSites.forEach((site) => console.log(`  - ${site.name}`));
  }

  if (activeSites.length === 0) {
    console.error("No active sites to process (all sites have skip=true)");
    process.exit(1);
  }

  const modelNames = activeSites.map((s) => s.name);
  console.log(`Found ${modelNames.length} active model(s): ${modelNames.join(", ")}`);
  console.log(`Analysis model: ${config.analysis_model.name} (${config.analysis_model.model_string})`);

  console.log("\nLoading gene list...");
  const genes = await loadGeneList();
  console.log(`Found ${genes.length} genes to compare`);

  if (genes.length === 0) {
    console.error("No genes found in gene-list.txt. Please add gene IDs (one per line).");
    process.exit(1);
  }

  // Extract gene IDs for processing
  const geneIds = genes.map(g => g.id);

  // Validate that all required summary files exist
  console.log("\nValidating summary files...");
  await checkAvailableSummaries(geneIds, modelNames);
  console.log("All required summary files are present!");

  // Initialize AI client (Anthropic or OpenAI based on config)
  const aiClient = createAIClient(config.analysis_model);

  // Generate all pairwise comparisons (bidirectional)
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < modelNames.length; i++) {
    for (let j = i + 1; j < modelNames.length; j++) {
      // Both directions
      pairs.push([modelNames[i], modelNames[j]]);
      pairs.push([modelNames[j], modelNames[i]]);
    }
  }

  console.log(`\nWill generate ${pairs.length} comparisons per gene (${pairs.length / 2} pairs × 2 directions)`);
  console.log("Comparison pairs:");
  pairs.forEach(([a, b]) => console.log(`  - ${a} vs ${b}`));

  let successCount = 0;
  let errorCount = 0;

  // Process each gene
  for (const geneId of geneIds) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing gene: ${geneId}`);
    console.log("=".repeat(60));

    // Process each comparison pair
    for (const [modelA, modelB] of pairs) {
      try {
        const result = await comparePair(geneId, modelA, modelB, aiClient);

        // Save result
        const outputPath = path.join(
          process.cwd(),
          `comparison/data/comparisons/${aiClient.name}/${geneId}/${modelA}-vs-${modelB}.json`
        );
        await writeToFile(outputPath, JSON.stringify(result, null, 2));

        successCount++;
      } catch (error) {
        console.error(`  ERROR comparing ${modelA} vs ${modelB}:`, error instanceof Error ? error.message : error);
        errorCount++;
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total comparisons: ${successCount + errorCount}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${errorCount}`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
