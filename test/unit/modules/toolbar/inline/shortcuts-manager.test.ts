import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InlineShortcutManager } from '../../../../../src/components/modules/toolbar/inline/index';
import type { InlineToolAdapter } from '../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { Shortcuts } from '../../../../../src/components/utils/shortcuts';

vi.mock('../../../../../src/components/utils/shortcuts', () => ({
  Shortcuts: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('InlineShortcutManager', () => {
  let shortcutManager: InlineShortcutManager;
  let mockBlok: BlokModules;
  let onShortcutPressedCallback: (toolName: string) => Promise<void>;

  const createMockInlineToolAdapter = (
    name: string,
    options: {
      shortcut?: string;
    } = {}
  ): InlineToolAdapter => {
    return {
      name,
      title: name,
      shortcut: options.shortcut,
      isReadOnlySupported: true,
      create: () => ({ render: () => document.createElement('button') }),
    } as unknown as InlineToolAdapter;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useFakeTimers();

    onShortcutPressedCallback = vi.fn(async (_toolName: string) => {}) as unknown as (toolName: string) => Promise<void>;

    mockBlok = {
      Tools: {
        inlineTools: new Map(),
        internal: {
          inlineTools: new Map(),
        },
      },
      BlockManager: {
        currentBlock: undefined,
      },
      I18n: {
        t: vi.fn((key: string) => key),
      },
    } as unknown as BlokModules;

    const getBlok = () => mockBlok;
    shortcutManager = new InlineShortcutManager(getBlok, onShortcutPressedCallback);

    // Setup window setTimeout for scheduling
    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {
        setTimeout: vi.fn((cb: () => void) => {
          cb();
          return 1;
        }),
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('tryRegisterShortcuts', () => {
    it('should schedule registration when Tools is not available', () => {
      mockBlok.Tools = undefined as unknown as typeof mockBlok.Tools;

      shortcutManager.tryRegisterShortcuts();

      expect(Shortcuts.add).not.toHaveBeenCalled();
    });

    it('should register shortcuts when tools are available', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      shortcutManager.tryRegisterShortcuts();

      vi.runAllTimers();

      expect(Shortcuts.add).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'CMD+B',
        })
      );
    });

    it('should not register shortcuts twice', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      const addCallCount = (Shortcuts.add as ReturnType<typeof vi.fn>).mock.calls.length;

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      expect((Shortcuts.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(addCallCount);
    });

    it('should schedule retry when inlineTools is empty', () => {
      const newToolsMock = {
        inlineTools: new Map(),
        internal: {
          inlineTools: new Map(),
        },
      };
      mockBlok.Tools = newToolsMock as unknown as typeof mockBlok.Tools;

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      shortcutManager.tryRegisterShortcuts();

      // Should schedule a retry
      expect(setTimeoutSpy).toHaveBeenCalled();
      // Should not register shortcuts since tools are empty
      expect(Shortcuts.add).not.toHaveBeenCalled();
      // Verify shortcuts are not registered (real state check)
      expect(shortcutManager.hasShortcut('anyTool')).toBe(false);

      // Run only the pending timer, not all (to avoid infinite loop)
      vi.runOnlyPendingTimers();
    });
  });

  describe('getShortcut', () => {
    it('should return shortcut for custom tool', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const shortcut = shortcutManager.getShortcut('bold');

      expect(shortcut).toBe('CMD+B');
    });

    it('should return undefined for tool without shortcut', () => {
      const boldAdapter = createMockInlineToolAdapter('bold');
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const shortcut = shortcutManager.getShortcut('bold');

      expect(shortcut).toBeUndefined();
    });

    it('should return undefined for non-existent tool', () => {
      const shortcut = shortcutManager.getShortcut('nonexistent');

      expect(shortcut).toBeUndefined();
    });
  });

  describe('hasShortcut', () => {
    it('should return false before shortcuts are registered', () => {
      expect(shortcutManager.hasShortcut('bold')).toBe(false);
    });

    it('should return true after shortcut is registered', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      expect(shortcutManager.hasShortcut('bold')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should remove all registered shortcuts', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      const italicAdapter = createMockInlineToolAdapter('italic', { shortcut: 'CMD+I' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);
      mockBlok.Tools.inlineTools.set('italic', italicAdapter);

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      // Verify shortcuts are registered
      expect(shortcutManager.hasShortcut('bold')).toBe(true);
      expect(shortcutManager.hasShortcut('italic')).toBe(true);

      shortcutManager.destroy();

      expect(Shortcuts.remove).toHaveBeenCalledTimes(2);
      // Verify shortcuts are removed
      expect(shortcutManager.hasShortcut('bold')).toBe(false);
      expect(shortcutManager.hasShortcut('italic')).toBe(false);
    });

    it('should clear registered shortcuts map', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      expect(shortcutManager.hasShortcut('bold')).toBe(true);

      shortcutManager.destroy();

      expect(shortcutManager.hasShortcut('bold')).toBe(false);
    });

    it('should reset shortcutsRegistered flag', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      shortcutManager.destroy();

      // Should be able to register again after destroy
      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      expect(Shortcuts.add).toHaveBeenCalled();
      // Verify shortcut is registered again
      expect(shortcutManager.hasShortcut('bold')).toBe(true);
    });
  });

  describe('shortcut handler', () => {
    it('should call onShortcutPressed when shortcut is triggered', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const mockBlock = {
        tool: {
          enabledInlineTools: true,
        },
      };
      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      // Get the handler that was passed to Shortcuts.add
      const addCall = (Shortcuts.add as ReturnType<typeof vi.fn>).mock.calls[0];
      const shortcutConfig = addCall[0] as { name: string; handler: (event: Event) => void };
      const handler = shortcutConfig.handler;

      const mockEvent = { preventDefault: vi.fn() } as unknown as Event;
      handler(mockEvent);

      expect(onShortcutPressedCallback).toHaveBeenCalledWith('bold');
    });

    it('should not call onShortcutPressed when no current block', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      mockBlok.BlockManager.currentBlock = undefined;

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      const addCall = (Shortcuts.add as ReturnType<typeof vi.fn>).mock.calls[0];
      const shortcutConfig = addCall[0] as { name: string; handler: (event: Event) => void };
      const handler = shortcutConfig.handler;

      const mockEvent = { preventDefault: vi.fn() } as unknown as Event;
      handler(mockEvent);

      expect(onShortcutPressedCallback).not.toHaveBeenCalled();
    });

    it('should not call onShortcutPressed when inline tools are disabled for current block', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const mockBlock = {
        tool: {
          enabledInlineTools: false,
        },
      };
      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      const addCall = (Shortcuts.add as ReturnType<typeof vi.fn>).mock.calls[0];
      const shortcutConfig = addCall[0] as { name: string; handler: (event: Event) => void };
      const handler = shortcutConfig.handler;

      const mockEvent = { preventDefault: vi.fn() } as unknown as Event;
      handler(mockEvent);

      expect(onShortcutPressedCallback).not.toHaveBeenCalled();
    });

    it('should prevent default when shortcut is triggered', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const mockBlock = {
        tool: {
          enabledInlineTools: true,
        },
      };
      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;

      shortcutManager.tryRegisterShortcuts();
      vi.runAllTimers();

      const addCall = (Shortcuts.add as ReturnType<typeof vi.fn>).mock.calls[0];
      const shortcutConfig = addCall[0] as { name: string; handler: (event: Event) => void };
      const handler = shortcutConfig.handler;

      const mockEvent = { preventDefault: vi.fn() } as unknown as Event;
      handler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      // Also verify the callback was invoked
      expect(onShortcutPressedCallback).toHaveBeenCalledWith('bold');
    });
  });
});
