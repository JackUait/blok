import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockEvents } from '../../../../src/components/modules/blockEvents';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokEventMap } from '../../../../src/components/events';
import type { Block } from '../../../../src/components/block';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import { keyCodes } from '../../../../src/components/utils';

/**
 * Minimal tool-adapter stub exposing only the flags `slashPressed` inspects
 * when deciding whether a block is "text-like".
 */
interface ToolFlags {
  isDefault: boolean;
  isLineBreaksEnabled: boolean;
  enabledInlineTools: boolean | string[];
}

const createBlockEvents = (currentBlock: Block | undefined, overrides: {
  insertContentAtCaretPosition?: ReturnType<typeof vi.fn>;
  toolboxOpen?: ReturnType<typeof vi.fn>;
  moveAndOpen?: ReturnType<typeof vi.fn>;
  wrapper?: HTMLElement;
} = {}): BlockEvents => {
  const blockEvents = new BlockEvents({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  const wrapper = overrides.wrapper ?? document.createElement('div');

  const state: Partial<BlokModules> = {
    Toolbar: {
      opened: false,
      close: vi.fn(),
      hideBlockActions: vi.fn(),
      moveAndOpen: overrides.moveAndOpen ?? vi.fn(),
      discardPlusContext: vi.fn(),
      toolbox: {
        open: overrides.toolboxOpen ?? vi.fn(),
        opened: false,
      },
    } as unknown as BlokModules['Toolbar'],
    BlockSelection: {
      anyBlockSelected: false,
      clearSelection: vi.fn(),
      selectedBlocks: [],
    } as unknown as BlokModules['BlockSelection'],
    BlockManager: {
      currentBlock,
      setCurrentBlockByChildNode: vi.fn(),
    } as unknown as BlokModules['BlockManager'],
    Caret: {
      insertContentAtCaretPosition: overrides.insertContentAtCaretPosition ?? vi.fn(),
    } as unknown as BlokModules['Caret'],
    UI: {
      nodes: { wrapper },
      checkEmptiness: vi.fn(),
    } as unknown as BlokModules['UI'],
    BlockSettings: {
      opened: false,
      open: vi.fn(),
      contains: vi.fn(() => false),
    } as unknown as BlokModules['BlockSettings'],
    CrossBlockSelection: {
      textSelection: null,
      clearTextSelection: vi.fn(),
    } as unknown as BlokModules['CrossBlockSelection'],
    YjsManager: {
      stopCapturing: vi.fn(),
      startSubStep: vi.fn(),
    } as unknown as BlokModules['YjsManager'],
  };

  blockEvents.state = state as BlokModules;

  return blockEvents;
};

const createSlashEvent = (target: Node): KeyboardEvent => {
  return {
    keyCode: keyCodes.SLASH,
    key: '/',
    code: 'Slash',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    target,
  } as unknown as KeyboardEvent;
};

const createBlock = (flags: ToolFlags): Block => {
  return {
    tool: flags as unknown as BlockToolAdapter,
  } as unknown as Block;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BlockEvents slash gate (Notion parity)', () => {
  const setup = (block: Block | undefined): {
    blockEvents: BlockEvents;
    event: KeyboardEvent;
    insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
    toolboxOpen: ReturnType<typeof vi.fn>;
  } => {
    const wrapper = document.createElement('div');
    const target = document.createElement('div');

    wrapper.appendChild(target);
    document.body.appendChild(wrapper);

    const insertContentAtCaretPosition = vi.fn();
    const toolboxOpen = vi.fn();
    const blockEvents = createBlockEvents(block, {
      insertContentAtCaretPosition,
      toolboxOpen,
      wrapper,
    });

    return { blockEvents, event: createSlashEvent(target), insertContentAtCaretPosition, toolboxOpen };
  };

  it('does NOT open the toolbox in a block that manages its own line breaks (e.g. code)', () => {
    const block = createBlock({ isDefault: false, isLineBreaksEnabled: true, enabledInlineTools: true });
    const { blockEvents, event, insertContentAtCaretPosition, toolboxOpen } = setup(block);

    blockEvents.keydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(toolboxOpen).not.toHaveBeenCalled();
  });

  it('does NOT open the toolbox in a block that opts out of the inline toolbar (non-text block)', () => {
    const block = createBlock({ isDefault: false, isLineBreaksEnabled: false, enabledInlineTools: false });
    const { blockEvents, event, insertContentAtCaretPosition, toolboxOpen } = setup(block);

    blockEvents.keydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(toolboxOpen).not.toHaveBeenCalled();
  });

  it('opens the toolbox in the default (paragraph) block', () => {
    const block = createBlock({ isDefault: true, isLineBreaksEnabled: false, enabledInlineTools: true });
    const { blockEvents, event, insertContentAtCaretPosition, toolboxOpen } = setup(block);

    blockEvents.keydown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(insertContentAtCaretPosition).toHaveBeenCalledWith('/');
    expect(toolboxOpen).toHaveBeenCalledTimes(1);
  });

  it('opens the toolbox in a header/list block (inline toolbar, no line breaks)', () => {
    const block = createBlock({ isDefault: false, isLineBreaksEnabled: false, enabledInlineTools: true });
    const { blockEvents, event, insertContentAtCaretPosition, toolboxOpen } = setup(block);

    blockEvents.keydown(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(insertContentAtCaretPosition).toHaveBeenCalledWith('/');
    expect(toolboxOpen).toHaveBeenCalledTimes(1);
  });

  // Notion U060 ("Beta/") and U173 ("x/"): "/" right after a letter stays plain text.
  describe('the character before the caret', () => {
    const setupWithText = (html: string): ReturnType<typeof setup> & { input: HTMLElement } => {
      const block = createBlock({ isDefault: true, isLineBreaksEnabled: false, enabledInlineTools: true });
      const result = setup(block);
      const input = result.event.target as HTMLElement;

      input.setAttribute('contenteditable', 'true');
      input.innerHTML = html;

      const range = document.createRange();

      range.selectNodeContents(input);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      return { ...result, input };
    };

    it('types "/" as text after a letter, without opening the toolbox', () => {
      const { blockEvents, event, insertContentAtCaretPosition, toolboxOpen } = setupWithText('Beta');

      blockEvents.keydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
      expect(toolboxOpen).not.toHaveBeenCalled();
    });

    it('sees a letter at the end of a bold run before the caret', () => {
      const { blockEvents, event, toolboxOpen } = setupWithText('Al<b>pha</b>');

      blockEvents.keydown(event);

      expect(toolboxOpen).not.toHaveBeenCalled();
    });

    it('sees a non-Latin letter', () => {
      const { blockEvents, event, toolboxOpen } = setupWithText('Бета');

      blockEvents.keydown(event);

      expect(toolboxOpen).not.toHaveBeenCalled();
    });

    it('still opens the toolbox after a space', () => {
      const { blockEvents, event, toolboxOpen } = setupWithText('Beta ');

      blockEvents.keydown(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(toolboxOpen).toHaveBeenCalledTimes(1);
    });

    // A Shift+Enter line break starts a new line; range text hides the <br>.
    it('opens the toolbox right after a line break, caret in the container after the <br>', () => {
      const { blockEvents, event, toolboxOpen } = setupWithText('Beta<br>');

      blockEvents.keydown(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(toolboxOpen).toHaveBeenCalledTimes(1);
    });

    it('opens the toolbox right after a line break, caret at the start of the text after the <br>', () => {
      const { blockEvents, event, input, toolboxOpen } = setupWithText('Beta<br>x');
      const range = document.createRange();
      const after = input.lastChild;

      if (after === null) {
        throw new Error('no text after the break');
      }
      range.setStart(after, 0);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      blockEvents.keydown(event);

      expect(toolboxOpen).toHaveBeenCalledTimes(1);
    });

    it('still sees a letter typed after a line break', () => {
      const { blockEvents, event, toolboxOpen } = setupWithText('Beta<br>Gam<b>ma</b>');

      blockEvents.keydown(event);

      expect(toolboxOpen).not.toHaveBeenCalled();
    });

    it('still opens the toolbox at the start of the text', () => {
      const { blockEvents, event, input, toolboxOpen } = setupWithText('Beta');
      const range = document.createRange();

      range.setStart(input, 0);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      blockEvents.keydown(event);

      expect(toolboxOpen).toHaveBeenCalledTimes(1);
    });
  });
});
