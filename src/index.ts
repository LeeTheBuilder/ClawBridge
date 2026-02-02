#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { runSkill } from './run';
import { startScheduler, stopScheduler } from './schedule';
import { loadConfig, getDefaultConfigPath, getConfigDir, getDefaultEnvPath } from './config';
import { logger } from './logger';

// Load .env from ~/.clawbridge/.env if it exists
dotenv.config({ path: getDefaultEnvPath() });

// Default config path is ~/.clawbridge/config.yml
const DEFAULT_CONFIG = getDefaultConfigPath();

const program = new Command();

program
  .name('clawbridge')
  .description('CLI runner for Clawbridge - find high-quality business connections')
  .version('2.0.0');

program
  .command('run')
  .description('Execute Clawbridge discovery and upload results to Vault')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG)
  .option('-o, --output <dir>', 'Output directory for results')
  .option('-p, --profile <name>', 'Profile name to use (default: default)')
  .option('--no-upload', 'Skip vault upload')
  .option('--dry-run', 'Preview what would be done without executing')
  .option('--debug', 'Enable debug logging (same as LOG_LEVEL=debug)')
  .action(async (options) => {
    try {
      if (options.debug) {
        process.env.LOG_LEVEL = 'debug';
        logger.level = 'debug';
      }
      logger.info('Starting clawbridge run...');
      const config = await loadConfig(options.config);
      
      // Use config's output dir if not specified, or default to ~/.clawbridge/output
      const outputDir = options.output || config.output?.dir || `${getConfigDir()}/output`;
      
      await runSkill({
        config,
        outputDir,
        upload: options.upload !== false,
        dryRun: options.dryRun || false,
        profile: options.profile,
      });
      
      logger.info('Run completed successfully');
    } catch (error) {
      logger.error('Run failed:', error);
      process.exit(1);
    }
  });

program
  .command('schedule')
  .description('Start the scheduler for periodic runs')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG)
  .option('--cron <expression>', 'Cron expression', '0 21 * * *')
  .action(async (options) => {
    try {
      logger.info('Starting clawbridge scheduler...');
      const config = await loadConfig(options.config);
      
      startScheduler({
        config,
        cronExpression: options.cron,
      });
      
      logger.info(`Scheduler started with cron: ${options.cron}`);
      logger.info('Press Ctrl+C to stop');
      
      // Keep process running
      process.on('SIGINT', () => {
        logger.info('Stopping scheduler...');
        stopScheduler();
        process.exit(0);
      });
    } catch (error) {
      logger.error('Scheduler failed to start:', error);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize a new clawbridge configuration')
  .option('-d, --dir <path>', 'Directory to initialize', '.')
  .action(async (options) => {
    try {
      const { initConfig } = await import('./init');
      await initConfig(options.dir);
      logger.info('Configuration initialized successfully');
    } catch (error) {
      logger.error('Initialization failed:', error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate configuration file')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG)
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      logger.info('Configuration is valid');
      logger.info('Workspace ID:', config.workspace_id);
    } catch (error) {
      logger.error('Configuration validation failed:', error);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Check system setup and configuration')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG)
  .action(async (options) => {
    try {
      const { runDoctor } = await import('./doctor');
      await runDoctor(options.config);
    } catch (error) {
      logger.error('Doctor check failed:', error);
      process.exit(1);
    }
  });

program
  .command('link <code>')
  .description('Link a workspace using a connect code from clawbridge.cloud')
  .option('-d, --dir <path>', `Directory to create config in (default: ${getConfigDir()})`)
  .option('--api-url <url>', 'API URL for resolving connect codes', 'https://clawbridge.cloud')
  .action(async (code, options) => {
    try {
      const { linkWorkspace } = await import('./link');
      await linkWorkspace(code, {
        dir: options.dir || getConfigDir(),
        apiUrl: options.apiUrl,
      });
    } catch (error) {
      logger.error('Link failed:', error);
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Verify vault connection and credentials')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG)
  .action(async (options) => {
    try {
      const { verifyVault } = await import('./verify');
      await verifyVault(options.config);
    } catch (error) {
      logger.error('Verification failed:', error);
      process.exit(1);
    }
  });

program
  .command('profiles')
  .description('List available profiles')
  .option('-c, --config <path>', 'Path to config file', DEFAULT_CONFIG)
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      console.log('\n📋 Available Profiles\n');
      console.log('  default - Main profile from config.yml');
      console.log(`    Offer: ${config.project_profile.offer.substring(0, 50)}...`);
      console.log(`    Ask: ${config.project_profile.ask.substring(0, 50)}...`);
      console.log('');
    } catch (error) {
      logger.error('Failed to list profiles:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
