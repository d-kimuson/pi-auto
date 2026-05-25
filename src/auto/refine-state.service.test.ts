import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRefineState, saveRefineState } from './refine-state.service.ts';

const testDir = path.join(tmpdir(), `pi-auto-refine-state-test-${Date.now()}`);
const stateFile = path.join(testDir, 'refine-state.json');

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadRefineState', () => {
  it('returns empty state when file does not exist', () => {
    expect(loadRefineState(stateFile)).toEqual({});
  });

  it('loads lastRefinedAt', () => {
    writeFileSync(
      stateFile,
      JSON.stringify({ lastRefinedAt: '2026-05-24T00:00:00.000Z' }),
      'utf-8',
    );
    expect(loadRefineState(stateFile)).toEqual({ lastRefinedAt: '2026-05-24T00:00:00.000Z' });
  });
});

describe('saveRefineState', () => {
  it('writes state file', () => {
    saveRefineState({ lastRefinedAt: '2026-05-24T00:00:00.000Z' }, stateFile);

    const raw: unknown = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(raw).toEqual({ lastRefinedAt: '2026-05-24T00:00:00.000Z' });
  });
});
