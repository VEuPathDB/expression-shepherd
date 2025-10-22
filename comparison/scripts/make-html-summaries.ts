import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { writeToFile, loadGeneList, loadSitesConfig, type GeneEntry } from "./shared-utils";
import type { ExpressionSummary, Topic, ExperimentSummary, SiteConfig, PublicSiteConfig } from "./types";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize HTML to allow only specific tags without attributes
 * Allowed tags: <strong>, <i>, <ul>, <li>
 */
function sanitizeHtml(html: string): string {
  // First, escape all HTML
  let sanitized = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Then, restore only the allowed tags (without attributes)
  const allowedTags = ['strong', 'i', 'ul', 'li'];

  for (const tag of allowedTags) {
    // Opening tags: match <tag> or <tag ...attributes...>
    const openRegex = new RegExp(`&lt;${tag}(?:\\s[^&]*?)?&gt;`, 'gi');
    sanitized = sanitized.replace(openRegex, `<${tag}>`);

    // Closing tags
    const closeRegex = new RegExp(`&lt;/${tag}&gt;`, 'gi');
    sanitized = sanitized.replace(closeRegex, `</${tag}>`);
  }

  return sanitized;
}

/**
 * Escape HTML special characters (for fields that should have NO HTML)
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format gene display name
 */
function formatGeneDisplay(geneId: string, geneName?: string): string {
  return geneName ? `${geneId} (${geneName})` : geneId;
}

// ============================================================================
// HTML Generation Functions
// ============================================================================

/**
 * Generate header section HTML
 */
function generateHeader(
  geneId: string,
  geneName: string | undefined,
  modelDisplayName: string,
  headline: string,
  site: SiteConfig,
  publicSite: PublicSiteConfig
): string {
  const geneDisplay = geneName
    ? `${escapeHtml(geneId)} (${escapeHtml(geneName)})`
    : escapeHtml(geneId);

  // Generate gene page links
  const publicUrl = `${publicSite.base_url}/app/record/gene/${geneId}#ExpressionGraphs`;
  const internalUrl = `https://${site.hostname}/${site.appPath}/app/record/gene/${geneId}#ai_expression`;

  // External link icon SVG
  const externalIcon = `<svg class="inline-block w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>`;

  // Generate internal link item (conditionally disabled)
  const internalLinkDisabled = site.disableGenePageLinks === true;
  const internalLinkItem = internalLinkDisabled
    ? `<span class="text-gray-500">Internal AI expression summary (not available)</span>`
    : `<a href="${escapeHtml(internalUrl)}" class="text-blue-600 hover:text-blue-800 inline-flex items-center" target="_blank">Internal AI expression summary${externalIcon}</a>
          <span class="text-gray-500"> (interactive co-visualisation of raw data)</span>`;

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h1 class="text-3xl font-bold text-gray-800 mb-2">
        ${geneDisplay}
      </h1>
      <p class="text-xl text-gray-600 mb-2">${sanitizeHtml(headline)}</p>
      <div class="text-sm text-gray-500">
        <span class="font-semibold">Model:</span> ${escapeHtml(modelDisplayName)}
      </div>
      <ul class="text-sm text-gray-600 mt-3 ml-4 space-y-1">
        <li class="list-disc">
          <a href="${escapeHtml(publicUrl)}" class="text-blue-600 hover:text-blue-800 inline-flex items-center" target="_blank">Public gene page${externalIcon}</a>
          <span class="text-gray-500"> (expression graphs table for manual perusal)</span>
        </li>
        <li class="list-disc">
          ${internalLinkItem}
        </li>
      </ul>
    </div>
  `;
}

/**
 * Generate one paragraph summary section HTML
 */
function generateSummarySection(summary: string): string {
  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Summary</h2>
      <div class="ai-content text-gray-700 leading-relaxed">
        ${sanitizeHtml(summary)}
      </div>
    </div>
  `;
}

/**
 * Generate experiment table rows for a topic
 */
function generateExperimentRows(summaries: ExperimentSummary[]): string {
  return summaries
    .map(
      (exp) => `
        <tr class="border-t border-gray-200">
          <td class="px-4 py-3 text-sm">
            <span class="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-semibold">
              ${escapeHtml(exp.assay_type)}
            </span>
          </td>
          <td class="px-4 py-3 text-sm text-gray-800">${escapeHtml(exp.experiment_name)}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${sanitizeHtml(exp.one_sentence_summary)}</td>
          <td class="px-4 py-3 text-sm text-center">
            <span class="inline-block bg-gray-100 px-2 py-1 rounded font-semibold">
              ${escapeHtml(String(exp.biological_importance))}
            </span>
          </td>
        </tr>
      `
    )
    .join("");
}

/**
 * Generate topics table section HTML
 */
function generateTopicsSection(topics: Topic[]): string {
  const topicRows = topics
    .map(
      (topic, index) => `
        <tr class="border-t border-gray-300">
          <td class="px-4 py-4">
            <div class="font-semibold text-gray-800 mb-1">${sanitizeHtml(topic.headline)}</div>
            <div class="text-sm text-gray-600">${sanitizeHtml(topic.one_sentence_summary)}</div>
            <details class="mt-3">
              <summary class="cursor-pointer text-blue-600 hover:text-blue-800 font-semibold text-sm">
                Show ${topic.summaries.length} experiment${topic.summaries.length !== 1 ? 's' : ''}
              </summary>
              <div class="mt-3 overflow-x-auto">
                <table class="min-w-full bg-gray-50 rounded-lg">
                  <thead>
                    <tr class="bg-gray-100">
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Assay Type</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Experiment</th>
                      <th class="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Summary</th>
                      <th class="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Importance</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${generateExperimentRows(topic.summaries)}
                  </tbody>
                </table>
              </div>
            </details>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Topics</h2>
      <table class="min-w-full">
        <thead>
          <tr class="bg-gray-100">
            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">Topic Summary</th>
          </tr>
        </thead>
        <tbody>
          ${topicRows}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Generate complete HTML page for a gene summary
 */
function generateGeneHTML(
  geneId: string,
  geneName: string | undefined,
  modelDisplayName: string,
  summary: ExpressionSummary,
  site: SiteConfig,
  publicSite: PublicSiteConfig
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${formatGeneDisplay(geneId, geneName)} - ${modelDisplayName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* Style lists within AI-generated content */
    .ai-content ul {
      list-style-type: disc;
      margin-left: 1.5rem;
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .ai-content li {
      margin-left: 0.5rem;
      margin-bottom: 0.25rem;
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen py-8">
  <div class="container mx-auto px-4 max-w-7xl">
    ${generateHeader(geneId, geneName, modelDisplayName, summary.headline, site, publicSite)}
    ${generateSummarySection(summary.one_paragraph_summary)}
    ${generateTopicsSection(summary.topics)}

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

/**
 * Process one gene for one model
 */
async function processGeneModel(
  geneEntry: GeneEntry,
  site: SiteConfig,
  analysisModelName: string,
  publicSite: PublicSiteConfig
): Promise<void> {
  const geneId = geneEntry.id;

  // Load summary JSON
  const summaryPath = path.join(
    process.cwd(),
    `comparison/data/summaries/${site.name}/${geneId}.json`
  );

  let summary: ExpressionSummary;
  try {
    const content = await readFile(summaryPath, "utf-8");
    summary = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load summary for ${geneId} (${site.name}): ${error instanceof Error ? error.message : error}`);
  }

  // Generate HTML
  const html = generateGeneHTML(geneId, geneEntry.name, site.model, summary, site, publicSite);

  // Write to file
  const outputPath = path.join(
    process.cwd(),
    `comparison/data/aggregate-reports/${analysisModelName}/html-summaries/${geneId}-${site.name}.html`
  );

  await writeToFile(outputPath, html);
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(60));
  console.log("GENERATE HTML SUMMARIES");
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

  console.log(`Found ${activeSites.length} active model(s): ${activeSites.map(s => s.name).join(", ")}`);
  console.log(`Analysis model: ${config.analysis_model.name}`);

  // Load gene list
  console.log("\nLoading gene list...");
  const genes = await loadGeneList();
  console.log(`Found ${genes.length} genes`);

  if (genes.length === 0) {
    console.error("No genes found in gene-list.txt. Please add gene IDs (one per line).");
    process.exit(1);
  }

  // Process each gene × model combination
  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const gene of genes) {
    for (const site of activeSites) {
      try {
        console.log(`Processing ${gene.id} (${site.name})...`);
        await processGeneModel(gene, site, config.analysis_model.name, config.public_site);
        successCount++;
      } catch (error) {
        const errorMsg = `${gene.id} (${site.name}): ${error instanceof Error ? error.message : error}`;
        console.error(`  ERROR: ${errorMsg}`);
        errors.push(errorMsg);
        errorCount++;
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total combinations: ${genes.length * activeSites.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${errorCount}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((err) => console.log(`  - ${err}`));
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
