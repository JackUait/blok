import { describe, it, expect } from 'vitest';
import {
  computeWidthPercent,
  clampPercent,
  attachResizeHandle,
  alignmentFraction,
} from '../../../../src/tools/image/resizer';

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

  it('right-edge grows by pointer delta (left-anchored)', () => {
    expect(
      computeWidthPercent({
        edge: 'right',
        containerWidth: 1000,
        startWidth: 500,
        startX: 600,
        currentX: 700,
        alignFrac: 0,
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

  it('left-edge grows when pointer moves left of startX (right-anchored)', () => {
    expect(
      computeWidthPercent({
        edge: 'left',
        containerWidth: 1000,
        startWidth: 500,
        startX: 100,
        currentX: 0,
        alignFrac: 1,
      })
    ).toBe(60);
  });

  it('right-edge center-anchored doubles delta (symmetric resize)', () => {
    expect(
      computeWidthPercent({
        edge: 'right',
        containerWidth: 1000,
        startWidth: 500,
        startX: 600,
        currentX: 700,
        alignFrac: 0.5,
      })
    ).toBe(70);
  });

  it('left-edge center-anchored doubles delta (symmetric resize)', () => {
    expect(
      computeWidthPercent({
        edge: 'left',
        containerWidth: 1000,
        startWidth: 500,
        startX: 100,
        currentX: 0,
        alignFrac: 0.5,
      })
    ).toBe(70);
  });

  it('right-edge on right-anchored figure falls back to 1x (no division by zero)', () => {
    expect(
      computeWidthPercent({
        edge: 'right',
        containerWidth: 1000,
        startWidth: 500,
        startX: 600,
        currentX: 700,
        alignFrac: 1,
      })
    ).toBe(60);
  });

  it('left-edge on left-anchored figure falls back to 1x (no division by zero)', () => {
    expect(
      computeWidthPercent({
        edge: 'left',
        containerWidth: 1000,
        startWidth: 500,
        startX: 100,
        currentX: 0,
        alignFrac: 0,
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

  it('captures starting width on pointerdown so first move does not jump (center symmetric)', () => {
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

    expect(updates[updates.length - 1]).toBe(70);
    expect(committed).toBe(70);
    detach();
  });

  it('left-edge grows symmetrically as pointer moves left (center default)', () => {
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

    expect(updates[updates.length - 1]).toBe(70);
    detach();
  });

  it('does not apply translateX on center alignment (auto-centering handles symmetry)', () => {
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

    const detach = attachResizeHandle({
      handle,
      figure,
      container: parent,
      edge: 'right',
      alignment: 'center',
      onPreview: () => undefined,
      onCommit: () => undefined,
    });

    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 750, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 850, bubbles: true }));

    expect(figure.style.transform).toBe('');

    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 850, bubbles: true }));

    expect(figure.style.transform).toBe('');
    detach();
  });

  it('left-aligned right handle grows 1x (anchored at left)', () => {
    const parent = document.createElement('div');
    const figure = document.createElement('div');
    parent.appendChild(figure);
    Object.defineProperty(parent, 'getBoundingClientRect', {
      value: () => makeRect(1000, 0),
    });
    Object.defineProperty(figure, 'getBoundingClientRect', {
      value: () => makeRect(500, 0),
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
      edge: 'right',
      alignment: 'left',
      onPreview: (p) => updates.push(p),
      onCommit: () => undefined,
    });

    handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 500, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 600, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 600, bubbles: true }));

    expect(updates[updates.length - 1]).toBe(60);
    expect(figure.style.transform).toBe('');
    detach();
  });
});

describe('alignmentFraction', () => {
  it('maps left to 0', () => {
    expect(alignmentFraction('left')).toBe(0);
  });
  it('maps center to 0.5', () => {
    expect(alignmentFraction('center')).toBe(0.5);
  });
  it('maps right to 1', () => {
    expect(alignmentFraction('right')).toBe(1);
  });
});

