import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

const getConfigDir = (cwd: string): string => path.join(cwd, '.pi', 'agent');
const getConfigFile = (cwd: string): string => path.join(getConfigDir(cwd), 'settings.json');
const getLegacyConfigFile = (cwd: string): string => path.join(cwd, '.pi', 'auto.json');

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

  if (typeof raw !== 'object' || raw === null || !('auto' in raw)) {
    return undefined;
  }

  const auto = raw.auto;

  if (!isAutoConfig(auto)) {
    return undefined;
  }

  return parseAutoConfig(auto);
};

const loadFromLegacyFile = (cwd: string): AutoConfig | undefined => {
  const raw = readJsonFile(getLegacyConfigFile(cwd));

  if (!isAutoConfig(raw)) {
    return undefined;
  }

  return parseAutoConfig(raw);
};

export const loadAutoConfig = (cwd: string): AutoConfig => {
  const fromSettings = loadFromSettingsFile(cwd);

  if (fromSettings !== undefined) {
    return fromSettings;
  }

  const fromLegacy = loadFromLegacyFile(cwd);

  if (fromLegacy !== undefined) {
    return fromLegacy;
  }

  return { ...DEFAULT_AUTO_CONFIG };
};

export const saveAutoConfig = (cwd: string, config: AutoConfig): void => {
  const dir = getConfigDir(cwd);
  mkdirSync(dir, { recursive: true });

  const rawSettings = readJsonFile(getConfigFile(cwd));
  const settings =
    typeof rawSettings === 'object' && rawSettings !== null ? { ...rawSettings } : {};

  writeFileSync(
    getConfigFile(cwd),
    JSON.stringify(
      {
        ...settings,
        auto: config,
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
