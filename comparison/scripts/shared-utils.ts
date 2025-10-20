import { writeFile, mkdir, readFile } from "fs/promises";
import https from 'https';
import querystring from 'querystring';
import path from 'path';
import { Config, SiteConfig } from './types';

/**
 * Writes content to a file, creating parent directories if needed
 */
export async function writeToFile(filename: string, content: string): Promise<void> {
  try {
    // Create parent directory if it doesn't exist
    const dir = path.dirname(filename);
    await mkdir(dir, { recursive: true });

    await writeFile(filename, content, "utf-8");
    console.log(`File written successfully to ${filename}`);
  } catch (error) {
    console.error("Error writing to file:", error);
  }
}

/**
 * Strips markdown code block formatting from JSON responses
 * Handles both ```json and ``` formats
 */
export function stripMarkdownCodeBlocks(response: string): string {
  let stripped = response;
  if (stripped.startsWith('```json')) {
    stripped = stripped.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return stripped;
}

/**
 * Obtains auth_tkt cookie from VEuPathDB login endpoint
 * Required for accessing dev sites (bmaccallum.vectorbase.org, etc.)
 */
export async function getAuthCookie(username: string, password: string): Promise<string> {
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

/**
 * Sleep utility for rate limiting or polling delays
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gene entry with optional name/description
 */
export interface GeneEntry {
  id: string;
  name?: string;
}

/**
 * Load gene list from input file
 * Filters out comments (lines starting with #) and empty lines
 * Supports optional gene names after the gene ID (separated by space)
 * Format: "AGAP001212 ABC1 transporter protein" or just "AGAP001212"
 */
export async function loadGeneList(): Promise<GeneEntry[]> {
  const geneListPath = path.join(process.cwd(), "comparison/input/gene-list.txt");
  const content = await readFile(geneListPath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) {
        // No space found, entire line is the gene ID
        return { id: line };
      }
      // Split on first space: ID and optional name
      const id = line.substring(0, spaceIndex);
      const name = line.substring(spaceIndex + 1).trim();
      return { id, name: name || undefined };
    });
}

/**
 * Load site configuration from sites.json
 * Returns full config, active sites (skip !== true), and skipped sites
 */
export async function loadSitesConfig(): Promise<{
  config: Config;
  activeSites: SiteConfig[];
  skippedSites: SiteConfig[];
}> {
  const configPath = path.join(process.cwd(), "comparison/config/sites.json");
  const configContent = await readFile(configPath, "utf-8");
  const config: Config = JSON.parse(configContent);

  const activeSites = config.sites.filter((site) => !site.skip);
  const skippedSites = config.sites.filter((site) => site.skip);

  return { config, activeSites, skippedSites };
}
