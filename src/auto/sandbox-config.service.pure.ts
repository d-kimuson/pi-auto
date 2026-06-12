import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

import type { AutoConfig } from './types.pure.ts';

// ---------------------------------------------------------------------------
// srt configuration types
// ---------------------------------------------------------------------------

export type SrtFilesystemConfig = {
  denyRead: string[];
  allowRead?: string[];
  allowWrite: string[];
  denyWrite: string[];
};

export type SrtNetworkConfig = {
  allowedDomains: string[];
  deniedDomains: string[];
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  allowLocalBinding?: boolean;
};

export type SrtConfig = SandboxRuntimeConfig;

// ---------------------------------------------------------------------------
// Default sensitive path patterns (always denied for read)
// ---------------------------------------------------------------------------

const DEFAULT_DENY_READ_PATTERNS: readonly string[] = [
  '~/.ssh',
  '~/.ssh/**',
  '~/.aws',
  '~/.aws/**',
  '~/.gnupg',
  '~/.gnupg/**',
  '~/.config/gcloud',
  '~/.config/gcloud/**',
  '~/.config/gh',
  '~/.config/gh/**',
];

// ---------------------------------------------------------------------------
// Default allowed domains (from Claude Code on the web)
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_DOMAINS: readonly string[] = [
  'github.com',
  '*.github.com',
  'githubusercontent.com',
  '*.githubusercontent.com',
  'gitlab.com',
  '*.gitlab.com',
  'bitbucket.org',
  '*.bitbucket.org',
  'npmjs.com',
  '*.npmjs.com',
  'npmjs.org',
  '*.npmjs.org',
  'yarnpkg.com',
  '*.yarnpkg.com',
  'nodejs.org',
  '*.nodejs.org',
  'pypi.org',
  '*.pypi.org',
  'pythonhosted.org',
  '*.pythonhosted.org',
  'crates.io',
  '*.crates.io',
  'rubygems.org',
  '*.rubygems.org',
  'pub.dev',
  '*.pub.dev',
  'packagist.org',
  '*.packagist.org',
  'docker.com',
  '*.docker.com',
  'docker.io',
  '*.docker.io',
  'ghcr.io',
  'gcr.io',
  '*.gcr.io',
  'mcr.microsoft.com',
  '*.mcr.microsoft.com',
  'googleapis.com',
  '*.googleapis.com',
  'google.com',
  '*.google.com',
  'microsoft.com',
  '*.microsoft.com',
  'azure.com',
  '*.azure.com',
  'amazonaws.com',
  '*.amazonaws.com',
  'apache.org',
  '*.apache.org',
  'eclipse.org',
  '*.eclipse.org',
  'golang.org',
  '*.golang.org',
  'rust-lang.org',
  '*.rust-lang.org',
  'swift.org',
  '*.swift.org',
  'openai.com',
  '*.openai.com',
  'anthropic.com',
  '*.anthropic.com',
  'huggingface.co',
  '*.huggingface.co',
  'api.anthropic.com',
  '*.api.anthropic.com',
];

// ---------------------------------------------------------------------------
// Build srt config from auto config + defaults
// ---------------------------------------------------------------------------

/**
 * Build an srt-compatible sandbox configuration from auto config and defaults.
 */
export const buildSrtConfig = (_cwd: string, config: AutoConfig): SrtConfig => {
  return {
    filesystem: buildFilesystemConfig(_cwd, config),
    network: buildNetworkConfig(config),
  };
};

const buildFilesystemConfig = (_cwd: string, config: AutoConfig): SrtFilesystemConfig => {
  const denyRead = [...DEFAULT_DENY_READ_PATTERNS];

  // Add user-configured denyRead patterns
  for (const pattern of config.denyRead) {
    denyRead.push(pattern);
  }

  // Default write permissions: cwd, /tmp, and ~/.pi/agent (pi settings/credentials)
  const allowWrite: string[] = ['.', '/tmp', '~/.pi/agent'];

  // Add user-configured allowWrite
  for (const pattern of config.allowWrite) {
    if (!allowWrite.includes(pattern)) {
      allowWrite.push(pattern);
    }
  }

  const denyWrite = ['.env', '.env.local', '.env.production', '*.lock'];

  // Add user-configured denyWrite
  for (const pattern of config.denyWrite) {
    denyWrite.push(pattern);
  }

  return {
    denyRead,
    allowWrite,
    denyWrite,
  };
};

const buildNetworkConfig = (config: AutoConfig): SrtNetworkConfig => {
  const allowedDomains = [...DEFAULT_ALLOWED_DOMAINS];

  // Add user-configured domains
  for (const domain of config.allowedDomains) {
    if (!allowedDomains.includes(domain)) {
      allowedDomains.push(domain);
    }
  }

  return {
    allowedDomains,
    deniedDomains: [],
    allowUnixSockets: ['/var/run/docker.sock'],
    allowAllUnixSockets: false,
    allowLocalBinding: false,
  };
};
