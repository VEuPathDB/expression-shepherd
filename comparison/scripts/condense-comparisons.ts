import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { writeToFile, createAIClient, AIClient, loadGeneList, loadSitesConfig } from "./shared-utils";
import type {
  Config,
  SiteConfig,
  AnalysisModelConfig,
  BiologicalContentCounts,
  BiologicalContent,
  QualitativeCategory,
  QualitativeAssessment,
  DeterministicMetrics,
  QuantitativeMentions,
  ComparisonResult,
  BiologicalContentSummary,
  MergedQualitativeAssessment,
  CondensedComparison,
} from "./types";

// ============================================================================
// Calculation Functions
// ============================================================================

/**
 * Calculate summary statistics for biological content from both directions
 */
function summarizeBiologicalContent(
  comparison1: ComparisonResult,
  comparison2: ComparisonResult,
  category: "observations" | "insights"
): BiologicalContentSummary {
  // In comparison1: model_A vs model_B (A first)
  // In comparison2: model_B vs model_A (B first)
  // So comparison1.only_in_A and comparison2.only_in_B both refer to the same model

  const uniqueToA_dir1 = comparison1.biological_content[category].only_in_A.length;
  const uniqueToA_dir2 = comparison2.biological_content[category].only_in_B.length;
  const avg_unique_to_model_A = (uniqueToA_dir1 + uniqueToA_dir2) / 2;

  const uniqueToB_dir1 = comparison1.biological_content[category].only_in_B.length;
  const uniqueToB_dir2 = comparison2.biological_content[category].only_in_A.length;
  const avg_unique_to_model_B = (uniqueToB_dir1 + uniqueToB_dir2) / 2;

  const shared_dir1 = comparison1.biological_content[category].in_both.length;
  const shared_dir2 = comparison2.biological_content[category].in_both.length;
  const avg_shared = (shared_dir1 + shared_dir2) / 2;

  // Calculate variance as a simple measure of consistency between directions
  const variance_A = Math.abs(uniqueToA_dir1 - uniqueToA_dir2);
  const variance_B = Math.abs(uniqueToB_dir1 - uniqueToB_dir2);
  const position_variance = (variance_A + variance_B) / 2;

  return {
    avg_unique_to_model_A,
    avg_unique_to_model_B,
    avg_shared,
    position_variance,
  };
}

// ============================================================================
// AI-Powered Merging
// ============================================================================

/**
 * Swap "Summary A" and "Summary B" text references within a string
 */
function swapSummaryLabelsInText(text: string): string {
  return text.replace(/Summary ([AB])/g, (match, letter) => {
    return letter === 'A' ? 'Summary B' : 'Summary A';
  });
}

/**
 * Swap summary_A and summary_B labels in an assessment
 * Used to normalize the second assessment so both use the same labels
 */
function swapAssessmentLabels(assessment: QualitativeAssessment): QualitativeAssessment {
  return {
    tone_and_style: {
      summary_A: swapSummaryLabelsInText(assessment.tone_and_style.summary_B),
      summary_B: swapSummaryLabelsInText(assessment.tone_and_style.summary_A),
      comparison: swapSummaryLabelsInText(assessment.tone_and_style.comparison),
    },
    technical_detail_level: {
      summary_A: swapSummaryLabelsInText(assessment.technical_detail_level.summary_B),
      summary_B: swapSummaryLabelsInText(assessment.technical_detail_level.summary_A),
      comparison: swapSummaryLabelsInText(assessment.technical_detail_level.comparison),
    },
    structure_and_organization: {
      summary_A: swapSummaryLabelsInText(assessment.structure_and_organization.summary_B),
      summary_B: swapSummaryLabelsInText(assessment.structure_and_organization.summary_A),
      comparison: swapSummaryLabelsInText(assessment.structure_and_organization.comparison),
    },
    headline: {
      summary_A: swapSummaryLabelsInText(assessment.headline.summary_B),
      summary_B: swapSummaryLabelsInText(assessment.headline.summary_A),
      comparison: swapSummaryLabelsInText(assessment.headline.comparison),
    },
  };
}

/**
 * Use AI to merge qualitative assessments from both directions
 */
async function mergeQualitativeAssessments(
  geneId: string,
  assessment1: QualitativeAssessment,
  assessment2: QualitativeAssessment,
  aiClient: AIClient
): Promise<MergedQualitativeAssessment> {
  // Swap labels in assessment2 so both assessments use the same A/B labels
  const assessment2_normalized = swapAssessmentLabels(assessment2);

  const prompt = `You are merging two qualitative assessments of gene expression summaries for gene ${geneId}.

Both assessments evaluated the same two summaries (Summary A and Summary B).

Assessment 1:
\`\`\`json
${JSON.stringify(assessment1, null, 2)}
\`\`\`

Assessment 2:
\`\`\`json
${JSON.stringify(assessment2_normalized, null, 2)}
\`\`\`

Your task: Synthesize these into a single consolidated assessment. If they largely agree, merge them into a coherent summary. If they contradict, note the contradictions.

IMPORTANT: Use only "Summary A" and "Summary B" labels.

Respond with JSON in this format:
\`\`\`json
{
  "tone_and_style": {
    "summary_A": "consolidated description of Summary A's tone",
    "summary_B": "consolidated description of Summary B's tone",
    "comparison": "merged comparison"
  },
  "technical_detail_level": {
    "summary_A": "consolidated assessment of Summary A's detail level",
    "summary_B": "consolidated assessment of Summary B's detail level",
    "comparison": "merged comparison"
  },
  "structure_and_organization": {
    "summary_A": "consolidated assessment of Summary A's structure",
    "summary_B": "consolidated assessment of Summary B's structure",
    "comparison": "merged comparison"
  },
  "headline": {
    "summary_A": "consolidated assessment of Summary A's headline",
    "summary_B": "consolidated assessment of Summary B's headline",
    "comparison": "merged comparison"
  },
  "contradiction_detected": true or false (set to true if assessments contradict significantly),
  "merge_notes": "Brief notes on consistency or contradictions"
}
\`\`\`

Respond ONLY with valid JSON, no other text.`;

  try {
    const { parsed } = await aiClient.call(prompt, 2000);
    return parsed;
  } catch (error) {
    console.error("Failed to parse AI response");
    throw new Error(`Failed to parse AI response: ${error}`);
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Load comparison result for a specific gene and model pair
 */
async function loadComparison(geneId: string, modelA: string, modelB: string, analysisModelName: string): Promise<ComparisonResult> {
  const comparisonPath = path.join(
    process.cwd(),
    `comparison/data/comparisons/${analysisModelName}/${geneId}/${modelA}-vs-${modelB}.json`
  );
  const content = await readFile(comparisonPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Get sorted model pair name (alphabetically)
 */
function getSortedPair(modelA: string, modelB: string): [string, string] {
  return modelA < modelB ? [modelA, modelB] : [modelB, modelA];
}

// ============================================================================
// Main Condensation Logic
// ============================================================================

/**
 * Condense a pair of bidirectional comparisons
 */
async function condensePair(
  geneId: string,
  modelA: string,
  modelB: string,
  aiClient: AIClient
): Promise<CondensedComparison> {
  console.log(`  Condensing ${modelA} <-> ${modelB}...`);

  // Load both directions
  const comparison_AvsB = await loadComparison(geneId, modelA, modelB, aiClient.name);
  const comparison_BvsA = await loadComparison(geneId, modelB, modelA, aiClient.name);

  // Summarize biological content
  const observations_summary = summarizeBiologicalContent(comparison_AvsB, comparison_BvsA, "observations");
  const insights_summary = summarizeBiologicalContent(comparison_AvsB, comparison_BvsA, "insights");

  // Merge qualitative assessments with AI
  const merged_qualitative = await mergeQualitativeAssessments(
    geneId,
    comparison_AvsB.qualitative_assessment,
    comparison_BvsA.qualitative_assessment,
    aiClient
  );

  // Average quantitative mentions
  const avg_model_A =
    (comparison_AvsB.quantitative_expression_mentions.summary_A +
      comparison_BvsA.quantitative_expression_mentions.summary_B) /
    2;
  const avg_model_B =
    (comparison_AvsB.quantitative_expression_mentions.summary_B +
      comparison_BvsA.quantitative_expression_mentions.summary_A) /
    2;

  return {
    gene_id: geneId,
    model_A: modelA,
    model_B: modelB,
    biological_content_summary: {
      observations: observations_summary,
      insights: insights_summary,
    },
    qualitative_assessment: merged_qualitative,
    deterministic_metrics: {
      model_A: comparison_AvsB.deterministic_metrics.summary_A,
      model_B: comparison_AvsB.deterministic_metrics.summary_B,
    },
    quantitative_mentions: {
      avg_model_A,
      avg_model_B,
    },
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
  console.log(`Found ${genes.length} genes to condense`);

  if (genes.length === 0) {
    console.error("No genes found in gene-list.txt. Please add gene IDs (one per line).");
    process.exit(1);
  }

  // Extract gene IDs for processing
  const geneIds = genes.map(g => g.id);

  // Initialize AI client (Anthropic or OpenAI based on config)
  const aiClient = createAIClient(config.analysis_model);

  // Generate all unique model pairs (alphabetically sorted)
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < modelNames.length; i++) {
    for (let j = i + 1; j < modelNames.length; j++) {
      const [sortedA, sortedB] = getSortedPair(modelNames[i], modelNames[j]);
      pairs.push([sortedA, sortedB]);
    }
  }

  console.log(`\nWill condense ${pairs.length} model pairs`);
  console.log("Model pairs:");
  pairs.forEach(([a, b]) => console.log(`  - ${a} <-> ${b}`));

  let successCount = 0;
  let errorCount = 0;

  // Process each gene
  for (const geneId of geneIds) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing gene: ${geneId}`);
    console.log("=".repeat(60));

    // Process each model pair
    for (const [modelA, modelB] of pairs) {
      try {
        const result = await condensePair(geneId, modelA, modelB, aiClient);

        // Save result
        const outputPath = path.join(
          process.cwd(),
          `comparison/data/condensed/${aiClient.name}/${geneId}/${modelA}-${modelB}.json`
        );
        await writeToFile(outputPath, JSON.stringify(result, null, 2));

        successCount++;
      } catch (error) {
        console.error(`  ERROR condensing ${modelA} <-> ${modelB}:`, error instanceof Error ? error.message : error);
        errorCount++;
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total condensations: ${successCount + errorCount}`);
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
