import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSpeedWire } from '../../../../src/tools/video/speed-wire';
import type { SpeedWire } from '../../../../src/tools/video/speed-wire';

const WIDTH = 240;
const HEIGHT = 62;
const PAD = 26;
const SPAN = 188;
const MID = 31;

interface Harness {
  wire: SpeedWire;
  rates: number[];
  frames: ReturnType<typeof vi.spyOn>;
}

const mount = (reducedMotion = false): Harness => {
  const rates: number[] = [];
  const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
  // The wire reports a rate and the player echoes it back, as controls.ts does.
  const wire: SpeedWire = createSpeedWire({
    label: 'Playback speed',
    reducedMotion,
    onRate: (rate) => { rates.push(rate); wire.sync(rate); },
  });

  document.body.appendChild(wire.element);
  vi.spyOn(wire.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, WIDTH, HEIGHT));

  return { wire, rates, frames };
};

const part = (h: Harness, role: string): SVGElement => {
  const found = h.wire.element.querySelector<SVGElement>(`[data-role="${role}"]`);

  if (!found) throw new Error(`missing ${role}`);

  return found;
};
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
const settle = (): void => { vi.advanceTimersByTime(3000); };
/** A pointer event at a share of the wire, `off` px above or below the line. */
const at = (type: string, fraction: number, off = 0): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 100 + PAD + fraction * SPAN, clientY: 50 + MID + off });

describe('speed wire', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    h = mount();
    h.wire.sync(1);
    h.wire.enter();
    settle();
  });
  afterEach(() => {
    h.wire.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is a left-to-right slider with a real range inside', () => {
    expect(h.wire.element.dir).toBe('ltr');
    expect(h.wire.element.getAttribute('data-role')).toBe('speed-wire');
    expect(h.wire.slider.type).toBe('range');
    expect(h.wire.slider.getAttribute('data-role')).toBe('speed-slider');
    expect([h.wire.slider.min, h.wire.slider.max, h.wire.slider.step]).toEqual(['0.25', '2', '0.05']);
    expect(h.wire.slider.getAttribute('aria-label')).toBe('Playback speed');
    expect(h.wire.slider.getAttribute('aria-valuetext')).toBe('1×');
    expect(h.wire.element.contains(h.wire.slider)).toBe(true);
  });

  it('draws five pegs at equal distances on the line', () => {
    const pegs = [...h.wire.element.querySelectorAll('[data-role="wire-peg"]')];

    expect(pegs.map((peg) => num(peg, 'cx'))).toEqual([26, 73, 120, 167, 214]);
    expect(pegs.map((peg) => num(peg, 'cy'))).toEqual([MID, MID, MID, MID, MID]);
    expect(pegs.map((peg) => num(peg, 'r'))).toEqual([4.5, 4.5, 4.5, 4.5, 4.5]);
  });

  it('runs the wire 22 units past the first and last peg', () => {
    const start = part(h, 'wire-tail-start');
    const end = part(h, 'wire-tail-end');

    expect([num(start, 'x1'), num(start, 'x2')]).toEqual([4, 26]);
    expect([num(end, 'x1'), num(end, 'x2')]).toEqual([214, 236]);
  });

  it('rests the bead on the line at the current speed and lights the pegs behind it', () => {
    const bead = part(h, 'wire-bead');
    const passed = [...h.wire.element.querySelectorAll('[data-role="wire-peg"]')].map((peg) => peg.hasAttribute('data-passed'));

    expect(num(bead, 'cx')).toBeCloseTo(120, 3);
    expect(num(bead, 'cy')).toBeCloseTo(MID, 3);
    expect(num(bead, 'r')).toBeCloseTo(8, 3);
    expect(passed).toEqual([true, true, true, false, false]);
    expect(num(part(h, 'wire-lit'), 'x2')).toBeCloseTo(120, 3);
    expect(num(part(h, 'wire-dim'), 'x1')).toBeCloseTo(120, 3);
  });

  it('plucks the wire when the speed changes from outside, then comes to rest', () => {
    h.wire.sync(1.3);
    vi.advanceTimersByTime(32);

    // A faster speed kicks the wire up, a slower one down.
    expect(num(part(h, 'wire-bead'), 'cy')).toBeLessThan(MID - 0.5);

    settle();
    expect(num(part(h, 'wire-bead'), 'cx')).toBeCloseTo(26 + 0.65 * SPAN, 3);
    expect(num(part(h, 'wire-bead'), 'cy')).toBeCloseTo(MID, 3);
  });

  it('glides the bead to a new speed instead of jumping', () => {
    h.wire.sync(2);
    vi.advanceTimersByTime(32);
    const cx = num(part(h, 'wire-bead'), 'cx');

    expect(cx).toBeGreaterThan(120);
    expect(cx).toBeLessThan(214);
  });

  it('swells the bead when it lands on a peg, with no ripple and no pointer marker', () => {
    h.wire.sync(1.5);
    vi.advanceTimersByTime(32);

    expect(num(part(h, 'wire-bead'), 'r')).toBeGreaterThan(8);
    expect(h.wire.element.querySelector('[data-role*="ripple"], [data-role*="marker"], [data-role*="tether"]')).toBeNull();

    settle();
    expect(num(part(h, 'wire-bead'), 'r')).toBeCloseTo(8, 3);
  });

  it('does not swell for a speed between pegs', () => {
    h.wire.sync(1.2);
    vi.advanceTimersByTime(32);

    expect(num(part(h, 'wire-bead'), 'r')).toBeCloseTo(8, 3);
  });

  it('reports the speed under the pointer while dragging', () => {
    h.wire.element.dispatchEvent(at('pointerdown', 0.6));
    h.wire.element.dispatchEvent(at('pointermove', 0.85));

    expect(h.rates).toEqual([1.2, 1.7]);
    expect(h.wire.element.getAttribute('data-dragging')).toBe('true');
  });

  it('lets a peg grab the bead and hold it until the pointer pulls clear', () => {
    h.wire.element.dispatchEvent(at('pointerdown', 0.6));
    h.wire.element.dispatchEvent(at('pointermove', 0.72));
    h.wire.element.dispatchEvent(at('pointermove', 0.8));
    h.wire.element.dispatchEvent(at('pointermove', 0.84));

    expect(h.rates).toEqual([1.2, 1.5, 1.7]);
  });

  it('bends the wire toward the pointer, and straightens it after release', () => {
    h.wire.element.dispatchEvent(at('pointerdown', 0.6, 18));
    vi.advanceTimersByTime(400);

    expect(num(part(h, 'wire-bead'), 'cy')).toBeCloseTo(MID + 18, 0);

    h.wire.element.dispatchEvent(at('pointermove', 0.6, 60));
    vi.advanceTimersByTime(400);
    expect(num(part(h, 'wire-bead'), 'cy')).toBeCloseTo(MID + 22, 0);

    h.wire.element.dispatchEvent(at('pointerup', 0.6, 60));
    settle();
    expect(num(part(h, 'wire-bead'), 'cy')).toBeCloseTo(MID, 3);
    expect(h.wire.element.hasAttribute('data-dragging')).toBe(false);
  });

  it('shows a faint mirror of the wire only while it hums', () => {
    const ghost = part(h, 'wire-ghost');

    expect(ghost.hasAttribute('data-active')).toBe(false);

    h.wire.element.dispatchEvent(at('pointerdown', 0.6, 20));
    vi.advanceTimersByTime(300);
    expect(ghost.hasAttribute('data-active')).toBe(false);

    h.wire.element.dispatchEvent(at('pointerup', 0.6, 20));
    vi.advanceTimersByTime(32);
    expect(ghost.hasAttribute('data-active')).toBe(true);

    settle();
    expect(ghost.hasAttribute('data-active')).toBe(false);
  });

  it.each(['pointercancel', 'lostpointercapture'])('ends the drag on %s', (type) => {
    h.wire.element.dispatchEvent(at('pointerdown', 0.6, 15));
    h.wire.element.dispatchEvent(at(type, 0.6));
    h.wire.element.dispatchEvent(at('pointermove', 0.9));
    settle();

    expect(h.rates).toEqual([1.2]);
    expect(h.wire.element.hasAttribute('data-dragging')).toBe(false);
    expect(num(part(h, 'wire-bead'), 'cy')).toBeCloseTo(MID, 3);
  });

  it('ignores a move with no press and a press with another button', () => {
    h.wire.element.dispatchEvent(at('pointermove', 0.9));
    h.wire.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: 300, clientY: 80 }));

    expect(h.rates).toEqual([]);
  });

  it('steps from the keyboard through the range input', () => {
    h.wire.slider.value = '1.05';
    h.wire.slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(h.rates).toEqual([1.05]);
    expect(h.wire.slider.getAttribute('aria-valuetext')).toBe('1.05×');
  });

  it('steps by 0.05 with the wheel', () => {
    const wheel = (deltaY: number): void => {
      h.wire.element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }));
    };

    wheel(9);
    wheel(-18);
    expect(h.rates).toEqual([1.05, 0.95]);
  });

  it('keeps the page still while the wheel turns over it', () => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 9 });

    h.wire.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('carries wheel travel below one step over to the next event', () => {
    const wheel = (deltaY: number): void => {
      h.wire.element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }));
    };

    wheel(5);
    expect(h.rates).toEqual([]);
    wheel(5);
    expect(h.rates).toEqual([1.05]);
  });

  it('reads the wheel from whichever axis moved further', () => {
    h.wire.element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -9, deltaY: 2 }));
    expect(h.rates).toEqual([0.95]);
  });

  it('rounds partial backward wheel travel toward zero, not down a whole step', () => {
    h.wire.element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -8 }));
    expect(h.rates).toEqual([]);
  });

  it('a pointer press focuses the range and hides its ring until a key is used', () => {
    h.wire.element.dispatchEvent(at('pointerdown', 0.6));

    expect(h.wire.slider).toHaveFocus();
    expect(h.wire.element.hasAttribute('data-pointer-focus')).toBe(true);

    h.wire.slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(h.wire.element.hasAttribute('data-pointer-focus')).toBe(false);

    h.wire.element.dispatchEvent(at('pointerdown', 0.6));
    h.wire.slider.dispatchEvent(new Event('blur'));
    expect(h.wire.element.hasAttribute('data-pointer-focus')).toBe(false);
  });

  it('stops drawing once everything is at rest', () => {
    settle();
    h.frames.mockClear();
    vi.advanceTimersByTime(1000);

    expect(h.frames).not.toHaveBeenCalled();
  });

  it('rest() drops a drag and stops the frames', () => {
    h.wire.element.dispatchEvent(at('pointerdown', 0.6, 20));
    h.wire.rest();
    h.frames.mockClear();
    h.wire.element.dispatchEvent(at('pointermove', 0.9));
    vi.advanceTimersByTime(1000);

    expect(h.frames).not.toHaveBeenCalled();
    expect(h.rates).toEqual([1.2]);
    expect(num(part(h, 'wire-bead'), 'cy')).toBe(MID);
  });

  it('follows the speed silently while at rest', () => {
    h.wire.rest();
    h.frames.mockClear();
    h.wire.sync(2);

    expect(h.frames).not.toHaveBeenCalled();
    expect(num(part(h, 'wire-bead'), 'cx')).toBe(214);
    expect(num(part(h, 'wire-bead'), 'cy')).toBe(MID);
  });

  it('enter() shows the wire at rest: the bead is in place and nothing moves', () => {
    h.wire.rest();
    h.frames.mockClear();
    h.wire.enter();

    expect(h.frames).not.toHaveBeenCalled();
    expect(num(part(h, 'wire-bead'), 'cx')).toBe(120);
    expect(num(part(h, 'wire-bead'), 'cy')).toBe(MID);
    expect(part(h, 'wire-ghost').hasAttribute('data-active')).toBe(false);

    vi.advanceTimersByTime(500);
    expect(num(part(h, 'wire-bead'), 'cx')).toBe(120);
    expect(num(part(h, 'wire-bead'), 'cy')).toBe(MID);
  });

  it('still plucks for a change made after the wire is showing', () => {
    h.wire.rest();
    h.wire.enter();
    h.wire.sync(1.3);
    vi.advanceTimersByTime(32);

    expect(num(part(h, 'wire-bead'), 'cy')).toBeLessThan(MID - 0.5);
  });

  it('destroy() stops the frames', () => {
    h.wire.sync(2);
    h.wire.destroy();
    h.frames.mockClear();
    vi.advanceTimersByTime(1000);

    expect(h.frames).not.toHaveBeenCalled();
  });
});

describe('speed wire — after destroy', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('reports nothing more from the keyboard, the wheel or the pointer', () => {
    const h = mount(true);

    h.wire.sync(1);
    h.wire.destroy();
    h.wire.slider.value = '2';
    h.wire.slider.dispatchEvent(new Event('input', { bubbles: true }));
    h.wire.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true }));
    h.wire.element.dispatchEvent(at('pointerdown', 0.75));

    expect(h.rates).toEqual([]);
  });
});

describe('speed wire — reduced motion', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('never schedules a frame and lands at once', () => {
    const h = mount(true);

    h.wire.sync(1);
    h.wire.enter();
    h.wire.sync(1.5);
    h.wire.element.dispatchEvent(at('pointerdown', 0.6, 20));

    expect(h.frames).not.toHaveBeenCalled();
    expect(num(part(h, 'wire-bead'), 'cx')).toBeCloseTo(26 + 0.6 * SPAN, 3);
    expect(num(part(h, 'wire-bead'), 'cy')).toBe(MID);
    expect(num(part(h, 'wire-bead'), 'r')).toBe(8);
    h.wire.destroy();
  });
});

describe('speed wire — class prefix', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const classes = (wire: SpeedWire): string[] =>
    [wire.element, wire.slider, ...wire.element.querySelectorAll('svg, [data-role]')]
      .map((node) => node.getAttribute('class') ?? '');

  it('names its parts for the video player by default', () => {
    const wire = createSpeedWire({ label: 'Playback speed', reducedMotion: true, onRate: () => undefined });

    expect(classes(wire).every((name) => name.startsWith('blok-video-controls__'))).toBe(true);
    wire.destroy();
  });

  it('names every part with the prefix of the player that hosts it', () => {
    const wire = createSpeedWire({
      label: 'Playback speed',
      reducedMotion: true,
      classPrefix: 'blok-audio-controls',
      onRate: () => undefined,
    });

    expect(wire.element.className).toBe('blok-audio-controls__speed-wire');
    expect(wire.slider.className).toBe('blok-audio-controls__speed-slider');
    expect(wire.element.querySelector('[data-role="wire-bead"]')?.getAttribute('class')).toBe('blok-audio-controls__wire-bead');
    expect(classes(wire).every((name) => name.startsWith('blok-audio-controls__'))).toBe(true);
    wire.destroy();
  });
});
