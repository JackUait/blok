import { describe, expect, it, vi } from 'vitest';
import { createPageCover } from './cover';

describe('desktop page cover', () => {
  it('offers a cover, allows replacing it, and allows removing it', () => {
    const change = vi.fn();
    const empty = createPageCover(undefined, change);
    expect(empty.hasAttribute('data-has-cover')).toBe(false);
    empty.querySelector<HTMLButtonElement>('[data-desktop-cover-toggle]')!.click();
    empty.querySelector<HTMLButtonElement>('[data-cover-id="ocean"]')!.click();
    expect(change).toHaveBeenCalledWith('ocean');
    const covered = createPageCover('ocean', change);
    expect(covered.hasAttribute('data-has-cover')).toBe(true);
    covered.querySelector<HTMLButtonElement>('[data-desktop-cover-remove]')!.click();
    expect(change).toHaveBeenCalledWith(undefined);
  });
});
