import { describe, expect, it } from 'vitest';

import { formatAutoModeStatus } from './status-line.service.pure.ts';

describe('formatAutoModeStatus', () => {
  it('returns a fixed status label', () => {
    expect(formatAutoModeStatus()).toBe('auto mode enabled');
  });
});
