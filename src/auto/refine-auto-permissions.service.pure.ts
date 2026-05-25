import type { ApprovalLogEntry } from './approval-logger.service.ts';

export type PermissionSpecSummary = {
  readonly permissionSpec: string;
  readonly toolName: string;
  readonly totalCount: number;
  readonly countsByDecision: Readonly<Record<ApprovalLogEntry['decision'], number>>;
  readonly latestReason?: string;
};

export type ApprovalLogSummary = {
  readonly totalEntries: number;
  readonly uniqueSpecs: number;
  readonly permissionSpecs: readonly PermissionSpecSummary[];
};

const DECISION_ORDER: readonly ApprovalLogEntry['decision'][] = [
  'agent-approve',
  'srt-allowed',
  'agent-deny',
  'srt-blocked',
  'auto-approve',
  'auto-deny',
];

const createEmptyCounts = (): Record<ApprovalLogEntry['decision'], number> => ({
  'agent-approve': 0,
  'agent-deny': 0,
  'auto-approve': 0,
  'auto-deny': 0,
  'srt-allowed': 0,
  'srt-blocked': 0,
});

export const summarizeApprovalLogs = (
  entries: readonly ApprovalLogEntry[],
  options?: {
    readonly minCount?: number;
    readonly limit?: number;
  },
): ApprovalLogSummary => {
  const minCount = options?.minCount ?? 2;
  const limit = options?.limit ?? 100;
  const summaryMap = new Map<
    string,
    {
      toolName: string;
      countsByDecision: Record<ApprovalLogEntry['decision'], number>;
      latestReason?: string;
      latestTimestamp: string;
    }
  >();

  for (const entry of entries) {
    const existing = summaryMap.get(entry.permissionSpec);

    if (existing === undefined) {
      const countsByDecision = createEmptyCounts();
      countsByDecision[entry.decision] += 1;
      summaryMap.set(entry.permissionSpec, {
        toolName: entry.toolName,
        countsByDecision,
        latestReason: entry.reason,
        latestTimestamp: entry.timestamp,
      });
      continue;
    }

    existing.countsByDecision[entry.decision] += 1;

    if (entry.timestamp >= existing.latestTimestamp) {
      existing.latestTimestamp = entry.timestamp;

      if (entry.reason !== undefined) {
        existing.latestReason = entry.reason;
      }
    }
  }

  const permissionSpecs = [...summaryMap.entries()]
    .map(([permissionSpec, value]) => ({
      permissionSpec,
      toolName: value.toolName,
      totalCount: DECISION_ORDER.reduce(
        (sum, decision) => sum + value.countsByDecision[decision],
        0,
      ),
      countsByDecision: value.countsByDecision,
      latestReason: value.latestReason,
    }))
    .filter((entry) => entry.totalCount >= minCount)
    .sort((a, b) => {
      if (b.totalCount !== a.totalCount) {
        return b.totalCount - a.totalCount;
      }

      for (const decision of DECISION_ORDER) {
        if (b.countsByDecision[decision] !== a.countsByDecision[decision]) {
          return b.countsByDecision[decision] - a.countsByDecision[decision];
        }
      }

      return a.permissionSpec.localeCompare(b.permissionSpec);
    })
    .slice(0, limit);

  return {
    totalEntries: entries.length,
    uniqueSpecs: summaryMap.size,
    permissionSpecs,
  };
};

export const formatApprovalLogSummary = (summary: ApprovalLogSummary): string => {
  if (summary.permissionSpecs.length === 0) {
    return [
      `Total log entries: ${summary.totalEntries}`,
      `Unique permission specs: ${summary.uniqueSpecs}`,
      'No permission specs met the minimum frequency threshold.',
    ].join('\n');
  }

  const lines = [
    `Total log entries: ${summary.totalEntries}`,
    `Unique permission specs: ${summary.uniqueSpecs}`,
    '',
    '## Frequent permission specs',
  ];

  for (const entry of summary.permissionSpecs) {
    const decisionParts = DECISION_ORDER.filter(
      (decision) => entry.countsByDecision[decision] > 0,
    ).map((decision) => `${decision}=${entry.countsByDecision[decision]}`);

    lines.push(`- ${entry.permissionSpec}`);
    lines.push(`  - tool: ${entry.toolName}`);
    lines.push(`  - total: ${entry.totalCount}`);
    lines.push(`  - decisions: ${decisionParts.join(', ')}`);

    if (entry.latestReason !== undefined && entry.latestReason !== '') {
      lines.push(`  - latestReason: ${entry.latestReason}`);
    }
  }

  return lines.join('\n');
};
