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

function currentScale(): number {
  const match = image().style.transform.match(/scale\((.+?)\)/);
  if (!match) throw new Error(`no scale in transform: ${image().style.transform}`);
  return parseFloat(match[1]);
}

function open(): () => void {
  const close = openLightbox({ url: 'https://example.com/pic.jpg' });
  const d = dialog();
  d.setPointerCapture = (): void => undefined;
  d.releasePointerCapture = (): void => undefined;
  stubRect(image(), { width: 800, height: 600 });
  return close;
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

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

function wheel(deltaY: number, init: Partial<WheelEventInit> = {}): WheelEvent {
  return new WheelEvent('wheel', {
    deltaY,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe('openLightbox wheel zoom', () => {
  it('scrolls up (deltaY < 0) to zoom in', () => {
    const close = open();
    dialog().dispatchEvent(wheel(-100));
    expect(currentScale()).toBeGreaterThan(1);
    close();
  });

  it('scrolls down (deltaY > 0) to zoom out', () => {
    const close = open();
    dialog().dispatchEvent(wheel(100));
    expect(currentScale()).toBeLessThan(1);
    close();
  });

  it('prevents default so the page does not scroll', () => {
    const close = open();
    const event = wheel(100);
    dialog().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    close();
  });

  it('treats pinch gesture (ctrlKey + deltaY < 0) as zoom-in', () => {
    const close = open();
    dialog().dispatchEvent(wheel(-20, { ctrlKey: true }));
    expect(currentScale()).toBeGreaterThan(1);
    close();
  });

  it('treats pinch gesture (ctrlKey + deltaY > 0) as zoom-out', () => {
    const close = open();
    dialog().dispatchEvent(wheel(20, { ctrlKey: true }));
    expect(currentScale()).toBeLessThan(1);
    close();
  });

  it('clamps at ZOOM_MAX (4) on extreme negative deltaY', () => {
    const close = open();
    dialog().dispatchEvent(wheel(-100000));
    expect(currentScale()).toBeLessThanOrEqual(4);
    expect(currentScale()).toBeGreaterThan(1);
    close();
  });

  it('clamps at ZOOM_MIN (0.25) on extreme positive deltaY', () => {
    const close = open();
    dialog().dispatchEvent(wheel(100000));
    expect(currentScale()).toBeGreaterThanOrEqual(0.25);
    expect(currentScale()).toBeLessThan(1);
    close();
  });

  it('updates the zoom-reset label after wheel zoom', () => {
    const close = open();
    dialog().dispatchEvent(wheel(-200));
    const label = dialog().querySelector<HTMLButtonElement>('[data-action="zoom-reset"]')!;
    const pct = parseInt(label.textContent!, 10);
    expect(pct).toBeGreaterThan(100);
    close();
  });

  it('composite multiple wheel events accumulate zoom', () => {
    const close = open();
    dialog().dispatchEvent(wheel(-100));
    const afterFirst = currentScale();
    dialog().dispatchEvent(wheel(-100));
    expect(currentScale()).toBeGreaterThan(afterFirst);
    close();
  });
});

describe('openLightbox cursor-anchored wheel zoom', () => {
  function stubDialogRect(w: number, h: number): void {
    stubRect(dialog(), { left: 0, top: 0, right: w, bottom: h, width: w, height: h });
  }

  it('keeps the pixel under the cursor stationary on zoom-in', () => {
    const close = open();
    const d = dialog();
    stubDialogRect(800, 600);
    // Cursor at (500, 400) — offset (+100, +100) from the (400, 300) center.
    // factor = 1.25, k = 1.25. newPan = 100 * (1 - 1.25) = -25.
    d.dispatchEvent(wheel(-100, { clientX: 500, clientY: 400 }));
    expect(image().style.transform).toBe('translate(-25px, -25px) scale(1.25)');
    close();
  });

  it('zooming from the dialog center with pan=0 leaves pan at 0', () => {
    const close = open();
    const d = dialog();
    stubDialogRect(800, 600);
    d.dispatchEvent(wheel(-100, { clientX: 400, clientY: 300 }));
    expect(image().style.transform).toBe('translate(0px, 0px) scale(1.25)');
    close();
  });

  it('honours existing pan when computing the cursor anchor', () => {
    const close = open();
    const d = dialog();
    stubDialogRect(800, 600);
    // Pan to (50, 0).
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 150, 100));
    d.dispatchEvent(pointer('pointerup', 150, 100));
    expect(image().style.transform).toContain('translate(50px, 0px)');
    // Cursor at the dialog center (400, 300): dx=0, dy=0. newPan = 50 * 1.25 = 62.5.
    d.dispatchEvent(wheel(-100, { clientX: 400, clientY: 300 }));
    expect(image().style.transform).toBe('translate(62.5px, 0px) scale(1.25)');
    close();
  });

  it('clamps pan to image bounds when the cursor is far off-center', () => {
    const close = open();
    const d = dialog();
    stubDialogRect(800, 600);
    // Cursor far right of dialog; without clamping newPan.x would be -2500.
    d.dispatchEvent(wheel(-100, { clientX: 10400, clientY: 300 }));
    const match = image().style.transform.match(/translate\((-?\d+(?:\.\d+)?)px,/);
    expect(Number(match![1])).toBe(-400);
    close();
  });

  it('button zoom still recenters (unchanged contract)', () => {
    const close = open();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 200, 200));
    d.dispatchEvent(pointer('pointerup', 200, 200));
    expect(image().style.transform).toContain('translate(100px, 100px)');

    d.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click();
    expect(image().style.transform).toBe('translate(0px, 0px) scale(1.25)');
    close();
  });
});
