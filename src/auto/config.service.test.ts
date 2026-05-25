import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAutoConfig, saveAutoConfig, mergeAutoConfig } from './config.service.ts';

const parseJsonObject = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);

  if (typeof value !== 'object' || value === null) {
    throw new Error('expected object JSON');
  }

  return Object.fromEntries(Object.entries(value));
};
import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

const testDir = path.join(tmpdir(), `pi-auto-test-${Date.now()}`);
const settingsPath = path.join(testDir, '.pi', 'agent', 'settings.json');

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadAutoConfig', () => {
  it('returns default config when file does not exist', () => {
    const config = loadAutoConfig(testDir);
    expect(config).toEqual(DEFAULT_AUTO_CONFIG);
  });

  it('loads and parses a valid settings file', () => {
    const config: AutoConfig = {
      denyRead: ['~/.ssh'],
      allowWrite: ['.', '/tmp'],
      denyWrite: ['.env'],
      allowedDomains: ['api.github.com'],
      allowTools: ["read(path='/tmp/*.log')"],
      denyTools: ["bash(command='rm *')"],
    };

    saveAutoConfig(testDir, config);
    const loaded = loadAutoConfig(testDir);

    expect(loaded).toEqual(config);
  });

  it('returns default config for malformed JSON', () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, '{ invalid json }', 'utf-8');

    const config = loadAutoConfig(testDir);
    expect(config).toEqual(DEFAULT_AUTO_CONFIG);
  });

  it('returns default config when settings file lacks auto object', () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ other: true }), 'utf-8');

    const config = loadAutoConfig(testDir);
    expect(config).toEqual(DEFAULT_AUTO_CONFIG);
  });
});

describe('saveAutoConfig', () => {
  it('writes config to .pi/agent/settings.json under auto only', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowWrite: ['.'],
    };

    saveAutoConfig(testDir, config);

    expect(existsSync(settingsPath)).toBe(true);

    const raw = parseJsonObject(readFileSync(settingsPath, 'utf-8'));
    expect(raw['auto']).toEqual({
      ...DEFAULT_AUTO_CONFIG,
      allowWrite: ['.'],
    });
    expect(raw['auto-mode-permissions']).toBeUndefined();
  });

  it('preserves unrelated settings keys', () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }), 'utf-8');

    saveAutoConfig(testDir, {
      ...DEFAULT_AUTO_CONFIG,
      denyRead: ['~/.ssh'],
    });

    const raw = parseJsonObject(readFileSync(settingsPath, 'utf-8'));
    expect(raw['theme']).toBe('dark');
    expect(raw['auto']).toEqual({
      ...DEFAULT_AUTO_CONFIG,
      denyRead: ['~/.ssh'],
    });
    expect(raw['auto-mode-permissions']).toBeUndefined();
  });
});

describe('mergeAutoConfig', () => {
  it('returns base when overrides is empty', () => {
    const base: AutoConfig = {
      denyRead: ['~/.ssh'],
      allowWrite: ['.'],
      denyWrite: [],
      allowedDomains: [],
      allowTools: [],
      denyTools: [],
    };

    const merged = mergeAutoConfig(base, {});
    expect(merged).toEqual(base);
  });

  it('overrides specified fields', () => {
    const base: AutoConfig = {
      denyRead: ['~/.ssh'],
      allowWrite: ['.'],
      denyWrite: [],
      allowedDomains: [],
      allowTools: [],
      denyTools: [],
    };

    const merged = mergeAutoConfig(base, {
      allowWrite: ['/tmp'],
      denyRead: ['/etc/passwd'],
    });

    expect(merged.allowWrite).toEqual(['/tmp']);
    expect(merged.denyRead).toEqual(['/etc/passwd']);
    expect(merged.denyWrite).toEqual([]);
  });
});
