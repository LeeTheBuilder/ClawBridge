/**
 * OpenClaw Worker Module
 * 
 * Handles calling OpenClaw/Clawdbot as a worker to perform web search/fetch/extraction.
 * Uses local CLI tools (no external APIs).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { DiscoveryJob } from './prompts';

const execAsync = promisify(exec);

// ============================================================================
// TIMEOUT CONFIG - Change this value to adjust discovery timeout (in seconds)
// ============================================================================
const TIMEOUT_SECONDS = 60;  // 1 minute for testing

export interface DiscoveryResult {
  candidates: any[];
  summary: {
    headline: string;
    key_insights: string[];
    venues_searched: string[];
  };
  metadata: {
    searches_performed: number;
    pages_fetched: number;
    candidates_evaluated: number;
    completed?: boolean;
  };
  source: 'openclaw' | 'clawdbot' | 'simulated';
}

/**
 * Check if a CLI command is available
 */
async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await execAsync(`${cmd} --version`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default agent name for a CLI tool
 */
async function getDefaultAgent(cli: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${cli} agents list`, { timeout: 10000 });
    const match = stdout.match(/- (\w+) \(default\)/) || stdout.match(/- (\w+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract JSON from a text response that might contain markdown code blocks
 */
function extractJsonFromResponse(text: string): any | null {
  // Try direct JSON parse
  try { return JSON.parse(text); } catch {}
  
  // Look for JSON in markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try { return JSON.parse(jsonBlockMatch[1]); } catch {}
  }
  
  // Look for JSON object anywhere
  const jsonMatch = text.match(/\{[\s\S]*"candidates"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  
  return null;
}

/**
 * Parse CLI response into DiscoveryResult
 */
function parseResponse(stdout: string, source: 'openclaw' | 'clawdbot'): DiscoveryResult | null {
  let cliResponse: any;
  try {
    cliResponse = JSON.parse(stdout);
  } catch {
    logger.debug(`Failed to parse ${source} output as JSON`);
    return null;
  }
  
  const agentText = cliResponse.payloads?.[0]?.text || '';
  const discoveryData = extractJsonFromResponse(agentText);
  
  if (!discoveryData?.candidates?.length) {
    logger.debug(`${source} returned no candidates`);
    return null;
  }
  
  return {
    candidates: discoveryData.candidates,
    summary: discoveryData.summary || { 
      headline: `Found ${discoveryData.candidates.length} candidates`, 
      key_insights: [], 
      venues_searched: [] 
    },
    metadata: {
      searches_performed: discoveryData.metadata?.searches_performed || 0, 
      pages_fetched: discoveryData.metadata?.pages_fetched || 0, 
      candidates_evaluated: discoveryData.candidates.length,
      completed: true,
    },
    source,
  };
}

/**
 * Execute discovery via a CLI tool (openclaw or clawdbot)
 */
async function executeViaCLI(
  cli: 'openclaw' | 'clawdbot', 
  job: DiscoveryJob
): Promise<DiscoveryResult | null> {
  const agent = await getDefaultAgent(cli);
  if (!agent) {
    logger.debug(`No ${cli} agent configured`);
    return null;
  }
  
  logger.info(`Invoking ${cli} agent`, { agent, timeout: TIMEOUT_SECONDS });
  
  const message = `${job.systemPrompt}\n\n---\n\n${job.userPrompt}\n\nReturn ONLY valid JSON.`;
  const escapedMessage = message
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  
  try {
    const { stdout } = await execAsync(
      `${cli} agent --local --json --timeout ${TIMEOUT_SECONDS} --agent ${agent} -m "${escapedMessage}"`,
      { timeout: (TIMEOUT_SECONDS + 10) * 1000, maxBuffer: 10 * 1024 * 1024 }
    );
    return parseResponse(stdout, cli);
  } catch (error: any) {
    const isTimeout = error.killed || error.signal === 'SIGTERM';
    logger.debug(`${cli} failed`, { error: error.message, isTimeout });
    
    // Try to recover partial results on timeout
    if (isTimeout && error.stdout) {
      const partial = parseResponse(error.stdout, cli);
      if (partial) {
        partial.metadata.completed = false;
        return partial;
      }
    }
    return null;
  }
}

/**
 * Execute discovery with fallback chain:
 * 1. OpenClaw CLI
 * 2. Clawdbot CLI  
 * 3. Simulated data
 */
export async function executeDiscovery(job: DiscoveryJob): Promise<DiscoveryResult> {
  logger.info('Starting discovery', { timeout: TIMEOUT_SECONDS });
  
  // Try OpenClaw
  if (await checkCommand('openclaw')) {
    logger.info('Trying OpenClaw');
    const result = await executeViaCLI('openclaw', job);
    if (result?.candidates.length) {
      logger.info('Discovery completed via OpenClaw', { count: result.candidates.length });
      return result;
    }
  }
  
  // Try Clawdbot
  if (await checkCommand('clawdbot')) {
    logger.info('Trying Clawdbot');
    const result = await executeViaCLI('clawdbot', job);
    if (result?.candidates.length) {
      logger.info('Discovery completed via Clawdbot', { count: result.candidates.length });
      return result;
    }
  }
  
  // Fallback to simulated
  logger.warn('Using simulated data (no CLI available or no results)');
  return getSimulatedResult();
}

/**
 * Generate simulated discovery result
 */
function getSimulatedResult(): DiscoveryResult {
  return {
    candidates: [
      {
        name: 'Sarah Jenkins',
        handle: '@sjenkins_growth',
        role: 'Head of Growth',
        company: 'CloudScale AI',
        why_match: ['B2B content partnerships interest', 'Active in SaaS communities'],
        evidence_urls: ['https://linkedin.com/in/sjenkins-growth', 'https://cloudscale.ai/about'],
        risk_flags: [],
        scores: { relevance: 95, intent: 88, credibility: 90, recency: 98, engagement: 85, final_score: 92.2 },
        last_activity: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        suggested_intro: "Hi Sarah, saw your content about CloudScale. Would you be open to a quick chat?",
      },
      {
        name: 'Marcus Thorne',
        handle: '@mthorne_dev',
        role: 'Founder',
        company: 'StackFlow Solutions',
        why_match: ['Technical Founder persona', 'Verified LinkedIn presence'],
        evidence_urls: ['https://linkedin.com/in/mthorne', 'https://stackflow.io/about'],
        risk_flags: ['low_evidence'],
        scores: { relevance: 82, intent: 65, credibility: 92, recency: 70, engagement: 60, final_score: 76.5 },
        last_activity: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        suggested_intro: "Hi Marcus, impressive work on StackFlow. Our content ops framework might interest you.",
      }
    ],
    summary: {
      headline: 'Found 2 candidates (simulated)',
      key_insights: ['Using simulated data - install openclaw or clawdbot for real discovery'],
      venues_searched: ['linkedin', 'web'],
    },
    metadata: { searches_performed: 0, pages_fetched: 0, candidates_evaluated: 2 },
    source: 'simulated',
  };
}
