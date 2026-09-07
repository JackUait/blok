import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlinePositioner } from '../../../../../../src/components/modules/toolbar/inline/positioner';

describe('compact toolbar viewport placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([320, 390, 1280])('keeps a toolbar wider than its editor inside a %ipx viewport', (width) => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', 620);
    const wrapper = document.createElement('div');
    const toolbarWidth = Math.min(440, width - 16);
    const positioner = new InlinePositioner(width <= 650);

    positioner.apply({
      wrapper,
      selectionRect: new DOMRect(12, 200, 30, 20),
      wrapperOffset: new DOMRect(8, 20, 120, 500),
      contentRect: new DOMRect(8, 20, 120, 500),
      popoverWidth: toolbarWidth,
    });

    const viewportLeft = Number.parseFloat(wrapper.style.left) + 8;

    expect(viewportLeft).toBeGreaterThanOrEqual(8);
    expect(viewportLeft + toolbarWidth).toBeLessThanOrEqual(width - 8);
  });

  it('keeps the two-row toolbar visible across viewport edges and scroll offsets', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 620);
    const positioner = new InlinePositioner(true);

    const positions = [0, 8, 120, 360, 385].flatMap(x =>
      [0, 8, 300, 580, 600].flatMap(y =>
        [-400, 0, 40].map(offset => ({ x, y, offset }))));

    for (const { x, y, offset } of positions) {
      const wrapper = document.createElement('div');
      const options = {
        wrapper,
        selectionRect: new DOMRect(x, y, 5, 12),
        wrapperOffset: new DOMRect(0, offset, 390, 900),
        contentRect: new DOMRect(8, offset, 374, 900),
        popoverWidth: 304,
        popoverHeight: 94,
      };

      positioner.apply(options);
      const top = Number.parseFloat(wrapper.style.top) + offset;

      expect(top).toBeGreaterThanOrEqual(8);
      expect(top + 94).toBeLessThanOrEqual(612);
    }
  });
});
