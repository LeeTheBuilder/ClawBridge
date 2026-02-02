import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { logger } from './logger';

/**
 * Get the default clawbridge config directory
 * Uses ~/.clawbridge/ on all platforms
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.clawbridge');
}

/**
 * Get the default config file path
 */
export function getDefaultConfigPath(): string {
  return path.join(getConfigDir(), 'config.yml');
}

/**
 * Get the default .env file path
 */
export function getDefaultEnvPath(): string {
  return path.join(getConfigDir(), '.env');
}

/**
 * Ensure the config directory exists
 */
export function ensureConfigDir(): string {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface ProjectProfile {
  offer: string;
  ask: string;
  ideal_persona: string;
  verticals: string[];
  geo_timezone?: string;
  disallowed?: string[];
  tone?: string;
}

export interface RunBudget {
  max_searches: number;
  max_fetches: number;
  max_minutes: number;
}

export interface Constraints {
  no_spam_rules?: string[];
  regions?: string[];
  avoid_list?: string[];
}

export interface DeliveryConfig {
  target: 'discord' | 'slack' | 'email' | 'none';
  discord?: {
    webhook_url?: string;
    bot_token?: string;
    channel_id?: string;
  };
  slack?: {
    webhook_url?: string;
    bot_token?: string;
    channel?: string;
  };
  email?: {
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass: string;
    from: string;
    to: string[];
  };
}

export interface VaultConfig {
  enabled: boolean;
  api_url?: string;
  workspace_token?: string;  // deprecated, use workspace_key
  workspace_key?: string;
}

export interface Config {
  workspace_id: string;
  workspace_token?: string;  // deprecated, use workspace_key
  workspace_key?: string;
  project_profile: ProjectProfile;
  constraints?: Constraints;
  run_budget?: RunBudget;
  delivery: DeliveryConfig;
  vault?: VaultConfig;
  skill?: {
    path?: string;
    url?: string;
  };
  output?: {
    dir: string;
    keep_runs: number;
  };
}

const DEFAULT_RUN_BUDGET: RunBudget = {
  max_searches: 20,
  max_fetches: 50,
  max_minutes: 10,
};

const DEFAULT_OUTPUT = {
  dir: './output',
  keep_runs: 30,
};

export async function loadConfig(configPath: string): Promise<Config> {
  const absolutePath = path.resolve(configPath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }
  
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const rawConfig = yaml.load(content) as Partial<Config>;
  
  // Validate required fields
  if (!rawConfig.workspace_id) {
    throw new Error('Config missing required field: workspace_id');
  }
  
  if (!rawConfig.project_profile) {
    throw new Error('Config missing required field: project_profile');
  }
  
  if (!rawConfig.project_profile.offer) {
    throw new Error('Config missing required field: project_profile.offer');
  }
  
  if (!rawConfig.project_profile.ask) {
    throw new Error('Config missing required field: project_profile.ask');
  }
  
  if (!rawConfig.project_profile.ideal_persona) {
    throw new Error('Config missing required field: project_profile.ideal_persona');
  }
  
  if (!rawConfig.project_profile.verticals || rawConfig.project_profile.verticals.length === 0) {
    throw new Error('Config missing required field: project_profile.verticals');
  }
  
  // Delivery is optional - default to 'none' if not specified
  if (!rawConfig.delivery) {
    rawConfig.delivery = { target: 'none' };
  }
  
  if (!rawConfig.delivery.target) {
    rawConfig.delivery.target = 'none';
  }
  
  // Apply defaults
  const config: Config = {
    ...rawConfig,
    workspace_id: rawConfig.workspace_id,
    project_profile: rawConfig.project_profile,
    delivery: rawConfig.delivery,
    run_budget: { ...DEFAULT_RUN_BUDGET, ...rawConfig.run_budget },
    output: { ...DEFAULT_OUTPUT, ...rawConfig.output },
  };
  
  // Load secrets from environment variables
  config.workspace_token = process.env.CLAWBRIDGE_WORKSPACE_TOKEN || rawConfig.workspace_token;
  
  if (config.delivery.discord) {
    config.delivery.discord.webhook_url = 
      process.env.DISCORD_WEBHOOK_URL || config.delivery.discord.webhook_url;
    config.delivery.discord.bot_token = 
      process.env.DISCORD_BOT_TOKEN || config.delivery.discord.bot_token;
  }
  
  if (config.delivery.slack) {
    config.delivery.slack.webhook_url = 
      process.env.SLACK_WEBHOOK_URL || config.delivery.slack.webhook_url;
    config.delivery.slack.bot_token = 
      process.env.SLACK_BOT_TOKEN || config.delivery.slack.bot_token;
  }
  
  if (config.delivery.email) {
    config.delivery.email.smtp_pass = 
      process.env.SMTP_PASSWORD || config.delivery.email.smtp_pass;
  }
  
  // Load workspace key from environment
  config.workspace_key = process.env.CLAWBRIDGE_WORKSPACE_KEY || config.workspace_key || config.workspace_token;
  
  if (config.vault) {
    config.vault.workspace_key = 
      process.env.CLAWBRIDGE_WORKSPACE_KEY || config.vault.workspace_key || config.vault.workspace_token;
  }
  
  logger.debug('Configuration loaded', { workspace_id: config.workspace_id });
  
  return config;
}

export function generateExampleConfig(): string {
  const example: Config = {
    workspace_id: 'your_workspace_id',
    project_profile: {
      offer: 'We help B2B SaaS companies automate their content operations',
      ask: 'Marketing partners, agency relationships, content-focused companies',
      ideal_persona: 'VP Marketing or Head of Content at Series A-C startups',
      verticals: [
        'B2B SaaS',
        'content marketing',
        'marketing automation',
      ],
      geo_timezone: 'US/Pacific',
      disallowed: [
        'competitor@example.com',
      ],
      tone: 'friendly, professional',
    },
    constraints: {
      no_spam_rules: [
        'No cold outreach to competitors',
        'Respect unsubscribe requests',
      ],
      regions: ['US', 'EU'],
      avoid_list: [
        '@spam_account',
      ],
    },
    run_budget: {
      max_searches: 20,
      max_fetches: 50,
      max_minutes: 10,
    },
    delivery: {
      target: 'discord',
      discord: {
        channel_id: 'YOUR_CHANNEL_ID',
      },
    },
    vault: {
      enabled: false,
      api_url: 'https://clawbridge.cloud/api',
    },
    output: {
      dir: './output',
      keep_runs: 30,
    },
  };
  
  return yaml.dump(example, { lineWidth: 100, quotingType: '"' });
}
