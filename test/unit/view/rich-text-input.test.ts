// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blocksToHtml,
  blocksToMarkdown,
  blocksToMarkdownWithReport,
  blocksToPlainText,
  blocksToViewNodes,
  blokDocumentSchema,
  extractTexts,
  injectTexts,
  outlineFromOutputData,
  pageIndex,
  restoreHeadingAnchors,
} from '../../../src/view';
import type { OutputData } from '../../../types';

const html: OutputData = {
  blocks: [
    { id: 'a', type: 'header', data: { text: '<strong>Title</strong>', level: 2 } },
    { id: 'b', type: 'paragraph', data: { text: 'a &lt; b <a href="#title">Title</a>' } },
    { id: 'c', type: 'quote', data: { text: '<i>said</i>', caption: 'Ann' } },
    { id: 'd', type: 'list', data: { text: 'item', style: 'unordered' } },
    { id: 'e', type: 'toggle', data: { text: 'more' } },
    { id: 'f', type: 'paragraph', data: { text: 'see <a data-blok-page-id="p9">Page</a>' } },
  ],
};

const segments: OutputData = {
  blocks: [
    { id: 'a', type: 'header', data: { text: [{ text: 'Title', marks: { bold: true } }], level: 2 } },
    { id: 'b', type: 'paragraph', data: { text: [{ text: 'a < b ' }, { text: 'Title', marks: { link: { href: '#title' } } }] } },
    { id: 'c', type: 'quote', data: { text: [{ text: 'said', marks: { italic: true } }], caption: [{ text: 'Ann' }] } },
    { id: 'd', type: 'list', data: { text: [{ text: 'item' }], style: 'unordered' } },
    { id: 'e', type: 'toggle', data: { text: [{ text: 'more' }] } },
    { id: 'f', type: 'paragraph', data: { text: [{ text: 'see ' }, { embed: { page: { id: 'p9' } } }] } },
  ],
};

type Def = { properties?: Record<string, unknown> };

describe('src/view reads rich-text segments like HTML', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['blocksToHtml', (d: OutputData): unknown => blocksToHtml(d)],
    ['blocksToPlainText', (d: OutputData): unknown => blocksToPlainText(d)],
    ['blocksToMarkdown', (d: OutputData): unknown => blocksToMarkdown(d)],
    ['blocksToMarkdownWithReport', (d: OutputData): unknown => blocksToMarkdownWithReport(d)],
    ['outlineFromOutputData', (d: OutputData): unknown => outlineFromOutputData(d)],
    ['pageIndex', (d: OutputData): unknown => pageIndex(d)],
    ['blocksToViewNodes', (d: OutputData): unknown => blocksToViewNodes(d)],
    ['extractTexts', (d: OutputData): unknown => extractTexts(d)],
    ['restoreHeadingAnchors report', (d: OutputData): unknown => restoreHeadingAnchors(d).report],
  ])('%s gives the same result for segments and HTML', (_name, run) => {
    expect(run(segments)).toEqual(run(html));
  });

  it('pageIndex sees a page embed segment as a reference', () => {
    expect(pageIndex(segments).references).toContainEqual(expect.objectContaining({ pageId: 'p9', sourceBlockId: 'f' }));
  });

  it('restoreHeadingAnchors adds the anchor and keeps segment fields as segments', () => {
    const { data, report } = restoreHeadingAnchors(segments);

    expect(report.restored).toEqual([{ anchor: 'title', blockId: 'a' }]);
    expect(data.blocks[0].data).toEqual({ ...segments.blocks[0].data, anchor: 'title' });
    expect(data.blocks[1]).toEqual(segments.blocks[1]);
  });

  it('skips malformed entries without throwing', () => {
    const loose = { blocks: [null, 'x', { type: 'paragraph' }, { type: 'paragraph', data: { text: [{ text: 'ok' }] } }] };

    expect(blocksToPlainText(loose as unknown as OutputData)).toBe('ok');
  });

  describe('injectTexts', () => {
    it('writes a segments field back as segments and a string field as a string', () => {
      const mixed: OutputData = {
        blocks: [
          { id: 's', type: 'paragraph', data: { text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }] } },
          { id: 'h', type: 'paragraph', data: { text: 'Plain <b>html</b>' } },
        ],
      };

      expect(extractTexts(mixed)).toEqual(['Hello <strong>world</strong>', 'Plain <b>html</b>']);

      const out = injectTexts(mixed, ['Hallo <b>Welt</b>', 'Schlicht <b>html</b>']);

      expect(out.blocks[0].data.text).toEqual([{ text: 'Hallo ' }, { text: 'Welt', marks: { bold: true } }]);
      expect(out.blocks[1].data.text).toBe('Schlicht <b>html</b>');
    });

    it('round-trips segments unchanged when the same texts go back', () => {
      const doc: OutputData = {
        blocks: [
          {
            id: 'r',
            type: 'paragraph',
            data: {
              text: [
                { text: 'a < b && "c" ' },
                { text: 'bold', marks: { bold: true } },
                { text: ' ' },
                { text: 'link', marks: { link: { href: 'https://x.test/?a=1&b=2' } } },
                { text: '\n' },
              ],
            },
          },
        ],
      };

      expect(injectTexts(doc, extractTexts(doc))).toEqual(doc);
    });
  });

  describe('blokDocumentSchema', () => {
    const defs = blokDocumentSchema.$defs as unknown as Record<string, Def>;

    it.each([
      ['paragraph', 'text'],
      ['header', 'text'],
      ['list', 'text'],
      ['toggle', 'text'],
      ['quote', 'text'],
    ])('%s.%s accepts an HTML string or a segment array', (type, field) => {
      const schema = defs[type].properties?.[field] as { oneOf?: Array<{ type?: string; items?: { anyOf?: Array<{ required?: string[] }> } }> };
      const branches = schema.oneOf ?? [];

      expect(branches.map(branch => branch.type)).toEqual(['string', 'array']);

      const items = branches[1]?.items?.anyOf ?? [];

      expect(items.map(item => item.required)).toEqual([['text'], ['embed']]);
    });
  });
});
