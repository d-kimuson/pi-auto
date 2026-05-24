import {
  SandboxManager,
  type SandboxRuntimeConfig,
  type SandboxDependencyCheck,
} from '@anthropic-ai/sandbox-runtime';

const serializeConfig = (config: SandboxRuntimeConfig): string => JSON.stringify(config);

let currentConfigKey: string | undefined;

export const getSandboxDependencyCheck = (): SandboxDependencyCheck =>
  SandboxManager.checkDependencies();

export const getSandboxAvailabilityIssue = (): string | undefined => {
  if (!SandboxManager.isSupportedPlatform()) {
    return 'Sandbox runtime is not supported on this platform.';
  }

  const dependencyCheck = getSandboxDependencyCheck();

  if (dependencyCheck.errors.length > 0) {
    return `Sandbox runtime dependencies are unavailable: ${dependencyCheck.errors.join(', ')}`;
  }

  return undefined;
};

export const ensureSandboxRuntime = async (config: SandboxRuntimeConfig): Promise<void> => {
  const issue = getSandboxAvailabilityIssue();

  if (issue !== undefined) {
    throw new Error(issue);
  }

  const nextConfigKey = serializeConfig(config);

  if (SandboxManager.getConfig() === undefined) {
    await SandboxManager.initialize(config);
    currentConfigKey = nextConfigKey;
    return;
  }

  if (currentConfigKey !== nextConfigKey) {
    SandboxManager.updateConfig(config);
    currentConfigKey = nextConfigKey;
  }
};

export const wrapCommandWithSandbox = async (
  command: string,
  config: SandboxRuntimeConfig,
  abortSignal?: AbortSignal,
): Promise<string> => {
  await ensureSandboxRuntime(config);
  return SandboxManager.wrapWithSandbox(command, undefined, config, abortSignal);
};

export const cleanupSandboxRuntimeAfterCommand = (): void => {
  SandboxManager.cleanupAfterCommand();
};

export const resetSandboxRuntime = async (): Promise<void> => {
  currentConfigKey = undefined;
  await SandboxManager.reset();
};
