// @vitest-environment node

/**
 * Host, peer and stored data can hold mark or embed values of the wrong type.
 * Every shared converter reads them leniently: a bad value is dropped, the
 * rest of the document is kept. A throw here blanks a whole document.
 */
import { describe, expect, it } from 'vitest';

import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';
import { canonicalizeSegments } from '../../../../src/shared/rich-text/html-to-segments';
import { deltaToSegments, segmentsToDeltaOps } from '../../../../src/shared/rich-text/delta';
import { readRichTextLeniently } from '../../../../src/shared/rich-text/guards';
import { blockDataToHtml, outputBlocksToHtml } from '../../../../src/shared/rich-text/block-data';
import { blocksToHtml, blocksToPlainText } from '../../../../src/view';
import { richTextToHtml, richTextToPlainText } from '../../../../src/migrate';
import type { OutputBlockData, OutputData } from '../../../../types';
import type { RichText } from '../../../../types/rich-text';

/** Each malformed segment, between two good runs. */
const BAD_SEGMENTS: Array<[string, unknown]> = [
  ['embed page null', { embed: { page: null } }],
  ['embed page id object', { embed: { page: { id: {} } } }],
  ['embed equation string', { embed: { equation: 'x' } }],
  ['embed equation null', { embed: { equation: null } }],
  ['embed equation expression number', { embed: { equation: { expression: 5 } } }],
  ['embed html number', { embed: { html: 5 } }],
  ['embed empty', { embed: {} }],
  ['embed two variants', { embed: { html: '<hr>', page: { id: 'p' } } }],
  ['embed extra inner key', { embed: { page: { id: 'p', x: 1 } } }],
];

/** Each malformed mark on one run. */
const BAD_MARKS: Array<[string, Record<string, unknown>]> = [
  ['tag attr number', { 'tag:b': { x: 1 } }],
  ['tag attr null', { 'tag:span': { x: null, title: 't' } }],
  ['tag value string', { 'tag:span': 'x' }],
  ['tag value array', { 'tag:span': ['x'] }],
  ['color object', { color: {} }],
  ['background number', { background: 5 }],
  ['link href number', { link: { href: 42 } }],
];

const around = (bad: unknown): RichText => [{ text: 'a' }, bad, { text: 'b' }] as unknown as RichText;

describe('malformed segments', () => {
  describe.each(BAD_SEGMENTS)('%s', (_label, bad) => {
    it('segmentsToHtml drops the segment and keeps the text around it', () => {
      expect(segmentsToHtml(around(bad))).toBe('ab');
    });

    it('canonicalizeSegments drops the segment', () => {
      expect(canonicalizeSegments(around(bad))).toEqual([{ text: 'ab' }]);
    });

    it('readRichTextLeniently drops the segment', () => {
      expect(readRichTextLeniently([bad])).toEqual([]);
    });

    it('deltaToSegments drops the embed', () => {
      const embed = (bad as { embed: unknown }).embed;

      expect(deltaToSegments([{ insert: 'a' }, { insert: embed }, { insert: 'b' }])).toEqual([{ text: 'ab' }]);
    });

    it('segmentsToDeltaOps writes no op for it', () => {
      expect(segmentsToDeltaOps(around(bad))).toEqual([{ insert: 'ab', attributes: {} }]);
    });
  });

  it('a non-record item or a text of the wrong type is dropped', () => {
    expect(segmentsToHtml([null, 5, 'x', { text: 5 }, { text: 'ok' }] as unknown as RichText)).toBe('ok');
  });

  it('a marks value that is not a record counts as no marks', () => {
    expect(canonicalizeSegments([{ text: 'a', marks: 'bold' }] as unknown as RichText)).toEqual([{ text: 'a' }]);
  });

  it('valid embeds still pass through unchanged', () => {
    const rich: RichText = [
      { embed: { equation: { expression: 'x' } } },
      { embed: { page: { id: 'p' } } },
      { embed: { html: '<hr>' } },
    ];

    expect(canonicalizeSegments(rich)).toEqual(rich);
  });
});

describe('malformed marks', () => {
  it.each(BAD_MARKS)('%s: segmentsToHtml does not throw', (_label, marks) => {
    expect(() => segmentsToHtml([{ text: 'mid', marks } as unknown as RichText[number]])).not.toThrow();
  });

  it('a tag:* record keeps only its string attributes', () => {
    expect(canonicalizeSegments([{ text: 'm', marks: { 'tag:span': { x: 1, y: null, title: 't' } } }] as unknown as RichText))
      .toEqual([{ text: 'm', marks: { 'tag:span': { title: 't' } } }]);
    expect(segmentsToHtml([{ text: 'm', marks: { 'tag:span': { x: 1, title: 't' } } }] as unknown as RichText))
      .toBe('<span title="t">m</span>');
  });

  it('a tag:* mark whose value is not a record is dropped', () => {
    expect(canonicalizeSegments([{ text: 'm', marks: { 'tag:span': 'x', bold: true } }] as unknown as RichText))
      .toEqual([{ text: 'm', marks: { bold: true } }]);
  });

  it('a colour that is not a string is absent', () => {
    expect(canonicalizeSegments([{ text: 'm', marks: { color: {}, background: 5 } }] as unknown as RichText))
      .toEqual([{ text: 'm' }]);
    expect(segmentsToHtml([{ text: 'm', marks: { color: {} } }] as unknown as RichText)).toBe('m');
  });

  it('deltaToSegments reads a peer\'s non-string tag attribute leniently', () => {
    expect(deltaToSegments([{ insert: 'm', attributes: { 'tag:b': { x: 1 } } }]))
      .toEqual([{ text: 'm', marks: { 'tag:b': {} } }]);
  });
});

describe('malformed values in documents', () => {
  const doc = (text: unknown): OutputData => ({
    blocks: [
      { id: 'good1', type: 'paragraph', data: { text: 'first' } },
      { id: 'bad', type: 'paragraph', data: { text } },
      { id: 'good2', type: 'header', data: { text: [{ text: 'second' }], level: 2 } },
    ],
  });

  const BAD_FIELDS: Array<[string, unknown]> = [
    ...BAD_SEGMENTS.map(([label, bad]): [string, unknown] => [label, around(bad)]),
    ['tag attr number', [{ text: 'mid', marks: { 'tag:b': { x: 1 } } }]],
    ['tag attr null', [{ text: 'mid', marks: { 'tag:b': { x: null } } }]],
  ];

  it.each(BAD_FIELDS)('%s: blocksToHtml keeps every block', (_label, text) => {
    const html = blocksToHtml(doc(text));

    expect(html).toContain('first');
    expect(html).toContain('second');
  });

  it.each(BAD_FIELDS)('%s: blocksToPlainText keeps every block', (_label, text) => {
    const plain = blocksToPlainText(doc(text));

    expect(plain).toContain('first');
    expect(plain).toContain('second');
  });

  it.each(BAD_SEGMENTS)('%s: richTextToHtml and richTextToPlainText drop the segment', (_label, bad) => {
    expect(richTextToHtml(around(bad))).toBe('ab');
    expect(richTextToPlainText(around(bad))).toBe('ab');
  });

  it('a nested document entry that is not a block passes through', () => {
    const properties = { body: { blocks: [null, { id: 'n', type: 'paragraph', data: { text: [{ text: 'x' }] } }] } };
    const data = blockDataToHtml({ properties }, [], () => ['text'], { nestedDocuments: true });

    expect(data).toEqual({ properties: { body: { blocks: [null, { id: 'n', type: 'paragraph', data: { text: 'x' } }] } } });
  });

  it('a block whose data is not a record passes through', () => {
    const blocks = [{ id: 'x', type: 'paragraph', data: 'oops' }] as unknown as OutputBlockData[];

    expect(outputBlocksToHtml(blocks, () => ['text'])).toBe(blocks);
  });
});
