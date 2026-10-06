import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { buildLoadingSkeleton } from '../../../../src/components/utils/loading-skeleton';

describe('buildLoadingSkeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds one bar per row, in order, tagged with its kind', () => {
    const { root, bars } = buildLoadingSkeleton(['heading', 'paragraph', 'list']);

    expect(bars).toHaveLength(3);
    expect(bars.map(bar => bar.getAttribute(DATA_ATTR.skeletonBar))).toEqual(['heading', 'paragraph', 'list']);
    expect(root.querySelectorAll(`[${DATA_ATTR.skeletonBar}]`)).toHaveLength(3);
  });

  it('is invisible to assistive tech and to input', () => {
    const { root } = buildLoadingSkeleton(['paragraph']);

    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.hasAttribute('inert')).toBe(true);
    expect(root.getAttribute('data-blok-testid')).toBe('loading-skeleton');
    expect(root.hasAttribute(DATA_ATTR.loadingSkeleton)).toBe(true);
  });

  it('gives paragraph bars uneven widths and a per-bar phase index', () => {
    const { bars } = buildLoadingSkeleton(['paragraph', 'paragraph', 'paragraph']);
    const widths = bars.map(bar => bar.style.getPropertyValue('--blok-skeleton-width'));

    expect(new Set(widths).size).toBe(3);
    expect(bars.map(bar => bar.style.getPropertyValue('--blok-skeleton-index'))).toEqual(['0', '1', '2']);
  });

  it('gives a list row a bullet before its bar', () => {
    const { bars } = buildLoadingSkeleton(['list']);

    expect(bars[0].querySelector('[data-blok-skeleton-bullet]')).not.toBeNull();
  });
});
