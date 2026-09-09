import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlinePositioner } from '../../../../../../src/components/modules/toolbar/inline/positioner';

describe('InlinePositioner selection-start alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('innerWidth', 1920);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    { name: 'narrow editor', selectionX: 666, contentRight: 928, wrapperX: 608, expectedLeft: '58px' },
    { name: 'selection near the content edge', selectionX: 850, contentRight: 1000, wrapperX: 400, expectedLeft: '450px' },
    { name: 'viewport-positioned toolbar', selectionX: 666, contentRight: 928, wrapperX: 0, expectedLeft: '666px' },
  ])('starts at the selection in a $name when the viewport has room', ({ selectionX, contentRight, wrapperX, expectedLeft }) => {
    const wrapper = document.createElement('div');

    new InlinePositioner(false).apply({
      wrapper,
      selectionRect: new DOMRect(selectionX, 200, 150, 24),
      wrapperOffset: new DOMRect(wrapperX, 100, 320, 500),
      contentRect: new DOMRect(600, 100, contentRight - 600, 500),
      popoverWidth: 450,
    });

    expect(wrapper.style.left).toBe(expectedLeft);
  });

  it('shifts left only as far as the viewport edge requires', () => {
    const wrapper = document.createElement('div');

    new InlinePositioner(false).apply({
      wrapper,
      selectionRect: new DOMRect(1600, 200, 150, 24),
      wrapperOffset: new DOMRect(1400, 100, 320, 500),
      contentRect: new DOMRect(1400, 100, 320, 500),
      popoverWidth: 450,
    });

    expect(wrapper.style.left).toBe('62px');
  });
});
