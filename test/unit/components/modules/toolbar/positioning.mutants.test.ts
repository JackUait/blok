import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import { ToolbarPositioner } from '../../../../../src/components/modules/toolbar/positioning';
import type { PositioningOptions, ToolbarNodes } from '../../../../../src/components/modules/toolbar/types';

/**
 * No mutant of this file is left alive, so there is no equivalence proof to record.
 *
 * Two constraints shape the fixtures. jsdom has no layout, so every rect the
 * positioner reads is stubbed and `getComputedStyle` is replaced wholesale.
 * And the CSSOM drops an invalid declaration silently, so a mutant that writes
 * `nullpx`/`NaNpx` leaves `style.top` at `''` — the assertions therefore read
 * `lastY` and the return value, not only the written style.
 */

interface StyleStub {
  paddingTop: string;
  lineHeight: string;
  height: string;
}

/**
 * With paddingTop 0, lineHeight 24 and a 40px toolbar the Y the positioner
 * computes is `contentTop - holderTop - 8`, which is what every expectation
 * below is derived from.
 */
const DEFAULT_STYLE: StyleStub = { paddingTop: '0px', lineHeight: '24', height: '40px' };

const rectAt = (top: number): DOMRect => new DOMRect(0, top, 100, 20);

describe('ToolbarPositioner — recorded mutants', () => {
  let positioner: ToolbarPositioner;
  let styles: Map<Element, StyleStub>;
  let holder: HTMLElement;
  let pluginsContent: HTMLElement;
  let plusButton: HTMLElement;
  let wrapper: HTMLElement;
  let actions: HTMLElement;
  let anchorSpy: Mock<() => HTMLElement | undefined>;
  let contentOffsetSpy: Mock<(hovered: Element) => { left: number } | undefined>;
  let block: Block;

  const setRect = (element: Element, top: number): void => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rectAt(top));
  };

  const nodes = (): ToolbarNodes => ({
    wrapper,
    content: undefined,
    actions,
    plusButton,
    settingsToggler: undefined,
  });

  const options = (overrides: Partial<PositioningOptions> = {}): PositioningOptions => ({
    targetBlock: block,
    hoveredTarget: null,
    isMobile: false,
    ...overrides,
  });

  /**
   * `PositioningOptions` types `targetBlock` as non-null; the runtime guard in
   * `calculateToolbarY` covers the frame where the toolbar has no block yet.
   */
  const optionsWithoutBlock = (): PositioningOptions => ({
    targetBlock: null as unknown as Block,
    hoveredTarget: null,
    isMobile: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    positioner = new ToolbarPositioner();
    styles = new Map();

    holder = document.createElement('div');
    pluginsContent = document.createElement('div');
    holder.appendChild(pluginsContent);

    plusButton = document.createElement('div');
    wrapper = document.createElement('div');
    actions = document.createElement('div');

    anchorSpy = vi.fn(() => undefined);
    contentOffsetSpy = vi.fn(() => ({ left: 0 }));

    block = {
      holder,
      pluginsContent,
      getToolbarAnchorElement: anchorSpy,
      getContentOffset: contentOffsetSpy,
    } as unknown as Block;

    setRect(holder, 0);
    setRect(pluginsContent, 0);

    vi.stubGlobal(
      'getComputedStyle',
      vi.fn((element: Element): StyleStub => styles.get(element) ?? DEFAULT_STYLE)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('watchTargetResize', () => {
    it('stands down when the environment has no ResizeObserver', () => {
      vi.stubGlobal('ResizeObserver', undefined);

      let error: unknown = null;

      try {
        positioner.watchTargetResize(document.createElement('div'), vi.fn());
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeNull();
    });
  });

  describe('calculateToolbarY', () => {
    it('centers on the first line using the content offset and padding', () => {
      setRect(holder, 100);
      setRect(pluginsContent, 150);
      styles.set(pluginsContent, { paddingTop: '8px', lineHeight: '24', height: '40px' });

      expect(positioner.calculateToolbarY(options(), plusButton)).toBe(50);
    });

    it('subtracts the whole toolbar height on mobile', () => {
      setRect(holder, 100);
      setRect(pluginsContent, 150);
      styles.set(pluginsContent, { paddingTop: '8px', lineHeight: '24', height: '40px' });

      expect(positioner.calculateToolbarY(options({ isMobile: true }), plusButton)).toBe(10);
    });

    it('does not ask the tool for an anchor when the hovered target is a list item', () => {
      const listItem = document.createElement('div');

      listItem.setAttribute('role', 'listitem');
      pluginsContent.appendChild(listItem);
      setRect(listItem, 40);

      positioner.calculateToolbarY(options({ hoveredTarget: listItem }), plusButton);

      expect(anchorSpy).not.toHaveBeenCalled();
    });

    it('prefers the list item text element over the list item itself', () => {
      const listItem = document.createElement('div');
      const text = document.createElement('div');

      listItem.setAttribute('role', 'listitem');
      text.setAttribute('contenteditable', 'true');
      listItem.appendChild(text);
      pluginsContent.appendChild(listItem);

      setRect(listItem, 50);
      setRect(text, 100);

      expect(positioner.calculateToolbarY(options({ hoveredTarget: listItem }), plusButton)).toBe(92);
    });

    it('keeps an editable pluginsContent instead of descending into a nested editable', () => {
      const nested = document.createElement('div');

      pluginsContent.setAttribute('contenteditable', 'true');
      nested.setAttribute('contenteditable', 'true');
      pluginsContent.appendChild(nested);

      setRect(pluginsContent, 50);
      setRect(nested, 300);

      expect(positioner.calculateToolbarY(options(), plusButton)).toBe(42);
    });

    it('uses the tool anchor ahead of pluginsContent', () => {
      const anchor = document.createElement('div');

      pluginsContent.appendChild(anchor);
      anchorSpy.mockReturnValue(anchor);

      setRect(anchor, 50);
      setRect(pluginsContent, 300);

      expect(positioner.calculateToolbarY(options(), plusButton)).toBe(42);
    });
  });

  describe('repositionToolbar', () => {
    it('keeps the cached position when the Y cannot be computed', () => {
      positioner.moveToY(nodes(), 10);

      const result = positioner.repositionToolbar(nodes(), optionsWithoutBlock(), plusButton);

      expect(result).toBe(false);
      expect(positioner.lastY).toBe(10);
    });

    it('always writes on the first call, even for a tiny Y', () => {
      setRect(pluginsContent, 9);

      const result = positioner.repositionToolbar(nodes(), options(), plusButton);

      expect(result).toBe(true);
      expect(positioner.lastY).toBe(1);
      expect(wrapper.style.top).toBe('1px');
    });

    it('leaves the wrapper untouched when the Y has not moved', () => {
      setRect(pluginsContent, 9);
      positioner.repositionToolbar(nodes(), options(), plusButton);

      wrapper.style.top = '999px';

      const result = positioner.repositionToolbar(nodes(), options(), plusButton);

      expect(result).toBe(false);
      expect(wrapper.style.top).toBe('999px');
    });

    it('ignores a move of exactly the tolerance', () => {
      positioner.moveToY(nodes(), 10);
      setRect(pluginsContent, 20);

      expect(positioner.repositionToolbar(nodes(), options(), plusButton)).toBe(false);
      expect(positioner.lastY).toBe(10);
    });

    it('ignores a one pixel move', () => {
      positioner.moveToY(nodes(), 10);
      setRect(pluginsContent, 19);

      expect(positioner.repositionToolbar(nodes(), options(), plusButton)).toBe(false);
      expect(positioner.lastY).toBe(10);
    });

    it('follows a move beyond the tolerance', () => {
      positioner.moveToY(nodes(), 10);
      setRect(pluginsContent, 28);

      expect(positioner.repositionToolbar(nodes(), options(), plusButton)).toBe(true);
      expect(positioner.lastY).toBe(20);
      expect(wrapper.style.top).toBe('20px');
    });

    it('drops the nested-content nudge while the actions bar is docked to the end', () => {
      const hovered = document.createElement('div');

      positioner.setHoveredTarget(hovered);
      contentOffsetSpy.mockReturnValue({ left: 40 });
      actions.style.transform = 'translateX(99px)';

      positioner.repositionToolbar(nodes(), options({ hoveredTarget: hovered, dockedToEnd: true }), plusButton);

      expect(actions.style.transform).toBe('');
    });
  });
});
