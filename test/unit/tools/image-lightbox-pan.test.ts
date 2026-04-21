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
});
