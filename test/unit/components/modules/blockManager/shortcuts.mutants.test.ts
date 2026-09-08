import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockShortcuts } from '../../../../../src/components/modules/blockManager/shortcuts';
import type { BlockShortcutsHandlers } from '../../../../../src/components/modules/blockManager/shortcuts';

/**
 * Mutation-targeted coverage for `src/components/modules/blockManager/shortcuts.ts`.
 *
 * PROVEN-EQUIVALENT survivor:
 *
 * - `ConditionalExpression: true` on `this.registerTimeout !== null` (line 102).
 *   The guarded body is `clearTimeout(this.registerTimeout); this.registerTimeout = null;`
 *   and it only runs extra when `registerTimeout` is already `null`. Per the HTML
 *   spec, `clearTimeout` with a handle that matches no timer does nothing, and
 *   re-assigning `null` over `null` is a no-op, so the mutant performs the same
 *   observable work. Confirmed against jsdom: `clearTimeout(null)` returns
 *   without throwing; these tests run on fake timers, where the mutant also
 *   produced no failure of any kind.
 */

const createHandlers = (): BlockShortcutsHandlers => ({
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onCopyAsMarkdown: vi.fn(),
  onDuplicate: vi.fn(),
});

interface Harness {
  shortcuts: BlockShortcuts;
  handlers: BlockShortcutsHandlers;
  child: HTMLElement;
}

const instances: BlockShortcuts[] = [];
const wrappers: HTMLElement[] = [];

/**
 * A fresh wrapper per harness: a mutant that breaks unregister leaves listeners
 * on `document`, and a detached wrapper of its own keeps them from firing for
 * the next test.
 */
const makeHarness = (): Harness => {
  const wrapper = document.createElement('div');
  const child = document.createElement('div');

  wrapper.appendChild(child);
  document.body.appendChild(wrapper);
  wrappers.push(wrapper);

  const handlers = createHandlers();
  const shortcuts = new BlockShortcuts(wrapper, handlers);

  instances.push(shortcuts);

  return { shortcuts, handlers, child };
};

const pressDuplicate = (from: HTMLElement): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyD',
    key: 'd',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });

  from.dispatchEvent(event);

  return event;
};

describe('BlockShortcuts mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const shortcuts of instances.reverse()) {
      shortcuts.unregister();
    }
    for (const wrapper of wrappers) {
      wrapper.remove();
    }
    instances.length = 0;
    wrappers.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cancels a pending registration when unregister runs before the timer fires', () => {
    const { shortcuts, handlers, child } = makeHarness();

    shortcuts.register();
    shortcuts.unregister();
    vi.runAllTimers();

    pressDuplicate(child);

    expect(handlers.onDuplicate).not.toHaveBeenCalled();
  });

  it('detaches the document listeners when unregister runs after the timer fired', () => {
    const { shortcuts, handlers, child } = makeHarness();

    shortcuts.register();
    vi.runAllTimers();
    shortcuts.unregister();

    pressDuplicate(child);

    expect(handlers.onDuplicate).not.toHaveBeenCalled();
  });

  it('runs a handler once when register is called twice', () => {
    const { shortcuts, handlers, child } = makeHarness();

    shortcuts.register();
    vi.runAllTimers();
    shortcuts.register();
    vi.runAllTimers();

    pressDuplicate(child);

    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('consumes the keydown it acts on', () => {
    const { shortcuts, handlers, child } = makeHarness();

    shortcuts.register();
    vi.runAllTimers();

    const event = pressDuplicate(child);

    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
