import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolbarPositioner } from '../../../../../src/components/modules/toolbar/positioning';
import type { ToolbarNodes } from '../../../../../src/components/modules/toolbar/types';
import type { Block } from '../../../../../src/components/block';

// Store the actual getComputedStyle
const actualGetComputedStyle = window.getComputedStyle.bind(window);

describe('ToolbarPositioner', () => {
  let positioner: ToolbarPositioner;
  let mockNodes: ToolbarNodes;
  let mockBlock: Block & { getContentOffset: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    positioner = new ToolbarPositioner();

    const holder = document.createElement('div');
    const pluginsContentElement = document.createElement('div');
    holder.appendChild(pluginsContentElement);

    // Create a minimal Block mock that satisfies the type requirements
    const blockMock = {
      id: 'test-block',
      name: 'paragraph',
      parentId: null,
      contentIds: [],
      holder,
      pluginsContent: pluginsContentElement,
      isEmpty: true,
      inputs: [],
      data: {},
      lastSavedData: {},
      getTunes: vi.fn(() => ({ toolTunes: [], commonTunes: [] })),
      getContentOffset: vi.fn(() => ({ left: 0, top: 0 })),
      getToolbarAnchorElement: vi.fn(() => undefined),
      calculateData: vi.fn(),
      dispatch: vi.fn(),
      render: vi.fn(),
      rendered: vi.fn(),
      updated: vi.fn(),
      removed: vi.fn(),
      moved: vi.fn(),
      save: vi.fn(() => ({})),
      validate: vi.fn(() => true),
      on: vi.fn(),
      off: vi.fn(),
      cleanup: vi.fn(),
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
    };

    mockBlock = blockMock as unknown as Block & { getContentOffset: ReturnType<typeof vi.fn> };

    mockNodes = {
      wrapper: document.createElement('div'),
      content: document.createElement('div'),
      actions: document.createElement('div'),
      plusButton: document.createElement('div'),
      settingsToggler: document.createElement('div'),
    };

    // Set up wrapper in DOM for getBoundingClientRect to work
    document.body.appendChild(mockBlock.holder);
    if (mockNodes.wrapper) {
      document.body.appendChild(mockNodes.wrapper);
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('state management', () => {
    it('has null lastY initially', () => {
      expect(positioner.lastY).toBeNull();
    });

    it('has null target initially', () => {
      expect(positioner.target).toBeNull();
    });

    it('can set hovered target', () => {
      const element = document.createElement('div');
      positioner.setHoveredTarget(element);

      expect(positioner.target).toBe(element);
    });

    it('can reset cached position', () => {
      const nodes = {
        wrapper: document.createElement('div'),
        content: undefined,
        actions: undefined,
        plusButton: document.createElement('div'),
        settingsToggler: undefined,
      };

      positioner.moveToY(nodes, 100);
      expect(positioner.lastY).toBe(100);

      positioner.resetCachedPosition();
      expect(positioner.lastY).toBeNull();
    });
  });

  describe('calculateToolbarY', () => {
    beforeEach(() => {
      // Mock getComputedStyle to return predictable values
      vi.stubGlobal('getComputedStyle', vi.fn((element: HTMLElement) => {
        const computedStyle = actualGetComputedStyle(element);
        return {
          ...computedStyle,
          paddingTop: '8px',
          lineHeight: '24',
          height: '40px',
        };
      }));
    });

    it('returns null when targetBlock is null', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const result = positioner.calculateToolbarY(
        { targetBlock: null as unknown as Block, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      expect(result).toBeNull();
    });

    it('returns null when plusButton is null', () => {
      const result = positioner.calculateToolbarY(
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        null as unknown as HTMLElement
      );

      expect(result).toBeNull();
    });

    it('calculates Y position for mobile', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const result = positioner.calculateToolbarY(
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: true },
        mockNodes.plusButton
      );

      expect(result).toBeTypeOf('number');
    });

    it('calculates Y position for desktop', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const result = positioner.calculateToolbarY(
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      expect(result).toBeTypeOf('number');
    });

    it('uses first contenteditable descendant line-height when pluginsContent is a non-editable wrapper', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      // Build a block where pluginsContent is a non-contenteditable wrapper <div>
      // containing a <h2 contenteditable="true"> with a larger line-height.
      const holder = document.createElement('div');
      const wrapperDiv = document.createElement('div');
      const heading = document.createElement('h2');
      heading.setAttribute('contenteditable', 'true');
      wrapperDiv.appendChild(heading);
      holder.appendChild(wrapperDiv);
      document.body.appendChild(holder);

      const toggleHeadingBlock = {
        ...mockBlock,
        holder,
        pluginsContent: wrapperDiv,
      } as unknown as Block;

      // Override getComputedStyle so the wrapper reports lineHeight 24 and the
      // heading reports lineHeight 36. The toolbar must center on 36px, not 24px.
      vi.stubGlobal('getComputedStyle', vi.fn((element: HTMLElement) => {
        if (element === wrapperDiv) {
          return { paddingTop: '0px', lineHeight: '24', height: '40px' };
        }
        if (element === heading) {
          return { paddingTop: '0px', lineHeight: '36', height: '40px' };
        }
        // plusButton
        return { paddingTop: '0px', lineHeight: '24', height: '40px' };
      }));

      const resultUsingWrapper = positioner.calculateToolbarY(
        { targetBlock: toggleHeadingBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      // Expected: centered on heading's 36px line-height
      // firstLineCenterY = 0 (contentOffset) + 0 (paddingTop) + 36/2 = 18
      // toolbarY = 18 - 40/2 = -2
      expect(resultUsingWrapper).toBe(-2);
    });
  });

  describe('moveToY', () => {
    it('returns null when wrapper is null', () => {
      const result = positioner.moveToY(
        { wrapper: undefined, content: undefined, actions: undefined, plusButton: undefined, settingsToggler: undefined },
        100
      );

      expect(result).toBeNull();
    });

    it('sets wrapper style.top to the floor of toolbarY', () => {
      if (!mockNodes.wrapper) {
        throw new Error('wrapper is undefined');
      }

      positioner.moveToY(mockNodes, 100.7);

      expect(mockNodes.wrapper.style.top).toBe('100px');
    });

    it('updates lastY to the floor of toolbarY', () => {
      if (!mockNodes.wrapper) {
        throw new Error('wrapper is undefined');
      }

      positioner.moveToY(mockNodes, 100.7);

      expect(positioner.lastY).toBe(100);
    });

    it('returns the floored Y value', () => {
      const result = positioner.moveToY(mockNodes, 100.7);

      expect(result).toBe(100);
    });
  });

  describe('repositionToolbar', () => {
    it('returns false when wrapper is null', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const result = positioner.repositionToolbar(
        { wrapper: undefined, content: undefined, actions: undefined, plusButton: undefined, settingsToggler: undefined },
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      expect(result).toBe(false);
    });

    it('returns false when plusButton is null', () => {
      const result = positioner.repositionToolbar(
        mockNodes,
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        null as unknown as HTMLElement
      );

      expect(result).toBe(false);
    });

    it('updates position when lastToolbarY is null (first call)', () => {
      if (!mockNodes.wrapper || !mockNodes.plusButton) {
        throw new Error('wrapper or plusButton is undefined');
      }

      const result = positioner.repositionToolbar(
        mockNodes,
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      expect(result).toBeTypeOf('boolean');
    });

    it('updates position when change exceeds tolerance', () => {
      // Force a large position change
      positioner.resetCachedPosition();
      vi.stubGlobal('getComputedStyle', vi.fn((element: HTMLElement) => {
        const computedStyle = actualGetComputedStyle(element);
        return {
          ...computedStyle,
          paddingTop: '8px',
          lineHeight: '24',
          height: '40px',
        };
      }));

      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const result = positioner.repositionToolbar(
        mockNodes,
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      expect(result).toBeTypeOf('boolean');
    });
  });

  describe('applyContentOffset', () => {
    it('does nothing when actions is null', () => {
      positioner.setHoveredTarget(document.createElement('div'));

      positioner.applyContentOffset(
        { wrapper: mockNodes.wrapper, content: undefined, actions: undefined, plusButton: undefined, settingsToggler: undefined },
        mockBlock
      );

      // Should not throw
    });

    it('resets transform when no hovered target', () => {
      if (!mockNodes.actions) {
        throw new Error('actions is undefined');
      }

      mockNodes.actions.style.transform = 'translateX(10px)';

      positioner.applyContentOffset(mockNodes, mockBlock);

      expect(mockNodes.actions.style.transform).toBe('');
    });

    it('resets transform when getContentOffset returns invalid offset', () => {
      if (!mockNodes.actions) {
        throw new Error('actions is undefined');
      }

      positioner.setHoveredTarget(document.createElement('div'));
      mockBlock.getContentOffset.mockReturnValue({ left: 0, top: 0 });
      mockNodes.actions.style.transform = 'translateX(10px)';

      positioner.applyContentOffset(mockNodes, mockBlock);

      expect(mockNodes.actions.style.transform).toBe('');
    });

    it('applies transform when getContentOffset returns valid offset', () => {
      if (!mockNodes.actions) {
        throw new Error('actions is undefined');
      }

      positioner.setHoveredTarget(document.createElement('div'));
      mockBlock.getContentOffset.mockReturnValue({ left: 50, top: 0 });

      positioner.applyContentOffset(mockNodes, mockBlock);

      expect(mockNodes.actions.style.transform).toBe('translateX(50px)');
    });
  });

  describe('getToolbarAnchorElement integration', () => {
    beforeEach(() => {
      vi.stubGlobal('getComputedStyle', vi.fn((element: HTMLElement) => {
        const computedStyle = actualGetComputedStyle(element);

        return {
          ...computedStyle,
          paddingTop: '0px',
          lineHeight: '24',
          height: '40px',
        };
      }));
    });

    it('uses getToolbarAnchorElement result instead of searching for contenteditable descendant', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      // Build a block like the code tool: non-editable wrapper with a header bar
      // above the contenteditable element, and the tool provides an anchor
      const holder = document.createElement('div');
      const wrapper = document.createElement('div'); // pluginsContent (non-editable)
      const header = document.createElement('div'); // header bar above code
      header.style.height = '40px';
      const codeBody = document.createElement('div');
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.setAttribute('contenteditable', 'plaintext-only');
      pre.appendChild(code);
      codeBody.appendChild(pre);
      wrapper.appendChild(header);
      wrapper.appendChild(codeBody);
      holder.appendChild(wrapper);
      document.body.appendChild(holder);

      // Block provides getToolbarAnchorElement returning the wrapper (not the deeply nested code)
      const blockWithAnchor = {
        ...mockBlock,
        holder,
        pluginsContent: wrapper,
        getToolbarAnchorElement: vi.fn(() => wrapper),
      } as unknown as Block;

      const resultWithAnchor = positioner.calculateToolbarY(
        { targetBlock: blockWithAnchor, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      // Block without getToolbarAnchorElement falls through to editableDescendant (the <code>)
      const blockWithoutAnchor = {
        ...mockBlock,
        holder,
        pluginsContent: wrapper,
      } as unknown as Block;

      const resultWithoutAnchor = positioner.calculateToolbarY(
        { targetBlock: blockWithoutAnchor, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      // Both should be numbers
      expect(typeof resultWithAnchor).toBe('number');
      expect(typeof resultWithoutAnchor).toBe('number');

      // The anchor-based result should use the wrapper's position (top of block),
      // while the fallback uses the code element (lower, below the header)
      // In JSDOM getBoundingClientRect returns 0 for both, so just verify the method was called
      expect(blockWithAnchor.getToolbarAnchorElement).toHaveBeenCalled();
    });

    it('falls back to editableDescendant when getToolbarAnchorElement returns undefined', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const holder = document.createElement('div');
      const wrapper = document.createElement('div');
      const heading = document.createElement('h2');
      heading.setAttribute('contenteditable', 'true');
      wrapper.appendChild(heading);
      holder.appendChild(wrapper);
      document.body.appendChild(holder);

      // getToolbarAnchorElement exists but returns undefined — should use editableDescendant
      vi.stubGlobal('getComputedStyle', vi.fn((element: HTMLElement) => {
        if (element === heading) {
          return { paddingTop: '0px', lineHeight: '36', height: '40px' };
        }
        return { paddingTop: '0px', lineHeight: '24', height: '40px' };
      }));

      const blockReturningUndefined = {
        ...mockBlock,
        holder,
        pluginsContent: wrapper,
        getToolbarAnchorElement: vi.fn(() => undefined),
      } as unknown as Block;

      const result = positioner.calculateToolbarY(
        { targetBlock: blockReturningUndefined, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton
      );

      // Should use heading's lineHeight (36), not wrapper's (24)
      // firstLineCenterY = 0 + 0 + 36/2 = 18, toolbarY = 18 - 40/2 = -2
      expect(result).toBe(-2);
    });

    it('does not use getToolbarAnchorElement when hovered target resolves to a list item', () => {
      if (!mockNodes.plusButton) {
        throw new Error('plusButton is undefined');
      }

      const holder = document.createElement('div');
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      const contentDiv = document.createElement('div');
      contentDiv.setAttribute('contenteditable', 'true');
      listItem.appendChild(contentDiv);
      wrapper.appendChild(listItem);
      holder.appendChild(wrapper);
      document.body.appendChild(holder);

      const blockWithAnchor = {
        ...mockBlock,
        holder,
        pluginsContent: wrapper,
        getToolbarAnchorElement: vi.fn(() => wrapper),
      } as unknown as Block;

      positioner.setHoveredTarget(listItem);

      positioner.calculateToolbarY(
        { targetBlock: blockWithAnchor, hoveredTarget: listItem, isMobile: false },
        mockNodes.plusButton
      );

      // List item special-case takes priority, so getToolbarAnchorElement should not be used
      expect(blockWithAnchor.getToolbarAnchorElement).not.toHaveBeenCalled();
    });
  });
});
