import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getUnixTime } from '../../../../../src/components/modules/yjs/clock';

describe('getUnixTime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads the real clock', () => {
    const before = Date.now();
    const now = getUnixTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('keeps reading the real clock under fake timers, like the clock y-protocols stamps awareness with', () => {
    const realBefore = Date.now();

    vi.useFakeTimers();
    vi.setSystemTime(0);

    expect(Date.now(), 'fake timers did not take over Date').toBe(0);
    expect(getUnixTime()).toBeGreaterThanOrEqual(realBefore);
  });
});
