import "dotenv/config";
import { readdir } from "fs/promises";
import path from "path";
import { writeToFile, loadSitesConfig } from "./shared-utils";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse report filename to extract model pair
 * Example: "claude4-gpt4o-report.html" → ["claude4", "gpt4o"]
 */
function parseReportFilename(filename: string): [string, string] | null {
  const match = filename.match(/^(.+?)-(.+?)-report\.(html|json)$/);
  if (!match) return null;
  return [match[1], match[2]];
}

/**
 * Check if both HTML and JSON files exist for a model pair
 */
function hasReportFiles(
  modelA: string,
  modelB: string,
  reportFiles: Set<string>
): { html: boolean; json: boolean } {
  const baseFilename = `${modelA}-${modelB}-report`;
  return {
    html: reportFiles.has(`${baseFilename}.html`),
    json: reportFiles.has(`${baseFilename}.json`)
  };
}

/**
 * Generate matrix cell HTML for a specific model pair
 */
function generateMatrixCell(
  rowModel: string,
  colModel: string,
  reportFiles: Set<string>,
  isDiagonal: boolean,
  isLowerTriangle: boolean
): string {
  // Diagonal cells: grayed background
  if (isDiagonal) {
    return `<td class="px-4 py-3 bg-gray-200 text-center text-gray-400">—</td>`;
  }

  // Lower triangle: empty with gray background
  if (isLowerTriangle) {
    return `<td class="px-4 py-3 bg-gray-50"></td>`;
  }

  // Upper triangle: check for report files
  const files = hasReportFiles(rowModel, colModel, reportFiles);

  if (files.html || files.json) {
    const links: string[] = [];
    if (files.html) {
      links.push(`<a href="${rowModel}-${colModel}-report.html" class="text-blue-600 hover:text-blue-800 font-medium">HTML</a>`);
    }
    if (files.json) {
      links.push(`<a href="${rowModel}-${colModel}-report.json" class="text-gray-600 hover:text-gray-800 font-medium">JSON</a>`);
    }
    return `<td class="px-4 py-3 text-center text-sm">${links.join(" / ")}</td>`;
  } else {
    return `<td class="px-4 py-3 text-center text-gray-400 text-sm">—</td>`;
  }
}

/**
 * Generate the comparison matrix table HTML
 */
function generateMatrixTable(models: string[], reportFiles: Set<string>): string {
  // Generate header row
  const headerCells = models.map(model =>
    `<th class="px-4 py-3 text-center text-sm font-semibold text-gray-700">${model}</th>`
  ).join("");

  // Generate data rows
  const rows = models.map((rowModel, rowIdx) => {
    const cells = models.map((colModel, colIdx) => {
      const isDiagonal = rowIdx === colIdx;
      const isLowerTriangle = rowIdx > colIdx;
      return generateMatrixCell(rowModel, colModel, reportFiles, isDiagonal, isLowerTriangle);
    }).join("");

    return `
      <tr class="border-t border-gray-200">
        <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700 bg-gray-50">${rowModel}</th>
        ${cells}
      </tr>
    `;
  }).join("");

  return `
    <div class="overflow-x-auto">
      <table class="min-w-full bg-white shadow-md rounded-lg">
        <thead>
          <tr class="bg-gray-100 border-b border-gray-300">
            <th class="px-4 py-3 text-left text-sm font-semibold text-gray-700">Model</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Generate complete index HTML page
 */
function generateIndexHTML(analysisModelName: string, models: string[], reportFiles: Set<string>): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Model Comparison Reports - ${analysisModelName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen py-8">
  <div class="container mx-auto px-4 max-w-6xl">
    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h1 class="text-3xl font-bold text-gray-800 mb-2">
        VEuPathDB AI Gene Expression Summaries
      </h1>
      <p class="text-gray-600">
        <span class="font-semibold">Analysis by:</span> ${analysisModelName}
      </p>
    </div>

    <div class="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">Model Comparison Matrix</h2>
      <div class="bg-blue-50 border-l-4 border-blue-400 p-3 mb-4">
        <p class="text-sm text-gray-700">
          <span class="font-semibold">How to read this matrix:</span> Each cell shows links to comparison reports
          for the corresponding model pair. The matrix shows only the upper triangle since comparisons are symmetric.
          Click <strong>HTML</strong> for the formatted report or <strong>JSON</strong> for the raw data.
        </p>
      </div>
      ${generateMatrixTable(models, reportFiles)}
    </div>

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
  console.log("GENERATE INDEX PAGE");
  console.log("=".repeat(60));

  // Load configuration
  console.log("\nLoading configuration...");
  const { config } = await loadSitesConfig();
  const analysisModelName = config.analysis_model.model || config.analysis_model.name;
  console.log(`Analysis model: ${analysisModelName}`);

  // Scan for report files
  const reportDir = path.join(
    process.cwd(),
    `comparison/data/aggregate-reports/${config.analysis_model.name}`
  );
  console.log(`\nScanning directory: ${reportDir}`);

  let allFiles: string[];
  try {
    allFiles = await readdir(reportDir);
  } catch (error) {
    console.error(`Error reading directory: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Filter for report files and build model set
  const reportFiles = new Set<string>();
  const modelSet = new Set<string>();

  for (const file of allFiles) {
    if (file.endsWith("-report.html") || file.endsWith("-report.json")) {
      reportFiles.add(file);
      const modelPair = parseReportFilename(file);
      if (modelPair) {
        modelSet.add(modelPair[0]);
        modelSet.add(modelPair[1]);
      }
    }
  }

  const models = Array.from(modelSet).sort();
  console.log(`Found ${models.length} models: ${models.join(", ")}`);
  console.log(`Found ${reportFiles.size} report files`);

  if (models.length === 0) {
    console.error("No report files found. Run Phase 3 (yarn comparison:aggregate) first.");
    process.exit(1);
  }

  // Generate HTML
  console.log("\nGenerating index.html...");
  const html = generateIndexHTML(analysisModelName, models, reportFiles);

  // Write to file
  const indexPath = path.join(reportDir, "index.html");
  await writeToFile(indexPath, html);

  console.log("\n" + "=".repeat(60));
  console.log("SUCCESS");
  console.log("=".repeat(60));
  console.log(`Index page written to: ${indexPath}`);
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
