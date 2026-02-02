/**
 * OpenClaw Worker Module
 * 
 * Handles calling OpenClaw as a worker to perform web search/fetch/extraction.
 * Falls back to clawdbot/moltbot API if OpenClaw is not available.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
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
  };
  source: 'openclaw' | 'clawdbot' | 'moltbot' | 'simulated';
}

/**
 * Check if OpenClaw CLI is available
 */
async function checkOpenClaw(): Promise<boolean> {
  try {
    await execAsync('openclaw --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute discovery via OpenClaw CLI
 */
async function executeViaOpenClaw(job: DiscoveryJob, timeoutMs: number): Promise<DiscoveryResult | null> {
  const tmpDir = path.join(os.tmpdir(), `clawbridge-${Date.now()}`);
  
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    
    // Write the job to a temp file
    const jobPath = path.join(tmpDir, 'job.json');
    const resultPath = path.join(tmpDir, 'result.json');
    
    const jobData = {
      system: job.systemPrompt,
      message: job.userPrompt,
      tools: job.tools,
      max_tokens: job.maxTokens,
    };
    
    fs.writeFileSync(jobPath, JSON.stringify(jobData, null, 2));
    
    logger.info('Invoking OpenClaw worker');
    
    // Try the correct OpenClaw CLI syntax
    // openclaw run with message and optional system prompt
    const { stdout, stderr } = await execAsync(
      `openclaw run -m "${job.userPrompt.replace(/"/g, '\\"').substring(0, 500)}..." --json`,
      { timeout: timeoutMs }
    );
    
    if (stderr) {
      logger.debug('OpenClaw stderr', { stderr: stderr.substring(0, 200) });
    }
    
    // Parse the result
    const result = JSON.parse(stdout);
    
    return {
      candidates: result.candidates || [],
      summary: result.summary || { headline: '', key_insights: [], venues_searched: [] },
      metadata: result.metadata || { searches_performed: 0, pages_fetched: 0, candidates_evaluated: 0 },
      source: 'openclaw',
    };
    
  } catch (error: any) {
    logger.debug('OpenClaw execution failed', { error: error.message });
    return null;
  } finally {
    // Clean up
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Execute discovery via clawdbot API (fallback)
 */
async function executeViaClawdbot(job: DiscoveryJob, timeoutMs: number): Promise<DiscoveryResult | null> {
  const apiUrl = process.env.CLAWDBOT_API_URL || 'https://api.clawdbot.com';
  const apiKey = process.env.CLAWDBOT_API_KEY;
  
  if (!apiKey) {
    logger.debug('Clawdbot API key not configured');
    return null;
  }
  
  try {
    logger.info('Invoking Clawdbot API');
    
    const response = await axios.post(
      `${apiUrl}/v1/discover`,
      {
        system_prompt: job.systemPrompt,
        user_prompt: job.userPrompt,
        tools: job.tools,
        max_tokens: job.maxTokens,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
      }
    );
    
    const result = response.data;
    
    return {
      candidates: result.candidates || [],
      summary: result.summary || { headline: '', key_insights: [], venues_searched: [] },
      metadata: result.metadata || { searches_performed: 0, pages_fetched: 0, candidates_evaluated: 0 },
      source: 'clawdbot',
    };
    
  } catch (error: any) {
    logger.debug('Clawdbot API failed', { error: error.message });
    return null;
  }
}

/**
 * Execute discovery via moltbot API (fallback)
 */
async function executeViaMoltbot(job: DiscoveryJob, timeoutMs: number): Promise<DiscoveryResult | null> {
  const apiUrl = process.env.MOLTBOT_API_URL || 'https://api.moltbot.com';
  const apiKey = process.env.MOLTBOT_API_KEY;
  
  if (!apiKey) {
    logger.debug('Moltbot API key not configured');
    return null;
  }
  
  try {
    logger.info('Invoking Moltbot API');
    
    const response = await axios.post(
      `${apiUrl}/v1/agent/run`,
      {
        prompt: `${job.systemPrompt}\n\n---\n\n${job.userPrompt}`,
        tools: job.tools,
        output_format: 'json',
      },
      {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
      }
    );
    
    const result = response.data;
    
    return {
      candidates: result.candidates || result.data?.candidates || [],
      summary: result.summary || result.data?.summary || { headline: '', key_insights: [], venues_searched: [] },
      metadata: result.metadata || result.data?.metadata || { searches_performed: 0, pages_fetched: 0, candidates_evaluated: 0 },
      source: 'moltbot',
    };
    
  } catch (error: any) {
    logger.debug('Moltbot API failed', { error: error.message });
    return null;
  }
}

/**
 * Execute discovery with fallback chain:
 * 1. OpenClaw CLI (if available)
 * 2. Clawdbot API (if configured)
 * 3. Moltbot API (if configured)
 * 4. Simulated data (last resort)
 */
export async function executeDiscovery(job: DiscoveryJob, timeoutMs: number = 600000): Promise<DiscoveryResult> {
  logger.info('Starting discovery execution');
  
  // Try OpenClaw first
  const hasOpenClaw = await checkOpenClaw();
  if (hasOpenClaw) {
    const result = await executeViaOpenClaw(job, timeoutMs);
    if (result && result.candidates.length > 0) {
      logger.info('Discovery completed via OpenClaw', { candidates: result.candidates.length });
      return result;
    }
    logger.debug('OpenClaw returned no results, trying fallbacks');
  }
  
  // Try Clawdbot API
  const clawdbotResult = await executeViaClawdbot(job, timeoutMs);
  if (clawdbotResult && clawdbotResult.candidates.length > 0) {
    logger.info('Discovery completed via Clawdbot', { candidates: clawdbotResult.candidates.length });
    return clawdbotResult;
  }
  
  // Try Moltbot API
  const moltbotResult = await executeViaMoltbot(job, timeoutMs);
  if (moltbotResult && moltbotResult.candidates.length > 0) {
    logger.info('Discovery completed via Moltbot', { candidates: moltbotResult.candidates.length });
    return moltbotResult;
  }
  
  // Fall back to simulated data
  logger.warn('All discovery methods failed, using simulated data');
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
      headline: 'Found 2 candidates (simulated - configure OpenClaw/Clawdbot/Moltbot for real discovery)',
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
