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
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
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
    it('does not define a keyboard shortcut', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      expect((ToggleItem as unknown as Record<string, unknown>).shortcut).toBeUndefined();
    });
  });

  describe('toolbox config', () => {
    it('shows > as the shortcut hint in the toolbox', async () => {
      const { ToggleItem } = await import('../../../../src/tools/toggle');

      const toolbox = ToggleItem.toolbox as { shortcut?: string };

      expect(toolbox.shortcut).toBe('>');
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
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Starts expanded in editing mode — collapse first to test expand
      toggle.collapse();
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
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

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
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue(childBlocks);

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
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

      const options = createToggleOptions();
      options.api = mockAPI;
      const toggle = new ToggleItem(options);
      const element = toggle.render();
      toggle.rendered();

      // Starts expanded in editing mode — collapse first
      toggle.collapse();
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
    Shortcuts.remove(document, 'CMD+ALT+T');
    Shortcuts.remove(document, 'CMD+SHIFT+[');
    Shortcuts.remove(document, 'CMD+ALT+SHIFT+T');
  });

  afterEach(() => {
    Shortcuts.remove(document, 'CMD+ALT+T');
    Shortcuts.remove(document, 'CMD+SHIFT+[');
    Shortcuts.remove(document, 'CMD+ALT+SHIFT+T');
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('registers CMD+ALT+T shortcut without throwing', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');
      const mockAPI = createMockAPI();

      const shortcuts = new ToggleShortcuts(mockAPI, document.createElement('div'));

      expect(() => {
        shortcuts.register();
      }).not.toThrow();

      shortcuts.unregister();
    });

    it('does not throw when CMD+ALT+T is already registered by a previous instance', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');
      const mockAPI = createMockAPI();

      // First instance registers the shortcut (simulates a previous editor)
      const firstInstance = new ToggleShortcuts(mockAPI, document.createElement('div'));
      firstInstance.register();

      // Second instance registers without the first being unregistered
      // (this happens in Storybook when stories switch before destroy completes)
      const secondInstance = new ToggleShortcuts(mockAPI, document.createElement('div'));

      expect(() => {
        secondInstance.register();
      }).not.toThrow();

      secondInstance.unregister();
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

    /**
     * Helper to create a mock header block with toggle behavior.
     * Toggle headings are header blocks with the toggle-open attribute on the element.
     */
    const createMockToggleHeaderBlock = (id: string, isOpen: boolean): BlockAPI => {
      const holder = document.createElement('div');
      const headerElement = document.createElement('h2');
      headerElement.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));
      holder.appendChild(headerElement);

      return {
        id,
        name: 'header',
        holder,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    /**
     * Helper to create a mock regular header block (not toggleable).
     */
    const createMockHeaderBlock = (id: string): BlockAPI => {
      const holder = document.createElement('div');
      const headerElement = document.createElement('h2');
      holder.appendChild(headerElement);

      return {
        id,
        name: 'header',
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
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(3);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn()
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
        altKey: true,
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
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn()
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
        altKey: true,
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
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(1);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(paragraphBlock);

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
        altKey: true,
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

    it('expands toggle headings along with toggle blocks when any is collapsed', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', true);
      const toggleHeader = createMockToggleHeaderBlock('th1', false);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn()
        .mockImplementation((index: number) => {
          return [toggleBlock, toggleHeader][index];
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
        altKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // Both the toggle block and toggle heading should be expanded
      expect(toggleBlock.call).toHaveBeenCalledWith('expand');
      expect(toggleHeader.call).toHaveBeenCalledWith('expand');

      shortcuts.unregister();
      wrapper.remove();
    });

    it('collapses toggle headings along with toggle blocks when all are expanded', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', true);
      const toggleHeader = createMockToggleHeaderBlock('th1', true);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn()
        .mockImplementation((index: number) => {
          return [toggleBlock, toggleHeader][index];
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
        altKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      expect(toggleBlock.call).toHaveBeenCalledWith('collapse');
      expect(toggleHeader.call).toHaveBeenCalledWith('collapse');

      shortcuts.unregister();
      wrapper.remove();
    });

    it('ignores regular (non-toggleable) header blocks', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', false);
      const regularHeader = createMockHeaderBlock('h1');
      const toggleHeader = createMockToggleHeaderBlock('th1', false);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(3);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn()
        .mockImplementation((index: number) => {
          return [toggleBlock, regularHeader, toggleHeader][index];
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
        altKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // Toggle block and toggle heading should be expanded
      expect(toggleBlock.call).toHaveBeenCalledWith('expand');
      expect(toggleHeader.call).toHaveBeenCalledWith('expand');
      // Regular header should NOT be touched
      expect(regularHeader.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('handles only toggle headings when no toggle blocks exist', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleHeader1 = createMockToggleHeaderBlock('th1', true);
      const toggleHeader2 = createMockToggleHeaderBlock('th2', false);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn()
        .mockImplementation((index: number) => {
          return [toggleHeader1, toggleHeader2][index];
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
        altKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // One is collapsed, so all should expand
      expect(toggleHeader1.call).toHaveBeenCalledWith('expand');
      expect(toggleHeader2.call).toHaveBeenCalledWith('expand');

      shortcuts.unregister();
      wrapper.remove();
    });

    it('ignores the shortcut when the target is outside the editor wrapper', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', false);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(1);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(toggleBlock);

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
        altKey: true,
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

  describe('CMD+SHIFT+[ — toggle current block', () => {
    /**
     * Helper to create a mock block that looks like a toggle block.
     */
    const createMockToggleBlock = (id: string, isOpen: boolean, parentId: string | null = null): BlockAPI => {
      const holder = document.createElement('div');
      const wrapper = document.createElement('div');
      wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));
      holder.appendChild(wrapper);

      return {
        id,
        name: TOOL_NAME,
        holder,
        parentId,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    const createMockParagraphBlock = (id: string, parentId: string | null = null): BlockAPI => {
      const holder = document.createElement('div');

      return {
        id,
        name: 'paragraph',
        holder,
        parentId,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    it('collapses the toggle block that currently has focus (block IS a toggle)', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', true);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(toggleBlock);

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'BracketLeft',
        key: '[',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      expect(toggleBlock.call).toHaveBeenCalledWith('collapse');

      shortcuts.unregister();
      wrapper.remove();
    });

    it('expands a collapsed toggle block that currently has focus', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', false);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(toggleBlock);

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'BracketLeft',
        key: '[',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      expect(toggleBlock.call).toHaveBeenCalledWith('expand');

      shortcuts.unregister();
      wrapper.remove();
    });

    it('toggles the parent toggle when focus is on a child block inside a toggle', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const parentToggle = createMockToggleBlock('parent', true, null);
      const childParagraph = createMockParagraphBlock('child', 'parent');

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(1);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockImplementation((index: number) => {
        return [parentToggle, childParagraph][index];
      });
      (mockAPI.blocks as unknown as Record<string, unknown>).getById = vi.fn().mockImplementation((id: string) => {
        return id === 'parent' ? parentToggle : null;
      });

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'BracketLeft',
        key: '[',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // The parent toggle should be called, not the child paragraph
      expect(parentToggle.call).toHaveBeenCalledWith('collapse');
      expect(childParagraph.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('does nothing when the current block is not a toggle and has no parent', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const paragraphBlock = createMockParagraphBlock('p1', null);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(paragraphBlock);

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', {
        code: 'BracketLeft',
        key: '[',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      expect(() => {
        document.dispatchEvent(event);
      }).not.toThrow();

      expect(paragraphBlock.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('ignores the shortcut when the target is outside the editor wrapper', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggleBlock = createMockToggleBlock('t1', true);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockReturnValue(toggleBlock);

      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);

      const shortcuts = new ToggleShortcuts(mockAPI, wrapper);
      shortcuts.register();

      const outsideElement = document.createElement('div');
      document.body.appendChild(outsideElement);

      const event = new KeyboardEvent('keydown', {
        code: 'BracketLeft',
        key: '[',
        metaKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: outsideElement, writable: false });

      document.dispatchEvent(event);

      expect(toggleBlock.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
      outsideElement.remove();
    });
  });

  describe('CMD+ALT+SHIFT+T — scoped expand/collapse', () => {
    /**
     * Helper to create a mock block that looks like a toggle block.
     */
    const createMockToggleBlock = (id: string, isOpen: boolean, parentId: string | null = null): BlockAPI => {
      const holder = document.createElement('div');
      const wrapper = document.createElement('div');
      wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));
      holder.appendChild(wrapper);

      return {
        id,
        name: TOOL_NAME,
        holder,
        parentId,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    const createMockParagraphBlock = (id: string, parentId: string | null = null): BlockAPI => {
      const holder = document.createElement('div');

      return {
        id,
        name: 'paragraph',
        holder,
        parentId,
        call: vi.fn(),
      } as unknown as BlockAPI;
    };

    it('collapses only descendant toggles of the current toggle when cursor is on a toggle', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      // root toggle (expanded) contains two child toggles (both expanded)
      const rootToggle = createMockToggleBlock('root', true, null);
      const childToggle1 = createMockToggleBlock('child1', true, 'root');
      const childToggle2 = createMockToggleBlock('child2', true, 'root');
      const unrelatedToggle = createMockToggleBlock('unrelated', true, null);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(4);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockImplementation((index: number) => {
        return [rootToggle, childToggle1, childToggle2, unrelatedToggle][index];
      });
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockImplementation((id: string) => {
        if (id === 'root') {
          return [childToggle1, childToggle2];
        }
        return [];
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
        altKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // Only the children of rootToggle should be collapsed (they are toggles)
      expect(childToggle1.call).toHaveBeenCalledWith('collapse');
      expect(childToggle2.call).toHaveBeenCalledWith('collapse');
      // The unrelated toggle should NOT be touched
      expect(unrelatedToggle.call).not.toHaveBeenCalled();
      // The root toggle itself should NOT be collapsed (we only collapse descendants)
      expect(rootToggle.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('expands only descendant toggles when any child toggle is collapsed', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const rootToggle = createMockToggleBlock('root', true, null);
      const childToggle1 = createMockToggleBlock('child1', false, 'root'); // collapsed
      const childToggle2 = createMockToggleBlock('child2', true, 'root');  // expanded

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(0);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(3);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockImplementation((index: number) => {
        return [rootToggle, childToggle1, childToggle2][index];
      });
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockImplementation((id: string) => {
        if (id === 'root') {
          return [childToggle1, childToggle2];
        }
        return [];
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
        altKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // Since one child is collapsed, all children should expand
      expect(childToggle1.call).toHaveBeenCalledWith('expand');
      expect(childToggle2.call).toHaveBeenCalledWith('expand');
      expect(rootToggle.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('falls back to page-wide toggleAll when cursor is not inside any toggle', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const toggle1 = createMockToggleBlock('t1', true, null);
      const toggle2 = createMockToggleBlock('t2', true, null);
      const paragraphAtRoot = createMockParagraphBlock('p1', null);

      const mockAPI = createMockAPI();
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(3);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockImplementation((index: number) => {
        return [toggle1, toggle2, paragraphAtRoot][index];
      });
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockReturnValue([]);

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
        altKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // Falls back to page-wide: all toggles are expanded so collapse all
      expect(toggle1.call).toHaveBeenCalledWith('collapse');
      expect(toggle2.call).toHaveBeenCalledWith('collapse');
      expect(paragraphAtRoot.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });

    it('uses root ancestor toggle when cursor is inside a nested child block', async () => {
      const { ToggleShortcuts } = await import('../../../../src/tools/toggle/toggle-shortcuts');

      const rootToggle = createMockToggleBlock('root', true, null);
      const childToggle = createMockToggleBlock('childToggle', true, 'root');
      const grandchildParagraph = createMockParagraphBlock('grandchild', 'childToggle');

      const mockAPI = createMockAPI();
      // cursor is on grandchild
      (mockAPI.blocks as unknown as Record<string, unknown>).getCurrentBlockIndex = vi.fn().mockReturnValue(2);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlocksCount = vi.fn().mockReturnValue(3);
      (mockAPI.blocks as unknown as Record<string, unknown>).getBlockByIndex = vi.fn().mockImplementation((index: number) => {
        return [rootToggle, childToggle, grandchildParagraph][index];
      });
      (mockAPI.blocks as unknown as Record<string, unknown>).getById = vi.fn().mockImplementation((id: string) => {
        if (id === 'root') return rootToggle;
        if (id === 'childToggle') return childToggle;
        return null;
      });
      (mockAPI.blocks as unknown as Record<string, unknown>).getChildren = vi.fn().mockImplementation((id: string) => {
        if (id === 'root') return [childToggle, grandchildParagraph];
        if (id === 'childToggle') return [grandchildParagraph];
        return [];
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
        altKey: true,
        shiftKey: true,
      });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      document.dispatchEvent(event);

      // childToggle is a descendant toggle of root and should be collapsed
      expect(childToggle.call).toHaveBeenCalledWith('collapse');
      // rootToggle itself is not a descendant, should NOT be touched
      expect(rootToggle.call).not.toHaveBeenCalled();

      shortcuts.unregister();
      wrapper.remove();
    });
  });
});
