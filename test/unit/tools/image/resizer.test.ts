import { describe, it, expect } from 'vitest';
import { computeWidthPercent, clampPercent, attachResizeHandle } from '../../../../src/tools/image/resizer';

describe('clampPercent', () => {
  it('clamps below MIN to 10', () => {
    expect(clampPercent(5)).toBe(10);
  });
  it('clamps above MAX to 100', () => {
    expect(clampPercent(150)).toBe(100);
  });
  it('passes through in-range', () => {
    expect(clampPercent(42)).toBe(42);
  });
});

describe('computeWidthPercent', () => {
  it('right-edge drag: percent = (dragX - originX) / containerWidth * 100', () => {
    expect(computeWidthPercent({ edge: 'right', containerWidth: 1000, dragX: 500, originX: 0 })).toBe(50);
  });
  it('right-edge drag past full width clamps to 100', () => {
    expect(computeWidthPercent({ edge: 'right', containerWidth: 1000, dragX: 1500, originX: 0 })).toBe(100);
  });
  it('left-edge drag: width shrinks as dragX moves right relative to origin', () => {
    expect(computeWidthPercent({ edge: 'left', containerWidth: 1000, dragX: 200, originX: 0 })).toBe(80);
  });
});

describe('attachResizeHandle', () => {
  it('reports new percent on pointermove and commits on pointerup', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const handle = document.createElement('div');
    container.appendChild(handle);
    handle.setPointerCapture = () => undefined;
    handle.releasePointerCapture = () => undefined;

    const updates: number[] = [];
    let committed: number | undefined;
    const detach = attachResizeHandle({
      handle,
      container,
      edge: 'right',
      onPreview: (p) => updates.push(p),
      onCommit: (p) => { committed = p; },
    });

    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1000, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 500, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 500, bubbles: true }));

    expect(updates).toContain(50);
    expect(committed).toBe(50);
    detach();
  });
});
