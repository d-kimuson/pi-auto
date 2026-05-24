import {
  createBashToolDefinition,
  createEditToolDefinition,
  createLocalBashOperations,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectApprovalContext, runApprovalAgent } from '../src/auto/approval-agent.service.ts';
import {
  decideToolCall,
  disableAutoMode,
  enableAutoMode,
  getSessionConfig,
  isAutoModeEnabled,
  logAgentDecision,
  logAutoApprove,
  logAutoDeny,
  logSrtAllowed,
  logSrtBlocked,
} from '../src/auto/auto-mode.service.ts';
import { loadAutoConfig, saveAutoConfig } from '../src/auto/config.service.ts';
import { evaluateBashNetworkPolicy } from '../src/auto/network-policy.service.pure.ts';
import { isReadDenied, isWriteAllowed } from '../src/auto/path-check.service.pure.ts';
import { formatPermissionSpec } from '../src/auto/permission-spec.service.pure.ts';
import {
  createLocalBashOperationsWithSandbox,
  createSandboxedEditOperations,
  createSandboxedReadOperations,
  createSandboxedWriteOperations,
} from '../src/auto/sandbox-fs-operations.service.ts';
import {
  getSandboxAvailabilityIssue,
  resetSandboxRuntime,
} from '../src/auto/sandbox-runtime.service.ts';

const createDecision = (
  toolName: string,
  params: Record<string, unknown>,
  cwd: string,
  sessionId: string,
): {
  readonly permissionSpec: string;
  readonly decision: ReturnType<typeof decideToolCall>;
} => ({
  permissionSpec: formatPermissionSpec(toolName, params),
  decision: decideToolCall(toolName, params, cwd, sessionId),
});

const createAutoDenyError = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
  decision: ReturnType<typeof decideToolCall>,
): Error | undefined => {
  if (decision.kind !== 'auto-deny') {
    return undefined;
  }

  logAutoDeny(cwd, sessionId, toolName, permissionSpec, decision.permissionResult.matchedBy);
  return new Error(
    `Auto-deny: tool matches denyTools pattern "${decision.permissionResult.matchedBy}"`,
  );
};

const logAutoApprovalIfNeeded = (
  cwd: string,
  sessionId: string,
  toolName: string,
  permissionSpec: string,
  decision: ReturnType<typeof decideToolCall>,
): void => {
  if (decision.kind === 'auto-approve') {
    logAutoApprove(cwd, sessionId, toolName, permissionSpec, decision.permissionResult.matchedBy);
  }
};

const sanitizeShellToken = (token: string): string => token.replace(/^["']+|["',;:]+$/g, '');

const isPotentialPathToken = (token: string): boolean => {
  if (token === '' || token.startsWith('-') || /^https?:\/\//.test(token)) {
    return false;
  }

  return (
    token.includes('/') ||
    token.startsWith('~') ||
    token.startsWith('.') ||
    token.includes('credential') ||
    token.includes('secret') ||
    token.includes('token') ||
    token.endsWith('.pem') ||
    token.endsWith('.key') ||
    token === '.env' ||
    token.startsWith('.env.')
  );
};

const extractPathLikeTokens = (command: string): string[] =>
  command
    .split(/\s+/)
    .map((token) => sanitizeShellToken(token))
    .filter((token) => isPotentialPathToken(token));

const getBlockedPathToken = (
  command: string,
  cwd: string,
  config: NonNullable<ReturnType<typeof getSessionConfig>>,
): string | undefined => {
  for (const token of extractPathLikeTokens(command)) {
    if (isReadDenied(token, cwd, config).denied) {
      return token;
    }

    if (!isWriteAllowed(token, cwd, config).allowed) {
      return token;
    }
  }

  return undefined;
};

const requestApproval = async (
  pi: ExtensionAPI,
  cwd: string,
  sessionId: string,
  signal: AbortSignal | undefined,
  sessionManager: Parameters<typeof collectApprovalContext>[0],
  toolName: string,
  permissionSpec: string,
  reason: string,
  config: NonNullable<ReturnType<typeof getSessionConfig>>,
) => {
  const decision = await runApprovalAgent(
    (command, args, options) => pi.exec(command, args, options),
    cwd,
    signal,
    {
      toolName,
      permissionSpec,
      reason,
      config,
      ...collectApprovalContext(sessionManager),
    },
  );

  logAgentDecision(cwd, sessionId, toolName, permissionSpec, decision.approve, decision.reason);
  return decision;
};

const createReadOverride = (pi: ExtensionAPI) => ({
  ...createReadToolDefinition(process.cwd()),
  label: 'read',
  async execute(
    toolCallId: string,
    params: { path: string; offset?: number; limit?: number },
    signal: AbortSignal | undefined,
    onUpdate: Parameters<ReturnType<typeof createReadToolDefinition>['execute']>[3],
    ctx: Parameters<ReturnType<typeof createReadToolDefinition>['execute']>[4],
  ) {
    const sessionId = ctx.sessionManager.getSessionId();
    const unsandboxedBase = createReadToolDefinition(ctx.cwd);

    if (!isAutoModeEnabled(ctx.cwd, sessionId)) {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const { permissionSpec, decision } = createDecision('read', params, ctx.cwd, sessionId);
    const autoDenyError = createAutoDenyError(ctx.cwd, sessionId, 'read', permissionSpec, decision);

    if (autoDenyError !== undefined) {
      throw autoDenyError;
    }

    logAutoApprovalIfNeeded(ctx.cwd, sessionId, 'read', permissionSpec, decision);

    if (decision.kind === 'auto-approve') {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const config = getSessionConfig(ctx.cwd, sessionId);

    if (config === undefined) {
      throw new Error('Auto mode internal error: session config is missing.');
    }

    const readCheck = isReadDenied(params.path, ctx.cwd, config);

    if (readCheck.denied) {
      const reason = `read path "${params.path}" matches denyRead pattern "${readCheck.matchedBy}"`;
      logSrtBlocked(ctx.cwd, sessionId, 'read', permissionSpec, reason);
      const approval = await requestApproval(
        pi,
        ctx.cwd,
        sessionId,
        signal,
        ctx.sessionManager,
        'read',
        permissionSpec,
        reason,
        config,
      );

      if (!approval.approve) {
        throw new Error(`Sandbox blocked: ${approval.reason}`);
      }

      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const sandboxedBase = createReadToolDefinition(ctx.cwd, {
      operations: createSandboxedReadOperations(pi, ctx.cwd, signal, config),
    });
    const result = await sandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    logSrtAllowed(ctx.cwd, sessionId, 'read', permissionSpec);
    return result;
  },
});

const createWriteOverride = (pi: ExtensionAPI) => ({
  ...createWriteToolDefinition(process.cwd()),
  label: 'write',
  async execute(
    toolCallId: string,
    params: { path: string; content: string },
    signal: AbortSignal | undefined,
    onUpdate: Parameters<ReturnType<typeof createWriteToolDefinition>['execute']>[3],
    ctx: Parameters<ReturnType<typeof createWriteToolDefinition>['execute']>[4],
  ) {
    const sessionId = ctx.sessionManager.getSessionId();
    const unsandboxedBase = createWriteToolDefinition(ctx.cwd);

    if (!isAutoModeEnabled(ctx.cwd, sessionId)) {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const { permissionSpec, decision } = createDecision('write', params, ctx.cwd, sessionId);
    const autoDenyError = createAutoDenyError(
      ctx.cwd,
      sessionId,
      'write',
      permissionSpec,
      decision,
    );

    if (autoDenyError !== undefined) {
      throw autoDenyError;
    }

    logAutoApprovalIfNeeded(ctx.cwd, sessionId, 'write', permissionSpec, decision);

    if (decision.kind === 'auto-approve') {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const config = getSessionConfig(ctx.cwd, sessionId);

    if (config === undefined) {
      throw new Error('Auto mode internal error: session config is missing.');
    }

    const writeCheck = isWriteAllowed(params.path, ctx.cwd, config);

    if (!writeCheck.allowed) {
      logSrtBlocked(ctx.cwd, sessionId, 'write', permissionSpec, writeCheck.reason);
      const approval = await requestApproval(
        pi,
        ctx.cwd,
        sessionId,
        signal,
        ctx.sessionManager,
        'write',
        permissionSpec,
        writeCheck.reason,
        config,
      );

      if (!approval.approve) {
        throw new Error(`Sandbox blocked: ${approval.reason}`);
      }

      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const sandboxedBase = createWriteToolDefinition(ctx.cwd, {
      operations: createSandboxedWriteOperations(pi, ctx.cwd, signal, config),
    });
    const result = await sandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    logSrtAllowed(ctx.cwd, sessionId, 'write', permissionSpec);
    return result;
  },
});

const createEditOverride = (pi: ExtensionAPI) => ({
  ...createEditToolDefinition(process.cwd()),
  label: 'edit',
  async execute(
    toolCallId: string,
    params: Parameters<ReturnType<typeof createEditToolDefinition>['execute']>[1],
    signal: AbortSignal | undefined,
    onUpdate: Parameters<ReturnType<typeof createEditToolDefinition>['execute']>[3],
    ctx: Parameters<ReturnType<typeof createEditToolDefinition>['execute']>[4],
  ) {
    const sessionId = ctx.sessionManager.getSessionId();
    const unsandboxedBase = createEditToolDefinition(ctx.cwd);

    if (!isAutoModeEnabled(ctx.cwd, sessionId)) {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const { permissionSpec, decision } = createDecision('edit', params, ctx.cwd, sessionId);
    const autoDenyError = createAutoDenyError(ctx.cwd, sessionId, 'edit', permissionSpec, decision);

    if (autoDenyError !== undefined) {
      throw autoDenyError;
    }

    logAutoApprovalIfNeeded(ctx.cwd, sessionId, 'edit', permissionSpec, decision);

    if (decision.kind === 'auto-approve') {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const config = getSessionConfig(ctx.cwd, sessionId);

    if (config === undefined) {
      throw new Error('Auto mode internal error: session config is missing.');
    }

    const writeCheck = isWriteAllowed(params.path, ctx.cwd, config);

    if (!writeCheck.allowed) {
      logSrtBlocked(ctx.cwd, sessionId, 'edit', permissionSpec, writeCheck.reason);
      const approval = await requestApproval(
        pi,
        ctx.cwd,
        sessionId,
        signal,
        ctx.sessionManager,
        'edit',
        permissionSpec,
        writeCheck.reason,
        config,
      );

      if (!approval.approve) {
        throw new Error(`Sandbox blocked: ${approval.reason}`);
      }

      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const sandboxedBase = createEditToolDefinition(ctx.cwd, {
      operations: createSandboxedEditOperations(pi, ctx.cwd, signal, config),
    });
    const result = await sandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    logSrtAllowed(ctx.cwd, sessionId, 'edit', permissionSpec);
    return result;
  },
});

const createBashOverride = (pi: ExtensionAPI) => ({
  ...createBashToolDefinition(process.cwd()),
  label: 'bash',
  async execute(
    toolCallId: string,
    params: { command: string; timeout?: number },
    signal: AbortSignal | undefined,
    onUpdate: Parameters<ReturnType<typeof createBashToolDefinition>['execute']>[3],
    ctx: Parameters<ReturnType<typeof createBashToolDefinition>['execute']>[4],
  ) {
    const sessionId = ctx.sessionManager.getSessionId();
    const unsandboxedBase = createBashToolDefinition(ctx.cwd);

    if (!isAutoModeEnabled(ctx.cwd, sessionId)) {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const { permissionSpec, decision } = createDecision('bash', params, ctx.cwd, sessionId);
    const autoDenyError = createAutoDenyError(ctx.cwd, sessionId, 'bash', permissionSpec, decision);

    if (autoDenyError !== undefined) {
      throw autoDenyError;
    }

    logAutoApprovalIfNeeded(ctx.cwd, sessionId, 'bash', permissionSpec, decision);

    if (decision.kind === 'auto-approve') {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const config = getSessionConfig(ctx.cwd, sessionId);

    if (config === undefined) {
      throw new Error('Auto mode internal error: session config is missing.');
    }

    const blockedToken = getBlockedPathToken(params.command, ctx.cwd, config);
    const networkDecision = evaluateBashNetworkPolicy(params.command, config.allowedDomains);

    if (blockedToken !== undefined) {
      const reason = `command references sandbox-controlled path: ${blockedToken}`;
      logSrtBlocked(ctx.cwd, sessionId, 'bash', permissionSpec, reason);
      const approval = await requestApproval(
        pi,
        ctx.cwd,
        sessionId,
        signal,
        ctx.sessionManager,
        'bash',
        permissionSpec,
        reason,
        config,
      );

      if (!approval.approve) {
        throw new Error(`Sandbox blocked: ${approval.reason}`);
      }

      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    if (networkDecision.kind === 'allow-unsandboxed') {
      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    if (networkDecision.kind === 'requires-approval') {
      logSrtBlocked(ctx.cwd, sessionId, 'bash', permissionSpec, networkDecision.reason);
      const approval = await requestApproval(
        pi,
        ctx.cwd,
        sessionId,
        signal,
        ctx.sessionManager,
        'bash',
        permissionSpec,
        networkDecision.reason,
        config,
      );

      if (!approval.approve) {
        throw new Error(`Sandbox blocked: ${approval.reason}`);
      }

      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }

    const sandboxedBase = createBashToolDefinition(ctx.cwd, {
      operations: createLocalBashOperationsWithSandbox(
        createLocalBashOperations(),
        ctx.cwd,
        signal,
        config,
      ),
    });

    try {
      const sandboxedResult = await sandboxedBase.execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        ctx,
      );
      logSrtAllowed(ctx.cwd, sessionId, 'bash', permissionSpec);
      return sandboxedResult;
    } catch (error) {
      const resultText = error instanceof Error ? error.message : String(error);
      const explicitSandboxError = /Operation not permitted|Connection blocked|sandbox/u.test(
        resultText,
      );

      if (!explicitSandboxError) {
        throw error;
      }

      const reason = resultText.slice(0, 400);

      logSrtBlocked(ctx.cwd, sessionId, 'bash', permissionSpec, reason);
      const approval = await requestApproval(
        pi,
        ctx.cwd,
        sessionId,
        signal,
        ctx.sessionManager,
        'bash',
        permissionSpec,
        reason,
        config,
      );

      if (!approval.approve) {
        throw new Error(`Sandbox blocked: ${approval.reason}`);
      }

      return unsandboxedBase.execute(toolCallId, params, signal, onUpdate, ctx);
    }
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerFlag('auto', {
    description: 'Enable auto mode (automatic tool approval with sandboxing)',
    type: 'boolean',
    default: false,
  });

  pi.registerCommand('auto', {
    description: 'Toggle auto mode for the current session',
    handler: (_args, ctx) => {
      const cwd = ctx.cwd;
      const sessionId = ctx.sessionManager.getSessionId();

      if (isAutoModeEnabled(cwd, sessionId)) {
        disableAutoMode(cwd, sessionId);
        ctx.ui.notify('Auto mode disabled.', 'info');
        return Promise.resolve();
      }

      const config = enableAutoMode(cwd, sessionId);
      const availabilityIssue = getSandboxAvailabilityIssue();

      ctx.ui.notify(
        `Auto mode enabled. Config: ${config.allowTools.length} allowTools, ${config.denyTools.length} denyTools`,
        'info',
      );

      if (availabilityIssue !== undefined) {
        ctx.ui.notify(`Sandbox runtime unavailable: ${availabilityIssue}`, 'warning');
      }

      return Promise.resolve();
    },
  });

  pi.registerCommand('refine-auto-permissions', {
    description:
      'Extract frequent patterns from approval logs and suggest additions to auto config',
    handler: async (_args, ctx) => {
      const logFile = path.join(os.homedir(), '.pi', 'extensions', 'pi-auto', 'approvals.jsonl');

      if (!existsSync(logFile)) {
        ctx.ui.notify('No approval logs found. Run with auto mode first.', 'warning');
        return;
      }

      try {
        const rawText = readFileSync(logFile, 'utf-8');
        const lines = rawText.trim().split('\n').filter(Boolean);
        const entries: Record<string, unknown>[] = [];

        for (const line of lines) {
          const parsed: unknown = JSON.parse(line);

          if (typeof parsed === 'object' && parsed !== null) {
            entries.push(Object.fromEntries(Object.entries(parsed)));
          }
        }

        const approvedPatterns = new Map<string, number>();
        const sandboxAllowedPatterns = new Map<string, number>();

        for (const entry of entries) {
          const decision = entry['decision'];
          const permissionSpec = entry['permissionSpec'];

          if (typeof permissionSpec !== 'string') {
            continue;
          }

          if (decision === 'agent-approve') {
            approvedPatterns.set(permissionSpec, (approvedPatterns.get(permissionSpec) ?? 0) + 1);
          }

          if (decision === 'srt-allowed') {
            sandboxAllowedPatterns.set(
              permissionSpec,
              (sandboxAllowedPatterns.get(permissionSpec) ?? 0) + 1,
            );
          }
        }

        const allPatterns = [
          ...[...approvedPatterns.entries()].map(([spec, count]) => ({
            spec,
            count,
            source: 'agent-approve' as const,
          })),
          ...[...sandboxAllowedPatterns.entries()].map(([spec, count]) => ({
            spec,
            count,
            source: 'srt-allowed' as const,
          })),
        ]
          .filter((entry) => entry.count >= 2)
          .sort((a, b) => b.count - a.count);

        if (allPatterns.length === 0) {
          ctx.ui.notify(
            'No patterns appeared 2+ times. Keep using auto mode to gather more data.',
            'info',
          );
          return;
        }

        const items = allPatterns.map(
          (entry) => `${entry.spec} (${entry.source}: ${entry.count}x)`,
        );
        const selected = await ctx.ui.select(
          'Select patterns to add to allowTools (or Esc to cancel):',
          items,
        );

        if (selected === undefined) {
          return;
        }

        const selectedIndex = items.indexOf(selected);
        const selectedPattern = selectedIndex === -1 ? undefined : allPatterns[selectedIndex];

        if (selectedPattern === undefined) {
          return;
        }

        const config = loadAutoConfig(ctx.cwd);

        if (config.allowTools.includes(selectedPattern.spec)) {
          ctx.ui.notify(`"${selectedPattern.spec}" is already in allowTools.`, 'info');
          return;
        }

        saveAutoConfig(ctx.cwd, {
          ...config,
          allowTools: [...config.allowTools, selectedPattern.spec],
        });

        ctx.ui.notify(
          `Added "${selectedPattern.spec}" to allowTools. Reload or restart auto mode to apply.`,
          'info',
        );
      } catch (error) {
        ctx.ui.notify(
          `Failed to parse approval logs: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    },
  });

  pi.registerTool(createReadOverride(pi));
  pi.registerTool(createWriteOverride(pi));
  pi.registerTool(createEditOverride(pi));
  pi.registerTool(createBashOverride(pi));

  pi.on('session_shutdown', async () => {
    await resetSandboxRuntime();
  });

  pi.on('session_start', (_event, ctx) => {
    if (pi.getFlag('auto') !== true) {
      return;
    }

    const cwd = ctx.cwd;
    const sessionId = ctx.sessionManager.getSessionId();
    const config = enableAutoMode(cwd, sessionId);
    const availabilityIssue = getSandboxAvailabilityIssue();

    ctx.ui.notify(
      `Auto mode enabled via --auto flag. Config: ${config.allowTools.length} allowTools, ${config.denyTools.length} denyTools`,
      'info',
    );

    if (availabilityIssue !== undefined) {
      ctx.ui.notify(`Sandbox runtime unavailable: ${availabilityIssue}`, 'warning');
    }
  });
}
