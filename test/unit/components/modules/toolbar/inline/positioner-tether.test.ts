import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlinePositioner } from '../../../../../../src/components/modules/toolbar/inline/positioner';

describe('InlinePositioner.tether', () => {
  let wrapper: HTMLElement;
  let root: HTMLElement;

  /** The wrapper sits in an offset parent at (40, 100), so its style and its box differ. */
  const tether = (selectionRect: DOMRect, menuHeight = 120): void => {
    new InlinePositioner(false).tether({
      wrapper,
      root,
      selectionRect,
      wrapperRect: new DOMRect(140, 326, 0, 0),
      menuHeight,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    wrapper = document.createElement('div');
    wrapper.style.left = '100px';
    wrapper.style.top = '226px';
    root = document.createElement('div');
    wrapper.appendChild(root);
    document.body.appendChild(wrapper);
  });

  afterEach(() => {
    wrapper.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('moves the menu origin to the centre of the text, 11px under it', () => {
    tether(new DOMRect(140, 300, 100, 20));

    // Centre x=190 is 50px right of the wrapper box; the text bottom (320) + 11 is 5px under it.
    expect(wrapper.style.left).toBe('150px');
    expect(wrapper.style.top).toBe('231px');
    expect(root.getAttribute('data-blok-inline-tether')).toBe('below');
  });

  it('tells the stylesheet where the origin is in the viewport', () => {
    tether(new DOMRect(140, 300, 100, 20));

    expect(root.style.getPropertyValue('--_blok-tether-centre-x')).toBe('190px');
  });

  it('hangs the menu above the text when there is no room below', () => {
    tether(new DOMRect(140, 500, 100, 20));

    // The origin is 11px over the text top (500); the wrapper box was at y=326.
    expect(wrapper.style.top).toBe(`${226 + 489 - 326}px`);
    expect(root.getAttribute('data-blok-inline-tether')).toBe('above');
  });

  it('stays below when the menu fits on neither side', () => {
    tether(new DOMRect(140, 300, 100, 20), 500);

    expect(root.getAttribute('data-blok-inline-tether')).toBe('below');
  });
});
