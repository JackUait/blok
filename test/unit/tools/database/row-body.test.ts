import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { coverImageOf, pageContentPreview, pageContentSourceBlocks, rowDescription } from '../../../../src/tools/database/row-body';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-body', name: 'Card details', type: 'richText', position: 'a1' },
];

const row = (properties: DatabaseRow['properties']): DatabaseRow => ({ id: 'r1', position: 'a0', properties });

describe('row-body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rowDescription', () => {
    it('reads the body column', () => {
      const body = { blocks: [{ type: 'paragraph', data: { text: 'Hi' } }] };

      expect(rowDescription(row({ 'p-body': body }), schema, 'p-body')).toEqual(body);
    });

    it('keeps an explicit empty body instead of reviving an orphan column', () => {
      const orphan = { blocks: [{ type: 'paragraph', data: { text: 'Old' } }] };

      expect(rowDescription(row({ 'p-body': null, gone: orphan }), schema, 'p-body')).toBeUndefined();
    });

    it('falls back to an orphan column that still holds a body', () => {
      const orphan = { blocks: [{ type: 'paragraph', data: { text: 'Old' } }] };

      expect(rowDescription(row({ gone: orphan }), schema, 'p-body')).toEqual(orphan);
    });
  });

  describe('pageContentSourceBlocks', () => {
    it('reads the legacy body column as body blocks', () => {
      const body = { blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Hi' } }] };

      expect(pageContentSourceBlocks(row({ 'p-body': body }), schema, 'p-body')).toEqual([{ type: 'paragraph', data: { text: 'Hi' } }]);
    });

    it('gives no blocks for a row with no body', () => {
      expect(pageContentSourceBlocks(row({}), schema, 'p-body')).toEqual([]);
      expect(pageContentSourceBlocks(row({ 'p-body': { nope: true } as never }), schema, 'p-body')).toEqual([]);
    });
  });

  describe('pageContentPreview', () => {
    it('shows an image when the body starts with one', () => {
      expect(pageContentPreview([
        { type: 'image', data: { url: 'https://example.com/a.png' } },
        { type: 'paragraph', data: { text: 'After' } },
      ])).toEqual({ image: 'https://example.com/a.png', lines: [] });
    });

    it('reads text from HTML strings and from segments, with heading levels', () => {
      expect(pageContentPreview([
        { type: 'header', data: { text: 'Plan <b>A</b>', level: 2 } },
        { type: 'paragraph', data: { text: [{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }] } },
        { type: 'header', data: { text: 'Small', level: 3 } },
        { type: 'divider', data: {} },
      ])).toEqual({ lines: [
        { level: 'h2', text: 'Plan A' },
        { level: 'text', text: 'Hello world' },
        { level: 'h3', text: 'Small' },
      ] });
    });

    it('never treats text as markup', () => {
      const preview = pageContentPreview([{ type: 'paragraph', data: { text: '<img src=x onerror=alert(1)>a &amp; b' } }]);

      expect(preview.lines).toEqual([{ level: 'text', text: 'a & b' }]);
    });

    it('drops an image whose URL is not an image URL', () => {
      expect(pageContentPreview([{ type: 'image', data: { url: 'javascript:alert(1)' } }]).image).toBeUndefined();
    });

    it('stops after a handful of lines', () => {
      const many = Array.from({ length: 30 }, (_, i) => ({ type: 'paragraph', data: { text: `Line ${i}` } }));

      expect(pageContentPreview(many).lines.length).toBeLessThan(30);
    });
  });

  describe('coverImageOf', () => {
    it('takes the first image block anywhere in the body', () => {
      expect(coverImageOf([
        { type: 'paragraph', data: { text: 'Intro' } },
        { type: 'image', data: { url: 'https://example.com/b.png' } },
      ])).toBe('https://example.com/b.png');
    });

    it('gives undefined with no image', () => {
      expect(coverImageOf([{ type: 'paragraph', data: { text: 'Intro' } }])).toBeUndefined();
    });
  });
});
