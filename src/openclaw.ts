/**
 * OpenClaw Worker Module
 * 
 * Calls OpenClaw/Clawdbot CLI to perform web search/fetch/extraction.
 * Uses spawn for real-time output streaming.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { DiscoveryJob } from './prompts';

const execAsync = promisify(exec);

// ============================================================================
// TIMEOUT CONFIG - Change this to adjust discovery timeout
// ============================================================================
const TIMEOUT_SECONDS = 60;

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
 * Extract JSON from agent text response
 */
function extractJson(text: string): any | null {
  try { return JSON.parse(text); } catch {}
  
  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlock) {
    try { return JSON.parse(jsonBlock[1]); } catch {}
  }
  
  const jsonObj = text.match(/\{[\s\S]*"candidates"[\s\S]*\}/);
  if (jsonObj) {
    try { return JSON.parse(jsonObj[0]); } catch {}
  }
  
  return null;
}

/**
 * Parse CLI JSON output into DiscoveryResult
 */
function parseResult(stdout: string, source: 'openclaw' | 'clawdbot'): DiscoveryResult | null {
  let json: any;
  try {
    json = JSON.parse(stdout);
  } catch {
    logger.warn(`[${source}] Failed to parse stdout as JSON`);
    return null;
  }
  
  const agentText = json.payloads?.[0]?.text ?? '';
  const data = extractJson(agentText);
  
  if (!data?.candidates?.length) {
    logger.warn(`[${source}] No candidates found in response`);
    return null;
  }
  
  return {
    candidates: data.candidates,
    summary: data.summary || { headline: `Found ${data.candidates.length} candidates`, key_insights: [], venues_searched: [] },
    metadata: {
      searches_performed: data.metadata?.searches_performed || 0,
      pages_fetched: data.metadata?.pages_fetched || 0,
      candidates_evaluated: data.candidates.length,
      completed: true,
    },
    source,
  };
}

/**
 * Run CLI with streaming output and timeout
 */
function runCLI(cli: string, agent: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['agent', '--local', '--json', '--timeout', String(TIMEOUT_SECONDS), '--agent', agent, '-m', message];
    
    logger.info(`[${cli}] Spawning process`, { timeout: TIMEOUT_SECONDS, agent });
    
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
      // Log each line of output
      text.split('\n').filter(Boolean).forEach(line => {
        logger.info(`[${cli}] stdout: ${line.slice(0, 200)}`);
      });
    });
    
    // Stream stderr (includes openclaw's progress messages)
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      text.split('\n').filter(Boolean).forEach(line => {
        logger.info(`[${cli}] stderr: ${line.slice(0, 200)}`);
      });
    });
    
    // Timeout - kill process after TIMEOUT_SECONDS
    const timer = setTimeout(() => {
      logger.warn(`[${cli}] Timeout after ${TIMEOUT_SECONDS}s, killing process`);
      proc.kill('SIGTERM');
    }, TIMEOUT_SECONDS * 1000);
    
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startMs;
      logger.info(`[${cli}] Process exited`, { code, signal, elapsedMs, stdoutLen: stdout.length });
      
      if (stdout) {
        resolve(stdout);
      } else {
        reject(new Error(`Process exited with code ${code}, signal ${signal}`));
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Execute discovery via CLI
 */
async function executeViaCLI(cli: 'openclaw' | 'clawdbot', job: DiscoveryJob): Promise<DiscoveryResult | null> {
  const agent = await getDefaultAgent(cli);
  if (!agent) {
    logger.warn(`[${cli}] No agent configured`);
    return null;
  }
  
  const message = `${job.systemPrompt}\n\n---\n\n${job.userPrompt}\n\nReturn ONLY valid JSON.`;
  
  try {
    const stdout = await runCLI(cli, agent, message);
    const result = parseResult(stdout, cli);
    if (result) {
      logger.info(`[${cli}] Got ${result.candidates.length} candidates`);
    }
    return result;
  } catch (err: any) {
    logger.warn(`[${cli}] Failed`, { error: err.message });
    return null;
  }
}

/**
 * Main entry: try OpenClaw, then Clawdbot, then simulated
 */
export async function executeDiscovery(job: DiscoveryJob): Promise<DiscoveryResult> {
  logger.info('Starting discovery', { timeout: TIMEOUT_SECONDS });
  
  if (await checkCommand('openclaw')) {
    logger.info('Trying openclaw...');
    const result = await executeViaCLI('openclaw', job);
    if (result?.candidates.length) return result;
  }
  
  if (await checkCommand('clawdbot')) {
    logger.info('Trying clawdbot...');
    const result = await executeViaCLI('clawdbot', job);
    if (result?.candidates.length) return result;
  }
  
  logger.warn('No CLI available or no results, using simulated data');
  return getSimulatedResult();
}

/**
 * Simulated result for testing
 */
function getSimulatedResult(): DiscoveryResult {
  return {
    candidates: [
      {
        name: 'Sarah Jenkins',
        handle: '@sjenkins_growth',
        role: 'Head of Growth',
        company: 'CloudScale AI',
        why_match: ['B2B content partnerships interest'],
        evidence_urls: ['https://linkedin.com/in/sjenkins-growth'],
        risk_flags: [],
        scores: { relevance: 95, intent: 88, final_score: 92 },
        last_activity: new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0],
        suggested_intro: "Hi Sarah, would you be open to a quick chat?",
      }
    ],
    summary: {
      headline: 'Found 1 candidate (simulated)',
      key_insights: ['Using simulated data'],
      venues_searched: ['web'],
    },
    metadata: { searches_performed: 0, pages_fetched: 0, candidates_evaluated: 1 },
    source: 'simulated',
  };
}
