import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HtmlHandler } from '../../../../../src/components/modules/paste/handlers/html-handler';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import {
  detectStyleFromPastedContent,
  extractDepthFromPastedContent,
} from '../../../../../src/tools/list/paste-handler';

/**
 * Notion-parity finding M-18 (live-editor portion).
 *
 * Pasting rendered nested HTML lists copied from a generic web page
 * (e.g. `<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>` WITHOUT
 * `aria-level`) must produce separate list blocks with increasing `data.depth`
 * (0, 1, 2 …), and pasting a generic `<ol>` must keep the ordered style.
 *
 * Root cause: the HTML paste splitter (html-handler.ts `processElementNode`)
 * emits a parent `<li>` that contains a nested `<ul>`/`<ol>` WHOLE — the nested
 * items are swallowed into the parent item's content. And because the list tool
 * receives a DETACHED clone of the `<li>`, its ancestor `<ol>`/`<ul>` context is
 * gone, so ordered lists degrade to unordered.
 *
 * Fix: a pre-pass in `processHTML` stamps each `<li>` with `aria-level` (its
 * 1-based nesting depth) and, for ordered lists, `data-list-style="ordered"`
 * while the ancestor chain is intact, then flattens nested `<ul>`/`<ol>` so each
 * `<li>` becomes a separate emittable block.
 */

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

describe('HtmlHandler — nested HTML list paste preserves depth (M-18 live-editor)', () => {
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

  it('pasting nested <ul> without aria-level yields separate list blocks at depth 0,1,2', async () => {
    const list = makeToolStub('list', ['LI']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([list, paragraph]);
    const blok = makeBlok([list, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>';

    await handler.handle(html, { canReplaceCurrentBlock: false });

    const listBlocks = insertedBlocks.filter((b) => b.tool === 'list');

    expect(listBlocks).toHaveLength(3);
    expect(listBlocks[0].content.textContent?.trim()).toBe('a');
    expect(listBlocks[1].content.textContent?.trim()).toBe('b');
    expect(listBlocks[2].content.textContent?.trim()).toBe('c');

    expect(extractDepthFromPastedContent(listBlocks[0].content)).toBe(0);
    expect(extractDepthFromPastedContent(listBlocks[1].content)).toBe(1);
    expect(extractDepthFromPastedContent(listBlocks[2].content)).toBe(2);
  });

  it('pasting a generic <ol> keeps each item ordered (context survives detachment)', async () => {
    const list = makeToolStub('list', ['LI']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([list, paragraph]);
    const blok = makeBlok([list, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<ol><li>one</li><li>two</li></ol>';

    await handler.handle(html, { canReplaceCurrentBlock: false });

    const listBlocks = insertedBlocks.filter((b) => b.tool === 'list');

    expect(listBlocks).toHaveLength(2);
    // The list tool receives a DETACHED clone; without the stamp it would fall
    // back to the current (unordered) style.
    expect(detectStyleFromPastedContent(listBlocks[0].content, 'unordered')).toBe('ordered');
    expect(detectStyleFromPastedContent(listBlocks[1].content, 'unordered')).toBe('ordered');
  });

  it('pasting a nested <ol> keeps ordered style at every depth', async () => {
    const list = makeToolStub('list', ['LI']);
    const paragraph = makeToolStub('paragraph', ['P']);
    const registry = makeRegistry([list, paragraph]);
    const blok = makeBlok([list, paragraph]);
    const handler = new HtmlHandler(blok, registry, makeSanitizerBuilder());

    const html = '<ol><li>one<ol><li>one.one</li></ol></li></ol>';

    await handler.handle(html, { canReplaceCurrentBlock: false });

    const listBlocks = insertedBlocks.filter((b) => b.tool === 'list');

    expect(listBlocks).toHaveLength(2);
    expect(extractDepthFromPastedContent(listBlocks[0].content)).toBe(0);
    expect(extractDepthFromPastedContent(listBlocks[1].content)).toBe(1);
    expect(detectStyleFromPastedContent(listBlocks[0].content, 'unordered')).toBe('ordered');
    expect(detectStyleFromPastedContent(listBlocks[1].content, 'unordered')).toBe('ordered');
  });
});
