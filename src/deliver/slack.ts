import axios from 'axios';
import { WebClient } from '@slack/web-api';
import { Config } from '../config';
import { ConnectionBrief } from '../run';
import { formatSummaryMessage } from './index';
import { logger } from '../logger';

/**
 * Deliver a connection brief to Slack
 */
export async function deliverSlack(brief: ConnectionBrief, config: Config): Promise<void> {
  const slackConfig = config.delivery.slack;
  
  if (!slackConfig) {
    throw new Error('Slack configuration not found');
  }
  
  // Prefer webhook for simplicity, fall back to bot
  if (slackConfig.webhook_url) {
    await deliverViaWebhook(brief, slackConfig.webhook_url);
  } else if (slackConfig.bot_token && slackConfig.channel) {
    await deliverViaBot(brief, slackConfig.bot_token, slackConfig.channel);
  } else {
    throw new Error('Slack delivery requires either webhook_url or (bot_token + channel)');
  }
}

/**
 * Deliver via Slack webhook
 */
async function deliverViaWebhook(brief: ConnectionBrief, webhookUrl: string): Promise<void> {
  logger.debug('Delivering via Slack webhook');
  
  const blocks = buildSlackBlocks(brief);
  
  await axios.post(webhookUrl, {
    text: `Connection Brief: ${brief.candidates.length} candidates ready`,
    blocks,
  });
  
  logger.debug('Slack webhook delivery successful');
}

/**
 * Deliver via Slack bot
 */
async function deliverViaBot(
  brief: ConnectionBrief, 
  botToken: string, 
  channel: string
): Promise<void> {
  logger.debug('Delivering via Slack bot');
  
  const client = new WebClient(botToken);
  
  const blocks = buildSlackBlocks(brief);
  
  await client.chat.postMessage({
    channel,
    text: `Connection Brief: ${brief.candidates.length} candidates ready`,
    blocks,
  });
  
  logger.debug('Slack bot delivery successful');
}

/**
 * Build Slack blocks for the message
 */
function buildSlackBlocks(brief: ConnectionBrief): any[] {
  const blocks: any[] = [];
  
  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📋 Connection Brief Ready',
      emoji: true,
    },
  });
  
  // Summary section
  if (brief.summary) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${brief.summary.headline}*`,
      },
    });
  }
  
  // Divider
  blocks.push({ type: 'divider' });
  
  // Candidates
  if (brief.candidates.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No candidates found matching your criteria this run._',
      },
    });
  } else {
    brief.candidates.forEach((candidate, index) => {
      // Candidate header
      const scoreText = candidate.scores 
        ? ` • Score: ${candidate.scores.final_score.toFixed(0)}/100` 
        : '';
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*#${index + 1}: ${candidate.name}*${scoreText}\n` +
                `${candidate.role || ''} ${candidate.company ? `@ ${candidate.company}` : ''}\n` +
                `${candidate.handle || ''}`,
        },
      });
      
      // Why match
      const reasons = candidate.why_match
        .slice(0, 3)
        .map(r => `• ${r}`)
        .join('\n');
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Why This Match:*\n${reasons}`,
        },
      });
      
      // Risk flags
      if (candidate.risk_flags && candidate.risk_flags.length > 0) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⚠️ Risk flags: ${candidate.risk_flags.join(', ')}`,
            },
          ],
        });
      }
      
      // Evidence links
      const evidenceLinks = candidate.evidence_urls
        .slice(0, 3)
        .map((url, i) => `<${url}|Source ${i + 1}>`)
        .join(' | ');
      
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📎 Evidence: ${evidenceLinks}`,
          },
        ],
      });
      
      // Action
      const action = brief.next_actions.find(
        a => a.candidate_handle === candidate.handle
      );
      if (action) {
        const priority = action.priority === 'high' ? '🟢' : 
                         action.priority === 'medium' ? '🟡' : '⚪';
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${priority} *${action.action.toUpperCase()}*: ${action.reason}`,
            },
          ],
        });
      }
      
      // Divider between candidates
      if (index < brief.candidates.length - 1) {
        blocks.push({ type: 'divider' });
      }
    });
  }
  
  // Footer divider
  blocks.push({ type: 'divider' });
  
  // Key insights
  if (brief.summary?.key_insights && brief.summary.key_insights.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Key Insights:*\n' + 
              brief.summary.key_insights.map(i => `• ${i}`).join('\n'),
      },
    });
  }
  
  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Run: ${new Date(brief.run_id).toLocaleString()} | ` +
              `Workspace: ${brief.workspace_id}`,
      },
    ],
  });
  
  // Action buttons (if using interactive messages)
  if (brief.candidates.length > 0) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📄 View Full Report',
            emoji: true,
          },
          action_id: 'view_report',
          value: brief.run_id,
        },
      ],
    });
  }
  
  return blocks;
}
