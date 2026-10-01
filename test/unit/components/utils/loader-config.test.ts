import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SKELETON, resolveLoaderConfig } from '../../../../src/components/utils/loader-config';

describe('resolveLoaderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is on with the default skeleton and 150ms delay when omitted', () => {
    expect(resolveLoaderConfig(undefined)).toEqual({ enabled: true, skeleton: DEFAULT_SKELETON, delay: 150 });
    expect(DEFAULT_SKELETON).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'list', 'list']);
  });

  it('is off for false', () => {
    expect(resolveLoaderConfig(false).enabled).toBe(false);
  });

  it('takes a custom skeleton and delay', () => {
    expect(resolveLoaderConfig({ skeleton: ['paragraph'], delay: 0 })).toEqual({ enabled: true, skeleton: ['paragraph'], delay: 0 });
  });

  it('falls back to defaults for an empty skeleton, unknown rows and bad delays', () => {
    const resolved = resolveLoaderConfig({ skeleton: [], delay: -5 });

    expect(resolved.skeleton).toEqual(DEFAULT_SKELETON);
    expect(resolved.delay).toBe(150);
    // A JS host can pass anything; unknown rows are dropped, not rendered as blanks.
    expect(resolveLoaderConfig({ skeleton: ['list', 'video' as 'list'] }).skeleton).toEqual(['list']);
    expect(resolveLoaderConfig({ delay: Number.NaN }).delay).toBe(150);
  });
});
