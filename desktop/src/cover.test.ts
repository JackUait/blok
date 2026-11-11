import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { createAddCoverButton, createPageCover, isCoverId, trackPageHeaderHover } from './cover';

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

  /**
   * The desktop re-appends its button whenever the core rebuilds the icon row
   * (workspace.ts watches it with a MutationObserver). WebKit — the engine behind
   * the packaged Tauri window — never delivers the matching `mouseleave` for a node
   * moved under the cursor, so a CSS `:hover` on the header stayed latched and
   * "Ajouter une couverture" never left. The core's own add-icon button is never
   * moved, which is why only the cover one stuck. Delegation on the document
   * survives the node being replaced; `:hover` does not.
   */
  it('drops the header hover flag even when the button is re-inserted under the cursor', () => {
    const header = document.createElement('div');
    header.setAttribute('data-blok-page-header', '');
    const row = document.createElement('div');
    header.append(row);
    document.body.append(header);
    const stop = trackPageHeaderHover(document);

    let button = createAddCoverButton(() => {});
    row.append(button);
    button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(header.hasAttribute('data-desktop-header-hover')).toBe(true);

    // The core rebuilds the row; workspace.ts re-appends the button.
    button.remove();
    button = createAddCoverButton(() => {});
    row.append(button);

    const outside = document.createElement('p');
    document.body.append(outside);
    button.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: outside }));
    expect(header.hasAttribute('data-desktop-header-hover')).toBe(false);

    stop();
    header.remove();
    outside.remove();
  });

  /**
   * WKWebView — the engine behind the packaged Tauri window — left the button's
   * pixels on screen after its opacity reached 0: the computed style read
   * `opacity: 0` while the button was still painted, so no amount of fixing the
   * style helped. `visibility` moves the element out of the painted tree instead
   * of merely making it transparent, which forces the repaint; it also stops a
   * fully transparent button from swallowing clicks.
   */
  it('hides the add-cover button from the painted tree, not just by opacity', () => {
    const css = readFileSync(join(process.cwd(), 'src/shell.css'), 'utf8');
    const base = css.match(/\[data-desktop-add-cover\]\s*\{[^}]*\}/)?.[0] ?? '';
    const shown = css.match(/^[^\n]*\[data-desktop-header-hover\][^{]*\{[^}]*\}/m)?.[0] ?? '';

    expect(base).toMatch(/visibility:\s*hidden/);
    expect(shown).toMatch(/visibility:\s*visible/);
  });
});
