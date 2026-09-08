import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import { DATA_ATTR, TEST_ID } from '../../../../../src/components/constants';
import { PlusButtonHandler } from '../../../../../src/components/modules/toolbar/plus-button';
import { createTooltipContent } from '../../../../../src/components/modules/toolbar/tooltip';
import type { ToolbarNodes } from '../../../../../src/components/modules/toolbar/types';
import { getUserOS } from '../../../../../src/components/utils';
import type { PopoverAbstract } from '../../../../../src/components/utils/popover/popover-abstract';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import { onHover } from '../../../../../src/components/utils/tooltip';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../../src/components/modules/toolbar/tooltip', () => ({
  createTooltipContent: vi.fn(() => document.createElement('div')),
}));

vi.mock('../../../../../src/components/selection/index', () => ({
  SelectionUtils: {
    get: vi.fn(() => ({ removeAllRanges: vi.fn() })),
  },
}));

// Only getUserOS is faked: Dom.make (real) is what stamps the classes and the
// icon this suite asserts on, and it reads isString/isNumber from this module.
vi.mock('../../../../../src/components/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    getUserOS: vi.fn(() => ({ win: false,
      mac: true,
      x11: false,
      linux: false })),
  };
});

const emptyNodes = (): ToolbarNodes => ({}) as unknown as ToolbarNodes;

interface BlockOptions {
  name?: string;
  isEmpty?: boolean;
  /** null models a block whose content node carries no text node at all. */
  text?: string | null;
  parentId?: string | null;
  holder?: HTMLElement;
}

const createBlock = (options: BlockOptions = {}): Block => ({
  name: options.name ?? 'paragraph',
  isEmpty: options.isEmpty ?? false,
  parentId: options.parentId ?? null,
  holder: options.holder ?? document.createElement('div'),
  pluginsContent: { textContent: options.text === undefined ? '' : options.text },
} as unknown as Block);

/** Wraps a holder so `parentElement.closest('[data-blok-testid=block-wrapper]')` resolves. */
const nestedHolder = (): HTMLElement => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute(DATA_ATTR.testid, 'block-wrapper');

  const inner = document.createElement('div');
  const holder = document.createElement('div');

  wrapper.appendChild(inner);
  inner.appendChild(holder);

  return holder;
};

/** A holder with a parent that has no block-wrapper ancestor. */
const topLevelHolder = (): HTMLElement => {
  const container = document.createElement('div');
  const holder = document.createElement('div');

  container.appendChild(holder);

  return holder;
};

interface SetupOptions {
  hoveredBlock?: Block | null;
  currentBlock?: Block | null;
  blocks?: Block[];
  hoveredBlockIndex?: number;
  currentBlockIndex?: number;
  insertedBlock?: Block;
  blockSettingsOpened?: boolean;
  anyBlockSelected?: boolean;
  toolboxOpened?: boolean;
  focusedBlock?: Block | null;
  captureFocus?: boolean;
}

const setup = (options: SetupOptions = {}) => {
  const insertedBlock = options.insertedBlock ?? createBlock({ isEmpty: true });

  const openToolbox = vi.fn<() => void>();
  const openToolboxWithoutSlash = vi.fn<() => void>();
  const closeToolbox = vi.fn<() => void>();
  const moveAndOpenToolbar = vi.fn();
  const onFocusBlockCaptured = vi.fn();

  const closeBlockSettings = vi.fn();
  const clearSelection = vi.fn();
  const getBlockIndex = vi.fn(() => options.hoveredBlockIndex ?? 0);
  const getBlockByChildNode = vi.fn(() => options.focusedBlock ?? null);
  const insertDefaultBlockAtIndex = vi.fn(() => insertedBlock);
  const setBlockParent = vi.fn();
  const setToBlock = vi.fn();

  const blok = {
    I18n: { t: vi.fn((key: string) => key) },
    BlockSettings: {
      opened: options.blockSettingsOpened ?? false,
      close: closeBlockSettings,
    },
    BlockSelection: {
      anyBlockSelected: options.anyBlockSelected ?? false,
      clearSelection,
    },
    BlockManager: {
      currentBlock: options.currentBlock ?? null,
      currentBlockIndex: options.currentBlockIndex ?? 0,
      blocks: options.blocks ?? [],
      getBlockIndex,
      getBlockByChildNode,
      insertDefaultBlockAtIndex,
      setBlockParent,
    },
    Caret: {
      setToBlock,
      positions: { DEFAULT: 'default',
        START: 'start' },
    },
  } as unknown as BlokModules;

  const handler = new PlusButtonHandler(() => blok, {
    getToolboxOpened: () => options.toolboxOpened ?? false,
    openToolbox,
    openToolboxWithoutSlash,
    closeToolbox,
    moveAndOpenToolbar,
    ...(options.captureFocus === false ? {} : { onFocusBlockCaptured }),
  });

  handler.setHoveredBlock(options.hoveredBlock ?? null);

  return {
    handler,
    blok,
    insertedBlock,
    openToolbox,
    openToolboxWithoutSlash,
    closeToolbox,
    moveAndOpenToolbar,
    onFocusBlockCaptured,
    closeBlockSettings,
    clearSelection,
    getBlockIndex,
    getBlockByChildNode,
    insertDefaultBlockAtIndex,
    setBlockParent,
    setToBlock,
  };
};

describe('PlusButtonHandler — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserOS).mockReturnValue({ win: false,
      mac: true,
      x11: false,
      linux: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
  });

  describe('make()', () => {
    it('stamps every styling class onto the button', () => {
      const { handler } = setup();

      const plusButton = handler.make(emptyNodes());

      expect(plusButton.className.split(' ')).toEqual([
        'text-text-secondary',
        'cursor-pointer',
        'w-6',
        'h-6',
        'rounded-[5px]',
        'inline-flex',
        'justify-center',
        'items-center',
        'select-none',
        'shrink-0',
        '[&_svg]:h-[22px]',
        '[&_svg]:w-[22px]',
        'can-hover:hover:bg-bg-light',
        'group-data-[blok-toolbox-opened=true]:hidden',
        'group-data-[blok-block-settings-opened=true]:hidden',
        'mobile:bg-popover-bg',
        'mobile:border',
        'mobile:border-mobile-border',
        'mobile:shadow-overlay-pane',
        'mobile:rounded-[6px]',
        'mobile:z-2',
        'mobile:w-toolbox-btn-mobile',
        'mobile:h-toolbox-btn-mobile',
        'group-data-[blok-rtl=true]:right-[calc(-1*(var(--spacing-toolbox-btn)))]',
        'group-data-[blok-rtl=true]:left-auto',
      ]);
    });

    it('renders the plus icon and the test id', () => {
      const { handler } = setup();

      const plusButton = handler.make(emptyNodes());

      expect(plusButton.querySelector('svg')).not.toBeNull();
      expect(plusButton.getAttribute(DATA_ATTR.testid)).toBe(TEST_ID.plusButton);
    });

    it('stores and returns the hovered block', () => {
      const { handler } = setup();
      const block = createBlock();

      handler.setHoveredBlock(block);

      expect(handler.hoveredBlock).toBe(block);
    });
  });

  describe('refreshI18n()', () => {
    it('does nothing without an element', () => {
      const { handler, blok } = setup();

      expect(() => handler.refreshI18n(undefined)).not.toThrow();
      expect(blok.I18n.t).not.toHaveBeenCalled();
    });

    it('builds the tooltip with the Ctrl hint on Windows', () => {
      vi.mocked(getUserOS).mockReturnValue({ win: true,
        mac: false,
        x11: false,
        linux: false });

      const { handler } = setup();
      const element = document.createElement('div');

      handler.refreshI18n(element);

      expect(element.getAttribute('aria-label')).toBe('a11y.insertBlock');
      expect(createTooltipContent).toHaveBeenCalledWith(['toolbox.addBelow', 'toolbox.ctrlAddAbove']);
      expect(onHover).toHaveBeenCalledWith(element, expect.anything(), { delay: 500 });
    });

    it('builds the tooltip with the Option hint off Windows', () => {
      const { handler } = setup();

      handler.refreshI18n(document.createElement('div'));

      expect(createTooltipContent).toHaveBeenCalledWith(['toolbox.addBelow', 'toolbox.optionAddAbove']);
    });
  });

  describe('handleClick() — same-trigger law', () => {
    it('runs normally when the toolbox is closed even though this button anchors a popover', () => {
      const fixture = setup({ toolboxOpened: false });
      const plusButton = fixture.handler.make(emptyNodes());
      const popoverEl = document.createElement('div');
      const popover = {
        hide: vi.fn(),
        hasNode: vi.fn((node: Node) => popoverEl.contains(node)),
        getElement: vi.fn(() => popoverEl),
        getFocusHost: vi.fn(() => null),
      } as unknown as PopoverAbstract;

      PopoverRegistry.instance.register(popover, plusButton);

      fixture.handler.handleClick();

      expect(fixture.openToolboxWithoutSlash).toHaveBeenCalledTimes(1);
    });

    it('closes the toolbox when no plus button element has been built yet', () => {
      const fixture = setup({ toolboxOpened: true });

      vi.spyOn(PopoverRegistry.instance, 'isOpenTrigger').mockReturnValue(true);

      fixture.handler.handleClick();

      expect(fixture.closeToolbox).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleClick() — other menus and selection', () => {
    it('closes block settings when they are open', () => {
      const fixture = setup({ blockSettingsOpened: true });

      fixture.handler.handleClick();

      expect(fixture.closeBlockSettings).toHaveBeenCalledTimes(1);
    });

    it('leaves block settings alone when they are already closed', () => {
      const fixture = setup({ blockSettingsOpened: false });

      fixture.handler.handleClick();

      expect(fixture.closeBlockSettings).not.toHaveBeenCalled();
    });

    it('leaves the block selection alone when nothing is selected', () => {
      const fixture = setup({ anyBlockSelected: false });

      fixture.handler.handleClick();

      expect(fixture.clearSelection).not.toHaveBeenCalled();
    });
  });

  describe('handleClick() — slash mode', () => {
    it('keeps slash search on a paragraph whose text already starts with a slash', () => {
      const hoveredBlock = createBlock({ name: 'paragraph',
        text: '/x',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
      expect(fixture.setToBlock).toHaveBeenCalledWith(hoveredBlock, 'default', 1);
      expect(fixture.moveAndOpenToolbar).toHaveBeenCalledWith(hoveredBlock);
      expect(fixture.openToolbox).toHaveBeenCalledTimes(1);
      expect(fixture.openToolboxWithoutSlash).not.toHaveBeenCalled();
    });

    it('inserts a new block when the hovered paragraph has no leading slash', () => {
      const hoveredBlock = createBlock({ name: 'paragraph',
        text: 'abc',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
      expect(fixture.openToolboxWithoutSlash).toHaveBeenCalledTimes(1);
      expect(fixture.openToolbox).not.toHaveBeenCalled();
    });

    it('survives a hovered paragraph whose content node has no text at all', () => {
      const hoveredBlock = createBlock({ name: 'paragraph',
        text: null,
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.openToolboxWithoutSlash).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleClick() — picking the block to work on', () => {
    it('reuses the hovered block when it is empty', () => {
      const hoveredBlock = createBlock({ isEmpty: true,
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
      expect(fixture.setToBlock).toHaveBeenCalledWith(hoveredBlock, 'start');
      expect(fixture.moveAndOpenToolbar).toHaveBeenCalledWith(hoveredBlock);
      expect(fixture.onFocusBlockCaptured).toHaveBeenCalledWith(null, null);
    });

    it('creates a block below a non-empty hovered block', () => {
      const hoveredBlock = createBlock({ text: 'abc',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        currentBlock: null,
        hoveredBlockIndex: 2,
        currentBlockIndex: 5 });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(3, true, false, true);
      expect(fixture.setToBlock).toHaveBeenCalledWith(fixture.insertedBlock, 'start');
      expect(fixture.moveAndOpenToolbar).toHaveBeenCalledWith(fixture.insertedBlock);
      expect(fixture.openToolboxWithoutSlash).toHaveBeenCalledTimes(1);
      expect(fixture.onFocusBlockCaptured).toHaveBeenCalledWith(null, fixture.insertedBlock);
    });

    it('reuses an empty focused block nested inside a non-empty hovered block', () => {
      const hoveredHolder = topLevelHolder();
      const nestedChildHolder = document.createElement('div');

      hoveredHolder.appendChild(nestedChildHolder);

      const hoveredBlock = createBlock({ name: 'table',
        text: 'x',
        parentId: 'P',
        holder: hoveredHolder });
      const currentBlock = createBlock({ isEmpty: true,
        parentId: 'Q',
        holder: nestedChildHolder });
      const fixture = setup({ hoveredBlock,
        currentBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
      expect(fixture.setToBlock).toHaveBeenCalledWith(currentBlock, 'start');
      expect(fixture.setBlockParent).not.toHaveBeenCalled();
    });

    it('ignores an empty focused block that sits outside the hovered block', () => {
      const hoveredBlock = createBlock({ text: 'x',
        holder: topLevelHolder() });
      const currentBlock = createBlock({ isEmpty: true,
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        currentBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
    });

    it('ignores an empty focused block when nothing is hovered', () => {
      const currentBlock = createBlock({ isEmpty: true,
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock: null,
        currentBlock,
        hoveredBlockIndex: 2,
        currentBlockIndex: 5 });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(6, true, false, true);
    });
  });

  describe('handleClick() — focus capture', () => {
    it('reports the block that owns the focused element', () => {
      const input = document.createElement('input');

      document.body.appendChild(input);
      input.focus();

      const focusedBlock = createBlock();
      const hoveredBlock = createBlock({ text: 'x',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        focusedBlock });

      fixture.handler.handleClick();

      expect(fixture.getBlockByChildNode).toHaveBeenCalledWith(input);
      expect(fixture.onFocusBlockCaptured).toHaveBeenCalledWith(focusedBlock, fixture.insertedBlock);
    });

    it('reports no focused block when the document has no active element', () => {
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);

      const focusedBlock = createBlock();
      const hoveredBlock = createBlock({ text: 'x',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        focusedBlock });

      fixture.handler.handleClick();

      expect(fixture.getBlockByChildNode).not.toHaveBeenCalled();
      expect(fixture.onFocusBlockCaptured).toHaveBeenCalledWith(null, fixture.insertedBlock);
    });

    it('works without a focus-capture callback', () => {
      const hoveredBlock = createBlock({ text: 'x',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        captureFocus: false });

      expect(() => fixture.handler.handleClick()).not.toThrow();
      expect(fixture.openToolboxWithoutSlash).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleClick() — insert index', () => {
    /** Hovered block at flat index 0 owning `childCount` trailing child blocks. */
    const subtreeFixture = (childCount: number, trailingSiblings: number) => {
      const hoveredHolder = topLevelHolder();
      const hoveredBlock = createBlock({ text: 'x',
        holder: hoveredHolder });
      const children = Array.from({ length: childCount }, () => {
        const childHolder = document.createElement('div');

        hoveredHolder.appendChild(childHolder);

        return createBlock({ text: 'c',
          holder: childHolder });
      });
      const siblings = Array.from({ length: trailingSiblings }, () => createBlock({ text: 's',
        holder: topLevelHolder() }));

      return { hoveredBlock,
        blocks: [hoveredBlock, ...children, ...siblings] };
    };

    it('skips past the hovered block own nested children', () => {
      const { hoveredBlock, blocks } = subtreeFixture(2, 1);
      const fixture = setup({ hoveredBlock,
        blocks,
        hoveredBlockIndex: 0 });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(3, true, false, true);
    });

    it('lands after the last block when every follower is inside the subtree', () => {
      const { hoveredBlock, blocks } = subtreeFixture(2, 0);
      const fixture = setup({ hoveredBlock,
        blocks,
        hoveredBlockIndex: 0 });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(3, true, false, true);
    });

    it('does not skip the subtree when inserting above', () => {
      const { hoveredBlock, blocks } = subtreeFixture(2, 1);
      const leadingBlock = createBlock({ text: 'lead',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        blocks: [leadingBlock, ...blocks],
        hoveredBlockIndex: 1 });

      fixture.handler.handleClick(true);

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(1, true, false, true);
    });
  });

  describe('handleClick() — top-level flag', () => {
    it('asks for a top-level insert next to a top-level hovered block', () => {
      const hoveredBlock = createBlock({ text: 'x',
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(1, true, false, true);
    });

    it('asks for a nested insert next to a nested hovered block', () => {
      const hoveredBlock = createBlock({ text: 'x',
        holder: nestedHolder() });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(1, true, false, false);
    });

    it('treats a detached hovered holder as nested', () => {
      const hoveredBlock = createBlock({ text: 'x',
        holder: document.createElement('div') });
      const fixture = setup({ hoveredBlock });

      fixture.handler.handleClick();

      expect(fixture.insertDefaultBlockAtIndex).toHaveBeenCalledWith(1, true, false, false);
    });
  });

  describe('handleClick() — reparenting the new block', () => {
    it('moves the new block into the hovered block parent', () => {
      const hoveredBlock = createBlock({ text: 'x',
        parentId: 'P',
        holder: nestedHolder() });
      const fixture = setup({ hoveredBlock,
        insertedBlock: createBlock({ isEmpty: true,
          parentId: null }) });

      fixture.handler.handleClick();

      expect(fixture.setBlockParent).toHaveBeenCalledWith(fixture.insertedBlock, 'P');
    });

    it('skips the reparent when the hovered block is top-level', () => {
      const hoveredBlock = createBlock({ text: 'x',
        parentId: null,
        holder: topLevelHolder() });
      const fixture = setup({ hoveredBlock,
        insertedBlock: createBlock({ isEmpty: true,
          parentId: 'X' }) });

      fixture.handler.handleClick();

      expect(fixture.setBlockParent).not.toHaveBeenCalled();
    });

    it('skips the reparent when the new block already has the same parent', () => {
      const hoveredBlock = createBlock({ text: 'x',
        parentId: 'P',
        holder: nestedHolder() });
      const fixture = setup({ hoveredBlock,
        insertedBlock: createBlock({ isEmpty: true,
          parentId: 'P' }) });

      fixture.handler.handleClick();

      expect(fixture.setBlockParent).not.toHaveBeenCalled();
    });
  });
});
