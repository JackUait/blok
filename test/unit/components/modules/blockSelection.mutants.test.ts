import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockSelection } from '../../../../src/components/modules/blockSelection';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';
import type {
  CrossBlockSubRange,
  CrossBlockTextSelection,
} from '../../../../src/components/selection/cross-block-range';
import { SelectionUtils } from '../../../../src/components/selection';
import { Shortcuts } from '../../../../src/components/utils/shortcuts';
import { announce } from '../../../../src/components/utils/announcer';
import { TOOL_NAME as LIST_TOOL_NAME } from '../../../../src/tools/list/constants';
import type { ToolboxConfigEntry } from '../../../../types';

vi.mock('../../../../src/components/utils/announcer', () => ({
  announce: vi.fn(),
}));

type BlockStubOptions = {
  id?: string;
  name?: string;
  html?: string;
  text?: string;
  inputs?: HTMLElement[];
  parentId?: string | null;
  contentIds?: string[];
  focusable?: boolean;
  isEmpty?: boolean;
  selected?: boolean;
  preservedData?: Record<string, unknown>;
  activeToolboxEntry?: Promise<ToolboxConfigEntry | undefined>;
};

type BlockStub = Block & {
  /** Counts every write to `selected`, so "the setter never ran" is assertable. */
  selectedWrites: number;
};

type ClipboardDataStub = { setData: ReturnType<typeof vi.fn> };

type BlockManagerStub = {
  blocks: Block[];
  currentBlock: Block | null;
  currentBlockIndex: number;
  getBlockByIndex: ReturnType<typeof vi.fn>;
  getBlock: ReturnType<typeof vi.fn>;
  getBlockById: ReturnType<typeof vi.fn>;
  getBlockDepth: ReturnType<typeof vi.fn>;
  deleteSelectedBlocksAndInsertReplacement: ReturnType<typeof vi.fn>;
};

type Setup = {
  blockSelection: BlockSelection;
  modules: BlokModules;
  blockManager: BlockManagerStub;
  blocks: Block[];
  redactor: HTMLDivElement;
  pressCmdA: (target: EventTarget | null, key?: string) => KeyboardEvent;
};

const createDeferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });

  return { promise,
    resolve: settle };
};

const createBlockStub = (options: BlockStubOptions = {}): BlockStub => {
  const holder = document.createElement('div');

  holder.innerHTML = options.html ?? '<p>Sample text</p>';
  holder.scrollIntoView = vi.fn();

  const pluginsContent = document.createElement('div');

  pluginsContent.textContent = options.text ?? 'Sample text';

  let isSelected = options.selected ?? false;

  const stub = {
    holder,
    pluginsContent,
    inputs: options.inputs ?? [ document.createElement('div') ],
    id: options.id ?? 'block-1',
    name: options.name ?? 'paragraph',
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    focusable: options.focusable ?? true,
    isEmpty: options.isEmpty ?? false,
    preservedData: options.preservedData ?? { text: 'Sample text' },
    preservedTunes: {},
    selectedWrites: 0,
    save: vi.fn(),
    getActiveToolboxEntry: vi.fn(() => options.activeToolboxEntry ?? Promise.resolve(undefined)),
  };

  Object.defineProperty(stub, 'selected', {
    configurable: true,
    enumerable: true,
    get(): boolean {
      return isSelected;
    },
    set(nextState: boolean) {
      stub.selectedWrites += 1;
      isSelected = nextState;
    },
  });

  return stub as unknown as BlockStub;
};

const createSetup = (options: { blocks?: Block[]; currentBlock?: Block | null } = {}): Setup => {
  const redactor = document.createElement('div');
  const blocks = options.blocks ?? [
    createBlockStub({ id: 'b0',
      text: 'First' }),
    createBlockStub({ id: 'b1',
      text: 'Second' }),
    createBlockStub({ id: 'b2',
      text: 'Third' }),
  ];

  const blockManager: BlockManagerStub = {
    blocks,
    currentBlock: options.currentBlock === undefined ? blocks[0] : options.currentBlock,
    currentBlockIndex: 0,
    getBlockByIndex: vi.fn((index: number) => blocks[index]),
    getBlock: vi.fn((element: HTMLElement) => blocks.find((block) => block.holder === element) ?? null),
    getBlockById: vi.fn((id: string) => blocks.find((block) => block.id === id) ?? undefined),
    getBlockDepth: vi.fn(() => 0),
    deleteSelectedBlocksAndInsertReplacement: vi.fn(() => undefined),
  };

  const modules = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: {
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
      positions: { END: 'end' },
    } as unknown as BlokModules['Caret'],
    RectangleSelection: {
      clearSelection: vi.fn(),
      isRectActivated: vi.fn(() => false),
    } as unknown as BlokModules['RectangleSelection'],
    CrossBlockSelection: {
      clear: vi.fn(),
    } as unknown as BlokModules['CrossBlockSelection'],
    InlineToolbar: {
      close: vi.fn(),
    } as unknown as BlokModules['InlineToolbar'],
    Toolbar: {
      close: vi.fn(),
      moveAndOpenForMultipleBlocks: vi.fn(),
    } as unknown as BlokModules['Toolbar'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as BlokModules['ReadOnly'],
    UI: {
      nodes: { redactor },
    } as unknown as BlokModules['UI'],
    Paste: {
      MIME_TYPE: 'application/x-blok',
    } as unknown as BlokModules['Paste'],
    I18n: {
      // Encodes the interpolation vars into the returned string so a test can
      // assert the announced position/total without reading i18n internals.
      t: vi.fn((key: string, vars?: Record<string, string | number>) => (
        vars === undefined ? key : `${key}|${JSON.stringify(vars)}`
      )),
      has: vi.fn(() => false),
    } as unknown as BlokModules['I18n'],
  } as unknown as BlokModules;

  const blockSelection = new BlockSelection({
    config: { sanitizer: {} },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  blockSelection.state = modules;

  const shortcutsAdd = vi.spyOn(Shortcuts, 'add').mockImplementation(() => undefined);

  blockSelection.prepare();

  const { handler } = shortcutsAdd.mock.calls[0][0];

  const pressCmdA = (target: EventTarget | null, key = 'a'): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key,
      cancelable: true });

    Object.defineProperty(event, 'target', { value: target,
      configurable: true });

    handler(event);

    return event;
  };

  return { blockSelection,
    modules,
    blockManager,
    blocks,
    redactor,
    pressCmdA };
};

const createClipboardEvent = (clipboardData: ClipboardDataStub | null): {
  event: ClipboardEvent;
  preventDefault: ReturnType<typeof vi.fn>;
} => {
  const preventDefault = vi.fn();
  const event = { preventDefault,
    clipboardData } as unknown as ClipboardEvent;

  return { event,
    preventDefault };
};

const setDataCalls = (clipboardData: ClipboardDataStub, type: string): string[] =>
  clipboardData.setData.mock.calls
    .filter((call) => call[0] === type)
    .map((call) => String(call[1]));

const htmlWritten = (clipboardData: ClipboardDataStub): string => setDataCalls(clipboardData, 'text/html')[0] ?? '';

const plainWritten = (clipboardData: ClipboardDataStub): string => setDataCalls(clipboardData, 'text/plain')[0] ?? '';

const announcements = (): string[] => vi.mocked(announce).mock.calls.map((call) => String(call[0]));

const positionAnnouncements = (): string[] =>
  announcements().filter((message) => message.startsWith('a11y.navigationPosition'));

const makeSubRange = (
  block: Block,
  options: { coversWholeInput: boolean; collapsed?: boolean }
): CrossBlockSubRange => {
  const input = block.inputs[0];
  const range = document.createRange();

  range.selectNodeContents(input);

  if (options.collapsed === true) {
    range.collapse(true);
  }

  return { block,
    input,
    range,
    coversWholeInput: options.coversWholeInput };
};

const makeCrossBlockSelection = (subRanges: CrossBlockSubRange[]): CrossBlockTextSelection => ({
  range: subRanges[0].range,
  subRanges,
  startBlock: subRanges[0].block,
  endBlock: subRanges[subRanges.length - 1].block,
});

/**
 * A block whose editing host is attached to the document, so a Range over it
 * yields real text. `text` fills the host; `html` fills the holder.
 */
const createHostedBlock = (options: BlockStubOptions & { hostHtml: string }): BlockStub => {
  const input = document.createElement('div');

  input.innerHTML = options.hostHtml;
  document.body.appendChild(input);

  return createBlockStub({ ...options,
    inputs: [ input ] });
};

describe('BlockSelection — surviving mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fake timers for the whole file: a navigation announcement schedules a
    // 300 ms timeout, and a real one left pending by an earlier test fires
    // inside a later async test and pollutes its announcement ledger.
    vi.useFakeTimers();
    // No native selection is the ordinary state; the module guards every
    // `SelectionUtils.get()` with `?.`, so a null here is what proves the guard.
    vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
    vi.spyOn(SelectionUtils, 'isSelectionExists', 'get').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  describe('CMD+A shortcut wiring', () => {
    it('does nothing at all when focus is outside this editor (no current Block)', () => {
      const { blocks, pressCmdA } = createSetup({ currentBlock: null });

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);

      expect(blocks.some((block) => block.selected)).toBe(false);
    });

    it('escalates to the Block when a current Block exists', () => {
      const { blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);

      expect(blocks[0].selected).toBe(true);
    });

    it('selects every Block and prevents the native selection in read-only mode', () => {
      const setup = createSetup();

      Object.defineProperty(setup.modules.ReadOnly, 'isEnabled', {
        value: true,
        configurable: true,
      });

      const event = setup.pressCmdA(setup.blocks[0].holder);

      expect(setup.blocks.every((block) => block.selected)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the first press to the native text selection when not read-only', () => {
      const { blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);

      expect(blocks.some((block) => block.selected)).toBe(false);
    });

    it('ignores a press whose target belongs to no Block', () => {
      const { blocks, pressCmdA } = createSetup();
      const stray = document.createElement('div');

      expect(() => pressCmdA(stray)).not.toThrow();
      expect(blocks.some((block) => block.selected)).toBe(false);
    });
  });

  describe('unSelectBlockByIndex', () => {
    it('ignores an index that resolves to no Block', () => {
      const { blockSelection } = createSetup();

      expect(() => blockSelection.unSelectBlockByIndex(99)).not.toThrow();
    });

    it('clears the anyBlockSelected cache so the next read sees the unselection', () => {
      const { blockSelection, blocks } = createSetup();

      blocks[0].selected = true;
      expect(blockSelection.anyBlockSelected).toBe(true);

      blockSelection.unSelectBlockByIndex(0);

      expect(blockSelection.anyBlockSelected).toBe(false);
    });
  });

  describe('selectBlock', () => {
    it('selects the Block and refreshes the cache when there is no native selection', () => {
      const { blockSelection, blocks } = createSetup();

      expect(blockSelection.anyBlockSelected).toBe(false);

      blockSelection.selectBlock(blocks[1]);

      expect(blocks[1].selected).toBe(true);
      expect(blockSelection.anyBlockSelected).toBe(true);
    });
  });

  describe('toggleReadOnly', () => {
    it('unselects every Block when there is no native selection to remove', () => {
      const { blockSelection, blocks } = createSetup();

      blocks[0].selected = true;

      blockSelection.toggleReadOnly();

      expect(blocks.some((block) => block.selected)).toBe(false);
    });
  });

  describe('clearSelection', () => {
    it('does not restore the saved selection unless asked to', () => {
      const { blockSelection } = createSetup();
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore');

      blockSelection.clearSelection(new MouseEvent('mousedown'));

      expect(restore).not.toHaveBeenCalled();
    });

    it('restores the saved selection when asked to', () => {
      const { blockSelection } = createSetup();
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore');

      blockSelection.clearSelection(new MouseEvent('mousedown'), true);

      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('touches no Block when nothing is selected', () => {
      const { blockSelection, blocks } = createSetup();
      const stubs = blocks as BlockStub[];

      blockSelection.clearSelection(new MouseEvent('mousedown'));

      expect(stubs.map((block) => block.selectedWrites)).toEqual([ 0, 0, 0 ]);
    });

    it('does not replace the selection for a non-printable key', () => {
      const { blockSelection, blocks, blockManager } = createSetup();

      blocks[0].selected = true;

      blockSelection.clearSelection(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(blockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('does not replace anything for a non-keyboard event that happens to carry a key', () => {
      const { blockSelection, blocks, blockManager } = createSetup();

      blocks[0].selected = true;

      blockSelection.clearSelection(Object.assign(new Event('input'), { key: 'x' }));

      expect(blockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('does not replace anything when no Block is selected', () => {
      const { blockSelection, blockManager } = createSetup();

      blockSelection.clearSelection(new KeyboardEvent('keydown', { key: 'x' }));

      expect(blockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('replaces the selected Blocks with a printable key', () => {
      const { blockSelection, blocks, blockManager } = createSetup();

      blocks[0].selected = true;

      blockSelection.clearSelection(new KeyboardEvent('keydown', { key: 'x' }));

      expect(blockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledWith(true);
    });

    it('leaves the caret alone when the replacement Block could not be created', () => {
      const { blockSelection, blocks, modules } = createSetup();

      blocks[0].selected = true;

      blockSelection.clearSelection(new KeyboardEvent('keydown', { key: 'x' }));

      expect(modules.Caret.setToBlock).not.toHaveBeenCalled();
    });

    it('re-runs the container stage after the selection was cleared', () => {
      const container = createBlockStub({ id: 'container',
        contentIds: [ 'c1', 'c2' ] });
      const c1 = createBlockStub({ id: 'c1',
        parentId: 'container' });
      const c2 = createBlockStub({ id: 'c2',
        parentId: 'container' });
      const root = createBlockStub({ id: 'root' });
      const { blockSelection, pressCmdA } = createSetup({ blocks: [ container, c1, c2, root ] });

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      blockSelection.clearSelection(new MouseEvent('mousedown'));

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      pressCmdA(c1.holder);

      expect(blockSelection.allBlocksSelected).toBe(false);
      expect(c2.selected).toBe(true);
    });

    it('re-runs the subtree stage after the selection was cleared', () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'kid' ] });
      const kid = createBlockStub({ id: 'kid',
        parentId: 'parent' });
      const other = createBlockStub({ id: 'other' });
      const { blockSelection, pressCmdA } = createSetup({ blocks: [ parent, kid, other ] });

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      blockSelection.clearSelection(new MouseEvent('mousedown'));

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      pressCmdA(parent.holder);

      expect(other.selected).toBe(false);
      expect(kid.selected).toBe(true);
    });
  });

  describe('copySelectedBlocks', () => {
    it('stops before touching a missing clipboard', async () => {
      const { blockSelection, blocks } = createSetup();
      const { event, preventDefault } = createClipboardEvent(null);

      blocks[0].selected = true;

      await expect(blockSelection.copySelectedBlocks(event)).resolves.toBeUndefined();
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it('warns with the failing message when the custom MIME type is rejected', async () => {
      const { blockSelection, blocks, modules } = createSetup();
      const mimeType = (modules.Paste as unknown as { MIME_TYPE: string }).MIME_TYPE;
      const clipboardData: ClipboardDataStub = {
        setData: vi.fn((type: string) => {
          if (type === mimeType) {
            throw new Error('nope');
          }
        }),
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { event } = createClipboardEvent(clipboardData);

      blocks[0].selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(warn).toHaveBeenCalledWith('Failed to set custom clipboard data:', 'nope');
    });

    it('stays quiet when the clipboard rejection is not an Error', async () => {
      const { blockSelection, blocks, modules } = createSetup();
      const mimeType = (modules.Paste as unknown as { MIME_TYPE: string }).MIME_TYPE;
      const clipboardData: ClipboardDataStub = {
        setData: vi.fn((type: string) => {
          if (type === mimeType) {
            throw 'nope';
          }
        }),
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { event } = createClipboardEvent(clipboardData);

      blocks[0].selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(warn).not.toHaveBeenCalled();
    });

    it('wraps bare text in a paragraph', async () => {
      const block = createBlockStub({ html: 'plain' });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<p>plain</p>');
    });

    it('does not wrap whitespace-only content in a paragraph', async () => {
      const block = createBlockStub({ html: '   ' });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).not.toContain('<p>');
    });

    it('does not wrap content that already has an element child', async () => {
      const block = createBlockStub({ html: '<b>bold</b> tail' });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<b>bold</b> tail');
    });

    it('keeps line breaks in the copied HTML', async () => {
      const block = createBlockStub({ html: '<p>a<br>b</p>' });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toContain('<br>');
    });

    it('keeps header-cell colspan and rowspan in the copied grid', async () => {
      const block = createBlockStub({
        html: '<table><tr><th colspan="2" rowspan="3">H</th></tr></table>',
      });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      const html = htmlWritten(clipboardData);

      expect(html).toContain('colspan="2"');
      expect(html).toContain('rowspan="3"');
    });

    it('keeps data-cell rowspan in the copied grid', async () => {
      const block = createBlockStub({
        html: '<table><tr><td rowspan="4">D</td></tr></table>',
      });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toContain('rowspan="4"');
    });

    it('emits one semantic list for a run of consecutive list Blocks', async () => {
      const first = createBlockStub({ id: 'l1',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Alpha',
          style: 'unordered' } });
      const second = createBlockStub({ id: 'l2',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Beta',
          style: 'unordered' } });
      const { blockSelection } = createSetup({ blocks: [ first, second ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      first.selected = true;
      second.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<ul><li>Alpha</li><li>Beta</li></ul>');
    });

    it('opens a new list when a neighbour carries a different style', async () => {
      const first = createBlockStub({ id: 'l1',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Alpha',
          style: 'unordered' } });
      const second = createBlockStub({ id: 'l2',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Beta',
          style: 'sparkly' } });
      const { blockSelection } = createSetup({ blocks: [ first, second ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      first.selected = true;
      second.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<ul><li>Alpha</li><li>Beta</li></ul>');
    });

    it('emits an ordered list for an ordered list Block', async () => {
      const block = createBlockStub({ name: LIST_TOOL_NAME,
        preservedData: { text: 'Alpha',
          style: 'ordered' } });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<ol><li>Alpha</li></ol>');
    });

    it('emits a checkbox for a checklist list Block', async () => {
      const block = createBlockStub({ name: LIST_TOOL_NAME,
        preservedData: { text: 'Alpha',
          style: 'checklist',
          checked: true } });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toContain('type="checkbox"');
    });

    it('emits an empty item when the list Block has no string text', async () => {
      const block = createBlockStub({ name: LIST_TOOL_NAME,
        preservedData: { text: 42,
          style: 'unordered' } });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      block.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<ul><li></li></ul>');
    });

    it('nests a deeper list item inside its predecessor', async () => {
      const first = createBlockStub({ id: 'l1',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Alpha',
          style: 'unordered',
          depth: 0 } });
      const second = createBlockStub({ id: 'l2',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Beta',
          style: 'unordered',
          depth: 1 } });
      const { blockSelection } = createSetup({ blocks: [ first, second ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      first.selected = true;
      second.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<ul><li>Alpha<ul><li>Beta</li></ul></li></ul>');
    });

    it('treats a non-numeric depth as the top level', async () => {
      const first = createBlockStub({ id: 'l1',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Alpha',
          style: 'unordered' } });
      const second = createBlockStub({ id: 'l2',
        name: LIST_TOOL_NAME,
        preservedData: { text: 'Beta',
          style: 'unordered',
          depth: 'deep' } });
      const { blockSelection } = createSetup({ blocks: [ first, second ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      first.selected = true;
      second.selected = true;

      await blockSelection.copySelectedBlocks(event);

      expect(htmlWritten(clipboardData)).toBe('<ul><li>Alpha</li><li>Beta</li></ul>');
    });

    it('serializes a Block and its children exactly once each', async () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'kid' ] });
      const kid = createBlockStub({ id: 'kid',
        parentId: 'parent' });
      const { blockSelection, modules } = createSetup({ blocks: [ parent, kid ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      parent.selected = true;
      kid.selected = true;

      await blockSelection.copySelectedBlocks(event);

      const mimeType = (modules.Paste as unknown as { MIME_TYPE: string }).MIME_TYPE;
      const payload: unknown = JSON.parse(setDataCalls(clipboardData, mimeType)[0]);

      expect(Array.isArray(payload) ? payload.length : -1).toBe(2);
    });

    it('survives a contentIds entry that points at no Block', async () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'ghost' ] });
      const { blockSelection } = createSetup({ blocks: [ parent ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);

      parent.selected = true;

      await expect(blockSelection.copySelectedBlocks(event)).resolves.toBeUndefined();
    });
  });

  describe('copySelectedBlocksAsMarkdown', () => {
    const stubClipboard = (value: unknown): void => {
      Object.defineProperty(navigator, 'clipboard', { value,
        configurable: true,
        writable: true });
    };

    it('copies the current Block when nothing is selected', async () => {
      const writeText = vi.fn();
      const { blockSelection } = createSetup();

      stubClipboard({ writeText });

      await blockSelection.copySelectedBlocksAsMarkdown();

      expect(writeText).toHaveBeenCalledWith('Sample text');
    });

    it('writes nothing when nothing is selected and there is no current Block', async () => {
      const writeText = vi.fn();
      const { blockSelection } = createSetup({ currentBlock: null });

      stubClipboard({ writeText });

      await expect(blockSelection.copySelectedBlocksAsMarkdown()).resolves.toBeUndefined();
      expect(writeText).not.toHaveBeenCalled();
    });

    it('does nothing when the platform exposes no clipboard', async () => {
      const { blockSelection } = createSetup();

      stubClipboard(undefined);

      await expect(blockSelection.copySelectedBlocksAsMarkdown()).resolves.toBeUndefined();
    });

    it('does nothing when the clipboard cannot write text', async () => {
      const { blockSelection } = createSetup();

      stubClipboard({});

      await expect(blockSelection.copySelectedBlocksAsMarkdown()).resolves.toBeUndefined();
    });
  });

  describe('copyCrossBlockTextSelection', () => {
    it('stops before touching a missing clipboard', () => {
      const block = createHostedBlock({ hostHtml: 'Alpha' });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const { event, preventDefault } = createClipboardEvent(null);
      const selection = makeCrossBlockSelection([ makeSubRange(block, { coversWholeInput: true }) ]);

      expect(() => blockSelection.copyCrossBlockTextSelection(event, selection)).not.toThrow();
      expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it('emits one semantic list for two wholly covered list Blocks', () => {
      const first = createHostedBlock({ id: 'l1',
        name: LIST_TOOL_NAME,
        hostHtml: 'Alpha',
        preservedData: { text: 'Alpha',
          style: 'unordered' } });
      const second = createHostedBlock({ id: 'l2',
        name: LIST_TOOL_NAME,
        hostHtml: 'Beta',
        preservedData: { text: 'Beta',
          style: 'unordered' } });
      const { blockSelection } = createSetup({ blocks: [ first, second ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);
      const selection = makeCrossBlockSelection([
        makeSubRange(first, { coversWholeInput: true }),
        makeSubRange(second, { coversWholeInput: true }),
      ]);

      blockSelection.copyCrossBlockTextSelection(event, selection);

      expect(htmlWritten(clipboardData)).toBe('<ul><li>Alpha</li><li>Beta</li></ul>');
      expect(plainWritten(clipboardData)).toBe('Alpha\n\nBeta');
    });

    it('keeps a wholly covered non-list Block as itself', () => {
      const heading = createHostedBlock({ id: 'h',
        name: 'header',
        html: '<h2>Title</h2>',
        hostHtml: 'Title' });
      const { blockSelection } = createSetup({ blocks: [ heading ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);
      const selection = makeCrossBlockSelection([ makeSubRange(heading, { coversWholeInput: true }) ]);

      blockSelection.copyCrossBlockTextSelection(event, selection);

      expect(htmlWritten(clipboardData)).toBe('<h2>Title</h2>');
    });

    it('emits a paragraph for a partially covered Block', () => {
      const block = createHostedBlock({ id: 'p',
        html: '<h2>Title</h2>',
        hostHtml: 'Partial' });
      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);
      const selection = makeCrossBlockSelection([ makeSubRange(block, { coversWholeInput: false }) ]);

      blockSelection.copyCrossBlockTextSelection(event, selection);

      expect(htmlWritten(clipboardData)).toBe('<p>Partial</p>');
    });

    it('keeps both a partial end and the whole Block that follows it', () => {
      const partial = createHostedBlock({ id: 'p',
        html: '<h2>Head</h2>',
        hostHtml: 'Partial' });
      const whole = createHostedBlock({ id: 'w',
        html: '<h3>Whole</h3>',
        hostHtml: 'Whole' });
      const { blockSelection } = createSetup({ blocks: [ partial, whole ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);
      const selection = makeCrossBlockSelection([
        makeSubRange(partial, { coversWholeInput: false }),
        makeSubRange(whole, { coversWholeInput: true }),
      ]);

      blockSelection.copyCrossBlockTextSelection(event, selection);

      expect(htmlWritten(clipboardData)).toBe('<p>Partial</p><h3>Whole</h3>');
    });

    it('treats a multi-input Block as partial even when its host is wholly covered', () => {
      const extraInput = document.createElement('div');
      const block = createHostedBlock({ id: 'multi',
        html: '<h2>Title</h2>',
        hostHtml: 'Cell' });

      block.inputs.push(extraInput);

      const { blockSelection } = createSetup({ blocks: [ block ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);
      const selection = makeCrossBlockSelection([ makeSubRange(block, { coversWholeInput: true }) ]);

      blockSelection.copyCrossBlockTextSelection(event, selection);

      expect(htmlWritten(clipboardData)).toBe('<p>Cell</p>');
    });

    it('drops a host the selection only touches', () => {
      const first = createHostedBlock({ id: 'a',
        html: '<h2>Alpha</h2>',
        hostHtml: 'Alpha' });
      const empty = createHostedBlock({ id: 'b',
        html: '<h3>Beta</h3>',
        hostHtml: 'Beta' });
      const { blockSelection } = createSetup({ blocks: [ first, empty ] });
      const clipboardData: ClipboardDataStub = { setData: vi.fn() };
      const { event } = createClipboardEvent(clipboardData);
      const selection = makeCrossBlockSelection([
        makeSubRange(first, { coversWholeInput: true }),
        makeSubRange(empty, { coversWholeInput: true,
          collapsed: true }),
      ]);

      blockSelection.copyCrossBlockTextSelection(event, selection);

      expect(htmlWritten(clipboardData)).toBe('<h2>Alpha</h2>');
      expect(plainWritten(clipboardData)).toBe('Alpha');
    });
  });

  describe('Cmd+A escalation', () => {
    it('prevents the native selection on the Block stage', () => {
      const { blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);

      const second = pressCmdA(blocks[0].holder);

      expect(second.defaultPrevented).toBe(true);
    });

    it('prevents the native selection on the all-Blocks stage', () => {
      const { blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);

      const third = pressCmdA(blocks[0].holder);

      expect(third.defaultPrevented).toBe(true);
    });

    it('prevents the native selection when an empty Block skips the text stage', () => {
      const block = createBlockStub({ isEmpty: true });
      const { pressCmdA } = createSetup({ blocks: [ block ] });

      const first = pressCmdA(block.holder);

      expect(first.defaultPrevented).toBe(true);
      expect(block.selected).toBe(true);
    });

    it('prevents the native selection once every Block is already selected', () => {
      const { blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);

      const terminal = pressCmdA(blocks[0].holder);

      expect(terminal.defaultPrevented).toBe(true);
    });

    it('restarts at the text stage after the all-Blocks stage', () => {
      const { blockSelection, blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      blockSelection.unselectBlock(blocks[0]);

      pressCmdA(blocks[0].holder);

      expect(blocks[0].selected).toBe(false);
    });

    it('needs two more presses to re-select a Block after the all-Blocks stage', () => {
      const { blockSelection, blocks, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      blockSelection.unselectBlock(blocks[0]);

      pressCmdA(blocks[0].holder);
      vi.mocked(announce).mockClear();
      pressCmdA(blocks[0].holder);

      expect(announcements().some((message) => message.startsWith('a11y.allBlocksSelected'))).toBe(false);
      expect(blocks[0].selected).toBe(true);
    });

    it('runs the container stage again after the all-Blocks stage', () => {
      const container = createBlockStub({ id: 'container',
        contentIds: [ 'c1', 'c2' ] });
      const c1 = createBlockStub({ id: 'c1',
        parentId: 'container' });
      const c2 = createBlockStub({ id: 'c2',
        parentId: 'container' });
      const root = createBlockStub({ id: 'root' });
      const { blockSelection, pressCmdA } = createSetup({ blocks: [ container, c1, c2, root ] });

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      blockSelection.unselectBlock(root);

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      pressCmdA(c1.holder);

      expect(blockSelection.allBlocksSelected).toBe(false);
    });

    it('runs the subtree stage again after the all-Blocks stage', () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'kid' ] });
      const kid = createBlockStub({ id: 'kid',
        parentId: 'parent' });
      const other = createBlockStub({ id: 'other' });
      const { blockSelection, pressCmdA } = createSetup({ blocks: [ parent, kid, other ] });

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      blockSelection.unselectBlock(other);

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      pressCmdA(parent.holder);

      expect(other.selected).toBe(false);
      expect(kid.selected).toBe(true);
    });
  });

  describe('subtree stage', () => {
    const createSubtreeSetup = (): Setup & { parent: BlockStub; kid: BlockStub; other: BlockStub } => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'kid' ] });
      const kid = createBlockStub({ id: 'kid',
        parentId: 'parent' });
      const other = createBlockStub({ id: 'other' });
      const setup = createSetup({ blocks: [ parent, kid, other ] });

      return { ...setup,
        parent,
        kid,
        other };
    };

    it('selects the Block and its descendants only', () => {
      const { parent, kid, other, pressCmdA } = createSubtreeSetup();

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      pressCmdA(parent.holder);

      expect(parent.selected).toBe(true);
      expect(kid.selected).toBe(true);
      expect(other.selected).toBe(false);
    });

    it('saves the native selection before replacing it', () => {
      const { parent, pressCmdA } = createSubtreeSetup();
      const save = vi.spyOn(SelectionUtils.prototype, 'save');

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      save.mockClear();

      pressCmdA(parent.holder);

      expect(save).toHaveBeenCalledTimes(1);
    });

    it('refreshes the anyBlockSelected cache', () => {
      const { blockSelection, parent, pressCmdA } = createSubtreeSetup();

      pressCmdA(parent.holder);
      expect(blockSelection.anyBlockSelected).toBe(false);
      pressCmdA(parent.holder);
      blockSelection.unselectBlock(parent);
      expect(blockSelection.anyBlockSelected).toBe(false);

      pressCmdA(parent.holder);

      expect(blockSelection.anyBlockSelected).toBe(true);
    });

    it('closes the inline toolbar and opens the multi-Block toolbar', () => {
      const { modules, parent, pressCmdA } = createSubtreeSetup();

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      vi.mocked(modules.InlineToolbar.close).mockClear();
      vi.mocked(modules.Toolbar.moveAndOpenForMultipleBlocks).mockClear();

      pressCmdA(parent.holder);

      expect(modules.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(modules.Toolbar.moveAndOpenForMultipleBlocks).toHaveBeenCalledTimes(1);
    });

    it('survives a child id that points at no Block', () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'ghost' ] });
      const { pressCmdA } = createSetup({ blocks: [ parent ] });

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);

      expect(() => pressCmdA(parent.holder)).not.toThrow();
    });

    it('stays silent when the stage widened the selection to a single Block', () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'ghost' ] });
      const { pressCmdA } = createSetup({ blocks: [ parent ] });

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      vi.mocked(announce).mockClear();

      pressCmdA(parent.holder);

      expect(announcements().some((message) => message.startsWith('a11y.blocksSelected'))).toBe(false);
    });

    it('announces how many Blocks the stage selected', () => {
      const { parent, pressCmdA } = createSubtreeSetup();

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      vi.mocked(announce).mockClear();

      pressCmdA(parent.holder);

      expect(announcements()).toContain('a11y.blocksSelected|{"count":2}');
    });
  });

  describe('container stage', () => {
    const createContainerSetup = (): Setup & { c1: BlockStub; c2: BlockStub; root: BlockStub } => {
      const container = createBlockStub({ id: 'container',
        contentIds: [ 'c1', 'c2' ] });
      const c1 = createBlockStub({ id: 'c1',
        parentId: 'container' });
      const c2 = createBlockStub({ id: 'c2',
        parentId: 'container' });
      const root = createBlockStub({ id: 'root' });
      const setup = createSetup({ blocks: [ container, c1, c2, root ] });

      return { ...setup,
        c1,
        c2,
        root };
    };

    it('selects the container siblings only', () => {
      const { c1, c2, root, pressCmdA } = createContainerSetup();

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      pressCmdA(c1.holder);

      expect(c1.selected).toBe(true);
      expect(c2.selected).toBe(true);
      expect(root.selected).toBe(false);
    });

    it('saves the native selection before replacing it', () => {
      const { c1, pressCmdA } = createContainerSetup();
      const save = vi.spyOn(SelectionUtils.prototype, 'save');

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      save.mockClear();

      pressCmdA(c1.holder);

      expect(save).toHaveBeenCalledTimes(1);
    });

    it('refreshes the anyBlockSelected cache', () => {
      const { blockSelection, c1, pressCmdA } = createContainerSetup();

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      blockSelection.unselectBlock(c1);
      expect(blockSelection.anyBlockSelected).toBe(false);

      pressCmdA(c1.holder);

      expect(blockSelection.anyBlockSelected).toBe(true);
    });

    it('closes the inline toolbar and opens the multi-Block toolbar', () => {
      const { modules, c1, pressCmdA } = createContainerSetup();

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      vi.mocked(modules.InlineToolbar.close).mockClear();
      vi.mocked(modules.Toolbar.moveAndOpenForMultipleBlocks).mockClear();

      pressCmdA(c1.holder);

      expect(modules.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(modules.Toolbar.moveAndOpenForMultipleBlocks).toHaveBeenCalledTimes(1);
    });

    it('survives a container whose parent Block is gone', () => {
      const orphan = createBlockStub({ id: 'orphan',
        parentId: 'ghost' });
      const { pressCmdA } = createSetup({ blocks: [ orphan ] });

      pressCmdA(orphan.holder);
      pressCmdA(orphan.holder);

      expect(() => pressCmdA(orphan.holder)).not.toThrow();
    });

    it('survives a container child id that points at no Block', () => {
      const container = createBlockStub({ id: 'container',
        contentIds: [ 'c1', 'ghost' ] });
      const c1 = createBlockStub({ id: 'c1',
        parentId: 'container' });
      const { pressCmdA } = createSetup({ blocks: [ container, c1 ] });

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);

      expect(() => pressCmdA(c1.holder)).not.toThrow();
    });

    it('announces how many Blocks the stage selected', () => {
      const { c1, pressCmdA } = createContainerSetup();

      pressCmdA(c1.holder);
      pressCmdA(c1.holder);
      vi.mocked(announce).mockClear();

      pressCmdA(c1.holder);

      expect(announcements()).toContain('a11y.blocksSelected|{"count":2}');
    });
  });

  describe('all-Blocks stage', () => {
    it('saves the native selection before replacing it', () => {
      const { blocks, pressCmdA } = createSetup();
      const save = vi.spyOn(SelectionUtils.prototype, 'save');

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      save.mockClear();

      pressCmdA(blocks[0].holder);

      expect(save).toHaveBeenCalledTimes(1);
    });

    it('closes the inline toolbar and opens the multi-Block toolbar', () => {
      const { blocks, modules, pressCmdA } = createSetup();

      pressCmdA(blocks[0].holder);
      pressCmdA(blocks[0].holder);
      vi.mocked(modules.InlineToolbar.close).mockClear();
      vi.mocked(modules.Toolbar.moveAndOpenForMultipleBlocks).mockClear();

      pressCmdA(blocks[0].holder);

      expect(modules.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(modules.Toolbar.moveAndOpenForMultipleBlocks).toHaveBeenCalledTimes(1);
    });
  });

  describe('isBlockFullySelected', () => {
    const stubNativeSelection = (text: string): void => {
      const selection = {
        isCollapsed: false,
        rangeCount: 1,
        removeAllRanges: vi.fn(),
        toString: () => text,
      };

      vi.mocked(SelectionUtils.get).mockReturnValue(selection as unknown as Selection);
    };

    it('promotes to Block selection when the whole text is already selected', () => {
      const block = createBlockStub({ text: 'a b' });
      const { pressCmdA } = createSetup({ blocks: [ block ] });

      stubNativeSelection('a b');

      pressCmdA(block.holder);

      expect(block.selected).toBe(true);
    });

    it('ignores leading and trailing whitespace when comparing', () => {
      const block = createBlockStub({ text: 'a b' });
      const { pressCmdA } = createSetup({ blocks: [ block ] });

      stubNativeSelection('  a b  ');

      pressCmdA(block.holder);

      expect(block.selected).toBe(true);
    });

    it('collapses runs of whitespace when comparing', () => {
      const block = createBlockStub({ text: 'a  b' });
      const { pressCmdA } = createSetup({ blocks: [ block ] });

      stubNativeSelection('a b');

      pressCmdA(block.holder);

      expect(block.selected).toBe(true);
    });

    it('does not promote when the selected text differs from the Block text', () => {
      const block = createBlockStub({ text: 'a b' });
      const { pressCmdA } = createSetup({ blocks: [ block ] });

      stubNativeSelection('ab');

      pressCmdA(block.holder);

      expect(block.selected).toBe(false);
    });

    it('does not promote a Block whose text is empty', () => {
      const block = createBlockStub({ text: '',
        isEmpty: false });
      const { pressCmdA } = createSetup({ blocks: [ block ] });

      stubNativeSelection('');

      pressCmdA(block.holder);

      expect(block.selected).toBe(false);
    });

    it('does not promote while the caret is collapsed', () => {
      const block = createBlockStub({ text: 'a b' });
      const { pressCmdA } = createSetup({ blocks: [ block ] });
      const selection = {
        isCollapsed: true,
        rangeCount: 1,
        removeAllRanges: vi.fn(),
        toString: () => 'a b',
      };

      vi.mocked(SelectionUtils.get).mockReturnValue(selection as unknown as Selection);

      pressCmdA(block.holder);

      expect(block.selected).toBe(false);
    });
  });

  describe('adoptSelectionIntoNavigationMode', () => {
    it('adopts a single focusable selection at the first Block', () => {
      const { blockSelection, blocks } = createSetup();

      blocks[0].selected = true;

      expect(blockSelection.adoptSelectionIntoNavigationMode()).toBe(true);
      expect(blockSelection.navigationModeEnabled).toBe(true);
      expect(blockSelection.navigationFocusedBlock).toBe(blocks[0]);
    });

    it('refuses a selection of more than one Block', () => {
      const { blockSelection, blocks } = createSetup();

      blocks[0].selected = true;
      blocks[1].selected = true;

      expect(blockSelection.adoptSelectionIntoNavigationMode()).toBe(false);
      expect(blockSelection.navigationModeEnabled).toBe(false);
    });

    it('refuses a single non-focusable selection', () => {
      const block = createBlockStub({ focusable: false });
      const { blockSelection } = createSetup({ blocks: [ block ] });

      block.selected = true;

      expect(blockSelection.adoptSelectionIntoNavigationMode()).toBe(false);
      expect(blockSelection.navigationModeEnabled).toBe(false);
    });

    it('reports success without re-reading the selection once navigation mode is on', () => {
      const block = createBlockStub({ focusable: false });
      const { blockSelection } = createSetup({ blocks: [ block ] });

      blockSelection.enableNavigationMode();

      expect(blockSelection.adoptSelectionIntoNavigationMode()).toBe(true);
    });
  });

  describe('navigationFocusedBlock', () => {
    it('asks for no Block while navigation mode is off', () => {
      const { blockSelection, blockManager } = createSetup();

      expect(blockSelection.navigationFocusedBlock).toBeUndefined();
      expect(blockManager.getBlockByIndex).not.toHaveBeenCalled();
    });

    it('asks for no Block while navigation mode has no focus yet', () => {
      const { blockSelection, blockManager } = createSetup({ blocks: [] });

      blockManager.currentBlockIndex = -1;
      blockSelection.enableNavigationMode();
      blockManager.getBlockByIndex.mockClear();

      expect(blockSelection.navigationFocusedBlock).toBeUndefined();
      expect(blockManager.getBlockByIndex).not.toHaveBeenCalled();
    });
  });

  describe('navigation mode', () => {
    it('forgets the focus index when navigation mode ends without a Block', () => {
      const { blockSelection, blockManager } = createSetup({ blocks: [] });

      blockSelection.enableNavigationMode();
      blockSelection.disableNavigationMode();
      blockSelection.enableNavigationMode();
      blockManager.getBlockByIndex.mockClear();

      expect(blockSelection.navigationFocusedBlock).toBeUndefined();
      expect(blockManager.getBlockByIndex).not.toHaveBeenCalled();
    });

    it('survives entering navigation mode with no Blocks at all', () => {
      const { blockSelection } = createSetup({ blocks: [] });

      expect(() => blockSelection.enableNavigationMode()).not.toThrow();
    });

    it('survives leaving navigation mode that never landed on a Block', () => {
      const { blockSelection } = createSetup({ blocks: [] });

      blockSelection.enableNavigationMode();

      expect(() => blockSelection.disableNavigationMode()).not.toThrow();
    });

    it('says nothing when navigation mode was never on', () => {
      const { blockSelection } = createSetup();

      blockSelection.disableNavigationMode();

      expect(announcements()).not.toContain('a11y.navigationModeExited');
    });

    it('marks the focused Block as the current one for assistive technology', () => {
      const { blockSelection, blocks } = createSetup();

      blockSelection.enableNavigationMode();

      expect(blocks[0].holder.getAttribute('aria-current')).toBe('true');
    });

    it('drops the marker from the Block the focus left', () => {
      const { blockSelection, blocks } = createSetup();

      blockSelection.enableNavigationMode();
      blockSelection.navigateNext();

      expect(blocks[0].holder.hasAttribute('aria-current')).toBe(false);
    });

    it('drops the marker when navigation mode ends', () => {
      const { blockSelection, blocks } = createSetup();

      blockSelection.enableNavigationMode();
      blockSelection.disableNavigationMode();

      expect(blocks[0].holder.hasAttribute('aria-current')).toBe(false);
    });

    it('scrolls the focused Block into view without jumping the page', () => {
      const { blockSelection, blocks } = createSetup();

      blockSelection.enableNavigationMode();

      expect(blocks[0].holder.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      });
    });

    it('blurs whatever the browser was focusing', () => {
      const input = document.createElement('input');

      document.body.appendChild(input);
      input.focus();

      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();

      expect(input).not.toHaveFocus();
    });

    it('refreshes the anyBlockSelected cache when focus lands', () => {
      const { blockSelection } = createSetup();

      expect(blockSelection.anyBlockSelected).toBe(false);

      blockSelection.enableNavigationMode();

      expect(blockSelection.anyBlockSelected).toBe(true);
    });

    it('refreshes the anyBlockSelected cache when navigation mode ends', () => {
      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();
      expect(blockSelection.anyBlockSelected).toBe(true);

      blockSelection.disableNavigationMode();

      expect(blockSelection.anyBlockSelected).toBe(false);
    });

    it('primes Cmd+A so one press after Escape selects every Block', () => {
      const { blockSelection, blocks, pressCmdA } = createSetup();

      blockSelection.enableNavigationMode();

      pressCmdA(blocks[0].holder);

      expect(blockSelection.allBlocksSelected).toBe(true);
    });
  });

  describe('navigation position announcements', () => {
    it('announces the tool, position and total of the focused Block', async () => {
      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();
      blockSelection.navigateNext();

      await vi.advanceTimersByTimeAsync(300);

      expect(positionAnnouncements()).toEqual([
        'a11y.navigationPosition|{"tool":"paragraph","position":2,"total":3}',
      ]);
    });

    it('announces the active toolbox entry title when the tool exposes one', async () => {
      const block = createBlockStub({
        id: 'b0',
        activeToolboxEntry: Promise.resolve({ title: 'Heading 2' } as ToolboxConfigEntry),
      });
      const { blockSelection } = createSetup({ blocks: [ block ] });

      blockSelection.enableNavigationMode();

      await vi.advanceTimersByTimeAsync(300);

      expect(positionAnnouncements()).toEqual([
        'a11y.navigationPosition|{"tool":"Heading 2","position":1,"total":1}',
      ]);
    });

    it('does not resolve a tool name for a position it already announced', async () => {
      const { blockSelection, blocks } = createSetup();

      blockSelection.enableNavigationMode();
      blockSelection.navigateNext();
      await vi.advanceTimersByTimeAsync(300);

      vi.mocked(blocks[1].getActiveToolboxEntry).mockClear();
      blockSelection.navigateNext();
      blockSelection.navigatePrevious();
      await vi.advanceTimersByTimeAsync(300);

      expect(blocks[1].getActiveToolboxEntry).not.toHaveBeenCalled();
    });

    it('does not announce a position the focus has already left', async () => {
      const pending = createDeferred<ToolboxConfigEntry | undefined>();
      const slow = createBlockStub({ id: 'b0',
        activeToolboxEntry: pending.promise });
      const fast = createBlockStub({ id: 'b1' });
      const { blockSelection } = createSetup({ blocks: [ slow, fast ] });

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(300);

      blockSelection.navigateNext();
      pending.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(positionAnnouncements()).toEqual([]);
    });

    it('does not announce a position whose Block was replaced meanwhile', async () => {
      const pending = createDeferred<ToolboxConfigEntry | undefined>();
      const original = createBlockStub({ id: 'b0',
        activeToolboxEntry: pending.promise });
      const { blockSelection, blockManager } = createSetup({ blocks: [ original ] });

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(300);

      blockManager.blocks[0] = createBlockStub({ id: 'replacement' });
      pending.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(positionAnnouncements()).toEqual([]);
    });

    it('does not announce a position after navigation mode was left', async () => {
      const pending = createDeferred<ToolboxConfigEntry | undefined>();
      const block = createBlockStub({ id: 'b0',
        activeToolboxEntry: pending.promise });
      const { blockSelection } = createSetup({ blocks: [ block ] });

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(300);

      blockSelection.disableNavigationMode();
      pending.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(positionAnnouncements()).toEqual([]);
    });

    it('does not announce a Block that vanished before the throttle window closed', async () => {
      const { blockSelection, blockManager } = createSetup();

      blockSelection.enableNavigationMode();
      blockSelection.navigateNext();
      blockManager.getBlockByIndex.mockReturnValue(undefined);

      await vi.advanceTimersByTimeAsync(300);

      expect(positionAnnouncements()).toEqual([]);
    });

    it('announces the same position again after navigation mode was re-entered', async () => {
      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(300);
      blockSelection.disableNavigationMode();

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(300);

      expect(positionAnnouncements()).toHaveLength(2);
    });

    it('restarts the throttle window when navigation mode is re-entered', async () => {
      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(100);
      blockSelection.disableNavigationMode();
      blockSelection.enableNavigationMode();

      await vi.advanceTimersByTimeAsync(200);

      expect(positionAnnouncements()).toEqual([]);

      await vi.advanceTimersByTimeAsync(100);

      expect(positionAnnouncements()).toHaveLength(1);
    });

    it('keeps one throttle timer in flight across a rapid run', async () => {
      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(100);
      blockSelection.navigateNext();
      await vi.advanceTimersByTimeAsync(200);
      blockSelection.navigateNext();
      await vi.advanceTimersByTimeAsync(100);

      expect(positionAnnouncements()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(200);

      expect(positionAnnouncements()).toHaveLength(2);
    });

    it('does not announce a position twice when two resolutions race for it', async () => {
      const first = createDeferred<ToolboxConfigEntry | undefined>();
      const second = createDeferred<ToolboxConfigEntry | undefined>();
      const target = createBlockStub({ id: 'b0' });
      const neighbour = createBlockStub({ id: 'b1' });
      const { blockSelection } = createSetup({ blocks: [ target, neighbour ] });

      vi.mocked(target.getActiveToolboxEntry)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(300);

      blockSelection.navigateNext();
      blockSelection.navigatePrevious();
      await vi.advanceTimersByTimeAsync(300);

      first.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
      second.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(positionAnnouncements()).toHaveLength(1);
    });

    it('collapses a rapid run of moves into one announcement', async () => {
      const { blockSelection } = createSetup();

      blockSelection.enableNavigationMode();
      await vi.advanceTimersByTimeAsync(100);
      blockSelection.navigateNext();
      await vi.advanceTimersByTimeAsync(100);
      blockSelection.navigateNext();

      await vi.advanceTimersByTimeAsync(400);

      expect(positionAnnouncements()).toEqual([
        'a11y.navigationPosition|{"tool":"paragraph","position":3,"total":3}',
      ]);
    });
  });

  describe('stage and focus guards', () => {
    it('skips a subtree child id that points at no Block while other Blocks are still unselected', () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'kid', 'ghost' ] });
      const kid = createBlockStub({ id: 'kid',
        parentId: 'parent' });
      const other = createBlockStub({ id: 'other' });
      const { pressCmdA } = createSetup({ blocks: [ parent, kid, other ] });

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);

      // A second unselected Block keeps `allBlocksSelected` false, so the third
      // press reaches the subtree stage instead of the terminal no-op.
      expect(() => pressCmdA(parent.holder)).not.toThrow();
      expect(parent.selected).toBe(true);
      expect(kid.selected).toBe(true);
      expect(other.selected).toBe(false);
    });

    it('abandons the container stage when the parent Block is gone', () => {
      const orphan = createBlockStub({ id: 'orphan',
        parentId: 'ghost' });
      const other = createBlockStub({ id: 'other' });
      const { pressCmdA, modules } = createSetup({ blocks: [ orphan, other ] });

      pressCmdA(orphan.holder);
      pressCmdA(orphan.holder);
      vi.mocked(modules.InlineToolbar.close).mockClear();

      expect(() => pressCmdA(orphan.holder)).not.toThrow();
      expect(other.selected).toBe(false);
      expect(modules.InlineToolbar.close).not.toHaveBeenCalled();
    });

    it('stays silent when the subtree stage selected nothing beyond the Block itself', () => {
      const parent = createBlockStub({ id: 'parent',
        contentIds: [ 'ghost' ] });
      const other = createBlockStub({ id: 'other' });
      const { pressCmdA } = createSetup({ blocks: [ parent, other ] });

      pressCmdA(parent.holder);
      pressCmdA(parent.holder);
      vi.mocked(announce).mockClear();

      pressCmdA(parent.holder);

      expect(announcements()).toEqual([]);
    });

    it('never writes the selection off the Block it is about to focus', () => {
      const { blockSelection, blocks } = createSetup();

      blocks[0].selected = true;

      blockSelection.adoptSelectionIntoNavigationMode();

      // One write for the test's own setup, one for the focus. A third means the
      // Block was unselected and re-selected while the move was in flight.
      // selectedWrites is the fixture's own counter, not part of Block.
      expect((blocks[0] as unknown as { selectedWrites?: number }).selectedWrites).toBe(2);
    });

    it('blurs only an element that is an HTML element', () => {
      const { blockSelection } = createSetup();
      const blur = vi.fn();

      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => ({ blur }),
      });

      try {
        blockSelection.enableNavigationMode();

        expect(blur).not.toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(document, 'activeElement');
      }
    });

    it('does not promote a selection that holds no range', () => {
      const block = createBlockStub({ text: 'a b' });
      const { pressCmdA } = createSetup({ blocks: [ block ] });
      const selection = {
        isCollapsed: false,
        rangeCount: 0,
        removeAllRanges: vi.fn(),
        toString: () => 'a b',
      };

      vi.mocked(SelectionUtils.get).mockReturnValue(selection as unknown as Selection);

      pressCmdA(block.holder);

      expect(block.selected).toBe(false);
    });

    it('does not reject when the pending Block vanished before the announcement', async () => {
      const { blockSelection, blockManager } = createSetup();
      const rejections: unknown[] = [];
      const record = (reason: unknown): void => {
        rejections.push(reason);
      };

      process.on('unhandledRejection', record);

      try {
        blockSelection.enableNavigationMode();
        blockSelection.navigateNext();
        blockManager.getBlockByIndex.mockReturnValue(undefined);

        await vi.advanceTimersByTimeAsync(300);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      } finally {
        process.off('unhandledRejection', record);
      }

      expect(rejections).toEqual([]);
    });
  });
});
