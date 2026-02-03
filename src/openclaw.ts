/**
 * OpenClaw Worker Module
 * 
 * Calls OpenClaw CLI to perform web search/fetch/extraction.
 * V3.1: Simplified - uses CLI --timeout directly, no complex kill logic.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { logger } from './logger';
import { DiscoveryJob } from './prompts';

const execAsync = promisify(exec);

// ============================================================================
// TIMEOUT CONFIG - Single timeout variable, passed to CLI --timeout
// V3.1.1: Default 5 minutes (300s) instead of 1 minute
// ============================================================================
export const DEFAULT_TIMEOUT_SECONDS = 300;

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
  source: 'openclaw';
}

/**
 * Expected shape of JSON parsed from agent text (inner JSON inside CLI payloads).
 * The CLI returns an outer wrapper; we extract payload text and parse it as this.
 */
export interface AgentOutputJson {
  candidates?: any[];
  summary?: { headline?: string; key_insights?: string[]; venues_searched?: string[] };
  metadata?: { searches_performed?: number; pages_fetched?: number; completed?: boolean };
  status?: string;
}

/**
 * Check if a CLI command is available
 */
async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await execAsync(`which ${cmd}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default agent name
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
 * Extract JSON from agent text response.
 * Expects AgentOutputJson shape (object with candidates, optional summary/metadata/status).
 */
function extractJson(text: string): AgentOutputJson | null {
  let lastError: string | undefined;
  try {
    return JSON.parse(text) as AgentOutputJson;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlock) {
    try {
      return JSON.parse(jsonBlock[1]) as AgentOutputJson;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  const jsonObj = text.match(/\{[\s\S]*"candidates"[\s\S]*\}/);
  if (jsonObj) {
    try {
      return JSON.parse(jsonObj[0]) as AgentOutputJson;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  logger.warn('Failed to parse agent text as JSON', {
    parseError: lastError,
    textPreview: text.slice(0, 500),
    textLength: text.length,
  });
  return null;
}

/**
 * Extract agent text from payloads - search from back to front
 * V3.1: More robust extraction, finds last non-empty payload text
 */
function extractPayloadText(json: any): string {
  const payloads = json?.result?.payloads || json?.payloads || [];
  
  // Search from back to front for the last payload with text
  for (let i = payloads.length - 1; i >= 0; i--) {
    const text = payloads[i]?.text;
    if (text && typeof text === 'string' && text.trim()) {
      return text.trim();
    }
  }
  
  return '';
}

/**
 * Parse CLI JSON output into DiscoveryResult
 * V3.1: Uses extractPayloadText to find agent output from payloads
 */
function parseResult(stdout: string, source: 'openclaw'): DiscoveryResult | null {
  let json: any;
  try {
    json = JSON.parse(stdout);
  } catch (e) {
    logger.warn(`[${source}] Failed to parse stdout as JSON`, { error: String(e) });
    logger.debug(`[${source}] Raw stdout (first 500 chars):`, stdout.slice(0, 500));
    return null;
  }
  
  // Check for error status
  if (json.status === 'error') {
    logger.warn(`[${source}] Agent returned error status`, { summary: json.summary });
    return null;
  }
  
  // Extract agent text from payloads (search from back to front)
  const agentText = extractPayloadText(json);
  
  if (!agentText) {
    logger.warn(`[${source}] No text found in payloads`);
    logger.debug(`[${source}] Full JSON response:`, JSON.stringify(json, null, 2).slice(0, 1000));
    return null;
  }
  
  logger.debug(`[${source}] Extracted agent text (first 200 chars):`, agentText.slice(0, 200));
  
  const data = extractJson(agentText);

  if (!data) {
    logger.warn(`[${source}] Could not parse JSON from agent text`);
    // Log the full agent text so we can see error messages (e.g. rate limiting)
    logger.error(`[${source}] Agent text content that failed to parse:`, agentText);
    return null;
  }
  
  // For smoke mode, we might just get "OK" or minimal response
  if (!data.candidates) {
    // Check if this is a smoke test response
    if (agentText.toUpperCase() === 'OK' || data.status === 'ok') {
      logger.info(`[${source}] Smoke test response received`);
      return {
        candidates: [],
        summary: { headline: 'Smoke test passed', key_insights: ['Pipeline verified'], venues_searched: [] },
        metadata: { searches_performed: 0, pages_fetched: 0, candidates_evaluated: 0, completed: true },
        source,
      };
    }
    logger.warn(`[${source}] No candidates array in response`);
    return null;
  }
  
  return {
    candidates: data.candidates,
    summary: {
      headline: data.summary?.headline ?? `Found ${data.candidates.length} candidates`,
      key_insights: data.summary?.key_insights ?? [],
      venues_searched: data.summary?.venues_searched ?? [],
    },
    metadata: {
      searches_performed: data.metadata?.searches_performed || 0,
      pages_fetched: data.metadata?.pages_fetched || 0,
      candidates_evaluated: data.candidates.length,
      completed: data.metadata?.completed ?? true,
    },
    source,
  };
}

/**
 * Run CLI with streaming output
 * V3.1 Simplified: 
 *   - No --local flag (uses cloud/default mode)
 *   - Timeout is handled by CLI itself via --timeout flag
 *   - No complex SIGTERM/SIGKILL logic needed
 */
function runCLI(cli: string, agent: string, message: string, timeoutSeconds: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // V3.1.2: Use unique session-id to avoid lock conflicts with chat sessions
    const sessionId = randomUUID();
    const args = [
      'agent',
      '--json',
      '--timeout', String(timeoutSeconds),
      '--agent', agent,
      '--session-id', sessionId,
      '-m', message,
    ];
    
    logger.info(`[${cli}] Spawning process`, { timeout: timeoutSeconds, agent, sessionId });
    logger.debug(`[${cli}] Command: ${cli} ${args.join(' ').slice(0, 300)}...`);
    
    const proc = spawn(cli, args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    
    let stdout = '';
    let stderr = '';
    const startMs = Date.now();
    
    // Stream stdout
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      // Only log first part of each line to avoid noise
      text.split('\n').filter(Boolean).forEach(line => {
        logger.debug(`[${cli}] stdout: ${line.slice(0, 150)}`);
      });
    });
    
    // Stream stderr (log as debug, not info)
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      text.split('\n').filter(Boolean).forEach(line => {
        logger.debug(`[${cli}] stderr: ${line.slice(0, 150)}`);
      });
    });
    
    proc.on('close', (code, signal) => {
      const elapsedMs = Date.now() - startMs;
      logger.info(`[${cli}] Process exited`, { code, signal, elapsedMs, stdoutLen: stdout.length });
      
      if (stdout) {
        resolve(stdout);
      } else if (stderr) {
        logger.error(`[${cli}] No stdout, stderr:`, stderr.slice(0, 500));
        reject(new Error(`Process exited with no output. Code: ${code}, Signal: ${signal}`));
      } else {
        reject(new Error(`Process exited with code ${code}, signal ${signal}, no output`));
      }
    });
    
    proc.on('error', (err) => {
      logger.error(`[${cli}] Spawn error:`, err.message);
      reject(err);
    });
  });
}

/**
 * Execute discovery via CLI
 * V3.1: Added timeout parameter
 */
async function executeViaCLI(
  job: DiscoveryJob,
  timeoutSeconds: number
): Promise<DiscoveryResult | null> {
  const cli = 'openclaw';
  const agent = await getDefaultAgent(cli);
  if (!agent) {
    logger.warn(`[${cli}] No agent configured`);
    return null;
  }
  
  // V3.1.1: More flexible constraints - web_search primary, web_fetch optional
  const hardConstraints = `

---
## HARD CONSTRAINTS (MUST FOLLOW)
- Use web_search as your PRIMARY tool. It works reliably.
- Use web_fetch only if available and needed for detail pages.
- Do NOT use browser automation.
- Avoid login-walled sources (LinkedIn, Facebook, etc.).
- If a tool is unavailable, work with what you have - do NOT fail.
- Return ONLY valid JSON. No markdown. No code fences. No commentary.`;

  const message = `${job.systemPrompt}\n\n---\n\n${job.userPrompt}${hardConstraints}`;
  
  try {
    const stdout = await runCLI(cli, agent, message, timeoutSeconds);
    const result = parseResult(stdout, cli);
    if (result) {
      logger.info(`[${cli}] Got ${result.candidates.length} candidates`);
    }
    return result;
  } catch (err: any) {
    logger.error(`[${cli}] Failed`, { error: err.message });
    return null;
  }
}

export interface DiscoveryOptions {
  timeout?: number;
  mode?: 'smoke' | 'real';
}

/**
 * Main entry: execute discovery via OpenClaw CLI
 * V3.2: Simplified - only uses openclaw, fails directly if unavailable or fails
 */
export async function executeDiscovery(
  job: DiscoveryJob, 
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const timeout = options.timeout || DEFAULT_TIMEOUT_SECONDS;
  const mode = options.mode || 'smoke';
  
  logger.info('Starting discovery', { timeout, mode });
  
  if (!(await checkCommand('openclaw'))) {
    throw new Error('openclaw CLI is not available. Please install it first.');
  }
  
  logger.info('Running openclaw...');
  const result = await executeViaCLI(job, timeout);
  
  if (!result) {
    throw new Error('openclaw failed to produce a valid result. Check logs for details.');
  }
  
  // V3.1: For smoke mode, accept empty candidates (just pipeline verification)
  if (mode === 'smoke') {
    return result;
  }
  
  // For real mode, require at least some candidates
  if (result.candidates.length) {
    return result;
  }
  
  // If openclaw returned a result but no candidates, still return it
  logger.info('openclaw returned result with no candidates');
  return result;
}

