/**
 * `blocks.create`: what a host button calls to add a block the way the
 * toolbox does, at the root's end unless told otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { PageTool } from '../../../../../src/tools/page';
import { createBlocksApiForEditor } from '../../../../../src/components/utils/blocks-api';
import type { API, Blok as BlokType, BlockOrigin, BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  caret: API['caret'];
  module: { blockManager: { blocks: Block[] } };
}

const origins: BlockOrigin[] = [];
const prepare = vi.fn<() => Promise<Record<string, unknown>>>();

/** Records how it was created; its `prepareInsert` is the test's `prepare`. */
class Prepared {
  private readonly data: Record<string, unknown>;

  constructor(options: BlockToolConstructorOptions) {
    origins.push(options.origin ?? 'api');
    this.data = options.data;
  }

  public static prepareInsert(): Promise<Record<string, unknown>> {
    return prepare();
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, unknown> {
    return this.data;
  }
}

class Plain {
  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const pageConfig = {
  create: vi.fn<(init: { pageId: string }) => Promise<{ pageId: string }>>(),
  open: vi.fn(),
  resolve: vi.fn(),
};

const boot = async (): Promise<TestEditor> => {
  const blocks: OutputBlockData[] = [
    { id: 'a', type: 'paragraph', data: { text: 'a' } },
    { id: 't', type: 'toggle', data: { text: 't', isOpen: true }, content: ['c1'] },
    { id: 'c1', type: 'paragraph', data: { text: 'c1' }, parent: 't' },
  ];
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, toggle: ToggleItem, prepared: Prepared, plain: Plain, page: { class: PageTool, config: pageConfig } },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** `id^parent` for every block, in flat order. */
const flat = (instance: TestEditor): string[] =>
  instance.module.blockManager.blocks.map(block => `${block.id}^${block.parentId ?? '-'}`);

describe('blocks.create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    origins.length = 0;
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('adds the block at the end of the root, even with the caret in a nested block', async () => {
    prepare.mockResolvedValue({ pageId: 'host-1' });
    const instance = await boot();
    const nested = instance.blocks.getById('c1');

    if (nested === null) {
      throw new Error('c1 missing');
    }
    instance.caret.setToBlock(nested, 'end');

    const block = await instance.blocks.create('prepared', { id: 'n' });

    expect(block.id).toBe('n');
    expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t', 'n^-']);
  });

  it('is born with the data prepareInsert answered, as a user insert', async () => {
    prepare.mockResolvedValue({ pageId: 'host-1' });
    const instance = await boot();

    await instance.blocks.create('prepared', { id: 'n', data: { pageId: 'mine', extra: 1 } });

    const saved = (await instance.save()).blocks.find(block => block.id === 'n');

    expect(saved?.data).toEqual({ pageId: 'host-1', extra: 1 });
    expect(origins).toEqual(['user']);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('inserts nothing and rejects when prepareInsert rejects', async () => {
    prepare.mockRejectedValue(new Error('backend down'));
    const instance = await boot();

    await expect(instance.blocks.create('prepared', { id: 'n' })).rejects.toThrow('backend down');
    expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t']);
    expect(origins).toEqual([]);
  });

  it('checks the place before asking the host, so a bad parent leaves no orphan page', async () => {
    prepare.mockResolvedValue({ pageId: 'host-1' });
    const instance = await boot();

    await expect(instance.blocks.create('prepared', { parentId: 'gone' })).rejects.toMatchObject({ name: 'BlockPlacementError' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('inserts at once for a tool without prepareInsert', async () => {
    const instance = await boot();

    await instance.blocks.create('plain', { id: 'n' });

    expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t', 'n^-']);
  });

  it('places the block under a named parent, still as a user insert', async () => {
    prepare.mockResolvedValue({ pageId: 'host-1' });
    const instance = await boot();

    await instance.blocks.create('prepared', { id: 'n', parentId: 't', position: 'start' });

    expect(flat(instance)).toEqual(['a^-', 't^-', 'n^t', 'c1^t']);
    expect(origins).toEqual(['user']);
  });

  it('makes a top-level page with the host id and opens it, asking the host once', async () => {
    pageConfig.create.mockResolvedValue({ pageId: 'host-page' });
    pageConfig.resolve.mockResolvedValue({ title: 'New' });
    const instance = await boot();

    const block = await instance.blocks.create('page');

    await settle();

    expect(block.parentId).toBeNull();
    expect((await instance.save()).blocks.at(-1)).toMatchObject({ type: 'page', data: { pageId: 'host-page' } });
    expect(pageConfig.create).toHaveBeenCalledTimes(1);
    expect(pageConfig.open).toHaveBeenCalledWith('host-page', {});
  });

  describe('the adapters\' useBlocks create', () => {
    it('resolves the new root node, made as a user insert', async () => {
      prepare.mockResolvedValue({ pageId: 'host-1' });
      const instance = await boot();
      const api = createBlocksApiForEditor(instance as unknown as BlokType);

      const node = await api.create({ type: 'prepared', id: 'n' });

      expect(node).toMatchObject({ id: 'n', parentId: null, type: 'prepared' });
      expect(api.getBlockData('n')?.data).toEqual({ pageId: 'host-1' });
      expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t', 'n^-']);
      expect(origins).toEqual(['user']);
    });

    it('resolves null for an unknown tool or a missing parent', async () => {
      const instance = await boot();
      const api = createBlocksApiForEditor(instance as unknown as BlokType);

      await expect(api.create({ type: 'nope' })).resolves.toBeNull();
      await expect(api.create({ type: 'plain', parentId: 'gone' })).resolves.toBeNull();
      expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t']);
    });

    it('rejects with the prepareInsert error, inserting nothing', async () => {
      prepare.mockRejectedValue(new Error('backend down'));
      const instance = await boot();
      const api = createBlocksApiForEditor(instance as unknown as BlokType);

      await expect(api.create({ type: 'prepared' })).rejects.toThrow('backend down');
      expect(flat(instance)).toEqual(['a^-', 't^-', 'c1^t']);
    });
  });
});
