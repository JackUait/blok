import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../../../../../src/components/block';
import { BlockEvents } from '../../../../../../src/components/modules/blockEvents';
import { KeyboardController } from '../../../../../../src/components/modules/uiControllers/controllers/keyboard';
import type { PageConfig, PageSearchResult } from '../../../../../../src/tools/page/types';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

const { MockPopover, popovers } = vi.hoisted(() => {
  const instances: Array<{ nothingFound: boolean; messages?: { nothingFound?: string }; closeFromOutside: () => void }> = [];

  class PopoverDouble {
    private root: HTMLElement | null = null;
    private readonly items: Array<{ element?: HTMLElement }>;
    public readonly messages?: { nothingFound?: string };
    public nothingFound = false;

    constructor(params: {
      items: Array<{ element?: HTMLElement }>;
      listbox?: boolean;
      listboxId?: string;
      messages?: { nothingFound?: string };
    }) {
      this.items = params.items;
      this.messages = params.messages;
      instances.push(this);
    }

    setNothingFound(isDisplayed: boolean): void {
      this.nothingFound = isDisplayed;
    }

    show(): void {
      const root = document.createElement('div');
      const list = document.createElement('div');

      list.setAttribute('role', 'listbox');
      this.items.forEach((item) => {
        if (item.element !== undefined) {
          list.append(item.element);
        }
      });
      root.append(list);
      document.body.append(root);
      this.root = root;
    }

    private closed: (() => void) | null = null;

    on(_event: string, callback: () => void): void {
      this.closed = callback;
    }

    closeFromOutside(): void {
      this.closed?.();
    }

    getElement(): HTMLElement {
      return this.root ?? document.createElement('div');
    }

    mountSearchField(field: HTMLElement): void {
      this.root?.prepend(field);
    }

    destroy(): void {
      this.root?.remove();
      this.root = null;
    }
  }

  return { MockPopover: PopoverDouble, popovers: instances };
});

vi.mock('../../../../../../src/components/utils/popover', () => ({
  PopoverDesktop: MockPopover,
}));

import { PageReferenceTrigger } from '../../../../../../src/components/modules/blockEvents/composers/pageReferenceTrigger';

const inputEvent = (target: EventTarget, isComposing = false): InputEvent => {
  const event = new InputEvent('input', { inputType: 'insertText', data: 'd', isComposing });

  Object.defineProperty(event, 'target', { value: target });

  return event;
};

interface Setup {
  block: Block;
  page: PageConfig;
  search: ReturnType<typeof vi.fn<(query: string) => Promise<readonly PageSearchResult[]>>>;
  trigger: PageReferenceTrigger;
  readOnly: { isEnabled: boolean };
  modules: BlokModules;
}

const setup = (text: string): Setup => {
  const block = createBlock(text);
  const search = vi.fn<(query: string) => Promise<readonly PageSearchResult[]>>().mockResolvedValue([]);
  const page: PageConfig = { search };
  const readOnly = { isEnabled: false };
  const modules = {
    ...createBlokModules(block),
    Tools: { blockTools: new Map([['page', { settings: page }]]) },
    ReadOnly: readOnly,
  } as unknown as BlokModules;

  document.body.append(block.holder);
  setCaret(block, text.length);

  return { block, page, search, trigger: new PageReferenceTrigger(modules), readOnly, modules };
};

describe('PageReferenceTrigger', () => {
  let current: PageReferenceTrigger | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    popovers.length = 0;
  });

  afterEach(() => {
    current?.destroy();
    current = undefined;
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it.each(['See @road', 'See [[road'])('replaces only the %s query with one ID-backed mark', async (text) => {
    const { block, search, trigger } = setup(text);

    current = trigger;
    search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);

    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
    expect(search).toHaveBeenCalledWith('road');

    trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await vi.waitFor(() => {
      expect(block.currentInput?.innerHTML).toBe('See <a data-blok-page-id="p1">Page</a>');
    });
    expect(block.dispatchChange).toHaveBeenCalledOnce();
  });

  it('keeps normal email text literal', async () => {
    const { block, search, trigger } = setup('a@b.test');

    current = trigger;
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(search).not.toHaveBeenCalled();
    expect(trigger.opened).toBe(false);
    expect(block.currentInput?.textContent).toBe('a@b.test');
  });

  it('does not search in a native input, code block, read-only editor, or IME composition', async () => {
    const { block, search, trigger, readOnly } = setup('@road');

    current = trigger;
    const native = document.createElement('input');

    block.holder.append(native);
    await trigger.handleInput(inputEvent(native));
    readOnly.isEnabled = true;
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
    readOnly.isEnabled = false;
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement, true));
    Object.assign(block.tool, { isDefault: false, isLineBreaksEnabled: true });
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(search).not.toHaveBeenCalled();
    expect(trigger.opened).toBe(false);
  });

  it.each(['a', 'code'])('does not open inside an existing %s span', async (tag) => {
    const { block, search, trigger } = setup('@road');

    current = trigger;
    const input = block.currentInput as HTMLElement;
    const span = document.createElement(tag);

    if (span instanceof HTMLAnchorElement) {
      span.href = 'https://example.com';
    }
    span.textContent = '@road';
    input.replaceChildren(span);
    const text = span.firstChild;

    if (text === null) {
      throw new Error('missing text');
    }
    const range = document.createRange();

    range.setStart(text, 5);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await trigger.handleInput(inputEvent(input));

    expect(search).not.toHaveBeenCalled();
    expect(input.textContent).toBe('@road');
  });

  it('leaves @ and [[ literal when the host has no search hook', async () => {
    const { block, page, trigger } = setup('@road');

    current = trigger;
    delete page.search;
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(trigger.opened).toBe(false);
    expect(block.currentInput?.textContent).toBe('@road');
  });

  it('uses the localized page fallback for an untitled search result', async () => {
    const { block, search, trigger } = setup('@road');

    current = trigger;
    search.mockResolvedValue([{ pageId: 'p1' }]);
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(document.querySelector('[role="option"]')?.textContent).toBe('tools.page.unresolved');
  });

  it('never paints or commits an inaccessible or malformed result', async () => {
    const { block, search, trigger } = setup('@road');

    current = trigger;
    search.mockResolvedValue([
      { pageId: 'secret', title: 'Secret', access: 'none' },
      { pageId: '', title: 'Broken' },
    ]);
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(document.body.textContent).not.toContain('Secret');
    expect(document.body.textContent).not.toContain('Broken');
    // Every hit was filtered out: the picker stays open and says Nothing found.
    expect(trigger.opened).toBe(true);
    expect(popovers.at(-1)?.nothingFound).toBe(true);
    expect(popovers.at(-1)?.messages?.nothingFound).toBe('popover.nothingFound');
    expect(trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(true);
    expect(block.currentInput?.textContent).toBe('@road');
  });

  it('shows Nothing found when resolve denies every hit', async () => {
    const { block, page, search, trigger } = setup('@road');

    current = trigger;
    page.resolve = vi.fn().mockResolvedValue({ access: 'none' });
    search.mockResolvedValue([{ pageId: 'p1', title: 'Secret' }]);
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(trigger.opened).toBe(true);
    expect(popovers.at(-1)?.nothingFound).toBe(true);
    expect(document.body.textContent).not.toContain('Secret');
  });

  it('shows the path and draft status from resolve over the search hit', async () => {
    const { block, page, search, trigger } = setup('@nap');

    current = trigger;
    page.resolve = vi.fn().mockImplementation((pageId: string) => (pageId === 'p1'
      ? { title: 'Напитки', path: ['Общее КЦ', 'Меню'], status: 'draft' }
      : { title: 'Root' }));
    search.mockResolvedValue([
      { pageId: 'p1', title: 'Old', path: ['Stale'], status: 'published' },
      { pageId: 'p2', title: 'Root', path: ['Home'], status: 'draft' },
    ]);
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options[0]?.querySelector('[data-blok-testid="page-picker-option-path"]')?.textContent).toBe('Общее КЦ / Меню');
    expect(options[0]?.getAttribute('data-blok-page-status')).toBe('draft');
    expect(options[0]?.querySelector('[data-blok-testid="page-draft-badge"]')?.textContent).toBe('tools.page.draft');
    expect(options[1]?.querySelector('[data-blok-testid="page-picker-option-path"]')?.textContent).toBe('Home');
    expect(options[1]?.getAttribute('data-blok-page-status')).toBe('draft');
  });

  it.each(['Enter', 'ArrowDown'])(
    'keeps %s in the open page picker when search finds no pages',
    async (key) => {
      const { block, trigger } = setup('@missing');

      current = trigger;
      await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
      const event = new KeyboardEvent('keydown', { key, cancelable: true });

      expect(trigger.handleKeydown(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(trigger.opened).toBe(true);
      expect(block.currentInput?.textContent).toBe('@missing');
    }
  );

  it('does not paint a stale search hit after access is revoked', async () => {
    const { block, page, search, trigger } = setup('@road');

    current = trigger;
    page.resolve = vi.fn().mockResolvedValue({ access: 'none' });
    search.mockResolvedValue([{ pageId: 'p1', title: 'Secret' }]);
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)).not.toContain('Secret');
    expect(block.currentInput?.textContent).toBe('@road');
  });

  it('removes an open picker result when its page changes in the same tab', async () => {
    const { block, page, search, trigger } = setup('@road');
    let notify: (() => void) | undefined;
    let access: 'allowed' | 'none' = 'allowed';
    const unsubscribe = vi.fn();

    current = trigger;
    search.mockResolvedValue([{ pageId: 'p1', title: 'Secret Roadmap' }]);
    page.resolve = () => access === 'none'
      ? { access: 'none', title: 'Secret Roadmap' }
      : { title: 'Secret Roadmap' };
    page.subscribe = (_id, onChange) => { notify = onChange; return unsubscribe; };
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
    expect(document.querySelector('[role="option"]')?.textContent).toBe('Secret Roadmap');

    access = 'none';
    notify?.();

    expect(document.body.textContent).not.toContain('Secret Roadmap');
    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(block.currentInput?.textContent).toBe('@road');
  });

  it('rejects a result that lost access before commit', async () => {
    const { block, page, search, trigger } = setup('@road');

    current = trigger;
    search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);
    // Visible at search time, denied at commit time.
    page.resolve = vi.fn().mockResolvedValueOnce({ title: 'Roadmap' }).mockResolvedValue({ access: 'none' });
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);

    trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await vi.waitFor(() => {
      expect(page.resolve).toHaveBeenCalledWith('p1');
      expect(trigger.opened).toBe(false);
    });
    expect(block.currentInput?.querySelector('[data-blok-page-id]')).toBeNull();
    expect(block.currentInput?.textContent).toBe('@road');
  });

  it('keeps only the latest asynchronous search results', async () => {
    const { block, search, trigger } = setup('@ro');

    current = trigger;
    // The picker code loads on the first "@"; load it so both searches below really run.
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));
    search.mockClear();
    let finishFirst: ((results: readonly PageSearchResult[]) => void) | undefined;
    const firstResults = new Promise<readonly PageSearchResult[]>((resolve) => {
      finishFirst = resolve;
    });

    search.mockReturnValueOnce(firstResults);
    search.mockResolvedValueOnce([{ pageId: 'new', title: 'Roadmap' }]);
    const first = trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    if (block.currentInput === undefined) {
      throw new Error('missing input');
    }
    block.currentInput.textContent = '@road';
    setCaret(block, 5);
    await trigger.handleInput(inputEvent(block.currentInput));
    finishFirst?.([{ pageId: 'old', title: 'Old result' }]);
    await first;

    expect(document.body.textContent).toContain('Roadmap');
    expect(document.body.textContent).not.toContain('Old result');
  });

  it('searches from the real BlockEvents input route', async () => {
    const { block, modules, search } = setup('@road');
    const blockEvents = new BlockEvents({
      config: { inlineEmoji: false },
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as BlockEvents['eventsDispatcher'],
    });

    blockEvents.state = {
      ...modules,
      Caret: { resetGoalColumn: vi.fn() },
      YjsManager: {
        ...modules.YjsManager,
        checkAndHandleBoundary: vi.fn(),
        hasPendingBoundary: vi.fn(() => false),
      },
    } as unknown as BlokModules;
    blockEvents.input(inputEvent(block.currentInput as HTMLElement));

    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('road'));
    blockEvents.destroy();
  });

  it('claims capture-phase Escape before block navigation mode', async () => {
    const { block, modules, search } = setup('@road');
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-testid', 'blok-editor');
    wrapper.append(block.holder);
    document.body.append(wrapper);
    setCaret(block, 5);
    search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);

    const enableNavigationMode = vi.fn();
    const blockEvents = new BlockEvents({
      config: { inlineEmoji: false },
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as BlockEvents['eventsDispatcher'],
    });
    const state = {
      ...modules,
      BlockEvents: blockEvents,
      BlockSelection: {
        navigationModeEnabled: false,
        anyBlockSelected: false,
        allBlocksSelected: false,
        enableNavigationMode,
        disableNavigationMode: vi.fn(),
      },
      BlockSettings: { opened: false },
      InlineToolbar: { opened: false },
      Toolbar: { toolbox: { opened: false, close: vi.fn() }, close: vi.fn() },
      CrossBlockSelection: { selectBlocksOfTextSelection: vi.fn(() => false), isCrossBlockSelectionStarted: false },
      DragManager: { isDragging: false },
      Caret: { resetGoalColumn: vi.fn() },
      YjsManager: {
        ...modules.YjsManager,
        checkAndHandleBoundary: vi.fn(),
        hasPendingBoundary: vi.fn(() => false),
      },
    } as unknown as BlokModules;

    blockEvents.state = state;
    blockEvents.input(inputEvent(block.currentInput as HTMLElement));
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith('road'));

    const controller = new KeyboardController({
      config: {},
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as KeyboardController['eventsDispatcher'],
      someToolbarOpened: () => false,
    });

    controller.state = state;
    controller.setRedactorElement(wrapper);
    controller.setWrapperElement(wrapper);
    controller.enable();
    block.currentInput?.focus();
    block.currentInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(enableNavigationMode).not.toHaveBeenCalled();
    expect(block.currentInput?.textContent).toBe('@road');
    controller.disable();
    blockEvents.destroy();
    wrapper.remove();
  });

  it('closes on Escape without deleting the typed query', async () => {
    const { block, search, trigger } = setup('@road');

    current = trigger;
    search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    expect(trigger.opened).toBe(false);
    expect(block.currentInput?.textContent).toBe('@road');
  });
});

class FakeHighlight extends Set<Range> {
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

describe('PageReferenceTrigger — Notion "@" menu', () => {
  const highlights = new Map<string, FakeHighlight>();
  let current: PageReferenceTrigger | undefined;

  const option = (testid: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-blok-testid="${testid}"]`);
  const press = (key: string): boolean =>
    current?.handleKeydown(new KeyboardEvent('keydown', { key, cancelable: true })) ?? false;
  const mentionSetup = (text: string, config: Partial<PageConfig> = {}): Setup => {
    const result = setup(text);

    Object.assign(result.page, config);
    current = result.trigger;

    return result;
  };
  const painted = (): string[] =>
    Array.from(highlights.get('blok-page-mention-query') ?? []).map((range) => range.toString());

  beforeEach(() => {
    vi.clearAllMocks();
    popovers.length = 0;
    highlights.clear();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights });
  });

  afterEach(() => {
    current?.destroy();
    current = undefined;
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens on "@" alone with the loading state until recents arrive', async () => {
    const { block, search } = mentionSetup('See @');
    let answer: ((results: readonly PageSearchResult[]) => void) | undefined;

    search.mockReturnValue(new Promise((resolve) => {
      answer = resolve;
    }));
    const pending = current?.handleInput(inputEvent(block.currentInput as HTMLElement));

    // The picker code loads on the first "@".
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith(''));
    expect(current?.opened).toBe(true);
    expect(option('page-picker-spinner')).not.toBeNull();
    expect(document.querySelectorAll('[data-blok-testid="page-picker-skeleton"]')).toHaveLength(2);
    expect(popovers.at(-1)?.nothingFound).toBe(false);

    answer?.([{ pageId: 'p1', title: 'Recent' }]);
    await pending;

    expect(option('page-picker-spinner')).toBeNull();
    expect(option('page-picker-option')?.textContent).toBe('Recent');
  });

  it.each([
    ['no createFromMention', { create: vi.fn() }],
    ['createFromMention without create', { createFromMention: true }],
  ])('has no New page section with %s', async (_name, config) => {
    const { block } = mentionSetup('@que', config);

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(option('page-picker-new-sub-page')).toBeNull();
    expect(popovers.at(-1)?.nothingFound).toBe(true);
  });

  it('keeps only the New page section when no page matches, without Nothing found', async () => {
    const { block } = mentionSetup('@zzqx', { createFromMention: true, create: vi.fn() });

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));

    expect(option('page-picker-new-sub-page')).not.toBeNull();
    expect(option('page-picker-new-page-in')).not.toBeNull();
    expect(document.querySelector('[data-blok-page-picker-section="link"]')).toBeNull();
    expect(popovers.at(-1)?.nothingFound).toBe(false);
  });

  it('creates a titled sub-page, uses the host\'s id and mentions it without opening it', async () => {
    const create = vi.fn().mockResolvedValue({ pageId: 'host-id' });
    const open = vi.fn();
    const { block, page } = mentionSetup('See @que', { createFromMention: true, create, open });

    // A brand-new page may not resolve yet; the mention must still land.
    page.resolve = vi.fn().mockReturnValue(null);
    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    option('page-picker-new-sub-page')?.click();

    await vi.waitFor(() => {
      expect(block.currentInput?.innerHTML).toBe('See <a data-blok-page-id="host-id">Page</a>');
    });
    const init = create.mock.calls[0]?.[0] as { pageId: string; title: string; parentId?: string };

    expect(create).toHaveBeenCalledOnce();
    expect(init.title).toBe('que');
    expect(init.pageId).toMatch(/\S/);
    expect('parentId' in init).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(block.dispatchChange).toHaveBeenCalledOnce();
    expect(current?.opened).toBe(false);
  });

  it('keeps Blok\'s id when create answers nothing', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const { block } = mentionSetup('@que', { createFromMention: true, create });

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    option('page-picker-new-sub-page')?.click();

    await vi.waitFor(() => expect(block.currentInput?.querySelector('[data-blok-page-id]')).not.toBeNull());
    expect(block.currentInput?.querySelector('[data-blok-page-id]')?.getAttribute('data-blok-page-id'))
      .toBe((create.mock.calls[0]?.[0] as { pageId: string }).pageId);
  });

  it('shows the item busy while create runs', async () => {
    let finish: (() => void) | undefined;
    const create = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const { block } = mentionSetup('@que', { createFromMention: true, create });

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    press('Enter');

    expect(create).toHaveBeenCalledOnce();
    expect(option('page-picker-new-sub-page')?.getAttribute('aria-busy')).toBe('true');
    expect(current?.opened).toBe(true);

    finish?.();
    await vi.waitFor(() => expect(current?.opened).toBe(false));
    expect(block.currentInput?.querySelector('[data-blok-page-id]')).not.toBeNull();
  });

  it('inserts nothing and keeps "@query" when create rejects', async () => {
    const create = vi.fn().mockRejectedValue(new Error('offline'));
    const { block } = mentionSetup('@que', { createFromMention: true, create });

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    press('Enter');

    await vi.waitFor(() => expect(current?.opened).toBe(false));
    expect(block.currentInput?.textContent).toBe('@que');
    expect(block.currentInput?.querySelector('[data-blok-page-id]')).toBeNull();
    expect(painted()).toEqual([]);
  });

  it('does not create when the "@query" text changed before the pick', async () => {
    const create = vi.fn();
    const { block } = mentionSetup('@que', { createFromMention: true, create });

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    if (block.currentInput === undefined) {
      throw new Error('missing input');
    }
    block.currentInput.textContent = 'gone';
    setCaret(block, 4);
    press('Enter');

    expect(create).not.toHaveBeenCalled();
    expect(current?.opened).toBe(false);
    expect(block.currentInput.textContent).toBe('gone');
  });

  it('drops the mention when the caret moved while create ran', async () => {
    let finish: (() => void) | undefined;
    const create = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const { block } = mentionSetup('See @que', { createFromMention: true, create });

    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    press('Enter');
    setCaret(block, 1);
    finish?.();

    await vi.waitFor(() => expect(current?.opened).toBe(false));
    expect(create).toHaveBeenCalledOnce();
    expect(block.currentInput?.textContent).toBe('See @que');
    expect(block.currentInput?.querySelector('[data-blok-page-id]')).toBeNull();
  });

  it('"page in…" asks for a parent in the same menu, then creates the page there', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const { block, search } = mentionSetup('See @que', { createFromMention: true, create });

    search.mockImplementation((query) => Promise.resolve(query === ''
      ? [{ pageId: 'parent-1', title: 'Home' }, { pageId: 'parent-2', title: 'Plans' }]
      : []));
    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    option('page-picker-new-page-in')?.click();

    const field = option('page-picker-search-input');

    expect(popovers).toHaveLength(1);
    expect(field).toHaveFocus();
    expect(field?.getAttribute('placeholder')).toBe('tools.page.search');
    expect(search).toHaveBeenLastCalledWith('');
    await vi.waitFor(() => expect(document.querySelectorAll('[data-blok-testid="page-picker-option"]')).toHaveLength(2));
    expect(create).not.toHaveBeenCalled();

    document.querySelectorAll<HTMLElement>('[data-blok-testid="page-picker-option"]')[1]?.click();

    await vi.waitFor(() => expect(block.currentInput?.querySelector('[data-blok-page-id]')).not.toBeNull());
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'que', parentId: 'parent-2' }));
    expect(block.currentInput?.textContent).toBe('See Page');
    expect(current?.opened).toBe(false);
  });

  it('Escape in the parent step keeps "@query" and puts the caret back after it', async () => {
    const create = vi.fn();
    const { block } = mentionSetup('See @que', { createFromMention: true, create });

    // jsdom focuses a contenteditable only with a tabindex.
    block.currentInput?.setAttribute('tabindex', '0');
    await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
    option('page-picker-new-page-in')?.click();
    option('page-picker-search-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(current?.opened).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(block.currentInput?.textContent).toBe('See @que');
    expect(block.currentInput).toHaveFocus();
    expect(window.getSelection()?.getRangeAt(0).startOffset).toBe(8);
    expect(painted()).toEqual([]);
  });

  describe('the "@query" pill', () => {
    it('paints the typed "@query" without touching the text DOM', async () => {
      const { block, search } = mentionSetup('See @road');
      const before = block.currentInput?.innerHTML;

      search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);
      await current?.handleInput(inputEvent(block.currentInput as HTMLElement));

      expect(painted()).toEqual(['@road']);
      expect(block.currentInput?.innerHTML).toBe(before);
    });

    it('follows the query as it grows', async () => {
      const { block } = mentionSetup('@ro');

      await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
      if (block.currentInput === undefined) {
        throw new Error('missing input');
      }
      block.currentInput.textContent = '@road';
      setCaret(block, 5);
      await current?.handleInput(inputEvent(block.currentInput));

      expect(painted()).toEqual(['@road']);
    });

    it.each([
      ['Escape', (): void => {
        press('Escape');
      }],
      ['a close from outside', (): void => {
        popovers.at(-1)?.closeFromOutside();
      }],
      ['destroy', (): void => {
        current?.destroy();
      }],
    ])('is cleared on %s', async (_name, closeIt) => {
      const { block } = mentionSetup('@road');

      await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
      expect(painted()).toEqual(['@road']);

      closeIt();

      expect(painted()).toEqual([]);
      expect(current?.opened).toBe(false);
    });

    it('is cleared after a pick inserts the mention', async () => {
      const { block, search } = mentionSetup('@road');

      search.mockResolvedValue([{ pageId: 'p1', title: 'Roadmap' }]);
      await current?.handleInput(inputEvent(block.currentInput as HTMLElement));
      press('Enter');

      await vi.waitFor(() => expect(block.currentInput?.querySelector('[data-blok-page-id]')).not.toBeNull());
      expect(painted()).toEqual([]);
    });
  });
});
