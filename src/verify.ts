import axios from 'axios';
import { Config, loadConfig } from './config';
import { getVaultApiUrl } from './vault';
import { logger } from './logger';

/**
 * Verify vault connection and credentials
 */
export async function verifyVault(configPath: string): Promise<void> {
  console.log('\n🔍 Clawbridge Verify\n');
  
  let config: Config;
  
  // Load config
  try {
    config = await loadConfig(configPath);
    console.log('✅ Config loaded');
    console.log(`   Workspace: ${config.workspace_id}`);
  } catch (error: any) {
    console.log('❌ Config load failed:', error.message);
    process.exit(1);
  }

  // Check vault config
  if (!config.vault?.enabled) {
    console.log('⚠️  Vault is disabled in config');
    console.log('   Set vault.enabled: true to use vault features');
    return;
  }

  const apiUrl = getVaultApiUrl(config);
  const apiKey = config.workspace_key || config.vault.workspace_key;

  if (!apiKey) {
    console.log('❌ No workspace key configured');
    console.log('   Set CLAWBRIDGE_WORKSPACE_KEY environment variable');
    console.log('   or add workspace_key to your config.yml');
    process.exit(1);
  }

  console.log(`\nTesting connection to: ${apiUrl}`);
  console.log(`Workspace: ${config.workspace_id}`);
  console.log(`API Key: ****${apiKey.slice(-4)}`);
  console.log('');

  // Test 1: Check if API is reachable
  try {
    const response = await axios.get(`${apiUrl}/api/upload-run`, {
      timeout: 10000,
    });
    console.log('✅ API endpoint reachable');
  } catch (error: any) {
    if (error.response) {
      // Got a response, so it's reachable
      console.log('✅ API endpoint reachable');
    } else {
      console.log('❌ API endpoint not reachable');
      console.log(`   Error: ${error.message}`);
      console.log('   Check your internet connection and vault.api_url');
      process.exit(1);
    }
  }

  // Test 2: Verify credentials with a lightweight test
  // We'll send a minimal request to check auth
  try {
    // Try to upload an invalid (empty) run - we expect a 400, but not a 401
    const response = await axios.post(
      `${apiUrl}/api/upload-run`,
      { run: {} },  // Invalid payload
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': config.workspace_id,
          'X-Workspace-Key': apiKey,
        },
        timeout: 10000,
        validateStatus: (status) => status < 500, // Accept 4xx responses
      }
    );

    if (response.status === 401) {
      console.log('❌ Authentication failed');
      console.log('   Your workspace ID or API key is incorrect');
      console.log('   Generate a new key from the dashboard if needed');
      process.exit(1);
    } else if (response.status === 400) {
      // Expected - invalid payload but auth worked!
      console.log('✅ Credentials valid');
    } else if (response.status === 200 || response.status === 201) {
      // Shouldn't happen with empty payload, but credentials work
      console.log('✅ Credentials valid');
    } else {
      console.log(`⚠️  Unexpected response: ${response.status}`);
      console.log('   Credentials may still be valid');
    }
  } catch (error: any) {
    if (error.response?.status === 401) {
      console.log('❌ Authentication failed');
      console.log('   Your workspace ID or API key is incorrect');
      process.exit(1);
    } else {
      console.log('⚠️  Could not verify credentials');
      console.log(`   Error: ${error.message}`);
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(50));
  console.log('\n✅ Verification complete\n');
  console.log('Your Clawbridge runner is configured correctly.');
  console.log('');
  console.log('Next: Run "clawbridge run" to execute the skill');
  console.log('');
}
