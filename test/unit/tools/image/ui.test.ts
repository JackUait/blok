import { describe, it, expect } from 'vitest';
import { renderImage, renderCaption, openLightbox } from '../../../../src/tools/image/ui';

describe('renderImage', () => {
  it('returns figure with <img> carrying url and alt; width is set on figure so container fits image', () => {
    const fig = renderImage({ url: 'https://x/y.png', alt: 'photo', width: 60, alignment: 'center' });
    const img = fig.querySelector('img');
    expect(img).not.toBeNull();
    if (!img) throw new Error('img missing');
    expect(img.getAttribute('src')).toBe('https://x/y.png');
    expect(img.getAttribute('alt')).toBe('photo');
    expect(fig.style.width).toBe('60%');
    expect(img.style.width).toBe('');
  });

  it('omits inline figure width when omitted so CSS size preset applies', () => {
    const fig = renderImage({ url: 'https://x/y.png' });
    const img = fig.querySelector('img');
    if (!img) throw new Error('img missing');
    expect(fig.style.width).toBe('');
    expect(img.style.width).toBe('');
  });

  it('sets text-align on figure per alignment so caption inherits and aligns with image', () => {
    expect(renderImage({ url: 'u', alignment: 'left' }).style.textAlign).toBe('left');
    expect(renderImage({ url: 'u', alignment: 'center' }).style.textAlign).toBe('center');
    expect(renderImage({ url: 'u', alignment: 'right' }).style.textAlign).toBe('right');
  });

  it('does not force display:flex on figure (CSS inline-block shifts figure on page)', () => {
    const fig = renderImage({ url: 'u', alignment: 'right' });
    expect(fig.style.display).not.toBe('flex');
  });

  it('does not apply margin-inline on img — figure itself shifts via root text-align so container fits image', () => {
    const leftImg = renderImage({ url: 'u', alignment: 'left', width: 60 }).querySelector('img');
    const rightImg = renderImage({ url: 'u', alignment: 'right', width: 60 }).querySelector('img');
    if (!leftImg || !rightImg) throw new Error('img missing');
    expect(leftImg.style.marginLeft).toBe('');
    expect(leftImg.style.marginRight).toBe('');
    expect(rightImg.style.marginLeft).toBe('');
    expect(rightImg.style.marginRight).toBe('');
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

  it('forces text-align:left so caption stays left regardless of image alignment', () => {
    const el = renderCaption({ value: '', placeholder: 'p', readOnly: false });
    expect(el.style.textAlign).toBe('left');
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

const noop = (): void => undefined;
const makeOverlayOpts = (over: Partial<Parameters<typeof renderOverlay>[0]> = {}) => ({
  state: { alignment: 'center' as const, captionVisible: true, hasAlt: false, size: 'md' as const },
  onAlign: noop,
  onSize: noop,
  onReplace: noop,
  onAlt: noop,
  onDelete: noop,
  onDownload: noop,
  onFullscreen: noop,
  onCopyUrl: noop,
  onToggleCaption: noop,
  ...over,
});

describe('renderOverlay', () => {
  it('exposes data-action buttons for each command', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    expect(overlay.querySelector('[data-action="align-trigger"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="alt"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="delete"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="download"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="fullscreen"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="more"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="caption-toggle"]')).not.toBeNull();
  });

  it('renders a single alignment trigger — no inline pill buttons', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    expect(overlay.querySelectorAll('[data-action="align-trigger"]').length).toBe(1);
    expect(overlay.querySelector('[data-action="align-full"]')).toBeNull();
    // Pill options exist only inside the popover (hidden by default).
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
    if (!popover) throw new Error('popover missing');
    expect(popover.hidden).toBe(true);
  });

  it('align popover does not reuse the toolbar pill class that overrides [hidden] via display:inline-flex', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
    if (!popover) throw new Error('popover missing');
    expect(popover.classList.contains('blok-image-toolbar__pill')).toBe(false);
    expect(popover.classList.contains('blok-image-toolbar__align-popover')).toBe(true);
  });

  it('trigger reflects current alignment via data-current', () => {
    const overlay = renderOverlay(makeOverlayOpts({ state: { alignment: 'right', captionVisible: true, hasAlt: false, size: 'md' } }));
    const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
    if (!trigger) throw new Error('trigger missing');
    expect(trigger.getAttribute('data-current')).toBe('right');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking trigger opens popover with three options', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
    if (!trigger || !popover) throw new Error('dom missing');
    trigger.click();
    expect(popover.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(popover.querySelector('[data-action="align-left"]')).not.toBeNull();
    expect(popover.querySelector('[data-action="align-center"]')).not.toBeNull();
    expect(popover.querySelector('[data-action="align-right"]')).not.toBeNull();
    expect(popover.querySelector('[data-action="align-full"]')).toBeNull();
  });

  it('aria-pressed inside popover reflects current alignment', () => {
    const overlay = renderOverlay(makeOverlayOpts({ state: { alignment: 'right', captionVisible: true, hasAlt: false, size: 'md' } }));
    overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]')?.click();
    const right = overlay.querySelector<HTMLButtonElement>('[data-action="align-right"]');
    const left = overlay.querySelector<HTMLButtonElement>('[data-action="align-left"]');
    expect(right?.getAttribute('aria-pressed')).toBe('true');
    expect(left?.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking an option calls onAlign with that value and closes the popover', () => {
    const onAlign = vi.fn();
    const overlay = renderOverlay(makeOverlayOpts({ onAlign }));
    const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
    if (!trigger || !popover) throw new Error('dom missing');
    trigger.click();
    overlay.querySelector<HTMLButtonElement>('[data-action="align-right"]')?.click();
    expect(onAlign).toHaveBeenCalledWith('right');
    expect(popover.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the popover', () => {
    document.body.innerHTML = '';
    const overlay = renderOverlay(makeOverlayOpts());
    document.body.appendChild(overlay);
    const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
    if (!trigger || !popover) throw new Error('dom missing');
    trigger.click();
    expect(popover.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popover.hidden).toBe(true);
  });

  it('clicking outside the overlay closes the popover', () => {
    document.body.innerHTML = '';
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const overlay = renderOverlay(makeOverlayOpts());
    document.body.appendChild(overlay);
    const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
    const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
    if (!trigger || !popover) throw new Error('dom missing');
    trigger.click();
    expect(popover.hidden).toBe(false);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(popover.hidden).toBe(true);
  });
});

