import { describe, expect, it } from 'vitest';

import { checkToolPermission } from './permission-check.service.pure.ts';
import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

describe('checkToolPermission', () => {
  it('returns needs-sandbox when no rules are configured', () => {
    const result = checkToolPermission('read', { path: '/tmp/test.md' }, DEFAULT_AUTO_CONFIG);
    expect(result).toEqual({ kind: 'needs-sandbox' });
  });

  it('returns auto-deny when tool matches denyTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyTools: ["bash(command='rm *')"],
    };

    const result = checkToolPermission('bash', { command: 'rm -rf /tmp' }, config);
    expect(result).toEqual({ kind: 'auto-deny', matchedBy: "bash(command='rm *')" });
  });

  it('returns auto-approve when tool matches allowTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowTools: ["read(path='/tmp/*.md')"],
    };

    const result = checkToolPermission('read', { path: '/tmp/test.md' }, config);
    expect(result).toEqual({
      kind: 'auto-approve',
      matchedBy: "read(path='/tmp/*.md')",
    });
  });

  it('prioritizes denyTools over allowTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowTools: ["bash(command='rm *')"],
      denyTools: ["bash(command='rm -rf *')"],
    };

    const result = checkToolPermission('bash', { command: 'rm -rf /important' }, config);
    expect(result.kind).toBe('auto-deny');
  });

  it('returns needs-sandbox for non-matching tool', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowTools: ["read(path='/tmp/*.md')"],
    };

    const result = checkToolPermission('write', { path: '/tmp/test.txt' }, config);
    expect(result).toEqual({ kind: 'needs-sandbox' });
  });

  it('matches glob patterns in paths', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowTools: ["read(path='/home/**/*.ts')"],
    };

    const result = checkToolPermission('read', { path: '/home/user/src/app.ts' }, config);
    expect(result.kind).toBe('auto-approve');
  });

  it('handles wildcard tool name in allowTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowTools: ["*(path='/tmp/safe/*')"],
    };

    const readResult = checkToolPermission('read', { path: '/tmp/safe/test.md' }, config);
    expect(readResult.kind).toBe('auto-approve');

    const writeResult = checkToolPermission('write', { path: '/tmp/safe/test.txt' }, config);
    expect(writeResult.kind).toBe('auto-approve');
  });

  it('handles wildcard tool name in denyTools', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyTools: ["*(path='**/credential**')"],
    };

    const result = checkToolPermission('read', { path: '/tmp/credentials.json' }, config);
    expect(result.kind).toBe('auto-deny');
  });

  it('matches the first matching denyTools pattern', () => {
    const config: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyTools: ["bash(command='rm -rf *')", "bash(command='rm *')"],
    };

    const result = checkToolPermission('bash', { command: 'rm -rf /tmp/x' }, config);
    expect(result).toEqual({
      kind: 'auto-deny',
      matchedBy: "bash(command='rm -rf *')",
    });
  });
});
