import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLightbox } from '../../../src/tools/image/ui';

afterEach(() => {
  document.body.replaceChildren();
});

function dialog(): HTMLElement {
  return document.body.querySelector('.blok-image-lightbox') as HTMLElement;
}

function image(): HTMLImageElement {
  return document.body.querySelector('.blok-image-lightbox__image') as HTMLImageElement;
}

function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  const full: DOMRect = {
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
    width: 0, height: 0, toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  // eslint-disable-next-line no-param-reassign -- test stub overrides DOM method on the element under test
  el.getBoundingClientRect = () => full;
}

function openWithCapture(): () => void {
  const close = openLightbox({ url: 'https://example.com/pic.jpg', fileName: 'pic.jpg' });
  const d = dialog();
  d.setPointerCapture = (): void => undefined;
  d.releasePointerCapture = (): void => undefined;
  stubRect(image(), { width: 800, height: 600 });
  return close;
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

describe('openLightbox transform composition', () => {
  it('initial transform is translate(0,0) scale(1)', () => {
    const close = openWithCapture();
    expect(image().style.transform).toBe('translate(0px, 0px) scale(1)');
    close();
  });
});

describe('openLightbox drag-to-pan', () => {
  it('translates image by drag delta after crossing 3px threshold', () => {
    const close = openWithCapture();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 150, 140));
    d.dispatchEvent(pointer('pointerup', 150, 140));
    expect(image().style.transform).toBe('translate(50px, 40px) scale(1)');
    close();
  });

  it('closes lightbox on click without drag (pointer movement ≤ 3px)', () => {
    const close = openWithCapture();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 101, 101));
    d.dispatchEvent(pointer('pointerup', 101, 101));
    d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
    close();
  });

  it('does not close after a drag gesture', () => {
    const close = openWithCapture();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 150, 140));
    d.dispatchEvent(pointer('pointerup', 150, 140));
    d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.querySelector('.blok-image-lightbox')).not.toBeNull();
    close();
  });

  it('clamps pan to half the image rect on each axis', () => {
    const close = openWithCapture(); // stubs rect to 800x600
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 100000, 100000));
    d.dispatchEvent(pointer('pointerup', 100000, 100000));
    // maxX = 800/2 = 400, maxY = 600/2 = 300
    expect(image().style.transform).toBe('translate(400px, 300px) scale(1)');
    close();
  });

  it('clamps pan in the negative direction', () => {
    const close = openWithCapture();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', -100000, -100000));
    d.dispatchEvent(pointer('pointerup', -100000, -100000));
    expect(image().style.transform).toBe('translate(-400px, -300px) scale(1)');
    close();
  });

  it('snaps pan to (0,0) when zoom returns to 1', () => {
    const close = openWithCapture();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 200, 200));
    d.dispatchEvent(pointer('pointerup', 200, 200));
    expect(image().style.transform).toContain('translate(100px, 100px)');

    const reset = d.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]')!;
    reset.click();
    expect(image().style.transform).toBe('translate(0px, 0px) scale(1)');
    close();
  });

  it('re-clamps pan when zooming out from a high scale', () => {
    const close = openWithCapture();
    const d = dialog();

    // Pan to the bound at the initial rect (400, 300).
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 100000, 100000));
    d.dispatchEvent(pointer('pointerup', 100000, 100000));
    expect(image().style.transform).toContain('translate(400px, 300px)');

    // Simulate shrinking the rendered rect (as if zoom decreased).
    stubRect(image(), { width: 500, height: 400 });

    // Nudge zoom via the zoom-in button (value changes but still > 1), which triggers re-clamp.
    d.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click();

    // New maxX = 250, maxY = 200.
    expect(image().style.transform).toContain('translate(250px, 200px)');
    close();
  });

  it('pointerdown on toolbar does not start a drag', () => {
    const close = openWithCapture();
    const d = dialog();
    const toolbar = d.querySelector<HTMLElement>('[data-role="lightbox-toolbar"]')!;
    const zoomIn = toolbar.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;

    zoomIn.dispatchEvent(pointer('pointerdown', 500, 500));
    d.dispatchEvent(pointer('pointermove', 600, 600));
    d.dispatchEvent(pointer('pointerup', 600, 600));

    // Image was never translated.
    expect(image().style.transform).toBe('translate(0px, 0px) scale(1)');
    close();
  });
});

describe('lightbox pan CSS', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const mainCss = readFileSync(path.join(projectRoot, 'src/styles/main.css'), 'utf8');

  const ruleBody = (selectorPattern: RegExp): string => {
    const match = mainCss.match(selectorPattern);
    if (!match) throw new Error(`selector not found: ${selectorPattern}`);
    return match[1];
  };

  it('lightbox dialog declares grab cursor and disables touch scrolling', () => {
    const body = ruleBody(/\.blok-image-lightbox\s*\{([^}]+)\}/);
    expect(body).toMatch(/cursor:\s*grab/);
    expect(body).toMatch(/touch-action:\s*none/);
    expect(body).toMatch(/user-select:\s*none/);
    expect(body).not.toMatch(/cursor:\s*zoom-out/);
  });

  it('lightbox dialog has a grabbing cursor while dragging', () => {
    const body = ruleBody(/\.blok-image-lightbox\.is-dragging\s*\{([^}]+)\}/);
    expect(body).toMatch(/cursor:\s*grabbing/);
  });

  it('lightbox image ignores pointer events and disables transform transition while dragging', () => {
    const imgBody = ruleBody(/\.blok-image-lightbox__image\s*\{([^}]+)\}/);
    expect(imgBody).toMatch(/pointer-events:\s*none/);

    const dragImgBody = ruleBody(/\.blok-image-lightbox\.is-dragging\s+\.blok-image-lightbox__image\s*\{([^}]+)\}/);
    expect(dragImgBody).toMatch(/transition:\s*none/);
  });
});
