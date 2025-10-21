import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFile } from "fs/promises";
import path from "path";
import ttest2 from "@stdlib/stats-ttest2";
import { writeToFile, createAIClient, callAI, loadGeneList, loadSitesConfig, type GeneEntry, type AICallResult } from "./shared-utils";
import type {
  Config,
  AnalysisModelConfig,
  CondensedComparison,
  StatisticalMetric,
  DescriptiveMetric,
  BiologicalContentAggregate,
  BiologicalContentMetric,
  DeterministicMetricsAggregate,
  PositionBiasAggregate,
  QuantitativeAggregates,
  QualitativeAggregates,
  QualitativeFieldAggregate,
  QualitativeDimensionAggregate,
  AggregateReport,
  ConsistencyScore,
  AgreementDistribution,
} from "./types";

// ============================================================================
// Statistical Helper Functions
// ============================================================================

/**
 * Calculate mean of an array of numbers
 */
function mean(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate standard deviation of an array of numbers
 */
function stdDev(values: number[]): number {
  const avg = mean(values);
  const squareDiffs = values.map((value) => Math.pow(value - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

/**
 * Calculate standard error
 */
function stdErr(values: number[]): number {
  return stdDev(values) / Math.sqrt(values.length);
}

/**
 * Compute descriptive statistics (mean and standard error only)
 */
function computeDescriptiveMetric(values: number[]): DescriptiveMetric {
  return {
    mean: mean(values),
    std_err: stdErr(values),
  };
}

/**
 * Generate summary string for statistical comparison
 */
function generateStatSummary(meanA: number, meanB: number, pValue: number): string {
  const pRounded = pValue.toFixed(3);

  if (pValue < 0.05) {
    if (meanA > meanB) {
      return `Model A significantly higher (p=${pRounded})`;
    } else {
      return `Model B significantly higher (p=${pRounded})`;
    }
  } else {
    return `No significant difference (p=${pRounded})`;
  }
}

/**
 * Perform t-test and return StatisticalMetric
 */
function computeStatisticalMetric(valuesA: number[], valuesB: number[]): StatisticalMetric {
  const meanA = mean(valuesA);
  const meanB = mean(valuesB);
  const stdErrA = stdErr(valuesA);
  const stdErrB = stdErr(valuesB);

  const result = ttest2(valuesA, valuesB);
  const pValue = result.pValue;

  return {
    summary: generateStatSummary(meanA, meanB, pValue),
    mean_A: meanA,
    std_err_A: stdErrA,
    mean_B: meanB,
    std_err_B: stdErrB,
    t_test_pval: pValue,
  };
}

// ============================================================================
// Gene Name Formatting
// ============================================================================

/**
 * Format gene ID with optional name
 * Returns "AGAP001212 (Gene name)" if name exists, otherwise just "AGAP001212"
 */
function formatGeneWithName(geneId: string, geneNameMap: Map<string, string | undefined>): string {
  const name = geneNameMap.get(geneId);
  return name ? `${geneId} (${name})` : geneId;
}

/**
 * Post-process aggregate report to interpolate gene names
 * Replaces gene IDs with formatted strings in arrays and prose
 */
function interpolateGeneNames(report: AggregateReport, geneNameMap: Map<string, string | undefined>): AggregateReport {
  // Deep clone the report to avoid mutations
  const processedReport = JSON.parse(JSON.stringify(report)) as AggregateReport;

  // Create regex pattern matching all gene IDs: \b(?:ID1|ID2|ID3)\b
  const geneIds = Array.from(geneNameMap.keys());
  const allGeneIdsRegex = new RegExp(`\\b(?:${geneIds.join('|')})\\b`, 'g');

  // Process position bias gene list
  if (processedReport.quantitative_aggregates.position_bias.genes_with_contradictions.length > 0) {
    processedReport.quantitative_aggregates.position_bias.genes_with_contradictions =
      processedReport.quantitative_aggregates.position_bias.genes_with_contradictions.map((geneId) =>
        formatGeneWithName(geneId, geneNameMap)
      );
  }

  // Process qualitative aggregates - all three dimensions
  const dimensions = ["tone_and_style", "technical_detail_level", "structure_and_organization"] as const;

  for (const dimension of dimensions) {
    const dimAggregate = processedReport.qualitative_aggregates[dimension];

    // Process each field (summary_A, summary_B, comparison)
    for (const field of ["summary_A", "summary_B", "comparison"] as const) {
      const fieldAggregate = dimAggregate[field];

      // Replace gene IDs in agreement distribution arrays
      const dist = fieldAggregate.agreement_distribution;
      dist.strong_agreement = dist.strong_agreement.map((id) => formatGeneWithName(id, geneNameMap));
      dist.mild_agreement = dist.mild_agreement.map((id) => formatGeneWithName(id, geneNameMap));
      dist.neutral_mixed = dist.neutral_mixed.map((id) => formatGeneWithName(id, geneNameMap));
      dist.mild_disagreement = dist.mild_disagreement.map((id) => formatGeneWithName(id, geneNameMap));
      dist.strong_disagreement = dist.strong_disagreement.map((id) => formatGeneWithName(id, geneNameMap));

      // Replace gene IDs in disagreement_analysis prose using single regex pass
      fieldAggregate.disagreement_analysis = fieldAggregate.disagreement_analysis.replace(
        allGeneIdsRegex,
        (match) => formatGeneWithName(match, geneNameMap)
      );
    }
  }

  return processedReport;
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Load all condensed comparisons for a model pair
 */
async function loadCondensedComparisons(
  geneIds: string[],
  modelA: string,
  modelB: string,
  analysisModelName: string
): Promise<CondensedComparison[]> {
  const comparisons: CondensedComparison[] = [];

  for (const geneId of geneIds) {
    const filePath = path.join(
      process.cwd(),
      `comparison/data/condensed/${analysisModelName}/${geneId}/${modelA}-${modelB}.json`
    );
    const content = await readFile(filePath, "utf-8");
    comparisons.push(JSON.parse(content));
  }

  return comparisons;
}

// ============================================================================
// Quantitative Aggregation Functions
// ============================================================================

/**
 * Aggregate biological content statistics (descriptive only, no t-tests)
 */
function aggregateBiologicalContent(
  comparisons: CondensedComparison[]
): BiologicalContentAggregate {
  // Observations
  const obsUniqueA = comparisons.map((c) => c.biological_content_summary.observations.avg_unique_to_model_A);
  const obsUniqueB = comparisons.map((c) => c.biological_content_summary.observations.avg_unique_to_model_B);
  const obsShared = comparisons.map((c) => c.biological_content_summary.observations.avg_shared);
  const obsPosVar = comparisons.map((c) => c.biological_content_summary.observations.position_variance);

  // Insights
  const insUniqueA = comparisons.map((c) => c.biological_content_summary.insights.avg_unique_to_model_A);
  const insUniqueB = comparisons.map((c) => c.biological_content_summary.insights.avg_unique_to_model_B);
  const insShared = comparisons.map((c) => c.biological_content_summary.insights.avg_shared);
  const insPosVar = comparisons.map((c) => c.biological_content_summary.insights.position_variance);

  return {
    observations: {
      avg_unique_to_model_A: computeDescriptiveMetric(obsUniqueA),
      avg_unique_to_model_B: computeDescriptiveMetric(obsUniqueB),
      avg_shared: computeDescriptiveMetric(obsShared),
      avg_position_variance: computeDescriptiveMetric(obsPosVar),
    },
    insights: {
      avg_unique_to_model_A: computeDescriptiveMetric(insUniqueA),
      avg_unique_to_model_B: computeDescriptiveMetric(insUniqueB),
      avg_shared: computeDescriptiveMetric(insShared),
      avg_position_variance: computeDescriptiveMetric(insPosVar),
    },
  };
}

/**
 * Aggregate deterministic metrics
 */
function aggregateDeterministicMetrics(
  comparisons: CondensedComparison[]
): DeterministicMetricsAggregate {
  // Collect all metric values
  const wordCountA = comparisons.map((c) => c.deterministic_metrics.model_A.word_count);
  const wordCountB = comparisons.map((c) => c.deterministic_metrics.model_B.word_count);

  const topicCountA = comparisons.map((c) => c.deterministic_metrics.model_A.topic_count);
  const topicCountB = comparisons.map((c) => c.deterministic_metrics.model_B.topic_count);

  const sentenceCountA = comparisons.map((c) => c.deterministic_metrics.model_A.sentence_count);
  const sentenceCountB = comparisons.map((c) => c.deterministic_metrics.model_B.sentence_count);

  const charCountA = comparisons.map((c) => c.deterministic_metrics.model_A.character_count);
  const charCountB = comparisons.map((c) => c.deterministic_metrics.model_B.character_count);

  const paraCountA = comparisons.map((c) => c.deterministic_metrics.model_A.paragraph_count);
  const paraCountB = comparisons.map((c) => c.deterministic_metrics.model_B.paragraph_count);

  const avgSentLengthA = comparisons.map((c) => c.deterministic_metrics.model_A.average_sentence_length);
  const avgSentLengthB = comparisons.map((c) => c.deterministic_metrics.model_B.average_sentence_length);

  // Calculate bullets percentage
  const bulletsA = comparisons.filter((c) => c.deterministic_metrics.model_A.has_bullets).length;
  const bulletsB = comparisons.filter((c) => c.deterministic_metrics.model_B.has_bullets).length;
  const percentA = (bulletsA / comparisons.length) * 100;
  const percentB = (bulletsB / comparisons.length) * 100;

  return {
    word_count: computeStatisticalMetric(wordCountA, wordCountB),
    topic_count: computeStatisticalMetric(topicCountA, topicCountB),
    sentence_count: computeStatisticalMetric(sentenceCountA, sentenceCountB),
    character_count: computeStatisticalMetric(charCountA, charCountB),
    paragraph_count: computeStatisticalMetric(paraCountA, paraCountB),
    average_sentence_length: computeStatisticalMetric(avgSentLengthA, avgSentLengthB),
    has_bullets_percent: {
      percent_A: percentA,
      percent_B: percentB,
      note: "Percentage of summaries using bullets (not t-testable)",
    },
  };
}

/**
 * Aggregate quantitative mentions
 */
function aggregateQuantitativeMentions(comparisons: CondensedComparison[]): StatisticalMetric {
  const mentionsA = comparisons.map((c) => c.quantitative_mentions.avg_model_A);
  const mentionsB = comparisons.map((c) => c.quantitative_mentions.avg_model_B);

  return computeStatisticalMetric(mentionsA, mentionsB);
}

/**
 * Aggregate position bias
 */
function aggregatePositionBias(comparisons: CondensedComparison[]): PositionBiasAggregate {
  const genesWithContradictions = comparisons
    .filter((c) => c.qualitative_assessment.contradiction_detected)
    .map((c) => c.gene_id);

  const contradictionRate = (genesWithContradictions.length / comparisons.length) * 100;

  return {
    contradiction_rate_percent: contradictionRate,
    genes_with_contradictions: genesWithContradictions,
  };
}

/**
 * Aggregate all quantitative data
 */
function aggregateQuantitativeData(comparisons: CondensedComparison[]): QuantitativeAggregates {
  return {
    biological_content: aggregateBiologicalContent(comparisons),
    deterministic_metrics: aggregateDeterministicMetrics(comparisons),
    quantitative_mentions: aggregateQuantitativeMentions(comparisons),
    position_bias: aggregatePositionBias(comparisons),
  };
}

// ============================================================================
// AI-Powered Qualitative Aggregation
// ============================================================================

/**
 * Calculate consistency score from agreement distribution
 */
function calculateConsistencyScore(distribution: AgreementDistribution): ConsistencyScore {
  const total =
    distribution.strong_agreement.length +
    distribution.mild_agreement.length +
    distribution.neutral_mixed.length +
    distribution.mild_disagreement.length +
    distribution.strong_disagreement.length;

  const agreementCount = distribution.strong_agreement.length + distribution.mild_agreement.length;
  const agreementPercent = (agreementCount / total) * 100;

  if (agreementPercent >= 80) {
    return "High consistency";
  } else if (agreementPercent >= 60) {
    return "Moderate consistency";
  } else {
    return "Low consistency";
  }
}

/**
 * Use AI to aggregate qualitative assessments for a single field
 */
async function aggregateQualitativeField(
  dimension: string,
  fieldType: "summary_A" | "summary_B" | "comparison",
  statements: Map<string, string>,
  aiClient: Anthropic | OpenAI,
  platform: 'anthropic' | 'openai',
  analysisModelString: string
): Promise<QualitativeFieldAggregate> {
  // Build statements list for prompt
  const statementsList = Array.from(statements.entries())
    .map(([geneId, statement]) => `${geneId}: ${statement}`)
    .join("\n\n");

  const prompt = `You are aggregating assessments of the **${dimension}** dimension from ${statements.size} different genes.

Here are the ${statements.size} statements:

${statementsList}

Your task:
1. Generate a consensus summary that synthesizes these statements into a coherent assessment (similar length and style to the inputs)
2. Categorize each gene by how well it agrees with the consensus:
   - Strong agreement: Fully aligned with consensus
   - Mild agreement: Mostly aligned, minor variations
   - Neutral/mixed: Neither clearly agrees nor disagrees
   - Mild disagreement: Some contradictions
   - Strong disagreement: Major contradictions
3. Describe the main axes of disagreement (if any)

Respond with JSON in this format:
\`\`\`json
{
  "consensus_summary": "Your synthesized consensus statement here",
  "agreement_distribution": {
    "strong_agreement": ["AGAP000693", "AGAP001212"],
    "mild_agreement": ["AGAP000999"],
    "neutral_mixed": [],
    "mild_disagreement": [],
    "strong_disagreement": []
  },
  "disagreement_analysis": "Description of main disagreement axes, or 'No significant disagreement' if largely consistent"
}
\`\`\`

Respond ONLY with valid JSON, no other text.`;

  try {
    const { parsed } = await callAI(
      aiClient,
      platform,
      analysisModelString,
      prompt,
      2000
    );
    const consistency_score = calculateConsistencyScore(parsed.agreement_distribution);

    return {
      consensus_summary: parsed.consensus_summary,
      consistency_score,
      agreement_distribution: parsed.agreement_distribution,
      disagreement_analysis: parsed.disagreement_analysis,
    };
  } catch (error) {
    console.error("Failed to parse AI response");
    throw new Error(`Failed to parse AI response: ${error}`);
  }
}

/**
 * Aggregate qualitative assessments for one dimension
 */
async function aggregateQualitativeDimension(
  dimension: "tone_and_style" | "technical_detail_level" | "structure_and_organization",
  comparisons: CondensedComparison[],
  aiClient: Anthropic | OpenAI,
  platform: 'anthropic' | 'openai',
  analysisModelString: string
): Promise<QualitativeDimensionAggregate> {
  console.log(`  Aggregating ${dimension}...`);

  // Extract statements for each field
  const summaryA_statements = new Map<string, string>();
  const summaryB_statements = new Map<string, string>();
  const comparison_statements = new Map<string, string>();

  for (const comp of comparisons) {
    const assessment = comp.qualitative_assessment[dimension];
    summaryA_statements.set(comp.gene_id, assessment.summary_A);
    summaryB_statements.set(comp.gene_id, assessment.summary_B);
    comparison_statements.set(comp.gene_id, assessment.comparison);
  }

  // Aggregate each field with AI
  const [summary_A, summary_B, comparison] = await Promise.all([
    aggregateQualitativeField(dimension, "summary_A", summaryA_statements, aiClient, platform, analysisModelString),
    aggregateQualitativeField(dimension, "summary_B", summaryB_statements, aiClient, platform, analysisModelString),
    aggregateQualitativeField(dimension, "comparison", comparison_statements, aiClient, platform, analysisModelString),
  ]);

  return {
    summary_A,
    summary_B,
    comparison,
  };
}

/**
 * Aggregate all qualitative data
 */
async function aggregateQualitativeData(
  comparisons: CondensedComparison[],
  aiClient: Anthropic | OpenAI,
  platform: 'anthropic' | 'openai',
  analysisModelString: string
): Promise<QualitativeAggregates> {
  console.log("\nAggregating qualitative assessments...");

  const tone_and_style = await aggregateQualitativeDimension("tone_and_style", comparisons, aiClient, platform, analysisModelString);
  const technical_detail_level = await aggregateQualitativeDimension(
    "technical_detail_level",
    comparisons,
    aiClient,
    platform,
    analysisModelString
  );
  const structure_and_organization = await aggregateQualitativeDimension(
    "structure_and_organization",
    comparisons,
    aiClient,
    platform,
    analysisModelString
  );

  return {
    tone_and_style,
    technical_detail_level,
    structure_and_organization,
  };
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Get sorted model pair name (alphabetically)
 */
function getSortedPair(modelA: string, modelB: string): [string, string] {
  return modelA < modelB ? [modelA, modelB] : [modelB, modelA];
}

/**
 * Process one model pair and generate aggregate report
 */
async function processModelPair(
  modelA: string,
  modelB: string,
  genes: GeneEntry[],
  aiClient: Anthropic | OpenAI,
  platform: 'anthropic' | 'openai',
  analysisModelName: string,
  analysisModelString: string
): Promise<void> {
  console.log(`\nProcessing model pair: ${modelA} <-> ${modelB}`);
  console.log("=".repeat(60));

  // Extract gene IDs for loading data files
  const geneIds = genes.map((g) => g.id);

  // Create gene name mapping for interpolation
  const geneNameMap = new Map<string, string | undefined>(genes.map((g) => [g.id, g.name]));

  // Load all condensed comparisons
  console.log("Loading condensed comparisons...");
  const comparisons = await loadCondensedComparisons(geneIds, modelA, modelB, analysisModelName);
  console.log(`Loaded ${comparisons.length} comparisons`);

  // Aggregate quantitative data
  console.log("\nAggregating quantitative data...");
  const quantitative_aggregates = aggregateQuantitativeData(comparisons);

  // Aggregate qualitative data (with AI)
  const qualitative_aggregates = await aggregateQualitativeData(comparisons, aiClient, platform, analysisModelString);

  // Build report
  let report: AggregateReport = {
    model_pair: {
      model_A: modelA,
      model_B: modelB,
    },
    gene_count: comparisons.length,
    quantitative_aggregates,
    qualitative_aggregates,
  };

  // Interpolate gene names into the report
  console.log("\nInterpolating gene names into report...");
  report = interpolateGeneNames(report, geneNameMap);

  // Save report
  const outputPath = path.join(
    process.cwd(),
    `comparison/data/aggregate-reports/${analysisModelName}/${modelA}-${modelB}-report.json`
  );
  await writeToFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${outputPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(60));
  console.log("AGGREGATE ANALYSIS");
  console.log("=".repeat(60));

  // Load configuration
  console.log("\nLoading configuration...");
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

  // Load gene list
  console.log("\nLoading gene list...");
  const genes = await loadGeneList();
  console.log(`Found ${genes.length} genes to aggregate`);

  if (genes.length === 0) {
    console.error("No genes found in gene-list.txt. Please add gene IDs (one per line).");
    process.exit(1);
  }

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

  console.log(`\nWill process ${pairs.length} model pairs:`);
  pairs.forEach(([a, b]) => console.log(`  - ${a} <-> ${b}`));

  let successCount = 0;
  let errorCount = 0;

  // Process each model pair
  for (const [modelA, modelB] of pairs) {
    try {
      await processModelPair(
        modelA,
        modelB,
        genes,
        aiClient,
        config.analysis_model.platform,
        config.analysis_model.name,
        config.analysis_model.model_string
      );
      successCount++;
    } catch (error) {
      console.error(`\nERROR processing ${modelA} <-> ${modelB}:`, error instanceof Error ? error.message : error);
      errorCount++;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total model pairs: ${pairs.length}`);
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
