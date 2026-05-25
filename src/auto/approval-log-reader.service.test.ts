import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readRecentApprovalLogs } from './approval-log-reader.service.ts';

const testDir = path.join(tmpdir(), `pi-auto-log-reader-test-${Date.now()}`);
const logFile = path.join(testDir, 'approvals.jsonl');

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const writeLines = (lines: readonly string[]): void => {
  writeFileSync(logFile, lines.join('\n') + '\n', 'utf-8');
};

describe('readRecentApprovalLogs', () => {
  it('returns empty result when file does not exist', () => {
    expect(readRecentApprovalLogs(logFile)).toEqual({
      entries: [],
      scannedBytes: 0,
      truncated: false,
    });
  });

  it('reads recent entries after since timestamp', () => {
    writeLines([
      JSON.stringify({
        timestamp: '2026-05-24T00:00:00.000Z',
        cwd: '/repo',
        sessionId: 's1',
        toolName: 'bash',
        permissionSpec: "bash(command='a', timeout=0)",
        decision: 'srt-allowed',
      }),
      JSON.stringify({
        timestamp: '2026-05-24T01:00:00.000Z',
        cwd: '/repo',
        sessionId: 's1',
        toolName: 'bash',
        permissionSpec: "bash(command='b', timeout=0)",
        decision: 'srt-allowed',
      }),
      JSON.stringify({
        timestamp: '2026-05-24T02:00:00.000Z',
        cwd: '/repo',
        sessionId: 's1',
        toolName: 'read',
        permissionSpec: "read(path='x', offset=0, limit=2000)",
        decision: 'agent-approve',
      }),
    ]);

    const result = readRecentApprovalLogs(logFile, {
      since: '2026-05-24T00:30:00.000Z',
      chunkSizeBytes: 64,
      maxBytesToScan: 1024,
    });

    expect(result.entries.map((entry) => entry.permissionSpec)).toEqual([
      "bash(command='b', timeout=0)",
      "read(path='x', offset=0, limit=2000)",
    ]);
    expect(result.truncated).toBe(false);
  });

  it('marks truncated when scan budget is exhausted', () => {
    writeLines(
      Array.from({ length: 20 }, (_, index) =>
        JSON.stringify({
          timestamp: `2026-05-24T00:00:${String(index).padStart(2, '0')}.000Z`,
          cwd: '/repo',
          sessionId: 's1',
          toolName: 'bash',
          permissionSpec: `bash(command='cmd-${index}', timeout=0)`,
          decision: 'srt-allowed',
        }),
      ),
    );

    const result = readRecentApprovalLogs(logFile, {
      chunkSizeBytes: 256,
      maxBytesToScan: 256,
    });

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });
});
