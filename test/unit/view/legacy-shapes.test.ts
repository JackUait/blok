// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToPlainText, blocksToMarkdown, extractTexts } from '../../../src/view';

import type { LooseOutputData } from '../../../types';

/**
 * Documents written before nesting moved to `parent`/`content` keep their child
 * blocks INSIDE `data`. Blok still stores them exactly as they were saved — a
 * document is only rewritten when someone opens and saves it — so every reader
 * that walks a document has to descend these shapes or it silently returns a
 * document with its lists, callouts and columns missing.
 *
 * The field names are not guesses: they are the ones the Knowledge Base's own
 * C# readers used before that code was deleted in favour of these readers.
 */
const legacyList: LooseOutputData = {
  blocks: [
    {
      type: 'list',
      data: {
        style: 'unordered',
        items: [
          { content: 'first item', items: [{ content: 'nested item', items: [] }] },
          { content: 'second item', items: [] },
        ],
      },
    },
  ],
};

const legacyCallout: LooseOutputData = {
  blocks: [
    {
      type: 'callout',
      data: {
        title: 'Watch out',
        body: { blocks: [{ type: 'paragraph', data: { text: 'the floor is wet' } }] },
      },
    },
  ],
};

const legacyToggle: LooseOutputData = {
  blocks: [
    {
      type: 'toggleList',
      data: {
        title: 'More detail',
        body: { blocks: [{ type: 'paragraph', data: { text: 'hidden until opened' } }] },
      },
    },
  ],
};

const legacyColumns: LooseOutputData = {
  blocks: [
    {
      type: 'columns',
      data: {
        cols: [
          { blocks: [{ type: 'paragraph', data: { text: 'left side' } }] },
          { blocks: [{ type: 'paragraph', data: { text: 'right side' } }] },
        ],
      },
    },
  ],
};

describe('legacy nested documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('blocksToPlainText reads content nested inside `data`', () => {
    it.each([
      ['a list whose items live in data.items', legacyList, ['first item', 'nested item', 'second item']],
      ['a callout whose body lives in data.body.blocks', legacyCallout, ['Watch out', 'the floor is wet']],
      ['a toggle list whose body lives in data.body.blocks', legacyToggle, ['More detail', 'hidden until opened']],
      ['columns whose content lives in data.cols[].blocks', legacyColumns, ['left side', 'right side']],
    ])('%s', (_name, document, expected) => {
      const text = blocksToPlainText(document);

      for (const fragment of expected) {
        expect(text).toContain(fragment);
      }
    });
  });

  /**
   * Asserted exactly, not by substring. The reason is specific: a wrapper block
   * that carries items but no text of its own used to emit an empty bullet and
   * push every item one level too deep, and a body block with no id was claimed
   * by its container AND emitted again after it. Both produced output that
   * still CONTAINED every expected word.
   */
  describe('blocksToMarkdown reads content nested inside `data`', () => {
    it.each([
      ['a list whose items live in data.items', legacyList, '- first item\n    - nested item\n- second item'],
      ['a callout whose body lives in data.body.blocks', legacyCallout, '> Watch out\n> \n> the floor is wet'],
      /**
       * Not a blockquote: `toggleList` is a type the serializer never had, so it
       * falls back to plain output. The current `toggle` bolds its title; the
       * only difference here is that emphasis, not content.
       */
      ['a toggle list whose body lives in data.body.blocks', legacyToggle, 'More detail\n\nhidden until opened'],
      ['columns whose content lives in data.cols[].blocks', legacyColumns, 'left side\n\nright side'],
    ])('%s', (_name, document, expected) => {
      expect(blocksToMarkdown(document)).toBe(expected);
    });
  });

  /**
   * The point of the whole expansion: a legacy document has to read the same as
   * the current document that replaced it, down to the byte.
   */
  it('serializes a legacy list exactly like the flat list that replaced it', () => {
    const flat = blocksToMarkdown({
      blocks: [
        { id: 'a', type: 'list', data: { style: 'ordered', text: 'one' } },
        { id: 'b', type: 'list', data: { style: 'ordered', text: 'two' } },
      ],
    });
    const legacy = blocksToMarkdown({
      blocks: [{
        type: 'list',
        data: { style: 'ordered', items: [{ content: 'one', items: [] }, { content: 'two', items: [] }] },
      }],
    });

    expect(legacy).toBe(flat);
  });

  /**
   * A legacy `checklist` is a type of its own; the current list expresses the
   * same thing as a style, and still reads `checked` off each item. Losing
   * either turns a checklist into plain bullets.
   */
  it('keeps a legacy checklist a checklist', () => {
    const document: LooseOutputData = {
      blocks: [{
        type: 'checklist',
        data: {
          items: [
            { text: 'done thing', checked: true, items: [] },
            { text: 'pending thing', checked: false, items: [] },
          ],
        },
      }],
    };

    expect(blocksToMarkdown(document)).toBe('- [x] done thing\n- [ ] pending thing');
    expect(blocksToPlainText(document)).toBe('done thing\npending thing');
  });

  /**
   * The boundary of the wrapper rule: a block is treated as nothing but its
   * items only when it has no text of its own. One that has both keeps its text
   * and takes the items as children.
   */
  it('keeps the text of a list block that has items AND text', () => {
    const document: LooseOutputData = {
      blocks: [{
        type: 'list',
        data: { style: 'unordered', text: 'own text', items: [{ content: 'an item', items: [] }] },
      }],
    };

    expect(blocksToMarkdown(document)).toBe('- own text\n    - an item');
  });

  /**
   * `extractTexts` already descends `data.items` and `data.body.blocks`; columns
   * and a callout's own title were the two shapes it did not know, so a legacy
   * article came back from translation with them still in the source language.
   */
  describe('extractTexts offers every legacy string for translation', () => {
    it.each([
      ['columns whose content lives in data.cols[].blocks', legacyColumns, ['left side', 'right side']],
      ['a callout title', legacyCallout, ['Watch out', 'the floor is wet']],
    ])('%s', (_name, document, expected) => {
      expect(extractTexts(document)).toEqual(expect.arrayContaining(expected));
    });
  });
});
