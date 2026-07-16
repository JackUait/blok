import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { positionAnchored } from '../../../src/components/utils/popover/anchored-position';

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
  ...overrides,
});

/**
 * Stubs offsetWidth/offsetHeight on an element (jsdom reports 0 for both).
 * @param el - element to stub
 * @param width - width to report
 * @param height - height to report
 */
const stubSize = (el: HTMLElement, width: number, height: number): void => {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
};

describe('positionAnchored — horizontal boundary handling', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;
  let originalScrollY: number;

  beforeEach(() => {
    vi.clearAllMocks();

    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    originalScrollY = window.scrollY;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720, writable: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth, writable: true });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight, writable: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: originalScrollY, writable: true });

    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['body', () => document.body],
    ['document element', () => document.documentElement],
  ] as const)('treats the %s boundary as the live viewport', (_label, getBoundary) => {
    const content = document.createElement('div');

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1800, writable: true });
    stubSize(content, 298, 368);
    document.body.appendChild(content);
    vi.spyOn(getBoundary(), 'getBoundingClientRect').mockReturnValue(
      rect({ top: -1800, bottom: -1080, left: 0, right: 1024, width: 1024, height: 720 })
    );

    const anchor = rect({ top: 468, bottom: 492, left: 24, right: 42, width: 18, height: 24 });
    const resolved = positionAnchored(content, anchor, { side: 'left', boundary: getBoundary() });

    expect(resolved.top - window.scrollY).toBe(296);
  });

  it('preserves an explicit non-root element as the collision boundary', () => {
    const content = document.createElement('div');
    const boundary = document.createElement('section');

    stubSize(content, 100, 300);
    document.body.append(content, boundary);
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue(
      rect({ top: 100, bottom: 400, left: 0, right: 1024, width: 1024, height: 300 })
    );

    const anchor = rect({ top: 250, bottom: 350, left: 50, right: 150, width: 100, height: 100 });
    const resolved = positionAnchored(content, anchor, { side: 'right', align: 'center', boundary });

    expect(resolved.top - window.scrollY).toBe(108);
  });

  it('flips to the left when the content overflows the boundary right edge even though the window has room', () => {
    const content = document.createElement('div');

    stubSize(content, 200, 100);
    document.body.appendChild(content);

    const anchor = rect({ top: 100, bottom: 300, left: 250, right: 350, width: 100, height: 200 });
    // Boundary ends at x=500: 500 - 350 + overlap(4) = 154px on the right — the
    // 200px content does not fit there, but it does fit in the 250px on the left.
    const boundary = rect({ top: 0, bottom: 768, left: 0, right: 500, width: 500, height: 768 });

    const resolved = positionAnchored(content, anchor, { side: 'right', boundary });

    expect(resolved.side).toBe('left');
    expect(content.dataset.side).toBe('left');
    // openLeft: anchor.left - width + overlap = 250 - 200 + 4 = 54
    expect(resolved.left).toBe(54);
  });

  it('measures left-side space from the boundary left edge, not the viewport', () => {
    const content = document.createElement('div');

    stubSize(content, 200, 100);
    document.body.appendChild(content);

    // 250px between viewport left and anchor, but only 50px inside the boundary.
    const anchor = rect({ top: 100, bottom: 300, left: 250, right: 350, width: 100, height: 200 });
    const boundary = rect({ top: 0, bottom: 768, left: 200, right: 1024, width: 824, height: 768 });

    const resolved = positionAnchored(content, anchor, { side: 'left', boundary });

    // Preferred left does not fit inside the boundary (50px), the right does (678px).
    expect(resolved.side).toBe('right');
    expect(content.dataset.side).toBe('right');
  });

  it('clamps the cross-axis top to the boundary bottom instead of the viewport bottom', () => {
    const content = document.createElement('div');

    stubSize(content, 100, 300);
    document.body.appendChild(content);

    const anchor = rect({ top: 250, bottom: 350, left: 50, right: 150, width: 100, height: 100 });
    // Centered placement would put the content at top=150..450 — fine for the
    // 768px viewport, but past the boundary bottom (400).
    const boundary = rect({ top: 0, bottom: 400, left: 0, right: 1024, width: 1024, height: 400 });

    const resolved = positionAnchored(content, anchor, { side: 'right', align: 'center', boundary });

    // Clamped: boundary.bottom - height - margin(8) = 400 - 300 - 8 = 92
    expect(resolved.top).toBe(92);
  });

  it('clamps the cross-axis top to the boundary top instead of the viewport top', () => {
    const content = document.createElement('div');

    stubSize(content, 100, 200);
    document.body.appendChild(content);

    const anchor = rect({ top: 110, bottom: 150, left: 50, right: 150, width: 100, height: 40 });
    // Centered placement puts the content at top=30, above the boundary top (100).
    const boundary = rect({ top: 100, bottom: 768, left: 0, right: 1024, width: 1024, height: 668 });

    const resolved = positionAnchored(content, anchor, { side: 'right', align: 'center', boundary });

    // Floor: boundary.top + margin(8) = 108
    expect(resolved.top).toBe(108);
  });
});
