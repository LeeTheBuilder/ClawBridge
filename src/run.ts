import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Config } from './config';
import { uploadToVault } from './vault';
import { logger } from './logger';
import { buildDiscoveryJob } from './prompts';
import { executeDiscovery, DiscoveryResult } from './openclaw';

export interface ConnectionBrief {
  workspace_id: string;
  run_id: string;
  project_profile_hash: string;
  run_metadata?: {
    duration_seconds: number;
    searches_performed: number;
    pages_fetched: number;
    candidates_evaluated: number;
    skill_version: string;
    discovery_source?: 'openclaw' | 'clawdbot' | 'simulated' | 'dry_run';
  };
  candidates: Candidate[];
  next_actions: NextAction[];
  summary?: {
    headline: string;
    key_insights: string[];
    venues_searched: string[];
  };
}

export interface Candidate {
  name: string;
  handle?: string;
  role?: string;
  company?: string;
  why_match: string[];
  evidence_urls: string[];
  risk_flags?: string[];
  scores?: {
    relevance: number;
    intent: number;
    credibility: number;
    recency: number;
    engagement: number;
    final_score: number;
  };
  last_activity?: string;
  suggested_intro: string;
  suggested_followup?: string;
}

export interface NextAction {
  candidate_handle: string;
  action: string;
  reason: string;
  via?: string;
  priority?: string;
}

export interface RunOptions {
  config: Config;
  outputDir: string;
  upload: boolean;
  dryRun: boolean;
  profile?: string;
}

/**
 * Execute Clawbridge discovery and process results
 */
export async function runSkill(options: RunOptions): Promise<ConnectionBrief> {
  const { config, outputDir, dryRun, profile } = options;
  const startTime = Date.now();
  
  const profileName = profile || 'default';
  
  logger.info('Starting Clawbridge run', { 
    workspace_id: config.workspace_id,
    profile: profileName,
    dry_run: dryRun 
  });
  
  // Generate run ID (ISO timestamp)
  const runId = new Date().toISOString();
  
  // Hash the project profile for tracking
  const profileHash = generateProfileHash(config.project_profile);
  
  // Execute discovery
  let brief: ConnectionBrief;
  
  if (dryRun) {
    logger.info('Dry run - generating sample output');
    brief = generateSampleBrief(config.workspace_id, runId, profileHash);
  } else {
    // Real discovery via OpenClaw/Clawdbot/Moltbot
    brief = await executeRealDiscovery(config, runId, profileHash);
  }
  
  // Calculate run duration
  const durationSeconds = (Date.now() - startTime) / 1000;
  if (brief.run_metadata) {
    brief.run_metadata.duration_seconds = durationSeconds;
  }
  
  // Ensure output directory exists
  const outputPath = path.resolve(outputDir);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  // Generate output filenames
  const timestamp = runId.replace(/[:.]/g, '-');
  const jsonPath = path.join(outputPath, `run-${timestamp}.json`);
  const mdPath = path.join(outputPath, `run-${timestamp}.md`);
  
  // Write JSON output
  fs.writeFileSync(jsonPath, JSON.stringify(brief, null, 2));
  logger.info('JSON output written', { path: jsonPath });
  
  // Generate and write Markdown report
  const markdown = generateMarkdownReport(brief, config);
  fs.writeFileSync(mdPath, markdown);
  logger.info('Markdown report written', { path: mdPath });
  
  // Create/update latest symlinks
  createLatestLinks(outputPath, jsonPath, mdPath);
  
  // Upload to vault (the only output channel)
  let vaultUrl: string | undefined;
  if (options.upload && config.vault?.enabled && !dryRun) {
    logger.info('Uploading to vault');
    try {
      const uploadResult = await uploadToVault(brief, config);
      if (uploadResult) {
        vaultUrl = uploadResult.vaultUrl;
        logger.info('Vault upload successful', { vaultUrl });
      }
    } catch (error: any) {
      logger.error('Vault upload failed', { error: error.message });
      // Continue - don't fail the entire run
    }
  }
  
  // Clean up old runs
  if (config.output?.keep_runs) {
    cleanupOldRuns(outputPath, config.output.keep_runs);
  }

  // === Machine-readable output ===
  console.log('');
  console.log('─'.repeat(60));
  console.log('');
  console.log('📋 RUN COMPLETE');
  console.log('');
  console.log(`PROFILE=${profileName}`);
  console.log(`JSON_PATH=${jsonPath}`);
  console.log(`MD_PATH=${mdPath}`);
  console.log(`CANDIDATES_COUNT=${brief.candidates.length}`);
  console.log(`DISCOVERY_SOURCE=${brief.run_metadata?.discovery_source || 'unknown'}`);
  if (vaultUrl) {
    console.log(`VAULT_URL=${vaultUrl}`);
  }
  console.log('');
  
  // Human-readable summary
  if (brief.summary) {
    console.log(`✅ ${brief.summary.headline}`);
  }
  if (vaultUrl) {
    console.log(`🔗 View results: ${vaultUrl}`);
  }
  console.log('');
  console.log('─'.repeat(60));
  
  return brief;
}

/**
 * Execute real discovery using OpenClaw/Clawdbot/Moltbot
 */
async function executeRealDiscovery(
  config: Config, 
  runId: string, 
  profileHash: string
): Promise<ConnectionBrief> {
  logger.info('Building discovery job');
  
  // Build the discovery job with runner-controlled prompts
  const job = buildDiscoveryJob(config);
  
  // Execute discovery (timeout is configured in openclaw.ts)
  const result = await executeDiscovery(job);
  
  // Map result to ConnectionBrief format
  const brief: ConnectionBrief = {
    workspace_id: config.workspace_id,
    run_id: runId,
    project_profile_hash: profileHash,
    run_metadata: {
      duration_seconds: 0, // Will be filled in later
      searches_performed: result.metadata.searches_performed,
      pages_fetched: result.metadata.pages_fetched,
      candidates_evaluated: result.metadata.candidates_evaluated,
      skill_version: '2.4.0',
      discovery_source: result.source,
    },
    candidates: result.candidates.map(c => ({
      name: c.name,
      handle: c.handle,
      role: c.role,
      company: c.company,
      why_match: c.why_match || [],
      evidence_urls: c.evidence_urls || [],
      risk_flags: c.risk_flags,
      scores: c.scores,
      last_activity: c.last_activity,
      suggested_intro: c.suggested_intro || '',
      suggested_followup: c.suggested_followup,
    })),
    next_actions: result.candidates.map(c => ({
      candidate_handle: c.handle || c.name,
      action: c.scores?.final_score >= 80 ? 'reach_out' : 'research_more',
      reason: c.scores?.final_score >= 80 ? 'High match score' : 'Needs more research',
      priority: c.scores?.final_score >= 80 ? 'high' : 'medium',
    })),
    summary: result.summary,
  };
  
  return brief;
}

/**
 * Generate a SHA-256 hash of the project profile
 */
function generateProfileHash(profile: Config['project_profile']): string {
  const content = JSON.stringify(profile);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Generate a sample brief for testing/dry-run
 */
function generateSampleBrief(
  workspaceId: string, 
  runId: string, 
  profileHash: string
): ConnectionBrief {
  return {
    workspace_id: workspaceId,
    run_id: runId,
    project_profile_hash: profileHash,
    run_metadata: {
      duration_seconds: 0,
      searches_performed: 15,
      pages_fetched: 42,
      candidates_evaluated: 28,
      skill_version: '2.4.0',
      discovery_source: 'dry_run',
    },
    candidates: [
      {
        name: 'Sample Candidate',
        handle: '@sample_user',
        role: 'VP of Marketing',
        company: 'Example Corp',
        why_match: [
          'Matches target persona',
          'Recent activity in target vertical',
        ],
        evidence_urls: [
          'https://example.com/profile',
          'https://linkedin.com/in/sample',
        ],
        risk_flags: [],
        scores: {
          relevance: 85,
          intent: 90,
          credibility: 80,
          recency: 95,
          engagement: 70,
          final_score: 85.5,
        },
        last_activity: new Date().toISOString().split('T')[0],
        suggested_intro: 'Hi [Name],\n\nI noticed your work on [topic]...',
        suggested_followup: 'Hi [Name],\n\nJust wanted to follow up...',
      },
    ],
    next_actions: [
      {
        candidate_handle: '@sample_user',
        action: 'reach_out',
        reason: 'High intent signal, recent activity',
        priority: 'high',
      },
    ],
    summary: {
      headline: 'Dry run completed - 1 sample candidate',
      key_insights: ['This is a dry-run output for testing'],
      venues_searched: ['web', 'linkedin'],
    },
  };
}

/**
 * Generate a human-readable Markdown report
 */
function generateMarkdownReport(brief: ConnectionBrief, config: Config): string {
  const lines: string[] = [];
  
  lines.push('# Connection Brief\n');
  lines.push(`**Workspace:** ${brief.workspace_id}  `);
  lines.push(`**Run Date:** ${new Date(brief.run_id).toLocaleString()}  `);
  lines.push(`**Discovery Source:** ${brief.run_metadata?.discovery_source || 'unknown'}  `);
  lines.push('');
  lines.push('---\n');
  
  // Summary
  if (brief.summary) {
    lines.push('## Summary\n');
    lines.push(`**${brief.summary.headline}**\n`);
    
    if (brief.summary.key_insights.length > 0) {
      lines.push('### Key Insights');
      brief.summary.key_insights.forEach(insight => {
        lines.push(`- ${insight}`);
      });
      lines.push('');
    }
    
    if (brief.summary.venues_searched.length > 0) {
      lines.push(`**Venues Searched:** ${brief.summary.venues_searched.join(', ')}\n`);
    }
  }
  
  // Run stats
  if (brief.run_metadata) {
    lines.push('### Run Statistics');
    lines.push(`- Duration: ${brief.run_metadata.duration_seconds.toFixed(1)}s`);
    lines.push(`- Searches: ${brief.run_metadata.searches_performed}`);
    lines.push(`- Pages fetched: ${brief.run_metadata.pages_fetched}`);
    lines.push(`- Candidates evaluated: ${brief.run_metadata.candidates_evaluated}`);
    lines.push(`- Source: ${brief.run_metadata.discovery_source}`);
    lines.push('');
  }
  
  lines.push('---\n');
  
  // Candidates
  lines.push('## Top Candidates\n');
  
  if (brief.candidates.length === 0) {
    lines.push('*No candidates found matching criteria.*\n');
  } else {
    brief.candidates.forEach((candidate, index) => {
      lines.push(`### #${index + 1}: ${candidate.name}`);
      
      if (candidate.role && candidate.company) {
        lines.push(`**${candidate.role}** at **${candidate.company}**  `);
      }
      if (candidate.handle) {
        lines.push(`Handle: ${candidate.handle}  `);
      }
      if (candidate.scores) {
        lines.push(`Score: **${candidate.scores.final_score.toFixed(1)}** / 100\n`);
      }
      
      lines.push('#### Why This Match');
      candidate.why_match.forEach(reason => {
        lines.push(`- ✅ ${reason}`);
      });
      lines.push('');
      
      lines.push('#### Evidence');
      candidate.evidence_urls.forEach(url => {
        lines.push(`- [${url}](${url})`);
      });
      lines.push('');
      
      if (candidate.risk_flags && candidate.risk_flags.length > 0) {
        lines.push('#### Risk Flags');
        candidate.risk_flags.forEach(flag => {
          lines.push(`- ⚠️ ${flag}`);
        });
        lines.push('');
      }
      
      lines.push('#### Suggested Introduction');
      lines.push('```');
      lines.push(candidate.suggested_intro);
      lines.push('```\n');
      
      if (candidate.suggested_followup) {
        lines.push('#### Suggested Follow-up');
        lines.push('```');
        lines.push(candidate.suggested_followup);
        lines.push('```\n');
      }
      
      // Find action for this candidate
      const action = brief.next_actions.find(
        a => a.candidate_handle === candidate.handle
      );
      if (action) {
        const priorityEmoji = action.priority === 'high' ? '🟢' : 
                              action.priority === 'medium' ? '🟡' : '⚪';
        lines.push(`#### Recommended Action`);
        lines.push(`${priorityEmoji} **${action.action.toUpperCase()}**`);
        lines.push(`Reason: ${action.reason}\n`);
      }
      
      lines.push('---\n');
    });
  }
  
  // Reminders
  lines.push('## Reminders\n');
  lines.push('⚠️ **Human Approval Required**  ');
  lines.push('All outreach drafts are suggestions only. Review and personalize before sending.\n');
  lines.push('⚠️ **No Auto-Send**  ');
  lines.push('This system does not automatically send messages.\n');
  lines.push('---\n');
  lines.push(`*Generated by clawbridge-runner v2.4.0*`);
  
  return lines.join('\n');
}

/**
 * Create symlinks to latest run files
 */
function createLatestLinks(outputPath: string, jsonPath: string, mdPath: string): void {
  const latestJson = path.join(outputPath, 'latest.json');
  const latestMd = path.join(outputPath, 'latest.md');
  
  try {
    if (fs.existsSync(latestJson)) fs.unlinkSync(latestJson);
    if (fs.existsSync(latestMd)) fs.unlinkSync(latestMd);
    
    fs.symlinkSync(path.basename(jsonPath), latestJson);
    fs.symlinkSync(path.basename(mdPath), latestMd);
  } catch (error) {
    // Symlinks may fail on some systems, that's okay
    logger.debug('Could not create latest symlinks', { error });
  }
}

/**
 * Clean up old run files, keeping only the most recent N
 */
function cleanupOldRuns(outputPath: string, keepCount: number): void {
  const files = fs.readdirSync(outputPath)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(outputPath, f),
      mtime: fs.statSync(path.join(outputPath, f)).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  const toDelete = files.slice(keepCount);
  
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.path);
      // Also delete the corresponding .md file
      const mdPath = file.path.replace('.json', '.md');
      if (fs.existsSync(mdPath)) {
        fs.unlinkSync(mdPath);
      }
      logger.debug('Cleaned up old run', { file: file.name });
    } catch (error) {
      logger.warn('Failed to clean up file', { file: file.name, error });
    }
  }
}
