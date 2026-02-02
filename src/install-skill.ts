import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { logger } from './logger';

const execAsync = promisify(exec);

const DEFAULT_SKILL_URL = 'https://github.com/clawbridge/clawbridge-skill';
const DEFAULT_SKILL_BRANCH = 'main';

/**
 * Install the clawbridge skill from GitHub
 */
export async function installSkill(targetDir: string, url?: string): Promise<void> {
  const skillUrl = url || DEFAULT_SKILL_URL;
  const absoluteTarget = path.resolve(targetDir);

  console.log('\n📦 Installing Clawbridge Skill\n');
  console.log(`Source: ${skillUrl}`);
  console.log(`Target: ${absoluteTarget}\n`);

  // Check if git is available
  const hasGit = await checkGit();

  if (hasGit) {
    await installViaGit(absoluteTarget, skillUrl);
  } else {
    await installViaDownload(absoluteTarget, skillUrl);
  }

  // Verify installation
  await verifyInstallation(absoluteTarget);

  console.log('\n✅ Skill installed successfully!\n');
  console.log('Next steps:');
  console.log('  1. Run "clawbridge doctor" to verify your setup');
  console.log('  2. Run "clawbridge run --dry-run" to test');
  console.log('');
}

/**
 * Check if git is available
 */
async function checkGit(): Promise<boolean> {
  try {
    await execAsync('git --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Install via git clone
 */
async function installViaGit(targetDir: string, url: string): Promise<void> {
  const skillDir = path.join(targetDir, 'clawbridge-skill');

  // Remove existing if present
  if (fs.existsSync(skillDir)) {
    console.log('Removing existing skill directory...');
    fs.rmSync(skillDir, { recursive: true, force: true });
  }

  console.log('Cloning repository...');
  await execAsync(`git clone --depth 1 ${url} ${skillDir}`);

  // Copy schema to runner's schema directory
  await copySchema(skillDir, targetDir);
}

/**
 * Install via direct download (fallback when git not available)
 */
async function installViaDownload(targetDir: string, url: string): Promise<void> {
  // Convert GitHub URL to raw content URLs
  let rawBaseUrl = url;
  if (url.includes('github.com')) {
    rawBaseUrl = url
      .replace('github.com', 'raw.githubusercontent.com')
      .replace(/\/$/, '') + `/${DEFAULT_SKILL_BRANCH}`;
  }

  const skillDir = path.join(targetDir, 'clawbridge-skill');
  
  // Create directories
  fs.mkdirSync(path.join(skillDir, 'schema'), { recursive: true });

  console.log('Downloading schema...');
  
  // Download schema
  const schemaUrl = `${rawBaseUrl}/schema/connection_brief.json`;
  try {
    const response = await axios.get(schemaUrl);
    fs.writeFileSync(
      path.join(skillDir, 'schema', 'connection_brief.json'),
      JSON.stringify(response.data, null, 2)
    );
  } catch (error) {
    throw new Error(`Failed to download schema from ${schemaUrl}`);
  }

  console.log('Downloading SKILL.md...');
  
  // Download SKILL.md
  try {
    const skillMdUrl = `${rawBaseUrl}/SKILL.md`;
    const response = await axios.get(skillMdUrl);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), response.data);
  } catch (error) {
    console.log('⚠️ Could not download SKILL.md (optional)');
  }

  // Copy schema to runner's schema directory
  await copySchema(skillDir, targetDir);
}

/**
 * Copy schema to the runner's schema directory
 */
async function copySchema(skillDir: string, targetDir: string): Promise<void> {
  const sourceSchema = path.join(skillDir, 'schema', 'connection_brief.json');
  
  // Try to find the runner's schema directory
  const possibleSchemaLocations = [
    path.join(targetDir, 'schema'),
    path.join(targetDir, 'node_modules', 'clawbridge-runner', 'schema'),
    path.join(__dirname, '..', 'schema'),
  ];

  for (const schemaDir of possibleSchemaLocations) {
    try {
      if (!fs.existsSync(schemaDir)) {
        fs.mkdirSync(schemaDir, { recursive: true });
      }
      
      const destSchema = path.join(schemaDir, 'connection_brief.json');
      fs.copyFileSync(sourceSchema, destSchema);
      console.log(`Schema copied to: ${destSchema}`);
      return;
    } catch (error) {
      // Try next location
    }
  }

  console.log('⚠️ Could not copy schema to runner directory');
}

/**
 * Verify the installation is valid
 */
async function verifyInstallation(targetDir: string): Promise<void> {
  const skillDir = path.join(targetDir, 'clawbridge-skill');
  const schemaPath = path.join(skillDir, 'schema', 'connection_brief.json');

  console.log('\nVerifying installation...');

  // Check schema exists
  if (!fs.existsSync(schemaPath)) {
    throw new Error('Schema file not found after installation');
  }

  // Validate schema is valid JSON
  try {
    const content = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(content);
    
    if (!schema.$id || !schema.properties) {
      throw new Error('Schema appears to be invalid');
    }
    
    console.log(`✓ Schema valid (${schema.$id})`);
  } catch (error: any) {
    throw new Error(`Schema validation failed: ${error.message}`);
  }

  // Check SKILL.md exists
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    console.log('✓ SKILL.md found');
  } else {
    console.log('⚠ SKILL.md not found (optional)');
  }
}
