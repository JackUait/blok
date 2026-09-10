// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { extractTexts, injectTexts } from '../../../src/view/document-texts';

/**
 * Fixtures carry DISTINCT strings per slot: a shared value makes a
 * wrong-target mutant (caption read where alt was meant) compare equal.
 */
const doc = (blocks: unknown[]): Record<string, unknown> => ({ version: '1.12.0', blocks });

describe('document-texts — mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a paragraph text, and writes a translation back into the same field', () => {
    const data = doc([{ id: 'p1', type: 'paragraph', data: { text: 'Paragraph prose' } }]);

    expect(extractTexts(data)).toEqual(['Paragraph prose']);
    expect(injectTexts(data, ['Текст абзаца'])).toEqual(
      doc([{ id: 'p1', type: 'paragraph', data: { text: 'Текст абзаца' } }]),
    );
  });

  /**
   * Every declared field of every type, each carrying a distinct marker. A
   * dropped field name, an emptied field list, or a wiped PROSE_FIELDS map
   * changes exactly one of these expected arrays.
   */
  const proseCases: Array<{ type: string; data: Record<string, unknown>; expected: string[] }> = [
    { type: 'header', data: { text: 'Header prose', level: 3 }, expected: ['Header prose'] },
    { type: 'quote', data: { text: 'Quote prose', caption: 'Quote attribution' }, expected: ['Quote prose', 'Quote attribution'] },
    { type: 'toggle', data: { text: 'Toggle prose' }, expected: ['Toggle prose'] },
    { type: 'list', data: { text: 'Flat list prose', style: 'unordered' }, expected: ['Flat list prose'] },
    { type: 'image', data: { url: 'https://cdn/i.png', caption: 'Image caption', alt: 'Image alt text' }, expected: ['Image caption', 'Image alt text'] },
    { type: 'video', data: { url: 'https://cdn/v.mp4', caption: 'Video caption' }, expected: ['Video caption'] },
    { type: 'embed', data: { source: 'https://youtu.be/x', caption: 'Embed caption' }, expected: ['Embed caption'] },
    { type: 'audio', data: { src: 'audio.mp3', caption: 'Audio caption', title: 'Audio title' }, expected: ['Audio caption', 'Audio title'] },
    { type: 'file', data: { url: 'file.pdf', caption: 'File caption' }, expected: ['File caption'] },
    { type: 'bookmark', data: { url: 'https://example.com', title: 'Bookmark title', description: 'Bookmark description' }, expected: ['Bookmark title', 'Bookmark description'] },
    { type: 'toggleList', data: { title: 'ToggleList title' }, expected: ['ToggleList title'] },
    { type: 'callout', data: { title: 'Callout title' }, expected: ['Callout title'] },
  ];

  for (const { type, data, expected } of proseCases) {
    it(`emits every declared prose field of a ${type} block, in field order`, () => {
      expect(extractTexts(doc([{ type, data }]))).toEqual(expected);
    });
  }

  it('reads a code block only when includeCode is on, and then reads its source', () => {
    const data = doc([
      { type: 'paragraph', data: { text: 'Run this:' } },
      { type: 'code', data: { code: 'const answer = 42;' } },
    ]);

    expect(extractTexts(data)).toEqual(['Run this:']);
    expect(extractTexts(data, { includeCode: true })).toEqual(['Run this:', 'const answer = 42;']);
  });

  it('walks a legacy list\'s items and their nested items, content and text fields both', () => {
    const data = doc([
      {
        type: 'list',
        data: {
          style: 'unordered',
          items: [
            { content: 'Legacy item one', items: [{ content: 'Legacy nested item' }] },
            { text: 'Legacy item two' },
          ],
        },
      },
    ]);

    expect(extractTexts(data)).toEqual(['Legacy item one', 'Legacy nested item', 'Legacy item two']);
  });

  it('walks a legacy checklist\'s items', () => {
    const data = doc([{ type: 'checklist', data: { items: [{ text: 'Checklist item one', checked: true }] } }]);

    expect(extractTexts(data)).toEqual(['Checklist item one']);
  });

  it('walks a legacy callout\'s body blocks', () => {
    const data = doc([
      {
        type: 'callout',
        data: {
          emoji: '💡',
          body: { blocks: [{ type: 'paragraph', data: { text: 'Callout body prose' } }] },
        },
      },
    ]);

    expect(extractTexts(data)).toEqual(['Callout body prose']);
  });

  it('walks a legacy toggleList\'s body blocks', () => {
    const data = doc([
      {
        type: 'toggleList',
        data: {
          title: 'ToggleList heading',
          body: { blocks: [{ type: 'paragraph', data: { text: 'ToggleList body prose' } }] },
        },
      },
    ]);

    expect(extractTexts(data)).toEqual(['ToggleList heading', 'ToggleList body prose']);
  });

  /**
   * Three cell dialects in one table: a plain string cell, a block-id cell
   * (its stale `text` is not prose), a cell whose id list holds a non-string,
   * a row that is not an array, and a merged-away cell.
   */
  it('reads a table\'s inline cells, skipping block-id, merged and non-array rows', () => {
    const data = doc([
      {
        id: 'tbl',
        type: 'table',
        data: {
          withHeadings: false,
          content: [
            ['String cell prose', { blocks: ['cell-p'], text: 'Stale copy' }, { blocks: [42], text: 'Cell with a garbage id' }],
            'not-a-row',
            [{ mergedInto: [0, 1], text: 'Covered cell prose' }],
          ],
        },
      },
      { id: 'cell-p', type: 'paragraph', parent: 'tbl', data: { text: 'Referenced cell block' } },
    ]);

    expect(extractTexts(data)).toEqual(['String cell prose', 'Cell with a garbage id', 'Referenced cell block']);
  });

  it('walks a legacy columns block\'s columns, tolerating one without a blocks array', () => {
    const data = doc([
      {
        type: 'columns',
        data: {
          cols: [
            { width: 60 },
            { blocks: [{ type: 'paragraph', data: { text: 'First column prose' } }] },
          ],
        },
      },
    ]);

    expect(extractTexts(data)).toEqual(['First column prose']);
  });

  it('does not walk a non-columns block\'s stray cols array', () => {
    const data = doc([
      {
        type: 'paragraph',
        data: {
          text: 'Paragraph before stray cols',
          cols: [{ blocks: [{ type: 'paragraph', data: { text: 'Stray column prose' } }] }],
        },
      },
    ]);

    expect(extractTexts(data)).toEqual(['Paragraph before stray cols']);
  });

  it('does not walk a non-table block\'s stray content array as a cell grid', () => {
    const data = doc([
      { type: 'paragraph', data: { text: 'Paragraph before stray content', content: [['Stray grid prose']] } },
    ]);

    expect(extractTexts(data)).toEqual(['Paragraph before stray content']);
  });

  it('names both counts when the text count does not match the document', () => {
    const data = doc([{ type: 'paragraph', data: { text: 'One' } }]);

    expect(() => injectTexts(data, [])).toThrowError(
      new RangeError('injectTexts expected 1 texts for this document, received 0.'),
    );
  });
});
