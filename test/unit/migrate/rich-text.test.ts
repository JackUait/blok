// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migrateToRichText, richTextToHtml, richTextToPlainText } from '../../../src/migrate';
import type { RichText } from '../../../types/rich-text';

describe('migrate rich text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs without a DOM', () => {
    expect(typeof document).toBe('undefined');
  });

  it('converts known rich fields of a stored document', () => {
    const out = migrateToRichText({ blocks: [
      { id: 'a', type: 'paragraph', data: { text: '<b>a</b> &lt;' } },
      { id: 'b', type: 'image', data: { caption: 'cap' } },
      { id: 'c', type: 'my-tool', data: { text: '<b>left alone</b>' } },
    ] });

    expect(out.blocks[0].data.text).toEqual([{ text: 'a', marks: { bold: true } }, { text: ' <' }]);
    expect(out.blocks[1].data.caption).toBe('cap');
    expect(out.blocks[2].data.text).toBe('<b>left alone</b>');
  });

  it('leaves a type named like an Object.prototype key alone', () => {
    const out = migrateToRichText({ blocks: [{ id: 'a', type: 'constructor', data: { text: '<b>x</b>' } }] });

    expect(out.blocks[0].data.text).toBe('<b>x</b>');
  });

  it('reports what it could only keep as an embed or a custom mark', () => {
    const onLossy = vi.fn();

    migrateToRichText({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x<img src="a.png"><abbr title="t">y</abbr>' } }] }, { onLossy });
    expect(onLossy).toHaveBeenCalledWith({ blockId: 'a', blockType: 'paragraph', field: 'text', reason: 'html-embed' });
    expect(onLossy).toHaveBeenCalledWith({ blockId: 'a', blockType: 'paragraph', field: 'text', reason: 'custom-mark' });
  });

  it('reports a lossy field inside a database-row property document', () => {
    const onLossy = vi.fn();
    const out = migrateToRichText({ blocks: [{
      id: 'row',
      type: 'database-row',
      data: { properties: { notes: { blocks: [{ id: 'n', type: 'paragraph', data: { text: 'x<img src="a.png">' } }] } } },
    }] }, { onLossy });

    expect(onLossy).toHaveBeenCalledWith({ blockId: 'n', blockType: 'paragraph', field: 'text', reason: 'html-embed' });
    expect(out.blocks[0].data).toEqual({ properties: { notes: { blocks: [
      { id: 'n', type: 'paragraph', data: { text: [{ text: 'x' }, { embed: { html: '<img src="a.png">' } }] } },
    ] } } });
  });

  it('leaves nested documents of an unknown type alone', () => {
    const onLossy = vi.fn();
    const input = { blocks: [{
      id: 'x',
      type: 'my-tool',
      data: { properties: { notes: { blocks: [{ id: 'n', type: 'paragraph', data: { text: '<b>a</b><img src="a.png">' } }] } } },
    }] };

    expect(migrateToRichText(input, { onLossy })).toEqual(input);
    expect(onLossy).not.toHaveBeenCalled();
  });

  it('does not report fields that were already segments', () => {
    const onLossy = vi.fn();
    const once = migrateToRichText({ blocks: [{ id: 'a', type: 'paragraph', data: { text: '<img src="a.png">' } }] });

    migrateToRichText(once, { onLossy });
    expect(onLossy).not.toHaveBeenCalled();
  });

  it('is idempotent', () => {
    const once = migrateToRichText({ blocks: [{ id: 'a', type: 'paragraph', data: { text: '<i>x</i>' } }] });

    expect(migrateToRichText(once)).toEqual(once);
  });

  it('turns segments into html and plain text', () => {
    const rich: RichText = [{ text: 'a < ', marks: { bold: true } }, { embed: { equation: { expression: 'x^2' } } }, { text: '\nb' }];

    expect(richTextToHtml(rich)).toBe('<strong>a &lt; </strong><span data-latex="x^2">x^2</span><br>b');
    expect(richTextToPlainText(rich)).toBe('a < x^2\nb');
  });

  it('gives page and html embeds their stored text', () => {
    const rich: RichText = [{ embed: { page: { id: 'p1' } } }, { embed: { html: '<abbr>a &amp; b</abbr>' } }];

    expect(richTextToPlainText(rich)).toBe('Pagea & b');
  });
});
