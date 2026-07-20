import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HtmlHandler } from '../../../../../src/components/modules/paste/handlers/html-handler';
import { COLUMNS_CANDIDATE_ATTR } from '../../../../../src/components/modules/paste/constants';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

function makeToolStub(name: string, tags: string[]) {
  return {
    name,
    pasteConfig: { tags },
    baseSanitizeConfig: {},
    isDefault: name === 'paragraph',
  };
}

function makeRegistry(tools: ReturnType<typeof makeToolStub>[]): ToolRegistry {
  const toolsTags: Record<string, { tool: unknown; sanitizationConfig: null }> = {};
  const tagsByTool: Record<string, string[]> = {};

  for (const tool of tools) {
    const tags = tool.pasteConfig?.tags ?? [];

    for (const tag of tags) {
      toolsTags[tag.toUpperCase()] = { tool, sanitizationConfig: null };
    }
    tagsByTool[tool.name] = tags.map((t) => t.toUpperCase());
  }

  return {
    toolsTags,
    tagsByTool,
    findToolForTag: (tag: string) => {
      const entry = toolsTags[tag.toUpperCase()];

      return entry ? { tool: entry.tool as ReturnType<typeof makeToolStub>, sanitizationConfig: null } : null;
    },
    getToolTags: (toolName: string) => tagsByTool[toolName] ?? [],
    isException: () => false,
    toolsPatterns: [],
    toolsFiles: {},
    processTools: async () => {},
  } as unknown as ToolRegistry;
}

function makeSanitizerBuilder(): SanitizerConfigBuilder {
  return {
    getStructuralTagsConfig: () => ({}),
    buildToolsTagsConfig: () => ({}),
    buildToolConfig: () => ({}),
    composeConfigs: (...configs: Record<string, unknown>[]) => Object.assign({}, ...configs) as Record<string, unknown>,
    sanitizeTable: (el: HTMLElement) => el,
    isStructuralTag: () => false,
  } as unknown as SanitizerConfigBuilder;
}

// Mirrors what the HTML handler actually receives: the whole-document
// sanitize pass (html-janitor) unwraps <p> inside <td>, so paragraph
// boundaries arrive as <br> (stamped by convertTableCellParagraphs).
const STAMPED_TABLE =
  `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody><tr>` +
  '<td>Left cell</td>' +
  '<td>Right one<br>Right two</td>' +
  '</tr></tbody></table>';

describe('HtmlHandler — stamped 2/3-column table expands to columns', () => {
  let insertedBlocks: Array<{ tool: string; content: HTMLElement; data?: Record<string, unknown> }>;

  beforeEach(() => {
    insertedBlocks = [];
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  function makeBlok(tools: ReturnType<typeof makeToolStub>[], extraToolNames: string[] = []) {
    const defaultTool = tools.find((t) => t.isDefault) ?? tools[0];
    const blockTools = new Map<string, unknown>(tools.map((t) => [t.name, t]));

    for (const name of extraToolNames) {
      blockTools.set(name, { name, baseSanitizeConfig: {}, isDefault: false });
    }

    return {
      Tools: {
        defaultTool,
        blockTools,
      },
      BlockManager: {
        currentBlock: null,
        paste: vi.fn(async (toolName: string, event: CustomEvent, _replace?: boolean, data?: Record<string, unknown>) => {
          insertedBlocks.push({ tool: toolName, content: event.detail.data as HTMLElement, data });
          return { id: `block-${insertedBlocks.length}`, parentId: null };
        }),
        setBlockParent: vi.fn(),
      },
      Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
      YjsManager: { stopCapturing: vi.fn() },
    } as unknown as BlokModules;
  }

  const makeTools = () => [
    makeToolStub('table', ['TABLE', 'TR', 'TD', 'TH']),
    makeToolStub('paragraph', ['P']),
  ];

  it('inserts a column_list with one column per cell instead of a table block', async () => {
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(STAMPED_TABLE, { canReplaceCurrentBlock: false });

    expect(insertedBlocks.some((b) => b.tool === 'table')).toBe(false);
    expect(insertedBlocks.filter((b) => b.tool === 'column_list')).toHaveLength(1);
    expect(insertedBlocks.filter((b) => b.tool === 'column')).toHaveLength(2);
  });

  it('inserts each cell paragraph as a separate paragraph block in document order', async () => {
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(STAMPED_TABLE, { canReplaceCurrentBlock: false });

    const sequence = insertedBlocks.map((b) => b.tool);

    expect(sequence).toEqual([
      'column_list',
      'column',
      'paragraph',
      'column',
      'paragraph',
      'paragraph',
    ]);

    const paragraphTexts = insertedBlocks
      .filter((b) => b.tool === 'paragraph')
      .map((b) => b.content.textContent);

    expect(paragraphTexts).toEqual(['Left cell', 'Right one', 'Right two']);
  });

  it('parents columns to the column_list and cell content to its column', async () => {
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(STAMPED_TABLE, { canReplaceCurrentBlock: false });

    const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;

    // block-1 column_list, block-2 column A, block-3 para A, block-4 column B,
    // block-5/6 paras B
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-2' }), 'block-1');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-3' }), 'block-2');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-4' }), 'block-1');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-5' }), 'block-4');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-6' }), 'block-4');
  });

  it('passes noSeed to column_list and populated columns so they do not self-seed', async () => {
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(STAMPED_TABLE, { canReplaceCurrentBlock: false });

    const list = insertedBlocks.find((b) => b.tool === 'column_list');
    const columns = insertedBlocks.filter((b) => b.tool === 'column');

    expect(list?.data).toEqual(expect.objectContaining({ noSeed: true }));

    for (const column of columns) {
      expect(column.data).toEqual(expect.objectContaining({ noSeed: true }));
    }
  });

  it('splits block-level <p> children of a cell into separate paragraphs too', async () => {
    const paragraphCells =
      `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody><tr>` +
      '<td><p>One</p><p>Two</p></td>' +
      '<td><p>Three</p></td>' +
      '</tr></tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(paragraphCells, { canReplaceCurrentBlock: false });

    const paragraphTexts = insertedBlocks
      .filter((b) => b.tool === 'paragraph')
      .map((b) => b.content.textContent);

    expect(paragraphTexts).toEqual(['One', 'Two', 'Three']);
  });

  it('lets an EMPTY cell\'s column seed its own paragraph (no noSeed)', async () => {
    const emptyCellTable =
      `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody><tr>` +
      '<td>Filled</td>' +
      '<td></td>' +
      '</tr></tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(emptyCellTable, { canReplaceCurrentBlock: false });

    const columns = insertedBlocks.filter((b) => b.tool === 'column');

    expect(columns).toHaveLength(2);
    expect(columns[0].data).toEqual(expect.objectContaining({ noSeed: true }));
    expect(columns[1].data?.noSeed).not.toBe(true);
  });

  it('falls back to a table block when column tools are not registered', async () => {
    const tools = makeTools();
    const blok = makeBlok(tools); // no column_list / column registered
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(STAMPED_TABLE, { canReplaceCurrentBlock: false });

    expect(insertedBlocks.filter((b) => b.tool === 'table')).toHaveLength(1);
    expect(insertedBlocks.some((b) => b.tool === 'column_list')).toBe(false);
  });

  it('falls back to a table block for an unstamped single-row table', async () => {
    const unstamped =
      '<table><tbody><tr><td><p>Left</p></td><td><p>Right</p></td></tr></tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(unstamped, { canReplaceCurrentBlock: false });

    expect(insertedBlocks.filter((b) => b.tool === 'table')).toHaveLength(1);
    expect(insertedBlocks.some((b) => b.tool === 'column_list')).toBe(false);
  });

  it('expands a stamped multi-row 2-column table, stacking each column\'s cells top-to-bottom', async () => {
    const stampedMultiRow =
      `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody>` +
      '<tr><td>A1</td><td>B1</td></tr>' +
      '<tr><td>A2</td><td>B2</td></tr>' +
      '</tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(stampedMultiRow, { canReplaceCurrentBlock: false });

    const sequence = insertedBlocks.map((b) => b.tool);

    expect(sequence).toEqual([
      'column_list',
      'column',
      'paragraph',
      'paragraph',
      'column',
      'paragraph',
      'paragraph',
    ]);

    const paragraphTexts = insertedBlocks
      .filter((b) => b.tool === 'paragraph')
      .map((b) => b.content.textContent);

    expect(paragraphTexts).toEqual(['A1', 'A2', 'B1', 'B2']);

    const setBlockParent = blok.BlockManager.setBlockParent as ReturnType<typeof vi.fn>;

    // block-1 list, block-2 column A, block-3/4 its rows,
    // block-5 column B, block-6/7 its rows
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-3' }), 'block-2');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-4' }), 'block-2');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-6' }), 'block-5');
    expect(setBlockParent).toHaveBeenCalledWith(expect.objectContaining({ id: 'block-7' }), 'block-5');
  });

  it('expands a stamped 3-column table into three columns', async () => {
    const threeColumns =
      `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody>` +
      '<tr><td>A1</td><td>B1</td><td>C1</td></tr>' +
      '<tr><td>A2</td><td>B2</td><td>C2</td></tr>' +
      '</tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(threeColumns, { canReplaceCurrentBlock: false });

    expect(insertedBlocks.filter((b) => b.tool === 'column')).toHaveLength(3);
    expect(insertedBlocks.some((b) => b.tool === 'table')).toBe(false);
  });

  it('falls back to a table block when a stamped table turns out to have 4+ columns', async () => {
    const stampedFourColumns =
      `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody>` +
      '<tr><td>A</td><td>B</td><td>C</td><td>D</td></tr>' +
      '</tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(stampedFourColumns, { canReplaceCurrentBlock: false });

    expect(insertedBlocks.filter((b) => b.tool === 'table')).toHaveLength(1);
    expect(insertedBlocks.some((b) => b.tool === 'column_list')).toBe(false);
  });

  it('falls back to a table block when a stamped table has ragged row cell counts', async () => {
    const stampedRagged =
      `<table ${COLUMNS_CANDIDATE_ATTR}=""><tbody>` +
      '<tr><td>A1</td><td>B1</td></tr>' +
      '<tr><td>A2</td><td>B2</td><td>C2</td></tr>' +
      '</tbody></table>';
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(stampedRagged, { canReplaceCurrentBlock: false });

    expect(insertedBlocks.filter((b) => b.tool === 'table')).toHaveLength(1);
    expect(insertedBlocks.some((b) => b.tool === 'column_list')).toBe(false);
  });

  it('expands the stamped table while surrounding paragraphs paste normally', async () => {
    const mixed = `<p>Before</p>${STAMPED_TABLE}<p>After</p>`;
    const tools = makeTools();
    const blok = makeBlok(tools, ['column_list', 'column']);
    const handler = new HtmlHandler(blok, makeRegistry(tools), makeSanitizerBuilder());

    await handler.handle(mixed, { canReplaceCurrentBlock: false });

    const sequence = insertedBlocks.map((b) => b.tool);

    expect(sequence).toEqual([
      'paragraph',
      'column_list',
      'column',
      'paragraph',
      'column',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);

    expect(insertedBlocks[0].content.textContent).toBe('Before');
    expect(insertedBlocks[insertedBlocks.length - 1].content.textContent).toBe('After');
  });
});
