import "dotenv/config";
import axios from "axios";
import path from "path";
import { writeToFile, getAuthCookie, sleep, loadGeneList, loadSitesConfig } from "./shared-utils";
import type { SiteConfig, Config, FetchResult } from "./types";

const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_RETRIES = 3;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max (120 * 5 seconds)

/**
 * Make API request to fetch AI expression summary
 */
async function fetchSummary(
  geneId: string,
  site: SiteConfig,
  config: Config,
  authCookie: string,
  populateIfNotPresent: boolean
): Promise<any> {
  const url = `https://${site.hostname}/${site.appPath}${config.endpoint}`;

  const requestBody = {
    reportConfig: {
      populateIfNotPresent,
    },
    searchConfig: {
      parameters: {
        primaryKeys: `${geneId},${config.projectId}`,
      },
    },
  };

  const response = await axios.post(url, requestBody, {
    headers: {
      "Content-Type": "application/json",
      Cookie: `auth_tkt=${authCookie}`,
    },
  });

  return response.data;
}

/**
 * Fetch summary for a gene from a specific site with polling
 */
async function fetchSummaryWithPolling(
  geneId: string,
  site: SiteConfig,
  config: Config,
  authCookie: string
): Promise<any> {
  console.log(`[${site.name}] ${geneId}: Triggering summary generation...`);

  // Initial request to trigger generation
  let response = await fetchSummary(geneId, site, config, authCookie, true);

  // Check if already present
  if (response[geneId]?.resultStatus === "present") {
    console.log(`[${site.name}] ${geneId}: Summary already present`);
    return response[geneId].expressionSummary;
  }

  // Poll until present or max attempts reached
  let attempts = 0;
  while (attempts < MAX_POLL_ATTEMPTS) {
    console.log(
      `[${site.name}] ${geneId}: Polling (attempt ${attempts + 1}/${MAX_POLL_ATTEMPTS})...`
    );

    await sleep(POLL_INTERVAL_MS);

    response = await fetchSummary(geneId, site, config, authCookie, false);

    if (response[geneId]?.resultStatus === "present") {
      console.log(`[${site.name}] ${geneId}: Summary ready!`);
      return response[geneId].expressionSummary;
    }

    if (response[geneId]?.resultStatus === "error") {
      throw new Error(`Generation failed: ${JSON.stringify(response[geneId])}`);
    }

    attempts++;
  }

  throw new Error(`Polling timeout after ${MAX_POLL_ATTEMPTS} attempts`);
}

/**
 * Fetch summary with retry logic
 */
async function fetchWithRetry(
  geneId: string,
  site: SiteConfig,
  config: Config,
  authCookie: string
): Promise<FetchResult> {
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const summary = await fetchSummaryWithPolling(geneId, site, config, authCookie);

      // Save to file
      const outputPath = path.join(
        process.cwd(),
        `comparison/data/summaries/${site.name}/${geneId}.json`
      );
      await writeToFile(outputPath, JSON.stringify(summary, null, 2));

      return {
        geneId,
        site: site.name,
        status: "success",
      };
    } catch (error) {
      lastError = error;
      console.error(
        `[${site.name}] ${geneId}: Attempt ${attempt}/${MAX_RETRIES} failed:`,
        error instanceof Error ? error.message : error
      );

      if (attempt < MAX_RETRIES) {
        const backoffMs = attempt * 2000; // Exponential backoff
        console.log(`[${site.name}] ${geneId}: Retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
      }
    }
  }

  return {
    geneId,
    site: site.name,
    status: "failed",
    error: lastError instanceof Error ? lastError.message : String(lastError),
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

  console.log(`Processing ${activeSites.length} active site(s):`);
  activeSites.forEach((site) => console.log(`  - ${site.name} (${site.model})`));

  console.log("\nLoading gene list...");
  const genes = await loadGeneList();
  console.log(`Found ${genes.length} genes to process`);

  if (genes.length === 0) {
    console.error("No genes found in gene-list.txt. Please add gene IDs (one per line).");
    process.exit(1);
  }

  console.log("Authenticating...");
  const username = process.env.VEUPATHDB_LOGIN_USER;
  const password = process.env.VEUPATHDB_LOGIN_PASS;

  if (!username || !password) {
    console.error("Missing VEUPATHDB_LOGIN_USER or VEUPATHDB_LOGIN_PASS in .env file");
    process.exit(1);
  }

  const authCookie = await getAuthCookie(username, password);
  console.log("Authentication successful!");
  console.log(`Auth cookie (for curl debugging): auth_tkt=${authCookie}`);

  const results: FetchResult[] = [];

  // Process each gene across all sites
  for (const gene of genes) {
    const geneId = gene.id;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing gene: ${geneId}`);
    console.log("=".repeat(60));

    // Process all active sites for this gene in parallel
    const siteResults = await Promise.all(
      activeSites.map((site) => fetchWithRetry(geneId, site, config, authCookie))
    );

    results.push(...siteResults);
  }

  // Summary report
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const successful = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status === "failed");

  console.log(`Total attempts: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed fetches:");
    failed.forEach((r) => {
      console.log(`  - ${r.geneId} (${r.site}): ${r.error}`);
    });
  }

  // Save summary report
  const reportPath = path.join(process.cwd(), "comparison/data/fetch-summary.json");
  await writeToFile(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        results,
      },
      null,
      2
    )
  );

  console.log(`\nSummary report saved to ${reportPath}`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
