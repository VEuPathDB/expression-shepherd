import { writeFile, mkdir, readFile } from "fs/promises";
import https from 'https';
import querystring from 'querystring';
import path from 'path';
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { Config, SiteConfig, AnalysisModelConfig } from './types';

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

/**
 * AI Client class - encapsulates AI client with its configuration
 * Knows its own platform, model string, and name
 */
export class AIClient {
  public readonly name: string;
  public readonly platform: 'anthropic' | 'openai';
  public readonly modelString: string;
  private readonly client: Anthropic | OpenAI;

  constructor(analysisModel: AnalysisModelConfig) {
    this.name = analysisModel.name;
    this.platform = analysisModel.platform;
    this.modelString = analysisModel.model_string;

    if (this.platform === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in .env");
      this.client = new Anthropic({ apiKey });
    } else if (this.platform === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("Missing OPENAI_API_KEY in .env");
      this.client = new OpenAI({ apiKey });
    } else {
      throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Call the AI model with a prompt
   * Handles platform-specific logic internally
   */
  async call(prompt: string, maxTokens: number): Promise<AICallResult> {
    let rawResponse: string;
    let usage: any;

    if (this.platform === "anthropic") {
      const anthropic = this.client as Anthropic;
      const message = await anthropic.messages.create({
        model: this.modelString,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });

      rawResponse = message.content[0].type === "text"
        ? message.content[0].text
        : JSON.stringify(message.content[0]);
      usage = message.usage;

      // Strip markdown for Anthropic
      rawResponse = stripMarkdownCodeBlocks(rawResponse);

      return {
        parsed: JSON.parse(rawResponse),
        token_usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_tokens: usage.input_tokens + usage.output_tokens,
        },
      };
    } else {
      const openai = this.client as OpenAI;

      // Ad-hoc JSON instructions (no response_format)
      const completion = await openai.chat.completions.create({
        model: this.modelString,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      });

      rawResponse = completion.choices[0].message.content || "";
      usage = completion.usage;

      // Apply markdown stripping to OpenAI too (just in case)
      rawResponse = stripMarkdownCodeBlocks(rawResponse);

      return {
        parsed: JSON.parse(rawResponse),
        token_usage: {
          input_tokens: usage?.prompt_tokens || 0,
          output_tokens: usage?.completion_tokens || 0,
          total_tokens: usage?.total_tokens || 0,
        },
      };
    }
  }
}

/**
 * AI Client factory - creates AIClient instance with encapsulated configuration
 */
export function createAIClient(analysisModel: AnalysisModelConfig): AIClient {
  return new AIClient(analysisModel);
}

/**
 * AI Call Result - unified return type for both platforms
 */
export interface AICallResult {
  parsed: any;  // The parsed JSON response
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/**
 * @deprecated Use AIClient.call() instead. This function is kept for backwards compatibility.
 *
 * Unified AI call function - supports both Anthropic and OpenAI platforms
 * Uses ad-hoc JSON prompting for both (no response_format for OpenAI)
 */
export async function callAI(
  client: Anthropic | OpenAI,
  platform: 'anthropic' | 'openai',
  modelString: string,
  prompt: string,
  maxTokens: number
): Promise<AICallResult> {
  let rawResponse: string;
  let usage: any;

  if (platform === "anthropic") {
    const anthropic = client as Anthropic;
    const message = await anthropic.messages.create({
      model: modelString,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    rawResponse = message.content[0].type === "text"
      ? message.content[0].text
      : JSON.stringify(message.content[0]);
    usage = message.usage;

    // Strip markdown for Anthropic
    rawResponse = stripMarkdownCodeBlocks(rawResponse);

    return {
      parsed: JSON.parse(rawResponse),
      token_usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.input_tokens + usage.output_tokens,
      },
    };
  } else {
    const openai = client as OpenAI;

    // Ad-hoc JSON instructions (no response_format)
    const completion = await openai.chat.completions.create({
      model: modelString,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });

    rawResponse = completion.choices[0].message.content || "";
    usage = completion.usage;

    // Apply markdown stripping to OpenAI too (just in case)
    rawResponse = stripMarkdownCodeBlocks(rawResponse);

    return {
      parsed: JSON.parse(rawResponse),
      token_usage: {
        input_tokens: usage?.prompt_tokens || 0,
        output_tokens: usage?.completion_tokens || 0,
        total_tokens: usage?.total_tokens || 0,
      },
    };
  }
}
