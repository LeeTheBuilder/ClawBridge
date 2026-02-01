import axios from 'axios';
import { Config } from './config';
import { ConnectionBrief } from './run';
import { logger } from './logger';

/**
 * Upload a connection brief to the vault
 */
export async function uploadToVault(brief: ConnectionBrief, config: Config): Promise<void> {
  if (!config.vault?.enabled) {
    logger.debug('Vault upload disabled');
    return;
  }
  
  if (!config.vault.api_url) {
    throw new Error('Vault API URL not configured');
  }
  
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault upload');
  }
  
  logger.info('Uploading to vault', { 
    api_url: config.vault.api_url,
    workspace_id: config.workspace_id,
  });
  
  try {
    const response = await axios.post(
      `${config.vault.api_url}/workspaces/${config.workspace_id}/runs`,
      brief,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    
    logger.info('Vault upload successful', { 
      run_id: brief.run_id,
      vault_id: response.data.id,
    });
    
  } catch (error: any) {
    if (error.response) {
      logger.error('Vault upload failed', {
        status: error.response.status,
        message: error.response.data?.message || error.message,
      });
    } else {
      logger.error('Vault upload failed', { error: error.message });
    }
    throw error;
  }
}

/**
 * Fetch runs from the vault
 */
export async function fetchRuns(
  config: Config, 
  options?: { limit?: number; offset?: number }
): Promise<ConnectionBrief[]> {
  if (!config.vault?.api_url) {
    throw new Error('Vault API URL not configured');
  }
  
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault access');
  }
  
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  
  const response = await axios.get(
    `${config.vault.api_url}/workspaces/${config.workspace_id}/runs?${params}`,
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
  if (!config.vault?.api_url) {
    throw new Error('Vault API URL not configured');
  }
  
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault access');
  }
  
  const response = await axios.get(
    `${config.vault.api_url}/workspaces/${config.workspace_id}/runs/${encodeURIComponent(runId)}`,
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
  if (!config.vault?.api_url) {
    throw new Error('Vault API URL not configured');
  }
  
  const token = config.vault.workspace_token || config.workspace_token;
  
  if (!token) {
    throw new Error('Workspace token required for vault access');
  }
  
  await axios.patch(
    `${config.vault.api_url}/workspaces/${config.workspace_id}/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateHandle)}/decision`,
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
