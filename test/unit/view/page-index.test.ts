// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageIndex } from '../../../src/view';

describe('pageIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses saved child order for text and owning edges without indexing a page cache or body', () => {
    const result = pageIndex({
      time: 1,
      blocks: [
        { id: 'toggle', type: 'toggle', content: ['child', 'owner'], data: { text: 'Roadmap' } },
        {
          id: 'owner', type: 'page', parent: 'toggle', content: ['leaked-child'],
          data: { pageId: 'p2', cache: { title: 'Restricted title', icon: 'Secret icon' } },
        },
        { id: 'child', type: 'paragraph', parent: 'toggle', data: { text: 'Alpha &amp; Beta' } },
        { id: 'leaked-child', type: 'paragraph', parent: 'owner', data: { text: 'Private body' } },
      ],
    });

    expect(result.owners).toEqual([
      { pageId: 'p2', sourceBlockId: 'owner', order: 2 },
    ]);
    expect(result.text).toEqual([
      { blockId: 'toggle', order: 0, text: 'Roadmap' },
      { blockId: 'child', order: 1, text: 'Alpha & Beta' },
      { blockId: 'owner', order: 2, text: '' },
    ]);
  });

  it('keeps id-less text but does not claim pages without a source ID or page ID', () => {
    const result = pageIndex({
      blocks: [
        { type: 'page', data: { pageId: 'idless' } },
        { id: 'empty', type: 'page', data: { pageId: '' } },
        { id: 'foreign', type: 'page', content: ['child'], data: { href: '/pages/not-an-id' } },
        { id: 'child', type: 'paragraph', parent: 'foreign', data: { text: 'Foreign body' } },
        { type: 'paragraph', data: { text: 'Legacy text' } },
      ],
    });

    expect(result.owners).toEqual([]);
    expect(result.text).toEqual([
      { blockId: null, order: 0, text: '' },
      { blockId: 'empty', order: 1, text: '' },
      { blockId: 'foreign', order: 2, text: '' },
      { blockId: 'child', order: 3, text: 'Foreign body' },
      { blockId: null, order: 4, text: 'Legacy text' },
    ]);
  });

  it('does not claim a nested legacy pointer without a saved source ID', () => {
    const result = pageIndex({
      blocks: [
        {
          id: 'callout', type: 'callout',
          data: { body: { blocks: [
            { type: 'page', data: { pageId: 'idless' } },
            { type: 'paragraph', data: { text: 'Nested text' } },
          ] } },
        },
      ],
    });

    expect(result.owners).toEqual([]);
    expect(result.text).toEqual([
      { blockId: 'callout', order: 0, text: '' },
      { blockId: null, order: 1, text: '' },
      { blockId: null, order: 2, text: 'Nested text' },
    ]);
  });

  it('attributes table cell HTML and referenced child text to the visible table once', () => {
    const result = pageIndex({
      blocks: [
        {
          id: 'table', type: 'table', content: ['cell'],
          data: { content: [[{ blocks: [], text: 'A <b>Beta</b>' }, { blocks: ['cell'] }]] },
        },
        { id: 'cell', type: 'paragraph', parent: 'table', data: { text: 'Gamma &amp; Delta' } },
        { id: 'after', type: 'paragraph', data: { text: 'After' } },
      ],
    });

    expect(result.text).toEqual([
      { blockId: 'table', order: 0, text: 'A Beta\tGamma & Delta' },
      { blockId: 'after', order: 1, text: 'After' },
    ]);
    expect(result.owners).toEqual([]);
  });

  it('finds an owning pointer inside table cell blocks without repeating cell text', () => {
    const result = pageIndex({
      blocks: [
        { id: 'table', type: 'table', content: ['cell'], data: { content: [[{ blocks: ['cell'] }]] } },
        { id: 'cell', type: 'toggle', parent: 'table', content: ['owner'], data: { text: 'Cell' } },
        { id: 'owner', type: 'page', parent: 'cell', data: { pageId: 'nested' } },
        { id: 'after', type: 'paragraph', data: { text: 'After' } },
      ],
    });

    expect(result.owners).toEqual([
      { pageId: 'nested', sourceBlockId: 'owner', order: 0 },
    ]);
    expect(result.text).toEqual([
      { blockId: 'table', order: 0, text: 'Cell' },
      { blockId: 'after', order: 1, text: 'After' },
    ]);
  });

  it('indexes a nested table in visible cell order without covered cell text', () => {
    const result = pageIndex({
      blocks: [
        {
          id: 'outer', type: 'table', content: ['inner'],
          data: { content: [[{ blocks: ['inner'] }]] },
        },
        {
          id: 'inner', type: 'table', parent: 'outer', content: ['second', 'first'],
          data: { content: [[
            { blocks: ['first'], colspan: 2 },
            { mergedInto: [0, 0], text: 'Covered secret' },
            '<b>Legacy</b>',
            { blocks: ['second'] },
          ]] },
        },
        { id: 'second', type: 'paragraph', parent: 'inner', data: { text: 'Second' } },
        { id: 'first', type: 'paragraph', parent: 'inner', data: { text: 'First' } },
      ],
    });

    expect(result.text).toEqual([
      { blockId: 'outer', order: 0, text: 'First\tLegacy\tSecond' },
    ]);
  });

  it('retains separate owner edges for duplicate page IDs', () => {
    const result = pageIndex({
      blocks: [
        { id: 'first', type: 'page', data: { pageId: 'shared' } },
        { id: 'second', type: 'page', data: { pageId: 'shared' } },
      ],
    });

    expect(result.owners).toEqual([
      { pageId: 'shared', sourceBlockId: 'first', order: 0 },
      { pageId: 'shared', sourceBlockId: 'second', order: 1 },
    ]);
    expect(result.text).toEqual([
      { blockId: 'first', order: 0, text: '' },
      { blockId: 'second', order: 1, text: '' },
    ]);
  });

  it('returns empty document facts for nullish input without a DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(pageIndex(null)).toEqual({ owners: [], text: [], references: [] });
    expect(pageIndex(undefined)).toEqual({ owners: [], text: [], references: [] });
  });
});
