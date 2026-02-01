import * as nodemailer from 'nodemailer';
import { Config } from '../config';
import { ConnectionBrief } from '../run';
import { logger } from '../logger';

/**
 * Deliver a connection brief via email
 */
export async function deliverEmail(brief: ConnectionBrief, config: Config): Promise<void> {
  const emailConfig = config.delivery.email;
  
  if (!emailConfig) {
    throw new Error('Email configuration not found');
  }
  
  if (!emailConfig.smtp_host || !emailConfig.from || !emailConfig.to?.length) {
    throw new Error('Email delivery requires smtp_host, from, and to fields');
  }
  
  logger.debug('Delivering via email', { 
    to: emailConfig.to,
    from: emailConfig.from,
  });
  
  // Create transporter
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp_host,
    port: emailConfig.smtp_port || 587,
    secure: emailConfig.smtp_port === 465,
    auth: emailConfig.smtp_user ? {
      user: emailConfig.smtp_user,
      pass: emailConfig.smtp_pass,
    } : undefined,
  });
  
  // Build email content
  const subject = buildSubject(brief);
  const html = buildHtmlEmail(brief);
  const text = buildTextEmail(brief);
  
  // Send email
  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to.join(', '),
    subject,
    html,
    text,
  });
  
  logger.debug('Email delivery successful');
}

/**
 * Build email subject line
 */
function buildSubject(brief: ConnectionBrief): string {
  const count = brief.candidates.length;
  
  if (count === 0) {
    return `Connection Brief: No new candidates found`;
  }
  
  return `Connection Brief: ${count} candidate${count > 1 ? 's' : ''} ready for review`;
}

/**
 * Build HTML email content
 */
function buildHtmlEmail(brief: ConnectionBrief): string {
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1f2937; margin-top: 30px; }
    h3 { color: #374151; margin-top: 20px; }
    .candidate { background: #f9fafb; border-radius: 8px; padding: 15px; margin: 15px 0; border-left: 4px solid #2563eb; }
    .candidate h3 { margin-top: 0; }
    .score { display: inline-block; background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
    .score.medium { background: #f59e0b; }
    .score.low { background: #ef4444; }
    .match-reasons { margin: 10px 0; }
    .match-reasons li { margin: 5px 0; }
    .risk-flag { display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin: 2px; }
    .evidence { font-size: 14px; color: #6b7280; }
    .evidence a { color: #2563eb; }
    .action { margin-top: 10px; padding: 10px; background: #ecfdf5; border-radius: 4px; }
    .action.high { background: #dcfce7; }
    .action.medium { background: #fef9c3; }
    .draft { background: #f3f4f6; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 13px; white-space: pre-wrap; margin: 10px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    .cta { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>📋 Connection Brief</h1>
`;

  // Summary
  if (brief.summary) {
    html += `<p><strong>${brief.summary.headline}</strong></p>`;
    
    if (brief.summary.key_insights.length > 0) {
      html += `<h2>Key Insights</h2><ul>`;
      brief.summary.key_insights.forEach(insight => {
        html += `<li>${insight}</li>`;
      });
      html += `</ul>`;
    }
  }

  // Candidates
  html += `<h2>Top Candidates</h2>`;
  
  if (brief.candidates.length === 0) {
    html += `<p><em>No candidates found matching your criteria this run.</em></p>`;
  } else {
    brief.candidates.forEach((candidate, index) => {
      const scoreClass = candidate.scores?.final_score 
        ? (candidate.scores.final_score >= 70 ? '' : candidate.scores.final_score >= 50 ? 'medium' : 'low')
        : '';
      
      html += `
      <div class="candidate">
        <h3>#${index + 1}: ${candidate.name}</h3>
        ${candidate.role && candidate.company ? `<p><strong>${candidate.role}</strong> at ${candidate.company}</p>` : ''}
        ${candidate.handle ? `<p>${candidate.handle}</p>` : ''}
        ${candidate.scores ? `<span class="score ${scoreClass}">Score: ${candidate.scores.final_score.toFixed(0)}/100</span>` : ''}
        
        <div class="match-reasons">
          <strong>Why This Match:</strong>
          <ul>
            ${candidate.why_match.map(r => `<li>✅ ${r}</li>`).join('')}
          </ul>
        </div>
        
        ${candidate.risk_flags && candidate.risk_flags.length > 0 
          ? `<p>${candidate.risk_flags.map(f => `<span class="risk-flag">⚠️ ${f}</span>`).join(' ')}</p>` 
          : ''}
        
        <p class="evidence">
          <strong>Evidence:</strong> 
          ${candidate.evidence_urls.map((url, i) => `<a href="${url}" target="_blank">Source ${i + 1}</a>`).join(' | ')}
        </p>
        
        ${(() => {
          const action = brief.next_actions.find(a => a.candidate_handle === candidate.handle);
          if (action) {
            const priority = action.priority || 'medium';
            const emoji = priority === 'high' ? '🟢' : priority === 'medium' ? '🟡' : '⚪';
            return `<div class="action ${priority}"><strong>${emoji} ${action.action.toUpperCase()}</strong>: ${action.reason}</div>`;
          }
          return '';
        })()}
        
        <details>
          <summary style="cursor: pointer; color: #2563eb;">View suggested message</summary>
          <div class="draft">${candidate.suggested_intro}</div>
        </details>
      </div>
      `;
    });
  }

  // Footer
  html += `
  <div class="footer">
    <p><strong>⚠️ Human Approval Required</strong><br>
    All outreach drafts are suggestions only. Review and personalize before sending.</p>
    <p>Run: ${new Date(brief.run_id).toLocaleString()} | Workspace: ${brief.workspace_id}</p>
    <p><em>Generated by clawbridge-runner</em></p>
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Build plain text email content
 */
function buildTextEmail(brief: ConnectionBrief): string {
  let text = '';
  
  text += '📋 CONNECTION BRIEF\n';
  text += '===================\n\n';
  
  if (brief.summary) {
    text += `${brief.summary.headline}\n\n`;
    
    if (brief.summary.key_insights.length > 0) {
      text += 'Key Insights:\n';
      brief.summary.key_insights.forEach(insight => {
        text += `• ${insight}\n`;
      });
      text += '\n';
    }
  }
  
  text += 'TOP CANDIDATES\n';
  text += '--------------\n\n';
  
  if (brief.candidates.length === 0) {
    text += 'No candidates found matching your criteria this run.\n\n';
  } else {
    brief.candidates.forEach((candidate, index) => {
      text += `#${index + 1}: ${candidate.name}\n`;
      if (candidate.role && candidate.company) {
        text += `${candidate.role} at ${candidate.company}\n`;
      }
      if (candidate.handle) {
        text += `${candidate.handle}\n`;
      }
      if (candidate.scores) {
        text += `Score: ${candidate.scores.final_score.toFixed(0)}/100\n`;
      }
      text += '\nWhy This Match:\n';
      candidate.why_match.forEach(r => {
        text += `✅ ${r}\n`;
      });
      if (candidate.risk_flags && candidate.risk_flags.length > 0) {
        text += `\nRisk Flags: ${candidate.risk_flags.join(', ')}\n`;
      }
      text += `\nEvidence:\n`;
      candidate.evidence_urls.forEach((url, i) => {
        text += `${i + 1}. ${url}\n`;
      });
      
      const action = brief.next_actions.find(a => a.candidate_handle === candidate.handle);
      if (action) {
        text += `\nRecommended: ${action.action.toUpperCase()} - ${action.reason}\n`;
      }
      
      text += '\n---\n\n';
    });
  }
  
  text += '⚠️ Human Approval Required\n';
  text += 'All outreach drafts are suggestions only.\n\n';
  text += `Run: ${new Date(brief.run_id).toLocaleString()}\n`;
  text += `Workspace: ${brief.workspace_id}\n`;
  
  return text;
}
