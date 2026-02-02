import * as fs from 'fs';
import * as path from 'path';
import { generateExampleConfig } from './config';
import { logger } from './logger';

/**
 * Initialize a new clawbridge configuration in the specified directory
 */
export async function initConfig(targetDir: string): Promise<void> {
  const absolutePath = path.resolve(targetDir);
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
    logger.info('Created directory', { path: absolutePath });
  }
  
  // Create config file
  const configPath = path.join(absolutePath, 'config.yml');
  if (fs.existsSync(configPath)) {
    logger.warn('config.yml already exists, skipping');
  } else {
    const exampleConfig = generateExampleConfig();
    fs.writeFileSync(configPath, exampleConfig);
    logger.info('Created config.yml');
  }
  
  // Create .env file
  const envPath = path.join(absolutePath, '.env');
  if (fs.existsSync(envPath)) {
    logger.warn('.env already exists, skipping');
  } else {
    const envContent = `# Clawbridge Runner Configuration
# Copy this file to .env and fill in your values

# Workspace token (from clawbridge.cloud)
CLAWBRIDGE_WORKSPACE_TOKEN=

# Discord delivery (choose one)
DISCORD_WEBHOOK_URL=
# Or use bot token
DISCORD_BOT_TOKEN=

# Slack delivery (choose one)
SLACK_WEBHOOK_URL=
# Or use bot token
SLACK_BOT_TOKEN=

# Email delivery
SMTP_PASSWORD=

# Logging
LOG_LEVEL=info
`;
    fs.writeFileSync(envPath, envContent);
    logger.info('Created .env');
  }
  
  // Create .gitignore
  const gitignorePath = path.join(absolutePath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignoreContent = `# Environment
.env
.env.local

# Output
output/

# Logs
*.log

# Node
node_modules/
`;
    fs.writeFileSync(gitignorePath, gitignoreContent);
    logger.info('Created .gitignore');
  }
  
  // Create output directory
  const outputPath = path.join(absolutePath, 'output');
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
    fs.writeFileSync(path.join(outputPath, '.gitkeep'), '');
    logger.info('Created output directory');
  }
  
  // Print next steps
  console.log('\n✅ Clawbridge initialized!\n');
  console.log('Next steps:');
  console.log('1. Edit config.yml with your project profile');
  console.log('2. Copy .env and add your secrets');
  console.log('3. Run: clawbridge run --dry-run');
  console.log('4. Run: clawbridge schedule to start nightly runs');
  console.log('');
}
