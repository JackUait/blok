import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  /**
   * The button is painted by the page header's hover alone. WebKit — the engine
   * behind the packaged Tauri window — also matches `:focus-visible` on a button
   * after a plain mouse click, so an unguarded `:focus-visible` left "Ajouter une
   * couverture" on screen, with its hover fill, long after the pointer had gone.
   * Blok's own page-title.css already guards its focus ring the same way.
   */
  it('reveals the add-cover button on keyboard focus only, never after a pointer click', () => {
    const css = readFileSync(join(process.cwd(), 'src/shell.css'), 'utf8');
    const reveal = css.match(/^[^\n]*\[data-desktop-add-cover\]:focus-visible[^{]*\{[^}]*opacity:\s*1[^}]*\}/m)?.[0] ?? '';
    const fill = css.match(/^[^\n]*\[data-desktop-add-cover\]:focus-visible[^{]*\{[^}]*background:[^}]*\}/m)?.[0] ?? '';

    expect(reveal).toMatch(/:root:not\(\[data-blok-modality="pointer"\]\)/);
    expect(fill).toMatch(/:root:not\(\[data-blok-modality="pointer"\]\)/);
  });
});
