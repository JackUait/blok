import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { BlockAPI as BlockAPIConstructor } from '../../../../src/components/block/api';
import type { Block } from '../../../../src/components/block';
import type { API as ApiModules } from '../../../../src/components/modules/api';
import type { BlockToolData, ToolConfig, ToolboxConfigEntry } from '../../../../types/tools';
import type { SavedData } from '../../../../types/data-formats';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { BlockAPI as BlockAPIInterface } from '../../../../types/api';

type MockBlockShape = {
  id: string;
  name: string;
  config: ToolConfig;
  holder: HTMLElement;
  isEmpty: boolean;
  selected: boolean;
  stretched: boolean;
  focusable: boolean;
  parentId: string | null;
  preservedData: BlockToolData;
  preservedTunes: { [name: string]: BlockTuneData };
  setStretchState: (state: boolean) => void;
  call: (methodName: string, param?: Record<string, unknown>) => unknown;
  save: () => Promise<void | SavedData>;
  validate: (data: BlockToolData) => Promise<boolean>;
  dispatchChange: () => void;
  getActiveToolboxEntry: () => Promise<ToolboxConfigEntry | undefined>;
};

const createMockBlock = (): {
  block: Block;
  shape: MockBlockShape;
  mocks: {
    setStretchState: Mock<MockBlockShape['setStretchState']>;
    call: Mock<MockBlockShape['call']>;
    save: Mock<MockBlockShape['save']>;
    validate: Mock<MockBlockShape['validate']>;
    dispatchChange: Mock<MockBlockShape['dispatchChange']>;
    getActiveToolboxEntry: Mock<MockBlockShape['getActiveToolboxEntry']>;
  };
  config: ToolConfig;
  holder: HTMLElement;
  savedData: SavedData;
  toolboxEntry: ToolboxConfigEntry;
  preservedData: BlockToolData;
  preservedTunes: { [name: string]: BlockTuneData };
} => {
  const holder = document.createElement('div');
  const config: ToolConfig = { placeholder: 'Test placeholder' };
  const savedData: SavedData = {
    id: 'block-id',
    tool: 'paragraph',
    data: { text: 'saved text' },
    time: 42,
  };
  const toolboxEntry: ToolboxConfigEntry = {
    title: 'Paragraph',
    icon: '<svg></svg>',
    data: { preset: 'default' },
  };

  const callMock = vi.fn<MockBlockShape['call']>()
    .mockReturnValue('call-result');
  const saveMock = vi.fn<MockBlockShape['save']>()
    .mockResolvedValue(savedData);
  const validateMock = vi.fn<MockBlockShape['validate']>()
    .mockResolvedValue(true);
  const dispatchChangeMock = vi.fn<MockBlockShape['dispatchChange']>();
  const getActiveToolboxEntryMock = vi.fn<MockBlockShape['getActiveToolboxEntry']>()
    .mockResolvedValue(toolboxEntry);
  const setStretchStateMock = vi.fn<MockBlockShape['setStretchState']>();

  const preservedData: BlockToolData = { text: 'preserved text' };
  const preservedTunes: { [name: string]: BlockTuneData } = { alignment: { align: 'center' } };

  const shape: MockBlockShape = {
    id: 'block-id',
    name: 'paragraph',
    config,
    holder,
    isEmpty: false,
    selected: false,
    stretched: false,
    focusable: true,
    parentId: null,
    preservedData,
    preservedTunes,
    setStretchState: (state: boolean) => {
      shape.stretched = state;
    },
    call: callMock,
    save: saveMock,
    validate: validateMock,
    dispatchChange: dispatchChangeMock,
    getActiveToolboxEntry: getActiveToolboxEntryMock,
  };

  shape.setStretchState = setStretchStateMock.mockImplementation((state: boolean) => {
    shape.stretched = state;
  });

  return {
    block: shape as unknown as Block,
    shape,
    mocks: {
      setStretchState: setStretchStateMock,
      call: callMock,
      save: saveMock,
      validate: validateMock,
      dispatchChange: dispatchChangeMock,
      getActiveToolboxEntry: getActiveToolboxEntryMock,
    },
    config,
    holder,
    savedData,
    toolboxEntry,
    preservedData,
    preservedTunes,
  };
};

/**
 * The editor API is now a REQUIRED constructor argument (a BlockAPI built
 * without it silently answered [] from getChildren and no-op'd on mutations).
 * Tests that only exercise the block-facing surface pass this inert stub; the
 * hierarchy suite below builds a real one via `makeApi`.
 */
const apiStub = { methods: { blocks: {} } } as unknown as ApiModules;

describe('BlockAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes block metadata and state properties', () => {
    const { block, config, holder, shape } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    expect(blockAPI.id).toBe(shape.id);
    expect(blockAPI.name).toBe(shape.name);
    expect(blockAPI.config).toBe(config);
    expect(blockAPI.holder).toBe(holder);
    expect(blockAPI.isEmpty).toBe(shape.isEmpty);
    expect(blockAPI.selected).toBe(shape.selected);
    expect(blockAPI.focusable).toBe(shape.focusable);
    expect(blockAPI.stretched).toBe(shape.stretched);
  });

  it('updates stretch state through setter and reflects changes', () => {
    const { block, shape, mocks } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    blockAPI.stretched = true;

    expect(mocks.setStretchState).toHaveBeenCalledWith(true);
    expect(shape.stretched).toBe(true);
    expect(blockAPI.stretched).toBe(true);
  });

  it('delegates method calls to the underlying block', async () => {
    const { block, mocks, savedData, toolboxEntry } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block, apiStub);
    const callParams = { value: 123 };
    const methodName = 'method';
    const validationData = { text: 'validate' } as BlockToolData;

    const callResult = blockAPI.call(methodName, callParams);
    const saveResult = await blockAPI.save();
    const validationResult = await blockAPI.validate(validationData);

    blockAPI.dispatchChange();
    const activeToolboxEntry = await blockAPI.getActiveToolboxEntry();

    expect(mocks.call).toHaveBeenCalledWith(methodName, callParams);
    expect(callResult).toBe('call-result');

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(saveResult).toBe(savedData);

    expect(mocks.validate).toHaveBeenCalledWith(validationData);
    expect(validationResult).toBe(true);

    expect(mocks.dispatchChange).toHaveBeenCalledTimes(1);

    expect(mocks.getActiveToolboxEntry).toHaveBeenCalledTimes(1);
    expect(activeToolboxEntry).toBe(toolboxEntry);
  });

  it('returns the block preservedData for synchronous access to cached tool data', () => {
    const { block, preservedData } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    expect(blockAPI.preservedData).toBe(preservedData);
  });

  it('returns the block preservedTunes for synchronous access to cached tune data', () => {
    const { block, preservedTunes } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    expect(blockAPI.preservedTunes).toBe(preservedTunes);
  });

  it('creates BlockAPI instances compatible with BlockAPIInterface', () => {
    const { block } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    const apiInterface: BlockAPIInterface = blockAPI;

    expect(apiInterface.id).toBe(blockAPI.id);
    expect(apiInterface.name).toBe(blockAPI.name);
  });

  it('exposes parentId from the underlying block', () => {
    const { block, shape } = createMockBlock();
    shape.parentId = 'parent-block-id';
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    expect(blockAPI.parentId).toBe('parent-block-id');

    shape.parentId = null;
    const blockAPINull = new BlockAPIConstructor(block, apiStub);

    expect(blockAPINull.parentId).toBeNull();
  });

  it('BlockAPI.parentId is included in the BlockAPIInterface type', () => {
    const { block, shape } = createMockBlock();
    shape.parentId = 'parent-block-id';
    const blockAPI = new BlockAPIConstructor(block, apiStub);

    const apiInterface: BlockAPIInterface = blockAPI;

    expect(apiInterface.parentId).toBe('parent-block-id');
  });

  describe('hierarchy / connection methods', () => {
    type FakeRecord = { id: string; name: string; parentId: string | null };

    /**
     * A structurally-typed editor `api` whose `methods.blocks` is backed by an
     * in-memory FLAT list, so `resolveInsertIndex` runs against real positions
     * (this exercises flat-index CORRECTNESS, not just delegation).
     */
    const makeApi = (flat: FakeRecord[], childHolder?: HTMLElement): {
      api: ApiModules;
      insertInsideParent: ReturnType<typeof vi.fn>;
      setBlockParent: ReturnType<typeof vi.fn>;
      move: ReturnType<typeof vi.fn>;
      getChildren: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      transact: ReturnType<typeof vi.fn>;
      setToBlock: ReturnType<typeof vi.fn>;
    } => {
      const created: BlockAPIInterface = { id: 'new-child',
        name: 'paragraph',
        parentId: 'p' } as unknown as BlockAPIInterface;

      /**
       * With `childHolder` the created child answers `holder`/`focusable` the way
       * a real BlockAPI does — as a LIVE getter over its DOM — so a suite can
       * model a child whose content only shows up after the insert (a
       * portal-rendered block). Defined rather than spread: spreading would
       * evaluate the getter once and freeze the answer.
       */
      if (childHolder !== undefined) {
        Object.defineProperties(created, {
          holder: { get: () => childHolder },
          focusable: { get: () => childHolder.querySelector('[contenteditable]') !== null },
        });
      }

      const insertInsideParent = vi.fn(() => created);
      const setBlockParent = vi.fn();
      const move = vi.fn();
      const getChildren = vi.fn((parentId: string) => flat.filter((b) => b.parentId === parentId));
      const insert = vi.fn(() => created);
      const transact = vi.fn((fn: () => void) => fn());
      const setToBlock = vi.fn();

      const blocks = {
        getBlocksCount: (): number => flat.length,
        getBlockByIndex: (i: number): FakeRecord | undefined => flat[i],
        getBlockIndex: (id: string): number | undefined => {
          const idx = flat.findIndex((b) => b.id === id);

          return idx === -1 ? undefined : idx;
        },
        getChildren,
        insertInsideParent,
        setBlockParent,
        move,
        insert,
        transact,
      };

      return {
        api: { methods: { blocks,
          caret: { setToBlock } } } as unknown as ApiModules,
        insertInsideParent,
        setBlockParent,
        move,
        getChildren,
        insert,
        transact,
        setToBlock,
      };
    };

    const containerBlock = (): Block =>
      ({ id: 'p', name: 'toggle', contentIds: ['a', 'b'], parentId: null } as unknown as Block);

    it('exposes a read-only copy of contentIds', () => {
      const blockAPI = new BlockAPIConstructor(containerBlock(), makeApi([]).api);

      expect(blockAPI.contentIds).toEqual(['a', 'b']);
    });

    it('delegates getChildren to the editor blocks API by this block id', () => {
      const { api, getChildren } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
        { id: 'b', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      const children = blockAPI.getChildren();

      expect(getChildren).toHaveBeenCalledWith('p');
      expect(children.map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('delegates setParent to setBlockParent with this block id', () => {
      const { api, setBlockParent } = makeApi([]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.setParent('q');
      expect(setBlockParent).toHaveBeenCalledWith('p', 'q');

      blockAPI.setParent(null);
      expect(setBlockParent).toHaveBeenCalledWith('p', null);
    });

    it('insertChild appends past the parent subtree (flat index after last descendant)', () => {
      const { api, insertInsideParent } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
        { id: 'b', name: 'paragraph', parentId: 'p' },
        { id: 'other', name: 'paragraph', parentId: null },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);
      const data = { text: 'x' } as BlockToolData;

      const result = blockAPI.insertChild(data);

      // p(0) a(1) b(2) → subtree ends at 2 → append at flat index 3.
      expect(insertInsideParent).toHaveBeenCalledWith('p', 3, data, undefined, {});
      expect(result?.id).toBe('new-child');
    });

    it('insertChild at "start" resolves to the first child flat index', () => {
      const { api, insertInsideParent } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
        { id: 'b', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);
      const data = { text: 'y' } as BlockToolData;

      blockAPI.insertChild(data, 'start');

      // first child 'a' sits at flat index 1.
      expect(insertInsideParent).toHaveBeenCalledWith('p', 1, data, undefined, {});
    });

    it('insertChild forwards an explicit tool name so a typed child is ONE operation', () => {
      const { api, insertInsideParent } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
        { id: 'b', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);
      const data = { level: 2,
        text: 'Heading' } as BlockToolData;

      blockAPI.insertChild(data, 'end', 'header');

      expect(insertInsideParent).toHaveBeenCalledWith('p', 3, data, 'header', {});
    });

    /**
     * Parity with the rich `insert({ focus, caret, id, tunes, replace })` the
     * framework adapters expose: a container tool must not have to hand-roll
     * caret placement (or a second insert call to apply tunes) just because it
     * inserts THROUGH its own block instead of at a flat index.
     */
    it('insertChild forwards focus, an explicit id and tunes to the child insert', () => {
      const { api, insertInsideParent } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);
      const data = { text: 'z' } as BlockToolData;
      const tunes = { align: { alignment: 'center' } } as unknown as Record<string, BlockTuneData>;

      blockAPI.insertChild(data, 'end', 'paragraph', { focus: true,
        id: 'fresh',
        tunes });

      expect(insertInsideParent).toHaveBeenCalledWith('p', 2, data, 'paragraph', {
        focus: true,
        id: 'fresh',
        tunes,
      });
    });

    it('insertChild places the caret inside the new child at the requested offset', () => {
      const { api, setToBlock } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'hello' }, 'end', undefined, {
        caret: { offset: 3 },
      });

      expect(setToBlock).toHaveBeenCalledWith('new-child', 'default', 3);
    });

    describe('insertChild caret on a child whose DOM commits later', () => {
      const flat = (): FakeRecord[] => [
        { id: 'p', name: 'card', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
      ];

      /** Lets jsdom deliver the MutationObserver batch for the DOM writes above. */
      const flushMutations = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

      /**
       * An editable element core would count as an input. Written as the
       * ATTRIBUTE: jsdom does not reflect the `contentEditable` property, and
       * core's input search selects on the attribute.
       */
      const editable = (): HTMLElement => {
        const element = document.createElement('div');

        element.setAttribute('contenteditable', 'true');

        return element;
      };

      it('re-applies the caret once the child produces an input', async () => {
        const holder = document.createElement('div');

        document.body.appendChild(holder);

        const { api, setToBlock } = makeApi(flat(), holder);
        const blockAPI = new BlockAPIConstructor(containerBlock(), api);

        blockAPI.insertChild({ text: '' }, 'end', undefined, { caret: { position: 'start' } });

        // The synchronous placement lands on a block with no inputs — all core can
        // do there is highlight it, which is the bug the re-application answers.
        expect(setToBlock).toHaveBeenCalledTimes(1);

        // The framework portal commits: the real editable finally exists.
        holder.appendChild(editable());

        await flushMutations();

        expect(setToBlock).toHaveBeenCalledTimes(2);
        expect(setToBlock).toHaveBeenLastCalledWith('new-child', 'start', 0);

        holder.remove();
      });

      it('leaves a child that never becomes focusable alone', async () => {
        const holder = document.createElement('div');

        document.body.appendChild(holder);

        const { api, setToBlock } = makeApi(flat(), holder);
        const blockAPI = new BlockAPIConstructor(containerBlock(), api);

        blockAPI.insertChild({}, 'end', 'delimiter', { caret: {} });

        // A delimiter renders content but no input: highlighting it IS the answer,
        // so the watch must not turn into a second placement.
        holder.appendChild(document.createElement('hr'));

        await flushMutations();

        expect(setToBlock).toHaveBeenCalledTimes(1);

        holder.remove();
      });

      it('drops the re-application when focus has moved elsewhere in the meantime', async () => {
        const holder = document.createElement('div');
        const elsewhere = editable();

        document.body.append(holder, elsewhere);

        const { api, setToBlock } = makeApi(flat(), holder);
        const blockAPI = new BlockAPIConstructor(containerBlock(), api);

        blockAPI.insertChild({ text: '' }, 'end', undefined, { caret: {} });

        // The author clicked into another block before the portal committed —
        // stealing focus back would yank the caret out from under them.
        elsewhere.focus();
        holder.appendChild(editable());

        await flushMutations();

        expect(setToBlock).toHaveBeenCalledTimes(1);

        holder.remove();
        elsewhere.remove();
      });
    });

    it('insertChild with an id that already exists creates nothing and returns it', () => {
      const { api, insertInsideParent } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      const result = blockAPI.insertChild({ text: 'again' }, 'end', undefined, { id: 'a' });

      expect(insertInsideParent).not.toHaveBeenCalled();
      expect(result?.id).toBe('a');
    });

    it('insertChild with replace overwrites the referenced child and keeps it parented', () => {
      const { api, insert, setBlockParent, insertInsideParent, transact } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
        { id: 'b', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);
      const data = { level: 3,
        text: 'Swapped' } as BlockToolData;

      blockAPI.insertChild(data, { before: 'b' }, 'header', { replace: true });

      expect(insertInsideParent).not.toHaveBeenCalled();
      // 'b' sits at flat index 2 — a replace targets the ref itself.
      expect(insert).toHaveBeenCalledWith('header', data, {}, 2, false, true, undefined, undefined);
      // The replacement must stay inside the container, not pop out to root.
      expect(setBlockParent).toHaveBeenCalledWith('new-child', 'p');
      // Insert + reparent land as ONE undo entry.
      expect(transact).toHaveBeenCalledTimes(1);
    });

    it('insertChild rejects a replace that names no child to overwrite', () => {
      const { api } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      expect(() => blockAPI.insertChild({ text: 'x' }, 'end', undefined, { replace: true }))
        .toThrow(/replace/i);
    });

    it('moveChild clamps a delta and delegates to editor move', () => {
      const { api, move } = makeApi([
        { id: 'p', name: 'toggle', parentId: null },
        { id: 'a', name: 'paragraph', parentId: 'p' },
        { id: 'b', name: 'paragraph', parentId: 'p' },
      ]);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      // Move 'a' (child pos 0, flat 1) down past 'b' (child pos 1). Target child
      // pos 1 → "after b": resolveMoveIndex clears b's whole subtree, so the flat
      // toIndex is subtreeEndIndex(b)+1 = 3 (the same convention React's move uses).
      blockAPI.moveChild('a', 1);

      expect(move).toHaveBeenCalledWith(3, 1);
    });
  });
});

