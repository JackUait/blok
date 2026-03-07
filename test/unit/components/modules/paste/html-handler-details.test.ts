import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HtmlHandler } from '../../../../../src/components/modules/paste/handlers/html-handler';
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
    const tags = (tool.pasteConfig?.tags ?? []) as string[];

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
    composeConfigs: (...configs: object[]) => Object.assign({}, ...configs),
    sanitizeTable: (el: HTMLElement) => el,
    isStructuralTag: () => false,
  } as unknown as SanitizerConfigBuilder;
}

describe('HtmlHandler — DETAILS treated as atomic block', () => {
  let insertedBlocks: Array<{ tool: string; content: HTMLElement }>;

  beforeEach(() => {
    insertedBlocks = [];
  });

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

  it('does not insert any paragraph blocks from inside DETAILS at root level', async () => {
    const toggle = makeToolStub('toggle', ['DETAILS']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([toggle, paragraph]);
    const blok = makeBlok([toggle, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<details><summary><b>Title</b></summary><p>Child 1</p><p>Child 2</p></details>';
    const context = { canReplaceCurrentBlock: false };

    await handler.handle(html, context);

    // Before the fix: 3 blocks (bold fragment + P + P). After fix: 1 block.
    expect(insertedBlocks).toHaveLength(1);
  });
});
