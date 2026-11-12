import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { safeImageSrc } from '../../src/shared/sanitize-url';
import { createAddCoverButton, createPageCover, isCoverId, isPageCover, readCoverFile, COVER_GALLERY, COVER_PRESETS, trackPageHeaderHover } from './cover';

describe('desktop page cover', () => {
  it('persists portable gallery assets that both native and web clients can render', () => {
    const presets = COVER_GALLERY.flatMap((group) => group.items);
    const images = presets.filter((preset) => !preset.url.startsWith('data:'));
    expect(images.length).toBeGreaterThan(0);
    for (const preset of presets) expect(safeImageSrc(preset.url)).toBe(preset.url);
    for (const image of images) {
      expect(image.url).toMatch(/^\/(?!\/)/);
      expect(new URL(image.url, 'https://workspace.example/page').pathname)
        .toBe(new URL(image.url, 'tauri://localhost/page').pathname);
      expect(image.url).not.toContain('localhost');
    }
  });

  it('keeps legacy presets and accepts only persistent image sources', () => {
    expect(COVER_PRESETS.length).toBeGreaterThanOrEqual(35);
    expect(isPageCover('dusk')).toBe(true);
    expect(isPageCover('https://example.com/cover.jpg')).toBe(true);
    expect(isPageCover('data:image/png;base64,YQ==')).toBe(true);
    for (const value of ['javascript:alert(1)', 'blob:temporary', 'data:text/html;base64,YQ==', 'unknown']) expect(isPageCover(value)).toBe(false);
  });
  it('switches accessible tabs and applies a direct image link', () => {
    const change = vi.fn();
    const root = createPageCover('dusk', 50, change, vi.fn());
    const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(3);
    tabs[2].click();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('[data-desktop-cover-gallery-viewport]')!.hidden).toBe(true);
    root.querySelector<HTMLInputElement>('input[type="url"]')!.value = 'https://example.com/cover.jpg';
    root.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    expect(change).toHaveBeenCalledWith('https://example.com/cover.jpg');
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });
  it('keeps the same picker and form values through repeated tab clicks', () => {
    const root = createPageCover('dusk', 50, vi.fn(), vi.fn());
    document.body.append(root);
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    trigger.click();
    const gallery = root.querySelector<HTMLElement>('[data-desktop-cover-gallery]')!;
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const input = root.querySelector<HTMLInputElement>('input[type="url"]')!;
    input.value = 'https://example.test/cover.png';
    for (const index of [1, 2, 0, 2, 1, 0]) {
      tabs[index].focus();
      tabs[index].click();
      tabs[index].click();
      expect(gallery.hidden).toBe(false);
      expect(root.querySelector('[data-desktop-cover-gallery]')).toBe(gallery);
      expect(input.value).toBe('https://example.test/cover.png');
      expect(document.activeElement).toBe(tabs[index]);
    }
    root.remove();
  });

  it('reads image uploads and rejects unsupported or oversized files', async () => {
    await expect(readCoverFile(new File(['a'], 'cover.png', {type: 'image/png'}))).resolves.toBe('data:image/png;base64,YQ==');
    await expect(readCoverFile(new File(['a'], 'cover.svg', {type: 'image/svg+xml'}))).rejects.toThrow('PNG');
    await expect(readCoverFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'cover.png', {type: 'image/png'}))).rejects.toThrow('5 Mo');
  });
  it('uploads through the workspace and renders the resolved private URL', async () => {
    const change = vi.fn();
    const upload = vi.fn().mockResolvedValue('https://example.com/files/cover.png');
    const resolveUrl = vi.fn().mockResolvedValue('https://example.com/files/old.png?grant=signed');
    const root = createPageCover('https://example.com/files/old.png', 30, change, vi.fn(), {upload, resolveUrl});
    await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-desktop-cover-image]')!.style.backgroundImage).toContain('grant=signed'));
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {value: [new File(['a'], 'cover.png', {type: 'image/png'})]});
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(change).toHaveBeenCalledWith('https://example.com/files/cover.png'));
    expect(upload).toHaveBeenCalledWith('data:image/png;base64,YQ==');
  });
  it('shows upload errors and hides controls from viewers', async () => {
    const change = vi.fn();
    const root = createPageCover('dusk', 50, change, vi.fn(), {upload: vi.fn().mockRejectedValue(new Error('Connexion perdue'))});
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {value: [new File(['a'], 'cover.png', {type: 'image/png'})]});
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.textContent).toContain('Connexion perdue'));
    expect(change).not.toHaveBeenCalled();
    expect(createPageCover('dusk', 50, change, vi.fn(), {readOnly: true}).querySelector('[data-desktop-cover-actions]')).toBeNull();
  });

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
