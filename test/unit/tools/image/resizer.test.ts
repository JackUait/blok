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
  it('right-edge with zero delta returns starting percent', () => {
    expect(
      computeWidthPercent({
        edge: 'right',
        containerWidth: 1000,
        startWidth: 500,
        startX: 600,
        currentX: 600,
      })
    ).toBe(50);
  });

  it('right-edge grows by pointer delta', () => {
    expect(
      computeWidthPercent({
        edge: 'right',
        containerWidth: 1000,
        startWidth: 500,
        startX: 600,
        currentX: 700,
      })
    ).toBe(60);
  });

  it('left-edge with zero delta returns starting percent', () => {
    expect(
      computeWidthPercent({
        edge: 'left',
        containerWidth: 1000,
        startWidth: 500,
        startX: 100,
        currentX: 100,
      })
    ).toBe(50);
  });

  it('left-edge grows when pointer moves left of startX', () => {
    expect(
      computeWidthPercent({
        edge: 'left',
        containerWidth: 1000,
        startWidth: 500,
        startX: 100,
        currentX: 0,
      })
    ).toBe(60);
  });

  it('clamps to 100 when delta exceeds container', () => {
    expect(
      computeWidthPercent({
        edge: 'right',
        containerWidth: 1000,
        startWidth: 500,
        startX: 600,
        currentX: 5000,
      })
    ).toBe(100);
  });
});

describe('attachResizeHandle', () => {
  function makeRect(width: number, left = 0): DOMRect {
    return {
      left,
      right: left + width,
      width,
      top: 0,
      bottom: 100,
      height: 100,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  it('captures starting width on pointerdown so first move does not jump', () => {
    const parent = document.createElement('div');
    const figure = document.createElement('div');
    parent.appendChild(figure);
    Object.defineProperty(parent, 'getBoundingClientRect', {
      value: () => makeRect(1000, 0),
    });
    Object.defineProperty(figure, 'getBoundingClientRect', {
      value: () => makeRect(500, 250),
    });
    const handle = document.createElement('div');
    figure.appendChild(handle);
    handle.setPointerCapture = (): void => undefined;
    handle.releasePointerCapture = (): void => undefined;

    const updates: number[] = [];
    let committed: number | undefined;
    const detach = attachResizeHandle({
      handle,
      figure,
      container: parent,
      edge: 'right',
      onPreview: (p) => updates.push(p),
      onCommit: (p) => { committed = p; },
    });

    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 750, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 750, bubbles: true }));

    expect(updates[0]).toBe(50);

    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 850, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 850, bubbles: true }));

    expect(updates[updates.length - 1]).toBe(60);
    expect(committed).toBe(60);
    detach();
  });

  it('left-edge grows as pointer moves left', () => {
    const parent = document.createElement('div');
    const figure = document.createElement('div');
    parent.appendChild(figure);
    Object.defineProperty(parent, 'getBoundingClientRect', {
      value: () => makeRect(1000, 0),
    });
    Object.defineProperty(figure, 'getBoundingClientRect', {
      value: () => makeRect(500, 250),
    });
    const handle = document.createElement('div');
    figure.appendChild(handle);
    handle.setPointerCapture = (): void => undefined;
    handle.releasePointerCapture = (): void => undefined;

    const updates: number[] = [];
    const detach = attachResizeHandle({
      handle,
      figure,
      container: parent,
      edge: 'left',
      onPreview: (p) => updates.push(p),
      onCommit: () => undefined,
    });

    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 250, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 150, bubbles: true }));

    expect(updates[updates.length - 1]).toBe(60);
    detach();
  });
});
