#!/usr/bin/env node

import { Command } from 'commander';
import { runSkill } from './run';
import { startScheduler, stopScheduler } from './schedule';
import { loadConfig } from './config';
import { logger } from './logger';

const program = new Command();

program
  .name('clawbridge')
  .description('CLI runner for claw-clawbridge skill')
  .version('1.0.0');

program
  .command('run')
  .description('Execute the clawbridge skill once')
  .option('-c, --config <path>', 'Path to config file', './config.yml')
  .option('-o, --output <dir>', 'Output directory for results', './output')
  .option('--no-deliver', 'Skip delivery (Discord/Slack/Email)')
  .option('--no-upload', 'Skip vault upload')
  .option('--dry-run', 'Preview what would be done without executing')
  .action(async (options) => {
    try {
      logger.info('Starting clawbridge run...');
      const config = await loadConfig(options.config);
      
      await runSkill({
        config,
        outputDir: options.output,
        deliver: options.deliver !== false,
        upload: options.upload !== false,
        dryRun: options.dryRun || false,
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
  .option('-c, --config <path>', 'Path to config file', './config.yml')
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
  .command('test-delivery')
  .description('Test delivery configuration')
  .option('-c, --config <path>', 'Path to config file', './config.yml')
  .option('--channel <type>', 'Delivery channel to test (discord, slack, email)', 'discord')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      const { testDelivery } = await import('./deliver');
      await testDelivery(config, options.channel);
      logger.info('Delivery test completed');
    } catch (error) {
      logger.error('Delivery test failed:', error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate configuration file')
  .option('-c, --config <path>', 'Path to config file', './config.yml')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      logger.info('Configuration is valid');
      logger.info('Workspace ID:', config.workspace_id);
      logger.info('Delivery target:', config.delivery.target);
    } catch (error) {
      logger.error('Configuration validation failed:', error);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Check system setup and configuration')
  .option('-c, --config <path>', 'Path to config file', './config.yml')
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
  .command('install-skill')
  .description('Install the clawbridge skill from GitHub')
  .option('-d, --dir <path>', 'Target directory for skill installation', '.')
  .option('--url <url>', 'Custom GitHub URL for the skill', 'https://github.com/clawbridge/clawbridge-skill')
  .action(async (options) => {
    try {
      const { installSkill } = await import('./install-skill');
      await installSkill(options.dir, options.url);
    } catch (error) {
      logger.error('Skill installation failed:', error);
      process.exit(1);
    }
  });

program
  .command('link <code>')
  .description('Link a workspace using a connect code from clawbridge.dev')
  .option('-d, --dir <path>', 'Directory to create config in', '.')
  .option('--api-url <url>', 'API URL for resolving connect codes', 'https://clawbridge.dev')
  .action(async (code, options) => {
    try {
      const { linkWorkspace } = await import('./link');
      await linkWorkspace(code, {
        dir: options.dir,
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
  .option('-c, --config <path>', 'Path to config file', './config.yml')
  .action(async (options) => {
    try {
      const { verifyVault } = await import('./verify');
      await verifyVault(options.config);
    } catch (error) {
      logger.error('Verification failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
