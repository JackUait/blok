import { describe, it, expect } from 'vitest';
import { twMerge } from '../../../src/components/utils/tw';

describe('twMerge gap conflict groups', () => {
  it('keeps axis-specific gaps independent of each other', () => {
    expect(twMerge('gap-x-0.5 gap-y-0.5')).toBe('gap-x-0.5 gap-y-0.5');
  });

  it('resolves conflicts within the same gap axis', () => {
    expect(twMerge('gap-x-1', 'gap-x-2')).toBe('gap-x-2');
    expect(twMerge('gap-y-1', 'gap-y-2')).toBe('gap-y-2');
  });

  it('resolves conflicts between all-axis gaps', () => {
    expect(twMerge('gap-1', 'gap-2')).toBe('gap-2');
  });
});
