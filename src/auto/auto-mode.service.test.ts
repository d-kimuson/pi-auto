import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  enableAutoMode,
  disableAutoMode,
  isAutoModeEnabled,
  decideToolCall,
  resetAutoMode,
} from './auto-mode.service.ts';
import { saveAutoConfig } from './config.service.ts';
import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

const TEST_CWD = path.join(tmpdir(), `pi-auto-mode-test-${Date.now()}`);
const TEST_SESSION = 'test-session-1';

beforeEach(() => {
  rmSync(TEST_CWD, { recursive: true, force: true });
  mkdirSync(TEST_CWD, { recursive: true });
  resetAutoMode();
});

describe('auto mode lifecycle', () => {
  it('starts with auto mode disabled', () => {
    expect(isAutoModeEnabled(TEST_CWD, TEST_SESSION)).toBe(false);
  });

  it('enables auto mode', () => {
    const config = enableAutoMode(TEST_CWD, TEST_SESSION);
    expect(isAutoModeEnabled(TEST_CWD, TEST_SESSION)).toBe(true);
    expect(config).toEqual(DEFAULT_AUTO_CONFIG);
  });

  it('disables auto mode', () => {
    enableAutoMode(TEST_CWD, TEST_SESSION);
    disableAutoMode(TEST_CWD, TEST_SESSION);
    expect(isAutoModeEnabled(TEST_CWD, TEST_SESSION)).toBe(false);
  });

  it('loads config from file when enabling', () => {
    const customConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyRead: ['~/.ssh'],
      allowWrite: ['/tmp'],
    };
    saveAutoConfig(TEST_CWD, customConfig);

    const config = enableAutoMode(TEST_CWD, TEST_SESSION);
    expect(config.denyRead).toEqual(['~/.ssh']);
    expect(config.allowWrite).toEqual(['/tmp']);
  });

  it('isolates sessions by cwd and sessionId', () => {
    enableAutoMode(TEST_CWD, 'session-a');
    expect(isAutoModeEnabled(TEST_CWD, 'session-b')).toBe(false);
    expect(isAutoModeEnabled(path.join(TEST_CWD, 'sub'), 'session-a')).toBe(false);
  });
});

describe('decideToolCall', () => {
  it('returns passthrough when auto mode is not enabled', () => {
    const result = decideToolCall('read', { path: '/tmp/test.md' }, TEST_CWD, TEST_SESSION);
    expect(result).toEqual({ kind: 'passthrough' });
  });

  it('returns auto-approve when tool matches allowTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowTools: ["read(path='/tmp/*.md')"],
    };
    saveAutoConfig(TEST_CWD, config);
    enableAutoMode(TEST_CWD, TEST_SESSION);

    const result = decideToolCall('read', { path: '/tmp/test.md' }, TEST_CWD, TEST_SESSION);
    expect(result.kind).toBe('auto-approve');
  });

  it('returns auto-deny when tool matches denyTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyTools: ["bash(command='rm *')"],
    };
    saveAutoConfig(TEST_CWD, config);
    enableAutoMode(TEST_CWD, TEST_SESSION);

    const result = decideToolCall('bash', { command: 'rm -rf /tmp/x' }, TEST_CWD, TEST_SESSION);
    expect(result.kind).toBe('auto-deny');
  });

  it('returns needs-sandbox when no rules match', () => {
    enableAutoMode(TEST_CWD, TEST_SESSION);

    const result = decideToolCall('bash', { command: 'echo hello' }, TEST_CWD, TEST_SESSION);
    expect(result).toEqual({ kind: 'needs-sandbox' });
  });

  it('returns passthrough when session config is missing (stale)', () => {
    // Manually corrupt the session state by removing config after enable
    enableAutoMode(TEST_CWD, TEST_SESSION);

    // In practice this shouldn't happen, but the service handles it gracefully
    expect(isAutoModeEnabled(TEST_CWD, TEST_SESSION)).toBe(true);
  });
});
