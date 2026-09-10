// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToPlainText } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * `blocksToPlainText` against the wire shapes the editor never writes but a
 * saved document still carries: malformed table cells, dangling block
 * references, duplicated ids and parent-reference loops. Every case pins the
 * EXACT output string, because a guard that stops guarding usually shifts a
 * separator or drops a cell rather than a word.
 *
 * `SENTINEL` is the literal Stryker substitutes for `''`. A string comparison
 * against an empty string can only be told apart from the same comparison
 * against another literal by feeding the field that exact value, so three
 * cases below carry it as real content.
 *
 * Mutants deliberately left alone, with the evidence that no input can change
 * the output. Each one is a guard whose two arms are indistinguishable for
 * every value the program can hold.
 * - `block.id !== undefined` (deepText 168, visit 257) forced true: the second
 *   conjunct only matters for an id-less block, and `active` is written ONLY
 *   under the same `block.id !== undefined` test (172/261), so `active` never
 *   holds `undefined` and `active.has(undefined)` is false either way.
 * - `block.id !== undefined` before `active.add` (172, 261) forced true: adds
 *   `undefined` to the set, which every later `active.has` reaches through the
 *   short-circuit above, and `active.delete(undefined)` is a no-op.
 * - `block.id !== undefined` before `active.delete` (181, 273) forced true:
 *   `active.delete(undefined)` on a `Set<string>` removes nothing.
 * - `Array.isArray(block.data.content) ? … : []` (193) default made
 *   `["Stryker was here"]`: `rows` is that value through `.filter(Array.isArray)`,
 *   and a string is not an array, so both defaults yield zero rows.
 * - `cell.mergedInto !== undefined` in `cellText` (205) — and both of its
 *   branches: unreachable, and the coverage run proves it. Line 206 is never
 *   executed: the only caller passes cells through
 *   `.filter((cell) => !(isRecord(cell) && cell.mergedInto !== undefined))`,
 *   which is the same predicate, so `cellText` never sees a merged record.
 * - `cell.blocks.filter((id) => typeof id === 'string')` (209) dropped or
 *   forced true: `model.byId` is keyed by string ids only
 *   (`normalizeViewBlock` sets `id` only for a non-empty string), and `Map.get`
 *   compares with SameValueZero, so a non-string id resolves to `undefined` and
 *   is discarded by the `child === undefined` branch either way.
 */
const SENTINEL = 'Stryker was here!';

/**
 * Wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToPlainText — malformed and cyclic wire data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a data field that is not a plain record', () => {
    it('reads a paragraph through html', () => {
      expect(blocksToPlainText(doc([{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }])))
        .toBe('Hello world');
    });

    it('a table row holding a null cell contributes an empty cell, not a crash', () => {
      const text = blocksToPlainText(doc([
        {
          type: 'table',
          data: { content: [[{ blocks: [], text: 'Alpha' }, null]] },
        },
      ]));

      expect(text).toBe('Alpha\t');
    });

    it('a table row holding an undefined cell contributes an empty cell, not a crash', () => {
      const text = blocksToPlainText(doc([
        {
          type: 'table',
          data: { content: [[{ blocks: [], text: 'Alpha' }, undefined]] },
        },
      ]));

      expect(text).toBe('Alpha\t');
    });

    it('a cell whose blocks are resolved by id reads its child blocks', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: ['kid'] }, { blocks: [], text: 'Twin' }]] } },
        { id: 'kid', type: 'paragraph', parent: 'grid', data: { text: 'Nested' } },
      ]));

      expect(text).toBe('Nested\tTwin');
    });
  });

  describe('a label field that is present but empty', () => {
    it('a file with an empty caption falls back to its file name', () => {
      expect(blocksToPlainText(doc([{ type: 'file', data: { url: 'u', caption: '', fileName: 'spec.pdf' } }])))
        .toBe('spec.pdf');
    });

    it('a caption equal to the Stryker sentinel is still a caption', () => {
      expect(blocksToPlainText(doc([{ type: 'file', data: { url: 'u', caption: SENTINEL, fileName: 'spec.pdf' } }])))
        .toBe(SENTINEL);
    });

    it('a bookmark with no title and no url contributes nothing', () => {
      expect(blocksToPlainText(doc([{ type: 'bookmark', data: {} }]))).toBe('');
      expect(blocksToPlainText(doc([{ type: 'image', data: { url: 'https://x.y/a.png' } }]))).toBe('');
    });

    it('a bookmark with only a url shows the url', () => {
      expect(blocksToPlainText(doc([{ type: 'bookmark', data: { url: 'https://example.com/solo' } }])))
        .toBe('https://example.com/solo');
    });

    it('a list carrying a stray caption renders only its own text', () => {
      expect(blocksToPlainText(doc([
        { type: 'list', data: { text: 'One', style: 'unordered', caption: 'Legacy caption' } },
      ]))).toBe('One');
    });

    it('a code block whose code is not a string contributes nothing', () => {
      expect(blocksToPlainText(doc([{ type: 'code', data: { code: 42 } }]))).toBe('');
    });
  });

  describe('includeHiddenText', () => {
    it('emits the hidden fields of a media block', () => {
      expect(blocksToPlainText(
        doc([{ type: 'image', data: { url: 'u', alt: 'Tabby cat' } }]),
        { includeHiddenText: true }
      )).toBe('Tabby cat');
    });

    it('an empty hidden field leaves no blank line', () => {
      expect(blocksToPlainText(
        doc([{ type: 'image', data: { url: 'u', caption: '', alt: 'Tabby cat' } }]),
        { includeHiddenText: true }
      )).toBe('Tabby cat');
    });

    it('a hidden field equal to the Stryker sentinel is still emitted', () => {
      expect(blocksToPlainText(
        doc([{ type: 'image', data: { url: 'u', alt: SENTINEL } }]),
        { includeHiddenText: true }
      )).toBe(SENTINEL);
    });
  });

  describe('table text', () => {
    it('a legacy inline-HTML cell is read', () => {
      const text = blocksToPlainText(doc([
        { type: 'table', data: { content: [[{ blocks: [], text: 'Gamma' }, 'Delta <b>bold</b>']] } },
      ]));

      expect(text).toBe('Gamma\tDelta bold');
    });

    it('a non-array row is skipped instead of crashing', () => {
      const text = blocksToPlainText(doc([
        { type: 'table', data: { content: [[{ blocks: [], text: 'Alpha' }], 'oops'] } },
      ]));

      expect(text).toBe('Alpha');
    });

    it('a row whose cells are all empty adds no blank line', () => {
      const text = blocksToPlainText(doc([
        { type: 'table', data: { content: [[{ blocks: [], text: 'Alpha' }], [{ blocks: [], text: '' }, { blocks: [], text: '' }]] } },
      ]));

      expect(text).toBe('Alpha');
    });

    it('a merged cell is not re-read as an extra empty cell', () => {
      const text = blocksToPlainText(doc([
        {
          type: 'table',
          data: {
            content: [[
              { blocks: [], text: 'Alpha' },
              { blocks: [], text: 'Ghost', mergedInto: { row: 0, col: 0 } },
            ]],
          },
        },
      ]));

      expect(text).toBe('Alpha');
    });

    it('a cell whose block reference resolves to nothing falls back to its own text', () => {
      const text = blocksToPlainText(doc([
        { type: 'table', data: { content: [[{ blocks: ['ghost'], text: 'Fallback' }]] } },
      ]));

      expect(text).toBe('Fallback');
    });

    it('a table whose content is not an array is empty', () => {
      expect(blocksToPlainText(doc([{ type: 'table', data: { content: 'oops' } }]))).toBe('');
    });

    it('a cell whose blocks list holds no usable ids falls back to its own text', () => {
      const text = blocksToPlainText(doc([
        { type: 'table', data: { content: [[{ blocks: 'ghost', text: 'Fallback' }]] } },
      ]));

      expect(text).toBe('Fallback');
    });

    /**
     * The `: []` a non-array `blocks` falls back to is an array literal, and
     * the only value that can tell one array literal from another is a block
     * whose id IS the other literal — nothing else can reach that lookup.
     */
    it('a cell whose blocks field is not an array ignores a block named after the sentinel', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: 'not-an-array', text: 'Fallback' }]] } },
        { id: 'Stryker was here', type: 'paragraph', parent: 'grid', data: { text: 'Sentinel child' } },
      ]));

      expect(text).toBe('Fallback');
    });
  });

  describe('deep text of a table cell', () => {
    it('cell children are joined with a single newline', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: ['kid1', 'kid2'] }]] } },
        { id: 'kid1', type: 'paragraph', parent: 'grid', data: { text: 'Alpha' } },
        { id: 'kid2', type: 'paragraph', parent: 'grid', data: { text: 'Beta' } },
      ]));

      expect(text).toBe('Alpha\nBeta');
    });

    it('a cell child with no text of its own adds no separator', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: ['gap', 'tail'] }]] } },
        { id: 'gap', type: 'paragraph', parent: 'grid', data: {} },
        { id: 'tail', type: 'paragraph', parent: 'grid', data: { text: 'Beta' } },
      ]));

      expect(text).toBe('Beta');
    });

    it('a cell child whose text is the Stryker sentinel is still emitted', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: ['star', 'tail'] }]] } },
        { id: 'star', type: 'paragraph', parent: 'grid', data: { text: SENTINEL } },
        { id: 'tail', type: 'paragraph', parent: 'grid', data: { text: 'Beta' } },
      ]));

      expect(text).toBe(`${SENTINEL}\nBeta`);
    });

    it('a block referenced by two cells is read in both', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: ['shared'] }, { blocks: ['shared'] }]] } },
        { id: 'shared', type: 'paragraph', parent: 'grid', data: { text: 'Twice' } },
      ]));

      expect(text).toBe('Twice\tTwice');
    });

    /**
     * A duplicated id is how a document can point a child back at an ancestor:
     * the first entry claims the id, the second gives the loop its edge, and
     * `byId` resolves the cell reference to the first. Without the walk-stack
     * guard this recurses until the stack dies.
     */
    it('a cell child chain that loops back to an ancestor stops at the cycle', () => {
      const text = blocksToPlainText(doc([
        { id: 'grid', type: 'table', data: { content: [[{ blocks: ['loop'] }]] } },
        { id: 'loop', type: 'paragraph', parent: 'end', data: { text: 'Alpha' } },
        { id: 'loop', type: 'paragraph', parent: 'grid', data: { text: 'Shadow' } },
        { id: 'end', type: 'paragraph', parent: 'loop', data: { text: 'Omega' } },
      ]));

      expect(text).toBe('Alpha\nOmega');
    });
  });

  describe('walking the document', () => {
    it('a block id repeated in the document is emitted twice', () => {
      const text = blocksToPlainText(doc([
        { id: 'dup', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'dup', type: 'paragraph', data: { text: 'Beta' } },
      ]));

      expect(text).toBe('Alpha\n\nBeta');
    });

    it('a child chain that loops back to an ancestor stops at the cycle', () => {
      const text = blocksToPlainText(doc([
        { id: 'start', type: 'toggle', data: { text: 'Start' } },
        { id: 'a', type: 'paragraph', parent: 'end', data: { text: 'Alpha' } },
        { id: 'a', type: 'paragraph', parent: 'start', data: { text: 'Shadow' } },
        { id: 'end', type: 'paragraph', parent: 'a', data: { text: 'Omega' } },
      ]));

      expect(text).toBe('Start\n\nShadow\n\nOmega');
    });

    it('a custom table renderer still lets the table children be walked', () => {
      const text = blocksToPlainText(
        doc([
          { id: 'grid', type: 'table', data: {} },
          { id: 'kid', type: 'paragraph', parent: 'grid', data: { text: 'Inside' } },
        ]),
        { renderers: { table: () => '' } }
      );

      expect(text).toBe('Inside');
    });
  });

  describe('custom renderers', () => {
    it('a custom renderer that paints no text adds no separator', () => {
      const text = blocksToPlainText(
        doc([
          { type: 'widget', data: {} },
          { type: 'paragraph', data: { text: 'Body' } },
        ]),
        { renderers: { widget: () => '<div></div>' } }
      );

      expect(text).toBe('Body');
    });

    it('a custom renderer whose text is the Stryker sentinel emits it', () => {
      const text = blocksToPlainText(
        doc([{ type: 'widget', data: {} }]),
        { renderers: { widget: () => SENTINEL } }
      );

      expect(text).toBe(SENTINEL);
    });

    it('a custom-rendered block is never treated as a list item', () => {
      const text = blocksToPlainText(
        doc([
          { type: 'widget', data: {} },
          { type: 'list', data: { text: 'Item', style: 'unordered' } },
        ]),
        { renderers: { widget: () => 'Card' } }
      );

      expect(text).toBe('Card\n\nItem');
    });
  });
});
