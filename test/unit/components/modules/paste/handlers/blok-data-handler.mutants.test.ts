import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlokDataHandler } from '../../../../../../src/components/modules/paste/handlers/blok-data-handler';
import { PatternHandler } from '../../../../../../src/components/modules/paste/handlers/pattern-handler';
import type * as PatternHandlerModule from '../../../../../../src/components/modules/paste/handlers/pattern-handler';
import type { SanitizerConfigBuilder } from '../../../../../../src/components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../../../../../../src/components/modules/paste/tool-registry';
import type { PatternSubstitute } from '../../../../../../src/components/modules/paste/types';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { SanitizerConfig } from '../../../../../../types/configs/sanitizer-config';

const patternHandlerBuilds = vi.hoisted(() => ({ count: 0 }));

/**
 * BlokDataHandler never CALLS the pattern handler it lazily builds — it only
 * constructs it once. Counting constructions is the only way to observe that,
 * and the max length is copied off the real class so the fixture below cannot
 * drift away from the production constant.
 */
vi.mock('../../../../../../src/components/modules/paste/handlers/pattern-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof PatternHandlerModule>();

  return {
    PatternHandler: class {
      public static readonly PATTERN_PROCESSING_MAX_LENGTH = actual.PatternHandler.PATTERN_PROCESSING_MAX_LENGTH;

      public constructor() {
        patternHandlerBuilds.count += 1;
      }
    },
  };
});

interface FakeBlock {
  id: string;
  name: string;
  parentId: string | null;
  contentIds: string[];
}

interface InsertOptions {
  tool: string;
  data: Record<string, unknown>;
  replace?: boolean;
  origin?: string;
}

type FakePasteEvent = CustomEvent<{ key: string; data: string }>;

interface PasteCall {
  tool: string;
  event: FakePasteEvent;
  replace: boolean;
}

interface CurrentBlockFake {
  id: string;
  parentId: string | null;
  isEmpty: boolean;
  tool: { isDefault: boolean };
  holder: HTMLElement;
  currentInput: HTMLElement | null;
}

interface Harness {
  modules: BlokModules;
  inserts: InsertOptions[];
  pastes: PasteCall[];
  blocks: FakeBlock[];
  parentCalls: Array<{ blockId: string; parentId: string | null }>;
  caretCalls: Array<{ blockId: string; position: string }>;
}

interface HarnessOptions {
  /** Sanitize config per tool name. A tool missing here resolves to `undefined`, as an unregistered tool does. */
  sanitizeConfigs?: Record<string, SanitizerConfig>;
  /** Caret sits outside any block: `BlockManager.currentBlock` is undefined. */
  withoutCurrentBlock?: boolean;
  /** Host mock without `transactForTool`, which the handler must still work with. */
  withoutTransact?: boolean;
  currentBlock?: CurrentBlockFake;
}

/**
 * Builds the current block the caret sits on.
 * @param overrides - fields to replace on the default empty default-tool block
 */
const createCurrentBlock = (overrides: Partial<CurrentBlockFake> = {}): CurrentBlockFake => ({
  id: 'current-block',
  parentId: null,
  isEmpty: true,
  tool: { isDefault: true },
  holder: document.createElement('div'),
  currentInput: document.createElement('div'),
  ...overrides,
});

/**
 * Builds the injected editor modules plus the records every assertion reads.
 * @param options - shape of the editor the paste lands in
 */
const createHarness = (options: HarnessOptions = {}): Harness => {
  const inserts: InsertOptions[] = [];
  const pastes: PasteCall[] = [];
  const blocks: FakeBlock[] = [];
  const parentCalls: Array<{ blockId: string; parentId: string | null }> = [];
  const caretCalls: Array<{ blockId: string; position: string }> = [];
  const lookup = new Map<string, FakeBlock>();

  const createBlock = (tool: string): FakeBlock => {
    const block: FakeBlock = {
      id: `new-${blocks.length}`,
      name: tool,
      parentId: null,
      contentIds: [],
    };

    blocks.push(block);
    lookup.set(block.id, block);

    return block;
  };

  /** Mirrors the real reparent API: splice out of the old parent, push into the new one. */
  const setBlockParent = (block: FakeBlock, parentId: string | null): void => {
    parentCalls.push({ blockId: block.id,
      parentId });

    const target = block;
    const previousParent = target.parentId === null ? undefined : lookup.get(target.parentId);

    if (previousParent !== undefined) {
      previousParent.contentIds = previousParent.contentIds.filter(id => id !== target.id);
    }

    target.parentId = parentId;

    const nextParent = parentId === null ? undefined : lookup.get(parentId);

    if (nextParent !== undefined && !nextParent.contentIds.includes(block.id)) {
      nextParent.contentIds = [...nextParent.contentIds, block.id];
    }
  };

  const transact = options.withoutTransact === true
    ? {}
    : { transactForTool: (fn: () => void): void => fn() };

  const modules = {
    BlockManager: {
      currentBlock: options.withoutCurrentBlock === true
        ? undefined
        : (options.currentBlock ?? createCurrentBlock()),
      insert: (insertOptions: InsertOptions): FakeBlock => {
        inserts.push(insertOptions);

        return createBlock(insertOptions.tool);
      },
      paste: (tool: string, event: FakePasteEvent, replace: boolean): Promise<FakeBlock> => {
        pastes.push({ tool,
          event,
          replace });

        return Promise.resolve(createBlock(tool));
      },
      setBlockParent,
      ...transact,
    },
    Caret: {
      setToBlock: (block: FakeBlock, position: string): void => {
        caretCalls.push({ blockId: block.id,
          position });
      },
      positions: { END: 'end' },
    },
    Tools: {
      blockTools: {
        get: (name: string): { sanitizeConfig: SanitizerConfig } | undefined => {
          const config = options.sanitizeConfigs?.[name];

          return config === undefined ? undefined : { sanitizeConfig: config };
        },
      },
    },
  } as unknown as BlokModules;

  return { modules,
    inserts,
    pastes,
    blocks,
    parentCalls,
    caretCalls };
};

const linkPattern = {
  key: 'link',
  pattern: /^https?:\/\/\S+$/,
  tool: { name: 'link' },
  priority: 0,
} as unknown as PatternSubstitute;

/**
 * Builds a tool registry fake.
 * @param patterns - what `toolsPatterns` reports
 * @param match - what `findToolForPattern` answers for any input
 */
const createRegistry = (patterns: PatternSubstitute[] = [], match?: PatternSubstitute): ToolRegistry => ({
  toolsPatterns: patterns,
  findToolForPattern: (): PatternSubstitute | undefined => match,
} as unknown as ToolRegistry);

/**
 * Builds the handler under test.
 * @param harness - injected editor modules
 * @param registry - injected tool registry
 */
const createHandler = (harness: Harness, registry: ToolRegistry = createRegistry()): BlokDataHandler =>
  new BlokDataHandler(harness.modules, registry, {} as unknown as SanitizerConfigBuilder, { sanitizer: {} });

describe('BlokDataHandler — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patternHandlerBuilds.count = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('canHandle', () => {
    it('scores parseable JSON strings 100 and everything else 0', () => {
      const handler = createHandler(createHarness());

      expect(handler.canHandle('[{"tool":"paragraph"}]')).toBe(100);
      expect(handler.canHandle('not json at all')).toBe(0);
      // A number is not a string, yet `JSON.parse(42)` succeeds — the typeof
      // guard is what keeps it at 0.
      expect(handler.canHandle(42)).toBe(0);
    });
  });

  describe('handle dispatch', () => {
    it('returns false for non-string data without touching the editor', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      await expect(handler.handle(42, { canReplaceCurrentBlock: false })).resolves.toBe(false);
      expect(harness.inserts).toEqual([]);
    });

    it('inserts every block in document order, tagged as a paste, without replacing', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      const result = await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'One' } },
        { id: 'b2',
          tool: 'paragraph',
          data: { text: 'Two' } },
      ]), { canReplaceCurrentBlock: false });

      expect(result).toBe(true);
      expect(harness.inserts.map(insert => insert.data.text)).toEqual(['One', 'Two']);
      expect(harness.inserts.map(insert => insert.replace)).toEqual([false, false]);
      expect(harness.inserts.map(insert => insert.origin)).toEqual(['paste', 'paste']);
      expect(harness.caretCalls).toEqual(harness.blocks.map(block => ({ blockId: block.id,
        position: 'end' })));
      expect(harness.parentCalls).toEqual([]);
    });

    it('replaces only the first block when the caret block is an empty default block', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'One' } },
        { id: 'b2',
          tool: 'paragraph',
          data: { text: 'Two' } },
      ]), { canReplaceCurrentBlock: true });

      expect(harness.inserts.map(insert => insert.replace)).toEqual([true, false]);
    });

    it('inserts without a current block instead of dereferencing it', async () => {
      const harness = createHarness({ withoutCurrentBlock: true });
      const handler = createHandler(harness);

      const result = await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'One' } },
      ]), { canReplaceCurrentBlock: true });

      expect(result).toBe(true);
      expect(harness.inserts.map(insert => insert.replace)).toEqual([false]);
      expect(harness.parentCalls).toEqual([]);
    });

    it('runs the insert passes directly when the host exposes no transactForTool', async () => {
      const harness = createHarness({ withoutTransact: true });
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'One' } },
        { id: 'b2',
          tool: 'paragraph',
          data: { text: 'Two' } },
      ]), { canReplaceCurrentBlock: false });

      expect(harness.inserts.map(insert => insert.data.text)).toEqual(['One', 'Two']);
    });
  });

  describe('container membership of pasted roots', () => {
    it('adopts parentless roots into the container whose title holds the caret', async () => {
      const holder = document.createElement('div');
      const title = document.createElement('div');
      const children = document.createElement('div');

      children.setAttribute('data-blok-toggle-children', '');
      holder.append(title, children);

      const harness = createHarness({
        currentBlock: createCurrentBlock({ id: 'container-1',
          holder,
          currentInput: title }),
      });
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 'r1',
          tool: 'paragraph',
          data: { text: 'Root A' } },
        { id: 'r2',
          tool: 'paragraph',
          data: { text: 'Root B' },
          parentId: null },
        { id: 'r3',
          tool: 'paragraph',
          data: { text: 'Child' },
          parentId: 'r1' },
      ]), { canReplaceCurrentBlock: false });

      const [rootA, rootB, child] = harness.blocks;

      // Roots without a clipboard parent (absent OR null) join the container;
      // the clipboard's own edge wins for the child.
      expect(harness.parentCalls).toEqual([
        { blockId: rootA.id,
          parentId: 'container-1' },
        { blockId: rootB.id,
          parentId: 'container-1' },
        { blockId: child.id,
          parentId: rootA.id },
      ]);
    });

    it('inherits the caret block own parent when the caret is inside the container children', async () => {
      const holder = document.createElement('div');
      const children = document.createElement('div');
      const input = document.createElement('div');

      children.setAttribute('data-blok-toggle-children', '');
      children.append(input);
      holder.append(children);

      const harness = createHarness({
        currentBlock: createCurrentBlock({ id: 'container-1',
          parentId: 'outer-parent',
          holder,
          currentInput: input }),
      });
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 'r1',
          tool: 'paragraph',
          data: { text: 'Root' } },
      ]), { canReplaceCurrentBlock: false });

      expect(harness.parentCalls).toEqual([
        { blockId: harness.blocks[0].id,
          parentId: 'outer-parent' },
      ]);
    });
  });

  describe('table cell children', () => {
    it('inserts cells first, remaps the table references and leaves other values untouched', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        {
          id: 't1',
          tool: 'table',
          data: {
            content: [[{ blocks: ['c1'] }]],
            colWidths: [50],
            caption: null,
          },
        },
        { id: 'c1',
          tool: 'paragraph',
          data: { text: 'Cell' },
          parentId: 't1' },
      ]), { canReplaceCurrentBlock: true });

      const [cell, table] = harness.blocks;

      expect(harness.inserts.map(insert => insert.tool)).toEqual(['paragraph', 'table']);
      expect(harness.inserts.map(insert => insert.origin)).toEqual(['paste', 'paste']);
      // A pre-inserted cell must not be the block that gets replaced.
      expect(harness.inserts[1].replace).toBe(false);

      const tableData = harness.inserts[1].data as {
        content: Array<Array<{ blocks: string[] }>>;
        colWidths: number[];
        caption: null;
      };

      expect(tableData.content[0][0].blocks).toEqual([cell.id]);
      expect(tableData.colWidths).toEqual([50]);
      expect(tableData.caption).toBeNull();

      expect(harness.parentCalls).toEqual([
        { blockId: cell.id,
          parentId: table.id },
      ]);
      expect(harness.caretCalls).toEqual([
        { blockId: cell.id,
          position: 'end' },
        { blockId: table.id,
          position: 'end' },
      ]);
    });

    it('backfills a parent only for cell children that declare none', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        {
          id: 't1',
          tool: 'table',
          data: { content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }]] },
        },
        { id: 'c1',
          tool: 'paragraph',
          data: { text: 'C1' },
          parentId: 'other' },
        { id: 'c2',
          tool: 'paragraph',
          data: { text: 'C2' },
          parentId: null },
        { id: 'other',
          tool: 'paragraph',
          data: { text: 'Other' } },
      ]), { canReplaceCurrentBlock: false });

      // c2 declares no real parent, so it is adopted by the table and inserted
      // in pass 1. c1 already belongs to another pasted block and stays in
      // document flow.
      expect(harness.inserts.map(insert => insert.tool === 'table' ? 'table' : insert.data.text))
        .toEqual(['C2', 'table', 'C1', 'Other']);

      const [cellTwo, table, cellOne, other] = harness.blocks;

      expect(harness.parentCalls).toEqual([
        { blockId: cellTwo.id,
          parentId: table.id },
        { blockId: cellOne.id,
          parentId: other.id },
      ]);
    });

    it('ignores cell references that are not strings', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 't1',
          tool: 'table',
          data: { content: [[{ blocks: [42] }]] } },
        { id: 42,
          tool: 'paragraph',
          data: { text: 'Numbered' } },
      ]), { canReplaceCurrentBlock: false });

      expect(harness.inserts.map(insert => insert.tool)).toEqual(['table', 'paragraph']);
      expect(harness.parentCalls).toEqual([]);
    });

    it('reads cell references from tables only', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 'p1',
          tool: 'paragraph',
          data: { content: [[{ blocks: ['x1'] }]] } },
        { id: 'x1',
          tool: 'paragraph',
          data: { text: 'X' } },
      ]), { canReplaceCurrentBlock: false });

      expect(harness.inserts.map(insert => insert.tool)).toEqual(['paragraph', 'paragraph']);
      expect(harness.parentCalls).toEqual([]);
    });

    it('tolerates malformed table payloads', async () => {
      const payloads = [
        '[{"id":"t","tool":"table","data":{"content":[[null]]}}]',
        '[{"id":"t","tool":"table"}]',
        '[{"id":"t","tool":"table","data":{}}]',
        '[{"id":"t","tool":"table","data":{"content":["not-a-row"]}}]',
      ];

      for (const payload of payloads) {
        const harness = createHarness();
        const handler = createHandler(harness);

        await expect(handler.handle(payload, { canReplaceCurrentBlock: false })).resolves.toBe(true);
        expect(harness.inserts).toHaveLength(1);
      }
    });
  });

  describe('foreign clipboard payloads', () => {
    it('never treats a missing or null id as a hierarchy edge', async () => {
      const harness = createHarness();
      const handler = createHandler(harness);

      // Clipboard JSON is foreign data: `null` and absent ids are legal there
      // and must not become map keys that blocks get reparented onto.
      await handler.handle(JSON.stringify([
        { id: null,
          tool: 'table',
          data: { content: [] } },
        { id: 'p1',
          tool: 'paragraph',
          data: { text: 'A' },
          parentId: null },
        { tool: 'paragraph',
          data: { text: 'B' } },
      ]), { canReplaceCurrentBlock: false });

      expect(harness.inserts.map(insert => insert.tool)).toEqual(['table', 'paragraph', 'paragraph']);
      expect(harness.inserts.map(insert => insert.replace)).toEqual([false, false, false]);
      expect(harness.parentCalls).toEqual([]);
      expect(harness.blocks.map(block => block.parentId)).toEqual([null, null, null]);
    });
  });

  describe('sanitization', () => {
    it('cleans each block with its own tool config and leaves configless tools alone', async () => {
      const harness = createHarness({
        sanitizeConfigs: { paragraph: { text: { b: true } } },
      });
      const handler = createHandler(harness);

      await handler.handle(JSON.stringify([
        { id: 's1',
          tool: 'paragraph',
          data: { text: '<b>keep</b><i>drop</i>' } },
        { id: 's2',
          tool: 'quote',
          data: { text: '<b>keep</b><i>stay</i>' } },
      ]), { canReplaceCurrentBlock: false });

      expect(harness.inserts.map(insert => insert.data.text)).toEqual([
        '<b>keep</b>drop',
        '<b>keep</b><i>stay</i>',
      ]);
    });
  });

  describe('pattern matching before Blok JSON', () => {
    it('pastes the matched pattern instead of the JSON blocks', async () => {
      const harness = createHarness();
      const handler = createHandler(harness, createRegistry([linkPattern], linkPattern));

      const result = await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'JSON fallback' } },
      ]), { canReplaceCurrentBlock: true,
        plainData: 'https://example.com' });

      expect(result).toBe(true);
      expect(harness.inserts).toEqual([]);
      expect(harness.pastes).toHaveLength(1);
      expect(harness.pastes[0].tool).toBe('link');
      expect(harness.pastes[0].replace).toBe(true);
      expect(harness.pastes[0].event.type).toBe('pattern');
      expect(harness.pastes[0].event.detail).toEqual({ key: 'link',
        data: 'https://example.com' });
      expect(harness.caretCalls).toEqual([
        { blockId: harness.blocks[0].id,
          position: 'end' },
      ]);
    });

    it('builds the pattern handler once across repeated pattern pastes', async () => {
      const harness = createHarness();
      const handler = createHandler(harness, createRegistry([linkPattern], linkPattern));
      const context = { canReplaceCurrentBlock: false,
        plainData: 'https://example.com' };
      const json = JSON.stringify([{ id: 'b1',
        tool: 'paragraph',
        data: { text: 'JSON fallback' } }]);

      await handler.handle(json, context);
      await handler.handle(json, context);

      expect(patternHandlerBuilds.count).toBe(1);
    });

    it('inserts the JSON blocks when the paste carries no plain text', async () => {
      const harness = createHarness();
      const handler = createHandler(harness, createRegistry([linkPattern], linkPattern));

      const result = await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'JSON' } },
      ]), { canReplaceCurrentBlock: false });

      expect(result).toBe(true);
      expect(harness.pastes).toEqual([]);
      expect(harness.inserts.map(insert => insert.data.text)).toEqual(['JSON']);
    });

    it('inserts the JSON blocks when no tool claims the plain text', async () => {
      const harness = createHarness();
      const handler = createHandler(harness, createRegistry([linkPattern]));

      const result = await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'JSON' } },
      ]), { canReplaceCurrentBlock: false,
        plainData: 'plain words' });

      expect(result).toBe(true);
      expect(harness.pastes).toEqual([]);
      expect(harness.inserts.map(insert => insert.data.text)).toEqual(['JSON']);
    });

    it('skips pattern matching when no tool registered a pattern', async () => {
      const harness = createHarness();
      // A registry with no patterns still answers findToolForPattern; the
      // emptiness of toolsPatterns is what must gate the pattern pass.
      const handler = createHandler(harness, createRegistry([], linkPattern));

      await handler.handle(JSON.stringify([
        { id: 'b1',
          tool: 'paragraph',
          data: { text: 'JSON' } },
      ]), { canReplaceCurrentBlock: false,
        plainData: 'https://example.com' });

      expect(harness.pastes).toEqual([]);
      expect(harness.inserts.map(insert => insert.data.text)).toEqual(['JSON']);
    });

    it('pattern-matches text at the length limit and skips it beyond', async () => {
      const atLimit = 'h'.repeat(PatternHandler.PATTERN_PROCESSING_MAX_LENGTH);
      const overLimit = 'h'.repeat(PatternHandler.PATTERN_PROCESSING_MAX_LENGTH + 1);
      const json = JSON.stringify([{ id: 'b1',
        tool: 'paragraph',
        data: { text: 'JSON' } }]);

      const atLimitHarness = createHarness();
      const atLimitHandler = createHandler(atLimitHarness, createRegistry([linkPattern], linkPattern));

      await atLimitHandler.handle(json, { canReplaceCurrentBlock: false,
        plainData: atLimit });

      expect(atLimitHarness.pastes).toHaveLength(1);
      expect(atLimitHarness.inserts).toEqual([]);

      const overLimitHarness = createHarness();
      const overLimitHandler = createHandler(overLimitHarness, createRegistry([linkPattern], linkPattern));

      await overLimitHandler.handle(json, { canReplaceCurrentBlock: false,
        plainData: overLimit });

      expect(overLimitHarness.pastes).toEqual([]);
      expect(overLimitHarness.inserts.map(insert => insert.data.text)).toEqual(['JSON']);
    });
  });
});
