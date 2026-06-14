import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeDataFormat,
  expandToHierarchical,
  shouldExpandToHierarchical,
} from '../../../../src/components/utils/data-model-transform';
import type { OutputBlockData } from '../../../../types';

/**
 * Verifies the Editor.js list-family → Blok flat `list` block migration by
 * driving each genuine editor.js shape through the EXACT runtime load pipeline:
 *
 *   const analysis = analyzeDataFormat(blocks)
 *   const out = shouldExpandToHierarchical('auto', analysis.format)
 *     ? expandToHierarchical(blocks)
 *     : blocks
 *
 * Blok renders lists as FLAT per-item `list` blocks ({ text, style, checked?,
 * depth?, start? } + parent/content refs) — NOT a single block with items[].
 * Covered editor.js sources: @editorjs/list, @editorjs/nested-list (both the
 * newer `{content}` item key and the older `{text}`/plain-string forms), and
 * @editorjs/checklist.
 */

const RENDERABLE_TYPES = new Set([
  'paragraph', 'header', 'list', 'table', 'toggle', 'callout',
  'database', 'database-row', 'divider', 'quote', 'code', 'image',
  'column_list', 'column', 'embed', 'bookmark', 'delimiter',
]);

/**
 * Run blocks through the real runtime migration pipeline (mirrors the load path).
 */
const runPipeline = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const analysis = analyzeDataFormat(blocks);

  return shouldExpandToHierarchical('auto', analysis.format)
    ? expandToHierarchical(blocks)
    : blocks;
};

/**
 * Assert every emitted block is a renderable `list` block with a non-empty id.
 */
const expectAllRenderableListBlocks = (out: OutputBlockData[]): void => {
  for (const block of out) {
    expect(block.type).toBe('list');
    expect(RENDERABLE_TYPES.has(block.type)).toBe(true);
    expect(typeof block.id).toBe('string');
    expect((block.id as string).length).toBeGreaterThan(0);
  }
};

const dataOf = (block: OutputBlockData): Record<string, unknown> =>
  block.data as Record<string, unknown>;

describe('editorjs-map-list — list family migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence the migration's lossy-field console.warn so test output stays clean.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('unordered list (@editorjs/list, plain string items)', () => {
    it('expands to N flat unordered list blocks preserving text + style', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'ul-1',
          type: 'list',
          data: {
            style: 'unordered',
            items: ['First', 'Second', 'Third'],
          },
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      expect(analysis.format).toBe('legacy');

      const out = runPipeline(blocks);

      expect(out).toHaveLength(3);
      expectAllRenderableListBlocks(out);
      expect(out.map(b => dataOf(b).text)).toEqual(['First', 'Second', 'Third']);
      out.forEach(b => expect(dataOf(b).style).toBe('unordered'));
      // Flat string items are root-level: no parent, no depth.
      out.forEach(b => {
        expect(b.parent).toBeUndefined();
        expect(dataOf(b).depth).toBeUndefined();
      });
    });
  });

  describe('ordered list with start (@editorjs/list)', () => {
    it('preserves start only on the first root item', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'ol-1',
          type: 'list',
          data: {
            style: 'ordered',
            start: 5,
            items: ['Alpha', 'Beta', 'Gamma'],
          },
        },
      ];

      const out = runPipeline(blocks);

      expect(out).toHaveLength(3);
      expectAllRenderableListBlocks(out);
      out.forEach(b => expect(dataOf(b).style).toBe('ordered'));

      // start lives ONLY on the first root item.
      expect(dataOf(out[0]).start).toBe(5);
      expect(dataOf(out[1]).start).toBeUndefined();
      expect(dataOf(out[2]).start).toBeUndefined();
    });

    it('omits start when it equals the default of 1', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'ol-default',
          type: 'list',
          data: { style: 'ordered', start: 1, items: ['Only'] },
        },
      ];

      const out = runPipeline(blocks);

      expect(out).toHaveLength(1);
      expect(dataOf(out[0]).start).toBeUndefined();
    });
  });

  describe('nested list (@editorjs/nested-list, newer {content} item key)', () => {
    it('flattens nested items into parent + child list blocks with parent/content refs', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'nested-1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Parent',
                items: [
                  { content: 'Child A', items: [] },
                  { content: 'Child B', items: [] },
                ],
              },
              { content: 'Sibling', items: [] },
            ],
          } as unknown as OutputBlockData['data'],
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      expect(analysis.format).toBe('legacy');
      expect(analysis.hasHierarchy).toBe(true);

      const out = runPipeline(blocks);

      // Parent + 2 children + Sibling = 4 flat blocks.
      expect(out).toHaveLength(4);
      expectAllRenderableListBlocks(out);

      const [parent, childA, childB, sibling] = out;

      expect(dataOf(parent).text).toBe('Parent');
      expect(dataOf(childA).text).toBe('Child A');
      expect(dataOf(childB).text).toBe('Child B');
      expect(dataOf(sibling).text).toBe('Sibling');

      // Children carry parent === top-item id; top item content[] includes child ids.
      expect(childA.parent).toBe(parent.id);
      expect(childB.parent).toBe(parent.id);
      expect(parent.content).toEqual([childA.id, childB.id]);

      // Style preserved across the whole tree.
      out.forEach(b => expect(dataOf(b).style).toBe('unordered'));

      // Depth assigned: root = none, children = 1.
      expect(dataOf(parent).depth).toBeUndefined();
      expect(dataOf(childA).depth).toBe(1);
      expect(dataOf(childB).depth).toBe(1);

      // Root sibling stays root.
      expect(sibling.parent).toBeUndefined();
    });
  });

  describe('nested list (older {text} item key + plain string)', () => {
    it('normalizes old {text} items and plain strings into flat blocks', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'mixed-1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { text: 'Old text item' },
              'Plain string item',
              { text: 'Trailing text item' },
            ],
          } as unknown as OutputBlockData['data'],
        },
      ];

      const out = runPipeline(blocks);

      expect(out).toHaveLength(3);
      expectAllRenderableListBlocks(out);

      const [first, second, third] = out;

      // normalizeListItem maps old {text} → {content} and plain string → {content}.
      expect(dataOf(first).text).toBe('Old text item');
      expect(dataOf(second).text).toBe('Plain string item');
      expect(dataOf(third).text).toBe('Trailing text item');

      out.forEach(b => {
        expect(dataOf(b).style).toBe('unordered');
        expect(b.parent).toBeUndefined();
        expect(dataOf(b).depth).toBeUndefined();
      });
    });

    it('GAP: old {text}-keyed items DROP their nested items[] (no children emitted)', () => {
      // isOldChecklistItem() matches any object with `text` and no `content`,
      // and normalizeListItem() returns { content, checked } WITHOUT `items`.
      // So a `{ text, items: [...] }` item silently loses its nesting — only the
      // newer `{ content, items }` shape carries children through expansion.
      const blocks: OutputBlockData[] = [
        {
          id: 'oldnest-1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                text: 'Parent old',
                items: [{ text: 'Old nested child' }],
              },
            ],
          } as unknown as OutputBlockData['data'],
        },
      ];

      const out = runPipeline(blocks);

      // Only the parent survives — the nested child is dropped.
      expect(out).toHaveLength(1);
      expect(dataOf(out[0]).text).toBe('Parent old');
      expect(out[0].content).toBeUndefined();
    });

    it('newer {content}-keyed items DO carry nested items[] through (control)', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'newnest-1',
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Parent new',
                items: [{ content: 'New nested child' }],
              },
            ],
          } as unknown as OutputBlockData['data'],
        },
      ];

      const out = runPipeline(blocks);

      expect(out).toHaveLength(2);
      const [parent, child] = out;

      expect(dataOf(parent).text).toBe('Parent new');
      expect(dataOf(child).text).toBe('New nested child');
      expect(child.parent).toBe(parent.id);
      expect(parent.content).toEqual([child.id]);
      expect(dataOf(child).depth).toBe(1);
    });
  });

  describe('standalone checklist (@editorjs/checklist)', () => {
    it('expands to N flat list blocks with style checklist carrying text + checked', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'check-1',
          type: 'checklist',
          data: {
            items: [
              { text: 'Done item', checked: true },
              { text: 'Pending item', checked: false },
            ],
          } as unknown as OutputBlockData['data'],
        },
      ];

      const analysis = analyzeDataFormat(blocks);

      expect(analysis.format).toBe('legacy');

      const out = runPipeline(blocks);

      expect(out).toHaveLength(2);
      expectAllRenderableListBlocks(out);

      out.forEach(b => expect(dataOf(b).style).toBe('checklist'));

      expect(dataOf(out[0]).text).toBe('Done item');
      expect(dataOf(out[0]).checked).toBe(true);
      expect(dataOf(out[1]).text).toBe('Pending item');
      expect(dataOf(out[1]).checked).toBe(false);
    });
  });

  describe('newer nested-list meta wrapper ({ meta:{}, items:[{content, meta, items}] })', () => {
    it('still flattens items, dropping unsupported per-list/per-item meta', () => {
      const blocks: OutputBlockData[] = [
        {
          id: 'meta-1',
          type: 'list',
          data: {
            style: 'ordered',
            meta: { counterType: 'upper-roman' },
            items: [
              {
                content: 'Roman parent',
                meta: {},
                items: [
                  { content: 'Roman child', meta: {}, items: [] },
                ],
              },
            ],
          } as unknown as OutputBlockData['data'],
        },
      ];

      const out = runPipeline(blocks);

      expect(out).toHaveLength(2);
      expectAllRenderableListBlocks(out);

      const [parent, child] = out;

      expect(dataOf(parent).text).toBe('Roman parent');
      expect(dataOf(child).text).toBe('Roman child');
      expect(child.parent).toBe(parent.id);
      expect(parent.content).toEqual([child.id]);
      out.forEach(b => expect(dataOf(b).style).toBe('ordered'));

      // GAP DOCUMENTATION: list-level `meta.counterType` and per-item `meta`
      // are NOT carried onto any emitted flat block. Blok's ListItemData has no
      // meta/counterType field, so ordered-list counter styling is lost.
      out.forEach(b => {
        expect(dataOf(b).meta).toBeUndefined();
        expect(dataOf(b).counterType).toBeUndefined();
      });
    });
  });
});
