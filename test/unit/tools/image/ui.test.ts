import { describe, it, expect } from 'vitest';
import { renderImage, renderCaption, openLightbox } from '../../../../src/tools/image/ui';

describe('renderImage', () => {
  it('returns figure with <img> carrying url, alt, and width style', () => {
    const fig = renderImage({ url: 'https://x/y.png', alt: 'photo', width: 60, alignment: 'center' });
    const img = fig.querySelector('img');
    expect(img).not.toBeNull();
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
    expect(img.getAttribute('alt')).toBe('photo');
    expect(img.style.width).toBe('60%');
  });

  it('defaults width to 100% when omitted', () => {
    const fig = renderImage({ url: 'https://x/y.png' });
    const img = fig.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.style.width).toBe('100%');
  });

  it('applies alignment via wrapper justify-content', () => {
    const fig = renderImage({ url: 'u', alignment: 'right' });
    expect(fig.style.justifyContent).toBe('flex-end');
  });

  it('renders alt as empty string when missing', () => {
    const fig = renderImage({ url: 'u' });
    const img = fig.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('alt')).toBe('');
  });
});

describe('renderCaption', () => {
  it('returns a contenteditable element with placeholder attribute', () => {
    const el = renderCaption({ value: '', placeholder: 'Write a caption…', readOnly: false });
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(el.getAttribute('data-placeholder')).toBe('Write a caption…');
    expect(el.textContent).toBe('');
  });

  it('renders text and respects readOnly by setting contenteditable=false', () => {
    const el = renderCaption({ value: 'hello', placeholder: 'p', readOnly: true });
    expect(el.textContent).toBe('hello');
    expect(el.getAttribute('contenteditable')).toBe('false');
  });
});

describe('openLightbox', () => {
  it('appends a dialog to document.body and removes it on close', () => {
    const close = openLightbox({ url: 'https://x/y.png', alt: 'pic' });
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error('dialog missing');
    const img = dialog.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
    expect(img.getAttribute('alt')).toBe('pic');
    close();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });

  it('closes on Escape key', () => {
    openLightbox({ url: 'u' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });

  it('closes on backdrop click', () => {
    openLightbox({ url: 'u' });
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!(dialog instanceof HTMLElement)) throw new Error('dialog missing');
    dialog.click();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });
});

import { renderOverlay } from '../../../../src/tools/image/ui';
import { vi } from 'vitest';

describe('renderOverlay', () => {
  it('exposes data-action buttons for each command', () => {
    const overlay = renderOverlay({
      onAlign: () => undefined,
      onReplace: () => undefined,
      onAlt: () => undefined,
      onDelete: () => undefined,
      onDownload: () => undefined,
      onFullscreen: () => undefined,
    });
    expect(overlay.querySelector('[data-action="align"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="alt"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="delete"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="download"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="fullscreen"]')).not.toBeNull();
  });

  it('invokes the matching handler on click', () => {
    const onAlign = vi.fn();
    const overlay = renderOverlay({
      onAlign,
      onReplace: () => undefined,
      onAlt: () => undefined,
      onDelete: () => undefined,
      onDownload: () => undefined,
      onFullscreen: () => undefined,
    });
    const btn = overlay.querySelector<HTMLButtonElement>('[data-action="align"]');
    if (!btn) throw new Error('align missing');
    btn.click();
    expect(onAlign).toHaveBeenCalled();
  });
});
