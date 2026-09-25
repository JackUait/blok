// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToHtml, blocksToPlainText, blocksToMarkdown, extractTexts } from '../../../src/view';

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
      /** The editor gives a legacy callout the default 💡 when it names no emoji. */
      ['a callout whose body lives in data.body.blocks', legacyCallout, '> 💡 Watch out\n> \n> the floor is wet'],
      /**
       * `toggleList` is the legacy name of `toggle`, so it renders identically:
       * bold summary, then body. Not a blockquote — that is the callout.
       */
      ['a toggle list whose body lives in data.body.blocks', legacyToggle, '**More detail**\n\nhidden until opened'],
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

/**
 * Every reader, so one assertion covers HTML, Markdown and plain text.
 * @param document - document to render
 */
const readAll = (document: LooseOutputData): { html: string; markdown: string; text: string } => ({
  html: blocksToHtml(document),
  markdown: blocksToMarkdown(document),
  text: blocksToPlainText(document),
});

/**
 * The editor migrates these legacy Editor.js blocks on load
 * (`src/components/migration/legacy-grammar.mjs`). /view must render each one
 * exactly like the block the editor turns it into.
 */
describe('legacy blocks read like their migration result', () => {
  it('renders a legacy warning as a callout with title and message paragraphs, marks kept', () => {
    const legacy = readAll({
      blocks: [{ type: 'warning', data: { title: 'L1<br><b>bold</b>', message: 'M <i>it</i>' } }],
    });

    expect(legacy.html).toBe('<aside><span>⚠️</span><p>L1<br><b>bold</b></p><p>M <i>it</i></p></aside>');
    expect(legacy.markdown).toBe('> ⚠️ L1  \n> **bold**\n> \n> M *it*');
    expect(legacy.text).toBe('L1\nbold\n\nM it');
  });

  it.each([
    [
      'a toggleList becomes a toggle',
      { type: 'toggleList', data: { title: 'More <b>detail</b>', isExpanded: true, body: { blocks: [{ type: 'paragraph', data: { text: 'inner' } }] } } },
      [
        { id: 't', type: 'toggle', data: { text: 'More <b>detail</b>', isOpen: true }, content: ['c'] },
        { id: 'c', parent: 't', type: 'paragraph', data: { text: 'inner' } },
      ],
    ],
    [
      'a toggleList with titleVariant becomes a toggle heading',
      { type: 'toggleList', data: { title: 'Section', titleVariant: 2, body: { blocks: [{ type: 'paragraph', data: { text: 'inner' } }] } } },
      [
        { id: 't', type: 'header', data: { text: 'Section', level: 2, isToggleable: true }, content: ['c'] },
        { id: 'c', parent: 't', type: 'paragraph', data: { text: 'inner' } },
      ],
    ],
    [
      'a callout with no emoji gets the default one',
      { type: 'callout', data: { title: 'Title', body: { blocks: [] } } },
      [
        { id: 'k', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['p'] },
        { id: 'p', parent: 'k', type: 'paragraph', data: { text: 'Title' } },
      ],
    ],
    [
      'a callout with a hidden emoji shows none',
      { type: 'callout', data: { title: 'Title', emoji: '🔥', isEmojiVisible: false, body: { blocks: [] } } },
      [
        { id: 'k', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['p'] },
        { id: 'p', parent: 'k', type: 'paragraph', data: { text: 'Title' } },
      ],
    ],
    [
      'a linkTool becomes a bookmark',
      { type: 'linkTool', data: { link: 'https://ex.com', meta: { title: 'Site', description: 'About', image: { url: 'https://ex.com/i.png' } } } },
      [{ id: 'k', type: 'bookmark', data: { url: 'https://ex.com', title: 'Site', description: 'About', image: 'https://ex.com/i.png' } }],
    ],
    [
      'an attaches block becomes a bookmark',
      { type: 'attaches', data: { file: { url: 'https://ex.com/f.pdf', name: 'f.pdf' }, title: 'Report' } },
      [{ id: 'k', type: 'bookmark', data: { url: 'https://ex.com/f.pdf', title: 'Report' } }],
    ],
    [
      'a raw block becomes a code block',
      { type: 'raw', data: { html: '<div>raw</div>' } },
      [{ id: 'k', type: 'code', data: { code: '<div>raw</div>' } }],
    ],
    [
      'an @editorjs/image block reads its url from file.url',
      { type: 'image', data: { file: { url: 'https://ex.com/a.png' }, caption: 'cap', withBorder: true } },
      [{ id: 'k', type: 'image', data: { url: 'https://ex.com/a.png', caption: 'cap', frame: 'border' } }],
    ],
  ])('%s', (_name, legacyBlock, currentBlocks) => {
    const legacy = readAll({ blocks: [legacyBlock] });
    const current = readAll({ blocks: currentBlocks });

    expect(legacy).toEqual(current);
  });

  it('offers a legacy warning title and message for translation', () => {
    const texts = extractTexts({ blocks: [{ type: 'warning', data: { title: 'Heads up', message: 'Read this' } }] });

    expect(texts).toEqual(['Heads up', 'Read this']);
  });
});
