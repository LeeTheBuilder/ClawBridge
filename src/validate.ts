import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { ConnectionBrief } from './run';

// Initialize Ajv
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Load schema
let schema: object | null = null;

function loadSchema(): object {
  if (schema) return schema;

  // Try to load from local schema directory first
  const schemaPath = path.resolve(__dirname, '../schema/connection_brief.json');
  
  if (fs.existsSync(schemaPath)) {
    const content = fs.readFileSync(schemaPath, 'utf-8');
    schema = JSON.parse(content);
    logger.debug('Loaded schema from', { path: schemaPath });
    return schema!;
  }

  // Fallback: try to load from skill repo if available
  const skillSchemaPath = path.resolve(process.cwd(), 'node_modules/clawbridge-skill/schema/connection_brief.json');
  if (fs.existsSync(skillSchemaPath)) {
    const content = fs.readFileSync(skillSchemaPath, 'utf-8');
    schema = JSON.parse(content);
    logger.debug('Loaded schema from skill package', { path: skillSchemaPath });
    return schema!;
  }

  throw new Error('Connection Brief schema not found. Run "clawbridge install-skill" or ensure schema/connection_brief.json exists.');
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  params?: Record<string, any>;
}

/**
 * Validate a Connection Brief against the canonical schema
 */
export function validateConnectionBrief(brief: ConnectionBrief): ValidationResult {
  const schemaObj = loadSchema();
  const validate = ajv.compile(schemaObj);
  
  const valid = validate(brief);
  
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors || []).map((err: ErrorObject) => ({
    path: err.instancePath || '/',
    message: err.message || 'Unknown error',
    params: err.params,
  }));

  return { valid: false, errors };
}

/**
 * Validate and throw if invalid
 */
export function validateOrThrow(brief: ConnectionBrief): void {
  const result = validateConnectionBrief(brief);
  
  if (!result.valid) {
    const errorMessages = result.errors.map(e => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Schema validation failed:\n${errorMessages}`);
  }
}

/**
 * Additional hard validation rules beyond JSON schema
 */
export function validateHardRules(brief: ConnectionBrief): ValidationResult {
  const errors: ValidationError[] = [];

  // Rule: Each candidate must have at least 2 evidence URLs
  for (const candidate of brief.candidates) {
    if (!candidate.evidence_urls || candidate.evidence_urls.length < 2) {
      errors.push({
        path: `/candidates/${candidate.handle || candidate.name}/evidence_urls`,
        message: `Candidate "${candidate.name}" has fewer than 2 evidence URLs (required: 2, found: ${candidate.evidence_urls?.length || 0})`,
      });
    }
  }

  // Rule: workspace_id must be present and non-empty
  if (!brief.workspace_id || typeof brief.workspace_id !== 'string' || !brief.workspace_id.trim()) {
    errors.push({
      path: '/workspace_id',
      message: 'workspace_id is required',
    });
  }

  // Rule: run_id must be present
  if (!brief.run_id) {
    errors.push({
      path: '/run_id',
      message: 'run_id is required for upload',
    });
  }

  // Rule: project_profile_hash must be present
  if (!brief.project_profile_hash) {
    errors.push({
      path: '/project_profile_hash',
      message: 'project_profile_hash is required',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Full validation: schema + hard rules
 */
export function validateFull(brief: ConnectionBrief): ValidationResult {
  // First, validate against JSON schema
  const schemaResult = validateConnectionBrief(brief);
  if (!schemaResult.valid) {
    return schemaResult;
  }

  // Then, validate hard rules
  const hardResult = validateHardRules(brief);
  return hardResult;
}

/**
 * Print validation errors in a user-friendly format
 */
export function printValidationErrors(result: ValidationResult): void {
  if (result.valid) {
    logger.info('Validation passed');
    return;
  }

  logger.error('Validation failed with the following errors:');
  for (const error of result.errors) {
    logger.error(`  ${error.path}: ${error.message}`);
  }
}
