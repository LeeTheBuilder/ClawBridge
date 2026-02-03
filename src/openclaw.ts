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
// TIMEOUT CONFIG
// - TIMEOUT_SECONDS: Passed to CLI as --timeout. The agent is told to wrap up
//   and return (partial) results before this. We do NOT kill the process at
//   this time so the agent can flush stdout.
// - NODE_TIMEOUT_MS: Node kills the child only after this (safety net). Must be
//   longer than TIMEOUT_SECONDS so we get results when the CLI honors --timeout.
// ============================================================================
const TIMEOUT_SECONDS = 60;  // Agent has 60s to run, then should return
const GRACE_SECONDS = 30;    // Extra time for agent to flush after --timeout
const NODE_TIMEOUT_MS = (TIMEOUT_SECONDS + GRACE_SECONDS) * 1000;  // 90s kill

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
    const { stdout } = await execAsync(`${cmd} --version`, { timeout: 5000 });
    logger.info(`[${cmd}] Found`, { versionOutput: (stdout || '').trim().slice(0, 80) });
    return true;
  } catch (e: any) {
    logger.info(`[${cmd}] Not found or failed`, { error: e.message });
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
    const agent = match ? match[1] : null;
    logger.info(`[${cli}] Agents list`, { defaultAgent: agent, listPreview: stdout?.slice(0, 150) });
    return agent;
  } catch (e: any) {
    logger.warn(`[${cli}] agents list failed`, { error: e.message });
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
  logger.info(`[${source}] Parsing response`, { stdoutLength: stdout?.length ?? 0 });
  
  let cliResponse: any;
  try {
    cliResponse = JSON.parse(stdout);
  } catch (e: any) {
    logger.warn(`[${source}] Failed to parse CLI output as JSON`, { error: e.message, stdoutPreview: stdout?.slice(0, 200) });
    return null;
  }
  
  const agentText = cliResponse.payloads?.[0]?.text ?? '';
  logger.info(`[${source}] Agent text length`, { length: agentText.length, preview: agentText.slice(0, 150) });
  
  const discoveryData = extractJsonFromResponse(agentText);
  
  if (!discoveryData?.candidates?.length) {
    logger.warn(`[${source}] No candidates in response`, { hasData: !!discoveryData, keys: discoveryData ? Object.keys(discoveryData) : [] });
    return null;
  }
  
  logger.info(`[${source}] Parsed successfully`, { candidates: discoveryData.candidates.length });
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
  logger.info(`[${cli}] Checking for agent...`);
  const agent = await getDefaultAgent(cli);
  if (!agent) {
    logger.warn(`[${cli}] No agent configured (run "${cli} agents list" to see agents)`);
    return null;
  }
  
  const message = `${job.systemPrompt}\n\n---\n\n${job.userPrompt}\n\nReturn ONLY valid JSON.`;
  const escapedMessage = message
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  
  const cmd = `${cli} agent --local --json --timeout ${TIMEOUT_SECONDS} --agent ${agent} -m "${escapedMessage}"`;
  logger.info(`[${cli}] Starting discovery`, { 
    agent, 
    cliTimeoutSeconds: TIMEOUT_SECONDS,  // CLI told to return by this time
    nodeKillMs: NODE_TIMEOUT_MS,        // Node kills only if still running
    commandPreview: `${cli} agent --local --json --timeout ${TIMEOUT_SECONDS} --agent ${agent} -m "<...>"`,
  });
  const startMs = Date.now();
  
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: NODE_TIMEOUT_MS,  // Safety net only; CLI should return by TIMEOUT_SECONDS
      maxBuffer: 10 * 1024 * 1024,
    });
    
    const elapsedMs = Date.now() - startMs;
    if (stderr?.trim()) {
      logger.info(`[${cli}] stderr`, { stderr: stderr.trim().slice(0, 500) });
    }
    logger.info(`[${cli}] Process finished`, { elapsedMs, stdoutLength: stdout?.length ?? 0 });
    
    return parseResponse(stdout, cli);
  } catch (error: any) {
    const elapsedMs = Date.now() - startMs;
    const isTimeout = error.killed || error.signal === 'SIGTERM';
    
    if (isTimeout) {
      logger.warn(`[${cli}] Node killed process after ${(NODE_TIMEOUT_MS / 1000)}s (no graceful return)`, {
        elapsedMs,
        killed: error.killed,
        signal: error.signal,
        stderrPreview: error.stderr?.slice?.(0, 300),
        stdoutLength: error.stdout?.length ?? 0,
      });
    } else {
      logger.warn(`[${cli}] Execution failed`, { 
        error: error.message, 
        elapsedMs,
        stderrPreview: error.stderr?.slice?.(0, 300),
        stdoutLength: error.stdout?.length ?? 0,
      });
    }
    
    // Try to recover partial results on timeout
    if (isTimeout && error.stdout) {
      logger.info(`[${cli}] Attempting to parse partial stdout...`);
      const partial = parseResponse(error.stdout, cli);
      if (partial) {
        partial.metadata.completed = false;
        logger.info(`[${cli}] Recovered partial results`, { candidates: partial.candidates.length });
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
  logger.info('Discovery starting', { 
    cliTimeoutSeconds: TIMEOUT_SECONDS,  // Agent should return by this
    nodeKillSeconds: TIMEOUT_SECONDS + GRACE_SECONDS,
    promptLength: (job.systemPrompt + job.userPrompt).length,
  });
  
  // Try OpenClaw
  const hasOpenClaw = await checkCommand('openclaw');
  logger.info('OpenClaw check', { available: hasOpenClaw });
  if (hasOpenClaw) {
    logger.info('Trying OpenClaw...');
    const result = await executeViaCLI('openclaw', job);
    if (result?.candidates.length) {
      logger.info('Discovery completed via OpenClaw', { count: result.candidates.length });
      return result;
    }
    logger.info('OpenClaw returned no usable results, trying fallback');
  }
  
  // Try Clawdbot
  const hasClawdbot = await checkCommand('clawdbot');
  logger.info('Clawdbot check', { available: hasClawdbot });
  if (hasClawdbot) {
    logger.info('Trying Clawdbot...');
    const result = await executeViaCLI('clawdbot', job);
    if (result?.candidates.length) {
      logger.info('Discovery completed via Clawdbot', { count: result.candidates.length });
      return result;
    }
    logger.info('Clawdbot returned no usable results');
  }
  
  // Fallback to simulated
  logger.warn('Using simulated data (no CLI available or no valid results from OpenClaw/Clawdbot)');
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
