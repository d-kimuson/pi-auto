import type { AutoConfig } from './types.pure.ts';

import { logApprovalDecision, type ApprovalLogEntry } from './approval-logger.service.ts';
import { loadAutoConfig } from './config.service.ts';
import { checkToolPermission, type ToolPermissionResult } from './permission-check.service.pure.ts';

// ---------------------------------------------------------------------------
// Auto mode state (per session)
// ---------------------------------------------------------------------------

type AutoModeSessionState = {
  enabled: boolean;
  config: AutoConfig;
};

const sessions = new Map<string, AutoModeSessionState>();

const getSessionKey = (cwd: string, sessionId: string): string => `${cwd}::${sessionId}`;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Enable auto mode for a session.
 */
export const enableAutoMode = (cwd: string, sessionId: string): AutoConfig => {
  const config = loadAutoConfig(cwd);
  const key = getSessionKey(cwd, sessionId);
  sessions.set(key, { enabled: true, config });
  return config;
};

/**
 * Disable auto mode for a session.
 */
export const disableAutoMode = (cwd: string, sessionId: string): void => {
  const key = getSessionKey(cwd, sessionId);
  sessions.delete(key);
};

/**
 * Reset all auto mode state (for testing).
 */
export const resetAutoMode = (): void => {
  sessions.clear();
};

/**
 * Check if auto mode is enabled for a session.
 */
export const isAutoModeEnabled = (cwd: string, sessionId: string): boolean => {
  const key = getSessionKey(cwd, sessionId);
  return sessions.get(key)?.enabled ?? false;
};

/**
 * Get the current auto config for a session.
 */
export const getSessionConfig = (cwd: string, sessionId: string): AutoConfig | undefined => {
  const key = getSessionKey(cwd, sessionId);
  return sessions.get(key)?.config;
};

// ---------------------------------------------------------------------------
// Tool call handling
// ---------------------------------------------------------------------------

/**
 * Result of handling a tool call in auto mode.
 */
export type AutoModeDecision =
  | { readonly kind: 'passthrough' }
  | {
      readonly kind: 'auto-approve';
      readonly permissionResult: ToolPermissionResult & { kind: 'auto-approve' };
    }
  | {
      readonly kind: 'auto-deny';
      readonly permissionResult: ToolPermissionResult & { kind: 'auto-deny' };
    }
  | { readonly kind: 'needs-sandbox' };

/**
 * Decide what to do with a tool call in auto mode.
 *
 * Returns:
 * - passthrough: auto mode is not enabled
 * - auto-approve: tool matches allowTools
 * - auto-deny: tool matches denyTools
 * - needs-sandbox: tool needs to run through srt sandboxing
 */
export const decideToolCall = (
  toolName: string,
  params: Record<string, unknown>,
  cwd: string,
  sessionId: string,
): AutoModeDecision => {
  if (!isAutoModeEnabled(cwd, sessionId)) {
    return { kind: 'passthrough' };
  }

  const config = getSessionConfig(cwd, sessionId);

  if (config === undefined) {
    return { kind: 'passthrough' };
  }

  const permissionResult = checkToolPermission(toolName, params, config);

  switch (permissionResult.kind) {
    case 'auto-approve':
      return { kind: 'auto-approve', permissionResult };
    case 'auto-deny':
      return { kind: 'auto-deny', permissionResult };
    case 'needs-sandbox':
      return { kind: 'needs-sandbox' };
    default:
      return { kind: 'needs-sandbox' };
  }
};

/**
 * Create an approval log entry base.
 */
const createLogBase = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
): Pick<ApprovalLogEntry, 'timestamp' | 'cwd' | 'sessionId' | 'toolName' | 'permissionSpec'> => ({
  timestamp: new Date().toISOString(),
  cwd,
  sessionId,
  toolName,
  permissionSpec,
});

/**
 * Log an auto-approve decision.
 */
export const logAutoApprove = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
  matchedBy: string,
): void => {
  logApprovalDecision({
    ...createLogBase(cwd, sessionId, toolName, permissionSpec),
    decision: 'auto-approve',
    matchedBy,
  });
};

/**
 * Log an auto-deny decision.
 */
export const logAutoDeny = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
  matchedBy: string,
): void => {
  logApprovalDecision({
    ...createLogBase(cwd, sessionId, toolName, permissionSpec),
    decision: 'auto-deny',
    matchedBy,
  });
};

/**
 * Log an srt-allowed (sandbox passed) decision.
 */
export const logSrtAllowed = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
): void => {
  logApprovalDecision({
    ...createLogBase(cwd, sessionId, toolName, permissionSpec),
    decision: 'srt-allowed',
  });
};

/**
 * Log an srt-blocked (sandbox rejected) decision.
 */
export const logSrtBlocked = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
  reason: string,
): void => {
  logApprovalDecision({
    ...createLogBase(cwd, sessionId, toolName, permissionSpec),
    decision: 'srt-blocked',
    reason,
  });
};

/**
 * Log an agent approval decision.
 */
export const logAgentDecision = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
  approved: boolean,
  reason?: string,
): void => {
  logApprovalDecision({
    ...createLogBase(cwd, sessionId, toolName, permissionSpec),
    decision: approved ? 'agent-approve' : 'agent-deny',
    reason,
  });
};
