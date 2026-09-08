/**
 * Mutation-directed tests for the Renderer module: 43 of the 47 recorded live
 * mutants die here. The four that stay alive are equivalent.
 *
 * 1. Line 183, `this.config.dataModel || 'auto'` falling back to the empty
 *    string. `dataModelConfig` has exactly one consumer,
 *    `shouldExpandToHierarchical`, which only asks whether the value differs
 *    from `legacy`. Both `auto` and the empty string answer yes, so the
 *    expansion decision is the same for every input.
 *
 * 2. Line 219, `incomingId !== undefined` replaced by `true`. The mutant can
 *    only diverge when the id is undefined, and then the result hangs on
 *    `seenIds.has(undefined)`. `seenIds` is fed on line 228 alone, behind an
 *    `id !== undefined` guard, so undefined is never a member and the flag
 *    stays false either way.
 *
 * 3. Line 227, `if (id !== undefined)` replaced by `true`, which stores
 *    undefined in `seenIds` for a block that carried no id. The set has one
 *    reader, line 219, and that read is itself guarded by
 *    `incomingId !== undefined`, so the extra member can never be looked up.
 *
 * 4. Line 252, `aliasTarget !== undefined` replaced by `true`. The mutant only
 *    diverges when the tool has no alias entry, and then it asks
 *    `Tools.available.has(undefined)`. `Tools.available` is a `ToolsCollection`,
 *    declared as `Map<string, ToolClass>` and keyed by tool names, so that
 *    lookup is always false and both versions fall through to the stub tool.
 *
 * Techniques that made the rest observable: a partial module mock of
 * `migrateBlocks` (so the "no migrations configured" skip and the failure
 * callback are both visible), a partial mock of `migrateMarkColors`, a
 * `requestIdleCallback` stub that runs its callback inline and records its
 * options, a `YjsManager.toJSON` that returns different blocks from the caller
 * so the render source is identifiable by block id, reference identity on the
 * stub payload to prove it is not re-sanitized, and a `composeBlock` that
 * throws for the real tool to reach the error fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Renderer } from '../../../../src/components/modules/renderer';
import * as utils from '../../../../src/components/utils';
import type { OutputBlockData } from '../../../../types';
import type { BlockMigrations } from '../../../../src/components/migration/block-migrations';

interface BlockMigrationsModule {
  migrateBlocks: (
    blocks: OutputBlockData[],
    migrations: BlockMigrations,
    onError?: (type: string, error: unknown) => void
  ) => OutputBlockData[];
}

interface ColorMigrationModule {
  migrateMarkColors: (container: Element) => void;
}

const migrationStub = vi.hoisted(() => ({
  calls: [] as Array<{ blocks: unknown; migrations: unknown }>,
  failure: null as { type: string; error: unknown } | null,
}));

const markColorStub = vi.hoisted(() => ({
  containers: [] as Element[],
}));

vi.mock('../../../../src/components/migration/block-migrations', async (importOriginal) => {
  const actual = await importOriginal<BlockMigrationsModule>();

  return {
    ...actual,
    migrateBlocks: (
      blocks: OutputBlockData[],
      migrations: BlockMigrations,
      onError?: (type: string, error: unknown) => void
    ): OutputBlockData[] => {
      migrationStub.calls.push({
        blocks,
        migrations,
      });

      if (migrationStub.failure !== null && onError !== undefined) {
        onError(migrationStub.failure.type, migrationStub.failure.error);
      }

      return blocks;
    },
  };
});

vi.mock('../../../../src/components/utils/color-migration', async (importOriginal) => {
  const actual = await importOriginal<ColorMigrationModule>();

  return {
    ...actual,
    migrateMarkColors: (container: Element): void => {
      markColorStub.containers.push(container);
    },
  };
});

type RendererBlok = Renderer['Blok'];
type RendererConfig = Renderer['config'];
type ComposeBlock = RendererBlok['BlockManager']['composeBlock'];
type ComposeBlockArgs = Parameters<ComposeBlock>[0];
type ComposeBlockReturn = ReturnType<ComposeBlock>;
type InsertBlock = RendererBlok['BlockManager']['insert'];
type InsertMany = RendererBlok['BlockManager']['insertMany'];
type RequestIdleCallbackFn = Window['requestIdleCallback'];

interface MockTools {
  available: Map<string, unknown>;
  unavailable: Map<string, { toolbox?: Array<{ title?: string }> }>;
  blockTools: Map<string, { sanitizeConfig?: Record<string, unknown> }>;
  stubTool: string;
}

interface CollaborationStub {
  isEnabled?: boolean;
  isDegraded?: boolean;
}

interface RendererHarness {
  renderer: Renderer;
  composeBlock: Mock<ComposeBlock>;
  insert: Mock<InsertBlock>;
  insertMany: Mock<InsertMany>;
  tools: MockTools;
  redactor: HTMLElement;
  emit: Mock<(...args: unknown[]) => void>;
}

const createComposedBlock = (id: string | undefined, tool: string): ComposeBlockReturn => ({
  id,
  tool,
} as unknown as ComposeBlockReturn);

const createRenderer = (options: {
  config?: RendererConfig;
  collaboration?: CollaborationStub;
  yjsBlocks?: OutputBlockData[];
  composeBlock?: Mock<ComposeBlock>;
} = {}): RendererHarness => {
  const composeBlock = options.composeBlock ?? vi.fn<ComposeBlock>(
    (composeOptions) => createComposedBlock(composeOptions.id, composeOptions.tool)
  );
  const insert = vi.fn<InsertBlock>(() => createComposedBlock('inserted', 'paragraph'));
  const insertMany = vi.fn<InsertMany>(() => undefined);
  const emit = vi.fn<(...args: unknown[]) => void>();

  const tools: MockTools = {
    available: new Map<string, unknown>(),
    unavailable: new Map<string, { toolbox?: Array<{ title?: string }> }>(),
    blockTools: new Map<string, { sanitizeConfig?: Record<string, unknown> }>(),
    stubTool: 'stub-tool',
  };

  const renderer = new Renderer({
    config: options.config ?? {},
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
      emit,
    } as unknown as Renderer['eventsDispatcher'],
  });

  const redactor = document.createElement('div');
  const wrapper = document.createElement('div');

  const blokState = {
    BlockManager: {
      insert,
      insertMany,
      composeBlock,
    },
    Tools: tools,
    Collaboration: options.collaboration,
    YjsManager: {
      toJSON: (): OutputBlockData[] => options.yjsBlocks ?? [],
    },
    API: {
      methods: {},
    },
    UI: {
      nodes: {
        redactor,
        wrapper,
      },
    },
  };

  renderer.state = blokState as unknown as RendererBlok;

  return {
    renderer,
    composeBlock,
    insert,
    insertMany,
    tools,
    redactor,
    emit,
  };
};

/** Reads `savedData.data` out of a stub payload without widening its type. */
const stubPayloadData = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const savedData = (value as { savedData?: unknown }).savedData;

  if (typeof savedData !== 'object' || savedData === null) {
    return undefined;
  }

  return (savedData as { data?: unknown }).data;
};

/** Reads `title` out of a stub payload. */
const stubPayloadTitle = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as { title?: unknown }).title;
};

const firstComposeArgs = (composeBlock: Mock<ComposeBlock>): ComposeBlockArgs => {
  const call = composeBlock.mock.calls[0];

  if (call === undefined) {
    throw new Error('composeBlock was never called');
  }

  return call[0];
};

let originalRequestIdleCallback: RequestIdleCallbackFn;
let requestIdleCallbackMock: Mock<RequestIdleCallbackFn>;

const setRequestIdleCallback = (value: RequestIdleCallbackFn): void => {
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value,
  });
};

describe('Renderer mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    migrationStub.calls.length = 0;
    migrationStub.failure = null;
    markColorStub.containers.length = 0;

    originalRequestIdleCallback = window.requestIdleCallback;
    requestIdleCallbackMock = vi.fn<RequestIdleCallbackFn>((callback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 0,
      });

      return 0;
    });
    setRequestIdleCallback(requestIdleCallbackMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setRequestIdleCallback(originalRequestIdleCallback);
  });

  describe('render lifecycle markers', () => {
    it('publishes a pending promise while a render is in flight', () => {
      const { renderer } = createRenderer();

      renderer.markRenderStart();

      expect(renderer.pendingRender).toBeInstanceOf(Promise);
    });

    it('resolves and clears the pending promise when the render ends', async () => {
      const { renderer } = createRenderer();

      renderer.markRenderStart();

      const pending = renderer.pendingRender;

      renderer.markRenderEnd();

      expect(renderer.pendingRender).toBeNull();

      const outcome = await Promise.race([
        pending === null ? Promise.resolve('missing') : pending.then(() => 'resolved'),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('stuck'), 25);
        }),
      ]);

      expect(outcome).toBe('resolved');
    });

    it('ignores a render end that no render start preceded', () => {
      const { renderer } = createRenderer();

      renderer.markRenderEnd();

      expect(renderer.pendingRender).toBeNull();
    });
  });

  describe('detected input format', () => {
    it('reports the flat format before anything is rendered', () => {
      const { renderer } = createRenderer();

      expect(renderer.getDetectedInputFormat()).toBe('flat');
    });
  });

  describe('empty documents', () => {
    it('seeds a default block when collaboration is off', async () => {
      const { renderer, insert } = createRenderer();

      await renderer.render([]);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledWith({ origin: 'load' });
    });

    it('leaves an empty collaborative document to the seeder', async () => {
      const { renderer, insert, insertMany } = createRenderer({
        collaboration: { isEnabled: true },
      });

      await renderer.render([]);

      expect(insert).not.toHaveBeenCalled();
      expect(insertMany).not.toHaveBeenCalled();
    });

    it('waits for an idle callback with a two second timeout', async () => {
      const { renderer } = createRenderer();

      await renderer.render([]);

      expect(requestIdleCallbackMock).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    });
  });

  describe('host migrations', () => {
    const migrations: BlockMigrations = {
      paragraph: (data) => data,
    };

    it('runs the host migration pass over the raw blocks', async () => {
      const { renderer, tools } = createRenderer({ config: { migrations } });

      tools.available.set('paragraph', {});

      const blocks: OutputBlockData[] = [
        {
          id: 'a',
          type: 'paragraph',
          data: { text: 'hi' },
        },
      ];

      await renderer.render(blocks);

      expect(migrationStub.calls).toHaveLength(1);
      expect(migrationStub.calls[0]?.migrations).toBe(migrations);
    });

    it('skips the migration pass when the host configured none', async () => {
      const { renderer, tools } = createRenderer();

      tools.available.set('paragraph', {});

      await renderer.render([
        {
          id: 'a',
          type: 'paragraph',
          data: { text: 'hi' },
        },
      ]);

      expect(migrationStub.calls).toHaveLength(0);
    });

    it('warns with the failing block type when a migration rule throws', async () => {
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const error = new Error('rule exploded');

      migrationStub.failure = {
        type: 'paragraph',
        error,
      };

      const { renderer, tools } = createRenderer({ config: { migrations } });

      tools.available.set('paragraph', {});

      await renderer.render([
        {
          id: 'a',
          type: 'paragraph',
          data: { text: 'hi' },
        },
      ]);

      expect(logLabeledSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migration for «paragraph» blocks failed'),
        'warn',
        error
      );
    });
  });

  describe('data model expansion', () => {
    const legacyBlocks = (): OutputBlockData[] => [
      {
        id: 'list-1',
        type: 'list',
        data: {
          style: 'unordered',
          items: [
            { content: 'one' },
            { content: 'two' },
          ],
        },
      },
    ];

    it('expands legacy data under the default data model', async () => {
      const { renderer, composeBlock, tools } = createRenderer();

      tools.available.set('list', {});

      await renderer.render(legacyBlocks());

      expect(composeBlock.mock.calls.length).toBeGreaterThan(1);
      expect(renderer.getDetectedInputFormat()).toBe('legacy');
    });

    it('keeps legacy data unexpanded when the host pinned the legacy model', async () => {
      const { renderer, composeBlock, tools } = createRenderer({
        config: { dataModel: 'legacy' },
      });

      tools.available.set('list', {});

      await renderer.render(legacyBlocks());

      expect(composeBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('stored block data', () => {
    it('falls back to an empty object when block data is not an object', async () => {
      const { renderer, composeBlock, tools } = createRenderer();

      tools.available.set('paragraph', {});

      // The stored shape is untrusted: a scalar `data` is expressible in saved
      // JSON even though the published type forbids it.
      const scalarDataBlock = {
        id: 'a',
        type: 'paragraph',
        data: 'not an object',
      } as unknown as OutputBlockData;

      await renderer.render([ scalarDataBlock ]);

      expect(firstComposeArgs(composeBlock).data).toEqual({});
    });
  });

  describe('unavailable tools', () => {
    const ghostBlock = (data: Record<string, unknown>): OutputBlockData[] => [
      {
        id: 'ghost-1',
        type: 'ghost',
        data,
      },
    ];

    it('titles the stub with the toolbox title of the unavailable tool', async () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { renderer, composeBlock, tools } = createRenderer();

      tools.unavailable.set('ghost', { toolbox: [{ title: 'Ghost Tool' }] });

      await renderer.render(ghostBlock({ text: 'x' }));

      const args = firstComposeArgs(composeBlock);

      expect(args.tool).toBe('stub-tool');
      expect(stubPayloadTitle(args.data)).toBe('Ghost Tool');
    });

    it('titles the stub with the tool name when the tool declares no toolbox', async () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { renderer, composeBlock, tools } = createRenderer();

      tools.unavailable.set('ghost', {});

      await renderer.render(ghostBlock({ text: 'x' }));

      expect(stubPayloadTitle(firstComposeArgs(composeBlock).data)).toBe('ghost');
    });

    it('titles the stub with the tool name when the toolbox entry has no title', async () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { renderer, composeBlock, tools } = createRenderer();

      tools.unavailable.set('ghost', { toolbox: [{}] });

      await renderer.render(ghostBlock({ text: 'x' }));

      expect(stubPayloadTitle(firstComposeArgs(composeBlock).data)).toBe('ghost');
    });

    it('hands the stub its original payload untouched', async () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { renderer, composeBlock, tools } = createRenderer();

      tools.unavailable.set('ghost', {});

      const storedData = { link: 'javascript:alert(1)' };

      await renderer.render(ghostBlock(storedData));

      expect(stubPayloadData(firstComposeArgs(composeBlock).data)).toBe(storedData);
    });

    it('stubs a block whose tool throws, still on the load origin', async () => {
      vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const composeBlock = vi.fn<ComposeBlock>((composeOptions) => {
        if (composeOptions.tool !== 'stub-tool') {
          throw new Error('tool exploded');
        }

        return createComposedBlock(composeOptions.id, composeOptions.tool);
      });

      const { renderer, tools } = createRenderer({ composeBlock });

      tools.available.set('paragraph', {});

      await renderer.render([
        {
          id: 'a',
          type: 'paragraph',
          data: { text: 'hi' },
        },
      ]);

      const fallback = composeBlock.mock.calls[1];

      expect(fallback?.[0]).toMatchObject({
        tool: 'stub-tool',
        origin: 'load',
      });
    });
  });

  describe('insertion side effects', () => {
    it('forwards the skipYjsSync flag to insertMany', async () => {
      const { renderer, insertMany, tools } = createRenderer();

      tools.available.set('paragraph', {});

      await renderer.render(
        [
          {
            id: 'a',
            type: 'paragraph',
            data: { text: 'hi' },
          },
        ],
        { skipYjsSync: true }
      );

      expect(insertMany).toHaveBeenCalledWith(expect.anything(), 0, { skipYjsSync: true });
    });

    it('migrates legacy mark colors in the redactor after inserting', async () => {
      const { renderer, redactor, tools } = createRenderer();

      tools.available.set('paragraph', {});

      await renderer.render([
        {
          id: 'a',
          type: 'paragraph',
          data: { text: 'hi' },
        },
      ]);

      expect(markColorStub.containers).toEqual([redactor]);
    });
  });

  describe('render source under collaboration', () => {
    const callerBlocks = (): OutputBlockData[] => [
      {
        id: 'caller',
        type: 'paragraph',
        data: { text: 'caller' },
      },
    ];

    const yjsBlocks = (): OutputBlockData[] => [
      {
        id: 'document',
        type: 'paragraph',
        data: { text: 'document' },
      },
    ];

    it('rebuilds the view from the shared document', async () => {
      const { renderer, composeBlock, tools } = createRenderer({
        collaboration: { isEnabled: true },
        yjsBlocks: yjsBlocks(),
      });

      tools.available.set('paragraph', {});

      await renderer.render(callerBlocks(), { skipYjsSync: true });

      expect(firstComposeArgs(composeBlock).id).toBe('document');
    });

    it('keeps the caller blocks when collaboration is off', async () => {
      const { renderer, composeBlock, tools } = createRenderer({
        yjsBlocks: yjsBlocks(),
      });

      tools.available.set('paragraph', {});

      await renderer.render(callerBlocks(), { skipYjsSync: true });

      expect(firstComposeArgs(composeBlock).id).toBe('caller');
    });

    it('keeps the caller blocks while the degraded view is on screen', async () => {
      const { renderer, composeBlock, tools } = createRenderer({
        collaboration: {
          isEnabled: true,
          isDegraded: true,
        },
        yjsBlocks: yjsBlocks(),
      });

      tools.available.set('paragraph', {});

      await renderer.render(callerBlocks(), { skipYjsSync: true });

      expect(firstComposeArgs(composeBlock).id).toBe('caller');
    });

    it('keeps the caller blocks for a render that is not a view rebuild', async () => {
      const { renderer, composeBlock, tools } = createRenderer({
        collaboration: { isEnabled: true },
        yjsBlocks: yjsBlocks(),
      });

      tools.available.set('paragraph', {});

      await renderer.render(callerBlocks());

      expect(firstComposeArgs(composeBlock).id).toBe('caller');
    });
  });
});
