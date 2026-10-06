import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../../../../../src/components/block';
import { BlockEvents } from '../../../../../../src/components/modules/blockEvents';
import { KeyboardController } from '../../../../../../src/components/modules/uiControllers/controllers/keyboard';
import type { PageConfig, PageSearchResult } from '../../../../../../src/tools/page/types';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

const { MockPopover } = vi.hoisted(() => {
  class PopoverDouble {
    private root: HTMLElement | null = null;
    private readonly items: Array<{ element?: HTMLElement }>;

    constructor(params: { items: Array<{ element?: HTMLElement }>; listbox?: boolean; listboxId?: string }) {
      this.items = params.items;
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

    on(): void {}

    destroy(): void {
      this.root?.remove();
      this.root = null;
    }
  }

  return { MockPopover: PopoverDouble };
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
    expect(trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(false);
    expect(block.currentInput?.textContent).toBe('@road');
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
    page.resolve = vi.fn().mockResolvedValue({ access: 'none' });
    await trigger.handleInput(inputEvent(block.currentInput as HTMLElement));

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
