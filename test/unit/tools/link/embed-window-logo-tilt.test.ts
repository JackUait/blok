import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmbedWindow, type EmbedWindow } from '../../../../src/tools/link/embed/empty-window';

const frames = { queue: [] as FrameRequestCallback[], time: 0 };

const runFrames = (): void => {
  for (const guard = { left: 4000 }; frames.queue.length > 0 && guard.left > 0; guard.left -= 1) {
    frames.time += 16;
    frames.queue.shift()?.(frames.time);
  }
};

const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });

// jsdom has no layout: the window is 400x148, the drawing sits centred in it
// and the 32px logo tile hangs over the drawing's top right corner.
const mount = (): { win: EmbedWindow; badge: HTMLElement } => {
  const win = createEmbedWindow();
  const mark = document.createElement('span');

  document.body.appendChild(win.element);
  win.show('video');
  win.brand(mark);

  const badge = win.element.querySelector<HTMLElement>('[data-role="embed-brand"]');

  if (badge === null) {
    throw new Error('no logo tile');
  }

  vi.spyOn(win.element, 'getBoundingClientRect').mockReturnValue(box(0, 0, 400, 148));
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(box(100, 14, 200, 120));
  vi.spyOn(badge, 'offsetLeft', 'get').mockReturnValue(255);
  vi.spyOn(badge, 'offsetTop', 'get').mockReturnValue(10);
  vi.spyOn(badge, 'offsetWidth', 'get').mockReturnValue(32);
  vi.spyOn(badge, 'offsetHeight', 'get').mockReturnValue(32);

  return { win, badge };
};

const point = (win: EmbedWindow, type: string, clientX = 0, clientY = 0): void => {
  win.element.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
};

const shift = (badge: HTMLElement): [number, number] => {
  const [x = '0', y = '0'] = badge.style.translate.split(' ');

  return [parseFloat(x) || 0, parseFloat(y) || 0];
};

describe('embed window logo tile and the tilting drawing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.queue.push(cb);

      return frames.queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const proto = SVGElement.prototype as SVGElement & {
      getTotalLength?: () => number;
      getPointAtLength?: (d: number) => { x: number; y: number };
    };

    proto.getTotalLength = () => 40;
    proto.getPointAtLength = (d: number) => ({ x: 20 + (d % 20), y: 10 + Math.floor(d / 20) * 10 });
  });

  afterEach(() => {
    Reflect.deleteProperty(SVGElement.prototype, 'getTotalLength');
    Reflect.deleteProperty(SVGElement.prototype, 'getPointAtLength');
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('moves the tile with the drawing when the pointer leans it', () => {
    const { win, badge } = mount();

    point(win, 'pointermove', 400, 74);
    runFrames();
    const right = shift(badge);

    point(win, 'pointermove', 0, 74);
    runFrames();
    const left = shift(badge);

    expect(right[0]).not.toBe(0);
    expect(Math.sign(left[0])).toBe(-Math.sign(right[0]));
  });

  it('moves the tile further than the card under it, like the other floating parts', () => {
    const { win, badge } = mount();

    point(win, 'pointermove', 400, 148);
    runFrames();

    const [x, y] = shift(badge);

    expect(Math.hypot(x, y)).toBeGreaterThan(2);
  });

  it('puts the tile back when the pointer leaves', () => {
    const { win, badge } = mount();

    point(win, 'pointermove', 400, 148);
    runFrames();
    point(win, 'pointerleave');
    runFrames();

    expect(shift(badge)).toEqual([0, 0]);
  });

  it('puts the tile back when a new, flat drawing replaces the tilted one', () => {
    const { win, badge } = mount();

    point(win, 'pointermove', 400, 148);
    runFrames();
    win.show('audio');

    expect(shift(badge)).toEqual([0, 0]);
  });
});
