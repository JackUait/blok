import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { Block } from '../../../../../src/components/block';

/**
 * Notion parity: turning a block into a TOGGLE HEADING via "Turn into" must
 * ADOPT its section — every following sibling until the next heading of the
 * same or higher rank — as children of the new toggle heading. Notion's help
 * puts it as "all of the content within those headings will now be
 * collapsible"; without adoption the user has to hand-feed every paragraph
 * into the toggle (the exact complaint this fixes).
 *
 * The OFF direction (toggle heading → plain releases children) is pinned by
 * convert-toggle-children.test.ts; this file pins the ON direction.
 */

const createModuleConfig = (): ModuleConfig => ({
  config: { defaultBlock: 'paragraph' },
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

/** A paragraph-like block stub. */
const makeBlock = (id: string, name: string, parentId: string | null = null): Block => ({
  id,
  name,
  parentId,
  contentIds: [] as string[],
  holder: document.createElement('div'),
} as unknown as Block);

/** A header block stub whose holder carries a real <hN> so the level is readable. */
const makeHeader = (id: string, level: number, parentId: string | null = null): Block => {
  const block = makeBlock(id, 'header', parentId);
  const heading = document.createElement(`h${level}`);

  block.holder.appendChild(heading);

  return block;
};

/** A toggle-source stub: holder carries the data-blok-toggle-open marker. */
const makeToggleSource = (id: string, name: string, level = 1): Block => {
  const block = name === 'header' ? makeHeader(id, level) : makeBlock(id, name);
  const inner = document.createElement('div');

  inner.setAttribute('data-blok-toggle-open', 'true');
  block.holder.appendChild(inner);

  return block;
};

describe('BlockManager.convert — toggle heading adopts its section (Notion parity)', () => {
  let blockManager: BlockManager;
  let convertSpy: ReturnType<typeof vi.fn>;
  let setBlockParentSpy: ReturnType<typeof vi.fn>;
  let flatBlocks: Block[];
  let newBlock: Block;

  /** Stub operations.convert to swap `source` for `newBlock` in the flat array. */
  const arrangeConvert = (source: Block, resulting: Block, flat: Block[]): void => {
    newBlock = resulting;
    flatBlocks = flat;

    convertSpy = vi.fn().mockImplementation(() => {
      const index = flatBlocks.indexOf(source);

      if (index !== -1) {
        flatBlocks.splice(index, 1, newBlock);
      }

      return Promise.resolve(newBlock);
    });

    (blockManager as unknown as Record<string, unknown>).operations = {
      convert: convertSpy,
    };

    vi.spyOn(blockManager, 'blocks', 'get').mockImplementation(() => flatBlocks);
    vi.spyOn(blockManager, 'getBlockById').mockImplementation(
      (id: string) => flatBlocks.find(b => b.id === id)
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    blockManager = new BlockManager(createModuleConfig());

    (blockManager as unknown as Record<string, unknown>)._blocks = {};

    setBlockParentSpy = vi
      .spyOn(blockManager, 'setBlockParent')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adopts every following sibling until the next same-level heading, in document order', async () => {
    const source = makeHeader('src', 1);
    const p1 = makeBlock('p1', 'paragraph');
    const p2 = makeBlock('p2', 'paragraph');
    const stop = makeHeader('stop', 1);
    const after = makeBlock('after', 'paragraph');

    arrangeConvert(source, makeHeader('new', 1), [source, p1, p2, stop, after]);

    await blockManager.convert(source, 'header', { level: 1, isToggleable: true });

    expect(setBlockParentSpy.mock.calls).toEqual([
      [p1, 'new'],
      [p2, 'new'],
    ]);
  });

  it('stops at a HIGHER-rank heading too (H2 toggle stops at H1)', async () => {
    const source = makeHeader('src', 2);
    const p1 = makeBlock('p1', 'paragraph');
    const stop = makeHeader('stop', 1);

    arrangeConvert(source, makeHeader('new', 2), [source, p1, stop]);

    await blockManager.convert(source, 'header', { level: 2, isToggleable: true });

    expect(setBlockParentSpy.mock.calls).toEqual([[p1, 'new']]);
  });

  it('adopts LOWER-rank headings; their container children ride along untouched', async () => {
    const source = makeHeader('src', 1);
    const sub = makeHeader('sub', 3);

    sub.contentIds = ['subChild'];
    const subChild = makeBlock('subChild', 'paragraph', 'sub');
    const tail = makeBlock('tail', 'paragraph');

    arrangeConvert(source, makeHeader('new', 1), [source, sub, subChild, tail]);

    await blockManager.convert(source, 'header', { level: 1, isToggleable: true });

    expect(setBlockParentSpy.mock.calls).toEqual([
      [sub, 'new'],
      [tail, 'new'],
    ]);
  });

  it('adopts when converting a PARAGRAPH into a toggle heading', async () => {
    const source = makeBlock('src', 'paragraph');
    const p1 = makeBlock('p1', 'paragraph');

    arrangeConvert(source, makeHeader('new', 3), [source, p1]);

    await blockManager.convert(source, 'header', { level: 3, isToggleable: true });

    expect(setBlockParentSpy.mock.calls).toEqual([[p1, 'new']]);
  });

  it('scopes adoption to siblings of the same parent (heading inside a container)', async () => {
    const source = makeHeader('src', 2, 'col');

    source.parentId = 'col';
    const inCol = makeBlock('inCol', 'paragraph', 'col');
    const outside = makeBlock('outside', 'paragraph', null);

    const resulting = makeHeader('new', 2, 'col');

    arrangeConvert(source, resulting, [source, inCol, outside]);

    await blockManager.convert(source, 'header', { level: 2, isToggleable: true });

    expect(setBlockParentSpy.mock.calls).toEqual([[inCol, 'new']]);
  });

  it('skips children the convert already re-nested onto the new toggle heading', async () => {
    const source = makeBlock('src', 'callout');

    source.contentIds = ['kept'];
    const resulting = makeHeader('new', 2);

    resulting.contentIds = ['kept'];
    const kept = makeBlock('kept', 'paragraph', 'new');
    const p1 = makeBlock('p1', 'paragraph');

    arrangeConvert(source, resulting, [source, kept, p1]);

    await blockManager.convert(source, 'header', { level: 2, isToggleable: true });

    expect(setBlockParentSpy.mock.calls).toEqual([[p1, 'new']]);
  });

  it('does NOT adopt when the source is already a toggle (toggle list → toggle heading)', async () => {
    const source = makeToggleSource('src', 'toggle');
    const p1 = makeBlock('p1', 'paragraph');

    arrangeConvert(source, makeHeader('new', 1), [source, p1]);

    await blockManager.convert(source, 'header', { level: 1, isToggleable: true });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });

  it('does NOT adopt on a toggle heading level change (toggle heading → toggle heading)', async () => {
    const source = makeToggleSource('src', 'header', 1);
    const p1 = makeBlock('p1', 'paragraph');

    arrangeConvert(source, makeHeader('new', 2), [source, p1]);

    await blockManager.convert(source, 'header', { level: 2, isToggleable: true });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });

  it('does NOT adopt when converting into a PLAIN heading', async () => {
    const source = makeBlock('src', 'paragraph');
    const p1 = makeBlock('p1', 'paragraph');

    arrangeConvert(source, makeHeader('new', 1), [source, p1]);

    await blockManager.convert(source, 'header', { level: 1 });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });

  it('does NOT adopt when the caller opts out (multi-select convert)', async () => {
    const source = makeBlock('src', 'paragraph');
    const p1 = makeBlock('p1', 'paragraph');

    arrangeConvert(source, makeHeader('new', 1), [source, p1]);

    await blockManager.convert(source, 'header', { level: 1, isToggleable: true }, { skipSectionAdoption: true });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });

  it('adopts nothing when the toggle heading is immediately followed by a same-level heading', async () => {
    const source = makeHeader('src', 1);
    const stop = makeHeader('stop', 1);

    arrangeConvert(source, makeHeader('new', 1), [source, stop]);

    await blockManager.convert(source, 'header', { level: 1, isToggleable: true });

    expect(setBlockParentSpy).not.toHaveBeenCalled();
  });
});
