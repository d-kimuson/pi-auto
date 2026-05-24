import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Approval log types
// ---------------------------------------------------------------------------

export type ApprovalLogEntry = {
  readonly timestamp: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly permissionSpec: string;
  readonly decision:
    | 'auto-approve'
    | 'auto-deny'
    | 'srt-allowed'
    | 'srt-blocked'
    | 'agent-approve'
    | 'agent-deny';
  readonly reason?: string;
  readonly matchedBy?: string;
};

// ---------------------------------------------------------------------------
// Log file path
// ---------------------------------------------------------------------------

const getLogDir = (): string => path.join(homedir(), '.pi', 'extensions', 'pi-auto');
const getLogFile = (): string => path.join(getLogDir(), 'approvals.jsonl');

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let logDirEnsured = false;

const ensureLogDir = (): void => {
  if (logDirEnsured) return;

  mkdirSync(getLogDir(), { recursive: true });
  logDirEnsured = true;
};

/**
 * Append an approval decision log entry.
 */
export const logApprovalDecision = (entry: ApprovalLogEntry): void => {
  ensureLogDir();
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(getLogFile(), line, 'utf-8');
};
