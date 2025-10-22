import "dotenv/config";
import { readFile, readdir } from "fs/promises";
import path from "path";
import { writeToFile, loadGeneList, loadSitesConfig, type GeneEntry } from "./shared-utils";
import type { AggregateReport, StatisticalMetric, DescriptiveMetric } from "./types";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a number with specified decimal places
 */
function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

/**
 * Format a statistical metric with mean ± std_err
 */
function formatStatMetric(metric: StatisticalMetric | DescriptiveMetric): string {
  if ('mean_A' in metric) {
    // StatisticalMetric
    return `
      <div class="flex justify-between items-center">
        <div>
          <span class="font-semibold">Model A:</span> ${formatNumber(metric.mean_A)} ± ${formatNumber(metric.std_err_A)}
        </div>
        <div>
          <span class="font-semibold">Model B:</span> ${formatNumber(metric.mean_B)} ± ${formatNumber(metric.std_err_B)}
        </div>
        <div class="text-sm text-gray-600">
          p = ${formatNumber(metric.t_test_pval, 4)}
        </div>
      </div>
      <div class="text-sm text-gray-700 mt-1">${metric.summary}</div>
    `;
  } else {
    // DescriptiveMetric
    return `${formatNumber(metric.mean)} ± ${formatNumber(metric.std_err)}`;
  }
}

/**
 * Get the full model display name from short name
 */
function getModelDisplayName(shortName: string, sites: Array<{ name: string; model: string }>): string {
  const site = sites.find(s => s.name === shortName);
  return site ? site.model : shortName;
}

/**
 * Replace "Model A" / "Model B" with actual model names in text
 */
function replaceModelNames(text: string, modelAName: string, modelBName: string): string {
  return text
    .replace(/\bModel A\b/g, modelAName)
    .replace(/\bModel B\b/g, modelBName)
    .replace(/\bSummary A\b/g, modelAName)
    .replace(/\bSummary B\b/g, modelBName);
}

/**
 * Extract gene ID from formatted string like "AGAP001212 (Gene name)" or "AGAP001212"
 * Returns the first non-whitespace word
 */
function extractGeneId(formattedGene: string): string {
  return formattedGene.trim().split(/\s+/)[0];
}

/**
 * Create HTML link for a gene with CSS-only popup showing both model options
 */
function createGeneLink(formattedGene: string, modelAShort: string, modelBShort: string, modelADisplay: string, modelBDisplay: string): string {
  const geneId = extractGeneId(formattedGene);
  return `<span class="gene-link-wrapper">${formattedGene}<span class="gene-link-popup"><a href="html-summaries/${geneId}-${modelAShort}.html" target="_blank">${modelADisplay}</a><a href="html-summaries/${geneId}-${modelBShort}.html" target="_blank">${modelBDisplay}</a></span></span>`;
}

/**
 * Convert list of formatted gene strings into linked HTML
 */
function createGeneLinks(formattedGenes: string[], modelAShort: string, modelBShort: string, modelADisplay: string, modelBDisplay: string): string {
  return formattedGenes.map(g => createGeneLink(g, modelAShort, modelBShort, modelADisplay, modelBDisplay)).join(", ");
}

// ============================================================================
// HTML Generation Functions
// ============================================================================

/**
 * Generate header section HTML
 */
function generateHeader(
  report: AggregateReport,
  modelAName: string,
  modelBName: string,
  modelAShort: string,
  modelBShort: string,
  analysisModelName: string,
  genes: GeneEntry[]
): string {
  const formattedGenes = genes.map(g => g.name ? `${g.id} (${g.name})` : g.id);
  const genesList = createGeneLinks(formattedGenes, modelAShort, modelBShort, modelAName, modelBName);

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h1 class="text-3xl font-bold text-gray-800 mb-4">
        VEuPathDB AI Gene Expression Summaries: Model Comparison Report
      </h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h2 class="text-xl font-semibold text-gray-700 mb-2">Models Compared</h2>
          <p class="text-gray-600"><span class="font-semibold">Model A:</span> ${modelAName}</p>
          <p class="text-gray-600"><span class="font-semibold">Model B:</span> ${modelBName}</p>
        </div>
        <div>
          <h2 class="text-xl font-semibold text-gray-700 mb-2">Analysis Details</h2>
          <p class="text-gray-600"><span class="font-semibold">Analysis Model:</span> ${analysisModelName}</p>
          <p class="text-gray-600"><span class="font-semibold">Gene Count:</span> ${report.gene_count}</p>
        </div>
      </div>
      <div class="mt-4">
        <h2 class="text-xl font-semibold text-gray-700 mb-2">Genes Analyzed</h2>
        <p class="text-sm text-gray-600">${genesList}</p>
      </div>
      <div class="mt-4 bg-blue-50 border-l-4 border-blue-400 p-3">
        <p class="text-sm text-gray-700">
          <span class="font-semibold">Note:</span> All numeric results are presented as <strong>mean ± standard error</strong>
          (standard error of the mean, or SEM), which indicates the precision of the mean estimate across the ${report.gene_count} genes analyzed.
        </p>
      </div>
    </div>
  `;
}

/**
 * Generate biological content section HTML
 */
function generateBiologicalContentSection(
  report: AggregateReport,
  modelAName: string,
  modelBName: string
): string {
  const bio = report.quantitative_aggregates.biological_content;

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Biological Content</h2>

      <div class="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4">
        <p class="text-sm text-gray-700">
          <span class="font-semibold">Note:</span> Statistical significance tests are not performed for biological content metrics.
          These observations and insights have not been expert-validated, so we present descriptive statistics only without
          making claims about which model performs better or worse.
        </p>
      </div>

      <h3 class="text-xl font-semibold text-gray-700 mb-3">Observations</h3>
      <div class="space-y-3 mb-6">
        <div class="border-l-4 border-blue-500 pl-4">
          <p class="font-semibold text-gray-700">Unique to ${modelAName}</p>
          <p class="text-gray-600">${formatStatMetric(bio.observations.avg_unique_to_model_A)}</p>
        </div>
        <div class="border-l-4 border-green-500 pl-4">
          <p class="font-semibold text-gray-700">Unique to ${modelBName}</p>
          <p class="text-gray-600">${formatStatMetric(bio.observations.avg_unique_to_model_B)}</p>
        </div>
        <div class="border-l-4 border-purple-500 pl-4">
          <p class="font-semibold text-gray-700">Shared</p>
          <p class="text-gray-600">${formatStatMetric(bio.observations.avg_shared)}</p>
        </div>
        <div class="border-l-4 border-orange-500 pl-4">
          <p class="font-semibold text-gray-700">Position Variance</p>
          <p class="text-gray-600">${formatStatMetric(bio.observations.avg_position_variance)}</p>
        </div>
      </div>

      <h3 class="text-xl font-semibold text-gray-700 mb-3">Insights</h3>
      <div class="space-y-3">
        <div class="border-l-4 border-blue-500 pl-4">
          <p class="font-semibold text-gray-700">Unique to ${modelAName}</p>
          <p class="text-gray-600">${formatStatMetric(bio.insights.avg_unique_to_model_A)}</p>
        </div>
        <div class="border-l-4 border-green-500 pl-4">
          <p class="font-semibold text-gray-700">Unique to ${modelBName}</p>
          <p class="text-gray-600">${formatStatMetric(bio.insights.avg_unique_to_model_B)}</p>
        </div>
        <div class="border-l-4 border-purple-500 pl-4">
          <p class="font-semibold text-gray-700">Shared</p>
          <p class="text-gray-600">${formatStatMetric(bio.insights.avg_shared)}</p>
        </div>
        <div class="border-l-4 border-orange-500 pl-4">
          <p class="font-semibold text-gray-700">Position Variance</p>
          <p class="text-gray-600">${formatStatMetric(bio.insights.avg_position_variance)}</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate deterministic metrics section HTML
 */
function generateDeterministicMetricsSection(
  report: AggregateReport,
  modelAName: string,
  modelBName: string
): string {
  const metrics = report.quantitative_aggregates.deterministic_metrics;

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Deterministic Metrics</h2>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metric</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${modelAName}</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${modelBName}</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">p-value</th>
              <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr class="${metrics.word_count.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Word Count</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.word_count.mean_A)} ± ${formatNumber(metrics.word_count.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.word_count.mean_B)} ± ${formatNumber(metrics.word_count.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.word_count.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.word_count.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.topic_count.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Topic Count</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.topic_count.mean_A)} ± ${formatNumber(metrics.topic_count.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.topic_count.mean_B)} ± ${formatNumber(metrics.topic_count.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.topic_count.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.topic_count.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.sentence_count.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Sentence Count</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.sentence_count.mean_A)} ± ${formatNumber(metrics.sentence_count.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.sentence_count.mean_B)} ± ${formatNumber(metrics.sentence_count.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.sentence_count.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.sentence_count.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.character_count.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Character Count</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.character_count.mean_A)} ± ${formatNumber(metrics.character_count.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.character_count.mean_B)} ± ${formatNumber(metrics.character_count.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.character_count.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.character_count.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.paragraph_count.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Paragraph Count</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.paragraph_count.mean_A)} ± ${formatNumber(metrics.paragraph_count.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.paragraph_count.mean_B)} ± ${formatNumber(metrics.paragraph_count.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.paragraph_count.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.paragraph_count.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.average_sentence_length.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Avg Sentence Length</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.average_sentence_length.mean_A)} ± ${formatNumber(metrics.average_sentence_length.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.average_sentence_length.mean_B)} ± ${formatNumber(metrics.average_sentence_length.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.average_sentence_length.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.average_sentence_length.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.mean_ai_topic_size.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Mean AI Topic Size</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.mean_ai_topic_size.mean_A)} ± ${formatNumber(metrics.mean_ai_topic_size.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.mean_ai_topic_size.mean_B)} ± ${formatNumber(metrics.mean_ai_topic_size.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.mean_ai_topic_size.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.mean_ai_topic_size.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="${metrics.other_topic_size.summary.includes('No significant') ? 'opacity-50' : ''}">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Other Topic Size</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.other_topic_size.mean_A)} ± ${formatNumber(metrics.other_topic_size.std_err_A)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.other_topic_size.mean_B)} ± ${formatNumber(metrics.other_topic_size.std_err_B)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.other_topic_size.t_test_pval, 4)}</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${replaceModelNames(metrics.other_topic_size.summary, modelAName, modelBName)}</td>
            </tr>
            <tr class="opacity-50">
              <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">Has Bullets %</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.has_bullets_percent.percent_A)}%</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">${formatNumber(metrics.has_bullets_percent.percent_B)}%</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">N/A</td>
              <td class="px-6 py-4 text-sm font-medium text-gray-700">${metrics.has_bullets_percent.note}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Generate quantitative mentions and position bias section HTML
 */
function generateQuantitativeMentionsSection(
  report: AggregateReport,
  modelAName: string,
  modelBName: string,
  modelAShort: string,
  modelBShort: string
): string {
  const quant = report.quantitative_aggregates.quantitative_mentions;
  const bias = report.quantitative_aggregates.position_bias;

  const genesWithContradictions = bias.genes_with_contradictions.length > 0
    ? createGeneLinks(bias.genes_with_contradictions, modelAShort, modelBShort, modelAName, modelBName)
    : "None";

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Quantitative Expression Mentions</h2>

      <div class="bg-gray-50 p-4 rounded-lg mb-4">
        <p class="text-sm text-gray-700">
          <span class="font-semibold">What are Quantitative Expression Mentions?</span> These are specific numeric values
          cited in the AI-generated summaries, such as fold changes, TPM (transcripts per million) values, and percentile ranks.
          A higher count indicates more evidence-based, data-rich summaries.
        </p>
      </div>

      <div class="space-y-3 mb-6">
        <div class="border-l-4 border-blue-500 pl-4">
          <p class="font-semibold text-gray-700">${modelAName}</p>
          <p class="text-gray-600">${formatNumber(quant.mean_A)} ± ${formatNumber(quant.std_err_A)}</p>
        </div>
        <div class="border-l-4 border-green-500 pl-4">
          <p class="font-semibold text-gray-700">${modelBName}</p>
          <p class="text-gray-600">${formatNumber(quant.mean_B)} ± ${formatNumber(quant.std_err_B)}</p>
        </div>
        <div class="border-l-4 border-purple-500 pl-4">
          <p class="font-semibold text-gray-700">Statistical Test</p>
          <p class="text-gray-600">${replaceModelNames(quant.summary, modelAName, modelBName)}</p>
        </div>
      </div>

      <h2 class="text-2xl font-bold text-gray-800 mb-4 mt-6">Position Bias Analysis</h2>

      <div class="bg-gray-50 p-4 rounded-lg mb-4">
        <p class="text-sm text-gray-700">
          <span class="font-semibold">What is Position Bias?</span> When asking AI (or humans) to make comparative judgments,
          the order of presentation can influence the result. To detect this bias, we compare each pair of summaries twice—once
          as "A vs B" and again as "B vs A"—and check whether the qualitative assessments contradict each other. A low
          contradiction rate indicates robust, order-independent judgments.
        </p>
      </div>

      <div class="space-y-3">
        <div class="border-l-4 border-red-500 pl-4">
          <p class="font-semibold text-gray-700">Contradiction Rate</p>
          <p class="text-gray-600">${formatNumber(bias.contradiction_rate_percent)}%</p>
        </div>
        <div class="border-l-4 border-yellow-500 pl-4">
          <p class="font-semibold text-gray-700">Genes with Contradictions</p>
          <p class="text-sm text-gray-600">${genesWithContradictions}</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate qualitative aggregates section HTML (comparison only)
 */
function generateQualitativeSection(
  report: AggregateReport,
  modelAName: string,
  modelBName: string,
  modelAShort: string,
  modelBShort: string
): string {
  const qual = report.qualitative_aggregates;

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Qualitative Comparison</h2>

      <div class="space-y-6">
        <div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">Tone and Style</h3>
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-gray-700">${replaceModelNames(qual.tone_and_style.comparison.consensus_summary, modelAName, modelBName)}</p>
          </div>
          <p class="text-sm text-gray-600 mt-2">
            <span class="font-semibold">Modal representative:</span> ${createGeneLink(qual.tone_and_style.comparison.modal_representative, modelAShort, modelBShort, modelAName, modelBName)}
          </p>
          <p class="text-sm text-gray-600 mt-1 italic">
            Consistency of this pattern across ${report.gene_count} independently assessed genes: ${qual.tone_and_style.comparison.consistency_score}
          </p>
        </div>

        <div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">Technical Detail Level</h3>
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-gray-700">${replaceModelNames(qual.technical_detail_level.comparison.consensus_summary, modelAName, modelBName)}</p>
          </div>
          <p class="text-sm text-gray-600 mt-2">
            <span class="font-semibold">Modal representative:</span> ${createGeneLink(qual.technical_detail_level.comparison.modal_representative, modelAShort, modelBShort, modelAName, modelBName)}
          </p>
          <p class="text-sm text-gray-600 mt-1 italic">
            Consistency of this pattern across ${report.gene_count} independently assessed genes: ${qual.technical_detail_level.comparison.consistency_score}
          </p>
        </div>

        <div>
          <h3 class="text-xl font-semibold text-gray-700 mb-2">Structure and Organization</h3>
          <div class="bg-gray-50 p-4 rounded-lg">
            <p class="text-gray-700">${replaceModelNames(qual.structure_and_organization.comparison.consensus_summary, modelAName, modelBName)}</p>
          </div>
          <p class="text-sm text-gray-600 mt-2">
            <span class="font-semibold">Modal representative:</span> ${createGeneLink(qual.structure_and_organization.comparison.modal_representative, modelAShort, modelBShort, modelAName, modelBName)}
          </p>
          <p class="text-sm text-gray-600 mt-1 italic">
            Consistency of this pattern across ${report.gene_count} independently assessed genes: ${qual.structure_and_organization.comparison.consistency_score}
          </p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate complete HTML report
 */
function generateHTMLReport(
  report: AggregateReport,
  modelAName: string,
  modelBName: string,
  modelAShort: string,
  modelBShort: string,
  analysisModelName: string,
  genes: GeneEntry[]
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${modelAName} vs ${modelBName} - Comparison Report</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Gene link popup styling */
    .gene-link-wrapper {
      position: relative;
      display: inline-block;
      cursor: pointer;
      color: #2563eb;
      text-decoration: underline;
      text-decoration-style: dotted;
    }

    .gene-link-popup {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 8px;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      white-space: nowrap;
      min-width: 200px;
    }

    .gene-link-popup::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: white;
    }

    .gene-link-wrapper:hover .gene-link-popup {
      display: block;
    }

    .gene-link-popup a {
      display: block;
      padding: 6px 12px;
      color: #1f2937;
      text-decoration: none;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .gene-link-popup a:hover {
      background-color: #f3f4f6;
    }

    .gene-link-popup a:first-child {
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 4px;
      padding-bottom: 8px;
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen py-8">
  <div class="container mx-auto px-4 max-w-7xl">
    ${generateHeader(report, modelAName, modelBName, modelAShort, modelBShort, analysisModelName, genes)}
    ${generateBiologicalContentSection(report, modelAName, modelBName)}
    ${generateDeterministicMetricsSection(report, modelAName, modelBName)}
    ${generateQuantitativeMentionsSection(report, modelAName, modelBName, modelAShort, modelBShort)}
    ${generateQualitativeSection(report, modelAName, modelBName, modelAShort, modelBShort)}

    <footer class="text-center text-gray-500 text-sm mt-8">
      Generated on ${new Date().toLocaleString()}
    </footer>
  </div>
</body>
</html>`;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("HTML REPORT GENERATION");
  console.log("=".repeat(60));

  // Load configuration
  console.log("\nLoading configuration...");
  const { config, activeSites } = await loadSitesConfig();
  console.log(`Analysis model: ${config.analysis_model.name}`);

  // Load gene list
  console.log("\nLoading gene list...");
  const genes = await loadGeneList();
  console.log(`Found ${genes.length} genes`);

  // Find all aggregate report JSON files for this analysis model
  const aggregateDir = path.join(process.cwd(), `comparison/data/aggregate-reports/${config.analysis_model.name}`);
  console.log(`\nScanning directory: ${aggregateDir}`);

  let reportFiles: string[];
  try {
    const allFiles = await readdir(aggregateDir);
    reportFiles = allFiles.filter(f => f.endsWith("-report.json"));
    console.log(`Found ${reportFiles.length} aggregate report(s)`);
  } catch (error) {
    console.error(`Error reading aggregate reports directory: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (reportFiles.length === 0) {
    console.error("No aggregate reports found. Run Phase 3 (yarn comparison:aggregate) first.");
    process.exit(1);
  }

  // Process each report
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const reportFile of reportFiles) {
    try {
      console.log(`\nProcessing: ${reportFile}`);

      // Load the JSON report
      const reportPath = path.join(aggregateDir, reportFile);
      const reportContent = await readFile(reportPath, "utf-8");
      const report: AggregateReport = JSON.parse(reportContent);

      // Check if both models exist in activeSites
      const modelAExists = activeSites.some(s => s.name === report.model_pair.model_A);
      const modelBExists = activeSites.some(s => s.name === report.model_pair.model_B);

      if (!modelAExists || !modelBExists) {
        const missing = [];
        if (!modelAExists) missing.push(report.model_pair.model_A);
        if (!modelBExists) missing.push(report.model_pair.model_B);
        console.log(`  SKIPPED: Model(s) not in active sites: ${missing.join(", ")}`);
        skippedCount++;
        continue;
      }

      // Get full model display names
      const modelAName = getModelDisplayName(report.model_pair.model_A, activeSites);
      const modelBName = getModelDisplayName(report.model_pair.model_B, activeSites);
      const modelAShort = report.model_pair.model_A;
      const modelBShort = report.model_pair.model_B;
      const analysisModelName = config.analysis_model.model || config.analysis_model.name;

      console.log(`  Models: ${modelAName} vs ${modelBName}`);

      // Generate HTML
      const html = generateHTMLReport(report, modelAName, modelBName, modelAShort, modelBShort, analysisModelName, genes);

      // Write HTML file
      const htmlFileName = reportFile.replace("-report.json", "-report.html");
      const htmlPath = path.join(aggregateDir, htmlFileName);
      await writeToFile(htmlPath, html);

      successCount++;
    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : error}`);
      errorCount++;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total reports: ${reportFiles.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Skipped: ${skippedCount}`);
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
