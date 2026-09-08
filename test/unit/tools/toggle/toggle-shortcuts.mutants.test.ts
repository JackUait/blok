import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import type { API, BlockAPI } from '../../../../types';
import type { ShortcutData } from '../../../../src/components/utils/shortcuts';

import { Shortcuts } from '../../../../src/components/utils/shortcuts';
import { TOGGLE_ATTR, TOOL_NAME } from '../../../../src/tools/toggle/constants';
import { ToggleShortcuts } from '../../../../src/tools/toggle/toggle-shortcuts';

/**
 * The three shortcut names the module registers, in registration order.
 * Duplicated here on purpose: a test that reads them from the source could not
 * notice the source losing them.
 */
const ALL_SHORTCUT = 'CMD+ALT+T';
const CURRENT_SHORTCUT = 'CMD+SHIFT+[';
const SCOPED_SHORTCUT = 'CMD+ALT+SHIFT+T';

/**
 * Index of each handler in the `Shortcuts.add` call list.
 * Order, not name: the name is itself under test.
 */
const ALL_HANDLER = 0;
const CURRENT_HANDLER = 1;
const SCOPED_HANDLER = 2;

interface TestBlock {
  block: BlockAPI;
  call: Mock<(method: string) => void>;
  holder: HTMLElement;
}

interface BlocksMocks {
  getCurrentBlockIndex: Mock<() => number>;
  getBlockByIndex: Mock<(index: number) => BlockAPI | undefined>;
  getById: Mock<(id: string) => BlockAPI | null>;
  getChildren: Mock<(parentId: string) => BlockAPI[]>;
  getBlocksCount: Mock<() => number>;
}

const openedWrappers: HTMLElement[] = [];
const liveInstances: ToggleShortcuts[] = [];

/**
 * Builds a block whose holder optionally carries the toggle-open marker element.
 * Omitting `open` leaves the holder empty, which is how a block with no toggle
 * wrapper reaches the code under test.
 * @param options - block identity plus the open state of its toggle wrapper
 * @returns the block, its `call` mock and its holder
 */
const createBlock = (options: {
  id: string;
  name?: string;
  parentId?: string | null;
  open?: boolean;
}): TestBlock => {
  const holder: HTMLElement = document.createElement('div');

  if (options.open !== undefined) {
    const marker: HTMLElement = document.createElement('div');

    marker.setAttribute(TOGGLE_ATTR.toggleOpen, String(options.open));
    holder.appendChild(marker);
  }

  const call: Mock<(method: string) => void> = vi.fn();

  const block = {
    id: options.id,
    name: options.name ?? TOOL_NAME,
    parentId: options.parentId ?? null,
    holder,
    call,
  } as unknown as BlockAPI;

  return { block, call, holder };
};

/**
 * Fresh blocks-API mocks with inert defaults.
 * @returns the mock set
 */
const createBlocksMocks = (): BlocksMocks => ({
  getCurrentBlockIndex: vi.fn<() => number>(() => 0),
  getBlockByIndex: vi.fn<(index: number) => BlockAPI | undefined>(() => undefined),
  getById: vi.fn<(id: string) => BlockAPI | null>(() => null),
  getChildren: vi.fn<(parentId: string) => BlockAPI[]>(() => []),
  getBlocksCount: vi.fn<() => number>(() => 0),
});

/**
 * Wraps the blocks mocks in something shaped like the editor API.
 * @param blocks - the blocks-API mocks
 * @returns an API stub
 */
const createApi = (blocks: BlocksMocks): API => ({ blocks } as unknown as API);

/**
 * Creates a ToggleShortcuts bound to a wrapper attached to the document, and
 * registers it for teardown.
 * @param blocks - the blocks-API mocks
 * @returns the instance, its wrapper and an element inside that wrapper
 */
const createShortcuts = (blocks: BlocksMocks): {
  shortcuts: ToggleShortcuts;
  wrapper: HTMLElement;
  inside: HTMLElement;
} => {
  const wrapper: HTMLElement = document.createElement('div');
  const inside: HTMLElement = document.createElement('div');

  wrapper.appendChild(inside);
  document.body.appendChild(wrapper);
  openedWrappers.push(wrapper);

  const shortcuts = new ToggleShortcuts(createApi(blocks), wrapper);

  liveInstances.push(shortcuts);

  return { shortcuts, wrapper, inside };
};

/**
 * Builds a cancelable keydown whose target is forced to the given element.
 * `cancelable: true` is what makes `defaultPrevented` mean anything.
 * @param options - target element plus the key code and modifier state
 * @returns the event
 */
const keydown = (options: {
  target: EventTarget;
  code?: string;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    code: options.code,
    metaKey: options.meta === true,
    altKey: options.alt === true,
    shiftKey: options.shift === true,
    bubbles: true,
    cancelable: true,
  });

  Object.defineProperty(event, 'target', {
    value: options.target,
    configurable: true,
  });

  return event;
};

/**
 * Reduces the `Shortcuts.remove` call list to something printable.
 * Comparing the raw Document would work but reads terribly on failure.
 * @param calls - the recorded calls
 * @returns one `[isDocument, name]` pair per call
 */
const removedNames = (calls: [HTMLElement | Document, string][]): [boolean, string][] =>
  calls.map(([element, name]) => [element === document, name]);

/**
 * Reduces the `Shortcuts.add` call list to something printable.
 * @param calls - the recorded calls
 * @returns one `[name, isDocument]` pair per call
 */
const addedNames = (calls: [ShortcutData][]): [string, boolean][] =>
  calls.map(([shortcut]) => [shortcut.name, shortcut.on === document]);

describe('ToggleShortcuts — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const instance of liveInstances) {
      instance.unregister();
    }
    liveInstances.length = 0;

    // The raw removals are the real cleanup: a mutant that guts `unregister()`
    // leaves the document listeners behind, and the empty name is what the
    // string-literal mutants register under.
    for (const name of [ALL_SHORTCUT, CURRENT_SHORTCUT, SCOPED_SHORTCUT, '']) {
      Shortcuts.remove(document, name);
    }

    for (const wrapper of openedWrappers) {
      wrapper.remove();
    }
    openedWrappers.length = 0;

    vi.restoreAllMocks();
  });

  describe('register()', () => {
    it('pre-clears and registers exactly the three named shortcuts on document', () => {
      const removeSpy = vi.spyOn(Shortcuts, 'remove');
      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts } = createShortcuts(createBlocksMocks());

      shortcuts.register();

      expect(removedNames(removeSpy.mock.calls)).toStrictEqual([
        [true, ALL_SHORTCUT],
        [true, CURRENT_SHORTCUT],
        [true, SCOPED_SHORTCUT],
      ]);
      expect(addedNames(addSpy.mock.calls)).toStrictEqual([
        [ALL_SHORTCUT, true],
        [CURRENT_SHORTCUT, true],
        [SCOPED_SHORTCUT, true],
      ]);
    });

    it('adds nothing on a second call', () => {
      const removeSpy = vi.spyOn(Shortcuts, 'remove');
      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts } = createShortcuts(createBlocksMocks());

      shortcuts.register();
      shortcuts.register();

      expect(addSpy.mock.calls).toHaveLength(3);
      expect(removeSpy.mock.calls).toHaveLength(3);
    });

    it('registers again after an unregister()', () => {
      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts } = createShortcuts(createBlocksMocks());

      shortcuts.register();
      shortcuts.unregister();
      addSpy.mockClear();
      shortcuts.register();

      expect(addedNames(addSpy.mock.calls)).toStrictEqual([
        [ALL_SHORTCUT, true],
        [CURRENT_SHORTCUT, true],
        [SCOPED_SHORTCUT, true],
      ]);
    });
  });

  describe('unregister()', () => {
    it('removes exactly the three shortcuts it registered', () => {
      const removeSpy = vi.spyOn(Shortcuts, 'remove');
      const { shortcuts } = createShortcuts(createBlocksMocks());

      shortcuts.register();
      removeSpy.mockClear();
      shortcuts.unregister();

      expect(removedNames(removeSpy.mock.calls)).toStrictEqual([
        [true, ALL_SHORTCUT],
        [true, CURRENT_SHORTCUT],
        [true, SCOPED_SHORTCUT],
      ]);
    });

    it('removes nothing when register() was never called', () => {
      const removeSpy = vi.spyOn(Shortcuts, 'remove');
      const { shortcuts } = createShortcuts(createBlocksMocks());

      shortcuts.unregister();

      expect(removeSpy.mock.calls).toStrictEqual([]);
    });

    it('leaves none of the three shortcuts firing', () => {
      const blocks = createBlocksMocks();
      const toggle = createBlock({ id: 't1', open: true });

      blocks.getBlocksCount.mockReturnValue(1);
      blocks.getBlockByIndex.mockReturnValue(toggle.block);
      blocks.getCurrentBlockIndex.mockReturnValue(0);

      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();
      shortcuts.unregister();

      const all = keydown({ target: inside, code: 'KeyT', meta: true, alt: true });
      const current = keydown({ target: inside, code: 'BracketLeft', meta: true, shift: true });
      const scoped = keydown({ target: inside, code: 'KeyT', meta: true, alt: true, shift: true });

      document.dispatchEvent(all);
      document.dispatchEvent(current);
      document.dispatchEvent(scoped);

      expect(toggle.call.mock.calls).toStrictEqual([]);
      expect([all.defaultPrevented, current.defaultPrevented, scoped.defaultPrevented]).toStrictEqual([
        false,
        false,
        false,
      ]);
    });
  });

  describe('CMD+ALT+T', () => {
    it('expands every toggle block and prevents the default', () => {
      const blocks = createBlocksMocks();
      const first = createBlock({ id: 't1', open: false });
      const paragraph = createBlock({ id: 'p1', name: 'paragraph' });
      const second = createBlock({ id: 't2', open: true });
      const ordered = [first.block, paragraph.block, second.block];

      blocks.getBlocksCount.mockReturnValue(3);
      blocks.getBlockByIndex.mockImplementation((index: number) => ordered[index]);

      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const event = keydown({ target: inside, code: 'KeyT', meta: true, alt: true });

      document.dispatchEvent(event);

      expect(first.call.mock.calls).toStrictEqual([['expand']]);
      expect(second.call.mock.calls).toStrictEqual([['expand']]);
      expect(paragraph.call.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(true);
    });

    it('skips an index that has no block', () => {
      const blocks = createBlocksMocks();
      const first = createBlock({ id: 't1', open: true });
      const second = createBlock({ id: 't2', open: true });
      const ordered: (BlockAPI | undefined)[] = [first.block, undefined, second.block];

      blocks.getBlocksCount.mockReturnValue(3);
      blocks.getBlockByIndex.mockImplementation((index: number) => ordered[index]);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(ALL_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(first.call.mock.calls).toStrictEqual([['collapse']]);
      expect(second.call.mock.calls).toStrictEqual([['collapse']]);
    });
  });

  describe('CMD+SHIFT+[', () => {
    it('collapses the focused toggle and prevents the default', () => {
      const blocks = createBlocksMocks();
      const toggle = createBlock({ id: 't1', open: true });

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(toggle.block);

      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const event = keydown({ target: inside, code: 'BracketLeft', meta: true, shift: true });

      document.dispatchEvent(event);

      expect(toggle.call.mock.calls).toStrictEqual([['collapse']]);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing when the current index has no block', () => {
      const blocks = createBlocksMocks();

      blocks.getCurrentBlockIndex.mockReturnValue(4);
      blocks.getBlockByIndex.mockReturnValue(undefined);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(CURRENT_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(blocks.getById.mock.calls).toStrictEqual([]);
    });

    it('does nothing when the focused toggle has no toggle wrapper', () => {
      const blocks = createBlocksMocks();
      const toggle = createBlock({ id: 't1' });

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(toggle.block);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(CURRENT_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(toggle.call.mock.calls).toStrictEqual([]);
    });

    it('never toggles a parent that is not a toggle block', () => {
      const blocks = createBlocksMocks();
      const child = createBlock({ id: 'c1', name: 'paragraph', parentId: 'p0' });
      // The parent carries a toggle marker so a mutant that skips the tool-name
      // check has something to act on.
      const parent = createBlock({ id: 'p0', name: 'paragraph', open: true });

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(child.block);
      blocks.getById.mockImplementation((id: string) => (id === 'p0' ? parent.block : null));

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(CURRENT_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(parent.call.mock.calls).toStrictEqual([]);
      expect(child.call.mock.calls).toStrictEqual([]);
    });

    it('does not dereference a parent id that resolves to nothing', () => {
      const blocks = createBlocksMocks();
      const child = createBlock({ id: 'c1', name: 'paragraph', parentId: 'ghost' });

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(child.block);
      blocks.getById.mockReturnValue(null);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(CURRENT_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(child.call.mock.calls).toStrictEqual([]);
      expect(blocks.getById.mock.calls).toStrictEqual([['ghost']]);
    });
  });

  describe('CMD+ALT+SHIFT+T', () => {
    it('expands only the descendants of the current toggle and prevents the default', () => {
      const blocks = createBlocksMocks();
      const root = createBlock({ id: 'root', open: true });
      const inner = createBlock({ id: 'inner', parentId: 'root', open: true });
      const paragraph = createBlock({ id: 'para', name: 'paragraph', parentId: 'root' });
      const leaf = createBlock({ id: 'leaf', parentId: 'inner', open: false });
      const children: Record<string, BlockAPI[]> = {
        root: [inner.block, paragraph.block],
        inner: [leaf.block],
        para: [],
        leaf: [],
      };

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(root.block);
      blocks.getChildren.mockImplementation((parentId: string) => children[parentId] ?? []);

      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const event = keydown({ target: inside, code: 'KeyT', meta: true, alt: true, shift: true });

      document.dispatchEvent(event);

      expect(inner.call.mock.calls).toStrictEqual([['expand']]);
      expect(leaf.call.mock.calls).toStrictEqual([['expand']]);
      expect(paragraph.call.mock.calls).toStrictEqual([]);
      expect(root.call.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(true);
    });

    it('is ignored when the event target is outside the editor wrapper', () => {
      const blocks = createBlocksMocks();
      const root = createBlock({ id: 'root', open: true });
      const leaf = createBlock({ id: 'leaf', parentId: 'root', open: false });
      const children: Record<string, BlockAPI[]> = { root: [leaf.block], leaf: [] };

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(root.block);
      blocks.getChildren.mockImplementation((parentId: string) => children[parentId] ?? []);

      const { shortcuts } = createShortcuts(blocks);
      const outside: HTMLElement = document.createElement('div');

      document.body.appendChild(outside);
      openedWrappers.push(outside);
      shortcuts.register();

      const event = keydown({ target: outside, code: 'KeyT', meta: true, alt: true, shift: true });

      document.dispatchEvent(event);

      expect(leaf.call.mock.calls).toStrictEqual([]);
      expect(root.call.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
      expect(blocks.getChildren.mock.calls).toStrictEqual([]);
    });

    it('does nothing when the current index has no block', () => {
      const blocks = createBlocksMocks();

      blocks.getCurrentBlockIndex.mockReturnValue(9);
      blocks.getBlockByIndex.mockReturnValue(undefined);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(SCOPED_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(blocks.getChildren.mock.calls).toStrictEqual([]);
      expect(blocks.getById.mock.calls).toStrictEqual([]);
    });

    it('scopes to the ROOT toggle ancestor, not the nearest one', () => {
      const blocks = createBlocksMocks();
      const root = createBlock({ id: 'root', open: true });
      const inner = createBlock({ id: 'inner', parentId: 'root', open: true });
      const leaf = createBlock({ id: 'leaf', parentId: 'inner', open: false });
      const children: Record<string, BlockAPI[]> = {
        root: [inner.block],
        inner: [leaf.block],
        leaf: [],
      };

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(inner.block);
      blocks.getById.mockImplementation((id: string) => (id === 'root' ? root.block : null));
      blocks.getChildren.mockImplementation((parentId: string) => children[parentId] ?? []);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(SCOPED_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      handler?.(keydown({ target: inside }));

      expect(inner.call.mock.calls).toStrictEqual([['expand']]);
      expect(leaf.call.mock.calls).toStrictEqual([['expand']]);
      expect(root.call.mock.calls).toStrictEqual([]);
    });

    it('stops walking up at the root without looking up a null parent', () => {
      const blocks = createBlocksMocks();
      const root = createBlock({ id: 'root', open: true });
      const child = createBlock({ id: 'child', name: 'paragraph', parentId: 'root' });
      const leaf = createBlock({ id: 'leaf', parentId: 'root', open: true });
      const children: Record<string, BlockAPI[]> = { root: [leaf.block], leaf: [] };

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(child.block);
      blocks.getById.mockImplementation((id: string) => (id === 'root' ? root.block : null));
      blocks.getChildren.mockImplementation((parentId: string) => children[parentId] ?? []);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(SCOPED_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      handler?.(keydown({ target: inside }));

      // The defect assertion first: a walk that does not stop on a null parentId
      // asks the API for block `null`.
      expect(blocks.getById.mock.calls).toStrictEqual([['root']]);
      expect(leaf.call.mock.calls).toStrictEqual([['collapse']]);
      expect(root.call.mock.calls).toStrictEqual([]);
    });

    it('falls back to the page-wide toggle when the parent chain hits a missing block', () => {
      const blocks = createBlocksMocks();
      const child = createBlock({ id: 'child', name: 'paragraph', parentId: 'ghost' });
      const orphanToggle = createBlock({ id: 'other', open: true });
      const ordered = [child.block, orphanToggle.block];

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockImplementation((index: number) => ordered[index]);
      blocks.getById.mockReturnValue(null);
      blocks.getBlocksCount.mockReturnValue(2);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(SCOPED_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      // The defect assertion first: a walk that does not stop on a missing parent
      // reads `parentId` off null.
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(blocks.getById.mock.calls).toStrictEqual([['ghost']]);
      expect(orphanToggle.call.mock.calls).toStrictEqual([['collapse']]);
      expect(child.call.mock.calls).toStrictEqual([]);
    });

    it('skips a descendant toggle that has no toggle wrapper', () => {
      const blocks = createBlocksMocks();
      const root = createBlock({ id: 'root', open: true });
      const bare = createBlock({ id: 'bare', parentId: 'root' });
      const good = createBlock({ id: 'good', parentId: 'root', open: true });
      const children: Record<string, BlockAPI[]> = {
        root: [bare.block, good.block],
        bare: [],
        good: [],
      };

      blocks.getCurrentBlockIndex.mockReturnValue(0);
      blocks.getBlockByIndex.mockReturnValue(root.block);
      blocks.getChildren.mockImplementation((parentId: string) => children[parentId] ?? []);

      const addSpy = vi.spyOn(Shortcuts, 'add');
      const { shortcuts, inside } = createShortcuts(blocks);

      shortcuts.register();

      const handler = addSpy.mock.calls.at(SCOPED_HANDLER)?.[0].handler;

      expect(handler).toBeDefined();
      expect(() => handler?.(keydown({ target: inside }))).not.toThrow();
      expect(good.call.mock.calls).toStrictEqual([['collapse']]);
      expect(bare.call.mock.calls).toStrictEqual([]);
    });
  });
});

/*
 * Proven-equivalent mutants in src/tools/toggle/toggle-shortcuts.ts.
 * Ids as Stryker reports them (0-based lines, so @119 is source line 120):
 *
 *   119:8-119:33   ConditionalExpression -> false   toggleAll(),     line 120
 *   119:35-121:5   BlockStatement -> {}             toggleAll(),     line 120
 *   182:8-182:32   ConditionalExpression -> false   toggleScoped(),  line 183
 *   182:34-184:5   BlockStatement -> {}             toggleScoped(),  line 183
 *
 * All four delete the same guard: `if (<list>.length === 0) { return; }`.
 * The guard only fires on an empty list, and everything after it is inert on an
 * empty list. Lines 124-129 (and the byte-identical 187-192) run
 * `[].some(...)` -> false, pick the string 'collapse', then iterate an empty
 * array zero times. Between the guard and the end of the method there is no API
 * call, no DOM read, no event and no returned value, so the mutated method
 * produces exactly the same effects for exactly the same inputs. The only way to
 * see a difference is to patch Array.prototype.some and count invocations, which
 * observes the JS engine rather than anything this module does.
 */
