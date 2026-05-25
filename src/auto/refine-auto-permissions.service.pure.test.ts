import { describe, expect, it } from 'vitest';

import type { ApprovalLogEntry } from './approval-logger.service.ts';

import {
  formatApprovalLogSummary,
  summarizeApprovalLogs,
} from './refine-auto-permissions.service.pure.ts';

const createEntry = (
  overrides: Partial<ApprovalLogEntry> & Pick<ApprovalLogEntry, 'permissionSpec' | 'decision'>,
): ApprovalLogEntry => ({
  timestamp: '2026-05-24T00:00:00.000Z',
  cwd: '/repo',
  sessionId: 'session-1',
  toolName: 'bash',
  permissionSpec: overrides.permissionSpec,
  decision: overrides.decision,
  reason: overrides.reason,
  matchedBy: overrides.matchedBy,
});

describe('summarizeApprovalLogs', () => {
  it('aggregates counts by permission spec across decisions', () => {
    const summary = summarizeApprovalLogs([
      createEntry({ permissionSpec: "bash(command='ls *', timeout=0)", decision: 'srt-allowed' }),
      createEntry({ permissionSpec: "bash(command='ls *', timeout=0)", decision: 'agent-approve' }),
      createEntry({
        permissionSpec: "bash(command='cat .env', timeout=0)",
        decision: 'agent-deny',
      }),
      createEntry({
        permissionSpec: "bash(command='cat .env', timeout=0)",
        decision: 'srt-blocked',
      }),
    ]);

    expect(summary.totalEntries).toBe(4);
    expect(summary.uniqueSpecs).toBe(2);
    expect(summary.permissionSpecs).toEqual([
      {
        permissionSpec: "bash(command='ls *', timeout=0)",
        toolName: 'bash',
        totalCount: 2,
        countsByDecision: {
          'agent-approve': 1,
          'agent-deny': 0,
          'auto-approve': 0,
          'auto-deny': 0,
          'srt-allowed': 1,
          'srt-blocked': 0,
        },
        latestReason: undefined,
      },
      {
        permissionSpec: "bash(command='cat .env', timeout=0)",
        toolName: 'bash',
        totalCount: 2,
        countsByDecision: {
          'agent-approve': 0,
          'agent-deny': 1,
          'auto-approve': 0,
          'auto-deny': 0,
          'srt-allowed': 0,
          'srt-blocked': 1,
        },
        latestReason: undefined,
      },
    ]);
  });

  it('filters out specs below threshold', () => {
    const summary = summarizeApprovalLogs(
      [createEntry({ permissionSpec: "bash(command='ls *', timeout=0)", decision: 'srt-allowed' })],
      { minCount: 2 },
    );

    expect(summary.permissionSpecs).toEqual([]);
  });

  it('sorts by total count desc', () => {
    const summary = summarizeApprovalLogs([
      createEntry({ permissionSpec: "bash(command='ls *', timeout=0)", decision: 'srt-allowed' }),
      createEntry({ permissionSpec: "bash(command='ls *', timeout=0)", decision: 'srt-allowed' }),
      createEntry({
        permissionSpec: "bash(command='ls *.md', timeout=0)",
        decision: 'srt-allowed',
      }),
      createEntry({
        permissionSpec: "bash(command='ls *.md', timeout=0)",
        decision: 'agent-approve',
      }),
      createEntry({
        permissionSpec: "bash(command='ls *.md', timeout=0)",
        decision: 'srt-allowed',
      }),
    ]);

    expect(summary.permissionSpecs[0]?.permissionSpec).toBe("bash(command='ls *.md', timeout=0)");
    expect(summary.permissionSpecs[1]?.permissionSpec).toBe("bash(command='ls *', timeout=0)");
  });
});

describe('formatApprovalLogSummary', () => {
  it('renders a readable summary', () => {
    const text = formatApprovalLogSummary(
      summarizeApprovalLogs([
        createEntry({
          permissionSpec: "bash(command='ls *.md', timeout=0)",
          decision: 'agent-approve',
          reason: 'safe repeated listing',
        }),
        createEntry({
          permissionSpec: "bash(command='ls *.md', timeout=0)",
          decision: 'srt-allowed',
        }),
      ]),
    );

    expect(text).toContain('## Frequent permission specs');
    expect(text).toContain("bash(command='ls *.md', timeout=0)");
    expect(text).toContain('agent-approve=1');
    expect(text).toContain('srt-allowed=1');
    expect(text).toContain('latestReason: safe repeated listing');
  });
});
