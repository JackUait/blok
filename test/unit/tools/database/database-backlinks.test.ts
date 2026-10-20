import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scanBacklinkSources } from '../../../../src/tools/database/backlinks';
import type { BacklinkBlock } from '../../../../src/tools/database/backlinks';

/**
 * research/17 §2, research/23 §4: a backlink is a page that mentions the row.
 * One item per page with its mention count, pointing at its newest mention,
 * newest page first.
 */

interface Spec {
  id: string;
  name: string;
  parentId?: string;
  html?: string;
  annotation?: boolean;
  editedAt?: number;
}

const build = (specs: Spec[]): { root: HTMLElement; block: (id: string) => BacklinkBlock | undefined } => {
  const root = document.createElement('div');

  root.setAttribute('data-blok-editor', '');
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const holders = new Map<string, HTMLElement>();

  for (const spec of specs) {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    holder.setAttribute('data-blok-id', spec.id);
    holder.innerHTML = spec.html ?? '';
    if (spec.annotation === true) holder.setAttribute('data-blok-annotation', '');
    holders.set(spec.id, holder);
  }
  for (const spec of specs) {
    const parent = spec.parentId === undefined ? root : holders.get(spec.parentId);

    parent?.appendChild(holders.get(spec.id) as HTMLElement);
  }
  document.body.appendChild(root);

  return {
    root,
    block: (id) => {
      const spec = byId.get(id);

      return spec === undefined ? undefined : { id: spec.id, name: spec.name, parentId: spec.parentId ?? null, ...(spec.editedAt === undefined ? {} : { editedAt: spec.editedAt }) };
    },
  };
};

const mention = (id: string): string => `<a data-blok-page-id="${id}">x</a>`;

describe('scanBacklinkSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('finds a mention in another row body and one in the document, in document order when no edit times are known', () => {
    const { root, block } = build([
      { id: 'top', name: 'paragraph', html: `see ${mention('r1')}` },
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'r2', name: 'database-row', parentId: 'db' },
      { id: 'b2', name: 'paragraph', parentId: 'r2', html: mention('r1') },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([
      { rowId: null, blockId: 'top', mentions: 1 },
      { rowId: 'r2', blockId: 'b2', mentions: 1 },
    ]);
  });

  it('lists a page once, counting every mention, at its last mentioning block when no edit times are known', () => {
    const { root, block } = build([
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'r2', name: 'database-row', parentId: 'db' },
      { id: 'b2', name: 'paragraph', parentId: 'r2', html: mention('r1') },
      { id: 't2', name: 'toggle', parentId: 'r2' },
      { id: 'b3', name: 'paragraph', parentId: 't2', html: `${mention('r1')} ${mention('r1')}` },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([{ rowId: 'r2', blockId: 'b3', mentions: 3 }]);
  });

  it('matches the row page id as well as the row id', () => {
    const { root, block } = build([
      { id: 'top', name: 'paragraph', html: mention('page-9') },
      { id: 'other', name: 'paragraph', html: mention('page-10') },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1', 'page-9'], block })).toEqual([{ rowId: null, blockId: 'top', mentions: 1 }]);
  });

  it('skips the row mentioning itself, property cells and nested editors', () => {
    const { root, block } = build([
      { id: 'db', name: 'database', html: mention('r1') },
      { id: 'r1', name: 'database-row', parentId: 'db', html: mention('r1') },
      { id: 'b1', name: 'paragraph', parentId: 'r1', html: mention('r1') },
    ]);
    const nested = document.createElement('div');

    nested.setAttribute('data-blok-editor', '');
    nested.innerHTML = `<div data-blok-element data-blok-id="n1">${mention('r1')}</div>`;
    root.appendChild(nested);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([]);
  });

  it('counts a mention in a row of another database as that row', () => {
    const { root, block } = build([
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'db2', name: 'database' },
      { id: 'q1', name: 'database-row', parentId: 'db2' },
      { id: 'c1', name: 'callout', parentId: 'q1' },
      { id: 'c2', name: 'paragraph', parentId: 'c1', html: mention('r1') },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([{ rowId: 'q1', blockId: 'c2', mentions: 1 }]);
  });

  // research/23 §4: BL1..BL5 newest first; a 2nd mention in BL1 moves it to the top and points at the new block.
  it('orders pages by their newest mention, newest first, and points each at that mention', () => {
    const { root, block } = build([
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'bl1', name: 'database-row', parentId: 'db' },
      { id: 'a1', name: 'paragraph', parentId: 'bl1', html: mention('r1'), editedAt: 100 },
      { id: 'a2', name: 'paragraph', parentId: 'bl1', html: mention('r1'), editedAt: 500 },
      { id: 'bl2', name: 'database-row', parentId: 'db' },
      { id: 'b1', name: 'paragraph', parentId: 'bl2', html: mention('r1'), editedAt: 200 },
      { id: 'bl3', name: 'database-row', parentId: 'db' },
      { id: 'c1', name: 'paragraph', parentId: 'bl3', html: mention('r1'), editedAt: 300 },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([
      { rowId: 'bl1', blockId: 'a2', mentions: 2 },
      { rowId: 'bl3', blockId: 'c1', mentions: 1 },
      { rowId: 'bl2', blockId: 'b1', mentions: 1 },
    ]);
  });

  it('does not count a mention inside a comment thread', () => {
    const { root, block } = build([
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'r2', name: 'database-row', parentId: 'db' },
      { id: 'k', name: 'database-comment', parentId: 'r2', annotation: true, html: mention('r1') },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([]);
  });
});

