// test/unit/components/modules/paste/html-handler-aside.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HtmlHandler } from '../../../../../src/components/modules/paste/handlers/html-handler';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

function makeToolStub(name: string, tags: (string | Record<string, unknown>)[]) {
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

    tagsByTool[tool.name] = tagsByTool[tool.name] ?? [];

    for (const tag of tags) {
      const tagName = typeof tag === 'string' ? tag : Object.keys(tag)[0];

      toolsTags[tagName.toUpperCase()] = { tool, sanitizationConfig: null };
      tagsByTool[tool.name].push(tagName.toUpperCase());
    }
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

describe('HtmlHandler — ASIDE treated as atomic block (like DETAILS)', () => {
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

  it('inserts ASIDE as a single callout block when it contains <p> children', async () => {
    const callout = makeToolStub('callout', [{ ASIDE: { style: true } }]);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([callout, paragraph]);
    const blok = makeBlok([callout, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<aside style="background-color: rgb(242, 240, 240);"><p>Child 1</p><p>Child 2</p></aside>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    const calloutBlocks = insertedBlocks.filter((b) => b.tool === 'callout');

    expect(calloutBlocks).toHaveLength(1);
    expect(calloutBlocks[0].content.tagName).toBe('ASIDE');
  });

  it('inserts ASIDE children as separate child blocks with parentPasteIndex', async () => {
    const callout = makeToolStub('callout', [{ ASIDE: { style: true } }]);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([callout, paragraph]);
    const blok = makeBlok([callout, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<aside style="background-color: rgb(242, 240, 240);"><p>Child 1</p><p>Child 2</p></aside>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    // ASIDE + 2 child paragraphs = 3 blocks total (ALL children expanded, no SUMMARY filter)
    expect(insertedBlocks).toHaveLength(3);
    expect(insertedBlocks[0].content.tagName).toBe('ASIDE');
    expect(insertedBlocks[1].tool).toBe('paragraph');
    expect(insertedBlocks[2].tool).toBe('paragraph');
  });

  it('calls setBlockParent for each child paragraph with the callout as parent', async () => {
    const callout = makeToolStub('callout', [{ ASIDE: { style: true } }]);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([callout, paragraph]);
    const blok = makeBlok([callout, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<aside style="background-color: rgb(242, 240, 240);"><p>Child 1</p><p>Child 2</p></aside>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    // setBlockParent should be called twice (for each child) with the callout block's id
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

  it('expands ALL children of ASIDE (no SUMMARY filtering like DETAILS)', async () => {
    const callout = makeToolStub('callout', [{ ASIDE: { style: true } }]);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([callout, paragraph]);
    const blok = makeBlok([callout, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    // ASIDE with a <summary> child — unlike DETAILS, ASIDE should NOT filter out SUMMARY
    const html = '<aside style="background-color: #f1f1ef;"><summary>This is not filtered</summary><p>Body</p></aside>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    // ASIDE + summary + p = 3 blocks (summary is NOT filtered for ASIDE)
    expect(insertedBlocks).toHaveLength(3);
    expect(insertedBlocks[0].content.tagName).toBe('ASIDE');
  });
});
