import { Config } from '../config';
import { ConnectionBrief } from '../run';
import { deliverDiscord } from './discord';
import { deliverSlack } from './slack';
import { deliverEmail } from './email';
import { logger } from '../logger';

/**
 * Deliver a connection brief to the configured channel
 * Returns true if delivery succeeded, false if skipped or failed (non-fatal)
 */
export async function deliver(brief: ConnectionBrief, config: Config): Promise<boolean> {
  const { target } = config.delivery;
  
  // Skip if delivery is set to 'none' or not configured
  if (!target || target === 'none') {
    logger.info('Delivery skipped (target=none)');
    return false;
  }
  
  logger.info('Delivering connection brief', { 
    target, 
    candidates: brief.candidates.length 
  });
  
  try {
    switch (target) {
      case 'discord':
        // Check if Discord is properly configured
        if (!config.delivery.discord?.webhook_url && 
            !(config.delivery.discord?.bot_token && config.delivery.discord?.channel_id)) {
          logger.warn('Discord delivery skipped - no webhook_url or bot_token+channel_id configured');
          return false;
        }
        await deliverDiscord(brief, config);
        break;
      case 'slack':
        if (!config.delivery.slack?.webhook_url && !config.delivery.slack?.bot_token) {
          logger.warn('Slack delivery skipped - no webhook_url or bot_token configured');
          return false;
        }
        await deliverSlack(brief, config);
        break;
      case 'email':
        if (!config.delivery.email?.smtp_host || !config.delivery.email?.to) {
          logger.warn('Email delivery skipped - SMTP not configured');
          return false;
        }
        await deliverEmail(brief, config);
        break;
      default:
        logger.warn(`Unknown delivery target: ${target}, skipping`);
        return false;
    }
    
    logger.info('Delivery completed', { target });
    return true;
  } catch (error: any) {
    // Delivery failure is non-fatal - log warning and continue
    logger.warn('Delivery failed (non-fatal)', { 
      target, 
      error: error.message 
    });
    return false;
  }
}

/**
 * Test delivery configuration by sending a test message
 */
export async function testDelivery(
  config: Config, 
  channel?: string
): Promise<void> {
  const target = channel || config.delivery.target;
  
  const testBrief: ConnectionBrief = {
    workspace_id: config.workspace_id,
    run_id: new Date().toISOString(),
    project_profile_hash: 'sha256:test',
    candidates: [],
    next_actions: [],
    summary: {
      headline: '🧪 Test message from clawbridge-runner',
      key_insights: ['This is a test delivery to verify your configuration'],
      venues_searched: ['none'],
    },
  };
  
  logger.info('Sending test delivery', { target });
  
  switch (target) {
    case 'discord':
      await deliverDiscord(testBrief, config);
      break;
    case 'slack':
      await deliverSlack(testBrief, config);
      break;
    case 'email':
      await deliverEmail(testBrief, config);
      break;
    default:
      throw new Error(`Unknown delivery target: ${target}`);
  }
  
  logger.info('Test delivery sent successfully');
}

/**
 * Format a brief into a summary message
 */
export function formatSummaryMessage(brief: ConnectionBrief): string {
  const lines: string[] = [];
  
  // Get vault URL if available
  const vaultUrl = (brief as any)._vaultUrl;
  
  // Header with vault link
  lines.push('🌉 **Clawbridge: Connection Brief Ready**\n');
  
  // Summary
  if (brief.summary) {
    lines.push(brief.summary.headline);
    lines.push('');
  }
  
  // Vault URL (if available)
  if (vaultUrl) {
    lines.push(`**View in Vault:** ${vaultUrl}`);
    lines.push('');
  }
  
  // Candidate count
  const count = brief.candidates.length;
  if (count === 0) {
    lines.push('No candidates found matching your criteria this run.');
  } else {
    lines.push(`**${count} candidate${count > 1 ? 's' : ''}** ready for review`);
    lines.push('');
  }
  
  // Key insights
  if (brief.summary?.key_insights && brief.summary.key_insights.length > 0) {
    lines.push('**Key Insights:**');
    brief.summary.key_insights.forEach(insight => {
      lines.push(`• ${insight}`);
    });
    lines.push('');
  }
  
  // Call to action
  if (count > 0 && vaultUrl) {
    lines.push(`👉 Review and approve candidates: ${vaultUrl}`);
  } else if (count > 0) {
    lines.push('👉 Review the full report and approve/reject candidates.');
  }
  
  // Run info
  lines.push('');
  lines.push(`_Workspace: ${brief.workspace_id} | Run: ${new Date(brief.run_id).toLocaleString()}_`);
  
  return lines.join('\n');
}

/**
 * Format a brief into a compact notification
 */
export function formatCompactNotification(brief: ConnectionBrief): string {
  const count = brief.candidates.length;
  
  if (count === 0) {
    return `📋 Connection Brief: No new candidates found`;
  }
  
  const names = brief.candidates
    .slice(0, 3)
    .map(c => c.name)
    .join(', ');
  
  const more = count > 3 ? ` +${count - 3} more` : '';
  
  return `📋 Connection Brief: ${count} candidate${count > 1 ? 's' : ''} ready - ${names}${more}`;
}
