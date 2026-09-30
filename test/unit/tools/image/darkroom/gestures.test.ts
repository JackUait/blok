import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachGestures, HOLD_MS, WHEEL_IDLE_MS, type GestureHandlers } from '../../../../../src/tools/image/darkroom/gestures';

const handlers = (): GestureHandlers => ({
  onStart: vi.fn(), onPan: vi.fn(), onHandle: vi.fn(), onZoom: vi.fn(), onEnd: vi.fn(), onPeek: vi.fn(),
});

const fire = (el: Element, type: string, init: PointerEventInit): void => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
};

describe('darkroom gestures', () => {
  let stage: HTMLElement;
  let detach: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stage = document.createElement('div');
    document.body.appendChild(stage);
  });

  afterEach(() => {
    detach();
    stage.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a drag past the slop pans with the total delta', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { clientX: 100, clientY: 100 });
    fire(stage, 'pointermove', { clientX: 102, clientY: 100 });
    expect(h.onStart).not.toHaveBeenCalled();
    fire(stage, 'pointermove', { clientX: 130, clientY: 90 });
    fire(stage, 'pointerup', { clientX: 130, clientY: 90 });

    expect(h.onStart).toHaveBeenCalledWith('pan');
    expect(h.onPan).toHaveBeenLastCalledWith(30, -10);
    expect(h.onEnd).toHaveBeenCalledWith('pan');
  });

  it('holding still peeks, and release ends the peek without a pan', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(HOLD_MS);
    expect(h.onPeek).toHaveBeenLastCalledWith(true);
    fire(stage, 'pointerup', { clientX: 100, clientY: 100 });

    expect(h.onPeek).toHaveBeenLastCalledWith(false);
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('moving before the hold fires cancels the peek', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { clientX: 100, clientY: 100 });
    fire(stage, 'pointermove', { clientX: 120, clientY: 100 });
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(h.onPeek).not.toHaveBeenCalled();
  });

  it('a press on a handle resizes with that handle', () => {
    const h = handlers();
    const handle = document.createElement('span');

    handle.setAttribute('data-handle', 'se');
    stage.appendChild(handle);
    detach = attachGestures(stage, h);
    fire(handle, 'pointerdown', { clientX: 10, clientY: 10 });
    fire(handle, 'pointermove', { clientX: 5, clientY: 0 });
    fire(handle, 'pointerup', { clientX: 5, clientY: 0 });

    expect(h.onStart).toHaveBeenCalledWith('handle');
    expect(h.onHandle).toHaveBeenLastCalledWith('se', -5, -10);
    expect(h.onEnd).toHaveBeenCalledWith('handle');
  });

  it('two pointers pinch-zoom around their midpoint', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    fire(stage, 'pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    fire(stage, 'pointermove', { pointerId: 2, clientX: 300, clientY: 100 });

    expect(h.onStart).toHaveBeenCalledWith('zoom');
    const [factor, center] = vi.mocked(h.onZoom).mock.calls[0];

    expect(factor).toBeCloseTo(2, 6);
    expect(center).toEqual({ x: 200, y: 100 });
  });

  it('a ctrl+wheel burst is one zoom gesture that ends after idle', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 50, clientY: 60, cancelable: true }));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 50, clientY: 60, cancelable: true }));
    vi.advanceTimersByTime(WHEEL_IDLE_MS);

    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onZoom).toHaveBeenCalledTimes(2);
    expect(vi.mocked(h.onZoom).mock.calls[0][0]).toBeGreaterThan(1);
    expect(h.onEnd).toHaveBeenCalledWith('zoom');
  });
});
