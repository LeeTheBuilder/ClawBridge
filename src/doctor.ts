import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { loadConfig, Config } from './config';
import { logger } from './logger';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
}

/**
 * Run diagnostic checks on the clawbridge setup
 */
export async function runDoctor(configPath: string): Promise<void> {
  console.log('\n🩺 Clawbridge Doctor\n');
  console.log('Running diagnostic checks...\n');

  const results: CheckResult[] = [];

  // Check 1: Config file exists
  results.push(await checkConfigFile(configPath));

  // Load config if possible for further checks
  let config: Config | null = null;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    // Config loading failed, already reported above
  }

  // Check 2: Schema file exists
  results.push(checkSchemaFile());

  // Check 3: Workspace ID format
  if (config) {
    results.push(checkWorkspaceId(config));
  }

  // Check 4: API key configured
  if (config) {
    results.push(checkApiKey(config));
  }

  // Check 5: Vault URL reachable
  if (config?.vault?.enabled && config.vault.api_url) {
    results.push(await checkVaultUrl(config.vault.api_url));
  }

  // Check 6: Output directory writable
  if (config?.output?.dir) {
    results.push(checkOutputDir(config.output.dir));
  }

  // Check 7: OpenClaw CLI available
  results.push(await checkOpenClawCLI());

  // Check 8: OpenClaw web tools configured
  results.push(await checkOpenClawTools());

  // Print results
  console.log('─'.repeat(60));
  console.log('\nResults:\n');

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : 
                 result.status === 'fail' ? '❌' : '⚠️';
    
    console.log(`${icon} ${result.name}`);
    console.log(`   ${result.message}`);
    
    if (result.fix) {
      console.log(`   💡 Fix: ${result.fix}`);
    }
    console.log('');

    if (result.status === 'pass') passCount++;
    else if (result.status === 'fail') failCount++;
    else warnCount++;
  }

  console.log('─'.repeat(60));
  console.log(`\n📊 Summary: ${passCount} passed, ${failCount} failed, ${warnCount} warnings\n`);

  if (failCount > 0) {
    console.log('❌ Some checks failed. Please fix the issues above before running.\n');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('⚠️ Some warnings found. Clawbridge should work but may have issues.\n');
  } else {
    console.log('✅ All checks passed! Clawbridge is ready to run.\n');
  }
}

async function checkConfigFile(configPath: string): Promise<CheckResult> {
  const absolutePath = path.resolve(configPath);
  
  if (fs.existsSync(absolutePath)) {
    try {
      await loadConfig(configPath);
      return {
        name: 'Configuration File',
        status: 'pass',
        message: `Found and valid: ${absolutePath}`,
      };
    } catch (error: any) {
      return {
        name: 'Configuration File',
        status: 'fail',
        message: `Invalid: ${error.message}`,
        fix: 'Run "clawbridge init" to create a valid config file',
      };
    }
  }
  
  return {
    name: 'Configuration File',
    status: 'fail',
    message: `Not found: ${absolutePath}`,
    fix: 'Run "clawbridge init" to create a config file',
  };
}

function checkSchemaFile(): CheckResult {
  const schemaPath = path.resolve(__dirname, '../schema/connection_brief.json');
  
  if (fs.existsSync(schemaPath)) {
    return {
      name: 'Schema File',
      status: 'pass',
      message: `Found: ${schemaPath}`,
    };
  }
  
  return {
    name: 'Schema File',
    status: 'fail',
    message: 'Schema file not found',
    fix: 'Run "clawbridge install-skill" to install the schema',
  };
}

function checkWorkspaceId(config: Config): CheckResult {
  if (!config.workspace_id) {
    return {
      name: 'Workspace ID',
      status: 'fail',
      message: 'Not configured',
      fix: 'Add workspace_id to your config.yml',
    };
  }
  
  return {
    name: 'Workspace ID',
    status: 'pass',
    message: `Configured: ${config.workspace_id}`,
  };
}

function checkApiKey(config: Config): CheckResult {
  const apiKey = config.workspace_key || config.vault?.workspace_key;
  
  if (!apiKey) {
    return {
      name: 'API Key',
      status: config.vault?.enabled ? 'fail' : 'warn',
      message: 'Not configured',
      fix: 'Set CLAWBRIDGE_WORKSPACE_KEY environment variable or add to config',
    };
  }
  
  if (apiKey.startsWith('cbk_')) {
    return {
      name: 'API Key',
      status: 'pass',
      message: `Configured: ****${apiKey.slice(-4)}`,
    };
  }
  
  return {
    name: 'API Key',
    status: 'warn',
    message: 'API key format may be incorrect',
    fix: 'API keys should start with "cbk_"',
  };
}

async function checkVaultUrl(apiUrl: string): Promise<CheckResult> {
  try {
    const response = await axios.get(`${apiUrl}/api/upload-run`, { timeout: 5000 });
    
    return {
      name: 'Vault API',
      status: 'pass',
      message: `Reachable: ${apiUrl}`,
    };
  } catch (error: any) {
    if (error.response) {
      // Got a response, so server is reachable
      return {
        name: 'Vault API',
        status: 'pass',
        message: `Reachable: ${apiUrl}`,
      };
    }
    
    return {
      name: 'Vault API',
      status: 'fail',
      message: `Not reachable: ${apiUrl}`,
      fix: 'Check your internet connection and vault.api_url in config',
    };
  }
}

function checkOutputDir(outputDir: string): CheckResult {
  const absolutePath = path.resolve(outputDir);
  
  if (!fs.existsSync(absolutePath)) {
    try {
      fs.mkdirSync(absolutePath, { recursive: true });
      return {
        name: 'Output Directory',
        status: 'pass',
        message: `Created: ${absolutePath}`,
      };
    } catch (error: any) {
      return {
        name: 'Output Directory',
        status: 'fail',
        message: `Cannot create: ${absolutePath}`,
        fix: 'Check directory permissions',
      };
    }
  }
  
  try {
    const testFile = path.join(absolutePath, '.clawbridge_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    return {
      name: 'Output Directory',
      status: 'pass',
      message: `Writable: ${absolutePath}`,
    };
  } catch (error: any) {
    return {
      name: 'Output Directory',
      status: 'fail',
      message: `Not writable: ${absolutePath}`,
      fix: 'Check directory permissions',
    };
  }
}

async function checkOpenClawCLI(): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('which openclaw', { timeout: 5000 });
    const path = stdout.trim();
    
    // Get version
    try {
      const { stdout: versionOut } = await execAsync('openclaw --version', { timeout: 5000 });
      const version = versionOut.trim();
      return {
        name: 'OpenClaw CLI',
        status: 'pass',
        message: `Found: ${path} (${version})`,
      };
    } catch {
      return {
        name: 'OpenClaw CLI',
        status: 'pass',
        message: `Found: ${path}`,
      };
    }
  } catch {
    return {
      name: 'OpenClaw CLI',
      status: 'fail',
      message: 'OpenClaw CLI not found in PATH',
      fix: 'Install OpenClaw: npm install -g openclaw',
    };
  }
}

export interface OpenClawToolsConfig {
  web?: {
    search?: { enabled?: boolean; apiKey?: string };
    fetch?: { enabled?: boolean };
  };
}

async function checkOpenClawTools(): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('openclaw config get tools', { timeout: 10000 });
    
    // Parse JSON from stdout (skip deprecation warnings)
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        name: 'OpenClaw Web Tools',
        status: 'warn',
        message: 'Could not parse tools config',
        fix: 'Run: openclaw configure',
      };
    }
    
    const tools: OpenClawToolsConfig = JSON.parse(jsonMatch[0]);
    const issues: string[] = [];
    const configured: string[] = [];
    
    // Check web_search
    if (tools.web?.search?.enabled) {
      if (tools.web.search.apiKey) {
        configured.push('web_search (Brave API)');
      } else {
        issues.push('web_search enabled but no API key');
      }
    } else {
      issues.push('web_search disabled');
    }
    
    // Check web_fetch
    if (tools.web?.fetch?.enabled) {
      configured.push('web_fetch');
    } else {
      issues.push('web_fetch disabled');
    }
    
    if (issues.length === 0) {
      return {
        name: 'OpenClaw Web Tools',
        status: 'pass',
        message: `Configured: ${configured.join(', ')}`,
      };
    } else if (configured.length > 0) {
      return {
        name: 'OpenClaw Web Tools',
        status: 'warn',
        message: `Partial: ${configured.join(', ')}. Issues: ${issues.join(', ')}`,
        fix: 'Run: openclaw configure (enable web tools)',
      };
    } else {
      return {
        name: 'OpenClaw Web Tools',
        status: 'fail',
        message: `Not configured: ${issues.join(', ')}`,
        fix: 'Run: openclaw configure (set up Brave API key and enable web_fetch)',
      };
    }
  } catch (error: any) {
    return {
      name: 'OpenClaw Web Tools',
      status: 'warn',
      message: 'Could not check tools config',
      fix: 'Run: openclaw configure',
    };
  }
}

/**
 * Check OpenClaw tools configuration (exported for use by run.ts)
 */
export async function getOpenClawToolsStatus(): Promise<{ 
  available: boolean; 
  webSearch: boolean; 
  webFetch: boolean;
  issues: string[];
}> {
  try {
    const { stdout } = await execAsync('openclaw config get tools', { timeout: 10000 });
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      return { available: false, webSearch: false, webFetch: false, issues: ['Could not parse config'] };
    }
    
    const tools: OpenClawToolsConfig = JSON.parse(jsonMatch[0]);
    const issues: string[] = [];
    
    const webSearch = !!(tools.web?.search?.enabled && tools.web?.search?.apiKey);
    const webFetch = !!tools.web?.fetch?.enabled;
    
    if (!webSearch) issues.push('web_search not configured (need Brave API key)');
    if (!webFetch) issues.push('web_fetch disabled');
    
    return { 
      available: webSearch || webFetch, 
      webSearch, 
      webFetch, 
      issues 
    };
  } catch {
    return { available: false, webSearch: false, webFetch: false, issues: ['OpenClaw not available'] };
  }
}
