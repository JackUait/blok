// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { extractTexts, injectTexts } from '../../../src/view/document-texts';

/**
 * A document mixing every shape the walker knows: current blocks, media
 * captions, a table with both cell dialects, and the legacy nested payloads
 * stored documents still carry.
 */
const richDocument = (): Record<string, unknown> => ({
  version: '1.12.0',
  time: 1700000000000,
  blocks: [
    { id: 'h', type: 'header', data: { text: 'Title', level: 2 } },
    { id: 'p', type: 'paragraph', data: { text: 'Hello <b>world</b>' } },
    { id: 'img', type: 'image', data: { url: 'https://cdn/img.png', caption: 'A cat' } },
    { id: 'code', type: 'code', data: { code: 'const a = 1;' } },
    { id: 'bm', type: 'bookmark', data: { url: 'https://example.com', title: 'Example' } },
    { id: 'aud', type: 'audio', data: { src: 'a.mp3', caption: 'Episode 1', title: 'Intro' } },
    { id: 'f', type: 'file', data: { url: 'f.pdf', caption: 'The spec', fileName: 'spec.pdf' } },
    { id: 'div', type: 'divider', data: {} },
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: true,
        content: [[{ blocks: ['cell-p'], text: 'Stale copy' }, { blocks: [], text: 'Inline <i>cell</i>' }]],
      },
    },
    { id: 'cell-p', type: 'paragraph', parent: 'tbl', data: { text: 'Cell block' } },
  ],
});

describe('extractTexts / injectTexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs without document or window (node environment)', () => {
    expect(typeof document).toBe('undefined');

    expect(extractTexts(richDocument())).toContain('Hello <b>world</b>');
  });

  it('round-trips a document unchanged when the texts are put back as they came', () => {
    const original = richDocument();

    expect(injectTexts(original, extractTexts(original))).toEqual(original);
  });

  it('round-trips with code included too', () => {
    const original = richDocument();
    const options = { includeCode: true };

    expect(injectTexts(original, extractTexts(original, options), options)).toEqual(original);
  });

  it('returns texts in document order across a nested structure', () => {
    const data = {
      blocks: [
        { id: 'c', type: 'callout', data: { emoji: '💡' } },
        { id: 'c1', type: 'paragraph', parent: 'c', data: { text: 'First child' } },
        { id: 'c2', type: 'list', parent: 'c', data: { text: 'Second child', style: 'unordered' } },
        { id: 'after', type: 'paragraph', data: { text: 'After the callout' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['First child', 'Second child', 'After the callout']);
  });

  it('extracts and injects an image caption', () => {
    const data = { blocks: [{ type: 'image', data: { url: 'https://cdn/x.png', caption: 'A cat' } }] };

    expect(extractTexts(data)).toEqual(['A cat']);

    const injected = injectTexts(data, ['Кот']);

    expect(injected).toEqual({ blocks: [{ type: 'image', data: { url: 'https://cdn/x.png', caption: 'Кот' } }] });
  });

  it('never treats a url as prose', () => {
    const data = {
      blocks: [
        { type: 'bookmark', data: { url: 'https://example.com', title: 'Example' } },
        { type: 'image', data: { url: 'https://cdn/x.png', caption: '' } },
        { type: 'embed', data: { source: 'https://youtu.be/x', caption: 'Clip' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['Example', 'Clip']);
  });

  /**
   * `blocks-to-plain-text` reads media fields as a display fallback chain — the
   * first non-empty one wins. Translation is not display: every field on the
   * page needs its own translation.
   */
  it('takes every prose field of a media block, not just the first non-empty one', () => {
    const data = {
      blocks: [
        { type: 'audio', data: { caption: 'Episode 1', title: 'Intro' } },
        { type: 'bookmark', data: { url: 'u', title: 'Example', description: 'What it is' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['Episode 1', 'Intro', 'Example', 'What it is']);
  });

  /**
   * `fileName` sets the anchor's `download` attribute (`src/tools/file/index.ts`),
   * so translating it renames the file the reader ends up with on disk. The
   * caption beside it is the prose.
   */
  it('never translates a file name, because it is what the reader downloads', () => {
    const document = {
      blocks: [{ id: 'f', type: 'file', data: { url: 'f.pdf', caption: 'The spec', fileName: 'spec.pdf' } }],
    };

    expect(extractTexts(document)).toEqual(['The spec']);
    expect(injectTexts(document, ['Спецификация']).blocks[0].data)
      .toMatchObject({ caption: 'Спецификация', fileName: 'spec.pdf' });
  });

  /**
   * Alt text is written for a reader who cannot see the image, and a bookmark
   * card shows its description under the title — both are prose on the page.
   */
  it('translates alt text and a bookmark description', () => {
    const document = {
      blocks: [
        { id: 'i', type: 'image', data: { url: 'u', caption: 'Cap', alt: 'A grey cat' } },
        { id: 'b', type: 'bookmark', data: { url: 'u', title: 'Example', description: 'What it is' } },
      ],
    };

    expect(extractTexts(document)).toEqual(['Cap', 'A grey cat', 'Example', 'What it is']);
  });

  it('falls back to data.text for an unknown tool', () => {
    const data = { blocks: [{ type: 'some-vendor-tool', data: { text: 'Prose in an unknown tool' } }] };

    expect(extractTexts(data)).toEqual(['Prose in an unknown tool']);
    expect(injectTexts(data, ['Translated'])).toEqual({
      blocks: [{ type: 'some-vendor-tool', data: { text: 'Translated' } }],
    });
  });

  it('excludes code by default and includes it on request, with matching counts', () => {
    const data = {
      blocks: [
        { type: 'paragraph', data: { text: 'Run this:' } },
        { type: 'code', data: { code: 'const a = 1;' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['Run this:']);
    expect(extractTexts(data, { includeCode: true })).toEqual(['Run this:', 'const a = 1;']);

    expect(injectTexts(data, ['Запусти:'])).toEqual({
      blocks: [
        { type: 'paragraph', data: { text: 'Запусти:' } },
        { type: 'code', data: { code: 'const a = 1;' } },
      ],
    });
  });

  it('rejects texts collected under different options', () => {
    const data = { blocks: [{ type: 'code', data: { code: 'const a = 1;' } }] };

    expect(() => injectTexts(data, extractTexts(data, { includeCode: true }))).toThrow(RangeError);
  });

  it('skips empty and whitespace-only values on both sides', () => {
    const data = {
      blocks: [
        { type: 'paragraph', data: { text: '' } },
        { type: 'paragraph', data: { text: '   ' } },
        { type: 'image', data: { url: 'x.png', caption: '' } },
        { type: 'paragraph', data: { text: 'Real prose' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['Real prose']);
    expect(injectTexts(data, ['Настоящий текст'])).toEqual({
      blocks: [
        { type: 'paragraph', data: { text: '' } },
        { type: 'paragraph', data: { text: '   ' } },
        { type: 'image', data: { url: 'x.png', caption: '' } },
        { type: 'paragraph', data: { text: 'Настоящий текст' } },
      ],
    });
  });

  it('writes an empty translation rather than skipping its slot', () => {
    const data = {
      blocks: [
        { type: 'paragraph', data: { text: 'Drop me' } },
        { type: 'paragraph', data: { text: 'Keep me' } },
      ],
    };

    expect(injectTexts(data, ['', 'Оставь'])).toEqual({
      blocks: [
        { type: 'paragraph', data: { text: '' } },
        { type: 'paragraph', data: { text: 'Оставь' } },
      ],
    });
  });

  it('leaves malformed entries exactly as they were', () => {
    const data = {
      blocks: [
        42,
        null,
        { id: 'no-type', data: { text: 'Not a block' } },
        { type: '', data: { text: 'Empty type' } },
        { type: 'paragraph', data: 'not an object' },
        { type: 'paragraph', data: { text: 'Real' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['Real']);
    expect(injectTexts(data, ['Реальный'])).toEqual({
      blocks: [
        42,
        null,
        { id: 'no-type', data: { text: 'Not a block' } },
        { type: '', data: { text: 'Empty type' } },
        { type: 'paragraph', data: 'not an object' },
        { type: 'paragraph', data: { text: 'Реальный' } },
      ],
    });
  });

  it('reads a subset document holding only a nested child block', () => {
    const subset = { blocks: [{ id: 'c1', type: 'paragraph', parent: 'missing-callout', data: { text: 'Orphan child' } }] };

    expect(extractTexts(subset)).toEqual(['Orphan child']);
    expect(injectTexts(subset, ['Сирота'])).toEqual({
      blocks: [{ id: 'c1', type: 'paragraph', parent: 'missing-callout', data: { text: 'Сирота' } }],
    });
  });

  it('throws a RangeError when the count does not match', () => {
    const data = { blocks: [{ type: 'paragraph', data: { text: 'One' } }] };

    expect(() => injectTexts(data, [])).toThrow(RangeError);
    expect(() => injectTexts(data, ['a', 'b'])).toThrow(RangeError);
  });

  it('translates a table\'s inline-HTML cell and leaves its block-id cell alone', () => {
    const data = {
      blocks: [
        {
          id: 'tbl',
          type: 'table',
          data: {
            withHeadings: false,
            /** The id cell keeps a stale `text` — the referenced block is authoritative. */
            content: [[{ blocks: ['cell-p'], text: 'Stale copy' }, { blocks: [], text: 'Inline <i>cell</i>' }]],
          },
        },
        { id: 'cell-p', type: 'paragraph', parent: 'tbl', data: { text: 'Cell block' } },
      ],
    };

    expect(extractTexts(data)).toEqual(['Inline <i>cell</i>', 'Cell block']);

    expect(injectTexts(data, ['Ячейка <i>внутри</i>', 'Блок ячейки'])).toEqual({
      blocks: [
        {
          id: 'tbl',
          type: 'table',
          data: {
            withHeadings: false,
            content: [[{ blocks: ['cell-p'], text: 'Stale copy' }, { blocks: [], text: 'Ячейка <i>внутри</i>' }]],
          },
        },
        { id: 'cell-p', type: 'paragraph', parent: 'tbl', data: { text: 'Блок ячейки' } },
      ],
    });
  });

  it('reads a legacy string table cell and skips a merged-away cell', () => {
    const data = {
      blocks: [
        {
          type: 'table',
          data: { content: [['Legacy <b>cell</b>', { text: 'Origin', colspan: 2 }, { mergedInto: [0, 1], text: 'covered' }]] },
        },
      ],
    };

    expect(extractTexts(data)).toEqual(['Legacy <b>cell</b>', 'Origin']);
    expect(injectTexts(data, ['Старая <b>ячейка</b>', 'Начало'])).toEqual({
      blocks: [
        {
          type: 'table',
          data: { content: [['Старая <b>ячейка</b>', { text: 'Начало', colspan: 2 }, { mergedInto: [0, 1], text: 'covered' }]] },
        },
      ],
    });
  });

  it('walks a legacy list\'s nested items, including plain-string items', () => {
    const data = {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'First', items: [{ content: 'Nested' }, 'Plain string item'] },
              { text: 'Old checklist item', checked: true },
            ],
          },
        },
      ],
    };

    expect(extractTexts(data)).toEqual(['First', 'Nested', 'Plain string item', 'Old checklist item']);

    expect(injectTexts(data, ['Первый', 'Вложенный', 'Строка', 'Пункт'])).toEqual({
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Первый', items: [{ content: 'Вложенный' }, 'Строка'] },
              { text: 'Пункт', checked: true },
            ],
          },
        },
      ],
    });
  });

  it('walks a legacy callout body, malformed entries included', () => {
    const data = {
      blocks: [
        {
          type: 'callout',
          data: {
            emoji: '💡',
            body: {
              blocks: [
                { type: 'paragraph', data: { text: 'Inside the callout' } },
                7,
                { type: 'list', data: { style: 'unordered', items: ['Legacy item'] } },
              ],
            },
          },
        },
      ],
    };

    expect(extractTexts(data)).toEqual(['Inside the callout', 'Legacy item']);
    expect(injectTexts(data, ['Внутри', 'Пункт'])).toEqual({
      blocks: [
        {
          type: 'callout',
          data: {
            emoji: '💡',
            body: {
              blocks: [
                { type: 'paragraph', data: { text: 'Внутри' } },
                7,
                { type: 'list', data: { style: 'unordered', items: ['Пункт'] } },
              ],
            },
          },
        },
      ],
    });
  });

  it('walks the other legacy nesting dialects: checklist items and a toggleList title + body', () => {
    const data = {
      blocks: [
        { type: 'checklist', data: { items: [{ text: 'Buy milk', checked: false }] } },
        {
          type: 'toggleList',
          data: {
            title: 'Toggle heading',
            isExpanded: true,
            body: { blocks: [{ type: 'paragraph', data: { text: 'Hidden body' } }] },
          },
        },
      ],
    };

    expect(extractTexts(data)).toEqual(['Buy milk', 'Toggle heading', 'Hidden body']);
    expect(injectTexts(data, ['Купить молоко', 'Заголовок', 'Скрытый текст'])).toEqual({
      blocks: [
        { type: 'checklist', data: { items: [{ text: 'Купить молоко', checked: false }] } },
        {
          type: 'toggleList',
          data: {
            title: 'Заголовок',
            isExpanded: true,
            body: { blocks: [{ type: 'paragraph', data: { text: 'Скрытый текст' } }] },
          },
        },
      ],
    });
  });

  it('does not mutate the input document', () => {
    const data = richDocument();
    const snapshot = richDocument();

    injectTexts(data, extractTexts(data).map((text) => `${text}!`));

    expect(data).toEqual(snapshot);
  });

  it('tolerates input that is not a document at all', () => {
    expect(extractTexts(42)).toEqual([]);
    expect(extractTexts(null)).toEqual([]);
    expect(extractTexts({ blocks: 'nope' })).toEqual([]);

    expect(injectTexts(42, [])).toEqual({ blocks: [] });
    expect(injectTexts({ version: '1.0.0' }, [])).toEqual({ version: '1.0.0', blocks: [] });
  });

  it('keeps the document envelope around the translated blocks', () => {
    const data = { version: '1.12.0', time: 1700000000000, blocks: [{ type: 'paragraph', data: { text: 'Hi' } }] };

    expect(injectTexts(data, ['Привет'])).toEqual({
      version: '1.12.0',
      time: 1700000000000,
      blocks: [{ type: 'paragraph', data: { text: 'Привет' } }],
    });
  });

  /**
   * A legacy quote's attribution lives in `caption` and renders as a `<cite>`,
   * so it is prose the reader sees — and was never handed to a translator.
   */
  it('translates a legacy quote caption alongside its text', () => {
    const data = {
      blocks: [{ type: 'quote', data: { text: 'Wise words', caption: 'Ada Lovelace' } }],
    };

    expect(extractTexts(data)).toEqual(['Wise words', 'Ada Lovelace']);
    expect(injectTexts(data, ['Мудрые слова', 'Ада Лавлейс'])).toEqual({
      blocks: [{ type: 'quote', data: { text: 'Мудрые слова', caption: 'Ада Лавлейс' } }],
    });
  });
});
