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
  it('renders filename label when fileName provided', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg', fileName: 'photo.jpg' });
    const label = bar().querySelector('.blok-image-lightbox__filename');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('photo.jpg');
    close();
  });

  it('omits filename label when fileName absent', () => {
    const close = openAtBody({ url: 'https://example.com/pic.jpg' });
    expect(bar().querySelector('.blok-image-lightbox__filename')).toBeNull();
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
});
