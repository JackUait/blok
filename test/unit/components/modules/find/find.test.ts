import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Find } from '../../../../../src/components/modules/find';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokConfig } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

class FakeHighlight extends Set<Range> {
  public priority = 0;
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

const highlights = new Map<string, FakeHighlight>();

interface FakeBlock {
  id: string;
  parentId: string | null;
  holder: HTMLElement;
  call: ReturnType<typeof vi.fn>;
}

interface Harness {
  find: Find;
  wrapper: HTMLElement;
  redactor: HTMLElement;
  blocks: FakeBlock[];
  readOnly: { isEnabled: boolean };
  blockManager: {
    beginToolTransaction: ReturnType<typeof vi.fn>;
    endToolTransaction: ReturnType<typeof vi.fn>;
  };
}

/**
 * One editor: each entry becomes a block holder with a contenteditable.
 * `parent` nests the block's holder inside another block's holder.
 */
const createEditor = (
  contents: Array<{ id: string; text: string; parent?: string; collapsed?: boolean }>,
  config: Partial<BlokConfig> = {}
): Harness => {
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'blok-editor');
  wrapper.appendChild(redactor);
  document.body.appendChild(wrapper);

  const blocks: FakeBlock[] = contents.map(({ id, text, parent, collapsed }) => {
    const holder = document.createElement('div');
    const input = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    input.setAttribute('contenteditable', 'true');
    input.textContent = text;
    holder.appendChild(input);
    if (collapsed !== undefined) {
      input.setAttribute('data-blok-toggle-open', String(!collapsed));
    }

    return { id, parentId: parent ?? null, holder, call: vi.fn() };
  });

  blocks.forEach((block) => {
    const parent = blocks.find((candidate) => candidate.id === block.parentId);

    (parent?.holder ?? redactor).appendChild(block.holder);
  });

  const readOnly = { isEnabled: false };
  const blockManager = {
    beginToolTransaction: vi.fn(),
    endToolTransaction: vi.fn(),
    getBlockById: (id: string) => blocks.find((block) => block.id === id),
    getBlockByChildNode: (node: Node) => {
      const holder = (node instanceof Element ? node : node.parentElement)?.closest('[data-blok-element]');

      return blocks.find((block) => block.holder === holder);
    },
  };

  const find = new Find({
    config: config,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  find.state = {
    UI: { nodes: { wrapper, redactor } },
    ReadOnly: readOnly,
    I18n: { t: (key: string) => key },
    BlockManager: blockManager,
  } as unknown as BlokModules;

  find.prepare();

  return { find, wrapper, redactor, blocks, readOnly, blockManager };
};

const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

/** The open find bar lives on <body>, in the top layer, not inside the editor. */
const openBar = (): HTMLElement => {
  const dock = document.querySelector<HTMLElement>('[data-blok-find]:not([hidden])');

  if (dock === null) {
    throw new Error('no open find bar');
  }

  return dock;
};

const searchInput = (_wrapper?: HTMLElement): HTMLInputElement => {
  const input = openBar().querySelector('input[type="search"], input[role="searchbox"]');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error('find input missing');
  }

  return input;
};

const typeQuery = (wrapper: HTMLElement, query: string): void => {
  const input = searchInput(wrapper);

  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  vi.runAllTimers();
};

const setReplacement = (_wrapper: HTMLElement, value: string): void => {
  const input = openBar().querySelector('[data-blok-testid="find-replace-input"]');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error('replace input missing');
  }
  input.value = value;
};

const painted = (name: string): string[] => [...highlights.get(name) ?? []].map((range) => range.toString());

const activeText = (): string => {
  const [range] = [...highlights.get('blok-find-match-active') ?? []];

  return range === undefined ? '' : range.startContainer.textContent ?? '';
};

describe('Find module', () => {
  const editors: Harness[] = [];
  const editor = (...args: Parameters<typeof createEditor>): Harness => {
    const created = createEditor(...args);

    editors.push(created);

    return created;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    highlights.clear();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    editors.splice(0).forEach(({ find }) => find.destroy());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('takes over Ctrl/Cmd+F and opens the find bar on the page, above everything', () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);
    const event = press(redactor.querySelector('[contenteditable]') ?? redactor, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(searchInput()).toHaveFocus();
    expect(openBar().parentElement).toBe(document.body);
    expect(openBar().getAttribute('data-blok-top-layer')).toBe('true');
    expect(wrapper.contains(openBar())).toBe(false);
  });

  it('treats keys inside its own bar as its own, though the bar is outside the editor', () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'apple one' }, { id: 'b', text: 'apple two' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'apple');

    expect(press(searchInput(), { key: 'g', code: 'KeyG', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(activeText()).toBe('apple two');
  });

  it('takes its text direction from the editor', () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);

    wrapper.setAttribute('dir', 'rtl');
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(openBar().getAttribute('dir')).toBe('rtl');
  });

  it('removes its bar from the page when the editor is destroyed', () => {
    const { redactor, find } = editor([{ id: 'a', text: 'hello' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    find.destroy();

    expect(document.querySelector('[data-blok-find]')).toBeNull();
  });

  it('opens from the body when this is the only editor', () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);

    expect(press(document.body, { key: 'f', code: 'KeyF', metaKey: true }).defaultPrevented).toBe(true);
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('leaves Cmd+F alone when the host turned find off', () => {
    const { redactor } = editor([{ id: 'a', text: 'hello' }], { find: false });

    expect(press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('turns on with the object form of the config and puts the bar where the host asked', () => {
    const { redactor } = editor([{ id: 'a', text: 'hello' }], { find: { placement: 'bottom-center', offset: { y: 40 } } });

    expect(press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(openBar().getAttribute('data-blok-find-placement')).toBe('bottom-center');
    expect(openBar().style.getPropertyValue('--blok-find-offset-y')).toBe('40px');
  });

  it('leaves Cmd+F to a host input outside the editor', () => {
    editor([{ id: 'a', text: 'hello' }]);
    const hostInput = document.createElement('input');

    document.body.appendChild(hostInput);

    expect(press(hostInput, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('only the editor that holds the target opens its bar', () => {
    const first = editor([{ id: 'a', text: 'hello' }]);
    const second = editor([{ id: 'b', text: 'world' }]);

    press(second.redactor, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(searchInput()).toHaveFocus();
    expect(document.querySelectorAll('[data-blok-find]')).toHaveLength(1);
    expect(first.wrapper.querySelector('input')).toBeNull();
  });

  it('paints every match and walks through them with Enter and Shift+Enter', () => {
    const { wrapper, redactor } = editor([
      { id: 'a', text: 'apple one' },
      { id: 'b', text: 'apple two' },
      { id: 'c', text: 'apple three' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'APPLE');

    expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBe(3);
    expect(activeText()).toBe('apple one');

    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });
    expect(activeText()).toBe('apple two');

    press(searchInput(wrapper), { key: 'Enter', code: 'Enter', shiftKey: true });
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(activeText()).toBe('apple three');
  });

  it('moves with Cmd+G and Shift+Cmd+G while the page has focus', () => {
    const { wrapper, redactor } = editor([
      { id: 'a', text: 'apple one' },
      { id: 'b', text: 'apple two' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'apple');

    const next = press(redactor, { key: 'g', code: 'KeyG', metaKey: true });

    expect(next.defaultPrevented).toBe(true);
    expect(activeText()).toBe('apple two');
  });

  it('never opens a collapsed toggle while the query is being typed', () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'outer', text: 'outer', collapsed: true },
      { id: 'leaf', text: 'hidden treasure', parent: 'outer' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'treasure');

    expect(blocks[0].call).not.toHaveBeenCalled();
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('opens every collapsed toggle above a match the reader steps to', () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'outer', text: 'outer', collapsed: true },
      { id: 'inner', text: 'inner', parent: 'outer', collapsed: true },
      { id: 'leaf', text: 'hidden treasure', parent: 'inner' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    const [outer, inner, leaf] = blocks;

    expect(outer.call).toHaveBeenCalledWith('expand');
    expect(inner.call).toHaveBeenCalledWith('expand');
    expect(leaf.call).not.toHaveBeenCalled();
  });

  it('does not mistake a nested toggle\'s state for its container\'s', () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'callout', text: 'callout' },
      { id: 'folded', text: 'folded', parent: 'callout', collapsed: true },
      { id: 'leaf', text: 'visible treasure', parent: 'callout' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    expect(blocks[0].call).not.toHaveBeenCalled();
  });

  it('leaves an open toggle and the matched block itself alone', () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'outer', text: 'outer treasure', collapsed: true },
      { id: 'inner', text: 'inner', parent: 'outer', collapsed: false },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    expect(blocks[0].call).not.toHaveBeenCalled();
  });

  it('replaces the current match and moves on to the next one', () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'a', text: 'cat and cat' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'cat');
    setReplacement(wrapper, 'dog');
    const replaceButton = [...openBar().querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'find.replace' || button.textContent === 'find.replace');

    replaceButton?.click();
    vi.runAllTimers();

    expect(blocks[0].holder.textContent).toBe('dog and cat');
  });

  it('replaces every match as one undo step', () => {
    const { wrapper, redactor, blocks, blockManager } = editor([
      { id: 'a', text: 'cat one' },
      { id: 'b', text: 'two cat, cat' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'cat');
    setReplacement(wrapper, 'dog');
    const replaceAll = [...openBar().querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'find.replaceAll' || button.textContent === 'find.replaceAll');

    replaceAll?.click();

    expect(blocks.map((block) => block.holder.textContent)).toEqual(['dog one', 'two dog, dog']);
    expect(blockManager.beginToolTransaction).toHaveBeenCalledTimes(1);
    expect(blockManager.endToolTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps formatting when a replaced match spans two marks', () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: '' }]);
    const input = blocks[0].holder.querySelector('[contenteditable]');

    if (input === null) {
      throw new Error('input missing');
    }
    input.innerHTML = 'a <b>bo</b><i>ld</i> move';

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'bold');
    setReplacement(wrapper, 'brave');
    [...openBar().querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'find.replaceAll' || button.textContent === 'find.replaceAll')?.click();

    expect(input.textContent).toBe('a brave move');
    expect(input.querySelector('b')?.textContent).toBe('brave');
  });

  it('never replaces in read-only mode', () => {
    const { wrapper, redactor, blocks, readOnly, find } = editor([{ id: 'a', text: 'cat' }]);

    readOnly.isEnabled = true;
    find.toggleReadOnly(true);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'cat');
    find.replaceAll('dog');

    expect(blocks[0].holder.textContent).toBe('cat');
  });

  it('re-searches when the document changes under an open bar', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'one apple' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'apple');
    blocks[0].holder.querySelector('[contenteditable]')?.append(' apple');
    await Promise.resolve();
    vi.runAllTimers();

    expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBe(2);
  });

  it('clears the paint and selects the current match when closed with Escape', () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'one apple' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'apple');
    press(searchInput(wrapper), { key: 'Escape', code: 'Escape' });
    vi.runAllTimers();

    expect(highlights.size).toBe(0);
    expect(window.getSelection()?.toString()).toBe('apple');
  });

  it('gives focus back to the editor when closed without a match', () => {
    const { wrapper, blocks } = editor([{ id: 'a', text: 'one apple' }]);
    const input = blocks[0].holder.querySelector<HTMLElement>('[contenteditable]');

    if (input === null) {
      throw new Error('input missing');
    }
    input.focus();
    press(input, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'pear');
    press(searchInput(wrapper), { key: 'Escape', code: 'Escape' });

    expect(input).toHaveFocus();
  });

  it('hands a second Cmd+F in the find field to the browser', () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(press(searchInput(wrapper), { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('keeps Escape in the find bar from reaching the page', () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);
    const pageHandler = vi.fn();

    document.addEventListener('keydown', pageHandler);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    press(searchInput(wrapper), { key: 'Escape', code: 'Escape' });
    document.removeEventListener('keydown', pageHandler);

    expect(pageHandler).not.toHaveBeenCalled();
  });

  it('stays on the next match after a replace when the block is re-rendered', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'foo foo foo' }]);
    const host = blocks[0].holder.querySelector('[contenteditable]');

    if (!(host instanceof HTMLElement)) {
      throw new Error('host missing');
    }

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'foo');
    setReplacement(wrapper, 'foo2');
    [...openBar().querySelectorAll('button')].find((button) => button.textContent === 'find.replace')?.click();
    // A tool re-rendering its content (code highlighting) swaps every text node.
    host.innerHTML = host.textContent.split(' ').map((word) => `<span>${word}</span>`).join(' ');
    // The MutationObserver reports on a microtask.
    await Promise.resolve();
    vi.advanceTimersByTime(500);

    const [active] = [...highlights.get('blok-find-match-active') ?? []];
    const before = document.createRange();

    before.setStart(host, 0);
    before.setEnd(active.startContainer, active.startOffset);

    expect(before.toString()).toBe('foo2 ');
  });

  it('keeps searching while the document changes without a pause', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'apple' }]);
    const host = blocks[0].holder.querySelector('[contenteditable]');

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'apple');

    await Array.from({ length: 20 }).reduce(async (previous: Promise<void>) => {
      await previous;
      host?.append(' apple');
      await Promise.resolve();
      vi.advanceTimersByTime(50);
    }, Promise.resolve());

    expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBeGreaterThan(1);
  });

  it('tells only the edited field about a replace, not the whole editor', () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat' }]);
    const host = blocks[0].holder.querySelector('[contenteditable]');
    const onHost = vi.fn();
    const onEditor = vi.fn();

    host?.addEventListener('input', onHost);
    redactor.addEventListener('input', onEditor);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    typeQuery(wrapper, 'cat');
    setReplacement(wrapper, 'dog');
    [...openBar().querySelectorAll('button')].find((button) => button.textContent === 'find.replaceAll')?.click();

    expect(onEditor).not.toHaveBeenCalled();
    expect(onHost).toHaveBeenCalled();
  });

  it('prefills the query from a short text selection', () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'pick this word' }]);
    const text = blocks[0].holder.querySelector('[contenteditable]')?.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(searchInput(wrapper).value).toBe('this');
  });
});
