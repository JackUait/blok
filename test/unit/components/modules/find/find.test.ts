import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Find as FindModule } from '../../../../../src/components/modules/find';
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

const FIND_PATH = '../../../../../src/components/modules/find';
const KIT_PATH = '../../../../../src/components/modules/find/find-kit';

/** A fresh module per test, so each test meets the bar code not loaded yet, as a new page does. */
let Find: typeof FindModule;

/** Let the bar code finish loading. */
const settle = (): Promise<void> => vi.dynamicImportSettled();

interface FakeBlock {
  id: string;
  parentId: string | null;
  holder: HTMLElement;
  call: ReturnType<typeof vi.fn>;
}

interface Harness {
  find: FindModule;
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
  contents: Array<{ id: string; text: string; parent?: string; collapsed?: boolean; hidden?: boolean }>,
  config: Partial<BlokConfig> = {}
): Harness => {
  const wrapper = document.createElement('div');
  const redactor = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'blok-editor');
  wrapper.appendChild(redactor);
  document.body.appendChild(wrapper);

  const blocks: FakeBlock[] = contents.map(({ id, text, parent, collapsed, hidden }) => {
    const holder = document.createElement('div');
    const content = document.createElement('div');
    const toolRoot = document.createElement('div');
    const input = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    content.setAttribute('data-blok-element-content', '');
    input.setAttribute('contenteditable', 'true');
    input.textContent = text;
    toolRoot.appendChild(input);
    content.appendChild(toolRoot);
    holder.appendChild(content);
    if (collapsed !== undefined) {
      input.setAttribute('data-blok-toggle-open', String(!collapsed));
    }
    if (hidden === true) {
      holder.classList.add('hidden');
    }

    return { id, parentId: parent ?? null, holder, call: vi.fn() };
  });

  blocks.forEach((block) => {
    const parent = blocks.find((candidate) => candidate.id === block.parentId);

    // A child block's holder lives inside its container's tool root, as a toggle's children do.
    (parent?.holder.querySelector('[data-blok-element-content] > *') ?? redactor).appendChild(block.holder);
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

/** Replace all lives in the menu behind the Replace split button. */
const clickReplaceAll = (): void => {
  openBar().querySelector<HTMLButtonElement>('[data-blok-testid="find-replace-menu"]')?.click();
  document.querySelector<HTMLElement>('[data-blok-item-name="replace-all"]')?.click();
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

/** Open the replace row and type into it, as the reader does. */
const typeReplacement = (value: string): void => {
  const toggle = openBar().querySelector('[data-blok-testid="find-replace-toggle"]');
  const input = openBar().querySelector('[data-blok-testid="find-replace-input"]');

  if (!(toggle instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) {
    throw new Error('replace controls missing');
  }
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.click();
  }
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  vi.runAllTimers();
};

const PREVIEW = '[data-blok-find-preview-clone]';

const previewOf = (holder: HTMLElement): HTMLElement => {
  const preview = holder.querySelector<HTMLElement>(PREVIEW);

  if (preview === null) {
    throw new Error('no preview');
  }

  return preview;
};

const texts = (root: Element, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((element) => element.textContent ?? '');

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

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ Find } = await import(FIND_PATH));
    vi.useFakeTimers();
    highlights.clear();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.doUnmock(KIT_PATH);
    editors.splice(0).forEach(({ find }) => find.destroy());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('before the bar code has loaded', () => {
    const KEY_F = { key: 'f', code: 'KeyF', ctrlKey: true };
    const KEY_H = { key: 'h', code: 'KeyH', ctrlKey: true };

    /** Where keys go while the bar code loads: a real field, so paste, IME and dead keys work natively. */
    const standIn = (): HTMLInputElement => {
      const field = document.activeElement;

      if (!(field instanceof HTMLInputElement)) {
        throw new Error('focus is not in a text field');
      }

      return field;
    };

    /** Native typing: the browser writes the text and the caret, then fires input. */
    const typeInto = (value: string): void => {
      const field = standIn();

      field.value = value;
      field.setSelectionRange(value.length, value.length);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const textOf = (redactor: HTMLElement): HTMLElement => redactor.querySelector<HTMLElement>('[contenteditable]') ?? redactor;

    // jsdom's window never has focus; a real page in use does.
    beforeEach(() => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    });

    it('keeps Cmd+F from the browser at once and opens the bar when the code arrives', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      expect(press(redactor, KEY_F).defaultPrevented).toBe(true);
      expect(document.querySelector('[data-blok-find]:not([hidden])')).toBeNull();

      await settle();

      expect(searchInput()).toHaveFocus();
    });

    it('moves focus out of the document at the keystroke, so typing, paste, IME and Tab cannot edit it', async () => {
      const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);
      const text = textOf(redactor);

      text.focus();
      press(text, KEY_F);

      const field = standIn();

      expect(wrapper.contains(field)).toBe(false);
      expect(field.getAttribute('data-blok-interface')).toBe('find');
      // Tab would move focus on and give up the open; the bar it stands in for keeps it.
      expect(press(field, { key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(true);

      await settle();

      expect(field.isConnected).toBe(false);
    });

    it('carries what was typed or pasted while it loaded into the find field, caret included', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      press(textOf(redactor), KEY_F);
      const field = standIn();

      typeInto('held');
      field.setSelectionRange(1, 3);
      await settle();

      expect(searchInput().value).toBe('held');
      expect([searchInput().selectionStart, searchInput().selectionEnd]).toEqual([1, 3]);
    });

    it('waits for an IME composition to end before it moves the text into the bar', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      press(textOf(redactor), KEY_F);
      const field = standIn();

      field.dispatchEvent(new CompositionEvent('compositionstart'));
      typeInto('にほ');
      await settle();

      expect(document.querySelector('[data-blok-find]:not([hidden])')).toBeNull();
      expect(field).toHaveFocus();

      typeInto('日本');
      field.dispatchEvent(new CompositionEvent('compositionend'));

      expect(searchInput().value).toBe('日本');
      expect(searchInput()).toHaveFocus();
    });

    it('lets Escape that ends an IME composition leave the open alone', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      press(textOf(redactor), KEY_F);
      typeInto('にほ');
      press(standIn(), { key: 'Escape', code: 'Escape', isComposing: true });
      await settle();

      expect(searchInput().value).toBe('にほ');
    });

    it('pins its field in the window at a size iPadOS does not zoom on', () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      press(textOf(redactor), KEY_F);
      const { style } = standIn();

      expect([style.position, style.top, style.left, style.fontSize]).toEqual(['fixed', '0px', '0px', '16px']);
    });

    it('keeps the open when the whole window loses focus while it loads', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      press(textOf(redactor), KEY_F);
      typeInto('kept');
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      standIn().blur();
      await settle();

      expect(searchInput().value).toBe('kept');
    });

    it('opens the replace row when the replace shortcut comes while it loads', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);

      press(textOf(redactor), KEY_F);
      expect(press(standIn(), KEY_H).defaultPrevented).toBe(true);
      await settle();

      expect(openBar().querySelector('[data-blok-testid="find-replace-toggle"]')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('takes the selection from the moment of the keystroke', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello world' }]);
      const node = redactor.querySelector('[contenteditable]')?.firstChild as Text;
      const range = document.createRange();

      range.setStart(node, 0);
      range.setEnd(node, 5);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      press(redactor, KEY_F);
      window.getSelection()?.collapse(node, 8);
      await settle();

      expect(searchInput().value).toBe('hello');
    });

    it('gives up the open and puts focus back in the text on Escape', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);
      const text = textOf(redactor);

      text.focus();
      press(text, KEY_F);
      press(standIn(), { key: 'Escape', code: 'Escape' });
      await settle();

      expect(document.querySelector('[data-blok-find]:not([hidden])')).toBeNull();
      expect(text).toHaveFocus();
    });

    it('gives up the open when the reader clicks elsewhere while it loads', async () => {
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);
      const hostInput = document.createElement('input');

      document.body.appendChild(hostInput);
      press(textOf(redactor), KEY_F);
      const field = standIn();

      hostInput.focus();
      await settle();

      expect(document.querySelector('[data-blok-find]:not([hidden])')).toBeNull();
      expect(field.isConnected).toBe(false);
      expect(hostInput).toHaveFocus();
    });

    it('with two editors, a Cmd+F while the first loads opens only one bar, and keys reach no editor', async () => {
      const first = editor([{ id: 'a', text: 'first' }]);
      const second = editor([{ id: 'b', text: 'second' }]);

      press(textOf(first.redactor), KEY_F);
      expect(press(standIn(), KEY_F).defaultPrevented).toBe(true);
      typeInto('fir');
      await settle();

      expect(document.querySelectorAll('[data-blok-find]:not([hidden])')).toHaveLength(1);
      expect(searchInput().value).toBe('fir');
      expect(first.find.isOpen).toBe(true);
      expect(second.find.isOpen).toBe(false);
    });

    it('with two editors, moving to the second while the first loads opens only the second', async () => {
      const first = editor([{ id: 'a', text: 'first' }]);
      const second = editor([{ id: 'b', text: 'second' }]);
      const secondText = textOf(second.redactor);

      press(textOf(first.redactor), KEY_F);
      secondText.focus();
      press(secondText, KEY_F);
      typeInto('sec');
      await settle();

      expect(document.querySelectorAll('[data-blok-find]:not([hidden])')).toHaveLength(1);
      expect(first.find.isOpen).toBe(false);
      expect(second.find.isOpen).toBe(true);
      expect(searchInput().value).toBe('sec');
    });

    it('does not open in an editor destroyed while it loads', async () => {
      const { redactor, find } = editor([{ id: 'a', text: 'hello' }]);

      press(redactor, KEY_F);
      find.destroy();
      await settle();

      expect(document.querySelector('[data-blok-find]')).toBeNull();
      expect(document.querySelector('[data-blok-interface="find"]')).toBeNull();
    });

    it('reports a failed load, gives the keyboard back, and tries again on the next Cmd+F', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      vi.doMock(KIT_PATH, () => {
        throw new Error('offline');
      });
      const { redactor } = editor([{ id: 'a', text: 'hello' }]);
      const text = textOf(redactor);

      text.focus();
      press(text, KEY_F);
      await settle();

      expect(error).toHaveBeenCalledWith('[Blok] Failed to open find. Reason:', expect.anything());
      expect(document.querySelector('[data-blok-find]:not([hidden])')).toBeNull();
      expect(document.querySelector('[data-blok-interface="find"]')).toBeNull();
      expect(text).toHaveFocus();

      vi.doUnmock(KIT_PATH);
      press(text, KEY_F);
      await settle();

      expect(searchInput()).toHaveFocus();
    });
  });

  it('takes over Ctrl/Cmd+F and opens the find bar on the page, above everything', async () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);
    const event = press(redactor.querySelector('[contenteditable]') ?? redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(searchInput()).toHaveFocus();
    expect(openBar().parentElement).toBe(document.body);
    expect(openBar().getAttribute('data-blok-top-layer')).toBe('true');
    expect(wrapper.contains(openBar())).toBe(false);
  });

  it('treats keys inside its own bar as its own, though the bar is outside the editor', async () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'apple one' }, { id: 'b', text: 'apple two' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'apple');

    expect(press(searchInput(), { key: 'g', code: 'KeyG', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(activeText()).toBe('apple two');
  });

  it('takes its text direction from the editor', async () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);

    wrapper.setAttribute('dir', 'rtl');
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(openBar().getAttribute('dir')).toBe('rtl');
  });

  it('removes its bar from the page when the editor is destroyed', async () => {
    const { redactor, find } = editor([{ id: 'a', text: 'hello' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    find.destroy();

    expect(document.querySelector('[data-blok-find]')).toBeNull();
  });

  it('opens from the body when this is the only editor', async () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);

    expect(press(document.body, { key: 'f', code: 'KeyF', metaKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('leaves Cmd+F alone when the host turned find off', async () => {
    const { redactor } = editor([{ id: 'a', text: 'hello' }], { find: false });

    expect(press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(false);
    await settle();
  });

  it('turns on with the object form of the config and puts the bar where the host asked', async () => {
    const { redactor } = editor([{ id: 'a', text: 'hello' }], { find: { placement: 'bottom-center', offset: { y: 40 } } });

    expect(press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(openBar().getAttribute('data-blok-find-placement')).toBe('bottom-center');
    expect(openBar().style.getPropertyValue('--blok-find-offset-y')).toBe('40px');
  });

  it('opens from a host input outside the editor', async () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);
    const hostInput = document.createElement('input');

    document.body.appendChild(hostInput);

    expect(press(hostInput, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('opens from a host contenteditable outside the editor', async () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);
    const hostTitle = document.createElement('h1');

    hostTitle.setAttribute('contenteditable', 'true');
    document.body.appendChild(hostTitle);

    expect(press(hostTitle, { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('leaves Cmd+F to a host field that handles it itself', async () => {
    editor([{ id: 'a', text: 'hello' }]);
    const hostInput = document.createElement('input');

    hostInput.addEventListener('keydown', (event) => event.preventDefault());
    document.body.appendChild(hostInput);
    press(hostInput, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(document.querySelector('[data-blok-find]')).toBeNull();
  });

  describe('a key outside every editor, with several on the page', () => {
    const showOnScreen = (wrapper: HTMLElement): void => {
      vi.spyOn(wrapper, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 100)] as unknown as DOMRectList);
    };

    it('goes to the visible editor when the one used last is hidden', async () => {
      const hidden = editor([{ id: 'a', text: 'hello' }]);
      const shown = editor([{ id: 'b', text: 'world' }]);

      showOnScreen(shown.wrapper);
      hidden.wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(press(document.body, { key: 'f', code: 'KeyF', metaKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(shown.find.isOpen).toBe(true);
      expect(hidden.find.isOpen).toBe(false);
    });

    it('goes to exactly one editor when the one used last is gone', async () => {
      const used = editor([{ id: 'a', text: 'hello' }]);
      const first = editor([{ id: 'b', text: 'world' }]);
      const second = editor([{ id: 'c', text: 'again' }]);

      showOnScreen(first.wrapper);
      showOnScreen(second.wrapper);
      used.wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      used.find.destroy();

      expect(press(document.body, { key: 'f', code: 'KeyF', metaKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(first.find.isOpen).toBe(true);
      expect(second.find.isOpen).toBe(false);
    });
  });

  it('only the editor that holds the target opens its bar', async () => {
    const first = editor([{ id: 'a', text: 'hello' }]);
    const second = editor([{ id: 'b', text: 'world' }]);

    press(second.redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(searchInput()).toHaveFocus();
    expect(document.querySelectorAll('[data-blok-find]')).toHaveLength(1);
    expect(first.wrapper.querySelector('input')).toBeNull();
  });

  it('opens the inner editor Find bar for a shortcut inside it', async () => {
    const outer = editor([{ id: 'outer', text: 'outer words' }]);
    const inner = editor([{ id: 'inner', text: 'inner words' }]);

    outer.redactor.appendChild(inner.wrapper);
    press(inner.redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(inner.find.isOpen).toBe(true);
    expect(outer.find.isOpen).toBe(false);
  });

  it('paints every match and walks through them with Enter and Shift+Enter', async () => {
    const { wrapper, redactor } = editor([
      { id: 'a', text: 'apple one' },
      { id: 'b', text: 'apple two' },
      { id: 'c', text: 'apple three' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'APPLE');

    expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBe(3);
    expect(activeText()).toBe('apple one');

    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });
    expect(activeText()).toBe('apple two');

    press(searchInput(wrapper), { key: 'Enter', code: 'Enter', shiftKey: true });
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(activeText()).toBe('apple three');
  });

  it('moves with Cmd+G and Shift+Cmd+G while the page has focus', async () => {
    const { wrapper, redactor } = editor([
      { id: 'a', text: 'apple one' },
      { id: 'b', text: 'apple two' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'apple');

    const next = press(redactor, { key: 'g', code: 'KeyG', metaKey: true });

    expect(next.defaultPrevented).toBe(true);
    expect(activeText()).toBe('apple two');
  });

  describe('a match whose text is not shown', () => {
    const matchCount = (): number => painted('blok-find-match').length + painted('blok-find-match-active').length;

    const hostTab = (): { tab: HTMLButtonElement; panel: HTMLDivElement } => {
      const tab = document.createElement('button');
      const panel = document.createElement('div');

      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'other-tab');
      tab.addEventListener('click', () => {
        panel.hidden = false;
      });
      panel.id = 'other-tab';
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = true;
      panel.textContent = 'cat in another tab';
      document.body.append(tab, panel);

      return { tab, panel };
    };

    const hiddenSource = (block: FakeBlock): void => {
      const source = document.createElement('pre');

      source.className = 'hidden';
      source.textContent = 'cat source';
      block.holder.querySelector('[contenteditable]')?.parentElement?.appendChild(source);
    };

    beforeEach(() => {
      Object.defineProperty(Element.prototype, 'checkVisibility', {
        configurable: true,
        value(this: Element): boolean {
          return this.closest('[hidden], .hidden') === null;
        },
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'checkVisibility');
    });

    it('switches to the host tab that holds it when the reader steps to it', async () => {
      const { wrapper, redactor } = editor([{ id: 'a', text: 'cat here' }]);
      const { panel } = hostTab();

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

      expect(panel.hidden).toBe(false);
      expect(activeText()).toBe('cat in another tab');
      expect(matchCount()).toBe(2);
    });

    it('asks its own block to show it when the reader steps to it, like a code block source behind its preview', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat here' }, { id: 'code', text: 'diagram' }]);

      hiddenSource(blocks[1]);
      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

      expect(blocks[1].call).toHaveBeenCalledWith('expand');
      expect(blocks[0].call).not.toHaveBeenCalled();
      expect(matchCount()).toBe(2);
    });

    it('switches nothing while the query is being typed, and starts on a shown match', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'code', text: 'diagram' }, { id: 'a', text: 'cat here' }]);
      const { panel } = hostTab();

      hiddenSource(blocks[0]);
      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');

      expect(blocks[0].call).not.toHaveBeenCalled();
      expect(panel.hidden).toBe(true);
      const [active] = [...highlights.get('blok-find-match-active') ?? []];

      expect(active instanceof Range ? active.startContainer.parentElement?.closest('[data-blok-element]') : null).toBe(blocks[1].holder);
    });

    it('still counts a match in a hidden tab block', async () => {
      const { wrapper, redactor } = editor([
        { id: 'tabs', text: 'tabs' },
        { id: 'tab-1', text: 'cat first', parent: 'tabs' },
        { id: 'tab-2', text: 'second', parent: 'tabs', hidden: true },
        { id: 'leaf', text: 'cat inside', parent: 'tab-2', hidden: true },
      ]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');

      expect(matchCount()).toBe(2);
    });
  });

  it('never opens a collapsed toggle while the query is being typed', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'outer', text: 'outer', collapsed: true },
      { id: 'leaf', text: 'hidden treasure', parent: 'outer' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'treasure');

    expect(blocks[0].call).not.toHaveBeenCalled();
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('opens every collapsed toggle above a match the reader steps to', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'outer', text: 'outer', collapsed: true },
      { id: 'inner', text: 'inner', parent: 'outer', collapsed: true },
      { id: 'leaf', text: 'hidden treasure', parent: 'inner' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    const [outer, inner, leaf] = blocks;

    expect(outer.call).toHaveBeenCalledWith('expand');
    expect(inner.call).toHaveBeenCalledWith('expand');
    expect(leaf.call).not.toHaveBeenCalled();
  });

  it('reveals a match inside a hidden ancestor by expanding it, outermost first', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'tabs', text: 'tabs' },
      { id: 'tab-1', text: 'first', parent: 'tabs' },
      { id: 'tab-2', text: 'second', parent: 'tabs', hidden: true },
      { id: 'toggle', text: 'toggle', parent: 'tab-2', collapsed: true },
      { id: 'leaf', text: 'hidden treasure', parent: 'toggle' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    const [tabs, tab1, tab2, toggle, leaf] = blocks;

    expect(tab2.call).toHaveBeenCalledWith('expand');
    expect(toggle.call).toHaveBeenCalledWith('expand');
    expect(tab2.call.mock.invocationCallOrder[0]).toBeLessThan(toggle.call.mock.invocationCallOrder[0]);
    expect(tabs.call).not.toHaveBeenCalled();
    expect(tab1.call).not.toHaveBeenCalled();
    expect(leaf.call).not.toHaveBeenCalled();
  });

  it('prefers a visible match over one under a hidden ancestor while typing', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'tab-1', text: 'tab one', hidden: true },
      { id: 'inside', text: 'treasure inside', parent: 'tab-1' },
      { id: 'outside', text: 'treasure outside' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'treasure');

    expect(activeText()).toBe('treasure outside');
    expect(blocks[0].call).not.toHaveBeenCalled();
  });

  it('reveals a collapsed match inside a nested editor', async () => {
    const outer = editor([{ id: 'outer', text: 'treasure outside' }]);
    const inner = editor([
      { id: 'inner-toggle', text: 'Toggle title', collapsed: true },
      { id: 'inner-child', text: 'treasure inside', parent: 'inner-toggle' },
    ]);

    outer.redactor.appendChild(inner.wrapper);
    press(outer.redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(outer.wrapper, 'treasure');
    press(searchInput(outer.wrapper), { key: 'Enter', code: 'Enter' });

    expect(inner.blocks[0].call).toHaveBeenCalledWith('expand');
  });

  it('does not mistake a nested toggle\'s state for its container\'s', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'callout', text: 'callout' },
      { id: 'folded', text: 'folded', parent: 'callout', collapsed: true },
      { id: 'leaf', text: 'visible treasure', parent: 'callout' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    expect(blocks[0].call).not.toHaveBeenCalled();
  });

  it('leaves an open toggle and the matched block itself alone', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'outer', text: 'outer treasure', collapsed: true },
      { id: 'inner', text: 'inner', parent: 'outer', collapsed: false },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'treasure');
    press(searchInput(wrapper), { key: 'Enter', code: 'Enter' });

    expect(blocks[0].call).not.toHaveBeenCalled();
  });

  it('replaces the current match and moves on to the next one', async () => {
    const { wrapper, redactor, blocks } = editor([
      { id: 'a', text: 'cat and cat' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'cat');
    setReplacement(wrapper, 'dog');
    const replaceButton = [...openBar().querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'find.replace' || button.textContent === 'find.replace');

    replaceButton?.click();
    vi.runAllTimers();

    expect(blocks[0].holder.textContent).toBe('dog and cat');
  });

  it('replaces every match as one undo step', async () => {
    const { wrapper, redactor, blocks, blockManager } = editor([
      { id: 'a', text: 'cat one' },
      { id: 'b', text: 'two cat, cat' },
    ]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'cat');
    setReplacement(wrapper, 'dog');
    clickReplaceAll();

    expect(blocks.map((block) => block.holder.textContent)).toEqual(['dog one', 'two dog, dog']);
    expect(blockManager.beginToolTransaction).toHaveBeenCalledTimes(1);
    expect(blockManager.endToolTransaction).toHaveBeenCalledTimes(1);
  });

  it('Replace All in an outer editor leaves a nested editor unchanged', async () => {
    const outer = editor([{ id: 'outer', text: 'cat outside' }]);
    const inner = editor([{ id: 'inner', text: 'cat inside' }]);

    outer.redactor.appendChild(inner.wrapper);
    press(outer.redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(outer.wrapper, 'cat');
    outer.find.replaceAll('dog');

    expect(inner.blocks[0].holder.textContent).toBe('cat inside');
    expect(outer.blocks[0].holder.textContent).toBe('dog outside');
  });

  it('keeps formatting when a replaced match spans two marks', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: '' }]);
    const input = blocks[0].holder.querySelector('[contenteditable]');

    if (input === null) {
      throw new Error('input missing');
    }
    input.innerHTML = 'a <b>bo</b><i>ld</i> move';

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'bold');
    setReplacement(wrapper, 'brave');
    clickReplaceAll();

    expect(input.textContent).toBe('a brave move');
    expect(input.querySelector('b')?.textContent).toBe('brave');
  });

  describe('replace buttons', () => {
    const replaceButton = (): HTMLButtonElement => byTestIdIn(openBar(), 'find-replace');
    const replaceAllButton = (): HTMLButtonElement => byTestIdIn(openBar(), 'find-replace-menu');
    const byTestIdIn = (root: Element, testId: string): HTMLButtonElement => {
      const button = root.querySelector(`[data-blok-testid="${testId}"]`);

      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`${testId} missing`);
      }

      return button;
    };
    const hostText = (text: string): HTMLElement => {
      const paragraph = document.createElement('p');

      paragraph.textContent = text;
      document.body.prepend(paragraph);

      return paragraph;
    };

    it('are disabled when every match is outside the editor', async () => {
      const { wrapper, redactor } = editor([{ id: 'a', text: 'nothing here' }]);

      hostText('a cat on the host page');
      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');

      expect(replaceButton().disabled).toBe(true);
      expect(replaceAllButton().disabled).toBe(true);
    });

    it('are disabled when every match is in text that is not editable', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat' }]);

      blocks[0].holder.querySelector('[contenteditable]')?.setAttribute('contenteditable', 'false');
      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');

      expect(replaceButton().disabled).toBe(true);
      expect(replaceAllButton().disabled).toBe(true);
    });

    it('enable Replace only on a match it can replace, and Replace all while any is left', async () => {
      const { wrapper, redactor, blocks, find } = editor([{ id: 'a', text: 'cat in the editor' }]);
      const host = hostText('a cat on the host page');
      const activeIn = (): Node | undefined => [...highlights.get('blok-find-match-active') ?? []][0]?.startContainer;

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');

      expect(host.contains(activeIn() ?? null)).toBe(true);
      expect(replaceButton().disabled).toBe(true);
      expect(replaceAllButton().disabled).toBe(false);

      find.move(1);

      expect(blocks[0].holder.contains(activeIn() ?? null)).toBe(true);
      expect(replaceButton().disabled).toBe(false);
      expect(replaceAllButton().disabled).toBe(false);
    });

    it('disable Replace on a match that already reads exactly like the replacement, case included', async () => {
      const { wrapper, redactor, find } = editor([{ id: 'a', text: 'cat and Cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('cat');

      expect(replaceButton().disabled).toBe(true);
      expect(replaceAllButton().disabled).toBe(false);

      find.move(1);

      expect(replaceButton().disabled).toBe(false);
    });

    it('leave Replace all nothing to do when every match already reads like the replacement', async () => {
      const { wrapper, redactor, find, blockManager } = editor([{ id: 'a', text: 'cat and cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('cat');

      expect(replaceAllButton().disabled).toBe(true);

      find.replaceAll('cat');

      expect(blockManager.beginToolTransaction).not.toHaveBeenCalled();
    });
  });

  it('never replaces in read-only mode', async () => {
    const { wrapper, redactor, blocks, readOnly, find } = editor([{ id: 'a', text: 'cat' }]);

    readOnly.isEnabled = true;
    find.toggleReadOnly(true);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'cat');
    find.replaceAll('dog');

    expect(blocks[0].holder.textContent).toBe('cat');
  });

  it('re-searches when the document changes under an open bar', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'one apple' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'apple');
    blocks[0].holder.querySelector('[contenteditable]')?.append(' apple');
    await Promise.resolve();
    vi.runAllTimers();

    expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBe(2);
  });

  it('clears the paint and selects the current match when closed with Escape', async () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'one apple' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'apple');
    press(searchInput(wrapper), { key: 'Escape', code: 'Escape' });
    vi.runAllTimers();

    expect(highlights.size).toBe(0);
    expect(window.getSelection()?.toString()).toBe('apple');
  });

  it('gives focus back to the editor when closed without a match', async () => {
    const { wrapper, blocks } = editor([{ id: 'a', text: 'one apple' }]);
    const input = blocks[0].holder.querySelector<HTMLElement>('[contenteditable]');

    if (input === null) {
      throw new Error('input missing');
    }
    input.focus();
    press(input, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'pear');
    press(searchInput(wrapper), { key: 'Escape', code: 'Escape' });

    expect(input).toHaveFocus();
  });

  it('keeps a second Cmd+F in the find field from opening the browser find', async () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);

    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(press(searchInput(wrapper), { key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(searchInput(wrapper)).toHaveFocus();
  });

  it('keeps Escape in the find bar from reaching the page', async () => {
    const { wrapper, redactor } = editor([{ id: 'a', text: 'hello' }]);
    const pageHandler = vi.fn();

    document.addEventListener('keydown', pageHandler);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
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
    await settle();
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
    await settle();
    typeQuery(wrapper, 'apple');

    await Array.from({ length: 20 }).reduce(async (previous: Promise<void>) => {
      await previous;
      host?.append(' apple');
      await Promise.resolve();
      vi.advanceTimersByTime(50);
    }, Promise.resolve());

    expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBeGreaterThan(1);
  });

  it('tells only the edited field about a replace, not the whole editor', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat' }]);
    const host = blocks[0].holder.querySelector('[contenteditable]');
    const onHost = vi.fn();
    const onEditor = vi.fn();

    host?.addEventListener('input', onHost);
    redactor.addEventListener('input', onEditor);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    typeQuery(wrapper, 'cat');
    setReplacement(wrapper, 'dog');
    clickReplaceAll();

    expect(onEditor).not.toHaveBeenCalled();
    expect(onHost).toHaveBeenCalled();
  });

  it('prefills the query from a short text selection', async () => {
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'pick this word' }]);
    const text = blocks[0].holder.querySelector('[contenteditable]')?.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(searchInput(wrapper).value).toBe('this');
  });

  it('never flashes "No results" while a prefilled query waits for its search', async () => {
    // A real ResizeObserver reports once after layout, before the query's search timer.
    vi.stubGlobal('ResizeObserver', class {
      private readonly callback: () => void;

      constructor(callback: () => void) {
        this.callback = callback;
      }

      public observe(): void {
        queueMicrotask(this.callback);
      }

      public disconnect(): void {}
    });
    const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'pick this word' }]);
    const text = blocks[0].holder.querySelector('[contenteditable]')?.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();
    await Promise.resolve();

    expect(searchInput(wrapper).getAttribute('aria-invalid')).toBeNull();
    expect(painted('blok-find-match-active')).toHaveLength(1);
  });

  it('prefills the query from a selection in a host contenteditable outside the editor', async () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);
    const hostTitle = document.createElement('h1');

    hostTitle.setAttribute('contenteditable', 'true');
    hostTitle.textContent = 'Blok title';
    document.body.appendChild(hostTitle);

    const text = hostTitle.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    window.getSelection()?.setBaseAndExtent(text, 0, text, 4);
    press(hostTitle, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(searchInput(wrapper).value).toBe('Blok');
  });

  it('prefills the query from the selected part of a host input', async () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);
    const hostInput = document.createElement('input');

    hostInput.value = 'search words';
    document.body.appendChild(hostInput);
    hostInput.focus();
    hostInput.setSelectionRange(7, 12);
    press(hostInput, { key: 'f', code: 'KeyF', ctrlKey: true });
    await settle();

    expect(searchInput(wrapper).value).toBe('words');
  });

  describe('word hop', () => {
    const nativeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'animate');
      Reflect.deleteProperty(CSS, 'supports');
      if (nativeClientRects === undefined) {
        Reflect.deleteProperty(Range.prototype, 'getClientRects');
      } else {
        Object.defineProperty(Range.prototype, 'getClientRects', nativeClientRects);
      }
    });

    it('gives the bar no hop for a host input selection, which has no rect', async () => {
      const { wrapper, blocks } = editor([{ id: 'a', text: 'pick this word' }]);
      const text = blocks[0].holder.querySelector('[contenteditable]')?.firstChild;
      const hostInput = document.createElement('input');
      const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => undefined) }));

      if (!(text instanceof Text)) {
        throw new Error('text missing');
      }
      Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
      Object.defineProperty(Range.prototype, 'getClientRects', {
        value: () => [{ left: 10, top: 10, width: 30, height: 18, right: 40, bottom: 28 }],
        configurable: true,
        writable: true,
      });
      vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query })));
      // A motion-capable engine, so only the input guard can stop the hop.
      Object.defineProperty(CSS, 'supports', { value: () => true, configurable: true, writable: true });
      vi.stubGlobal('KeyframeEffect', class { public get pseudoElement(): string | null { return null; } });
      // A stale document range is still measurable; only the input guard stops a hop from it.
      window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
      hostInput.value = 'search words';
      document.body.appendChild(hostInput);
      hostInput.focus();
      hostInput.setSelectionRange(7, 12);
      press(hostInput, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();

      expect(searchInput(wrapper).value).toBe('words');
      expect(document.querySelector('[data-blok-find-hop-chip]')).toBeNull();
    });

    it('measures the selected word before the bar opens and takes focus', async () => {
      const { redactor, blocks } = editor([{ id: 'a', text: 'pick this word' }]);
      const text = blocks[0].holder.querySelector('[contenteditable]')?.firstChild;

      if (!(text instanceof Text)) {
        throw new Error('text missing');
      }
      const measured = vi.fn(() => [{ left: 10, top: 10, width: 30, height: 18, right: 40, bottom: 28 }]);

      Object.defineProperty(Range.prototype, 'getClientRects', { value: measured, configurable: true, writable: true });
      window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
      const focusAtMeasure: Array<Element | null> = [];

      measured.mockImplementation(() => {
        focusAtMeasure.push(document.activeElement);

        return [{ left: 10, top: 10, width: 30, height: 18, right: 40, bottom: 28 }];
      });
      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();

      expect(focusAtMeasure.length).toBeGreaterThan(0);
      expect(focusAtMeasure[0]?.closest('[data-blok-find]')).toBeNull();
    });
  });

  it('does not prefill from a selection in another editor', async () => {
    const first = editor([{ id: 'a', text: 'hello' }]);
    const second = editor([{ id: 'b', text: 'other words' }]);
    const text = second.blocks[0].holder.querySelector('[contenteditable]')?.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    window.getSelection()?.setBaseAndExtent(text, 0, text, 5);
    await first.find.open();

    expect(searchInput(first.wrapper).value).toBe('');
  });

  describe('replace preview', () => {
    it('shows each match struck through with its replacement after it, without touching the document', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat and cat' }]);
      const input = blocks[0].holder.querySelector('[contenteditable]');

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');

      const preview = previewOf(blocks[0].holder);

      expect(texts(preview, '[data-blok-find-preview-old]')).toEqual(['cat', 'cat']);
      expect(texts(preview, '[data-blok-find-preview-new]')).toEqual(['dog', 'dog']);
      expect(preview.textContent).toBe('catdog and catdog');
      expect(input?.textContent).toBe('cat and cat');
      expect(blocks[0].holder.hasAttribute('data-blok-find-preview')).toBe(true);
      expect(preview.hasAttribute('inert')).toBe(true);
      expect(preview.getAttribute('aria-hidden')).toBe('true');
    });

    it('does not preview a nested editor from the outer Find bar', async () => {
      const outer = editor([{ id: 'outer', text: 'cat outside' }]);
      const inner = editor([{ id: 'inner', text: 'cat inside' }]);

      outer.redactor.appendChild(inner.wrapper);
      press(outer.redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(outer.wrapper, 'cat');
      typeReplacement('dog');

      expect(inner.redactor.querySelector(PREVIEW)).toBeNull();
      expect(outer.blocks[0].holder.querySelector(PREVIEW)).not.toBeNull();
    });

    it('does not count the preview as matches, even after the page settles', async () => {
      const { wrapper, redactor } = editor([{ id: 'a', text: 'cat and cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('cat cat');
      await Promise.resolve();
      vi.runAllTimers();

      expect(painted('blok-find-match').length + painted('blok-find-match-active').length).toBe(2);
      expect(redactor.querySelectorAll(PREVIEW)).toHaveLength(1);
    });

    it('previews a nested match once, inside its top-level block', async () => {
      const { wrapper, redactor, blocks } = editor([
        { id: 'a', text: 'toggle cat' },
        { id: 'b', text: 'child cat', parent: 'a' },
      ]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');

      expect(redactor.querySelectorAll(PREVIEW)).toHaveLength(1);
      expect(texts(previewOf(blocks[0].holder), '[data-blok-find-preview-new]')).toEqual(['dog', 'dog']);
      expect(blocks[1].holder.hasAttribute('data-blok-find-preview')).toBe(false);
    });

    it('strikes each match through with nothing after it when the replacement is empty', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat and cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');
      typeReplacement('');

      const preview = previewOf(blocks[0].holder);

      expect(texts(preview, '[data-blok-find-preview-old]')).toEqual(['cat', 'cat']);
      expect(preview.textContent).toBe('cat and cat');
    });

    it.each([
      ['the replace row closes', () => openBar().querySelector<HTMLButtonElement>('[data-blok-testid="find-replace-toggle"]')?.click()],
      ['the bar closes', () => press(searchInput(), { key: 'Escape', code: 'Escape' })],
    ])('goes away when %s', async (_, act) => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');
      act();
      vi.runAllTimers();

      expect(redactor.querySelector(PREVIEW)).toBeNull();
      expect(blocks[0].holder.hasAttribute('data-blok-find-preview')).toBe(false);
    });

    it('goes away when the editor turns read-only', async () => {
      const { wrapper, redactor, find, readOnly } = editor([{ id: 'a', text: 'cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');
      readOnly.isEnabled = true;
      find.toggleReadOnly(true);

      expect(redactor.querySelector(PREVIEW)).toBeNull();
    });

    it('selects the real match, not the preview, when closed', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'one cat' }]);
      const input = blocks[0].holder.querySelector('[contenteditable]');

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');
      press(searchInput(), { key: 'Escape', code: 'Escape' });

      const selection = window.getSelection();

      expect(selection?.toString()).toBe('cat');
      expect(input?.contains(selection?.anchorNode ?? null)).toBe(true);
    });

    it('matches what Replace All then writes', async () => {
      const { wrapper, redactor, blocks } = editor([{ id: 'a', text: 'a <cat> and cat' }]);

      press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });
      await settle();
      typeQuery(wrapper, 'cat');
      typeReplacement('dog');

      const preview = previewOf(blocks[0].holder).cloneNode(true) as HTMLElement;

      preview.querySelectorAll('[data-blok-find-preview-old]').forEach((old) => old.remove());
      clickReplaceAll();

      expect(blocks[0].holder.querySelector('[contenteditable]')?.textContent).toBe(preview.textContent);
      expect(redactor.querySelector(PREVIEW)).toBeNull();
    });
  });
});
