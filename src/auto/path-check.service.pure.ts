import { homedir } from 'node:os';
import path from 'node:path';

import type { AutoConfig } from './types.pure.ts';

import { matchesGlob } from './permission-spec.service.pure.ts';

const DEFAULT_DENY_READ_PATTERNS: readonly string[] = [
  '~/.ssh',
  '~/.ssh/**',
  '**/credential**',
  '**/credentials**',
  '**/.env',
  '**/.env.*',
  '**/*secret*',
  '**/*token*',
  '**/.aws/credentials',
  '**/.aws/config',
  '**/.gcloud/**',
  '**/id_rsa',
  '**/id_ed25519',
  '**/id_ecdsa',
  '**/*.pem',
  '**/*.key',
];

const DEFAULT_ALLOW_WRITE_PATTERNS: readonly string[] = ['.', '/tmp', '~/.pi/agent'];
const DEFAULT_DENY_WRITE_PATTERNS: readonly string[] = [
  '.env',
  '.env.local',
  '.env.production',
  '*.lock',
];

export const normalizePathPattern = (rawPath: string, cwd: string): string => {
  if (rawPath.startsWith('**')) {
    return rawPath;
  }

  let normalized = rawPath;

  if (normalized === '~' || normalized.startsWith('~/')) {
    normalized = path.join(homedir(), normalized.slice(1));
  }

  if (!path.isAbsolute(normalized)) {
    normalized = path.resolve(cwd, normalized);
  }

  return path.normalize(normalized);
};

export const normalizeTargetPath = (rawPath: string, cwd: string): string => {
  let normalized = rawPath;

  if (normalized === '~' || normalized.startsWith('~/')) {
    normalized = path.join(homedir(), normalized.slice(1));
  }

  if (!path.isAbsolute(normalized)) {
    normalized = path.resolve(cwd, normalized);
  }

  return path.normalize(normalized);
};

const pathMatchesPattern = (targetPath: string, pattern: string): boolean => {
  if (matchesGlob(targetPath, pattern)) {
    return true;
  }

  if (!pattern.includes('*') && !pattern.includes('?')) {
    return targetPath === pattern || targetPath.startsWith(`${pattern}${path.sep}`);
  }

  return false;
};

export const isReadDenied = (
  rawPath: string,
  cwd: string,
  config: AutoConfig,
): { readonly denied: true; readonly matchedBy: string } | { readonly denied: false } => {
  const targetPath = normalizeTargetPath(rawPath, cwd);
  const patterns = [...DEFAULT_DENY_READ_PATTERNS, ...config.denyRead];

  for (const pattern of patterns) {
    const normalizedPattern = normalizePathPattern(pattern, cwd);

    if (pathMatchesPattern(targetPath, normalizedPattern)) {
      return {
        denied: true,
        matchedBy: pattern,
      };
    }
  }

  return {
    denied: false,
  };
};

export const isWriteAllowed = (
  rawPath: string,
  cwd: string,
  config: AutoConfig,
): { readonly allowed: true } | { readonly allowed: false; readonly reason: string } => {
  const targetPath = normalizeTargetPath(rawPath, cwd);
  const denyPatterns = [...DEFAULT_DENY_WRITE_PATTERNS, ...config.denyWrite];

  for (const pattern of denyPatterns) {
    const normalizedPattern = normalizePathPattern(pattern, cwd);

    if (pathMatchesPattern(targetPath, normalizedPattern)) {
      return {
        allowed: false,
        reason: `Sandbox blocked: write path matches denyWrite pattern "${pattern}"`,
      };
    }
  }

  const allowPatterns = [...DEFAULT_ALLOW_WRITE_PATTERNS, ...config.allowWrite];

  for (const pattern of allowPatterns) {
    const normalizedPattern = normalizePathPattern(pattern, cwd);

    if (pathMatchesPattern(targetPath, normalizedPattern)) {
      return {
        allowed: true,
      };
    }
  }

  return {
    allowed: false,
    reason: `Sandbox blocked: write path "${rawPath}" is not in allowWrite list`,
  };
};
