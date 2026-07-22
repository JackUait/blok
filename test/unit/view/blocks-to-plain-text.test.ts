// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { blocksToPlainText } from '../../../src/view';

import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Convenience: wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('blocksToPlainText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs without document or window (node environment)', () => {
    expect(typeof document).toBe('undefined');

    expect(blocksToPlainText(doc([{ type: 'paragraph', data: { text: 'Hello <b>world</b>' } }]))).toBe('Hello world');
  });

  it('separates top-level blocks with a blank line', () => {
    const text = blocksToPlainText(doc([
      { type: 'header', data: { text: 'Title', level: 1 } },
      { type: 'paragraph', data: { text: 'Body' } },
    ]));

    expect(text).toBe('Title\n\nBody');
  });

  it('separates list items with a single newline', () => {
    const text = blocksToPlainText(doc([
      { type: 'list', data: { text: 'One', style: 'unordered' } },
      { type: 'list', data: { text: 'Two', style: 'unordered' } },
      { type: 'paragraph', data: { text: 'After' } },
    ]));

    expect(text).toBe('One\nTwo\n\nAfter');
  });

  it('includes structurally nested list items with a single newline', () => {
    const text = blocksToPlainText(doc([
      { id: 'a', type: 'list', data: { text: 'One', style: 'unordered' } },
      { id: 'b', type: 'list', parent: 'a', data: { text: 'Sub', style: 'unordered', depth: 1 } },
      { id: 'c', type: 'list', data: { text: 'Two', style: 'unordered' } },
    ]));

    expect(text).toBe('One\nSub\nTwo');
  });

  it('separates table cells with tabs and rows with newlines', () => {
    const text = blocksToPlainText(doc([
      {
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [{ blocks: [], text: 'A' }, { blocks: [], text: 'B' }],
            [{ blocks: [], text: '1' }, { blocks: [], text: '2' }],
          ],
        },
      },
    ]));

    expect(text).toBe('A\tB\n1\t2');
  });

  it('extracts text from table cell child blocks', () => {
    const text = blocksToPlainText(doc([
      { id: 't1', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['p1'] }, { blocks: [], text: 'X' }]] } },
      { id: 'p1', type: 'paragraph', parent: 't1', data: { text: 'In cell' } },
    ]));

    expect(text).toBe('In cell\tX');
  });

  it('keeps code literal', () => {
    expect(blocksToPlainText(doc([{ type: 'code', data: { code: 'a < b && c' } }]))).toBe('a < b && c');
  });

  it('converts <br> to newline', () => {
    expect(blocksToPlainText(doc([{ type: 'paragraph', data: { text: 'a<br>b' } }]))).toBe('a\nb');
  });

  it('skips contentless blocks (divider, spacer) without stray separators', () => {
    const text = blocksToPlainText(doc([
      { type: 'paragraph', data: { text: 'A' } },
      { type: 'divider', data: {} },
      { type: 'spacer', data: { height: 24 } },
      { type: 'paragraph', data: { text: 'B' } },
    ]));

    expect(text).toBe('A\n\nB');
  });

  it('uses caption/title/fileName labels for media blocks', () => {
    expect(blocksToPlainText(doc([{ type: 'image', data: { url: 'https://x.y/a.png', caption: 'Cap' } }]))).toBe('Cap');
    expect(blocksToPlainText(doc([{ type: 'file', data: { url: 'https://x.y/r.pdf', fileName: 'r.pdf' } }]))).toBe('r.pdf');
    expect(blocksToPlainText(doc([{ type: 'audio', data: { url: 'https://x.y/a.mp3', title: 'Song' } }]))).toBe('Song');
  });

  it('includes toggle title and children', () => {
    const text = blocksToPlainText(doc([
      { id: 'tg', type: 'toggle', data: { text: 'More' } },
      { id: 'c1', type: 'paragraph', parent: 'tg', data: { text: 'Hidden' } },
    ]));

    expect(text).toBe('More\n\nHidden');
  });

  it('tolerates loose input', () => {
    expect(blocksToPlainText(null)).toBe('');
    expect(blocksToPlainText({} as unknown as OutputData)).toBe('');
    expect(blocksToPlainText({ blocks: [{ type: 'paragraph', data: null }] })).toBe('');
  });

  it('derives text from custom renderers when provided', () => {
    const text = blocksToPlainText(
      doc([{ type: 'widget', data: { label: 'Box' } }]),
      { renderers: { widget: (data) => `<section>${typeof data.label === 'string' ? data.label : ''}</section>` } }
    );

    expect(text).toBe('Box');
  });
});
