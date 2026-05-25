import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

const getConfigDir = (cwd: string): string => path.join(cwd, '.pi', 'agent');
const getConfigFile = (cwd: string): string => path.join(getConfigDir(cwd), 'settings.json');
const AUTO_SETTINGS_KEY = 'auto';

const readStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

const getObjectField = (value: object, key: string): unknown => Reflect.get(value, key);

const isAutoConfig = (value: unknown): value is AutoConfig => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    Array.isArray(getObjectField(value, 'denyRead')) &&
    Array.isArray(getObjectField(value, 'allowWrite')) &&
    Array.isArray(getObjectField(value, 'denyWrite')) &&
    Array.isArray(getObjectField(value, 'allowedDomains')) &&
    Array.isArray(getObjectField(value, 'allowTools')) &&
    Array.isArray(getObjectField(value, 'denyTools'))
  );
};

const parseAutoConfig = (raw: object): AutoConfig => ({
  denyRead: readStringArray(getObjectField(raw, 'denyRead')),
  allowWrite: readStringArray(getObjectField(raw, 'allowWrite')),
  denyWrite: readStringArray(getObjectField(raw, 'denyWrite')),
  allowedDomains: readStringArray(getObjectField(raw, 'allowedDomains')),
  allowTools: readStringArray(getObjectField(raw, 'allowTools')),
  denyTools: readStringArray(getObjectField(raw, 'denyTools')),
});

const readJsonFile = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
};

const loadFromSettingsFile = (cwd: string): AutoConfig | undefined => {
  const raw = readJsonFile(getConfigFile(cwd));

  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }

  const section = getObjectField(raw, AUTO_SETTINGS_KEY);

  if (!isAutoConfig(section)) {
    return undefined;
  }

  return parseAutoConfig(section);
};

export const loadAutoConfig = (cwd: string): AutoConfig =>
  loadFromSettingsFile(cwd) ?? { ...DEFAULT_AUTO_CONFIG };

export const saveAutoConfig = (cwd: string, config: AutoConfig): void => {
  const dir = getConfigDir(cwd);
  mkdirSync(dir, { recursive: true });

  const rawSettings = readJsonFile(getConfigFile(cwd));
  const settings: Record<string, unknown> =
    typeof rawSettings === 'object' && rawSettings !== null
      ? Object.fromEntries(Object.entries(rawSettings))
      : {};

  writeFileSync(
    getConfigFile(cwd),
    JSON.stringify(
      {
        ...settings,
        [AUTO_SETTINGS_KEY]: config,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
};

export const mergeAutoConfig = (base: AutoConfig, overrides: Partial<AutoConfig>): AutoConfig => ({
  denyRead: overrides.denyRead ?? base.denyRead,
  allowWrite: overrides.allowWrite ?? base.allowWrite,
  denyWrite: overrides.denyWrite ?? base.denyWrite,
  allowedDomains: overrides.allowedDomains ?? base.allowedDomains,
  allowTools: overrides.allowTools ?? base.allowTools,
  denyTools: overrides.denyTools ?? base.denyTools,
});
