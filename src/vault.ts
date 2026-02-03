import axios, { AxiosError } from 'axios';
import { Config } from './config';
import { ConnectionBrief } from './run';
import { logger } from './logger';
import { validateFull, printValidationErrors } from './validate';

/** Production vault URL – used when config has localhost (e.g. from linking against local dev). */
const PRODUCTION_VAULT_URL = 'https://clawbridge.cloud';

/**
 * Effective vault API URL. If config has localhost/127.0.0.1, use production URL
 * so runners always upload to clawbridge.cloud in prod.
 */
export function getVaultApiUrl(config: Config): string {
  const raw = config.vault?.api_url;
  if (!raw) return PRODUCTION_VAULT_URL;
  try {
    const u = new URL(raw);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return PRODUCTION_VAULT_URL;
    }
  } catch {
    return raw;
  }
  return raw;
}

export interface UploadResult {
  ok: boolean;
  runId: string;
  vaultUrl: string;
  message?: string;
}

/**
 * Upload a connection brief to the vault with retries
 */
export async function uploadToVault(brief: ConnectionBrief, config: Config): Promise<UploadResult | null> {
  if (!config.vault?.enabled) {
    logger.debug('Vault upload disabled');
    return null;
  }
  
  const apiUrl = getVaultApiUrl(config);
  const apiKey = config.vault.workspace_key || config.workspace_key;
  
  if (!apiKey) {
    throw new Error('Workspace API key required for vault upload. Set CLAWBRIDGE_WORKSPACE_KEY environment variable.');
  }

  // Validate before upload
  logger.info('Validating connection brief before upload...');
  const validation = validateFull(brief);
  if (!validation.valid) {
    printValidationErrors(validation);
    throw new Error('Validation failed. Connection brief will not be uploaded.');
  }
  logger.info('Validation passed');
  
  const uploadUrl = `${apiUrl}/api/upload-run`;
  
  logger.info('Uploading to vault', { 
    api_url: apiUrl,
    workspace_id: config.workspace_id,
  });

  // Retry configuration
  const maxRetries = 3;
  const backoffMs = [1000, 3000, 9000]; // 1s, 3s, 9s

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post<UploadResult>(
        uploadUrl,
        { run: brief },
        {
          headers: {
            'X-Workspace-Id': config.workspace_id,
            'X-Workspace-Key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );
      
      logger.info('Vault upload successful', { 
        run_id: brief.run_id,
        vault_url: response.data.vaultUrl,
      });
      
      return response.data;
      
    } catch (error: any) {
      lastError = error;
      const axiosError = error as AxiosError<{ error?: string; message?: string }>;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        const errorMessage = axiosError.response.data?.error || axiosError.response.data?.message || error.message;
        
        // Don't retry on client errors (except 429)
        if (status >= 400 && status < 500 && status !== 429) {
          logger.error('Vault upload failed (not retrying)', {
            status,
            message: errorMessage,
          });
          throw new Error(`Upload failed: ${errorMessage}`);
        }
        
        // Rate limited
        if (status === 429) {
          logger.warn('Rate limited, will retry after backoff', { attempt: attempt + 1 });
        }
        
        logger.warn('Vault upload attempt failed', {
          attempt: attempt + 1,
          status,
          message: errorMessage,
        });
      } else {
        logger.warn('Vault upload attempt failed (network error)', {
          attempt: attempt + 1,
          error: error.message,
        });
      }
      
      // Wait before retry (except on last attempt)
      if (attempt < maxRetries - 1) {
        const waitMs = backoffMs[attempt] || 9000;
        logger.info(`Retrying in ${waitMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
  
  // All retries exhausted
  logger.error('Vault upload failed after all retries');
  throw lastError || new Error('Upload failed after all retries');
}

/**
 * Fetch runs from the vault
 */
export async function fetchRuns(
  config: Config, 
  options?: { limit?: number; offset?: number }
): Promise<ConnectionBrief[]> {
  if (!config.vault?.enabled) {
    throw new Error('Vault API URL not configured');
  }
  const apiUrl = getVaultApiUrl(config);
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault access');
  }
  
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  
  const response = await axios.get(
    `${apiUrl}/workspaces/${config.workspace_id}/runs?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );
  
  return response.data.runs;
}

/**
 * Fetch a specific run from the vault
 */
export async function fetchRun(
  config: Config, 
  runId: string
): Promise<ConnectionBrief> {
  if (!config.vault?.enabled) {
    throw new Error('Vault API URL not configured');
  }
  const apiUrl = getVaultApiUrl(config);
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault access');
  }
  
  const response = await axios.get(
    `${apiUrl}/workspaces/${config.workspace_id}/runs/${encodeURIComponent(runId)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  );
  
  return response.data;
}

/**
 * Update a candidate decision in the vault
 */
export async function updateCandidateDecision(
  config: Config,
  runId: string,
  candidateHandle: string,
  decision: {
    status: 'approved' | 'rejected' | 'deferred';
    notes?: string;
    decided_at?: string;
    decided_by?: string;
  }
): Promise<void> {
  if (!config.vault?.enabled) {
    throw new Error('Vault API URL not configured');
  }
  const apiUrl = getVaultApiUrl(config);
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault access');
  }
  
  await axios.patch(
    `${apiUrl}/workspaces/${config.workspace_id}/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateHandle)}/decision`,
    {
      ...decision,
      decided_at: decision.decided_at || new Date().toISOString(),
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  logger.info('Decision updated', { 
    run_id: runId, 
    candidate: candidateHandle, 
    status: decision.status 
  });
}
