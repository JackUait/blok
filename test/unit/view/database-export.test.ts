import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksToHtml } from '../../../src/view/blocks-to-html';
import { blocksToMarkdown } from '../../../src/view/blocks-to-markdown';
import { blocksToPlainText } from '../../../src/view/blocks-to-plain-text';
import type { OutputData } from '../../../types';

const doc: OutputData = {
  blocks: [
    {
      id: 'db',
      type: 'database',
      data: {
        title: 'Tasks',
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
      content: ['r2', 'r1'],
    },
    { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Second' }, position: 'a1' } },
    { id: 'r1', type: 'database-row', parent: 'db', data: { title: 'First', properties: { t: 'First' }, position: 'a0' }, content: ['c1'] },
    { id: 'c1', type: 'paragraph', parent: 'r1', data: { text: 'first body' } },
  ],
};

describe('database export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each row once, in row order, as a titled section holding its body', () => {
    const html = blocksToHtml(doc);

    expect(html).toBe(
      '<section data-blok-database><h3 data-blok-database-title>Tasks</h3>'
      + '<section data-blok-database-row><h4 data-blok-database-row-title>First</h4><p>first body</p></section>'
      + '<section data-blok-database-row><h4 data-blok-database-row-title>Second</h4></section>'
      + '</section>'
    );
  });

  it('writes Markdown with each row title before its body', () => {
    expect(blocksToMarkdown(doc)).toBe('**Tasks**\n\n**First**\n\nfirst body\n\n**Second**');
  });

  it('reads the database and row titles as plain text', () => {
    expect(blocksToPlainText(doc).split('\n').filter((line) => line !== '')).toEqual(['Tasks', 'First', 'first body', 'Second']);
  });
});
