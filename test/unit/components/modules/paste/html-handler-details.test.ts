import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HtmlHandler } from '../../../../../src/components/modules/paste/handlers/html-handler';
import { recoverGfmToggles } from '../../../../../src/components/modules/paste/gfm-toggle-recovery';
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

describe('HtmlHandler — DETAILS treated as atomic block', () => {
  let insertedBlocks: Array<{ tool: string; content: HTMLElement }>;

  beforeEach(() => {
    insertedBlocks = [];
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  function makeBlok(tools: ReturnType<typeof makeToolStub>[]) {
    const defaultTool = tools.find((t) => t.isDefault) ?? tools[0];

    return {
      Tools: {
        defaultTool,
        blockTools: new Map(tools.map((t) => [t.name, t])),
      },
      BlockManager: {
        currentBlock: null,
        paste: vi.fn(async (toolName: string, event: CustomEvent) => {
          insertedBlocks.push({ tool: toolName, content: event.detail.data as HTMLElement });
          return { id: `block-${insertedBlocks.length}`, parentId: null };
        }),
        setBlockParent: vi.fn(),
      },
      Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
      YjsManager: { stopCapturing: vi.fn() },
    } as unknown as BlokModules;
  }

  it('inserts DETAILS as a single toggle block when it contains <p> children', async () => {
    const toggle = makeToolStub('toggle', ['DETAILS']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([toggle, paragraph]);
    const blok = makeBlok([toggle, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    // <details> with <p> children — previously caused recursion into 3 flat blocks
    const html = '<details><summary><b>Title</b></summary><p>Child 1</p><p>Child 2</p></details>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    const toggleBlocks = insertedBlocks.filter((b) => b.tool === 'toggle');

    expect(toggleBlocks).toHaveLength(1);
    expect(toggleBlocks[0].content.tagName).toBe('DETAILS');
  });

  it('inserts DETAILS children as separate child blocks (not unparented at root level)', async () => {
    const toggle = makeToolStub('toggle', ['DETAILS']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([toggle, paragraph]);
    const blok = makeBlok([toggle, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<details><summary><b>Title</b></summary><p>Child 1</p><p>Child 2</p></details>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    // Toggle + 2 child paragraphs = 3 blocks total (children are parented to the toggle)
    expect(insertedBlocks).toHaveLength(3);
    // The toggle block receives the full DETAILS element
    expect(insertedBlocks[0].content.tagName).toBe('DETAILS');
    // Children are inserted as separate blocks
    expect(insertedBlocks[1].tool).toBe('paragraph');
    expect(insertedBlocks[2].tool).toBe('paragraph');
  });

  it('calls setBlockParent for each child paragraph with the toggle as parent', async () => {
    const toggle = makeToolStub('toggle', ['DETAILS']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([toggle, paragraph]);
    const blok = makeBlok([toggle, paragraph]);

    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<details><summary><b>Title</b></summary><p>Child 1</p><p>Child 2</p></details>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    // setBlockParent should be called twice (for each child) with the toggle block's id
    expect(blok.BlockManager.setBlockParent).toHaveBeenCalledTimes(2);
    expect(blok.BlockManager.setBlockParent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'block-2' }),
      'block-1'
    );
    expect(blok.BlockManager.setBlockParent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'block-3' }),
      'block-1'
    );
  });

  it('migrates a buildin/Notion GFM toggle (lossy <ul> twin) into a toggle block, not a bullet list', async () => {
    // Regression: when only the lossy GFM HTML flavour is available, a collapsed
    // toggle serializes as a single-item <ul> (see the real capture in
    // test/fixtures/notion/demo-page.clipboard.html). recoverGfmToggles rewrites
    // that into <details>, which the handler then expands into a toggle block —
    // closing the "toggle list transfers as bullet list" bug in the HTML path.
    const toggle = makeToolStub('toggle', ['DETAILS']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const list = makeToolStub('list', ['UL', 'OL', 'LI']);
    const registry = makeRegistry([toggle, paragraph, list]);
    const blok = makeBlok([toggle, paragraph, list]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const gfmToggle = '<ul><li><p>toggle list</p><p>test</p></li></ul>';
    const recovered = recoverGfmToggles(gfmToggle);
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(recovered, context);

    // The toggle arrives as a toggle block (with its body as a child paragraph),
    // and NOT as a list block.
    expect(insertedBlocks.some((b) => b.tool === 'list')).toBe(false);

    const toggleBlocks = insertedBlocks.filter((b) => b.tool === 'toggle');

    expect(toggleBlocks).toHaveLength(1);
    expect(toggleBlocks[0].content.tagName).toBe('DETAILS');
    expect(toggleBlocks[0].content.textContent).toContain('toggle list');
  });
});
