import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { InlineShortcutManager } from '../../../../../src/components/modules/toolbar/inline/shortcuts-manager';
import { Shortcuts } from '../../../../../src/components/utils/shortcuts';
import type { InlineToolAdapter } from '../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

vi.mock('../../../../../src/components/utils/shortcuts', () => ({
  Shortcuts: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

/**
 * Mutation-focused suite for InlineShortcutManager.
 *
 * It is deliberately separate from shortcuts-manager.test.ts: that file imports
 * the inline-toolbar barrel, whose module closure reaches unrelated sources.
 * This one imports the class module directly, so a sweep run against it can only
 * observe this file's own source.
 *
 * PROVEN EQUIVALENT (no test can kill it):
 * - ConditionalExpression `name !== toolName` -> `true`
 *   (isShortcutTakenByAnotherTool, line 215). Flipping the guard to `true` only
 *   lets the tool's OWN entry take part in the `some()`. enableShortcuts line 158
 *   already returned when `registeredShortcut === shortcut`, so by the time
 *   line 162 calls this method the own entry's value can never equal `shortcut`,
 *   and the extra candidate can never match. isShortcutTakenByAnotherTool has no
 *   other caller (line 162 is the only one).
 */
describe('InlineShortcutManager (mutants)', () => {
  let manager: InlineShortcutManager;
  let modules: BlokModules;
  let getBlok: Mock<() => BlokModules>;
  let onShortcutPressed: Mock<(toolName: string) => Promise<void>>;
  let setTimeoutSpy: Mock<typeof window.setTimeout>;

  interface AdapterOptions {
    shortcut?: string;
    nativeCaretShortcut?: boolean;
    instanceShortcut?: string;
  }

  const adapter = (name: string, options: AdapterOptions = {}): InlineToolAdapter => {
    return {
      name,
      shortcut: options.shortcut,
      nativeCaretShortcut: options.nativeCaretShortcut,
      create: () => ({ shortcut: options.instanceShortcut }),
    } as unknown as InlineToolAdapter;
  };

  /**
   * An adapter whose `shortcut` read throws.
   *
   * It is the only public-API way to leave the manager with a populated
   * `registeredShortcuts` map AND `shortcutsRegistered === false`: getShortcut is
   * called from registerInitialShortcuts' forEach, outside tryEnableShortcut's
   * try/catch, so the throw aborts the pass after earlier tools were registered.
   * That is what makes a SECOND registration pass reachable.
   */
  const throwingAdapter = (name: string): InlineToolAdapter => {
    return {
      name,
      get shortcut(): string | undefined {
        throw new Error('boom');
      },
      create: () => ({}),
    } as unknown as InlineToolAdapter;
  };

  interface ModulesOptions {
    inlineTools?: Map<string, InlineToolAdapter>;
    internalNames?: string[];
    currentBlock?: unknown;
  }

  const createModules = (options: ModulesOptions = {}): BlokModules => {
    const internal = new Map<string, InlineToolAdapter | undefined>(
      (options.internalNames ?? []).map((name) => [name, undefined])
    );

    return {
      Tools: {
        inlineTools: options.inlineTools ?? new Map<string, InlineToolAdapter>(),
        internal: { inlineTools: internal },
      },
      BlockManager: {
        currentBlock: options.currentBlock,
        getBlockByChildNode: vi.fn(() => undefined),
      },
    } as unknown as BlokModules;
  };

  const modulesWithoutTools = (): BlokModules => {
    return {
      BlockManager: {
        currentBlock: undefined,
        getBlockByChildNode: vi.fn(() => undefined),
      },
    } as unknown as BlokModules;
  };

  const addedShortcutNames = (): string[] => {
    return vi.mocked(Shortcuts.add).mock.calls.map(([config]) => config.name);
  };

  const removeCalls = (): [HTMLElement | Document, string][] => {
    return vi.mocked(Shortcuts.remove).mock.calls;
  };

  const registeredHandler = (index = 0): ((event: KeyboardEvent) => void) => {
    const call = vi.mocked(Shortcuts.add).mock.calls[index];

    if (call === undefined) {
      throw new Error(`Shortcuts.add was never called at index ${index}`);
    }

    return call[0].handler;
  };

  const enabledBlock = (): unknown => ({ tool: { enabledInlineTools: true } });

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks only drops call history; a queued mockImplementationOnce
    // survives it and would leak into the next test.
    vi.mocked(Shortcuts.add).mockReset();
    vi.mocked(Shortcuts.remove).mockReset();

    vi.useFakeTimers();
    setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    modules = createModules();
    getBlok = vi.fn((): BlokModules => modules);
    onShortcutPressed = vi.fn(async (_toolName: string): Promise<void> => {});

    manager = new InlineShortcutManager(getBlok, onShortcutPressed);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('tryRegisterShortcuts', () => {
    it('registers once and ignores tools added after a successful pass', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
      ]);

      modules = createModules({ inlineTools: tools });

      manager.tryRegisterShortcuts();

      tools.set('italic', adapter('italic', { shortcut: 'CMD+I' }));
      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('italic')).toBe(false);
      expect(manager.hasShortcut('bold')).toBe(true);
      expect(removeCalls()).toStrictEqual([]);
    });

    it('schedules a retry and registers nothing when the modules bag has no Tools', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
      ]);

      modules = createModules({ inlineTools: tools });
      getBlok.mockReturnValueOnce(modulesWithoutTools());

      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual([]);
      expect(manager.hasShortcut('bold')).toBe(false);
      expect(setTimeoutSpy.mock.calls.length).toBe(1);
    });

    it('retries an empty tool map on a timer and registers what appears meanwhile', () => {
      const tools = new Map<string, InlineToolAdapter>();

      modules = createModules({ inlineTools: tools });

      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual([]);
      expect(setTimeoutSpy.mock.calls.length).toBe(1);

      tools.set('bold', adapter('bold', { shortcut: 'CMD+B' }));
      vi.runOnlyPendingTimers();

      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);
    });

    it('queues at most one pending retry', () => {
      modules = createModules({ inlineTools: new Map<string, InlineToolAdapter>() });

      manager.tryRegisterShortcuts();
      manager.tryRegisterShortcuts();

      expect(setTimeoutSpy.mock.calls.length).toBe(1);
      expect(addedShortcutNames()).toStrictEqual([]);
    });

    it('clears the pending flag when a retry runs so the next failure queues again', () => {
      modules = createModules({ inlineTools: new Map<string, InlineToolAdapter>() });

      manager.tryRegisterShortcuts();

      expect(setTimeoutSpy.mock.calls.length).toBe(1);

      vi.runOnlyPendingTimers();

      expect(setTimeoutSpy.mock.calls.length).toBe(2);
      expect(addedShortcutNames()).toStrictEqual([]);
    });

    it('survives a modules bag that loses Tools between the two reads of a pass', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
      ]);
      const ready = createModules({ inlineTools: tools });

      modules = ready;
      // tryRegisterShortcuts reads getBlok() at line 57, registerInitialShortcuts
      // again at line 111. Only the second read is starved.
      getBlok.mockReturnValueOnce(ready).mockReturnValueOnce(modulesWithoutTools());

      let error: unknown;

      try {
        manager.tryRegisterShortcuts();
      } catch (thrown) {
        error = thrown;
      }

      expect(error).toBeUndefined();
      expect(addedShortcutNames()).toStrictEqual([]);
      expect(setTimeoutSpy.mock.calls.length).toBe(1);

      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);
    });
  });

  describe('getShortcut', () => {
    it('reads an internal tool shortcut off the created instance, not the adapter', () => {
      const bold = adapter('bold', { shortcut: 'ADAPTER+B', instanceShortcut: 'CMD+B' });

      modules = createModules({
        inlineTools: new Map([['bold', bold]]),
        internalNames: ['bold'],
      });

      let result: string | undefined;
      let error: unknown;

      try {
        result = manager.getShortcut('bold');
      } catch (thrown) {
        error = thrown;
      }

      expect(error).toBeUndefined();
      expect(result).toBe('CMD+B');
    });

    it('returns undefined for an internal tool with no adapter behind it', () => {
      modules = createModules({
        inlineTools: new Map<string, InlineToolAdapter>(),
        internalNames: ['link'],
      });

      let result: string | undefined = 'not-read';
      let error: unknown;

      try {
        result = manager.getShortcut('link');
      } catch (thrown) {
        error = thrown;
      }

      expect(error).toBeUndefined();
      expect(result).toBeUndefined();
    });
  });

  describe('enableShortcuts', () => {
    /**
     * Runs a first pass that registers `bold` with CMD+B and then aborts on a
     * throwing adapter, leaving shortcutsRegistered false so a second pass runs.
     */
    const runAbortedFirstPass = (tools: Map<string, InlineToolAdapter>): void => {
      tools.set('bold', adapter('bold', { shortcut: 'CMD+B' }));
      tools.set('boom', throwingAdapter('boom'));

      modules = createModules({ inlineTools: tools });

      expect(() => manager.tryRegisterShortcuts()).toThrow('boom');
      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);

      tools.delete('boom');
    };

    it('does nothing on a second pass when the shortcut is unchanged', () => {
      const tools = new Map<string, InlineToolAdapter>();

      runAbortedFirstPass(tools);

      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(removeCalls()).toStrictEqual([]);
      expect(manager.hasShortcut('bold')).toBe(true);
    });

    it('keeps the existing registration when the tool stops declaring a shortcut', () => {
      const tools = new Map<string, InlineToolAdapter>();

      runAbortedFirstPass(tools);

      tools.set('bold', adapter('bold'));
      manager.tryRegisterShortcuts();

      expect(removeCalls()).toStrictEqual([]);
      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);
    });

    it('removes the old binding before adding a changed one', () => {
      const tools = new Map<string, InlineToolAdapter>();

      runAbortedFirstPass(tools);

      tools.set('bold', adapter('bold', { shortcut: 'CMD+K' }));
      manager.tryRegisterShortcuts();

      expect(removeCalls()).toStrictEqual([[document, 'CMD+B']]);
      expect(addedShortcutNames()).toStrictEqual(['CMD+B', 'CMD+K']);
      expect(manager.hasShortcut('bold')).toBe(true);
    });

    it('forgets the tool when the changed binding fails to register', () => {
      const tools = new Map<string, InlineToolAdapter>();

      runAbortedFirstPass(tools);

      tools.set('bold', adapter('bold', { shortcut: 'CMD+K' }));
      vi.mocked(Shortcuts.add).mockImplementationOnce(() => {
        throw new Error('already registered');
      });

      manager.tryRegisterShortcuts();

      expect(manager.hasShortcut('bold')).toBe(false);
      // Proves the queued once-implementation was consumed by this test.
      expect(vi.mocked(Shortcuts.add).mock.calls.length).toBe(2);
      expect(removeCalls()).toStrictEqual([[document, 'CMD+B']]);
    });

    it('refuses a shortcut another tool already owns', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
        ['strong', adapter('strong', { shortcut: 'CMD+B' })],
      ]);

      modules = createModules({ inlineTools: tools });

      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);
      expect(manager.hasShortcut('strong')).toBe(false);
      expect(removeCalls()).toStrictEqual([]);
    });
  });

  describe('registered handler', () => {
    const selectionOver = (collapsed: boolean): Selection => {
      const host = document.createElement('div');

      host.textContent = 'hello';
      document.body.append(host);

      const range = document.createRange();

      range.selectNodeContents(host);

      if (collapsed) {
        range.collapse(true);
      }

      return {
        rangeCount: 1,
        getRangeAt: () => range,
      } as unknown as Selection;
    };

    it('runs a native-caret tool when there is a real text selection', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B', nativeCaretShortcut: true })],
      ]);

      modules = createModules({ inlineTools: tools, currentBlock: enabledBlock() });
      manager.tryRegisterShortcuts();

      vi.spyOn(window, 'getSelection').mockReturnValue(selectionOver(false));

      const event = new KeyboardEvent('keydown', { cancelable: true });

      registeredHandler()(event);

      expect(onShortcutPressed.mock.calls).toStrictEqual([['bold']]);
      expect(event.defaultPrevented).toBe(true);
    });

    it('defers a native-caret tool to the browser at a collapsed caret', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B', nativeCaretShortcut: true })],
      ]);

      modules = createModules({ inlineTools: tools, currentBlock: enabledBlock() });
      manager.tryRegisterShortcuts();

      vi.spyOn(window, 'getSelection').mockReturnValue(selectionOver(true));

      const event = new KeyboardEvent('keydown', { cancelable: true });

      registeredHandler()(event);

      expect(onShortcutPressed.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    it('still fires when the tool has left the registry and there is no selection', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
      ]);

      modules = createModules({ inlineTools: tools, currentBlock: enabledBlock() });
      manager.tryRegisterShortcuts();

      tools.delete('bold');
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const event = new KeyboardEvent('keydown', { cancelable: true });
      let error: unknown;

      try {
        registeredHandler()(event);
      } catch (thrown) {
        error = thrown;
      }

      expect(error).toBeUndefined();
      expect(onShortcutPressed.mock.calls).toStrictEqual([['bold']]);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('retry scheduling without a usable window', () => {
    /**
     * Both cases need the retry to SUCCEED. A synchronous fallback over a tool
     * map that stays unusable recurses forever (callback -> tryRegisterShortcuts
     * -> scheduleShortcutRegistration -> callback), so the first getBlok read is
     * starved and every later one is healthy.
     */
    const starveFirstReadOnly = (): void => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
      ]);

      modules = createModules({ inlineTools: tools });
      getBlok.mockReturnValueOnce(modulesWithoutTools());
    };

    it('retries synchronously when window exposes no setTimeout', () => {
      starveFirstReadOnly();

      vi.stubGlobal('window', { getSelection: (): null => null });

      let error: unknown;

      try {
        manager.tryRegisterShortcuts();
      } catch (thrown) {
        error = thrown;
      }

      vi.unstubAllGlobals();

      expect(error).toBeUndefined();
      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);
    });

    it('retries synchronously when window itself is undefined', () => {
      starveFirstReadOnly();

      vi.stubGlobal('window', undefined);

      let error: unknown;

      try {
        manager.tryRegisterShortcuts();
      } catch (thrown) {
        error = thrown;
      }

      vi.unstubAllGlobals();

      expect(error).toBeUndefined();
      expect(addedShortcutNames()).toStrictEqual(['CMD+B']);
      expect(manager.hasShortcut('bold')).toBe(true);
    });
  });

  describe('destroy', () => {
    it('unbinds every registered shortcut and allows a fresh pass', () => {
      const tools = new Map<string, InlineToolAdapter>([
        ['bold', adapter('bold', { shortcut: 'CMD+B' })],
        ['italic', adapter('italic', { shortcut: 'CMD+I' })],
      ]);

      modules = createModules({ inlineTools: tools });
      manager.tryRegisterShortcuts();

      manager.destroy();

      expect(removeCalls()).toStrictEqual([
        [document, 'CMD+B'],
        [document, 'CMD+I'],
      ]);
      expect(manager.hasShortcut('bold')).toBe(false);
      expect(manager.hasShortcut('italic')).toBe(false);

      manager.tryRegisterShortcuts();

      expect(addedShortcutNames()).toStrictEqual(['CMD+B', 'CMD+I', 'CMD+B', 'CMD+I']);
    });
  });
});
