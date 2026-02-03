import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as yaml from 'js-yaml';
import axios from 'axios';
import { getConfigDir } from './config';

interface LinkResponse {
  ok: boolean;
  vaultBaseUrl?: string;
  workspaceId?: string;
  workspaceName?: string;
  error?: string;
}

interface WorkspaceConfigResponse {
  ok: boolean;
  error?: string;
  workspace?: {
    id: string;
    name: string;
    profile: {
      offer: string;
      ask: string;
      ideal_persona: string;
      verticals: string[];
      tone?: string;
      geo_timezone?: string;
      disallowed?: string[];
    };
    settings: {
      maxRunsPerDay: number;
      maxCandidates: number;
    };
  };
}

interface LinkOptions {
  dir: string;
  apiUrl: string;
}

/**
 * Simple prompt for user input
 */
function simplePrompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Fetch workspace config (profile & settings) from the API.
 * GET {apiUrl}/api/workspace/config
 * Headers: X-Workspace-Id, X-Workspace-Key
 * Response: { ok, workspace?: { id, name, profile, settings } }
 */
async function fetchWorkspaceConfig(
  apiUrl: string,
  workspaceId: string,
  apiKey: string
): Promise<WorkspaceConfigResponse> {
  try {
    const response = await axios.get(`${apiUrl}/api/workspace/config`, {
      headers: {
        'X-Workspace-Id': workspaceId,
        'X-Workspace-Key': apiKey,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error: any) {
    if (error.response?.data?.error) {
      return { ok: false, error: error.response.data.error };
    }
    return { ok: false, error: error.message || 'Failed to fetch workspace config' };
  }
}

/**
 * Link workspace using a connect code
 */
export async function linkWorkspace(code: string, options: LinkOptions): Promise<void> {
  console.log('\n🔗 Clawbridge Link\n');
  
  // Validate code format
  const normalizedCode = code.toUpperCase().trim();
  if (!/^CB-[A-Z0-9]{6}$/.test(normalizedCode)) {
    console.error('❌ Invalid connect code format. Expected: CB-XXXXXX');
    process.exit(1);
  }

  console.log(`Connecting with code: ${normalizedCode}\n`);

  // Resolve the connect code
  let linkData: LinkResponse;
  try {
    const response = await axios.post(
      `${options.apiUrl}/api/connect/resolve`,
      { code: normalizedCode },
      { timeout: 10000 }
    );
    linkData = response.data;
  } catch (error: any) {
    if (error.response?.data?.error) {
      console.error(`❌ ${error.response.data.error}`);
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to ${options.apiUrl}`);
      console.error('   Make sure you have internet connectivity.');
    } else {
      console.error('❌ Failed to resolve connect code:', error.message);
    }
    process.exit(1);
  }

  if (!linkData.ok) {
    console.error(`❌ ${linkData.error || 'Unknown error'}`);
    process.exit(1);
  }

  console.log(`✅ Connected to workspace: ${linkData.workspaceName || linkData.workspaceId}`);
  console.log(`   Vault URL: ${linkData.vaultBaseUrl}\n`);

  // Prompt for API key
  console.log('Enter your workspace API key (shown once when you created the workspace):');
  const apiKey = await simplePrompt('API Key: ');

  if (!apiKey) {
    console.error('❌ API key is required');
    process.exit(1);
  }

  if (!apiKey.startsWith('cbk_')) {
    console.log('\n⚠️  Warning: API key should start with "cbk_". Proceeding anyway...\n');
  }

  // Fetch workspace config (profile & settings) from the API
  console.log('Fetching workspace settings...');
  const configResponse = await fetchWorkspaceConfig(
    options.apiUrl,
    linkData.workspaceId!,
    apiKey
  );

  let workspaceProfile: WorkspaceConfigResponse['workspace'] | undefined;
  if (configResponse.ok && configResponse.workspace) {
    workspaceProfile = configResponse.workspace;
    console.log('✅ Workspace settings retrieved successfully\n');
  } else {
    console.log(`⚠️  Could not fetch workspace settings: ${configResponse.error}`);
    console.log('   Using default template values. You can edit config.yml later.\n');
  }

  // Create the config directory
  const absolutePath = path.resolve(options.dir);
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }

  // Create config.yml
  const configPath = path.join(absolutePath, 'config.yml');
  const existingConfig = fs.existsSync(configPath);
  
  // Determine output directory - use subdirectory of config dir
  const isDefaultConfigDir = absolutePath === getConfigDir();
  const outputDir = isDefaultConfigDir ? path.join(absolutePath, 'output') : './output';

  // Use fetched profile or fall back to template values
  const profile = workspaceProfile?.profile;
  const hasProfile = profile && (profile.offer || profile.ask || profile.ideal_persona || (profile.verticals && profile.verticals.length > 0));
  
  const projectProfile = hasProfile
    ? {
        offer: profile.offer || '',
        ask: profile.ask || '',
        ideal_persona: profile.ideal_persona || '',
        verticals: profile.verticals?.length ? profile.verticals : [],
        tone: profile.tone || 'friendly, professional',
        ...(profile.geo_timezone != null && { geo_timezone: profile.geo_timezone }),
        ...(profile.disallowed?.length && { disallowed: profile.disallowed }),
      }
    : {
        // Template values when no profile is configured on the website
        offer: 'Describe what you offer (e.g., We help B2B SaaS companies automate their content operations)',
        ask: 'What are you looking for (e.g., Marketing partners, agency relationships)',
        ideal_persona: 'Your ideal contact (e.g., VP Marketing at Series A-C startups)',
        verticals: ['Your', 'industry', 'keywords'],
        tone: 'friendly, professional',
      };

  // Use workspace settings for constraints
  const maxCandidates = workspaceProfile?.settings?.maxCandidates || 5;
  const avoidList = workspaceProfile?.profile?.disallowed ?? [];

  const config: any = {
    workspace_id: linkData.workspaceId,
    
    // Your project profile
    project_profile: projectProfile,
    
    // Search budget limits
    run_budget: {
      max_searches: 20,    // Maximum web searches per run
      max_fetches: 50,     // Maximum pages to fetch per run
      max_minutes: 1,     // Hard time limit (will return partial results)
    },
    
    // Quality constraints
    constraints: {
      top_k: maxCandidates,  // Return top N candidates (from workspace settings)
      recency_days: 30,      // Only candidates active within N days
      min_evidence: 2,       // Minimum evidence URLs per candidate
      regions: [],           // Optional: ['US', 'EU'] to filter by region
      avoid_list: avoidList, // From workspace profile.disallowed
    },
    
    delivery: {
      target: 'none',  // Vault is the only output channel
    },
    vault: {
      enabled: true,
      api_url: linkData.vaultBaseUrl,
    },
    output: {
      dir: outputDir,
      keep_runs: 30,
    },
  };

  // Write config
  const configContent = yaml.dump(config, { lineWidth: 100, quotingType: '"' });
  if (existingConfig) {
    const backup = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backup);
    console.log(`\n📦 Backed up existing config to: ${path.basename(backup)}`);
  }
  fs.writeFileSync(configPath, configContent);

  // Create .env file with API key
  const envPath = path.join(absolutePath, '.env');
  const existingEnv = fs.existsSync(envPath);
  
  const envContent = `# Clawbridge Configuration
# Generated by clawbridge link

# Workspace API Key (from clawbridge.cloud)
CLAWBRIDGE_WORKSPACE_KEY=${apiKey}

# Logging
LOG_LEVEL=info
`;

  if (existingEnv) {
    const backup = `${envPath}.backup.${Date.now()}`;
    fs.copyFileSync(envPath, backup);
    console.log(`📦 Backed up existing .env to: ${path.basename(backup)}`);
  }
  fs.writeFileSync(envPath, envContent);


  // Create output directory
  const outputPath = path.join(absolutePath, 'output');
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
    fs.writeFileSync(path.join(outputPath, '.gitkeep'), '');
  }

  // Print success and next steps
  console.log('\n' + '─'.repeat(60));
  console.log('\n✅ Workspace linked successfully!\n');
  console.log('📁 Files created at ~/ root folder:');
  console.log(`   • config.yml - Runner configuration`);
  console.log(`   • .env - API key`);
  console.log(`   • output/ - Run results directory`);
  
  console.log('\n📝 Next steps:\n');
  console.log('');
  console.log('1. Test your setup:');
  console.log('   clawbridge doctor');
  console.log('');
  console.log('2. Run Clawbridge:');
  console.log('   clawbridge run');
  console.log('');
  console.log('─'.repeat(60));
  console.log(`\n🌉 View your runs at: ${linkData.vaultBaseUrl}/app/workspaces/${linkData.workspaceId}\n`);
}
