import type {
  BashOperations,
  EditOperations,
  ReadOperations,
  WriteOperations,
  ExtensionAPI,
} from '@earendil-works/pi-coding-agent';

type ExecCapableExtensionApi = Pick<ExtensionAPI, 'exec'>;

import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AutoConfig } from './types.pure.ts';

import { buildSrtConfig } from './sandbox-config.service.pure.ts';
import {
  cleanupSandboxRuntimeAfterCommand,
  wrapCommandWithSandbox,
} from './sandbox-runtime.service.ts';

const HELPER_PATH = fileURLToPath(new URL('./sandbox-fs-helper.mjs', import.meta.url));

type FsHelperRequest =
  | { readonly op: 'access'; readonly path: string; readonly mode: 'read' | 'readWrite' }
  | { readonly op: 'readFile'; readonly path: string }
  | { readonly op: 'mkdir'; readonly path: string }
  | { readonly op: 'writeFile'; readonly path: string; readonly content: string };

type FsHelperSuccess = { readonly ok: true; readonly base64?: string };
type FsHelperFailure = {
  readonly ok: false;
  readonly error: { readonly message: string; readonly code: string };
};
type FsHelperResponse = FsHelperSuccess | FsHelperFailure;

const parseFsHelperResponse = (text: string): FsHelperResponse => {
  const value: unknown = JSON.parse(text);

  if (typeof value !== 'object' || value === null || !('ok' in value)) {
    throw new Error('Sandbox FS helper returned invalid JSON');
  }

  const ok: unknown = Reflect.get(value, 'ok');

  if (ok === true) {
    const base64: unknown = Reflect.get(value, 'base64');
    return {
      ok: true,
      base64: typeof base64 === 'string' ? base64 : undefined,
    };
  }

  if (ok === false) {
    const errorValue: unknown = Reflect.get(value, 'error');
    const messageValue: unknown =
      typeof errorValue === 'object' && errorValue !== null
        ? Reflect.get(errorValue, 'message')
        : undefined;
    const codeValue: unknown =
      typeof errorValue === 'object' && errorValue !== null
        ? Reflect.get(errorValue, 'code')
        : undefined;
    const message = typeof messageValue === 'string' ? messageValue : 'Sandbox FS helper failed';
    const code = typeof codeValue === 'string' ? codeValue : 'ERR_HELPER';

    return {
      ok: false,
      error: { message, code },
    };
  }

  throw new Error('Sandbox FS helper returned invalid JSON');
};
const toError = (failure: FsHelperFailure): Error => {
  const error = new Error(failure.error.message) as Error & { code?: string };
  error.code = failure.error.code;
  return error;
};

const escapeShellArg = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const runSandboxedRequest = async (
  pi: ExecCapableExtensionApi,
  cwd: string,
  signal: AbortSignal | undefined,
  config: AutoConfig,
  request: FsHelperRequest,
): Promise<FsHelperResponse> => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-auto-sandbox-fs-'));
  const requestPath = path.join(tempDir, 'request.json');

  let cleanupNeeded = false;

  try {
    await writeFile(requestPath, JSON.stringify(request), 'utf8');
    const command = `${escapeShellArg(process.execPath)} ${escapeShellArg(HELPER_PATH)} ${escapeShellArg(requestPath)}`;
    const wrappedCommand = await wrapCommandWithSandbox(
      command,
      buildSrtConfig(cwd, config),
      signal,
    );
    cleanupNeeded = true;
    const result = await pi.exec('bash', ['-lc', wrappedCommand], {
      cwd,
      signal,
      timeout: 60_000,
    });

    if (result.code !== 0) {
      throw new Error(result.stderr === '' ? result.stdout : result.stderr);
    }

    return parseFsHelperResponse(result.stdout);
  } finally {
    if (cleanupNeeded) {
      cleanupSandboxRuntimeAfterCommand();
    }

    await unlink(requestPath).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const createSandboxedReadOperations = (
  pi: ExecCapableExtensionApi,
  cwd: string,
  signal: AbortSignal | undefined,
  config: AutoConfig,
): ReadOperations => ({
  async access(absolutePath) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'access',
      path: absolutePath,
      mode: 'read',
    });

    if (!result.ok) {
      throw toError(result);
    }
  },

  async readFile(absolutePath) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'readFile',
      path: absolutePath,
    });

    if (!result.ok) {
      throw toError(result);
    }

    return Buffer.from(result.base64 ?? '', 'base64');
  },
});

export const createSandboxedWriteOperations = (
  pi: ExecCapableExtensionApi,
  cwd: string,
  signal: AbortSignal | undefined,
  config: AutoConfig,
): WriteOperations => ({
  async mkdir(dir) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'mkdir',
      path: dir,
    });

    if (!result.ok) {
      throw toError(result);
    }
  },

  async writeFile(absolutePath, content) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'writeFile',
      path: absolutePath,
      content,
    });

    if (!result.ok) {
      throw toError(result);
    }
  },
});

export const createSandboxedEditOperations = (
  pi: ExecCapableExtensionApi,
  cwd: string,
  signal: AbortSignal | undefined,
  config: AutoConfig,
): EditOperations => ({
  async access(absolutePath) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'access',
      path: absolutePath,
      mode: 'readWrite',
    });

    if (!result.ok) {
      throw toError(result);
    }
  },

  async readFile(absolutePath) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'readFile',
      path: absolutePath,
    });

    if (!result.ok) {
      throw toError(result);
    }

    return Buffer.from(result.base64 ?? '', 'base64');
  },

  async writeFile(absolutePath, content) {
    const result = await runSandboxedRequest(pi, cwd, signal, config, {
      op: 'writeFile',
      path: absolutePath,
      content,
    });

    if (!result.ok) {
      throw toError(result);
    }
  },
});

export const createLocalBashOperationsWithSandbox = (
  localOperations: BashOperations,
  cwd: string,
  signal: AbortSignal | undefined,
  config: AutoConfig,
): BashOperations => ({
  async exec(command, execCwd, options) {
    const wrappedCommand = await wrapCommandWithSandbox(
      command,
      buildSrtConfig(cwd, config),
      signal,
    );

    try {
      return await localOperations.exec(wrappedCommand, execCwd, options);
    } finally {
      cleanupSandboxRuntimeAfterCommand();
    }
  },
});
