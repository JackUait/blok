import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { ToggleItemData, ToggleItemConfig } from '../../../../src/tools/toggle/types';
import { TOGGLE_ATTR, TOOL_NAME } from '../../../../src/tools/toggle/constants';
import { Shortcuts } from '../../../../src/components/utils/shortcuts';

/**
 * Create a mock API for testing
 */
const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: {
    t: (key: string) => key,
    has: () => false,
  },
  blocks: {
    splitBlock: vi.fn(),
    convert: vi.fn(),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getChildren: vi.fn().mockReturnValue([]),
  },
} as unknown as API);

/**
 * Create constructor options for ToggleItem
 */
const createToggleOptions = (
  data: Partial<ToggleItemData> = {},
  config: ToggleItemConfig = {}
): BlockToolConstructorOptions<ToggleItemData, ToggleItemConfig> => ({
  data: { text: '', ...data } as ToggleItemData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'test-block-id' } as never,
});

describe('ToggleItem shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('static shortcut', () => {
    it('exposes CMD+ALT+7 as the block creation shortcut', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      expect(ToggleItem.shortcut).toBe('CMD+ALT+7');
    });
  });

  describe('expand()', () => {
    it('expands the toggle and updates the arrow and children visibility', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolders = [document.createElement('div'), document.createElement('div')];
      const childBlocks = childHolders.map((holder, i) => ({
        id: `child-${i}`,
        holder,
      }));

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Start collapsed
      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(true);
      }

      // Expand via public method
      toggle.expand();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }
    });

    it('is a no-op if already expanded', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolders = [document.createElement('div')];
      const childBlocks = childHolders.map((holder, i) => ({
        id: `child-${i}`,
        holder,
      }));

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Expand
      toggle.expand();
      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');

      // Expand again — should remain expanded
      toggle.expand();
      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
    });
  });

  describe('collapse()', () => {
    it('collapses the toggle and hides children', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const childHolders = [document.createElement('div'), document.createElement('div')];
      const childBlocks = childHolders.map((holder, i) => ({
        id: `child-${i}`,
        holder,
      }));

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // First expand
      toggle.expand();
      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(false);
      }

      // Collapse via public method
      toggle.collapse();

      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
      for (const holder of childHolders) {
        expect(holder.classList.contains('hidden')).toBe(true);
      }
    });

    it('is a no-op if already collapsed', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Already collapsed
      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');

      // Collapse again — no-op
      toggle.collapse();
      expect(element.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
    });
  });
});

describe('ToggleShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Clean up shortcuts that may be left over
    Shortcuts.remove(document, 'CMD+SHIFT+T');
  });

  afterEach(() => {
    Shortcuts.remove(document, 'CMD+SHIFT+T');
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('registers CMD+SHIFT+T shortcut without throwing', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');
      const mockAPI = createMockAPI();

      const shortcuts = new ToggleShortcuts(mockAPI, document.createElement('div'));

      expect(() => {
        shortcuts.register();
      }).not.toThrow();

      shortcuts.unregister();
    });
  });

  describe('unregister', () => {
    it('unregisters the shortcut without throwing', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');
      const mockAPI = createMockAPI();

      const shortcuts = new ToggleShortcuts(mockAPI, document.createElement('div'));
      shortcuts.register();

      expect(() => {
        shortcuts.unregister();
      }).not.toThrow();
    });

    it('can be called multiple times safely', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');
      const mockAPI = createMockAPI();

      const shortcuts = new ToggleShortcuts(mockAPI, document.createElement('div'));
      shortcuts.register();

      shortcuts.unregister();

      expect(() => {
        shortcuts.unregister();
      }).not.toThrow();
    });
  });

  describe('collapse/expand all behavior', () => {
    /**
     * Helper to create a mock block that looks like a toggle block.
     * The holder contains a wrapper element with the toggle-open attribute.
     */
    const createMockToggleBlock = (id: string, isOpen: boolean): BlockAPI => {
      const holder = document.createElement('div');
      const wrapper = document.createElement('div');
      wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));
      holder.appendChild(wrapper);

      return {
        id,
        name: TOOL_NAME,
        holder,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    const createMockParagraphBlock = (id: string): BlockAPI => {
      const holder = document.createElement('div');

      return {
        id,
        name: 'paragraph',
        holder,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    it('expands all toggles when any toggle is collapsed', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock1 = createMockToggleBlock('t1', false);
      const toggleBlock2 = createMockToggleBlock('t2', true);
      const paragraphBlock = createMockParagraphBlock('p1');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(3);
      (mockAPI.blocks as Record<string, unknown>).getBlockByIndex = vi.fn()
        .mockImplementation((index: number) => {
          return [toggleBlock1, paragraphBlock, toggleBlock2][index];
        });

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      // Simulate a target inside the wrapper
      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'KeyT',
        key: 'T',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // Should call expand on collapsed toggle blocks
      expect(toggleBlock1.call).toHaveBeenCalledWith('expand');
      expect(toggleBlock2.call).toHaveBeenCalledWith('expand');
      // Should NOT call anything on paragraph blocks
      expect(paragraphBlock.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('collapses all toggles when all toggles are expanded', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock1 = createMockToggleBlock('t1', true);
      const toggleBlock2 = createMockToggleBlock('t2', true);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as Record<string, unknown>).getBlockByIndex = vi.fn()
        .mockImplementation((index: number) => {
          return [toggleBlock1, toggleBlock2][index];
        });

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'KeyT',
        key: 'T',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      expect(toggleBlock1.call).toHaveBeenCalledWith('collapse');
      expect(toggleBlock2.call).toHaveBeenCalledWith('collapse');

      shortcuts.unregister();
      wrapper.remove();
    });

    it('does nothing when there are no toggle blocks', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const paragraphBlock = createMockParagraphBlock('p1');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(1);
      (mockAPI.blocks as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(paragraphBlock);

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'KeyT',
        key: 'T',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      // Should not throw
      expect(() => {
        document.dispatchEvent(event);
      }).not.toThrow();

      expect(paragraphBlock.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('ignores the shortcut when the target is outside the editor wrapper', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', false);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(1);
      (mockAPI.blocks as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(toggleBlock);

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      // Target is outside the wrapper
      const outsideElement = document.createElement('div');
      document.body.appendChild(outsideElement);

      const event = new KeyboardEvent('keydown', {
        code: 'KeyT',
        key: 'T',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: outsideElement, writable: false });

      document.dispatchEvent(event);

      // Should NOT call anything since target is outside wrapper
      expect(toggleBlock.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
      outsideElement.remove();
    });
  });
});
