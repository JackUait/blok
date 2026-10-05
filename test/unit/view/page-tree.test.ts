// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectPageTree } from '../../../src/view';
import type { HostPageEdge } from '../../../src/view';

describe('projectPageTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts roots by saved order and preserves input order for ties', () => {
    const edges: HostPageEdge[] = [
      { ownerPageId: null, pageId: 'later', sourceBlockId: 'b2', order: 2 },
      { ownerPageId: null, pageId: 'first', sourceBlockId: 'b1', order: 1 },
      { ownerPageId: null, pageId: 'tied', sourceBlockId: 'b3', order: 2 },
    ];
    const projection = projectPageTree(edges, {
      first: { title: 'First' },
      later: { title: 'Later' },
      tied: { title: 'Tied' },
    });

    expect(projection.roots.map((node) => node.pageId)).toEqual(['first', 'later', 'tied']);
    expect(projection.roots.map((node) => node.title)).toEqual(['First', 'Later', 'Tied']);
    expect(projection.diagnostics).toEqual([]);
    expect(edges.map((edge) => edge.pageId)).toEqual(['later', 'first', 'tied']);
  });

  it('omits denied title, icon, and path from the projection', () => {
    const projection = projectPageTree(
      [{ ownerPageId: null, pageId: 'secret', sourceBlockId: 'b1', order: 0 }],
      {
        secret: {
          access: 'none',
          title: 'Private plan',
          icon: { type: 'emoji', value: '🔐' },
          path: ['Private parent'],
        },
      }
    );

    expect(projection.roots).toEqual([{
      pageId: 'secret',
      sourceBlockId: 'b1',
      order: 0,
      access: 'none',
      children: [],
    }]);
    expect(JSON.stringify(projection)).not.toContain('Private');
    expect(JSON.stringify(projection)).not.toContain('🔐');
  });

  it('reports missing metadata without inventing a title', () => {
    const projection = projectPageTree(
      [{ ownerPageId: null, pageId: 'missing', sourceBlockId: 'b1', order: 0 }],
      {}
    );

    expect(projection.roots[0]).toEqual({
      pageId: 'missing',
      sourceBlockId: 'b1',
      order: 0,
      access: 'missing',
      children: [],
    });
    expect(projection.diagnostics).toContainEqual({
      kind: 'missing-page', pageId: 'missing', sourceBlockId: 'b1',
    });
  });

  it('reports both duplicate owners instead of choosing one', () => {
    const edges: HostPageEdge[] = [
      { ownerPageId: null, pageId: 'shared', sourceBlockId: 'b1', order: 0 },
      { ownerPageId: 'other', pageId: 'shared', sourceBlockId: 'b2', order: 3 },
    ];
    const projection = projectPageTree(edges, { shared: { title: 'Shared' } });

    expect(projection.roots).toEqual([]);
    expect(projection.diagnostics).toContainEqual({
      kind: 'duplicate-owner', pageId: 'shared', edges,
    });
  });

  it('diagnoses a disconnected cycle without recursing forever', () => {
    const projection = projectPageTree([
      { ownerPageId: 'b', pageId: 'a', sourceBlockId: 'a-block', order: 0 },
      { ownerPageId: 'a', pageId: 'b', sourceBlockId: 'b-block', order: 0 },
    ], { a: { title: 'A' }, b: { title: 'B' } });

    expect(projection.roots).toEqual([]);
    expect(projection.diagnostics).toContainEqual({
      kind: 'cycle', pageId: 'a', path: ['a', 'b', 'a'],
    });
  });

  it('reports an orphan edge and a metadata page with no owner', () => {
    const projection = projectPageTree([
      { ownerPageId: 'unknown', pageId: 'orphan', sourceBlockId: 'b1', order: 0 },
    ], {
      orphan: { title: 'Orphan' },
      unowned: { title: 'Unowned' },
    });

    expect(projection.roots).toEqual([]);
    expect(projection.diagnostics).toContainEqual({
      kind: 'unreachable', pageId: 'orphan', sourceBlockId: 'b1',
    });
    expect(projection.diagnostics).toContainEqual({
      kind: 'missing-owner', pageId: 'unowned',
    });
  });

  it('reads an own metadata key named __proto__', () => {
    const projection = projectPageTree([
      { ownerPageId: null, pageId: '__proto__', sourceBlockId: 'b1', order: 0 },
    ], {
      ['__proto__']: { title: 'Literal key' },
    });

    expect(projection.roots[0]?.title).toBe('Literal key');
  });

  it('terminates a long ownership chain', () => {
    const edges: HostPageEdge[] = Array.from({ length: 200 }, (_, index) => ({
      ownerPageId: index === 0 ? null : `page-${index - 1}`,
      pageId: `page-${index}`,
      sourceBlockId: `block-${index}`,
      order: index,
    }));
    const metadata = Object.fromEntries(edges.map(({ pageId }) => [pageId, { title: pageId }]));
    const projection = projectPageTree(edges, metadata);
    let node = projection.roots[0];
    let count = 0;

    while (node !== undefined) {
      count += 1;
      node = node.children[0];
    }

    expect(count).toBe(200);
    expect(projection.diagnostics).toEqual([]);
  });
});
