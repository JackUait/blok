import { describe, expect, it, vi } from 'vitest';
import { createAddCoverButton, createPageCover, isCoverId } from './cover';

describe('desktop page cover', () => {
  it('offers a cover, allows replacing it, and allows removing it', () => {
    const change = vi.fn();
    const position = vi.fn();
    createAddCoverButton(change).click();
    expect(change).toHaveBeenCalledWith('dusk');
    const covered = createPageCover('dusk', 50, change, position);
    [...covered.querySelectorAll<HTMLButtonElement>('[data-desktop-cover-actions] > button')]
      .find((button) => button.textContent === 'Changer la couverture')!.click();
    covered.querySelector<HTMLButtonElement>('[data-cover-id="ocean"]')!.click();
    expect(change).toHaveBeenCalledWith('ocean');
    expect(isCoverId('met-great-wave')).toBe(true);
    covered.querySelector<HTMLButtonElement>('[data-cover-id="met-great-wave"]')!.click();
    expect(change).toHaveBeenCalledWith('met-great-wave');
    covered.querySelector<HTMLButtonElement>('[data-desktop-cover-gallery-head] button')!.click();
    expect(change).toHaveBeenCalledWith(undefined);
    [...covered.querySelectorAll<HTMLButtonElement>('[data-desktop-cover-actions] > button')]
      .find((button) => button.textContent === 'Repositionner')!.click();
    covered.querySelector<HTMLElement>('[data-desktop-cover-drag]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    [...covered.querySelectorAll<HTMLButtonElement>('[data-desktop-cover-actions] > button')]
      .find((button) => button.textContent === 'Enregistrer la position')!.click();
    expect(position).toHaveBeenCalledWith(55);
  });
});
