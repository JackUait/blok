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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- shared helper used by subsequent pan tests
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
