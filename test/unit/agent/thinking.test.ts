import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isThinkingLevel, readThinkingConfig, THINKING_LEVELS } from '../../../src/agent/thinking';

describe('readThinkingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when the host set no thinking', () => {
    expect(readThinkingConfig(undefined)).toBeNull();
  });

  it('starts on the first level when no default is given', () => {
    expect(readThinkingConfig({ levels: ['low', 'high'] })).toEqual({ levels: ['low', 'high'], initial: 'low' });
  });

  it('starts on the default when it is one of the levels', () => {
    expect(readThinkingConfig({ levels: ['off', 'low', 'high'], default: 'high' })).toMatchObject({ initial: 'high' });
  });

  it.each([
    [{ levels: [] }, 'at least one level'],
    [{ levels: ['low', 'turbo'] }, 'unknown level: turbo'],
    [{ levels: ['low', 'low'] }, 'twice'],
    [{ levels: ['low', 'high'], default: 'max' }, 'default must be one of'],
  ])('rejects %j', (thinking, message) => {
    expect(() => readThinkingConfig(thinking as never)).toThrow(TypeError);
    expect(() => readThinkingConfig(thinking as never)).toThrow(message);
  });

  it('keeps the six levels in order', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(isThinkingLevel('xhigh')).toBe(true);
    expect(isThinkingLevel('turbo')).toBe(false);
  });
});
