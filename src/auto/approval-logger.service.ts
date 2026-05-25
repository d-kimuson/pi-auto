import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Approval log types
// ---------------------------------------------------------------------------

export type ApprovalDecision =
  | 'auto-approve'
  | 'auto-deny'
  | 'srt-allowed'
  | 'srt-blocked'
  | 'agent-approve'
  | 'agent-deny';

export type ApprovalLogEntry = {
  readonly timestamp: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly permissionSpec: string;
  readonly decision: ApprovalDecision;
  readonly reason?: string;
  readonly matchedBy?: string;
};

export const isApprovalDecision = (value: unknown): value is ApprovalDecision =>
  value === 'auto-approve' ||
  value === 'auto-deny' ||
  value === 'srt-allowed' ||
  value === 'srt-blocked' ||
  value === 'agent-approve' ||
  value === 'agent-deny';

export const parseApprovalLogEntry = (value: unknown): ApprovalLogEntry | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const timestamp: unknown = Reflect.get(value, 'timestamp');
  const cwd: unknown = Reflect.get(value, 'cwd');
  const sessionId: unknown = Reflect.get(value, 'sessionId');
  const toolName: unknown = Reflect.get(value, 'toolName');
  const permissionSpec: unknown = Reflect.get(value, 'permissionSpec');
  const decision: unknown = Reflect.get(value, 'decision');
  const reason: unknown = Reflect.get(value, 'reason');
  const matchedBy: unknown = Reflect.get(value, 'matchedBy');

  if (
    typeof timestamp !== 'string' ||
    typeof cwd !== 'string' ||
    typeof sessionId !== 'string' ||
    typeof toolName !== 'string' ||
    typeof permissionSpec !== 'string' ||
    !isApprovalDecision(decision)
  ) {
    return undefined;
  }

  return {
    timestamp,
    cwd,
    sessionId,
    toolName,
    permissionSpec,
    decision,
    reason: typeof reason === 'string' ? reason : undefined,
    matchedBy: typeof matchedBy === 'string' ? matchedBy : undefined,
  };
};

// ---------------------------------------------------------------------------
// Log file path
// ---------------------------------------------------------------------------

export const getPiAutoDataDir = (): string => path.join(homedir(), '.pi', 'extensions', 'pi-auto');
export const getApprovalLogFile = (): string => path.join(getPiAutoDataDir(), 'approvals.jsonl');

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let logDirEnsured = false;

const ensureLogDir = (): void => {
  if (logDirEnsured) return;

  mkdirSync(getPiAutoDataDir(), { recursive: true });
  logDirEnsured = true;
};

/**
 * Append an approval decision log entry.
 */
export const logApprovalDecision = (entry: ApprovalLogEntry): void => {
  ensureLogDir();
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(getApprovalLogFile(), line, 'utf-8');
};
