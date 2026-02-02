/**
 * Discovery Prompts - Private business logic owned by the runner
 * 
 * These prompts instruct OpenClaw (as a worker) to perform web search/fetch/extraction.
 * The discovery strategy is kept in the runner to protect IP.
 */

import { Config } from '../config';

export interface DiscoveryJob {
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  maxTokens: number;
}

/**
 * Build the system prompt for discovery
 */
function buildSystemPrompt(): string {
  return `You are a connection discovery agent. Your task is to find potential business connection opportunities.

## Your Capabilities
You have access to these tools:
- web_search: Search the web for candidates
- web_fetch: Fetch and extract content from URLs

## Quality Requirements
- Find real people/companies with verifiable evidence
- Each candidate needs at least 2 evidence URLs
- Focus on recent activity (within 30 days)
- Look for intent signals (hiring, seeking partners, building, expanding)

## Anti-Patterns to Avoid
- Generic company listing pages
- News articles without direct profiles
- Social media with no recent activity
- Spam or promotional content

## Output Format
Return results as JSON with this structure:
{
  "candidates": [
    {
      "name": "Full Name",
      "handle": "@handle (if applicable)",
      "role": "Job Title",
      "company": "Company Name",
      "why_match": ["reason 1", "reason 2"],
      "evidence_urls": ["url1", "url2"],
      "last_activity": "2026-01-28",
      "suggested_intro": "Personalized intro message...",
      "scores": {
        "relevance": 85,
        "intent": 90,
        "credibility": 75,
        "recency": 95,
        "engagement": 70,
        "final_score": 82.5
      }
    }
  ],
  "summary": {
    "headline": "Found X candidates for Y",
    "key_insights": ["insight 1", "insight 2"],
    "venues_searched": ["linkedin", "web"]
  },
  "metadata": {
    "searches_performed": 5,
    "pages_fetched": 12,
    "candidates_evaluated": 15
  }
}`;
}

/**
 * Build the user prompt for a specific discovery job
 */
function buildUserPrompt(config: Config): string {
  const profile = config.project_profile;
  const budget = config.run_budget || { max_searches: 20, max_fetches: 50, max_minutes: 10 };
  const constraints = config.constraints || {};

  return `## Project Profile

**What we offer:** ${profile.offer}

**What we're looking for:** ${profile.ask}

**Ideal persona:** ${profile.ideal_persona}

**Target verticals:** ${profile.verticals.join(', ')}

${profile.tone ? `**Tone for messages:** ${profile.tone}` : ''}

${profile.disallowed?.length ? `**Do not contact:** ${profile.disallowed.join(', ')}` : ''}

## Search Budget
- Maximum searches: ${budget.max_searches}
- Maximum page fetches: ${budget.max_fetches}
- Time limit: ${budget.max_minutes} minutes

## Constraints
${constraints.regions?.length ? `- Target regions: ${constraints.regions.join(', ')}` : ''}
${constraints.avoid_list?.length ? `- Avoid: ${constraints.avoid_list.join(', ')}` : ''}
${constraints.no_spam_rules?.length ? `- Rules: ${constraints.no_spam_rules.join('; ')}` : ''}

## Your Task

1. Search for people/companies that match our "ask" and "ideal persona"
2. For each potential match, fetch their profile to verify
3. Score candidates on relevance, intent, credibility, recency, engagement
4. Return the top ${constraints.top_k || 5} candidates with:
   - Full evidence (at least 2 URLs each)
   - Clear reasons why they match
   - Personalized intro message drafts
   - Risk flags if applicable

Focus on warm introduction opportunities, not cold leads. Look for intent signals like "looking for partners", "hiring", "building", "expanding".

Return ONLY the JSON output, no additional text.`;
}

/**
 * Build a complete discovery job for OpenClaw
 */
export function buildDiscoveryJob(config: Config): DiscoveryJob {
  return {
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt(config),
    tools: ['web_search', 'web_fetch'],
    maxTokens: 4000,
  };
}

/**
 * Scoring weights for ranking candidates
 */
export const SCORING_WEIGHTS = {
  relevance: 0.30,
  intent: 0.25,
  credibility: 0.20,
  recency: 0.15,
  engagement: 0.10,
};

/**
 * Risk flag score penalties
 */
export const RISK_PENALTIES = {
  low_evidence: -5,
  spammy_language: -15,
  unclear_identity: -10,
  too_salesy: -10,
  irrelevant: -20,
};
