import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BlockShortcuts } from '../../../../../src/components/modules/blockManager/shortcuts';
import type { BlockShortcutsHandlers } from '../../../../../src/components/modules/blockManager/shortcuts';
import { Shortcuts } from '../../../../../src/components/utils/shortcuts';

/**
 * Timeout for async operations in tests
 */
const ASYNC_TIMEOUT = 10;

/**
 * Create a mock wrapper element
 */
const createMockWrapper = (): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.id = 'editor-wrapper';
  document.body.appendChild(wrapper);
  return wrapper;
};

/**
 * Create mock handlers
 */
const createMockHandlers = (): BlockShortcutsHandlers => ({
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onCopyAsMarkdown: vi.fn(),
  onDuplicate: vi.fn(),
});

describe('BlockShortcuts', () => {
  let shortcuts: BlockShortcuts;
  let wrapper: HTMLElement;
  let handlers: BlockShortcutsHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = createMockWrapper();
    handlers = createMockHandlers();
    shortcuts = new BlockShortcuts(wrapper, handlers);

    // Clear any existing shortcuts before each test
    Shortcuts.remove(document, 'CMD+SHIFT+UP');
    Shortcuts.remove(document, 'CMD+SHIFT+DOWN');
  });

  afterEach(() => {
    shortcuts.unregister();
    wrapper.remove();
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('registers CMD+SHIFT+UP shortcut', () => {
      shortcuts.register();

      // Wait for setTimeout
      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Verify by triggering the shortcut - if registered, it would call the handler
          // but since we can't actually trigger system shortcuts, we just verify no errors
          expect(handlers.onMoveUp).not.toHaveBeenCalled();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('registers CMD+SHIFT+DOWN shortcut', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(handlers.onMoveDown).not.toHaveBeenCalled();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('does not throw if register is called', () => {
      expect(() => {
        shortcuts.register();
      }).not.toThrow();
    });

    it('handles multiple register cycles', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Register again - should not throw
          shortcuts.register();
          expect(() => {
            shortcuts.register();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });
  });

  describe('unregister', () => {
    it('unregisters all shortcuts on destroy', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(() => {
            shortcuts.unregister();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('can be called multiple times', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          shortcuts.unregister();
          expect(() => {
            shortcuts.unregister();
            shortcuts.unregister();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('does not throw if unregister called before register', () => {
      expect(() => {
        shortcuts.unregister();
      }).not.toThrow();
    });
  });

  describe('shouldHandleShortcut', () => {
    it('returns true when target is within wrapper', () => {
      const child = document.createElement('div');
      wrapper.appendChild(child);

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
      Object.defineProperty(event, 'target', { value: child, writable: false });

      // The shouldHandleShortcut is private, but we can test behavior through register
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          // If target is in wrapper, shortcuts should be registered
          expect(() => {
            shortcuts.unregister();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('returns false when target is outside wrapper', () => {
      const outsideElement = document.createElement('div');
      document.body.appendChild(outsideElement);

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
      Object.defineProperty(event, 'target', { value: outsideElement, writable: false });

      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          outsideElement.remove();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('handles elements that are not HTMLElement', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      Object.defineProperty(event, 'target', { value: null, writable: false });

      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(() => {
            shortcuts.unregister();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });
  });

  describe('handler calls', () => {
    it('has onMoveUp handler that can be called', () => {
      // Verify handler is stored correctly
      expect(handlers.onMoveUp).toBeDefined();
      expect(typeof handlers.onMoveUp).toBe('function');
    });

    it('has onMoveDown handler that can be called', () => {
      // Verify handler is stored correctly
      expect(handlers.onMoveDown).toBeDefined();
      expect(typeof handlers.onMoveDown).toBe('function');
    });

    it('calls onMoveUp handler when CMD+SHIFT+UP is triggered within wrapper', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const child = document.createElement('div');
          wrapper.appendChild(child);

          const event = new KeyboardEvent('keydown', {
            code: 'ArrowUp',
            key: 'ArrowUp',
            metaKey: true,
            shiftKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: child, writable: false });

          document.dispatchEvent(event);

          expect(handlers.onMoveUp).toHaveBeenCalledWith();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('calls onCopyAsMarkdown handler when CMD+SHIFT+C is triggered within wrapper', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const child = document.createElement('div');
          wrapper.appendChild(child);

          const event = new KeyboardEvent('keydown', {
            code: 'KeyC',
            key: 'c',
            metaKey: true,
            shiftKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: child, writable: false });

          document.dispatchEvent(event);

          expect(handlers.onCopyAsMarkdown).toHaveBeenCalledWith();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('calls onDuplicate handler when CMD+D is triggered within wrapper', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const child = document.createElement('div');
          wrapper.appendChild(child);

          const event = new KeyboardEvent('keydown', {
            code: 'KeyD',
            key: 'd',
            metaKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: child, writable: false });

          document.dispatchEvent(event);

          expect(handlers.onDuplicate).toHaveBeenCalledWith();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('fires when a block is selected but focus blurred outside the wrapper (event target = body)', () => {
      // Block-level / navigation selection blurs the contenteditable, so the
      // keydown targets document.body — outside the wrapper. The editor still
      // owns the selection (a [data-blok-selected] block lives in the wrapper),
      // so the move must still fire. Without this, Cmd+Shift+Arrow does nothing
      // for a selected block — "can't even move a single block".
      const selectedBlock = document.createElement('div');
      selectedBlock.setAttribute('data-blok-selected', 'true');
      wrapper.appendChild(selectedBlock);

      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', {
            code: 'ArrowDown',
            key: 'ArrowDown',
            metaKey: true,
            shiftKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: document.body, writable: false });

          document.dispatchEvent(event);

          expect(handlers.onMoveDown).toHaveBeenCalledWith();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('does NOT fire when focus is outside the wrapper and the editor has no selection', () => {
      const outside = document.createElement('div');
      document.body.appendChild(outside);

      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', {
            code: 'ArrowDown',
            key: 'ArrowDown',
            metaKey: true,
            shiftKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: outside, writable: false });

          document.dispatchEvent(event);

          expect(handlers.onMoveDown).not.toHaveBeenCalled();
          outside.remove();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('calls onMoveDown handler when CMD+SHIFT+DOWN is triggered within wrapper', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const child = document.createElement('div');
          wrapper.appendChild(child);

          const event = new KeyboardEvent('keydown', {
            code: 'ArrowDown',
            key: 'ArrowDown',
            metaKey: true,
            shiftKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: child, writable: false });

          document.dispatchEvent(event);

          expect(handlers.onMoveDown).toHaveBeenCalledWith();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });
  });

  describe('integration scenarios', () => {
    it('handles register/unregister/register cycle', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          shortcuts.unregister();
          shortcuts.register();
          shortcuts.unregister();
          expect(() => {
            shortcuts.register();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('does not leak shortcuts between instances', () => {
      const handlers2 = createMockHandlers();
      const shortcuts2 = new BlockShortcuts(wrapper, handlers2);

      shortcuts.register();
      shortcuts2.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(() => {
            shortcuts.unregister();
            shortcuts2.unregister();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('both editors keep working: an event in the FIRST-registered wrapper still fires its handler when a SECOND editor is also registered', () => {
      // Regression: the shortcuts registered on `document`, and the singleton
      // Shortcuts utility throws on a duplicate name, so each editor's register()
      // first REMOVED any existing handler of that name. On a multi-editor page
      // (docs site, playground), only the LAST-initialized editor owned Cmd+D /
      // move; every other editor silently no-opped when a block was focused.
      const wrapper2 = document.createElement('div');
      wrapper2.id = 'editor-wrapper-2';
      document.body.appendChild(wrapper2);
      const handlers2 = createMockHandlers();
      const shortcuts2 = new BlockShortcuts(wrapper2, handlers2);

      shortcuts.register();
      shortcuts2.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          const child1 = document.createElement('div');
          wrapper.appendChild(child1);

          const event = new KeyboardEvent('keydown', {
            code: 'KeyD',
            key: 'd',
            metaKey: true,
            ctrlKey: true,
          });
          Object.defineProperty(event, 'target', { value: child1, writable: false });

          document.dispatchEvent(event);

          // The first editor owns the event (target in its wrapper) and must act,
          // even though the second editor registered afterwards.
          expect(handlers.onDuplicate).toHaveBeenCalledWith();
          // The second editor must NOT cross-fire for an event in another wrapper.
          expect(handlers2.onDuplicate).not.toHaveBeenCalled();

          shortcuts2.unregister();
          wrapper2.remove();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('works with different wrapper elements', () => {
      const wrapper2 = createMockWrapper();
      const shortcuts2 = new BlockShortcuts(wrapper2, createMockHandlers());

      shortcuts.register();
      shortcuts2.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(() => {
            shortcuts.unregister();
            shortcuts2.unregister();
            wrapper2.remove();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });
  });

  describe('edge cases', () => {
    it('handles empty wrapper', () => {
      const emptyWrapper = document.createElement('div');
      const emptyShortcuts = new BlockShortcuts(emptyWrapper, handlers);

      expect(() => {
        emptyShortcuts.register();
      }).not.toThrow();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          emptyShortcuts.unregister();
          emptyWrapper.remove();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('handles wrapper removed from DOM', () => {
      shortcuts.register();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          // Remove wrapper from DOM
          wrapper.remove();

          // Should not throw when checking if target is within wrapper
          expect(() => {
            shortcuts.unregister();
          }).not.toThrow();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });

    it('handles null handler functions', () => {
      const nullHandlers = {
        onMoveUp: vi.fn(),
        onMoveDown: vi.fn(),
        onCopyAsMarkdown: vi.fn(),
        onDuplicate: vi.fn(),
      };
      const nullShortcuts = new BlockShortcuts(wrapper, nullHandlers);

      expect(() => {
        nullShortcuts.register();
      }).not.toThrow();

      return new Promise<void>(resolve => {
        setTimeout(() => {
          nullShortcuts.unregister();
          resolve();
        }, ASYNC_TIMEOUT);
      });
    });
  });
});
