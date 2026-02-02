import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from './config';
import { uploadToVault } from './vault';
import { logger } from './logger';

const execAsync = promisify(exec);

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
 * Execute the clawbridge discovery and process results
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
    // Real discovery via OpenClaw
    brief = await executeDiscovery(config, runId, profileHash);
  }
  
  // Calculate run duration
  const durationSeconds = (Date.now() - startTime) / 1000;
  brief.run_metadata = {
    searches_performed: brief.run_metadata?.searches_performed || 0,
    pages_fetched: brief.run_metadata?.pages_fetched || 0,
    candidates_evaluated: brief.run_metadata?.candidates_evaluated || 0,
    duration_seconds: durationSeconds,
    skill_version: '1.0.0',
  };
  
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
 * Execute real discovery via OpenClaw batch execution
 */
async function executeDiscovery(
  config: Config, 
  runId: string, 
  profileHash: string
): Promise<ConnectionBrief> {
  logger.info('Starting discovery via OpenClaw');
  
  // Check if OpenClaw is available
  const hasOpenClaw = await checkOpenClaw();
  
  if (!hasOpenClaw) {
    logger.warn('OpenClaw not installed - using simulated discovery');
    logger.info('To enable real discovery, install OpenClaw:');
    logger.info('  npm install -g openclaw@latest');
    logger.info('  openclaw onboard --install-daemon');
    logger.info('  openclaw skills install claw-clawbridge');
    
    // Fall back to simulated discovery for now
    return executeSimulatedDiscovery(config, runId, profileHash);
  }
  
  // Create job input for OpenClaw
  const jobInput = {
    profile: {
      offer: config.project_profile.offer,
      ask: config.project_profile.ask,
      ideal_persona: config.project_profile.ideal_persona,
      verticals: config.project_profile.verticals,
      tone: config.project_profile.tone,
      disallowed: config.project_profile.disallowed,
    },
    budget: {
      max_searches: config.run_budget?.max_searches || 20,
      max_fetches: config.run_budget?.max_fetches || 50,
      max_minutes: config.run_budget?.max_minutes || 10,
    },
    constraints: {
      top_k: config.constraints?.top_k || 5,
      recency_days: config.constraints?.recency_days || 14,
      min_evidence: config.constraints?.min_evidence || 2,
    },
    workspace_id: config.workspace_id,
    run_id: runId,
    profile_hash: profileHash,
  };
  
  // Write job input to temp file
  const tmpDir = path.join(process.cwd(), '.clawbridge-tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const jobPath = path.join(tmpDir, 'job.json');
  const resultPath = path.join(tmpDir, 'result.json');
  
  fs.writeFileSync(jobPath, JSON.stringify(jobInput, null, 2));
  
  try {
    logger.info('Invoking OpenClaw agent', { skill: 'claw-clawbridge' });
    
    // Call OpenClaw non-interactively
    // Note: OpenClaw CLI syntax may vary; adapt as needed
    const { stdout, stderr } = await execAsync(
      `openclaw agent --skill claw-clawbridge --input "${jobPath}" --output "${resultPath}" --non-interactive`,
      { timeout: (config.run_budget?.max_minutes || 10) * 60 * 1000 }
    );
    
    if (stderr) {
      logger.debug('OpenClaw stderr', { stderr });
    }
    
    // Read and parse result
    if (!fs.existsSync(resultPath)) {
      throw new Error('OpenClaw did not produce output file');
    }
    
    const resultContent = fs.readFileSync(resultPath, 'utf-8');
    const result = JSON.parse(resultContent);
    
    // Map OpenClaw result to ConnectionBrief format
    const brief: ConnectionBrief = {
      workspace_id: config.workspace_id,
      run_id: runId,
      project_profile_hash: profileHash,
      run_metadata: result.metadata || {
        duration_seconds: 0,
        searches_performed: 0,
        pages_fetched: 0,
        candidates_evaluated: 0,
        skill_version: '1.0.0',
      },
      candidates: result.candidates || [],
      next_actions: result.next_actions || [],
      summary: result.summary || {
        headline: `Found ${result.candidates?.length || 0} candidates`,
        key_insights: [],
        venues_searched: [],
      },
    };
    
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
    
    return brief;
    
  } catch (error: any) {
    // Clean up temp files on error
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    
    if (error.message.includes('ETIMEDOUT') || error.killed) {
      logger.error('OpenClaw execution timed out', { minutes: config.run_budget?.max_minutes || 10 });
    } else {
      logger.warn('OpenClaw execution failed, falling back to simulated discovery', { 
        error: error.message 
      });
    }
    
    // Fall back to simulated discovery
    return executeSimulatedDiscovery(config, runId, profileHash);
  }
}

/**
 * Simulated discovery (used when OpenClaw is not available)
 */
function executeSimulatedDiscovery(
  config: Config, 
  runId: string, 
  profileHash: string
): ConnectionBrief {
  logger.info('Running simulated discovery (OpenClaw not available)');
  
  return {
    workspace_id: config.workspace_id,
    run_id: runId,
    project_profile_hash: profileHash,
    run_metadata: {
      duration_seconds: 4.2,
      searches_performed: 8,
      pages_fetched: 12,
      candidates_evaluated: 15,
      skill_version: '1.0.0',
    },
    candidates: [
      {
        name: 'Sarah Jenkins',
        handle: '@sjenkins_growth',
        role: 'Head of Growth',
        company: 'CloudScale AI',
        why_match: [
          'Explicitly stated interest in B2B content partnerships',
          'Recently launched a new vertical matching your core offering',
          'Active engagement in SaaS communities within last 4 days'
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
        suggested_followup: "Hi Sarah, following up on my note - would love to share a quick case study if you're still scouting partners.",
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
        suggested_followup: "Hi Marcus, just circling back to see if StackFlow is looking at content automation this quarter.",
      }
    ],
    next_actions: [
      {
        candidate_handle: '@sjenkins_growth',
        action: 'reach_out',
        reason: 'Perfect match with high intent signal',
        priority: 'high',
      },
      {
        candidate_handle: '@mthorne_dev',
        action: 'research_more',
        reason: 'Strong credibility but low intent evidence',
        priority: 'medium',
      }
    ],
    summary: {
      headline: 'Found 2 high-quality matches (simulated - install OpenClaw for real discovery)',
      key_insights: [
        'High partnership intent detected in AI vertical',
        'Found 1 immediate reach-out opportunity',
        'Note: Install OpenClaw for real discovery'
      ],
      venues_searched: ['linkedin', 'web'],
    },
  };
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
      skill_version: '1.0.0',
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
  lines.push(`*Generated by clawbridge-runner v1.0.0*`);
  
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
