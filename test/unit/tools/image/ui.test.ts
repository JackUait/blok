import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
}));

import { renderImage, renderCaption, renderCaptionRow, openLightbox } from '../../../../src/tools/image/ui';
import * as tooltip from '../../../../src/components/utils/tooltip';

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

  it('applies border-radius 50% when crop.shape is circle', () => {
    const fig = renderImage({ url: 'x', crop: { x: 0, y: 0, w: 100, h: 100, shape: 'circle' } });
    const wrapper = fig.querySelector<HTMLElement>('[data-role="image-crop"]');
    if (!wrapper) throw new Error('wrapper missing');
    expect(wrapper.style.borderRadius).toBe('50%');
    expect(wrapper.dataset.shape).toBe('circle');
  });

  it('applies border-radius 50% when crop.shape is ellipse', () => {
    const fig = renderImage({ url: 'x', crop: { x: 0, y: 0, w: 100, h: 100, shape: 'ellipse' } });
    const wrapper = fig.querySelector<HTMLElement>('[data-role="image-crop"]');
    if (!wrapper) throw new Error('wrapper missing');
    expect(wrapper.style.borderRadius).toBe('50%');
    expect(wrapper.dataset.shape).toBe('ellipse');
  });

  it('does not set border-radius for default rect crop', () => {
    const fig = renderImage({ url: 'x', crop: { x: 0, y: 0, w: 50, h: 50 } });
    const wrapper = fig.querySelector<HTMLElement>('[data-role="image-crop"]');
    if (!wrapper) throw new Error('wrapper missing');
    expect(wrapper.style.borderRadius).toBe('');
  });

  it('emits max-width:none on cropped img so the global preflight (img{max-width:100%}) does not clamp the scaled image', () => {
    // Regression: global rule in main.css gives every editor <img> max-width:100%.
    // That silently clobbers the crop wrapper's intended width:333% scaling,
    // shrinking the source to wrapper size and — combined with negative margin —
    // shifting the visible region entirely out of the wrapper. Result: a crop
    // that looked right in the preview renders as a different (or empty) region.
    const fig = renderImage({ url: 'x', crop: { x: 45, y: 10, w: 30, h: 60 } });
    const img = fig.querySelector<HTMLImageElement>('img');
    if (!img) throw new Error('img missing');
    expect(img.style.maxWidth).toBe('none');
  });

  it('offsets the cropped source via transform (not margin) so horizontal and vertical shifts use the same reference frame', () => {
    // CSS gotcha: margin-left/-top percentages BOTH resolve against the
    // containing block's WIDTH. Using margin-top:-(y/h)*100% therefore shifts
    // the image by (y/h) * wrapperWidth instead of the intended
    // (y/h) * wrapperHeight, producing a vertically mis-cropped region.
    //
    // transform:translate(-x%,-y%) resolves percentages against the element's
    // OWN box, so -x%/img-width and -y%/img-height both resolve correctly
    // regardless of wrapper aspect.
    const fig = renderImage({ url: 'x', crop: { x: 45, y: 10, w: 30, h: 60 } });
    const img = fig.querySelector<HTMLImageElement>('img');
    if (!img) throw new Error('img missing');
    expect(img.style.marginLeft).toBe('');
    expect(img.style.marginTop).toBe('');
    expect(img.style.transform).toBe('translate(-45%, -10%)');
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

describe('renderCaptionRow', () => {
  const baseCaption = { value: '', placeholder: 'p', readOnly: false };

  it('wraps caption with class blok-image-caption-row and contains the caption element', () => {
    const row = renderCaptionRow({ caption: baseCaption, onAlt: () => undefined });
    expect(row.classList.contains('blok-image-caption-row')).toBe(true);
    expect(row.querySelector('.blok-image-caption')).not.toBeNull();
  });

  it('renders alt button with text label "Alt" when onAlt is provided', () => {
    const row = renderCaptionRow({ caption: baseCaption, onAlt: () => undefined });
    const btn = row.querySelector<HTMLButtonElement>('[data-action="alt-edit"]');
    if (!btn) throw new Error('alt button missing');
    expect(btn.textContent).toBe('Alt');
    expect(btn.tagName).toBe('BUTTON');
  });

  it('omits alt button when onAlt is not provided (readOnly)', () => {
    const row = renderCaptionRow({ caption: { ...baseCaption, readOnly: true } });
    expect(row.querySelector('[data-action="alt-edit"]')).toBeNull();
  });

  it('clicking the alt button invokes onAlt', () => {
    let calls = 0;
    const row = renderCaptionRow({ caption: baseCaption, onAlt: () => { calls += 1; } });
    row.querySelector<HTMLButtonElement>('[data-action="alt-edit"]')?.click();
    expect(calls).toBe(1);
  });

  it('alt button reflects hasAlt via aria-pressed so styling can show current state', () => {
    const onRow = renderCaptionRow({ caption: baseCaption, onAlt: () => undefined, hasAlt: true });
    const offRow = renderCaptionRow({ caption: baseCaption, onAlt: () => undefined, hasAlt: false });
    expect(onRow.querySelector('[data-action="alt-edit"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(offRow.querySelector('[data-action="alt-edit"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('openLightbox', () => {
  afterEach(() => {
    document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((el) => el.remove());
  });

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

  it('pressing "-" zooms out', () => {
    const close = openLightbox({ url: 'u' });
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!img) throw new Error('img missing');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    const match = img.style.transform.match(/scale\(([^)]+)\)/);
    if (!match) throw new Error('no scale');
    expect(parseFloat(match[1])).toBeLessThan(1);
    close();
  });

  it('pressing "+" zooms in', () => {
    const close = openLightbox({ url: 'u' });
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!img) throw new Error('img missing');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    const match = img.style.transform.match(/scale\(([^)]+)\)/);
    if (!match) throw new Error('no scale');
    expect(parseFloat(match[1])).toBeGreaterThan(1);
    close();
  });

  it('pressing "=" (unshifted plus) also zooms in', () => {
    const close = openLightbox({ url: 'u' });
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!img) throw new Error('img missing');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    const match = img.style.transform.match(/scale\(([^)]+)\)/);
    if (!match) throw new Error('no scale');
    expect(parseFloat(match[1])).toBeGreaterThan(1);
    close();
  });

  it('keyboard shortcuts do not fire after lightbox closes', () => {
    const close = openLightbox({ url: 'u' });
    close();
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    expect(img).toBeNull();
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }))).not.toThrow();
  });

  it('closes on backdrop click', () => {
    openLightbox({ url: 'u' });
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!(dialog instanceof HTMLElement)) throw new Error('dialog missing');
    dialog.click();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });

  it('renders bottom toolbar with zoom-out, zoom-reset, zoom-in, download, collapse buttons', () => {
    const close = openLightbox({ url: 'u' });
    const toolbar = document.querySelector('[data-role="lightbox-toolbar"]');
    expect(toolbar).not.toBeNull();
    if (!toolbar) throw new Error('toolbar missing');
    expect(toolbar.querySelector('[data-action="zoom-out"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-action="zoom-reset"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-action="zoom-in"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-action="lightbox-download"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-action="lightbox-collapse"]')).not.toBeNull();
    close();
  });

  it('zoom-reset button shows current zoom (initially 100%)', () => {
    const close = openLightbox({ url: 'u' });
    const reset = document.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]');
    if (!reset) throw new Error('reset missing');
    expect(reset.textContent).toContain('100%');
    close();
  });

  it('clicking zoom-in increases zoom and updates label', () => {
    const close = openLightbox({ url: 'u' });
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-action="zoom-in"]');
    const reset = document.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]');
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!zoomIn || !reset || !img) throw new Error('elements missing');
    zoomIn.click();
    expect(reset.textContent).not.toContain('100%');
    expect(img.style.transform).toMatch(/scale\(([^)]+)\)/);
    const match = img.style.transform.match(/scale\(([^)]+)\)/);
    if (!match) throw new Error('no scale');
    expect(parseFloat(match[1])).toBeGreaterThan(1);
    close();
  });

  it('clicking zoom-out decreases zoom', () => {
    const close = openLightbox({ url: 'u' });
    const zoomOut = document.querySelector<HTMLButtonElement>('[data-action="zoom-out"]');
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!zoomOut || !img) throw new Error('elements missing');
    zoomOut.click();
    const match = img.style.transform.match(/scale\(([^)]+)\)/);
    if (!match) throw new Error('no scale');
    expect(parseFloat(match[1])).toBeLessThan(1);
    close();
  });

  it('clicking zoom-reset after zooming returns to 100%', () => {
    const close = openLightbox({ url: 'u' });
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-action="zoom-in"]');
    const reset = document.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]');
    const img = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    if (!zoomIn || !reset || !img) throw new Error('elements missing');
    zoomIn.click();
    zoomIn.click();
    reset.click();
    expect(reset.textContent).toContain('100%');
    const match = img.style.transform.match(/scale\(([^)]+)\)/);
    if (!match) throw new Error('no scale');
    expect(parseFloat(match[1])).toBe(1);
    close();
  });

  it('clicking collapse closes the lightbox', () => {
    openLightbox({ url: 'u' });
    const collapse = document.querySelector<HTMLButtonElement>('[data-action="lightbox-collapse"]');
    if (!collapse) throw new Error('collapse missing');
    collapse.click();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });

  it('toolbar clicks do not close the lightbox', () => {
    const close = openLightbox({ url: 'u' });
    const zoomIn = document.querySelector<HTMLButtonElement>('[data-action="zoom-in"]');
    if (!zoomIn) throw new Error('zoom-in missing');
    zoomIn.click();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    close();
  });

  it('download button uses url and fileName on an anchor', () => {
    const close = openLightbox({ url: 'https://x/y.png', fileName: 'pic.png' });
    const download = document.querySelector<HTMLButtonElement>('[data-action="lightbox-download"]');
    if (!download) throw new Error('download missing');
    const clicks: Array<{ href: string; download: string }> = [];
    const originalAppend = HTMLBodyElement.prototype.appendChild;
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.getAttribute('href') ?? '', download: this.getAttribute('download') ?? '' });
    });
    download.click();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe('https://x/y.png');
    expect(clicks[0].download).toBe('pic.png');
    spy.mockRestore();
    void originalAppend;
    close();
  });
});

import { renderOverlay } from '../../../../src/tools/image/ui';

const noop = (): void => undefined;
const makeOverlayOpts = (over: Partial<Parameters<typeof renderOverlay>[0]> = {}) => ({
  state: { alignment: 'center' as const, captionVisible: true, size: 'md' as const },
  onAlign: noop,
  onSize: noop,
  onReplace: noop,
  onDelete: noop,
  onDownload: noop,
  onFullscreen: noop,
  onCopyUrl: noop,
  onToggleCaption: noop,
  onCrop: noop,
  ...over,
});

describe('renderOverlay', () => {
  it('exposes data-action buttons for each command', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    expect(overlay.querySelector('[data-action="align-trigger"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="replace"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="delete"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="download"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="fullscreen"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="more"]')).not.toBeNull();
    expect(overlay.querySelector('[data-action="caption-toggle"]')).not.toBeNull();
  });

  it('does not render alt button — it lives next to the caption', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    expect(overlay.querySelector('[data-action="alt"]')).toBeNull();
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
    const overlay = renderOverlay(makeOverlayOpts({ state: { alignment: 'right', captionVisible: true, size: 'md' } }));
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
    const overlay = renderOverlay(makeOverlayOpts({ state: { alignment: 'right', captionVisible: true, size: 'md' } }));
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

  describe('JS tooltips (no native browser title)', () => {
    const EXPECTED_LABELS: Record<string, string> = {
      'align-trigger': 'Alignment',
      'caption-toggle': 'Toggle caption',
      'replace': 'Replace image',
      'fullscreen': 'View fullscreen',
      'download': 'Download original',
      'more': 'More options',
    };

    it('no button inside overlay sets a native title attribute (prevents browser tooltip)', () => {
      const overlay = renderOverlay(makeOverlayOpts());
      overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]')?.click();
      overlay.querySelectorAll('button').forEach((btn) => {
        expect(btn.hasAttribute('title')).toBe(false);
      });
    });

    it('registers JS tooltip via onHover for each toolbar button with its accessible label', () => {
      vi.mocked(tooltip.onHover).mockClear();
      const overlay = renderOverlay(makeOverlayOpts());
      for (const [action, label] of Object.entries(EXPECTED_LABELS)) {
        const btn = overlay.querySelector<HTMLElement>(`[data-action="${action}"]`);
        if (!btn) throw new Error(`button missing: ${action}`);
        const called = vi.mocked(tooltip.onHover).mock.calls.some(
          ([el, content]) => el === btn && content === label
        );
        expect(called, `onHover not registered for ${action}`).toBe(true);
      }
    });

    it('registers JS tooltip on each alignment popover option', () => {
      vi.mocked(tooltip.onHover).mockClear();
      const overlay = renderOverlay(makeOverlayOpts());
      const ALIGN_LABELS: Record<string, string> = {
        'align-left': 'Align left',
        'align-center': 'Align center',
        'align-right': 'Align right',
      };
      for (const [action, label] of Object.entries(ALIGN_LABELS)) {
        const btn = overlay.querySelector<HTMLElement>(`[data-action="${action}"]`);
        if (!btn) throw new Error(`option missing: ${action}`);
        const called = vi.mocked(tooltip.onHover).mock.calls.some(
          ([el, content]) => el === btn && content === label
        );
        expect(called, `onHover not registered for ${action}`).toBe(true);
      }
    });
  });

  describe('alignment tooltip suppression while popover open', () => {
    it('hides tooltip when popover opens so Alignment hint disappears', () => {
      vi.mocked(tooltip.hide).mockClear();
      const overlay = renderOverlay(makeOverlayOpts());
      document.body.appendChild(overlay);
      overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]')?.click();
      expect(tooltip.hide).toHaveBeenCalled();
    });

    it('marks image tool root with data-align-open while popover is open so overlay stays visible', () => {
      document.body.innerHTML = '';
      const root = document.createElement('div');
      root.setAttribute('data-blok-tool', 'image');
      const overlay = renderOverlay(makeOverlayOpts());
      root.appendChild(overlay);
      document.body.appendChild(root);
      const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
      if (!trigger) throw new Error('trigger missing');
      expect(root.getAttribute('data-align-open')).not.toBe('true');
      trigger.click();
      expect(root.getAttribute('data-align-open')).toBe('true');
      trigger.click();
      expect(root.getAttribute('data-align-open')).not.toBe('true');
    });

    it('marks popover with data-blok-popover-opened while open so hover on trigger suppresses tooltip', () => {
      const overlay = renderOverlay(makeOverlayOpts());
      document.body.appendChild(overlay);
      const trigger = overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]');
      const popover = overlay.querySelector<HTMLElement>('[data-role="align-popover"]');
      if (!trigger || !popover) throw new Error('dom missing');
      expect(popover.getAttribute('data-blok-popover-opened')).not.toBe('true');
      trigger.click();
      expect(popover.getAttribute('data-blok-popover-opened')).toBe('true');
      trigger.click();
      expect(popover.getAttribute('data-blok-popover-opened')).not.toBe('true');
    });

    it('hides tooltip when an alignment option is clicked so option hint disappears immediately', () => {
      const overlay = renderOverlay(makeOverlayOpts());
      document.body.appendChild(overlay);
      overlay.querySelector<HTMLButtonElement>('[data-action="align-trigger"]')?.click();
      vi.mocked(tooltip.hide).mockClear();
      overlay.querySelector<HTMLButtonElement>('[data-action="align-center"]')?.click();
      expect(tooltip.hide).toHaveBeenCalled();
    });

    it.each([
      'caption-toggle',
      'replace',
      'crop',
      'fullscreen',
      'download',
    ])('hides tooltip when %s button is clicked so hint disappears (button may unmount on click)', (action) => {
      const overlay = renderOverlay(makeOverlayOpts());
      document.body.appendChild(overlay);
      vi.mocked(tooltip.hide).mockClear();
      overlay.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
      expect(tooltip.hide).toHaveBeenCalled();
    });
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

