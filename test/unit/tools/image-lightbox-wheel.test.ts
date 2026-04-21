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
  return close;
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
