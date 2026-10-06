// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageIndex } from '../../../src/view';

describe('pageIndex references', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records only ID-backed non-owning references in visible order', () => {
    const facts = pageIndex({
      blocks: [
        { id: 'link', type: 'page-link', data: { pageId: 'p1' } },
        {
          id: 'text', type: 'paragraph',
          data: { text: '<a href="/pages/p9">URL only</a> <a data-blok-page-id="p2">Page</a> <a data-blok-page-id="p2">Page</a> <a data-blok-page-id="">Blank</a>' },
        },
        { id: 'owner', type: 'page', data: { pageId: 'p3' } },
        { type: 'paragraph', data: { text: '<a data-blok-page-id="p4">Page</a>' } },
      ],
    });

    expect(facts.references).toEqual([
      { pageId: 'p1', sourceBlockId: 'link', order: 0 },
      { pageId: 'p2', sourceBlockId: 'text', order: 1 },
      { pageId: 'p2', sourceBlockId: 'text', order: 1 },
      { pageId: 'p4', sourceBlockId: null, order: 3 },
    ]);
    expect(facts.owners).toEqual([
      { pageId: 'p3', sourceBlockId: 'owner', order: 2 },
    ]);
  });

  it('attributes legacy and block-backed table links to their visible sources', () => {
    const facts = pageIndex({
      blocks: [
        {
          id: 'table', type: 'table', content: ['cell'],
          data: { content: [[
            '<a data-blok-page-id="legacy">Page</a>',
            { blocks: ['cell'] },
          ]] },
        },
        {
          id: 'cell', type: 'paragraph', parent: 'table',
          data: { text: '<a data-blok-page-id="child">Page</a>' },
        },
        { id: 'after', type: 'paragraph', data: { text: 'After' } },
      ],
    });

    expect(facts.references).toEqual([
      { pageId: 'legacy', sourceBlockId: 'table', order: 0 },
      { pageId: 'child', sourceBlockId: 'cell', order: 0 },
    ]);
  });

  it('indexes nested-table links in visible cell order without covered cells', () => {
    const facts = pageIndex({
      blocks: [
        {
          id: 'outer', type: 'table', content: ['inner'],
          data: { content: [[{ blocks: ['inner'] }]] },
        },
        {
          id: 'inner', type: 'table', parent: 'outer', content: ['second', 'first'],
          data: { content: [[
            { blocks: ['first'], colspan: 2 },
            { mergedInto: [0, 0], text: '<a data-blok-page-id="hidden">Hidden</a>' },
            '<a data-blok-page-id="legacy">Legacy</a>',
            { blocks: ['second'] },
          ]] },
        },
        {
          id: 'second', type: 'paragraph', parent: 'inner',
          data: { text: '<a data-blok-page-id="second-page">Second</a>' },
        },
        {
          id: 'first', type: 'paragraph', parent: 'inner',
          data: { text: '<a data-blok-page-id="first-page">First</a>' },
        },
      ],
    });

    expect(facts.references).toEqual([
      { pageId: 'first-page', sourceBlockId: 'first', order: 0 },
      { pageId: 'legacy', sourceBlockId: 'inner', order: 0 },
      { pageId: 'second-page', sourceBlockId: 'second', order: 0 },
    ]);
  });

  it('indexes a quote citation once without treating plain media captions as markup', () => {
    const facts = pageIndex({
      blocks: [
        {
          id: 'table', type: 'table',
          data: { content: [[
            { colspan: 2, text: '<a data-blok-page-id="visible">Page</a>' },
            { mergedInto: [0, 0], text: '<a data-blok-page-id="hidden">Page</a>' },
          ]] },
        },
        {
          id: 'quote', type: 'quote',
          data: {
            text: '<a data-blok-page-id="quote">Page</a>',
            caption: '<a data-blok-page-id="caption">Page</a>',
          },
        },
        {
          id: 'image', type: 'image',
          data: { caption: '<a data-blok-page-id="media">Page</a>' },
        },
      ],
    });

    expect(facts.references).toEqual([
      { pageId: 'visible', sourceBlockId: 'table', order: 0 },
      { pageId: 'quote', sourceBlockId: 'quote', order: 1 },
      { pageId: 'caption', sourceBlockId: 'quote', order: 1 },
    ]);
  });

  it('indexes table-cell fallback markup when its child IDs cannot resolve', () => {
    expect(pageIndex({
      blocks: [{
        id: 'table', type: 'table',
        data: { content: [[{ blocks: ['missing'], text: '<a data-blok-page-id="p1">Page</a>' }]] },
      }],
    }).references).toEqual([
      { pageId: 'p1', sourceBlockId: 'table', order: 0 },
    ]);
  });

  it('recovers an unclosed inline anchor without using a browser DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(pageIndex({
      blocks: [
        { id: 'invalid', type: 'page-link', data: { pageId: '' } },
        { id: 'text', type: 'paragraph', data: { text: '<a data-blok-page-id="p1">Page' } },
      ],
    }).references).toEqual([
      { pageId: 'p1', sourceBlockId: 'text', order: 1 },
    ]);
    expect(pageIndex(null).references).toEqual([]);
  });
});
