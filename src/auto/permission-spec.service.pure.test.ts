import { describe, expect, it } from 'vitest';

import {
  formatPermissionSpec,
  parsePermissionSpec,
  matchesPermissionPattern,
  matchesGlob,
  matchesToolName,
} from './permission-spec.service.pure.ts';

// ---------------------------------------------------------------------------
// formatPermissionSpec
// ---------------------------------------------------------------------------

describe('formatPermissionSpec', () => {
  it('formats a read call with path only', () => {
    const spec = formatPermissionSpec('read', { path: '/home/user/README.md' });
    expect(spec).toBe("read(limit=2000, offset=0, path='/home/user/README.md')");
  });

  it('formats a read call with all params', () => {
    const spec = formatPermissionSpec('read', {
      path: '/home/user/file.txt',
      offset: 10,
      limit: 50,
    });
    expect(spec).toBe("read(limit=50, offset=10, path='/home/user/file.txt')");
  });

  it('formats a write call', () => {
    const spec = formatPermissionSpec('write', {
      path: '/tmp/output.txt',
      content: 'hello',
    });
    expect(spec).toBe("write(content='hello', path='/tmp/output.txt')");
  });

  it('formats a bash call with timeout', () => {
    const spec = formatPermissionSpec('bash', {
      command: 'ls -la',
      timeout: 5000,
    });
    expect(spec).toBe("bash(command='ls -la', timeout=5000)");
  });

  it('formats a bash call with default timeout filled', () => {
    const spec = formatPermissionSpec('bash', { command: 'echo hello' });
    expect(spec).toBe("bash(command='echo hello', timeout=0)");
  });

  it('formats an unknown tool with sorted args', () => {
    const spec = formatPermissionSpec('mcp', { b: 1, a: 2, c: 'test' });
    expect(spec).toBe("mcp(a=2, b=1, c='test')");
  });

  it('escapes single quotes in string values', () => {
    const spec = formatPermissionSpec('bash', { command: "echo 'hello'" });
    expect(spec).toBe("bash(command='echo \\'hello\\'', timeout=0)");
  });

  it('formats array values', () => {
    const spec = formatPermissionSpec('mcp', { items: ['a', 'b'] });
    expect(spec).toBe("mcp(items=['a', 'b'])");
  });
});

// ---------------------------------------------------------------------------
// parsePermissionSpec
// ---------------------------------------------------------------------------

describe('parsePermissionSpec', () => {
  it('parses a simple spec', () => {
    const result = parsePermissionSpec("read(path='/tmp/test.md')");
    expect(result).not.toBeNull();
    if (result === null) throw new Error('unreachable');
    expect(result.toolName).toBe('read');
    expect(result.args).toEqual({ path: '/tmp/test.md' });
  });

  it('parses a spec with multiple args', () => {
    const result = parsePermissionSpec("bash(command='ls -la', timeout=5000)");
    expect(result).not.toBeNull();
    if (result === null) throw new Error('unreachable');
    expect(result.args).toEqual({
      command: 'ls -la',
      timeout: '5000',
    });
  });

  it('returns null for invalid format', () => {
    expect(parsePermissionSpec('not a spec')).toBeNull();
    expect(parsePermissionSpec('')).toBeNull();
  });

  it('handles escaped quotes', () => {
    const result = parsePermissionSpec("bash(command='echo \\'hello\\'')");
    expect(result).not.toBeNull();
    if (result === null) throw new Error('unreachable');
    expect(result.args).toEqual({ command: "echo 'hello'" });
  });
});

// ---------------------------------------------------------------------------
// matchesGlob
// ---------------------------------------------------------------------------

describe('matchesGlob', () => {
  it('matches exact paths', () => {
    expect(matchesGlob('/tmp/test.md', '/tmp/test.md')).toBe(true);
    expect(matchesGlob('/tmp/test.md', '/tmp/other.md')).toBe(false);
  });

  it('matches * wildcard', () => {
    expect(matchesGlob('/tmp/test.md', '/tmp/*.md')).toBe(true);
    expect(matchesGlob('/tmp/a/b.md', '/tmp/*.md')).toBe(false); // * doesn't cross /
  });

  it('matches ** wildcard', () => {
    expect(matchesGlob('/tmp/a/b.md', '/tmp/**/*.md')).toBe(true);
    expect(matchesGlob('/tmp/a/b/c.md', '/tmp/**/*.md')).toBe(true);
    expect(matchesGlob('/tmp/test.md', '/tmp/**/*.md')).toBe(true);
  });

  it('matches ? wildcard', () => {
    expect(matchesGlob('/tmp/a.md', '/tmp/?.md')).toBe(true);
    expect(matchesGlob('/tmp/ab.md', '/tmp/?.md')).toBe(false);
  });

  it('matches patterns starting with **', () => {
    expect(matchesGlob('/tmp/a/b/credential', '**credential**')).toBe(true);
    expect(matchesGlob('/home/user/credential.txt', '**credential**')).toBe(true);
  });

  it('rejects non-matching paths', () => {
    expect(matchesGlob('/tmp/test.md', '/etc/*')).toBe(false);
    expect(matchesGlob('/etc/passwd', '*.md')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesPermissionPattern
// ---------------------------------------------------------------------------

describe('matchesPermissionPattern', () => {
  it('matches exact tool and args', () => {
    expect(matchesPermissionPattern("read(path='/tmp/test.md')", "read(path='/tmp/test.md')")).toBe(
      true,
    );
  });

  it('matches with glob in path', () => {
    expect(matchesPermissionPattern("read(path='/tmp/test.md')", "read(path='/tmp/*.md')")).toBe(
      true,
    );
  });

  it('rejects different tool names', () => {
    expect(
      matchesPermissionPattern("read(path='/tmp/test.md')", "write(path='/tmp/test.md')"),
    ).toBe(false);
  });

  it('rejects non-matching args', () => {
    expect(matchesPermissionPattern("read(path='/tmp/test.md')", "read(path='/etc/test.md')")).toBe(
      false,
    );
  });

  it('matches glob patterns in bash commands', () => {
    expect(
      matchesPermissionPattern("bash(command='rm -rf /tmp/test')", "bash(command='rm *')"),
    ).toBe(true);
  });

  it('requires all pattern args to match', () => {
    // Pattern has extra arg that spec doesn't have
    expect(
      matchesPermissionPattern("read(path='/tmp/test.md')", "read(path='/tmp/test.md', offset=10)"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesToolName
// ---------------------------------------------------------------------------

describe('matchesToolName', () => {
  it('matches exact tool name', () => {
    expect(matchesToolName('read', "read(path='*')")).toBe(true);
    expect(matchesToolName('write', "read(path='*')")).toBe(false);
  });

  it('matches * wildcard', () => {
    expect(matchesToolName('read', "*(path='*')")).toBe(true);
    expect(matchesToolName('write', "*(path='*')")).toBe(true);
  });

  it('returns false for invalid pattern', () => {
    expect(matchesToolName('read', 'invalid')).toBe(false);
  });
});
