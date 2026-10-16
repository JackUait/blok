// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blocksToHtml,
  blocksToMarkdown,
  blocksToPlainText,
  outlineFromOutputData,
  pageIndex,
  remapPageDocument,
} from '../../../src/view';
import { ANNOTATION_BLOCK_TYPES } from '../../../src/shared/annotation-blocks';

import type { OutputData } from '../../../types';

/**
 * A row whose page body is one paragraph, plus a comment thread whose replies
 * would render as content if a reader treated the thread as an unknown block.
 */
const doc = (): OutputData => ({
  blocks: [
    {
      id: 'db', type: 'database',
      data: {
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
      content: ['r1'],
    },
    { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Row one' }, position: 'a0' }, content: ['c1', 'k1'] },
    { id: 'c1', type: 'paragraph', parent: 'r1', data: { text: 'Body text' } },
    { id: 'k1', type: 'database-comment', parent: 'r1', data: { text: 'Thread secret', author: 'Ann', createdAt: 1 }, content: ['k2', 'k3'] },
    { id: 'k2', type: 'paragraph', parent: 'k1', data: { text: 'Reply secret <a data-blok-page-id="p9">Page</a>' } },
    { id: 'k3', type: 'header', parent: 'k1', data: { text: 'Heading secret', level: 2 } },
  ],
});

describe('readers skip comment threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('knows the comment block type', () => {
    expect([...ANNOTATION_BLOCK_TYPES]).toEqual(['database-comment']);
  });

  it('leaves threads and their replies out of the HTML view, with no unknown-block marker', () => {
    const html = blocksToHtml(doc(), { onUnknownBlock: 'comment' });

    expect(html).not.toContain('secret');
    expect(html).not.toContain('database-comment');
    expect(html).toContain('Body text');
  });

  it('leaves threads out of Markdown', () => {
    const markdown = blocksToMarkdown(doc());

    expect(markdown).not.toContain('secret');
    expect(markdown).toContain('Body text');
  });

  it('leaves threads out of plain text', () => {
    const text = blocksToPlainText(doc());

    expect(text).not.toContain('secret');
    expect(text).toContain('Body text');
  });

  it('leaves headings under a thread out of the outline', () => {
    expect(outlineFromOutputData(doc())).toEqual([]);
  });

  it('leaves thread text and mentions out of the page index', () => {
    const index = pageIndex(doc());

    expect(index.text.map((entry) => entry.text).join(' ')).not.toContain('secret');
    expect(index.references).toEqual([]);
  });

  it('keeps every thread block when a page document is remapped', () => {
    const source = doc();
    const blockIds = new Map(source.blocks.map((block): [string, string] => [block.id ?? '', `x-${block.id ?? ''}`]));
    const remapped = remapPageDocument(source, { blockIds, pageIds: new Map([['p9', 'q9']]) });
    const types = remapped.blocks.map((block) => block.type);

    expect(types.filter((type) => type === 'database-comment')).toHaveLength(1);
    expect(remapped.blocks).toHaveLength(6);
  });
});
