// test/unit/components/modules/paste/html-handler-nbsp-paragraph.test.ts

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

describe('HtmlHandler — nbsp-only paragraphs', () => {
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

  function makeHandler() {
    const paragraph = makeToolStub('paragraph', ['P']);
    const image = makeToolStub('image', [{ IMG: { src: true } }]);
    const registry = makeRegistry([paragraph, image]);

    return new HtmlHandler(makeBlok([paragraph, image]), registry, makeSanitizerBuilder());
  }

  it('drops a <p>&nbsp;</p> spacer instead of pasting it as a blank block', async () => {
    await makeHandler().handle('<p>one</p><p>&nbsp;</p><p>two</p>', { canReplaceCurrentBlock: false });

    expect(insertedBlocks.map((b) => b.content.textContent)).toEqual(['one', 'two']);
  });

  it('keeps a paragraph that only holds an image', async () => {
    await makeHandler().handle('<p>one</p><p><img src="photo.png"></p>', { canReplaceCurrentBlock: false });

    expect(insertedBlocks).toHaveLength(2);
    expect(insertedBlocks[1].tool).toBe('image');
  });
});
