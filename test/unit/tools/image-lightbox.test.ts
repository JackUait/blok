import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLightbox } from '../../../src/tools/image/ui';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const openAtBody = (opts: Parameters<typeof openLightbox>[0]): (() => void) => openLightbox(opts);

const bar = (): HTMLElement => document.body.querySelector('[data-role="lightbox-toolbar"]') as HTMLElement;

describe('openLightbox toolbar', () => {
  it('never renders filename label, even when fileName provided', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg', fileName: 'photo.jpg' });
    expect(bar().querySelector('.blok-image-lightbox__filename')).toBeNull();
    expect(bar().querySelector('[data-role="lightbox-filename"]')).toBeNull();
    close();
  });

  it('renders a dedicated backdrop child so opacity can animate without affecting the image', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const dialog = document.body.querySelector('.blok-image-lightbox') as HTMLElement;
    expect(dialog.querySelector('.blok-image-lightbox__backdrop')).not.toBeNull();
    close();
  });

  it('accepts an origin element option without throwing and still mounts the dialog', () => {
    const origin = document.createElement('div');
    document.body.appendChild(origin);
    const close = openAtBody({ url: 'https://example.com/pic.jpg', origin });
    expect(document.body.querySelector('.blok-image-lightbox')).not.toBeNull();
    close();
  });

  it('renders zoom buttons directly in the bar in order out/reset/in, separated from actions by a divider', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const actions = Array.from(bar().querySelectorAll('button')).map((b) => b.getAttribute('data-action'));
    expect(actions.slice(0, 3)).toEqual(['zoom-out', 'zoom-reset', 'zoom-in']);
    expect(bar().querySelector('.blok-image-lightbox__cluster')).toBeNull();
    expect(bar().querySelectorAll('.blok-image-lightbox__divider').length).toBeGreaterThanOrEqual(1);
    close();
  });

  it('renders copy-url button and writes URL to clipboard on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const url = 'https://example.com/pic.jpg';
    const close = openAtBody({ url });
    const btn = bar().querySelector<HTMLButtonElement>('[data-action="lightbox-copy-url"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(writeText).toHaveBeenCalledWith(url);
    close();
  });

  /**
   * Regression: dragging inside the lightbox triggered Blok's RectangleSelection
   * because `mousedown` bubbled from the lightbox dialog up to `document.body`,
   * where `RectangleSelection.processMouseDown` saw a non-contentEditable target
   * and started a rubber-band block selection on the editor behind. The
   * lightbox must stop `mousedown` from bubbling so document-level handlers
   * (rubber-band selection, click-outside dismissers) don't see drags inside
   * the dialog.
   */
  it('stops mousedown from bubbling to document so rubber-band selection does not trigger on the editor behind', () => {
    const docMousedown = vi.fn();
    document.body.addEventListener('mousedown', docMousedown);
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const dialog = document.body.querySelector('.blok-image-lightbox') as HTMLElement;
    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(docMousedown).not.toHaveBeenCalled();
    document.body.removeEventListener('mousedown', docMousedown);
    close();
  });

  it('still lets toolbar mousedown bubble (so toolbar buttons keep working as expected)', () => {
    const docMousedown = vi.fn();
    document.body.addEventListener('mousedown', docMousedown);
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const btn = bar().querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(docMousedown).toHaveBeenCalled();
    document.body.removeEventListener('mousedown', docMousedown);
    close();
  });

  it('enables zoom-in and zoom-out at initial 100% (room in both directions)', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const zoomIn = bar().querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;
    const zoomOut = bar().querySelector<HTMLButtonElement>('[data-action="zoom-out"]')!;
    expect(zoomIn.disabled).toBe(false);
    expect(zoomOut.disabled).toBe(false);
    close();
  });

  it('disables zoom-out at minimum zoom and keeps zoom-in enabled', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const zoomOut = bar().querySelector<HTMLButtonElement>('[data-action="zoom-out"]')!;
    const zoomIn = bar().querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;
    // ZOOM_MIN=0.25, ZOOM_STEP=0.25 -> 3 clicks from 1 reaches 0.25
    for (let i = 0; i < 3; i++) zoomOut.click();
    expect(zoomOut.disabled).toBe(true);
    expect(zoomIn.disabled).toBe(false);
    close();
  });

  it('disables zoom-in at maximum zoom and keeps zoom-out enabled', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const zoomIn = bar().querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;
    const zoomOut = bar().querySelector<HTMLButtonElement>('[data-action="zoom-out"]')!;
    // ZOOM_MAX=4, ZOOM_STEP=0.25 -> 12 clicks from 1 reaches 4
    for (let i = 0; i < 12; i++) zoomIn.click();
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    close();
  });

  it('re-enables zoom-out after clicking zoom-in once from minimum', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const zoomOut = bar().querySelector<HTMLButtonElement>('[data-action="zoom-out"]')!;
    const zoomIn = bar().querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;
    for (let i = 0; i < 3; i++) zoomOut.click();
    expect(zoomOut.disabled).toBe(true);
    zoomIn.click();
    expect(zoomOut.disabled).toBe(false);
    close();
  });

  it('retains all expected actions in the toolbar', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    const toolbar = bar();
    for (const action of [
      'zoom-out',
      'zoom-reset',
      'zoom-in',
      'lightbox-download',
      'lightbox-copy-url',
      'lightbox-collapse',
    ]) {
      expect(toolbar.querySelector(`[data-action="${action}"]`)).not.toBeNull();
    }
    close();
  });
});

describe('no-glass CSS regression', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const mainCss = readFileSync(path.join(projectRoot, 'src/styles/main.css'), 'utf8');
  const cropModalCss = readFileSync(path.join(projectRoot, 'src/tools/image/crop-modal.css'), 'utf8');
  const cropEditorCss = readFileSync(path.join(projectRoot, 'src/tools/image/crop-editor.css'), 'utf8');

  const ruleBody = (css: string, selectorPattern: RegExp): string => {
    const match = css.match(selectorPattern);
    if (!match) throw new Error(`selector not found: ${selectorPattern}`);
    return match[1];
  };

  it('lightbox bar has no backdrop-filter', () => {
    const body = ruleBody(mainCss, /\.blok-image-lightbox__bar\s*\{([^}]+)\}/);
    expect(body).not.toMatch(/backdrop-filter/);
  });

  it('lightbox bar uses 12px radius (space-3), matching inline popover — not pill', () => {
    const body = ruleBody(mainCss, /\.blok-image-lightbox__bar\s*\{([^}]+)\}/);
    expect(body).toMatch(/border-radius:\s*var\(--blok-space-3\)/);
    expect(body).not.toMatch(/--blok-radius-pill/);
  });

  it('lightbox button uses 32px square with 8px radius (matches inline popover item proportions)', () => {
    const body = ruleBody(mainCss, /\.blok-image-lightbox__btn\s*\{([^}]+)\}/);
    expect(body).toMatch(/width:\s*32px/);
    expect(body).toMatch(/height:\s*32px/);
    expect(body).toMatch(/border-radius:\s*var\(--blok-space-2\)/);
  });

  it('in-doc image toolbar has no backdrop-filter', () => {
    const body = ruleBody(mainCss, /\[data-blok-tool="image"\]\s*\.blok-image-toolbar\s*\{([^}]+)\}/);
    expect(body).not.toMatch(/backdrop-filter/);
  });

  it('alignment popover has no backdrop-filter', () => {
    const body = ruleBody(mainCss, /\[data-blok-tool="image"\]\s*\.blok-image-toolbar__align-popover\s*\{([^}]+)\}/);
    expect(body).not.toMatch(/backdrop-filter/);
  });

  it('crop modal backdrop has no backdrop-filter', () => {
    expect(cropModalCss).not.toMatch(/backdrop-filter/);
  });

  it('crop editor size pill has no backdrop-filter', () => {
    expect(cropEditorCss).not.toMatch(/backdrop-filter/);
  });

  /**
   * Regression: when the lightbox is promoted to the CSS Top Layer, the
   * `[data-blok-top-layer][popover]` reset (specificity 0,2,0) overrides
   * `.blok-image-lightbox { inset: 0 }` (0,1,0) with `inset: auto`. The
   * dialog then shrinks to its content, leaving the underlying editor
   * exposed: dragging on uncovered area starts native rubber-band text
   * selection on the editor behind the lightbox.
   */
  it('lightbox keeps inset:0 when promoted to top layer (covers viewport so drags do not select editor behind)', () => {
    const body = ruleBody(
      mainCss,
      /\.blok-image-lightbox\[data-blok-top-layer\]\[popover\]\s*\{([^}]+)\}/,
    );
    expect(body).toMatch(/inset:\s*0/);
  });
});
