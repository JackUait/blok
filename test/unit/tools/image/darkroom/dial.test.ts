import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDial, type Dial, type DialOptions } from '../../../../../src/tools/image/darkroom/dial';

const PX_PER_UNIT = 6;

const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

  el.dispatchEvent(e);

  return e;
};

const pointer = (el: Element, type: string, init: PointerEventInit = {}): void => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }));
};

describe('createDial', () => {
  let dial: Dial;
  let onInput: ReturnType<typeof vi.fn<(v: number) => void>>;
  let onCommit: ReturnType<typeof vi.fn<(v: number) => void>>;

  const make = (over: Partial<DialOptions> = {}): Dial => {
    dial = createDial({
      min: -45,
      max: 45,
      value: 0,
      label: 'Straighten',
      valueText: (v) => `${v} degrees`,
      onInput,
      onCommit,
      ...over,
    });
    document.body.appendChild(dial.el);

    return dial;
  };

  const ruler = (): HTMLElement => {
    const el = dial.el.querySelector<HTMLElement>('[data-role="dial-ruler"]');

    if (el === null) throw new Error('no ruler');

    return el;
  };

  const shown = (): string => dial.el.querySelector('[data-role="dial-value"]')?.textContent ?? '';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    onInput = vi.fn<(v: number) => void>();
    onCommit = vi.fn<(v: number) => void>();
  });

  afterEach(() => {
    dial.destroy();
    dial.el.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is a focusable slider with its range, value and name', () => {
    make({ value: 10 });

    expect(dial.el.getAttribute('role')).toBe('slider');
    expect(dial.el.getAttribute('tabindex')).toBe('0');
    expect(dial.el.getAttribute('aria-label')).toBe('Straighten');
    expect(dial.el.getAttribute('aria-valuemin')).toBe('-45');
    expect(dial.el.getAttribute('aria-valuemax')).toBe('45');
    expect(dial.el.getAttribute('aria-valuenow')).toBe('10');
    expect(dial.el.getAttribute('aria-valuetext')).toBe('10 degrees');
    expect(dial.el.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('arrows step by one, Shift steps by five, and each change is reported', () => {
    make();

    key(dial.el, 'ArrowRight');
    expect(onInput).toHaveBeenLastCalledWith(1);
    key(dial.el, 'ArrowUp');
    expect(onInput).toHaveBeenLastCalledWith(2);
    key(dial.el, 'ArrowLeft', { shiftKey: true });
    expect(onInput).toHaveBeenLastCalledWith(-3);
    key(dial.el, 'ArrowDown');
    expect(onInput).toHaveBeenLastCalledWith(-4);
    expect(dial.el.getAttribute('aria-valuenow')).toBe('-4');
    expect(dial.el.getAttribute('aria-valuetext')).toBe('-4 degrees');
  });

  it('PageUp and PageDown take the big step; custom steps are honoured', () => {
    make({ step: 2, bigStep: 10 });

    key(dial.el, 'PageUp');
    expect(onInput).toHaveBeenLastCalledWith(10);
    key(dial.el, 'PageDown');
    key(dial.el, 'PageDown');
    expect(onInput).toHaveBeenLastCalledWith(-10);
    key(dial.el, 'ArrowRight');
    expect(onInput).toHaveBeenLastCalledWith(-8);
  });

  it('Home returns to zero, clamped into the range; End does nothing', () => {
    make({ value: 30 });
    key(dial.el, 'Home');
    expect(onInput).toHaveBeenLastCalledWith(0);
    dial.destroy();
    dial.el.remove();

    make({ min: 10, max: 50, value: 30 });
    key(dial.el, 'Home');
    expect(onInput).toHaveBeenLastCalledWith(10);
    onInput.mockClear();
    const end = key(dial.el, 'End');

    expect(onInput).not.toHaveBeenCalled();
    expect(end.defaultPrevented).toBe(false);
  });

  it('stays inside the range and reports nothing at an edge', () => {
    make({ value: 44 });

    key(dial.el, 'ArrowRight', { shiftKey: true });
    expect(onInput).toHaveBeenLastCalledWith(45);
    onInput.mockClear();
    key(dial.el, 'ArrowRight');
    expect(onInput).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a key burst commits once, 250 ms after the last key', () => {
    make();

    key(dial.el, 'ArrowRight');
    vi.advanceTimersByTime(200);
    key(dial.el, 'ArrowRight');
    vi.advanceTimersByTime(249);
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(2);
  });

  it('handled keys stop the page from scrolling', () => {
    make();

    expect(key(dial.el, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(key(dial.el, 'PageUp').defaultPrevented).toBe(true);
  });

  it('flush() commits a pending key burst now, and only once', () => {
    make();

    key(dial.el, 'ArrowRight');
    dial.flush();
    expect(onCommit).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('set() moves the dial silently and drops a pending key commit', () => {
    make();

    key(dial.el, 'ArrowRight');
    onInput.mockClear();
    dial.set(-12);
    vi.advanceTimersByTime(1000);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onInput).not.toHaveBeenCalled();
    expect(dial.el.getAttribute('aria-valuenow')).toBe('-12');
    expect(ruler().style.transform).toBe(`translateX(${12 * PX_PER_UNIT}px)`);
  });

  it('the ruler scrolls under the needle by six px per unit and the label shows the value', () => {
    make({ value: 7 });

    expect(ruler().style.transform).toBe(`translateX(${-7 * PX_PER_UNIT}px)`);
    expect(shown()).toBe('+7');
    dial.set(-3);
    expect(shown()).toBe('−3');
    dial.set(0);
    expect(shown()).toBe('0');
    expect(dial.el.querySelector('[data-role="dial-needle"]')).not.toBeNull();
  });

  it('draws a tick every 5 units, a long one every 15', () => {
    make();
    const ticks = [...dial.el.querySelectorAll<HTMLElement>('[data-role="dial-tick"]')];

    expect(ticks).toHaveLength(19);
    expect(ticks.filter((t) => t.hasAttribute('data-major'))).toHaveLength(7);
    const zero = ticks.find((t) => t.dataset.value === '0');
    const fifteen = ticks.find((t) => t.dataset.value === '15');

    expect(zero?.hasAttribute('data-major')).toBe(true);
    expect(fifteen?.style.left).toBe(`${15 * PX_PER_UNIT}px`);
    expect(ticks.find((t) => t.dataset.value === '5')?.hasAttribute('data-major')).toBe(false);
  });

  it('dragging the ruler left raises the value, one unit per 6 px, then commits once', () => {
    make();
    const capture = vi.fn();

    dial.el.setPointerCapture = capture;
    pointer(dial.el, 'pointerdown', { clientX: 300, pointerType: 'mouse', button: 0 });
    pointer(dial.el, 'pointermove', { clientX: 300 - 6 * 4 });
    expect(onInput).toHaveBeenLastCalledWith(4);
    pointer(dial.el, 'pointermove', { clientX: 300 + 6 * 10 });
    expect(onInput).toHaveBeenLastCalledWith(-10);
    expect(onCommit).not.toHaveBeenCalled();
    pointer(dial.el, 'pointerup', { clientX: 300 + 6 * 10 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(-10);
    expect(capture).toHaveBeenCalledWith(1);
  });

  it('a drag stays in range', () => {
    make();

    pointer(dial.el, 'pointerdown', { clientX: 0 });
    pointer(dial.el, 'pointermove', { clientX: -6 * 100 });
    expect(onInput).toHaveBeenLastCalledWith(45);
  });

  it('a drag snaps to zero within one unit (detent)', () => {
    make({ value: 5, step: 0.1 });

    pointer(dial.el, 'pointerdown', { clientX: 0 });
    pointer(dial.el, 'pointermove', { clientX: 6 * 4.4 });
    expect(onInput).toHaveBeenLastCalledWith(0);
    pointer(dial.el, 'pointermove', { clientX: 6 * 3.5 });
    expect(onInput).toHaveBeenLastCalledWith(1.5);
  });

  it('the detent never leaves a range that excludes zero', () => {
    make({ min: 0.5, max: 10, value: 5, step: 0.1 });

    pointer(dial.el, 'pointerdown', { clientX: 0 });
    pointer(dial.el, 'pointermove', { clientX: 6 * 4.5 });
    expect(onInput).toHaveBeenLastCalledWith(0.5);
  });

  it('a cancelled drag still commits', () => {
    make();

    pointer(dial.el, 'pointerdown', { clientX: 0 });
    pointer(dial.el, 'pointermove', { clientX: -12 });
    pointer(dial.el, 'pointercancel', {});
    expect(onCommit).toHaveBeenCalledWith(2);
    pointer(dial.el, 'pointermove', { clientX: -60 });
    expect(onInput).toHaveBeenLastCalledWith(2);
  });

  it('a press without movement commits nothing', () => {
    make();

    pointer(dial.el, 'pointerdown', { clientX: 0 });
    pointer(dial.el, 'pointerup', { clientX: 0 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a pending key commit lands before a drag starts', () => {
    make();

    key(dial.el, 'ArrowRight');
    pointer(dial.el, 'pointerdown', { clientX: 0 });
    expect(onCommit).toHaveBeenCalledWith(1);
    pointer(dial.el, 'pointermove', { clientX: -6 });
    pointer(dial.el, 'pointerup', {});
    vi.advanceTimersByTime(1000);
    expect(onCommit.mock.calls).toEqual([[1], [2]]);
  });

  it('ignores a right click and a second finger', () => {
    make();

    pointer(dial.el, 'pointerdown', { clientX: 0, pointerType: 'mouse', button: 2 });
    pointer(dial.el, 'pointermove', { clientX: -60 });
    expect(onInput).not.toHaveBeenCalled();

    pointer(dial.el, 'pointerdown', { clientX: 0, pointerType: 'touch' });
    pointer(dial.el, 'pointerdown', { clientX: 0, pointerType: 'touch', pointerId: 2 });
    pointer(dial.el, 'pointermove', { clientX: -600, pointerId: 2 });
    expect(onInput).not.toHaveBeenCalled();
    pointer(dial.el, 'pointermove', { clientX: -6 });
    expect(onInput).toHaveBeenLastCalledWith(1);
  });

  it('configure() swaps range, name and value on the same element without callbacks', () => {
    make();
    const el = dial.el;

    dial.configure({ min: -100, max: 100, value: 40, label: 'Contrast', valueText: (v) => `${v}%` });
    expect(dial.el).toBe(el);
    expect(el.getAttribute('aria-valuemin')).toBe('-100');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
    expect(el.getAttribute('aria-valuenow')).toBe('40');
    expect(el.getAttribute('aria-valuetext')).toBe('40%');
    expect(el.getAttribute('aria-label')).toBe('Contrast');
    expect(el.querySelectorAll('[data-role="dial-tick"]')).toHaveLength(41);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('configure() commits a pending key burst under the old setup first', () => {
    make();

    key(dial.el, 'ArrowRight');
    dial.configure({ min: -100, max: 100, value: 0, label: 'Contrast', valueText: String });
    expect(onCommit).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('destroy() drops timers and listeners', () => {
    make();

    key(dial.el, 'ArrowRight');
    dial.destroy();
    vi.advanceTimersByTime(1000);
    expect(onCommit).not.toHaveBeenCalled();
    onInput.mockClear();
    key(dial.el, 'ArrowRight');
    pointer(dial.el, 'pointerdown', { clientX: 0 });
    pointer(dial.el, 'pointermove', { clientX: -60 });
    expect(onInput).not.toHaveBeenCalled();
  });
});
