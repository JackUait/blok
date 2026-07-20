import { describe, expect, it } from 'vitest';

import { resolveMoveDestination } from '../../../../../../src/components/modules/drag/utils/moveDestination';
import type { Block } from '../../../../../../src/components/block';

const createBlock = (id: string, parentId: string | null = null): Block => ({
  id,
  name: 'paragraph',
  parentId,
  contentIds: [],
  holder: document.createElement('div'),
} as unknown as Block);

describe('resolveMoveDestination', () => {
  it.each([
    {
      name: 'single source before target',
      order: ['S', 'A', 'T', 'B', 'C'],
      sources: ['S'],
      expectedIndex: 2,
    },
    {
      name: 'single source after target',
      order: ['A', 'T', 'B', 'S', 'C'],
      sources: ['S'],
      expectedIndex: 2,
    },
    {
      name: 'multiple sources before target',
      order: ['S1', 'S2', 'A', 'T', 'B', 'C'],
      sources: ['S1', 'S2'],
      expectedIndex: 2,
    },
    {
      name: 'multiple sources after target',
      order: ['A', 'T', 'B', 'S1', 'S2', 'C'],
      sources: ['S1', 'S2'],
      expectedIndex: 2,
    },
    {
      name: 'single source before bottom-most target',
      order: ['S', 'A', 'B', 'T'],
      sources: ['S'],
      expectedIndex: 3,
    },
    {
      name: 'multiple sources before bottom-most target',
      order: ['S1', 'S2', 'A', 'T'],
      sources: ['S1', 'S2'],
      expectedIndex: 2,
    },
  ])('$name resolves the first moved block final index', ({ order, sources, expectedIndex }) => {
    const byId = new Map(order.map(id => [id, createBlock(id)]));
    const blocks = order.map(id => byId.get(id)!);
    const sourceBlocks = sources.map(id => byId.get(id)!);
    const target = byId.get('T')!;

    expect(resolveMoveDestination(blocks, sourceBlocks, target, 'bottom')).toMatchObject({
      rawInsertionIndex: blocks.indexOf(target) + 1,
      finalFirstIndex: expectedIndex,
      total: blocks.length,
    });
  });

  it('counts unselected descendants carried by a selected root in the effective footprint', () => {
    const root = createBlock('root');
    const child = createBlock('child', root.id);
    const sibling = createBlock('sibling');
    const target = createBlock('target');

    root.contentIds = [child.id];
    root.holder.appendChild(child.holder);

    const result = resolveMoveDestination(
      [root, child, sibling, target],
      [root],
      target,
      'bottom'
    );

    expect(result?.footprint).toEqual([root, child]);
    expect(result?.finalFirstIndex).toBe(2);
  });

  it('keeps a logical child with a sibling holder as an explicit move root', () => {
    const root = createBlock('root');
    const flatChild = createBlock('flat-child', root.id);
    const sibling = createBlock('sibling');
    const target = createBlock('target');

    root.contentIds = [flatChild.id];

    const result = resolveMoveDestination(
      [root, flatChild, sibling, target],
      [root, flatChild],
      target,
      'bottom'
    );

    expect(result?.sourceRoots).toEqual([root, flatChild]);
    expect(result?.footprint).toEqual([root, flatChild]);
    expect(result?.finalFirstIndex).toBe(2);
  });

  it('rejects a target inside the moved footprint', () => {
    const root = createBlock('root');
    const childTarget = createBlock('child', root.id);

    root.contentIds = [childTarget.id];
    root.holder.appendChild(childTarget.holder);

    expect(
      resolveMoveDestination([root, childTarget], [root], childTarget, 'bottom')
    ).toBeNull();
  });

  it('rejects a logical descendant target even when its holder is a sibling', () => {
    const root = createBlock('root');
    const childTarget = createBlock('child', root.id);

    root.contentIds = [childTarget.id];

    expect(
      resolveMoveDestination([root, childTarget], [root], childTarget, 'bottom')
    ).toBeNull();
  });

  it('rejects stale sources and targets', () => {
    const source = createBlock('source');
    const target = createBlock('target');
    const stale = createBlock('stale');

    expect(resolveMoveDestination([source, target], [stale], target, 'top')).toBeNull();
    expect(resolveMoveDestination([source], [source], target, 'top')).toBeNull();
  });
});
