/**
 * Discovery Prompts - Private business logic owned by the runner
 * 
 * These prompts instruct OpenClaw (as a worker) to perform web search/fetch/extraction.
 * The discovery strategy is kept in the runner to protect IP.
 * 
 * V3.1: Added smoke mode for pipeline verification
 */

import { Config } from '../config';

export type DiscoveryMode = 'smoke' | 'real';

export interface DiscoveryJob {
  systemPrompt: string;
  userPrompt: string;
  mode: DiscoveryMode;
}

/**
 * Build the system prompt for SMOKE mode - minimal test
 * V3.1: Smoke mode just verifies the pipeline works
 */
function buildSmokeSystemPrompt(): string {
  return `You are a test agent. Your task is to verify the pipeline is working.

Do NOT perform any web_search or web_fetch.
Simply return a minimal valid JSON response to confirm the pipeline works.

Return ONLY this JSON (no markdown, no code fences):
{
  "candidates": [
    {
      "name": "Test Candidate",
      "handle": "@test",
      "role": "Test Role",
      "company": "Test Company",
      "why_match": ["Pipeline test"],
      "evidence_urls": ["https://example.com"],
      "last_activity": "2026-02-02",
      "suggested_intro": "This is a smoke test.",
      "scores": { "relevance": 100, "intent": 100, "credibility": 100, "recency": 100, "engagement": 100, "final_score": 100 }
    }
  ],
  "summary": { "headline": "Smoke test passed", "key_insights": ["Pipeline verified"], "venues_searched": [] },
  "metadata": { "searches_performed": 0, "pages_fetched": 0, "candidates_evaluated": 1, "completed": true }
}`;
}

/**
 * Build the system prompt for REAL discovery
 * V3.1.1: Use web_search primarily, web_fetch as optional enhancement
 */
function buildSystemPrompt(): string {
  return `You are a connection discovery agent. Your task is to find potential business connection opportunities.

## Your Capabilities
You have access to these tools (use what's available):
- web_search: Search the web for candidates (PRIMARY - always use this)
- web_fetch: Fetch and extract content from URLs (OPTIONAL - use if available)

## CRITICAL CONSTRAINTS
- Use web_search as your primary tool. It returns rich snippets that often have enough information.
- Only use web_fetch if it's available AND you need more details from a specific page.
- Do NOT use browser automation.
- Avoid login-walled sources (LinkedIn, Facebook, etc.) - prefer public profiles.
- If a tool is not available, work with what you have. Do NOT report "missing tool" errors.

## Quality Requirements
- Find real people/companies with verifiable evidence
- Each candidate needs sufficient evidence URLs (from search results is fine)
- Focus on recent activity
- Look for intent signals (hiring, seeking partners, building, expanding)

## Anti-Patterns to Avoid
- Generic company listing pages
- News articles without direct profiles
- Social media with no recent activity
- Spam or promotional content
- Login-required pages

## Time Management (CRITICAL)
- You have a strict time budget. Track your progress.
- If you're running low on time, STOP searching and return what you have.
- It's better to return 2 good candidates than timeout with nothing.
- Always return valid JSON, even if you only found 1 candidate.
- If time is almost up, skip drafting intros and just return the core data.

## Output Format
Return ONLY valid JSON (no markdown, no code fences, no commentary):
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
    "venues_searched": ["web"]
  },
  "metadata": {
    "searches_performed": 5,
    "pages_fetched": 12,
    "candidates_evaluated": 15,
    "completed": true
  }
}

If you run out of time, set "completed": false in metadata and return whatever you have.`;
}

/**
 * Build the user prompt for SMOKE mode
 */
function buildSmokeUserPrompt(): string {
  return `This is a SMOKE TEST. Do NOT search the web.
Just return the minimal valid JSON as specified in the system prompt.
This verifies the pipeline is working correctly.`;
}

/**
 * Build the user prompt for REAL discovery
 * V3.1: Added debug budget constraints and web_only reminders
 */
function buildUserPrompt(config: Config, debugMode: boolean = false): string {
  const profile = config.project_profile;
  const constraints = config.constraints || {};
  const topK = constraints.top_k || 5;
  
  // V3.1: Debug mode uses minimal budget for quick verification
  const budget = debugMode 
    ? { max_searches: 1, max_fetches: 2 }
    : (config.run_budget || { max_searches: 20, max_fetches: 50, max_minutes: 10 });

  return `## Project Profile

**What we offer:** ${profile.offer}

**What we're looking for:** ${profile.ask}

**Ideal persona:** ${profile.ideal_persona}

**Target verticals:** ${profile.verticals.join(', ')}

${profile.tone ? `**Tone for messages:** ${profile.tone}` : ''}

${profile.disallowed?.length ? `**Do not contact:** ${profile.disallowed.join(', ')}` : ''}

## Budget Limits
- Maximum searches: ${budget.max_searches}
- Maximum page fetches: ${budget.max_fetches}
- Target candidates: ${debugMode ? 1 : topK}
${debugMode ? '- **DEBUG MODE**: Stop early if you can output valid JSON.' : ''}

## Quality Constraints
- Minimum evidence URLs per candidate: ${constraints.min_evidence || 2}
- Activity recency: within ${constraints.recency_days || 30} days
${constraints.regions?.length ? `- Target regions: ${constraints.regions.join(', ')}` : ''}
${constraints.avoid_list?.length ? `- Avoid: ${constraints.avoid_list.join(', ')}` : ''}
${constraints.no_spam_rules?.length ? `- Rules: ${constraints.no_spam_rules.join('; ')}` : ''}

## Tools Policy (MUST FOLLOW)
- Use web_search as your PRIMARY tool.
- Use web_fetch if available and you need more page detail.
- Do NOT use browser automation.
- Avoid login-walled sources (LinkedIn, Facebook, etc.).
- If a tool is not available, continue with available tools.

## Your Task

1. Search for people/companies that match our "ask" and "ideal persona"
2. For each potential match, fetch their profile to verify
3. Score candidates on relevance, intent, credibility, recency, engagement
4. Return the top ${debugMode ? 1 : topK} candidates with:
   - Full evidence (at least 2 URLs each)
   - Clear reasons why they match
   - Personalized intro message drafts
   - Risk flags if applicable

**IMPORTANT**: Work efficiently. Return partial results if needed. Partial results are better than no results.

Focus on warm introduction opportunities, not cold leads. Look for intent signals like "looking for partners", "hiring", "building", "expanding".

Return ONLY valid JSON. No markdown. No code fences. No commentary.`;
}

/**
 * Build a complete discovery job for OpenClaw
 * V3.1: Added mode parameter for smoke vs real
 */
export function buildDiscoveryJob(config: Config, mode: DiscoveryMode = 'smoke'): DiscoveryJob {
  if (mode === 'smoke') {
    return {
      systemPrompt: buildSmokeSystemPrompt(),
      userPrompt: buildSmokeUserPrompt(),
      mode: 'smoke',
    };
  }
  
  return {
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt(config, false), // false = not debug mode for now
    mode: 'real',
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
