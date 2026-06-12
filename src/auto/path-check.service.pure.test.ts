import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isReadDenied,
  isWriteAllowed,
  normalizePathPattern,
  normalizeTargetPath,
} from './path-check.service.pure.ts';
import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

const TEST_CWD = '/home/kaito/repos/pi-auto';

describe('normalizePathPattern', () => {
  it('expands tilde', () => {
    expect(normalizePathPattern('~/.ssh', TEST_CWD)).toBe(path.join(homedir(), '.ssh'));
  });

  it('keeps anchorless glob patterns as-is', () => {
    expect(normalizePathPattern('**/credential**', TEST_CWD)).toBe('**/credential**');
  });

  it('resolves relative paths from cwd', () => {
    expect(normalizePathPattern('src/file.ts', TEST_CWD)).toBe(
      path.join(TEST_CWD, 'src', 'file.ts'),
    );
  });
});

describe('normalizeTargetPath', () => {
  it('expands tilde', () => {
    expect(normalizeTargetPath('~/.ssh/config', TEST_CWD)).toBe(
      path.join(homedir(), '.ssh', 'config'),
    );
  });

  it('resolves relative paths from cwd', () => {
    expect(normalizeTargetPath('src/file.ts', TEST_CWD)).toBe(
      path.join(TEST_CWD, 'src', 'file.ts'),
    );
  });
});

describe('isReadDenied', () => {
  it('denies ~/.ssh descendants by default', () => {
    const result = isReadDenied('~/.ssh/config', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ denied: true, matchedBy: '~/.ssh' });
  });

  it('denies anchorless credential patterns by default', () => {
    const result = isReadDenied('/tmp/credentials.json', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ denied: true, matchedBy: '**/credential**' });
  });

  it('applies user denyRead patterns', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyRead: ['/etc/passwd'],
    };

    const result = isReadDenied('/etc/passwd', TEST_CWD, config);
    expect(result).toEqual({ denied: true, matchedBy: '/etc/passwd' });
  });

  it('allows non-sensitive project files', () => {
    const result = isReadDenied('README.md', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ denied: false });
  });
});

describe('isWriteAllowed', () => {
  it('allows writes under cwd by default', () => {
    const result = isWriteAllowed('src/file.ts', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ allowed: true });
  });

  it('allows writes under /tmp by default', () => {
    const result = isWriteAllowed('/tmp/example.txt', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ allowed: true });
  });

  it('allows writes under ~/.pi/agent by default', () => {
    const result = isWriteAllowed('~/.pi/agent/settings.json.lock', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ allowed: true });
  });

  it('denies writes to .env by default', () => {
    const result = isWriteAllowed('.env', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      throw new Error('expected denied result');
    }
    expect(result.reason).toContain('denyWrite');
  });

  it('denies writes outside allowWrite paths', () => {
    const result = isWriteAllowed('/etc/hosts', TEST_CWD, DEFAULT_AUTO_CONFIG);
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      throw new Error('expected denied result');
    }
    expect(result.reason).toContain('allowWrite');
  });

  it('allows user-configured extra write paths', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowWrite: ['~/.cache'],
    };

    const result = isWriteAllowed('~/.cache/pi-auto/test.txt', TEST_CWD, config);
    expect(result).toEqual({ allowed: true });
  });
});
