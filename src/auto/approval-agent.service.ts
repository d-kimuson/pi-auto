import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

type SessionEntryLike = {
  readonly type: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: unknown;
  };
};

type ReadonlySessionManagerLike = {
  getBranch(): SessionEntryLike[];
};

import type { ToolApprovalDecision } from './tool-approval.extension.ts';
import type { AutoConfig } from './types.pure.ts';

export type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly killed: boolean;
};

export type ExecCommand = (
  command: string,
  args: string[],
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal | undefined;
    readonly timeout: number;
  },
) => Promise<ExecResult>;

export type ApprovalRequest = {
  readonly toolName: string;
  readonly permissionSpec: string;
  readonly reason: string;
  readonly userInputs: readonly string[];
  readonly lastAssistantMessage?: string;
  readonly config: AutoConfig;
};

const TOOL_APPROVAL_EXTENSION_PATH = fileURLToPath(
  new URL('./tool-approval.extension.ts', import.meta.url),
);
const TOOL_LIST = 'toolApprove';
const AGENT_TIMEOUT_MS = 2 * 60 * 1000;

const getPiInvocation = (
  args: string[],
): { readonly command: string; readonly args: readonly string[] } => {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith('/$bunfs/root/');

  if (currentScript !== undefined && isBunVirtualScript !== true) {
    return {
      command: process.execPath,
      args: [currentScript, ...args],
    };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);

  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: 'pi', args };
};

const parseToolApprovalDecision = (details: unknown): ToolApprovalDecision | undefined => {
  if (typeof details !== 'object' || details === null || !('approve' in details)) {
    return undefined;
  }

  const record = details as Record<string, unknown>;

  if (record['approve'] === true) {
    if (record['reason'] !== undefined && typeof record['reason'] !== 'string') {
      return undefined;
    }

    return {
      approve: true,
      reason: typeof record['reason'] === 'string' ? record['reason'] : undefined,
    };
  }

  if (record['approve'] === false) {
    if (typeof record['reason'] !== 'string') {
      return undefined;
    }

    return {
      approve: false,
      reason: record['reason'],
    };
  }

  return undefined;
};

const extractDecisionFromEvent = (event: unknown): ToolApprovalDecision | undefined => {
  if (typeof event !== 'object' || event === null || !('type' in event)) {
    return undefined;
  }

  if (
    event.type === 'tool_execution_end' &&
    'toolName' in event &&
    event.toolName === 'toolApprove' &&
    'result' in event &&
    typeof event.result === 'object' &&
    event.result !== null &&
    'details' in event.result
  ) {
    return parseToolApprovalDecision(event.result.details);
  }

  if (
    event.type === 'message_end' &&
    'message' in event &&
    typeof event.message === 'object' &&
    event.message !== null &&
    'role' in event.message &&
    event.message.role === 'toolResult' &&
    'toolName' in event.message &&
    event.message.toolName === 'toolApprove' &&
    'details' in event.message
  ) {
    return parseToolApprovalDecision(event.message.details);
  }

  return undefined;
};

export const extractToolApprovalDecision = (stdout: string): ToolApprovalDecision | undefined => {
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') {
      continue;
    }

    let event: unknown;

    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const decision = extractDecisionFromEvent(event);

    if (decision !== undefined) {
      return decision;
    }
  }

  return undefined;
};

const buildSystemPrompt = (request: ApprovalRequest): string => {
  const configSummary = JSON.stringify(
    {
      denyRead: request.config.denyRead,
      allowWrite: request.config.allowWrite,
      denyWrite: request.config.denyWrite,
      allowedDomains: request.config.allowedDomains,
      allowTools: request.config.allowTools,
      denyTools: request.config.denyTools,
    },
    null,
    2,
  );

  return [
    'You are the pi-auto approval agent.',
    'Your job is to decide whether a sandbox-blocked tool call should be re-run outside the sandbox.',
    'The main session already benefits from mechanical protection by sandbox-runtime. You are the final reviewer for exceptional unsandboxed execution.',
    '',
    'Approval policy:',
    '- Approve only when the blocked execution is necessary to fulfill the user intent and is proportionate to the request.',
    '- Deny when the request appears unrelated to the user intent, excessively invasive, or likely to expose sensitive data without clear necessity.',
    '- Favor the minimum necessary privilege. If the user intent can be satisfied without the blocked access, deny it.',
    '- Do not ask follow-up questions. Decide with the provided context.',
    '- You must call toolApprove exactly once before finishing.',
    '- Use approve=false with a concrete reason when denying.',
    '',
    'User auto-mode configuration:',
    '```json',
    configSummary,
    '```',
  ].join('\n');
};

const buildUserPrompt = (request: ApprovalRequest): string => {
  const userInputs =
    request.userInputs.length === 0 ? '- (none found)' : request.userInputs.join('\n\n---\n\n');
  const lastAssistantMessage =
    request.lastAssistantMessage === undefined || request.lastAssistantMessage.trim() === ''
      ? '(none found)'
      : request.lastAssistantMessage;

  return [
    'sandbox-runtime blocked or constrained a tool call. Decide whether to retry it outside the sandbox.',
    '',
    '## Block reason',
    request.reason,
    '',
    '## Target tool',
    '```',
    request.permissionSpec,
    '```',
    '',
    '## User Inputs',
    userInputs,
    '',
    '## Last Assistant Message',
    lastAssistantMessage,
    '',
    'Call toolApprove exactly once.',
  ].join('\n');
};

const buildResumePrompt = (): string =>
  [
    'You finished without calling toolApprove.',
    'Continue the same approval task and call toolApprove now.',
    'Do not ask questions or continue analysis beyond what is required for the decision.',
  ].join('\n');

const buildAgentArgs = (
  sessionDir: string,
  promptPath: string,
  request: ApprovalRequest,
  continueSession: boolean,
): string[] => {
  const args = [
    '--mode',
    'json',
    '-p',
    '--session-dir',
    sessionDir,
    '--no-context-files',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-extensions',
    '--extension',
    TOOL_APPROVAL_EXTENSION_PATH,
    '--tools',
    TOOL_LIST,
    '--append-system-prompt',
    promptPath,
  ];

  if (continueSession) {
    args.push('--continue', buildResumePrompt());
    return args;
  }

  args.push(buildUserPrompt(request));
  return args;
};

const writePromptToTempFile = async (request: ApprovalRequest): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-auto-approval-prompt-'));
  const filePath = path.join(directory, 'prompt.md');

  await writeFile(filePath, buildSystemPrompt(request), 'utf8');

  return filePath;
};

const removePromptFile = async (promptPath: string): Promise<void> => {
  await unlink(promptPath).catch(() => undefined);
  await rm(path.dirname(promptPath), { recursive: true, force: true }).catch(() => undefined);
};

export const runApprovalAgent = async (
  execCommand: ExecCommand,
  cwd: string,
  signal: AbortSignal | undefined,
  request: ApprovalRequest,
): Promise<ToolApprovalDecision> => {
  const promptPath = await writePromptToTempFile(request);
  const sessionDir = await mkdtemp(path.join(tmpdir(), 'pi-auto-approval-session-'));

  try {
    let continueSession = false;

    for (let attempt = 0; attempt < 4; attempt++) {
      const args = buildAgentArgs(sessionDir, promptPath, request, continueSession);
      const invocation = getPiInvocation(args);
      const result = await execCommand(invocation.command, [...invocation.args], {
        cwd,
        signal,
        timeout: AGENT_TIMEOUT_MS,
      });
      const decision = extractToolApprovalDecision(result.stdout);

      if (decision !== undefined) {
        return decision;
      }

      if (result.code !== 0) {
        const output = result.stderr === '' ? result.stdout : result.stderr;
        throw new Error(
          `pi-auto approval agent failed without a toolApprove decision (exit ${result.code}): ${output}`,
        );
      }

      continueSession = true;
    }

    throw new Error('pi-auto approval agent finished without calling toolApprove after 3 retries.');
  } finally {
    await removePromptFile(promptPath);
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const extractTextParts = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];

  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue;
    }

    const type: unknown = Reflect.get(part, 'type');
    const text: unknown = Reflect.get(part, 'text');

    if (type === 'text' && typeof text === 'string') {
      parts.push(text);
    }
  }

  return parts;
};

const getMessageText = (entry: SessionEntryLike): string | undefined => {
  if (entry.type !== 'message' || entry.message?.content === undefined) {
    return undefined;
  }

  const text = extractTextParts(entry.message.content).join('\n').trim();
  return text === '' ? undefined : text;
};

export const collectApprovalContext = (
  sessionManager: ReadonlySessionManagerLike,
): Pick<ApprovalRequest, 'userInputs' | 'lastAssistantMessage'> => {
  const branch = sessionManager.getBranch();
  const userInputs: string[] = [];
  let lastAssistantMessage: string | undefined;

  for (const entry of branch) {
    if (entry.type !== 'message') {
      continue;
    }

    const text = getMessageText(entry);
    const role = entry.message?.role;

    if (text === undefined || role === undefined) {
      continue;
    }

    if (role === 'user') {
      userInputs.push(text);
      continue;
    }

    if (role === 'assistant') {
      lastAssistantMessage = text;
    }
  }

  return {
    userInputs,
    lastAssistantMessage,
  };
};
