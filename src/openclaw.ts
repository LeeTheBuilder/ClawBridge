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
    await execAsync(`${cmd} --version`);
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
    const { stdout } = await execAsync(`${cli} agents list`);
    // Look for the default agent (marked with "(default)")
    const match = stdout.match(/- (\w+) \(default\)/);
    if (match) {
      return match[1];
    }
    // Or just get the first agent listed
    const firstAgent = stdout.match(/- (\w+)/);
    return firstAgent ? firstAgent[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract JSON from a text response that might contain markdown code blocks
 */
function extractJsonFromResponse(text: string): any | null {
  // Try direct JSON parse first
  try {
    return JSON.parse(text);
  } catch {}
  
  // Look for JSON in markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1]);
    } catch {}
  }
  
  // Look for JSON object anywhere in the text
  const jsonMatch = text.match(/\{[\s\S]*"candidates"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }
  
  return null;
}

/**
 * Execute discovery via OpenClaw CLI (local)
 */
async function executeViaOpenClaw(job: DiscoveryJob, timeoutMs: number): Promise<DiscoveryResult | null> {
  let stdout = '';
  let stderr = '';
  
  try {
    // Get the default agent
    const agent = await getDefaultAgent('openclaw');
    if (!agent) {
      logger.debug('No OpenClaw agent configured');
      return null;
    }
    
    // Calculate CLI timeout (slightly less than our timeout to allow for cleanup)
    const cliTimeoutSeconds = Math.max(30, Math.floor(job.timeoutSeconds * 0.9));
    
    logger.info('Invoking OpenClaw agent', { 
      agent, 
      timeoutSeconds: cliTimeoutSeconds,
      maxSearches: job.maxSearches,
      maxFetches: job.maxFetches,
    });
    
    // Build the message - combine system and user prompts
    // Ask for JSON output explicitly
    const message = `${job.systemPrompt}\n\n---\n\n${job.userPrompt}\n\nIMPORTANT: Return your response as valid JSON only. No markdown, no extra text.`;
    
    // Escape for shell
    const escapedMessage = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
    
    // Use openclaw agent with --local and --timeout
    const result = await execAsync(
      `openclaw agent --local --json --timeout ${cliTimeoutSeconds} --agent ${agent} -m "${escapedMessage}"`,
      { 
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      }
    );
    
    stdout = result.stdout;
    stderr = result.stderr;
    
    if (stderr) {
      logger.debug('OpenClaw stderr', { stderr: stderr.substring(0, 500) });
    }
    
    return parseOpenClawResponse(stdout, 'openclaw');
    
  } catch (error: any) {
    // Check if we got partial output before timeout
    const partialStdout = error.stdout || stdout;
    const partialStderr = error.stderr || stderr;
    
    const isTimeout = error.killed || error.message?.includes('TIMEOUT') || error.signal === 'SIGTERM';
    
    if (isTimeout && partialStdout) {
      logger.warn('OpenClaw timed out, checking for partial results');
      const partialResult = parseOpenClawResponse(partialStdout, 'openclaw');
      if (partialResult && partialResult.candidates.length > 0) {
        logger.info('Recovered partial results from timeout', { 
          candidates: partialResult.candidates.length 
        });
        // Mark as incomplete
        partialResult.metadata.completed = false;
        return partialResult;
      }
    }
    
    logger.debug('OpenClaw execution failed', { 
      error: error.message,
      isTimeout,
      stderr: partialStderr?.substring(0, 1000),
      stdout: partialStdout?.substring(0, 500),
    });
    return null;
  }
}

/**
 * Parse OpenClaw/Clawdbot CLI response
 */
function parseOpenClawResponse(stdout: string, source: 'openclaw' | 'clawdbot'): DiscoveryResult | null {
  // Parse the CLI JSON output
  let cliResponse: any;
  try {
    cliResponse = JSON.parse(stdout);
  } catch (e) {
    logger.debug(`Failed to parse ${source} CLI output as JSON`);
    return null;
  }
  
  // Extract the agent's text response
  const agentText = cliResponse.payloads?.[0]?.text || '';
  logger.debug(`${source} agent response`, { text: agentText.substring(0, 500) });
  
  // Try to extract JSON from the agent's response
  const discoveryData = extractJsonFromResponse(agentText);
  
  if (!discoveryData || !discoveryData.candidates || discoveryData.candidates.length === 0) {
    logger.debug(`${source} response did not contain valid candidates`);
    return null;
  }
  
  return {
    candidates: discoveryData.candidates,
    summary: discoveryData.summary || { 
      headline: `Found ${discoveryData.candidates.length} candidates via ${source}`, 
      key_insights: [], 
      venues_searched: [] 
    },
    metadata: {
      searches_performed: discoveryData.metadata?.searches_performed || 0, 
      pages_fetched: discoveryData.metadata?.pages_fetched || 0, 
      candidates_evaluated: discoveryData.metadata?.candidates_evaluated || discoveryData.candidates.length,
      completed: discoveryData.metadata?.completed !== false,
    },
    source,
  };
}

/**
 * Execute discovery via Clawdbot CLI (local fallback)
 */
async function executeViaClawdbot(job: DiscoveryJob, timeoutMs: number): Promise<DiscoveryResult | null> {
  let stdout = '';
  let stderr = '';
  
  try {
    // Get the default agent
    const agent = await getDefaultAgent('clawdbot');
    if (!agent) {
      logger.debug('No Clawdbot agent configured');
      return null;
    }
    
    // Calculate CLI timeout
    const cliTimeoutSeconds = Math.max(30, Math.floor(job.timeoutSeconds * 0.9));
    
    logger.info('Invoking Clawdbot agent', { 
      agent, 
      timeoutSeconds: cliTimeoutSeconds,
    });
    
    // Build the message
    const message = `${job.systemPrompt}\n\n---\n\n${job.userPrompt}\n\nIMPORTANT: Return your response as valid JSON only. No markdown, no extra text.`;
    
    // Escape for shell
    const escapedMessage = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
    
    // Use clawdbot agent with --local, --json, and --timeout
    const result = await execAsync(
      `clawdbot agent --local --json --timeout ${cliTimeoutSeconds} --agent ${agent} -m "${escapedMessage}"`,
      { 
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    
    stdout = result.stdout;
    stderr = result.stderr;
    
    if (stderr) {
      logger.debug('Clawdbot stderr', { stderr: stderr.substring(0, 500) });
    }
    
    return parseOpenClawResponse(stdout, 'clawdbot');
    
  } catch (error: any) {
    // Check if we got partial output before timeout
    const partialStdout = error.stdout || stdout;
    const partialStderr = error.stderr || stderr;
    
    const isTimeout = error.killed || error.message?.includes('TIMEOUT') || error.signal === 'SIGTERM';
    
    if (isTimeout && partialStdout) {
      logger.warn('Clawdbot timed out, checking for partial results');
      const partialResult = parseOpenClawResponse(partialStdout, 'clawdbot');
      if (partialResult && partialResult.candidates.length > 0) {
        logger.info('Recovered partial results from timeout', { 
          candidates: partialResult.candidates.length 
        });
        partialResult.metadata.completed = false;
        return partialResult;
      }
    }
    
    logger.debug('Clawdbot execution failed', { 
      error: error.message,
      isTimeout,
      stderr: partialStderr?.substring(0, 1000),
      stdout: partialStdout?.substring(0, 500),
    });
    return null;
  }
}

/**
 * Execute discovery with fallback chain:
 * 1. OpenClaw CLI (local, if available)
 * 2. Clawdbot CLI (local, if available)
 * 3. Simulated data (last resort)
 */
export async function executeDiscovery(job: DiscoveryJob, timeoutMs: number = 600000): Promise<DiscoveryResult> {
  logger.info('Starting discovery execution');
  
  // Try OpenClaw first
  const hasOpenClaw = await checkCommand('openclaw');
  if (hasOpenClaw) {
    logger.info('OpenClaw CLI detected, attempting discovery');
    const result = await executeViaOpenClaw(job, timeoutMs);
    if (result && result.candidates.length > 0) {
      logger.info('Discovery completed via OpenClaw', { candidates: result.candidates.length });
      return result;
    }
    logger.info('OpenClaw returned no results, trying Clawdbot');
  } else {
    logger.info('OpenClaw CLI not found, trying Clawdbot');
  }
  
  // Try Clawdbot as fallback
  const hasClawdbot = await checkCommand('clawdbot');
  if (hasClawdbot) {
    logger.info('Clawdbot CLI detected, attempting discovery');
    const result = await executeViaClawdbot(job, timeoutMs);
    if (result && result.candidates.length > 0) {
      logger.info('Discovery completed via Clawdbot', { candidates: result.candidates.length });
      return result;
    }
    logger.info('Clawdbot returned no results');
  } else {
    logger.info('Clawdbot CLI not found');
  }
  
  // Fall back to simulated data
  logger.warn('No discovery method succeeded, using simulated data');
  logger.warn('For real discovery, ensure openclaw or clawdbot is configured with model API keys');
  return getSimulatedResult();
}

/**
 * Generate simulated discovery result (for testing/demo)
 */
function getSimulatedResult(): DiscoveryResult {
  return {
    candidates: [
      {
        name: 'Sarah Jenkins',
        handle: '@sjenkins_growth',
        role: 'Head of Growth',
        company: 'CloudScale AI',
        why_match: [
          'Explicitly stated interest in B2B content partnerships',
          'Recently launched a new vertical matching your offering',
          'Active in SaaS communities within last 4 days'
        ],
        evidence_urls: [
          'https://linkedin.com/in/sjenkins-growth',
          'https://cloudscale.ai/about'
        ],
        risk_flags: [],
        scores: {
          relevance: 95,
          intent: 88,
          credibility: 90,
          recency: 98,
          engagement: 85,
          final_score: 92.2,
        },
        last_activity: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        suggested_intro: "Hi Sarah,\n\nI saw your recent content about CloudScale's new vertical. We've helped similar Series B teams automate this exact workflow.\n\nWould you be open to a 10-minute intro call?",
      },
      {
        name: 'Marcus Thorne',
        handle: '@mthorne_dev',
        role: 'Founder',
        company: 'StackFlow Solutions',
        why_match: [
          'Matches ideal persona (Technical Founder)',
          'High credibility with verified LinkedIn presence',
        ],
        evidence_urls: [
          'https://linkedin.com/in/mthorne',
          'https://stackflow.io/about'
        ],
        risk_flags: ['low_evidence'],
        scores: {
          relevance: 82,
          intent: 65,
          credibility: 92,
          recency: 70,
          engagement: 60,
          final_score: 76.5,
        },
        last_activity: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        suggested_intro: "Hi Marcus,\n\nImpressive work on StackFlow's latest release. Given your focus on automation, I thought our content ops framework might be of interest.",
      }
    ],
    summary: {
      headline: 'Found 2 candidates (simulated - install OpenClaw or Clawdbot for real discovery)',
      key_insights: [
        'High partnership intent detected in AI vertical',
        'Found 1 immediate reach-out opportunity',
        'Note: Using simulated data'
      ],
      venues_searched: ['linkedin', 'web'],
    },
    metadata: {
      searches_performed: 8,
      pages_fetched: 12,
      candidates_evaluated: 15,
    },
    source: 'simulated',
  };
}
