/**
 * Unit tests for PlusButtonHandler.handleClick().
 *
 * Key behaviors:
 * - Clicking "+" on an empty paragraph opens toolbox WITHOUT inserting "/".
 * - Clicking "+" on a paragraph that already starts with "/" keeps slash behavior.
 * - Typing "/" in an empty block still works as before (handled by blockEvents, not tested here).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlusButtonHandler } from '../../../../src/components/modules/toolbar/plus-button';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';

// ─── helpers ────────────────────────────────────────────────────────────────

vi.mock('../../../../src/components/selection/index', () => ({
  SelectionUtils: {
    get: vi.fn(() => ({ removeAllRanges: vi.fn() })),
  },
}));

vi.mock('../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('../../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string) => document.createElement(tag)),
  },
}));

vi.mock('../../../../src/components/utils', () => ({
  getUserOS: vi.fn(() => ({ win: false })),
}));

function createBlock(overrides: Partial<{
  name: string;
  isEmpty: boolean;
  textContent: string | null;
  holder: HTMLElement;
}> = {}): Block {
  const holder = overrides.holder ?? document.createElement('div');
  const content = document.createElement('div');

  content.textContent = overrides.textContent ?? '';
  holder.appendChild(content);

  return {
    name: overrides.name ?? 'paragraph',
    isEmpty: overrides.isEmpty ?? true,
    holder,
    pluginsContent: content,
    cleanupDraggable: vi.fn(),
  } as unknown as Block;
}

function createHandler(
  hoveredBlock: Block | null,
  blokOverrides: Partial<BlokModules> = {}
): {
  handler: PlusButtonHandler;
  callbacks: {
    getToolboxOpened: ReturnType<typeof vi.fn>;
    openToolbox: ReturnType<typeof vi.fn>;
    openToolboxWithoutSlash: ReturnType<typeof vi.fn>;
    closeToolbox: ReturnType<typeof vi.fn>;
    moveAndOpenToolbar: ReturnType<typeof vi.fn>;
  };
} {
  const callbacks = {
    getToolboxOpened: vi.fn(() => false),
    openToolbox: vi.fn(),
    openToolboxWithoutSlash: vi.fn(),
    closeToolbox: vi.fn(),
    moveAndOpenToolbar: vi.fn(),
  };

  const insertedBlock = createBlock({ isEmpty: true });
  const defaultBlok: Partial<BlokModules> = {
    BlockSettings: { opened: false, close: vi.fn() } as unknown as BlokModules['BlockSettings'],
    BlockSelection: {
      anyBlockSelected: false,
      clearSelection: vi.fn(),
    } as unknown as BlokModules['BlockSelection'],
    BlockManager: {
      getBlockIndex: vi.fn(() => 0),
      currentBlockIndex: 0,
      blocks: hoveredBlock ? [hoveredBlock] : [],
      insertDefaultBlockAtIndex: vi.fn(() => insertedBlock),
    } as unknown as BlokModules['BlockManager'],
    Caret: {
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
      positions: { DEFAULT: 'default', START: 'start' },
    } as unknown as BlokModules['Caret'],
  };

  const blok = { ...defaultBlok, ...blokOverrides } as BlokModules;

  const handler = new PlusButtonHandler(
    () => blok,
    callbacks
  );

  handler.setHoveredBlock(hoveredBlock);

  return { handler, callbacks };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('PlusButtonHandler.handleClick — plus button opens toolbox without slash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls openToolboxWithoutSlash (not openToolbox) for an empty paragraph', () => {
    const emptyParagraph = createBlock({ name: 'paragraph', isEmpty: true, textContent: '' });
    const { handler, callbacks } = createHandler(emptyParagraph);

    handler.handleClick();

    expect(callbacks.openToolboxWithoutSlash).toHaveBeenCalledTimes(1);
    expect(callbacks.openToolbox).not.toHaveBeenCalled();
    // Block content must stay empty — no "/" was injected
    expect(emptyParagraph.pluginsContent.textContent).toBe('');
  });

  it('does NOT insert "/" into the block when opening for a new empty paragraph', () => {
    const emptyParagraph = createBlock({ name: 'paragraph', isEmpty: true, textContent: '' });
    const blokCaret = {
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
      positions: { DEFAULT: 'default', START: 'start' },
    };
    const { handler } = createHandler(emptyParagraph, {
      Caret: blokCaret as unknown as BlokModules['Caret'],
    });

    handler.handleClick();

    expect(blokCaret.insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('calls openToolbox (with slash) for a paragraph that already starts with "/"', () => {
    const slashParagraph = createBlock({ name: 'paragraph', isEmpty: false, textContent: '/' });
    const { handler, callbacks } = createHandler(slashParagraph);

    handler.handleClick();

    expect(callbacks.openToolbox).toHaveBeenCalledTimes(1);
    expect(callbacks.openToolboxWithoutSlash).not.toHaveBeenCalled();
    // Existing "/" must be preserved in the block
    expect(slashParagraph.pluginsContent.textContent).toBe('/');
  });

  it('closes toolbox if already open instead of reopening', () => {
    const emptyParagraph = createBlock({ name: 'paragraph', isEmpty: true, textContent: '' });
    const { handler, callbacks } = createHandler(emptyParagraph);

    callbacks.getToolboxOpened.mockReturnValue(true);

    handler.handleClick();

    expect(callbacks.closeToolbox).toHaveBeenCalledTimes(1);
    expect(callbacks.openToolbox).not.toHaveBeenCalled();
    expect(callbacks.openToolboxWithoutSlash).not.toHaveBeenCalled();
    // Block content must be untouched when closing
    expect(emptyParagraph.pluginsContent.textContent).toBe('');
  });
});
