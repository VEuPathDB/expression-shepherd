import { writeFile, mkdir } from "fs/promises";
import https from 'https';
import querystring from 'querystring';
import path from 'path';

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
 * Load gene list from input file
 * Filters out comments (lines starting with #) and empty lines
 */
export async function loadGeneList(): Promise<string[]> {
  const { readFile } = await import("fs/promises");
  const geneListPath = path.join(process.cwd(), "comparison/input/gene-list.txt");
  const content = await readFile(geneListPath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}
