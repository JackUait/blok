import { describe, it, expect } from 'vitest';
import { twMerge } from '../../../src/components/utils/tw';

describe('twMerge logical (inline-start / inline-end) groups', () => {
  it('keeps a logical border width beside a border color', () => {
    expect(twMerge('border-s-[3px] border-current')).toBe('border-s-[3px] border-current');
  });

  it('resolves conflicts within the same logical side', () => {
    expect(twMerge('ps-7', 'ps-8')).toBe('ps-8');
    expect(twMerge('pe-3', 'pe-4')).toBe('pe-4');
    expect(twMerge('ms-1', 'ms-2')).toBe('ms-2');
    expect(twMerge('me-1', 'me-2')).toBe('me-2');
    expect(twMerge('start-0', 'start-2')).toBe('start-2');
  });

  it('keeps start and end independent of each other', () => {
    expect(twMerge('ps-8 pe-4')).toBe('ps-8 pe-4');
    expect(twMerge('ms-2 me-2')).toBe('ms-2 me-2');
  });
});
