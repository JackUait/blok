/**
 * The row page Favorite star (research/22 §14: Notion's `star` and `starFill`).
 * Favorited fills the star; both share one outline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconEmojiStar, IconStarFilled } from '../../../../src/components/icons';

const paths = (markup: string): Array<{ d: string; fill: string | null }> =>
  [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('path')]
    .map((path) => ({ d: path.getAttribute('d') ?? '', fill: path.getAttribute('fill') }));

describe('star icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fills the outline star\'s own path, so both states share one silhouette', () => {
    const outline = paths(IconEmojiStar);
    const filled = paths(IconStarFilled);

    expect(outline).toHaveLength(1);
    expect(outline[0].fill).toBeNull();
    expect(filled).toEqual([{ d: outline[0].d, fill: 'currentColor' }]);
  });
});
