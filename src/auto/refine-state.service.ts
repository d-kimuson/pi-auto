import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getPiAutoDataDir } from './approval-logger.service.ts';

export type RefineState = {
  readonly lastRefinedAt?: string;
};

export const getRefineStateFile = (): string => path.join(getPiAutoDataDir(), 'refine-state.json');

export const loadRefineState = (filePath: string = getRefineStateFile()): RefineState => {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));

    if (typeof value !== 'object' || value === null) {
      return {};
    }

    const lastRefinedAt: unknown = Reflect.get(value, 'lastRefinedAt');

    return {
      lastRefinedAt: typeof lastRefinedAt === 'string' ? lastRefinedAt : undefined,
    };
  } catch {
    return {};
  }
};

export const saveRefineState = (
  state: RefineState,
  filePath: string = getRefineStateFile(),
): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
};
