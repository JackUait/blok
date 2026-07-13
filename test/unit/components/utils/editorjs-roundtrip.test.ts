import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import { defaultBlockTools } from '../../../../src/tools/index';
import { TOOL_ALIASES } from '../../../../src/components/modules/renderer';
import type { OutputBlockData } from '../../../../types';

/**
 * End-to-end proof of the Editor.js → Blok auto-migration pipeline.
 *
 * Unlike the hand-built single-block fixtures in data-model-transform.test.ts,
 * this exercises one realistic multi-block `editor.save()` export through the
 * exact composition the runtime load path uses (Renderer.render):
 *
 *   analyzeDataFormat -> shouldExpandToHierarchical -> expandToHierarchical
 *
 * The headline assertion is "no stub": every migrated block's `type` must be a
 * tool Blok actually renders. The renderer (src/components/modules/renderer.ts)
 * falls back to the Stub tool for any type that is neither in `Tools.available`
 * nor resolvable through `TOOL_ALIASES`. So the migration is only "smooth" if
 * no legacy type survives into a renderable-but-unknown type.
 */

/**
 * Canonical set of block types Blok renders WITHOUT a stub.
 *
 * DERIVED, not hand-listed: the real `defaultBlockTools` registry
 * (src/tools/index.ts — the keys Blok registers as `Tools.available` by
 * default) PLUS the legacy aliases in `TOOL_ALIASES`
 * (src/components/modules/renderer.ts, e.g. delimiter -> divider) which the
 * renderer resolves transparently before deciding a tool is unknown. Sourcing
 * from the live registry means a newly-added block tool can't silently make
 * this set stale.
 *
 * Any migrated `type` outside this set would hit the renderer's
 * "Tool «X» is not found" branch and render as a Stub.
 */
const RENDERABLE_BLOCK_TYPES = new Set<string>([
  ...Object.keys(defaultBlockTools),
  ...Object.keys(TOOL_ALIASES),
]);

/**
 * Mirror the runtime load path (Renderer.render) composition for the 'auto'
 * dataModel config: analyze -> decide -> expand.
 */
const runMigration = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const dataModelConfig = 'auto' as const;
  const analysis = analyzeDataFormat(blocks);
  const shouldExpand = shouldExpandToHierarchical(dataModelConfig, analysis.format);

  return shouldExpand ? expandToHierarchical(blocks) : blocks;
};

/**
 * A realistic Editor.js `editor.save()` export envelope. Contains the block
 * shapes a real legacy document carries, with their genuine Editor.js data
 * shapes (nested list items, `{file:{url}}` images, linkTool meta, quote
 * caption/alignment, standalone checklist, delimiter).
 */
const EDITORJS_EXPORT: { time: number; blocks: OutputBlockData[]; version: string } = {
  time: 1700000000000,
  version: '2.28.2',
  blocks: [
    {
      id: 'para-1',
      type: 'paragraph',
      data: { text: 'Intro paragraph with <b>bold</b> text.' },
    },
    {
      id: 'head-1',
      type: 'header',
      data: { text: 'Section heading', level: 2 },
    },
    {
      id: 'list-1',
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          { content: 'First top-level item', items: [{ content: 'Nested child item' }] },
          { content: 'Second top-level item' },
        ],
      },
    },
    {
      id: 'check-1',
      type: 'checklist',
      data: {
        items: [
          { text: 'Done task', checked: true },
          { text: 'Pending task', checked: false },
        ],
      },
    },
    {
      id: 'quote-1',
      type: 'quote',
      data: {
        text: 'The quote body text.',
        caption: 'Quote Author',
        alignment: 'center',
      },
    },
    {
      id: 'img-1',
      type: 'image',
      data: {
        file: { url: 'https://example.com/picture.png' },
        caption: 'A picture',
      },
    },
    {
      id: 'link-1',
      type: 'linkTool',
      data: {
        link: 'https://example.com/article',
        meta: {
          title: 'Example Article',
          description: 'A description of the article.',
          image: { url: 'https://example.com/preview.png' },
          site_name: 'Example Site',
        },
      },
    },
    {
      id: 'delim-1',
      type: 'delimiter',
      data: {},
    },
  ],
};

describe('Editor.js -> Blok migration: realistic multi-block roundtrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The migration warns (console.warn) for lossy fields (quote.alignment,
    // linkTool.site_name). Silence them so they don't pollute test output.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects the export as legacy format requiring expansion', () => {
    const analysis = analyzeDataFormat(EDITORJS_EXPORT.blocks);

    expect(analysis.format).toBe('legacy');
    expect(shouldExpandToHierarchical('auto', analysis.format)).toBe(true);
  });

  it('produces NO blocks that would render as a Stub (every type is renderable)', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);

    const unknownTypes = migrated
      .map((block) => block.type)
      .filter((type) => !RENDERABLE_BLOCK_TYPES.has(type));

    expect(unknownTypes).toEqual([]);
  });

  it('gives every migrated block a non-empty id', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);

    for (const block of migrated) {
      expect(typeof block.id).toBe('string');
      expect((block.id ?? '').length).toBeGreaterThan(0);
    }
  });

  it('passes paragraph through unchanged', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);
    const para = migrated.find((b) => b.id === 'para-1');

    expect(para).toBeDefined();
    expect(para?.type).toBe('paragraph');
    expect(para?.data).toEqual({ text: 'Intro paragraph with <b>bold</b> text.' });
  });

  it('passes header through unchanged', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);
    const head = migrated.find((b) => b.id === 'head-1');

    expect(head).toBeDefined();
    expect(head?.type).toBe('header');
    expect(head?.data).toEqual({ text: 'Section heading', level: 2 });
  });

  it('expands the nested Editor.js list into flat renderable list blocks', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);

    // Original list-1 had 2 top-level items + 1 nested child = 3 list blocks.
    const listFromOriginal = migrated.filter(
      (b) => b.type === 'list' && (b.data as { style?: string }).style === 'unordered'
    );

    expect(listFromOriginal).toHaveLength(3);

    const texts = listFromOriginal.map((b) => (b.data as { text: string }).text);

    expect(texts).toContain('First top-level item');
    expect(texts).toContain('Nested child item');
    expect(texts).toContain('Second top-level item');

    // The nested child must be parented to its top-level item, not orphaned.
    const parent = listFromOriginal.find((b) => (b.data as { text: string }).text === 'First top-level item');
    const child = listFromOriginal.find((b) => (b.data as { text: string }).text === 'Nested child item');

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parent).toBe(parent?.id);
    expect(parent?.content).toContain(child?.id);
  });

  it('expands the standalone checklist into N flat list blocks with style "checklist"', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);

    const checklistBlocks = migrated.filter(
      (b) => b.type === 'list' && (b.data as { style?: string }).style === 'checklist'
    );

    expect(checklistBlocks).toHaveLength(2);

    const done = checklistBlocks.find((b) => (b.data as { text: string }).text === 'Done task');
    const pending = checklistBlocks.find((b) => (b.data as { text: string }).text === 'Pending task');

    expect(done).toBeDefined();
    expect(done?.data).toMatchObject({ text: 'Done task', checked: true, style: 'checklist' });
    expect(pending).toBeDefined();
    expect(pending?.data).toMatchObject({ text: 'Pending task', checked: false, style: 'checklist' });
  });

  it('migrates quote-with-caption to quote followed immediately by a caption paragraph; alignment dropped', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);

    const quoteIndex = migrated.findIndex((b) => b.id === 'quote-1');

    expect(quoteIndex).toBeGreaterThanOrEqual(0);

    const quote = migrated[quoteIndex];

    expect(quote.type).toBe('quote');
    expect(quote.data).toEqual({ text: 'The quote body text.' });
    // alignment + caption must NOT survive on the quote.
    expect((quote.data).alignment).toBeUndefined();
    expect((quote.data).caption).toBeUndefined();

    // The very next block must be the caption paragraph.
    const captionBlock = migrated[quoteIndex + 1];

    expect(captionBlock).toBeDefined();
    expect(captionBlock.type).toBe('paragraph');
    expect((captionBlock.data as { text: string }).text).toBe('Quote Author');
    // Quote keeps its id; caption paragraph gets a fresh, distinct id.
    expect(captionBlock.id).not.toBe('quote-1');
    expect((captionBlock.id ?? '').length).toBeGreaterThan(0);
  });

  it('flattens legacy image {file:{url}} into {url} and keeps it renderable', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);
    const image = migrated.find((b) => b.id === 'img-1');

    expect(image).toBeDefined();
    expect(image?.type).toBe('image');
    expect((image?.data as { url: string }).url).toBe('https://example.com/picture.png');
    // Nested `file` wrapper must be gone.
    expect((image?.data as Record<string, unknown>).file).toBeUndefined();
    // Other fields pass through.
    expect((image?.data as { caption?: string }).caption).toBe('A picture');
  });

  it('converts linkTool into a bookmark with mapped fields; site_name dropped', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);
    const bookmark = migrated.find((b) => b.id === 'link-1');

    expect(bookmark).toBeDefined();
    expect(bookmark?.type).toBe('bookmark');

    const data = bookmark?.data as Record<string, unknown>;

    expect(data.url).toBe('https://example.com/article');
    expect(data.title).toBe('Example Article');
    expect(data.description).toBe('A description of the article.');
    expect(data.image).toBe('https://example.com/preview.png');
    // site_name has no Blok equivalent and must be dropped.
    expect(data.site_name).toBeUndefined();
  });

  it('keeps delimiter as a renderer-aliased type (delimiter -> divider)', () => {
    const migrated = runMigration(EDITORJS_EXPORT.blocks);
    const delimiter = migrated.find((b) => b.id === 'delim-1');

    expect(delimiter).toBeDefined();
    // The migration leaves delimiter as-is; the renderer aliases it to divider.
    // Either way it is in the renderable set (asserted by the no-stub test).
    expect(RENDERABLE_BLOCK_TYPES.has(delimiter?.type ?? '')).toBe(true);
  });
});
