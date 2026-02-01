import axios from 'axios';
import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { Config } from '../config';
import { ConnectionBrief, Candidate } from '../run';
import { formatSummaryMessage } from './index';
import { logger } from '../logger';

/**
 * Deliver a connection brief to Discord
 */
export async function deliverDiscord(brief: ConnectionBrief, config: Config): Promise<void> {
  const discordConfig = config.delivery.discord;
  
  if (!discordConfig) {
    throw new Error('Discord configuration not found');
  }
  
  // Prefer webhook for simplicity, fall back to bot
  if (discordConfig.webhook_url) {
    await deliverViaWebhook(brief, discordConfig.webhook_url);
  } else if (discordConfig.bot_token && discordConfig.channel_id) {
    await deliverViaBot(brief, discordConfig.bot_token, discordConfig.channel_id);
  } else {
    throw new Error('Discord delivery requires either webhook_url or (bot_token + channel_id)');
  }
}

/**
 * Deliver via Discord webhook
 */
async function deliverViaWebhook(brief: ConnectionBrief, webhookUrl: string): Promise<void> {
  logger.debug('Delivering via Discord webhook');
  
  // Build embeds for candidates
  const embeds = buildCandidateEmbeds(brief);
  
  // Main message
  const content = formatSummaryMessage(brief);
  
  // Send to webhook
  await axios.post(webhookUrl, {
    content,
    embeds: embeds.slice(0, 10), // Discord limit of 10 embeds
    username: 'Clawbridge',
  });
  
  logger.debug('Discord webhook delivery successful');
}

/**
 * Deliver via Discord bot
 */
async function deliverViaBot(
  brief: ConnectionBrief, 
  botToken: string, 
  channelId: string
): Promise<void> {
  logger.debug('Delivering via Discord bot');
  
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  
  try {
    await client.login(botToken);
    
    const channel = await client.channels.fetch(channelId);
    
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error(`Channel ${channelId} not found or is not a text channel`);
    }
    
    // Build embeds
    const embeds = buildCandidateEmbeds(brief);
    
    // Send main message
    const content = formatSummaryMessage(brief);
    await channel.send({ content });
    
    // Send embeds in batches of 10
    for (let i = 0; i < embeds.length; i += 10) {
      const batch = embeds.slice(i, i + 10);
      await channel.send({ embeds: batch });
    }
    
    logger.debug('Discord bot delivery successful');
    
  } finally {
    await client.destroy();
  }
}

/**
 * Build Discord embeds for candidates
 */
function buildCandidateEmbeds(brief: ConnectionBrief): EmbedBuilder[] {
  return brief.candidates.map((candidate, index) => {
    const embed = new EmbedBuilder()
      .setTitle(`#${index + 1}: ${candidate.name}`)
      .setColor(getScoreColor(candidate.scores?.final_score));
    
    // Description with role/company
    if (candidate.role && candidate.company) {
      embed.setDescription(`**${candidate.role}** at ${candidate.company}`);
    }
    
    // Score field
    if (candidate.scores) {
      embed.addFields({
        name: '📊 Score',
        value: `${candidate.scores.final_score.toFixed(1)} / 100`,
        inline: true,
      });
    }
    
    // Handle field
    if (candidate.handle) {
      embed.addFields({
        name: '🔗 Handle',
        value: candidate.handle,
        inline: true,
      });
    }
    
    // Why match
    embed.addFields({
      name: '✅ Why This Match',
      value: candidate.why_match.slice(0, 3).map(r => `• ${r}`).join('\n'),
      inline: false,
    });
    
    // Risk flags
    if (candidate.risk_flags && candidate.risk_flags.length > 0) {
      embed.addFields({
        name: '⚠️ Risk Flags',
        value: candidate.risk_flags.join(', '),
        inline: false,
      });
    }
    
    // Evidence
    const evidenceLinks = candidate.evidence_urls
      .slice(0, 3)
      .map((url, i) => `[Source ${i + 1}](${url})`)
      .join(' | ');
    embed.addFields({
      name: '📎 Evidence',
      value: evidenceLinks || 'None',
      inline: false,
    });
    
    // Find action
    const action = brief.next_actions.find(
      a => a.candidate_handle === candidate.handle
    );
    if (action) {
      const priority = action.priority === 'high' ? '🟢' : 
                       action.priority === 'medium' ? '🟡' : '⚪';
      embed.addFields({
        name: '👉 Recommended Action',
        value: `${priority} ${action.action.toUpperCase()}: ${action.reason}`,
        inline: false,
      });
    }
    
    // Footer with last activity
    if (candidate.last_activity) {
      embed.setFooter({ text: `Last activity: ${candidate.last_activity}` });
    }
    
    return embed;
  });
}

/**
 * Get color based on score
 */
function getScoreColor(score?: number): number {
  if (!score) return 0x808080; // Gray
  if (score >= 80) return 0x00FF00; // Green
  if (score >= 60) return 0xFFFF00; // Yellow
  if (score >= 40) return 0xFFA500; // Orange
  return 0xFF0000; // Red
}
