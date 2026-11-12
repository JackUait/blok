import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ERROR_SCENES, pickErrorScene } from '../../../../../src/tools/audio/error-scenes/pick';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pickErrorScene', () => {
  it('offers the four objects the error card can show', () => {
    expect([...ERROR_SCENES].sort()).toEqual(['ink-burst', 'pulled-plug', 'sand', 'shattered']);
  });

  it('never shows the same object twice in a row', () => {
    const picks = Array.from({ length: 200 }, () => pickErrorScene());
    const repeats = picks.filter((name, i) => i > 0 && name === picks[i - 1]);

    expect(repeats).toEqual([]);
  });

  it('reaches every object', () => {
    const picks = new Set(Array.from({ length: 200 }, () => pickErrorScene()));

    expect([...picks].sort()).toEqual([...ERROR_SCENES].sort());
  });

  it('follows the random source it is given', () => {
    const first = pickErrorScene(() => 0);
    const low = pickErrorScene(() => 0);
    const high = pickErrorScene(() => 0.999);
    const rest = ERROR_SCENES.filter((name) => name !== low);

    expect(low).toBe(ERROR_SCENES.filter((name) => name !== first)[0]);
    expect(high).toBe(rest[rest.length - 1]);
  });
});
