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
    expect(renderImage({ url: 'u', alignment: 'full' }).style.textAlign).toBe('center');
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

import { renderOverlay, renderMorePopover } from '../../../../src/tools/image/ui';
import { vi } from 'vitest';

const noop = (): void => undefined;
const makeOverlayOpts = (over: Partial<Parameters<typeof renderOverlay>[0]> = {}) => ({
  state: { alignment: 'center' as const, captionVisible: true, hasAlt: false, size: 'md' as const },
  onAlign: noop,
  onAlignCycle: noop,
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
    expect(overlay.querySelector('[data-action="align"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="alt"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="delete"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="download"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="fullscreen"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="more"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="caption-toggle"]')).not.toBeNull();
  });

  it('renders four alignment-pill buttons with aria-pressed reflecting state', () => {
    const overlay = renderOverlay(makeOverlayOpts({ state: { alignment: 'right', captionVisible: true, hasAlt: false, size: 'md' } }));
    const left = overlay.querySelector<HTMLButtonElement>('[data-action="align-left"]');
    const center = overlay.querySelector<HTMLButtonElement>('[data-action="align-center"]');
    const right = overlay.querySelector<HTMLButtonElement>('[data-action="align-right"]');
    const full = overlay.querySelector<HTMLButtonElement>('[data-action="align-full"]');
    if (!left || !center || !right || !full) throw new Error('pill buttons missing');
    expect(right.getAttribute('aria-pressed')).toBe('true');
    expect(left.getAttribute('aria-pressed')).toBe('false');
    expect(full.getAttribute('aria-pressed')).toBe('false');
  });

  it('invokes onAlign with the chosen value when a pill button is clicked', () => {
    const onAlign = vi.fn();
    const overlay = renderOverlay(makeOverlayOpts({ onAlign }));
    overlay.querySelector<HTMLButtonElement>('[data-action="align-full"]')?.click();
    expect(onAlign).toHaveBeenCalledWith('full');
  });

  it('invokes onAlignCycle via the legacy align alias', () => {
    const onAlignCycle = vi.fn();
    const overlay = renderOverlay(makeOverlayOpts({ onAlignCycle }));
    overlay.querySelector<HTMLButtonElement>('[data-action="align"]')?.click();
    expect(onAlignCycle).toHaveBeenCalled();
  });
});

describe('renderMorePopover', () => {
  it('renders four size preset buttons with aria-pressed reflecting state', () => {
    const pop = renderMorePopover({
      size: 'lg',
      onSize: noop,
      onCopyUrl: noop,
      onDownload: noop,
      onDelete: noop,
    });
    const lg = pop.querySelector<HTMLButtonElement>('[data-action="size-lg"]');
    const sm = pop.querySelector<HTMLButtonElement>('[data-action="size-sm"]');
    if (!lg || !sm) throw new Error('size buttons missing');
    expect(lg.getAttribute('aria-pressed')).toBe('true');
    expect(sm.getAttribute('aria-pressed')).toBe('false');
    expect(pop.querySelector('[data-action="size-md"]')).not.toBeNull();
    expect(pop.querySelector('[data-action="size-full"]')).not.toBeNull();
  });

  it('fires onSize with the chosen preset', () => {
    const onSize = vi.fn();
    const pop = renderMorePopover({
      size: 'md',
      onSize,
      onCopyUrl: noop,
      onDownload: noop,
      onDelete: noop,
    });
    pop.querySelector<HTMLButtonElement>('[data-action="size-sm"]')?.click();
    expect(onSize).toHaveBeenCalledWith('sm');
  });

  it('fires onCopyUrl / onDownload / onDelete when their items are clicked', () => {
    const onCopyUrl = vi.fn();
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    const pop = renderMorePopover({
      size: 'md',
      onSize: noop,
      onCopyUrl,
      onDownload,
      onDelete,
    });
    pop.querySelector<HTMLButtonElement>('[data-action="copy-url"]')?.click();
    pop.querySelector<HTMLButtonElement>('[data-action="download"]')?.click();
    pop.querySelector<HTMLButtonElement>('[data-action="delete"]')?.click();
    expect(onCopyUrl).toHaveBeenCalled();
    expect(onDownload).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });
});
