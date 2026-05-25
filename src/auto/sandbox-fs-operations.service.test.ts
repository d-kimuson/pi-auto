import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./sandbox-runtime.service.ts', () => ({
  wrapCommandWithSandbox: vi.fn((command: string) => Promise.resolve(`wrapped:${command}`)),
  cleanupSandboxRuntimeAfterCommand: vi.fn(),
}));

type ExecCapableExtensionApi = {
  exec: (
    command: string,
    args: string[],
    options?: object,
  ) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
    killed: boolean;
  }>;
};

import {
  createLocalBashOperationsWithSandbox,
  createSandboxedReadOperations,
} from './sandbox-fs-operations.service.ts';
import {
  cleanupSandboxRuntimeAfterCommand,
  wrapCommandWithSandbox,
} from './sandbox-runtime.service.ts';
import { DEFAULT_AUTO_CONFIG } from './types.pure.ts';

const mockedWrap = vi.mocked(wrapCommandWithSandbox);
const mockedCleanup = vi.mocked(cleanupSandboxRuntimeAfterCommand);

describe('sandbox fs operations cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleans up after sandboxed fs helper success', async () => {
    const pi: ExecCapableExtensionApi = {
      exec: vi.fn(() =>
        Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ ok: true, base64: 'aGk=' }),
          stderr: '',
          killed: false,
        }),
      ),
    };

    const operations = createSandboxedReadOperations(pi, '/repo', undefined, DEFAULT_AUTO_CONFIG);
    const result = await operations.readFile('/repo/file.txt');

    expect(result.toString('utf8')).toBe('hi');
    expect(mockedWrap).toHaveBeenCalledTimes(1);
    expect(mockedCleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up after sandboxed fs helper failure', async () => {
    const pi: ExecCapableExtensionApi = {
      exec: vi.fn(() => Promise.resolve({ code: 1, stdout: '', stderr: 'boom', killed: false })),
    };

    const operations = createSandboxedReadOperations(pi, '/repo', undefined, DEFAULT_AUTO_CONFIG);

    await expect(operations.readFile('/repo/file.txt')).rejects.toThrow('boom');
    expect(mockedCleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up after sandboxed bash success', async () => {
    const localOperations = {
      exec: vi.fn(() => Promise.resolve({ exitCode: 0 })),
    };

    const operations = createLocalBashOperationsWithSandbox(
      localOperations,
      '/repo',
      undefined,
      DEFAULT_AUTO_CONFIG,
    );

    await operations.exec('echo hi', '/repo', { onData: () => undefined });

    expect(localOperations.exec).toHaveBeenCalledWith(
      'wrapped:echo hi',
      '/repo',
      expect.any(Object),
    );
    expect(mockedCleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up after sandboxed bash failure', async () => {
    const localOperations = {
      exec: vi.fn(() => Promise.reject(new Error('exec failed'))),
    };

    const operations = createLocalBashOperationsWithSandbox(
      localOperations,
      '/repo',
      undefined,
      DEFAULT_AUTO_CONFIG,
    );

    await expect(operations.exec('echo hi', '/repo', { onData: () => undefined })).rejects.toThrow(
      'exec failed',
    );
    expect(mockedCleanup).toHaveBeenCalledTimes(1);
  });
});
