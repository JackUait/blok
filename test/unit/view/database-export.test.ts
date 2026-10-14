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

  it('leaves page templates out of every export', () => {
    const withTemplate: OutputData = {
      blocks: [
        { ...doc.blocks[0], content: ['r2', 'r1', 'tpl'] },
        ...doc.blocks.slice(1),
        { id: 'tpl', type: 'database-row', parent: 'db', data: { title: 'Template', properties: { t: 'Template' }, position: 'a2', template: true }, content: ['tb'] },
        { id: 'tb', type: 'paragraph', parent: 'tpl', data: { text: 'template body' } },
      ],
    };

    expect(blocksToHtml(withTemplate)).toBe(blocksToHtml(doc));
    expect(blocksToMarkdown(withTemplate)).toBe(blocksToMarkdown(doc));
    expect(blocksToPlainText(withTemplate)).toBe(blocksToPlainText(doc));
  });

  // plan 11 §2.1 risk 1: the row page's view tabs are layout, not database content.
  it('never exports the page layout tabs block as database content', () => {
    const withTabs: OutputData = {
      blocks: [
        { ...doc.blocks[0], content: ['r2', 'r1', 'lt'] },
        ...doc.blocks.slice(1),
        { id: 'lt', type: 'tabs', parent: 'db', data: {}, content: ['tc', 'tv'] },
        { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
        { id: 'tv', type: 'tab', parent: 'lt', data: { title: 'Roadmap' }, content: ['lv'] },
        { id: 'lv', type: 'database', parent: 'tv', data: { title: 'Linked', schema: [], views: [], activeViewId: '', source: { databaseId: 'db' } } },
      ],
    };

    expect(blocksToHtml(withTabs)).toBe(blocksToHtml(doc));
    expect(blocksToMarkdown(withTabs)).toBe(blocksToMarkdown(doc));
    expect(blocksToPlainText(withTabs)).toBe(blocksToPlainText(doc));
  });

  it('reads the database and row titles as plain text', () => {
    expect(blocksToPlainText(doc).split('\n').filter((line) => line !== '')).toEqual(['Tasks', 'First', 'first body', 'Second']);
  });
});
