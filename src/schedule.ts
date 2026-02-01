import { CronJob } from 'cron';
import { Config } from './config';
import { runSkill } from './run';
import { logger } from './logger';

interface SchedulerOptions {
  config: Config;
  cronExpression: string;
}

let activeJob: CronJob | null = null;
let isRunning = false;

/**
 * Start the scheduler for periodic skill execution
 */
export function startScheduler(options: SchedulerOptions): void {
  const { config, cronExpression } = options;
  
  if (activeJob) {
    logger.warn('Scheduler already running, stopping existing job');
    stopScheduler();
  }
  
  logger.info('Initializing scheduler', { 
    cron: cronExpression,
    workspace_id: config.workspace_id 
  });
  
  activeJob = new CronJob(
    cronExpression,
    async () => {
      if (isRunning) {
        logger.warn('Previous run still in progress, skipping this execution');
        return;
      }
      
      isRunning = true;
      const startTime = Date.now();
      
      try {
        logger.info('Scheduled run starting');
        
        await runSkill({
          config,
          outputDir: config.output?.dir || './output',
          deliver: true,
          upload: config.vault?.enabled || false,
          dryRun: false,
        });
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info('Scheduled run completed', { duration_seconds: duration });
        
      } catch (error) {
        logger.error('Scheduled run failed', { error });
      } finally {
        isRunning = false;
      }
    },
    null, // onComplete
    true, // start
    undefined, // timezone (use system default)
    undefined, // context
    false, // runOnInit
    undefined, // utcOffset
  );
  
  // Log next scheduled run
  const nextRun = activeJob.nextDate();
  logger.info('Next scheduled run', { time: nextRun.toISO() });
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
    logger.info('Scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return activeJob !== null && activeJob.running;
}

/**
 * Get next scheduled run time
 */
export function getNextRunTime(): Date | null {
  if (!activeJob) return null;
  return activeJob.nextDate().toJSDate();
}

/**
 * Trigger an immediate run (outside of schedule)
 */
export async function triggerImmediateRun(config: Config): Promise<void> {
  if (isRunning) {
    throw new Error('A run is already in progress');
  }
  
  isRunning = true;
  
  try {
    logger.info('Immediate run triggered');
    
    await runSkill({
      config,
      outputDir: config.output?.dir || './output',
      deliver: true,
      upload: config.vault?.enabled || false,
      dryRun: false,
    });
    
  } finally {
    isRunning = false;
  }
}

/**
 * Common cron expressions for reference
 */
export const CRON_PRESETS = {
  // Every day at 9 PM
  NIGHTLY_9PM: '0 21 * * *',
  
  // Every day at 6 AM
  MORNING_6AM: '0 6 * * *',
  
  // Every weekday at 9 PM
  WEEKDAYS_9PM: '0 21 * * 1-5',
  
  // Every Monday at 9 AM
  WEEKLY_MONDAY: '0 9 * * 1',
  
  // Every hour (for testing)
  HOURLY: '0 * * * *',
  
  // Every 15 minutes (for testing)
  EVERY_15_MIN: '*/15 * * * *',
};
