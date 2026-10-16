import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scanBacklinkSources } from '../../../../src/tools/database/backlinks';
import type { BacklinkBlock } from '../../../../src/tools/database/backlinks';

/**
 * research/17 §2: a backlink is a page that mentions the row. One item per
 * page, pointing at the block that holds the first mention.
 */

interface Spec {
  id: string;
  name: string;
  parentId?: string;
  html?: string;
  annotation?: boolean;
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

      return spec === undefined ? undefined : { id: spec.id, name: spec.name, parentId: spec.parentId ?? null };
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

  it('finds a mention in another row body and one in the document, in document order', () => {
    const { root, block } = build([
      { id: 'top', name: 'paragraph', html: `see ${mention('r1')}` },
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'r2', name: 'database-row', parentId: 'db' },
      { id: 'b2', name: 'paragraph', parentId: 'r2', html: mention('r1') },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([
      { rowId: null, blockId: 'top' },
      { rowId: 'r2', blockId: 'b2' },
    ]);
  });

  it('lists a page once, at its first mentioning block', () => {
    const { root, block } = build([
      { id: 'db', name: 'database' },
      { id: 'r1', name: 'database-row', parentId: 'db' },
      { id: 'r2', name: 'database-row', parentId: 'db' },
      { id: 'b2', name: 'paragraph', parentId: 'r2', html: mention('r1') },
      { id: 't2', name: 'toggle', parentId: 'r2' },
      { id: 'b3', name: 'paragraph', parentId: 't2', html: `${mention('r1')} ${mention('r1')}` },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([{ rowId: 'r2', blockId: 'b2' }]);
  });

  it('matches the row page id as well as the row id', () => {
    const { root, block } = build([
      { id: 'top', name: 'paragraph', html: mention('page-9') },
      { id: 'other', name: 'paragraph', html: mention('page-10') },
    ]);

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1', 'page-9'], block })).toEqual([{ rowId: null, blockId: 'top' }]);
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

    expect(scanBacklinkSources({ root, rowId: 'r1', ids: ['r1'], block })).toEqual([{ rowId: 'q1', blockId: 'c2' }]);
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

