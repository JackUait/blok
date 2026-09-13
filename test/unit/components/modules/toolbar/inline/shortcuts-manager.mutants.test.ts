import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { InlineTool } from '../../../../../../types';
import type { InlineToolAdapter } from '../../../../../../src/components/tools/inline';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import { InlineShortcutManager } from '../../../../../../src/components/modules/toolbar/inline/shortcuts-manager';

/**
 * Mutation coverage for src/components/modules/toolbar/inline/shortcuts-manager.ts.
 *
 * Levers that make the private paths observable through the public API:
 * - The real Shortcuts singleton is used, so a registered shortcut is observed
 *   by dispatching a real `keydown` on `document` and watching the callback and
 *   `event.defaultPrevented` — never by spying on the module.
 * - `getBlok` is a mock, so the modules it returns can differ BETWEEN calls.
 *   That is the only way to distinguish the `Tools === undefined` guard (which
 *   returns before the second call) from the code after it.
 * - `CommonInternalSettings.Shortcut` is the string 'shortcut', so an internal
 *   tool's adapter shortcut and its created-instance shortcut share a key; they
 *   must carry different values or the internal branch is indistinguishable.
 * - A handler that throws inside jsdom surfaces on window's `error` event, not
 *   in the test, so every dispatch is wrapped by a window error recorder.
 *
 * 15 mutants are equivalent, from two structural facts (both MEASURED here, not
 * argued — each is pinned by a test in this file, and each mutant was observed
 * to survive that test in the sweep):
 *
 * 1. `enableShortcuts` runs at most ONCE per tool name. It is reached only from
 *    `registerInitialShortcuts`, which sets `shortcutsRegistered` on every pass
 *    that reaches it, and `destroy()` clears `registeredShortcuts` along with
 *    the flag. So `registeredShortcuts.get(toolName)` is always undefined on
 *    entry. That makes the `registeredShortcut === shortcut` guard, the
 *    `registeredShortcut !== undefined` re-registration block and its two calls
 *    dead, and it makes `name !== toolName` inside
 *    `isShortcutTakenByAnotherTool` unable to differ (it differs only when a
 *    tool re-registers its own shortcut). Pinned by "does not register tools
 *    added after a successful registration".
 *    The same fact masks the `shortcut === undefined` guard: with it removed,
 *    `undefined === undefined` returns one frame later, so nothing is written.
 *    Pinned by "does not register a tool that declares no shortcut".
 *
 * 2. Skipping a shortcut already claimed by another tool is observationally
 *    identical to attempting it: `Shortcuts.add` throws on a duplicate name
 *    BEFORE any state is written, and `tryEnableShortcut` swallows the throw,
 *    so `registeredShortcuts` and the document listeners end up the same either
 *    way. That covers the whole `isShortcutTakenByAnotherTool` family. Pinned
 *    by "leaves a shortcut already claimed by another tool with its first
 *    owner", which asserts both tools' registration state, the single callback
 *    invocation and the absence of a window error.
 */

interface ToolsHost {
  inlineTools: Map<string, InlineToolAdapter> | undefined;
  internal: { inlineTools: Map<string, InlineToolAdapter> };
}

interface BlokHost {
  Tools: ToolsHost | undefined;
  BlockManager: {
    currentBlock: unknown;
    getBlockByChildNode: (node: Node) => unknown;
  };
}

const createAdapter = (options: {
  name: string;
  adapterShortcut?: string;
  instanceShortcut?: string;
  nativeCaretShortcut?: boolean;
}): InlineToolAdapter => ({
  name: options.name,
  title: options.name,
  shortcut: options.adapterShortcut,
  nativeCaretShortcut: options.nativeCaretShortcut ?? false,
  create: (): InlineTool => ({
    shortcut: options.instanceShortcut,
    render: () => document.createElement('button'),
  } as unknown as InlineTool),
} as unknown as InlineToolAdapter);

const createHost = (options: {
  inlineTools?: Map<string, InlineToolAdapter>;
  internalInlineTools?: Map<string, InlineToolAdapter>;
  enabledInlineTools?: boolean;
} = {}): BlokHost => ({
  Tools: {
    inlineTools: options.inlineTools ?? new Map<string, InlineToolAdapter>(),
    internal: { inlineTools: options.internalInlineTools ?? new Map<string, InlineToolAdapter>() },
  },
  BlockManager: {
    currentBlock: { tool: { enabledInlineTools: options.enabledInlineTools ?? true } },
    getBlockByChildNode: () => undefined,
  },
});

const managers: InlineShortcutManager[] = [];
let windowErrors: string[] = [];
let onShortcutPressed: ReturnType<typeof vi.fn>;

const recordError = (event: ErrorEvent): void => {
  windowErrors.push(event.message);
};

/**
 * Builds a manager whose modules come from the given host, tracked for teardown.
 * @param host - modules object the manager reads on every getBlok call
 */
const createManager = (host: BlokHost): InlineShortcutManager => {
  const getBlok = (): BlokModules => host as unknown as BlokModules;
  const manager = new InlineShortcutManager(getBlok, onShortcutPressed as (name: string) => Promise<void>);

  managers.push(manager);

  return manager;
};

/**
 * Dispatches a keydown on document and reports whether it was prevented.
 * @param init - keyboard event properties
 */
const press = (init: KeyboardEventInit): boolean => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  document.dispatchEvent(event);

  return event.defaultPrevented;
};

/**
 * Selects the first three characters of a fresh text node in the document.
 */
const selectSomeText = (): void => {
  const host = document.createElement('div');

  host.textContent = 'abcdef';
  document.body.appendChild(host);

  const textNode = host.firstChild;

  if (textNode === null) {
    throw new Error('text node missing');
  }

  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('no selection in this environment');
  }

  const range = document.createRange();

  range.setStart(textNode, 0);
  range.setEnd(textNode, 3);
  selection.removeAllRanges();
  selection.addRange(range);
};

beforeEach(() => {
  vi.clearAllMocks();
  windowErrors = [];
  onShortcutPressed = vi.fn(() => Promise.resolve());
  window.addEventListener('error', recordError);
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  vi.unstubAllGlobals();
  managers.splice(0).forEach((manager) => manager.destroy());
  window.removeEventListener('error', recordError);
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('InlineShortcutManager — getShortcut', () => {
  it('returns the adapter shortcut for an external tool', () => {
    const host = createHost({
      inlineTools: new Map([['marker', createAdapter({ name: 'marker',
        adapterShortcut: 'CMD+M' })]]),
    });

    expect(createManager(host).getShortcut('marker')).toBe('CMD+M');
  });

  it('returns the created instance shortcut for an internal tool, not the adapter one', () => {
    const adapter = createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+Q',
      instanceShortcut: 'CMD+B' });
    const host = createHost({
      inlineTools: new Map([['bold', adapter]]),
      internalInlineTools: new Map([['bold', adapter]]),
    });

    expect(createManager(host).getShortcut('bold')).toBe('CMD+B');
  });

  it('returns undefined for an internal tool that has no adapter to create', () => {
    const host = createHost({
      internalInlineTools: new Map([['ghost', createAdapter({ name: 'ghost',
        instanceShortcut: 'CMD+G' })]]),
    });

    expect(createManager(host).getShortcut('ghost')).toBeUndefined();
  });
});

describe('InlineShortcutManager — registration', () => {
  it('registers a tool shortcut and invokes the callback when it is pressed', () => {
    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('bold')).toBe(true);

    const prevented = press({ code: 'KeyB',
      ctrlKey: true });

    expect(onShortcutPressed).toHaveBeenCalledWith('bold');
    expect(prevented).toBe(true);
    expect(windowErrors).toEqual([]);
  });

  it.each([
    ['ctrl', { ctrlKey: true }, true],
    ['meta', { metaKey: true }, true],
    ['ctrl+shift', { ctrlKey: true,
      shiftKey: true }, false],
    ['ctrl+alt', { ctrlKey: true,
      altKey: true }, false],
    ['shift', { shiftKey: true }, false],
    ['alt', { altKey: true }, false],
    ['none', {}, false],
  ])('CMD+B fires for %s: %s', (_label, modifiers: KeyboardEventInit, shouldFire) => {
    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    });

    createManager(host).tryRegisterShortcuts();

    const prevented = press({ code: 'KeyB',
      ...modifiers });

    expect(onShortcutPressed).toHaveBeenCalledTimes(shouldFire ? 1 : 0);
    expect(prevented).toBe(shouldFire);
  });

  it('does not register a tool that declares no shortcut', () => {
    const host = createHost({
      inlineTools: new Map([['plain', createAdapter({ name: 'plain' })]]),
    });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('plain')).toBe(false);
  });

  it('does not register tools added after a successful registration', () => {
    const tools = new Map([['bold', createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+B' })]]);
    const host = createHost({ inlineTools: tools });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();
    tools.set('italic', createAdapter({ name: 'italic',
      adapterShortcut: 'CMD+I' }));
    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('italic')).toBe(false);

    press({ code: 'KeyI',
      ctrlKey: true });

    expect(onShortcutPressed).not.toHaveBeenCalled();
  });

  it('keeps retrying while the tool list is empty and registers once it fills', () => {
    vi.useFakeTimers();

    const tools = new Map<string, InlineToolAdapter>();
    const host = createHost({ inlineTools: tools });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('bold')).toBe(false);

    tools.set('bold', createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+B' }));
    vi.runOnlyPendingTimers();

    expect(manager.hasShortcut('bold')).toBe(true);
  });

  it('schedules only one retry no matter how many times registration fails', () => {
    vi.useFakeTimers();

    const manager = createManager(createHost());

    manager.tryRegisterShortcuts();
    manager.tryRegisterShortcuts();
    manager.tryRegisterShortcuts();

    expect(vi.getTimerCount()).toBe(1);
  });

  it('schedules a fresh retry after a retry that also failed', () => {
    vi.useFakeTimers();

    const tools = new Map<string, InlineToolAdapter>();
    const host = createHost({ inlineTools: tools });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();
    vi.runOnlyPendingTimers();

    expect(vi.getTimerCount()).toBe(1);

    tools.set('bold', createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+B' }));
    vi.runOnlyPendingTimers();

    expect(manager.hasShortcut('bold')).toBe(true);
  });
});

describe('InlineShortcutManager — missing modules', () => {
  it('does not register on the tick where Tools is missing, even if it appears mid-call', () => {
    vi.useFakeTimers();

    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    });
    const getBlok = vi.fn(() => host as unknown as BlokModules);

    getBlok.mockImplementationOnce(() => ({ ...host,
      Tools: undefined }) as unknown as BlokModules);

    const manager = new InlineShortcutManager(getBlok, onShortcutPressed as (name: string) => Promise<void>);

    managers.push(manager);
    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('bold')).toBe(false);
  });

  it('retries after Tools is missing and registers when it arrives', () => {
    vi.useFakeTimers();

    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    });

    host.Tools = undefined;

    const manager = createManager(host);

    manager.tryRegisterShortcuts();
    host.Tools = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    }).Tools;
    vi.runOnlyPendingTimers();

    expect(manager.hasShortcut('bold')).toBe(true);
  });

  it('survives a Tools.inlineTools that is missing and registers on the retry', () => {
    vi.useFakeTimers();

    const host = createHost();
    const tools = host.Tools;

    if (tools === undefined) {
      throw new Error('Tools host missing');
    }

    tools.inlineTools = undefined;

    const manager = createManager(host);

    expect(() => manager.tryRegisterShortcuts()).not.toThrow();
    expect(manager.hasShortcut('bold')).toBe(false);

    tools.inlineTools = new Map([['bold', createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+B' })]]);
    vi.runOnlyPendingTimers();

    expect(manager.hasShortcut('bold')).toBe(true);
  });

  it('survives Tools disappearing between the guard and the registration read', () => {
    vi.useFakeTimers();

    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    });
    const getBlok = vi.fn(() => ({ ...host,
      Tools: undefined }) as unknown as BlokModules);

    getBlok.mockImplementationOnce(() => host as unknown as BlokModules);

    const manager = new InlineShortcutManager(getBlok, onShortcutPressed as (name: string) => Promise<void>);

    managers.push(manager);

    expect(() => manager.tryRegisterShortcuts()).not.toThrow();
    expect(manager.hasShortcut('bold')).toBe(false);
  });
});

describe('InlineShortcutManager — conflicting shortcuts', () => {
  it('registers a second tool that uses a different shortcut', () => {
    const host = createHost({
      inlineTools: new Map([
        ['bold', createAdapter({ name: 'bold',
          adapterShortcut: 'CMD+B' })],
        ['italic', createAdapter({ name: 'italic',
          adapterShortcut: 'CMD+I' })],
      ]),
    });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('italic')).toBe(true);

    press({ code: 'KeyI',
      ctrlKey: true });

    expect(onShortcutPressed).toHaveBeenCalledWith('italic');
  });

  it('leaves a shortcut already claimed by another tool with its first owner', () => {
    const host = createHost({
      inlineTools: new Map([
        ['bold', createAdapter({ name: 'bold',
          adapterShortcut: 'CMD+B' })],
        ['strong', createAdapter({ name: 'strong',
          adapterShortcut: 'CMD+B' })],
      ]),
    });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();

    expect(manager.hasShortcut('strong')).toBe(false);
    expect(manager.hasShortcut('bold')).toBe(true);

    press({ code: 'KeyB',
      ctrlKey: true });

    expect(onShortcutPressed).toHaveBeenCalledTimes(1);
    expect(onShortcutPressed).toHaveBeenCalledWith('bold');
  });
});

describe('InlineShortcutManager — native caret shortcuts', () => {
  /**
   * Registers a single tool and returns its manager.
   * @param nativeCaretShortcut - whether the tool defers to the browser
   */
  const setup = (nativeCaretShortcut: boolean): { host: BlokHost } => {
    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B',
        nativeCaretShortcut })]]),
    });

    createManager(host).tryRegisterShortcuts();

    return { host };
  };

  it('leaves the keystroke to the browser at a collapsed caret', () => {
    setup(true);

    const prevented = press({ code: 'KeyB',
      ctrlKey: true });

    expect(onShortcutPressed).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
    expect(windowErrors).toEqual([]);
  });

  it('still runs the tool when text is selected', () => {
    setup(true);
    selectSomeText();

    const prevented = press({ code: 'KeyB',
      ctrlKey: true });

    expect(onShortcutPressed).toHaveBeenCalledWith('bold');
    expect(prevented).toBe(true);
  });

  it('runs a non-native tool at a collapsed caret', () => {
    setup(false);

    const prevented = press({ code: 'KeyB',
      ctrlKey: true });

    expect(onShortcutPressed).toHaveBeenCalledWith('bold');
    expect(prevented).toBe(true);
  });

  it('runs the tool when the adapter is gone from the tool list', () => {
    const { host } = setup(true);

    host.Tools?.inlineTools?.delete('bold');

    const prevented = press({ code: 'KeyB',
      ctrlKey: true });

    expect(windowErrors).toEqual([]);
    expect(onShortcutPressed).toHaveBeenCalledWith('bold');
    expect(prevented).toBe(true);
  });
});

describe('InlineShortcutManager — destroy', () => {
  it('stops handling the shortcut after destroy', () => {
    const host = createHost({
      inlineTools: new Map([['bold', createAdapter({ name: 'bold',
        adapterShortcut: 'CMD+B' })]]),
    });
    const manager = createManager(host);

    manager.tryRegisterShortcuts();
    manager.destroy();

    const prevented = press({ code: 'KeyB',
      ctrlKey: true });

    expect(onShortcutPressed).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
    expect(manager.hasShortcut('bold')).toBe(false);
  });
});

describe('InlineShortcutManager — environments without a timer', () => {
  it('retries synchronously when window has no setTimeout', () => {
    const tools = new Map<string, InlineToolAdapter>();
    const host = createHost({ inlineTools: tools });
    const realGetSelection = window.getSelection.bind(window);

    vi.stubGlobal('window', { getSelection: realGetSelection });

    const manager = createManager(host);
    let reads = 0;
    const hostTools = host.Tools;

    if (hostTools === undefined) {
      throw new Error('Tools host missing');
    }

    Object.defineProperty(hostTools, 'inlineTools', {
      configurable: true,
      get: () => {
        reads += 1;

        return reads === 1 ? undefined : tools;
      },
    });
    tools.set('bold', createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+B' }));

    expect(() => manager.tryRegisterShortcuts()).not.toThrow();
    expect(manager.hasShortcut('bold')).toBe(true);
  });

  it('retries synchronously when there is no window at all', () => {
    const tools = new Map<string, InlineToolAdapter>();
    const host = createHost({ inlineTools: tools });

    vi.stubGlobal('window', undefined);

    const manager = createManager(host);
    let reads = 0;
    const hostTools = host.Tools;

    if (hostTools === undefined) {
      throw new Error('Tools host missing');
    }

    Object.defineProperty(hostTools, 'inlineTools', {
      configurable: true,
      get: () => {
        reads += 1;

        return reads === 1 ? undefined : tools;
      },
    });
    tools.set('bold', createAdapter({ name: 'bold',
      adapterShortcut: 'CMD+B' }));

    expect(() => manager.tryRegisterShortcuts()).not.toThrow();
    expect(manager.hasShortcut('bold')).toBe(true);
  });
});
