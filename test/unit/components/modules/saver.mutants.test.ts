import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Saver } from '../../../../src/components/modules/saver';
import type { Block } from '../../../../src/components/block';
import type { BlokConfig, OutputData, SanitizerConfig } from '../../../../types';
import type { SavedData } from '../../../../types/data-formats';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import * as utils from '../../../../src/components/utils';
import { BlockChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlockMutationEvent } from '../../../../types/events/block';

/**
 * What a tool's `save()` may resolve. Every field is optional: the saver's
 * fallback paths only exist because a tool can return a payload with no `data`
 * — or nothing at all.
 */
interface BlockSaveResult {
  id?: string;
  tool?: string;
  data?: SavedData['data'] | null;
  time?: number;
  tunes?: Record<string, unknown>;
}

interface BlockMock {
  block: Block;
  saveMock: Mock<() => Promise<BlockSaveResult | undefined>>;
  validateMock: Mock<(data: SavedData['data'] | null | undefined) => Promise<boolean>>;
}

interface BlockMockOptions {
  id: string;
  tool: string;
  data?: SavedData['data'] | null;
  tunes?: Record<string, unknown>;
  isValid?: boolean;
  parentId?: string | null;
  contentIds?: string[];
  lastEditedAt?: number;
  lastEditedBy?: string | null;
  holder?: HTMLElement;
  isEmpty?: boolean;
  isDefault?: boolean;
  /** `save()` resolves undefined — the tool refused to serialize. */
  saveResolvesUndefined?: boolean;
  /** `save()` resolves a payload carrying no `data` field. */
  saveOmitsData?: boolean;
  preservedData?: SavedData['data'];
  preservedTunes?: Record<string, unknown>;
}

interface RendererStub {
  pendingRender?: Promise<void> | null;
  getDetectedInputFormat?: () => string;
}

interface CreateSaverOptions {
  blocks?: Block[];
  /** Read on every access, so a fixture can change the model mid-save. */
  blocksProvider?: () => Block[];
  sanitizer?: SanitizerConfig;
  stubTool?: string;
  toolSanitizeConfigs?: Record<string, SanitizerConfig>;
  onError?: BlokConfig['onError'];
  dataModel?: BlokConfig['dataModel'];
  renderer?: RendererStub;
  /** Wire the real event bus, so a BlockChanged emit reaches the saver itself. */
  liveEvents?: boolean;
}

const createBlockMock = (options: BlockMockOptions): BlockMock => {
  const savedData: BlockSaveResult = {
    id: options.id,
    tool: options.tool,
    time: 0,
    // `'data' in options` rather than `??`: a tool may legitimately save a null
    // payload, and defaulting it away hides the malformed-stub branch entirely.
    ...(options.saveOmitsData === true ? {} : { data: 'data' in options ? options.data : {} }),
    ...(options.tunes !== undefined ? { tunes: options.tunes } : {}),
  };

  const saveMock = vi.fn((): Promise<BlockSaveResult | undefined> =>
    Promise.resolve(options.saveResolvesUndefined === true ? undefined : savedData));
  const validateMock = vi.fn((_data: SavedData['data'] | null | undefined): Promise<boolean> =>
    Promise.resolve(options.isValid ?? true));

  const block = {
    id: options.id,
    name: options.tool,
    save: saveMock,
    validate: validateMock,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    lastEditedAt: options.lastEditedAt,
    ...('lastEditedBy' in options ? { lastEditedBy: options.lastEditedBy } : {}),
    isEmpty: options.isEmpty ?? false,
    tool: { isDefault: options.isDefault ?? false },
    preservedData: options.preservedData,
    preservedTunes: options.preservedTunes,
    ...(options.holder !== undefined ? { holder: options.holder } : {}),
  } as unknown as Block;

  return {
    block,
    saveMock,
    validateMock,
  };
};

const createSaver = (options: CreateSaverOptions = {}): { saver: Saver; eventsDispatcher: Saver['eventsDispatcher'] } => {
  const config: BlokConfig = {
    sanitizer: options.sanitizer ?? ({}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
    ...(options.dataModel !== undefined ? { dataModel: options.dataModel } : {}),
  };

  const eventsDispatcher = (options.liveEvents === true
    ? new EventsDispatcher<BlokEventMap>()
    : {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    }) as unknown as Saver['eventsDispatcher'];

  const saver = new Saver({
    config,
    eventsDispatcher,
  });

  const stubTool = options.stubTool ?? 'stub-tool';
  const toolConfigs: Record<string, SanitizerConfig> = {
    paragraph: {},
    table: {},
    database: {},
    toggle: {},
    embed: {},
    column: {},
    callout: {},
    [stubTool]: {},
    ...(options.toolSanitizeConfigs ?? {}),
  };

  const blockTools = new Map<string, { sanitizeConfig?: SanitizerConfig }>(
    Object.entries(toolConfigs).map(([name, sanitizeConfig]) => [name, { sanitizeConfig } ])
  );

  const provideBlocks = options.blocksProvider ?? ((): Block[] => options.blocks ?? []);

  const blokState = {
    BlockManager: {
      get blocks(): Block[] {
        return provideBlocks();
      },
    },
    Tools: {
      blockTools,
      stubTool,
    },
    ...(options.renderer !== undefined ? { Renderer: options.renderer } : {}),
  };

  (saver as unknown as { state: Saver['Blok'] }).state = blokState as unknown as Saver['Blok'];

  return { saver, eventsDispatcher };
};

/** Lets every queued microtask and timer callback run. */
const flush = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const passthroughSanitizer = (): void => {
  vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
};

const silenceLogs = (): void => {
  vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
  vi.spyOn(utils, 'log').mockImplementation(() => undefined);
};

const lastErrorMessage = (saver: Saver): string => {
  const error = saver.getLastSaveError();

  return error instanceof Error ? error.message : String(error);
};

const blockById = (result: OutputData | undefined, id: string): OutputData['blocks'][number] | undefined =>
  result?.blocks.find(block => block.id === id);

const gridOf = (result: OutputData | undefined, id: string): unknown[][] =>
  (blockById(result, id)?.data as { content: unknown[][] }).content;

/** The change signal the BlockManager emits on every block mutation. */
const emitBlockChanged = (eventsDispatcher: Saver['eventsDispatcher'], blockId: string): void => {
  eventsDispatcher.emit(BlockChanged, {
    event: new CustomEvent('block-changed', {
      detail: { target: { id: blockId } },
    }) as unknown as BlockMutationEvent,
  });
};

describe('Saver — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('save() gating: destruction, dialect and in-flight deduplication', () => {
    it('answers a destroyed editor without ever entering the save pipeline', async () => {
      let releaseRender: (() => void) | undefined;
      const pendingRender = new Promise<void>(resolve => {
        releaseRender = resolve;
      });
      const block = createBlockMock({ id: 'destroyed-1', tool: 'paragraph', data: { text: 'Never saved' } });
      const { saver } = createSaver({ blocks: [block.block], renderer: { pendingRender } });

      saver.markDestroyed();

      let settled = false;
      const promise = saver.save().then(value => {
        settled = true;

        return value;
      });

      await flush();

      // Dropping the pre-pipeline destruction gate makes save() wait on a
      // render that will never finish for an editor that no longer exists.
      expect(settled).toBe(true);

      releaseRender?.();

      await expect(promise).resolves.toBeUndefined();
      expect(block.saveMock).not.toHaveBeenCalled();
    });

    it('abandons the save when the editor is destroyed while a render is in flight', async () => {
      let releaseRender: (() => void) | undefined;
      const pendingRender = new Promise<void>(resolve => {
        releaseRender = resolve;
      });
      const block = createBlockMock({ id: 'mid-render', tool: 'paragraph', data: { text: 'Discarded' } });
      const { saver } = createSaver({ blocks: [block.block], renderer: { pendingRender } });

      const promise = saver.save();

      saver.markDestroyed();
      releaseRender?.();

      await expect(promise).resolves.toBeUndefined();
      expect(block.saveMock).not.toHaveBeenCalled();
    });

    it('abandons the save when the editor is destroyed while the tools are serializing', async () => {
      let releaseBlockSave: (() => void) | undefined;
      const block = createBlockMock({ id: 'mid-serialize', tool: 'paragraph', data: { text: 'Discarded' } });

      block.saveMock.mockImplementation(() => new Promise<BlockSaveResult>(resolve => {
        releaseBlockSave = () => resolve({ id: 'mid-serialize', tool: 'paragraph', data: { text: 'Discarded' }, time: 0 });
      }));

      const { saver } = createSaver({ blocks: [block.block] });
      const promise = saver.save();

      await flush();
      saver.markDestroyed();
      releaseBlockSave?.();

      await expect(promise).resolves.toBeUndefined();
      expect(block.saveMock).toHaveBeenCalledTimes(1);
    });

    it('reads the model only after a pending render has finished', async () => {
      let rendered = false;
      let releaseRender: (() => void) | undefined;
      const pendingRender = new Promise<void>(resolve => {
        releaseRender = () => {
          rendered = true;
          resolve();
        };
      });
      const block = createBlockMock({ id: 'rendered-1', tool: 'paragraph', data: { text: 'Arrives with the render' } });
      const { saver } = createSaver({
        blocksProvider: () => (rendered ? [block.block] : []),
        renderer: { pendingRender },
      });

      const promise = saver.save();

      releaseRender?.();

      const result = await promise;

      // Reading the blocks before the render lands saves an empty document.
      expect(result?.blocks).toHaveLength(1);
      expect(result?.blocks[0].data).toStrictEqual({ text: 'Arrives with the render' });
    });

    it('shares one in-flight save between two concurrent host callers while the document is unchanged', async () => {
      const block = createBlockMock({ id: 'shared-1', tool: 'paragraph', data: { text: 'Read once' } });
      const { saver } = createSaver({ blocks: [block.block] });

      const [first, second] = await Promise.all([saver.save(), saver.save()]);

      expect(block.saveMock).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
    });

    it('refuses to share the in-flight save with a caller that arrived after a document change', async () => {
      const block = createBlockMock({ id: 'shared-2', tool: 'paragraph', data: { text: 'Before the edit' } });
      const { saver, eventsDispatcher } = createSaver({
        blocks: [block.block],
        liveEvents: true,
      });

      const first = saver.save();

      // The edit lands while the first serialization is still in flight — the
      // shared promise predates it, so handing it over loses the edit.
      block.saveMock.mockResolvedValue({ id: 'shared-2', tool: 'paragraph', data: { text: 'After the edit' }, time: 0 });
      emitBlockChanged(eventsDispatcher, 'shared-2');

      const second = await saver.save();

      expect(second?.blocks[0].data).toStrictEqual({ text: 'After the edit' });
      expect(block.saveMock).toHaveBeenCalledTimes(2);
      expect(await first).not.toBe(second);
    });

    it('never serves an internal save from the host dedup slot', async () => {
      const block = createBlockMock({ id: 'internal-1', tool: 'paragraph', data: { text: 'Read twice' } });
      const { saver } = createSaver({ blocks: [block.block] });

      await Promise.all([
        saver.save({ dialect: 'internal' }),
        saver.save({ dialect: 'internal' }),
      ]);

      expect(block.saveMock).toHaveBeenCalledTimes(2);
    });

    it('re-reads the document on the next save instead of replaying the previous one', async () => {
      const block = createBlockMock({ id: 'sequential-1', tool: 'paragraph', data: { text: 'First read' } });
      const { saver } = createSaver({ blocks: [block.block] });

      await saver.save();

      block.saveMock.mockResolvedValue({ id: 'sequential-1', tool: 'paragraph', data: { text: 'Second read' }, time: 0 });

      const second = await saver.save();

      // A dedup slot that is never cleared hands every later save the first
      // save's frozen document.
      expect(second?.blocks[0].data).toStrictEqual({ text: 'Second read' });
      expect(block.saveMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('legacy dialect collapse', () => {
    const toggleTree = (): Block[] => [
      createBlockMock({
        id: 'tgl-1',
        tool: 'toggle',
        data: { text: 'Release notes', isOpen: true },
      }).block,
      createBlockMock({
        id: 'tgl-child',
        tool: 'paragraph',
        data: { text: 'Nested body' },
        parentId: 'tgl-1',
      }).block,
    ];

    it('collapses a host save when the host asked for the legacy data model', async () => {
      passthroughSanitizer();
      const { saver } = createSaver({ blocks: toggleTree(), dataModel: 'legacy' });

      const result = await saver.save();

      expect(result?.blocks).toHaveLength(1);
      expect(result?.blocks[0].type).toBe('toggleList');
    });

    it('collapses a host save when the document was loaded in the legacy format', async () => {
      passthroughSanitizer();
      const { saver } = createSaver({
        blocks: toggleTree(),
        renderer: { getDetectedInputFormat: () => 'legacy' },
      });

      const result = await saver.save();

      expect(result?.blocks).toHaveLength(1);
      expect(result?.blocks[0].type).toBe('toggleList');
    });

    it('keeps an internal save in the flat model even when the host dialect would collapse', async () => {
      passthroughSanitizer();
      const { saver } = createSaver({ blocks: toggleTree(), dataModel: 'legacy' });

      const result = await saver.save({ dialect: 'internal' });

      expect(result?.blocks.map(block => block.type)).toStrictEqual(['toggle', 'paragraph']);
    });

    it('survives a Renderer that exposes no input-format probe', async () => {
      passthroughSanitizer();
      const { saver } = createSaver({
        blocks: [createBlockMock({ id: 'probe-less', tool: 'paragraph', data: { text: 'Still saved' } }).block],
        renderer: { pendingRender: null },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(1);
    });
  });

  describe('stranded holder gate', () => {
    /**
     * A visible container whose two children's holders were never mounted —
     * content the model still claims but the user cannot reach.
     */
    const strandedTree = (containerTool: string): Block[] => {
      const containerHolder = document.createElement('div');

      containerHolder.textContent = 'container';
      document.body.appendChild(containerHolder);

      return [
        createBlockMock({
          id: 'holder-parent',
          tool: containerTool,
          data: { text: 'Container', content: [[{ blocks: ['stranded-a', 'stranded-b'] }]] },
          holder: containerHolder,
        }).block,
        createBlockMock({
          id: 'stranded-a',
          tool: 'paragraph',
          data: { text: 'Lost first' },
          parentId: 'holder-parent',
          holder: document.createElement('div'),
        }).block,
        createBlockMock({
          id: 'stranded-b',
          tool: 'paragraph',
          data: { text: 'Lost second' },
          parentId: 'holder-parent',
          holder: document.createElement('div'),
        }).block,
      ];
    };

    it('rejects the save in the test environment and names every stranded block', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({ blocks: strandedTree('callout') });

      await expect(saver.save()).rejects.toThrow(/stranded block holder/);

      const error = await saver.save().catch((thrown: unknown) => thrown);
      const message = error instanceof Error ? error.message : '';

      expect(message).toContain('stranded-a');
      expect(message).toContain('stranded-b');
      // One header line plus one indented line per violation: collapsing the
      // newline separator would merge the two blocks into a single entry.
      expect(message.split('\n')).toHaveLength(3);
    });

    it('rejects the save in the development environment', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({ blocks: strandedTree('callout') });

      await expect(saver.save()).rejects.toThrow(/stranded block holder/);
    });

    it('only logs in production so the user still gets a save', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const { saver } = createSaver({ blocks: strandedTree('callout') });
      const result = await saver.save();

      expect(result?.blocks).toHaveLength(3);
      expect(logLabeledSpy).toHaveBeenCalledWith(expect.stringMatching(/stranded block holder/), 'error');
    });

    it('exempts children of self-managing containers whose cells mount lazily', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({ blocks: strandedTree('table') });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(3);
    });
  });

  describe('WYSIWYG order guard', () => {
    /**
     * A container whose two children are mounted in the reverse of their flat
     * order. `mount` decides where each child's holder ends up, which is what
     * separates "comparable" from "leave the model alone".
     */
    const orderFixture = (options: {
      parentTool: string;
      mount: 'both-inside' | 'second-outside' | 'second-holderless';
      parentHolder: 'connected' | 'missing';
    }): Block[] => {
      const parentHolder = document.createElement('div');

      parentHolder.textContent = 'parent';

      const firstHolder = document.createElement('div');
      const secondHolder = document.createElement('div');

      firstHolder.textContent = 'first child';
      secondHolder.textContent = 'second child';

      if (options.mount === 'second-outside') {
        // Mounted before the container, so document order is [second, first].
        document.body.append(secondHolder, parentHolder);
        parentHolder.appendChild(firstHolder);
      } else {
        document.body.appendChild(parentHolder);
        parentHolder.append(secondHolder, firstHolder);
      }

      return [
        createBlockMock({
          id: 'container-1',
          tool: options.parentTool,
          data: { text: 'Container', content: [[{ blocks: ['child-first', 'child-second'] }]] },
          ...(options.parentHolder === 'connected' ? { holder: parentHolder } : {}),
        }).block,
        createBlockMock({
          id: 'child-first',
          tool: 'paragraph',
          data: { text: 'Flat position one' },
          parentId: 'container-1',
          holder: firstHolder,
        }).block,
        createBlockMock({
          id: 'child-second',
          tool: 'paragraph',
          data: { text: 'Flat position two' },
          parentId: 'container-1',
          ...(options.mount === 'second-holderless' ? {} : { holder: secondHolder }),
        }).block,
      ];
    };

    it('throws in the test environment for exactly two children in the wrong order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'column', mount: 'both-inside', parentHolder: 'connected' }),
      });

      await expect(saver.save()).resolves.toBeUndefined();

      const message = lastErrorMessage(saver);

      expect(message).toContain('container-1');
      expect(message).toContain('saved in a different order than their DOM order');
      expect(message).toContain('moved a holder in the DOM without moving the block in the flat array');
      expect(message).toContain('would not match what the user sees');
    });

    it('names every container whose children diverged, not just the first', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();

      const blocks = ['alpha', 'beta'].flatMap(name => {
        const columnHolder = document.createElement('div');
        const firstHolder = document.createElement('div');
        const secondHolder = document.createElement('div');

        firstHolder.textContent = `${name} one`;
        secondHolder.textContent = `${name} two`;
        columnHolder.append(secondHolder, firstHolder);
        document.body.appendChild(columnHolder);

        return [
          createBlockMock({ id: `col-${name}`, tool: 'column', data: {}, holder: columnHolder }).block,
          createBlockMock({
            id: `${name}-first`,
            tool: 'paragraph',
            data: { text: `${name} one` },
            parentId: `col-${name}`,
            holder: firstHolder,
          }).block,
          createBlockMock({
            id: `${name}-second`,
            tool: 'paragraph',
            data: { text: `${name} two` },
            parentId: `col-${name}`,
            holder: secondHolder,
          }).block,
        ];
      });
      const { saver } = createSaver({ blocks });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('col-alpha, col-beta');
    });

    it('throws in the development environment for the same divergence', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'column', mount: 'both-inside', parentHolder: 'connected' }),
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('saved in a different order than their DOM order');
    });

    it('repairs the emitted order to the DOM order in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'column', mount: 'both-inside', parentHolder: 'connected' }),
      });

      const result = await saver.save();

      expect(result?.blocks.map(block => block.id)).toStrictEqual(['container-1', 'child-second', 'child-first']);
      expect(blockById(result, 'container-1')?.content).toStrictEqual(['child-second', 'child-first']);
    });

    it('leaves a self-managing container alone even when its children look out of order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'table', mount: 'both-inside', parentHolder: 'connected' }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.map(block => block.id)).toStrictEqual(['container-1', 'child-first', 'child-second']);
    });

    it('skips the comparison when the container has no element holder', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'column', mount: 'both-inside', parentHolder: 'missing' }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(3);
    });

    it('skips the comparison when a child is mounted outside its container', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'column', mount: 'second-outside', parentHolder: 'connected' }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.map(block => block.id)).toStrictEqual(['container-1', 'child-first', 'child-second']);
    });

    it('skips the comparison when a child carries no holder at all', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: orderFixture({ parentTool: 'column', mount: 'second-holderless', parentHolder: 'connected' }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(3);
    });

  });

  describe('table grid reference scan', () => {
    /**
     * A table plus its cell children. `grid` is written verbatim into
     * `data.content`, so a fixture can hand the scanner a malformed cell.
     */
    const tableWith = (options: {
      grid: unknown;
      children?: Array<{ id: string; text: string; container?: 'a' | 'b' | 'none'; connected?: boolean }>;
      childOrderInDom?: string[];
      tool?: string;
      extraRootBlocks?: Block[];
    }): Block[] => {
      const tableHolder = document.createElement('div');
      const containerA = document.createElement('div');
      const containerB = document.createElement('div');

      containerA.setAttribute('data-blok-table-cell-blocks', '');
      containerB.setAttribute('data-blok-table-cell-blocks', '');
      tableHolder.append(containerA, containerB);
      document.body.appendChild(tableHolder);

      const children = options.children ?? [];
      const holders = new Map<string, HTMLElement>();

      for (const child of children) {
        const holder = document.createElement('div');

        holder.textContent = child.text;
        holders.set(child.id, holder);
      }

      const domOrder = options.childOrderInDom ?? children.map(child => child.id);

      for (const id of domOrder) {
        const child = children.find(candidate => candidate.id === id);
        const holder = holders.get(id);

        if (child === undefined || holder === undefined || child.connected === false) {
          continue;
        }

        if (child.container === 'b') {
          containerB.appendChild(holder);
        } else if (child.container === 'none') {
          tableHolder.appendChild(holder);
        } else {
          containerA.appendChild(holder);
        }
      }

      return [
        createBlockMock({
          id: 'tbl-1',
          tool: options.tool ?? 'table',
          data: { withHeadings: false, content: options.grid },
          holder: tableHolder,
        }).block,
        ...children.map(child => createBlockMock({
          id: child.id,
          tool: 'paragraph',
          data: { text: child.text },
          parentId: 'tbl-1',
          holder: holders.get(child.id),
        }).block),
        ...(options.extraRootBlocks ?? []),
      ];
    };

    it('leaves a table whose content is not a grid completely alone', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({ blocks: tableWith({ grid: 'not-a-grid' }) });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(1);
    });

    it('treats an empty grid as a real (empty) reference set', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({ grid: [], children: [{ id: 'cell-a', text: 'Alpha' }] }),
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('not referenced by any cell');
    });

    it('skips a grid that mixes a legacy string cell with a block cell', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({ grid: [['Legacy text', { blocks: ['no-such-block'] }]] }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(1);
    });

    it('reads through a null grid cell without crashing', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a', 'cell-b'] }, null]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'cell-b', text: 'Beta' },
          ],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(3);
    });

    it('ignores non-string ids inside a grid cell', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a', 7] }]],
          children: [{ id: 'cell-a', text: 'Alpha' }],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(2);
    });

    it('treats a grid cell without a blocks list as referencing nothing', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a', 'cell-b'] }, {}]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'cell-b', text: 'Beta' },
          ],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(3);
    });

    it('never validates a grid-shaped payload that belongs to another tool', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          tool: 'database',
          grid: [[{ blocks: ['cell-a', 'cell-b'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'cell-b', text: 'Beta' },
            { id: 'cell-unlisted', text: 'Gamma' },
          ],
          childOrderInDom: ['cell-b', 'cell-a', 'cell-unlisted'],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(4);
    });

    it('skips the cell order check for a legacy string-cell grid', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [['Legacy text', { blocks: ['cell-a', 'cell-b'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'cell-b', text: 'Beta' },
          ],
          childOrderInDom: ['cell-b', 'cell-a'],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(3);
    });

    it('reports an unreferenced child as an invisible ghost when its holder is detached', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost', connected: false },
          ],
        }),
      });

      await expect(saver.save()).resolves.toBeUndefined();

      const message = lastErrorMessage(saver);

      expect(message).toContain('table children diverge from their grid references');
      expect(message).toContain('(invisible ghost)');
    });

    it('reports an unreferenced child as a visible ghost when its holder is on screen', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost' },
          ],
        }),
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('(visible ghost)');
    });

    it('lists every grid problem it found, separated', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a', 'vanished-block'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost', connected: false },
          ],
        }),
      });

      await expect(saver.save()).resolves.toBeUndefined();

      const message = lastErrorMessage(saver);

      expect(message).toContain('references missing block vanished-block');
      expect(message).toContain('; ');
      expect(message).toContain('not referenced by any cell');
    });

    it('throws in the development environment for a diverged grid', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost', connected: false },
          ],
        }),
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('not referenced by any cell');
    });

    it('production: only the ghost loses its parent and no other block is rewritten', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost' },
          ],
        }),
      });

      const result = await saver.save();

      expect(blockById(result, 'ghost-1')).not.toHaveProperty('parent');
      expect(blockById(result, 'cell-a')?.parent).toBe('tbl-1');
      // A repair that rewrites every block hands each one an empty grid.
      expect(blockById(result, 'cell-a')?.data).toStrictEqual({ text: 'Alpha' });
    });

    it('production: keeps a grid intact when nothing in it actually dangles', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a', 9] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost', connected: false },
          ],
        }),
      });

      const result = await saver.save();

      expect(gridOf(result, 'tbl-1')[0][0]).toStrictEqual({ blocks: ['cell-a', 9] });
    });

    it('production: prunes only the dangling ids and keeps every other cell verbatim', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a', 'vanished-block'] }, null, {}]],
          children: [{ id: 'cell-a', text: 'Alpha' }],
        }),
      });

      const result = await saver.save();
      const row = gridOf(result, 'tbl-1')[0];

      expect(row[0]).toStrictEqual({ blocks: ['cell-a'] });
      expect(row[1]).toBeNull();
      expect(row[2]).toStrictEqual({});
    });

    it('production: a block with no contentIds does not break the grid repair', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      silenceLogs();
      const dataless = createBlockMock({
        id: 'dataless-1',
        tool: 'paragraph',
        saveResolvesUndefined: true,
      });
      const { saver } = createSaver({
        blocks: tableWith({
          grid: [[{ blocks: ['cell-a'] }]],
          children: [
            { id: 'cell-a', text: 'Alpha' },
            { id: 'ghost-1', text: 'Ghost' },
          ],
          extraRootBlocks: [dataless.block],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(blockById(result, 'dataless-1')).toBeUndefined();
      expect(blockById(result, 'ghost-1')).toBeDefined();
    });
  });

  describe('table cell order guard', () => {
    /**
     * One table whose cells are laid out across two cell-block containers, so a
     * fixture can put a cell's blocks in one container, in two, or in none.
     */
    const cellOrderFixture = (options: {
      cells: unknown[];
      children: Array<{ id: string; text: string; container: 'a' | 'b' | 'none' }>;
      domOrder: string[];
    }): Block[] => {
      const tableHolder = document.createElement('div');
      const containerA = document.createElement('div');
      const containerB = document.createElement('div');

      containerA.setAttribute('data-blok-table-cell-blocks', '');
      containerB.setAttribute('data-blok-table-cell-blocks', '');
      tableHolder.append(containerA, containerB);
      document.body.appendChild(tableHolder);

      const holders = new Map<string, HTMLElement>();

      for (const child of options.children) {
        holders.set(child.id, document.createElement('div'));
      }

      for (const id of options.domOrder) {
        const child = options.children.find(candidate => candidate.id === id);
        const holder = holders.get(id);

        if (child === undefined || holder === undefined) {
          continue;
        }
        holder.textContent = child.text;

        if (child.container === 'b') {
          containerB.appendChild(holder);
        } else if (child.container === 'none') {
          tableHolder.appendChild(holder);
        } else {
          containerA.appendChild(holder);
        }
      }

      return [
        createBlockMock({
          id: 'tbl-1',
          tool: 'table',
          data: { withHeadings: false, content: [options.cells] },
          holder: tableHolder,
        }).block,
        ...options.children.map(child => createBlockMock({
          id: child.id,
          tool: 'paragraph',
          data: { text: child.text },
          parentId: 'tbl-1',
          holder: holders.get(child.id),
        }).block),
      ];
    };

    const twoBlockCell = (): Block[] => cellOrderFixture({
      cells: [{ blocks: ['cell-a', 'cell-b'] }],
      children: [
        { id: 'cell-a', text: 'Alpha', container: 'a' },
        { id: 'cell-b', text: 'Beta', container: 'a' },
      ],
      domOrder: ['cell-b', 'cell-a'],
    });

    it('throws for a cell holding exactly two blocks in the wrong order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({ blocks: twoBlockCell() });

      await expect(saver.save()).resolves.toBeUndefined();

      const message = lastErrorMessage(saver);

      expect(message).toContain('table cell block order diverges from the DOM order');
      expect(message).toContain('saves order [cell-a, cell-b]');
      expect(message).toContain('but the DOM shows [cell-b, cell-a]');
    });

    it('lists every diverged cell, not just the first', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: cellOrderFixture({
          cells: [{ blocks: ['cell-a', 'cell-b'] }, { blocks: ['cell-c', 'cell-d'] }],
          children: [
            { id: 'cell-a', text: 'Alpha', container: 'a' },
            { id: 'cell-b', text: 'Beta', container: 'a' },
            { id: 'cell-c', text: 'Gamma', container: 'b' },
            { id: 'cell-d', text: 'Delta', container: 'b' },
          ],
          domOrder: ['cell-b', 'cell-a', 'cell-d', 'cell-c'],
        }),
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('[0,0] saves order [cell-a, cell-b]');
      expect(lastErrorMessage(saver)).toContain('; ');
      expect(lastErrorMessage(saver)).toContain('[0,1] saves order [cell-c, cell-d]');
    });

    it('throws in the development environment for the same cell divergence', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({ blocks: twoBlockCell() });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('table cell block order diverges');
    });

    it('still reports a cell whose first block happens to sit in the right place', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: cellOrderFixture({
          cells: [{ blocks: ['cell-a', 'cell-c', 'cell-b'] }],
          children: [
            { id: 'cell-a', text: 'Alpha', container: 'a' },
            { id: 'cell-b', text: 'Beta', container: 'a' },
            { id: 'cell-c', text: 'Gamma', container: 'a' },
          ],
          domOrder: ['cell-a', 'cell-b', 'cell-c'],
        }),
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(lastErrorMessage(saver)).toContain('saves order [cell-a, cell-c, cell-b]');
    });

    it('does not compare blocks that live in two different cell containers', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: cellOrderFixture({
          cells: [{ blocks: ['cell-a', 'cell-b'] }],
          children: [
            // Container A renders first, so putting cell-a in B reverses the
            // visible order relative to the saved one.
            { id: 'cell-a', text: 'Alpha', container: 'b' },
            { id: 'cell-b', text: 'Beta', container: 'a' },
          ],
          domOrder: ['cell-a', 'cell-b'],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(gridOf(result, 'tbl-1')[0][0]).toStrictEqual({ blocks: ['cell-a', 'cell-b'] });
    });

    it('does not compare blocks mounted outside any cell container', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: cellOrderFixture({
          cells: [{ blocks: ['cell-a', 'cell-b'] }],
          children: [
            { id: 'cell-a', text: 'Alpha', container: 'none' },
            { id: 'cell-b', text: 'Beta', container: 'none' },
          ],
          domOrder: ['cell-b', 'cell-a'],
        }),
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(gridOf(result, 'tbl-1')[0][0]).toStrictEqual({ blocks: ['cell-a', 'cell-b'] });
    });

    it('production: rewrites only the diverged cell and leaves the rest byte-for-byte', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      passthroughSanitizer();
      silenceLogs();
      const { saver } = createSaver({
        blocks: cellOrderFixture({
          cells: [{ blocks: ['cell-a', 'cell-b'] }, { blocks: ['cell-c', 'cell-d'], span: 2 }],
          children: [
            { id: 'cell-a', text: 'Alpha', container: 'a' },
            { id: 'cell-b', text: 'Beta', container: 'a' },
            { id: 'cell-c', text: 'Gamma', container: 'b' },
            { id: 'cell-d', text: 'Delta', container: 'b' },
          ],
          domOrder: ['cell-b', 'cell-a', 'cell-c', 'cell-d'],
        }),
      });

      const result = await saver.save();
      const row = gridOf(result, 'tbl-1')[0];

      expect(row[0]).toStrictEqual({ blocks: ['cell-b', 'cell-a'] });
      expect(row[1]).toStrictEqual({ blocks: ['cell-c', 'cell-d'], span: 2 });
      // A repair that rebuilds every block hands each one an empty grid.
      expect(blockById(result, 'cell-a')?.data).toStrictEqual({ text: 'Alpha' });
    });
  });

  describe('per-block extraction and output shaping', () => {
    it('stamps the empty-document shortcut with a forward-running clock and the real version', async () => {
      vi.useFakeTimers();

      const frozen = new Date('2025-03-04T05:06:07Z');

      vi.setSystemTime(frozen);
      vi.spyOn(utils, 'getBlokVersion').mockReturnValue('9.9.9-test');

      const empty = createBlockMock({
        id: 'empty-1',
        tool: 'paragraph',
        data: { text: '' },
        isEmpty: true,
        isDefault: true,
      });
      const { saver } = createSaver({ blocks: [empty.block] });

      const result = await saver.save();

      expect(result).toStrictEqual({ time: +frozen, blocks: [], version: '9.9.9-test' });
    });

    it('keeps a document whose first block is an empty default paragraph but is not alone', async () => {
      passthroughSanitizer();
      const lead = createBlockMock({
        id: 'empty-lead',
        tool: 'paragraph',
        data: { text: '' },
        isEmpty: true,
        isDefault: true,
      });
      const body = createBlockMock({ id: 'body-1', tool: 'paragraph', data: { text: 'Real content' } });
      const { saver } = createSaver({ blocks: [lead.block, body.block] });

      const result = await saver.save();

      // The empty-document shortcut keys off the block COUNT; keying off the
      // first block alone throws away every document that opens with an empty
      // default paragraph.
      expect(result?.blocks.map(block => block.id)).toStrictEqual(['empty-lead', 'body-1']);
    });

    it('does not report a dangling parent for a document made of root blocks', async () => {
      passthroughSanitizer();
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const { saver } = createSaver({
        blocks: [
          createBlockMock({ id: 'root-1', tool: 'paragraph', data: { text: 'First' } }).block,
          createBlockMock({ id: 'root-2', tool: 'paragraph', data: { text: 'Second' } }).block,
        ],
      });

      await saver.save();

      expect(logLabeledSpy).not.toHaveBeenCalledWith(expect.stringMatching(/dangling parentId/), 'warn');
    });

    it('falls back to the preserved payload, tunes included, when a tool saves no data', async () => {
      passthroughSanitizer();
      silenceLogs();
      const block = createBlockMock({
        id: 'preserved-1',
        tool: 'paragraph',
        saveOmitsData: true,
        preservedData: { text: 'Preserved body' },
        preservedTunes: { alignment: 'right' },
      });
      const { saver } = createSaver({ blocks: [block.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([{
        id: 'preserved-1',
        type: 'paragraph',
        data: { text: 'Preserved body' },
        tunes: { alignment: 'right' },
      }]);
    });

    it('drops a block that saves nothing and has nothing preserved, naming it as invalid', async () => {
      passthroughSanitizer();
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const lost = createBlockMock({ id: 'lost-1', tool: 'paragraph', saveResolvesUndefined: true });
      const kept = createBlockMock({ id: 'kept-1', tool: 'paragraph', data: { text: 'Still here' } });
      const { saver } = createSaver({ blocks: [lost.block, kept.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([{
        id: 'kept-1',
        type: 'paragraph',
        data: { text: 'Still here' },
      }]);
      // The other skip path logs a different sentence; naming the tool proves
      // the invalid-data branch is the one that ran.
      expect(logSpy).toHaveBeenCalledWith('Block «paragraph» skipped because saved data is invalid');
    });

    it('omits tunes, content and edit metadata that carry nothing', async () => {
      passthroughSanitizer();
      const explicitNull = createBlockMock({
        id: 'bare-1',
        tool: 'paragraph',
        data: { text: 'Bare' },
        tunes: {},
        lastEditedBy: null,
      });
      // A block that never recorded an editor carries no lastEditedBy field at
      // all — a different value from the explicit null above.
      const neverEdited = createBlockMock({
        id: 'bare-2',
        tool: 'paragraph',
        data: { text: 'Never edited' },
      });
      const { saver } = createSaver({ blocks: [explicitNull.block, neverEdited.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([
        {
          id: 'bare-1',
          type: 'paragraph',
          data: { text: 'Bare' },
        },
        {
          id: 'bare-2',
          type: 'paragraph',
          data: { text: 'Never edited' },
        },
      ]);
    });

    it('emits a normal block whose payload merely looks like a stub payload', async () => {
      passthroughSanitizer();
      silenceLogs();
      const block = createBlockMock({
        id: 'embed-1',
        tool: 'embed',
        data: { type: 'youtube', data: { url: 'https://example.test/watch' } },
      });
      const { saver } = createSaver({ blocks: [block.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([{
        id: 'embed-1',
        type: 'embed',
        data: { type: 'youtube', data: { url: 'https://example.test/watch' } },
      }]);
    });

    it('drops a stub whose payload is not an object at all', async () => {
      passthroughSanitizer();
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const stub = createBlockMock({ id: 'stub-1', tool: 'stub-tool', data: null });
      const kept = createBlockMock({ id: 'kept-2', tool: 'paragraph', data: { text: 'Neighbour' } });
      const { saver } = createSaver({ blocks: [stub.block, kept.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([{
        id: 'kept-2',
        type: 'paragraph',
        data: { text: 'Neighbour' },
      }]);
      expect(logSpy).toHaveBeenCalledWith('Stub block data is malformed and was skipped');
    });

    it('drops a stub payload that carries a type but no data', async () => {
      passthroughSanitizer();
      silenceLogs();
      const stub = createBlockMock({ id: 'stub-2', tool: 'stub-tool', data: { type: 'legacy-tool' } });
      const { saver } = createSaver({ blocks: [stub.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([]);
    });

    it('drops a stub payload that carries data but no type', async () => {
      passthroughSanitizer();
      silenceLogs();
      const stub = createBlockMock({ id: 'stub-3', tool: 'stub-tool', data: { data: { text: 'Orphaned payload' } } });
      const { saver } = createSaver({ blocks: [stub.block] });

      const result = await saver.save();

      expect(result?.blocks).toStrictEqual([]);
    });
  });

  describe('sanitizer hand-off', () => {
    it('hands the sanitizer only the blocks that actually carry data', async () => {
      silenceLogs();
      const sanitizeSpy = vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const dataless = createBlockMock({ id: 'dataless-2', tool: 'paragraph', saveResolvesUndefined: true });
      const carrier = createBlockMock({ id: 'carrier-1', tool: 'paragraph', data: { text: 'Sanitize me' } });
      const { saver } = createSaver({ blocks: [dataless.block, carrier.block] });

      await saver.save();

      expect(sanitizeSpy).toHaveBeenCalledTimes(1);
      expect(sanitizeSpy.mock.calls[0][0]).toHaveLength(1);
      expect(sanitizeSpy.mock.calls[0][0][0].data).toStrictEqual({ text: 'Sanitize me' });
    });

    it('does not call the sanitizer when no block carries data', async () => {
      silenceLogs();
      const sanitizeSpy = vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const dataless = createBlockMock({ id: 'dataless-3', tool: 'paragraph', saveResolvesUndefined: true });
      const { saver } = createSaver({ blocks: [dataless.block] });

      await saver.save();

      expect(sanitizeSpy).not.toHaveBeenCalled();
    });
  });

  describe('hierarchy drift report', () => {
    it('spells out every violation it found, separated', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      passthroughSanitizer();
      silenceLogs();

      // Two invalid root parents are dropped by makeOutput, orphaning both of
      // their valid children — the drift validateHierarchy reports.
      const blocks = ['ghost-x', 'ghost-y'].flatMap((parentId, index) => [
        createBlockMock({ id: parentId, tool: 'paragraph', data: { text: '' }, isValid: false }).block,
        createBlockMock({
          id: `orphan-${index}`,
          tool: 'paragraph',
          data: { text: `Ejected ${index}` },
          parentId,
        }).block,
      ]);
      const { saver } = createSaver({ blocks });

      await expect(saver.save()).resolves.toBeUndefined();

      const message = lastErrorMessage(saver);

      expect(message).toContain('hierarchy drift');
      expect(message).toContain('orphan-0 references missing parent ghost-x');
      expect(message).toContain('; ');
      expect(message).toContain('orphan-1 references missing parent ghost-y');
    });
  });
});
