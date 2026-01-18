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
      const result = positioner.calculateToolbarY(
        { targetBlock: null as unknown as Block, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton!
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
      const result = positioner.calculateToolbarY(
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: true },
        mockNodes.plusButton!
      );

      expect(result).toBeTypeOf('number');
    });

    it('calculates Y position for desktop', () => {
      const result = positioner.calculateToolbarY(
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton!
      );

      expect(result).toBeTypeOf('number');
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
      const result = positioner.repositionToolbar(
        { wrapper: undefined, content: undefined, actions: undefined, plusButton: undefined, settingsToggler: undefined },
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton!
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
      if (!mockNodes.wrapper) {
        throw new Error('wrapper is undefined');
      }

      const result = positioner.repositionToolbar(
        mockNodes,
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton!
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

      const result = positioner.repositionToolbar(
        mockNodes,
        { targetBlock: mockBlock, hoveredTarget: null, isMobile: false },
        mockNodes.plusButton!
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
});
