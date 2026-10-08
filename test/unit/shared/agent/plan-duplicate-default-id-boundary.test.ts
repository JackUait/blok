// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planOn, TOOLS, tool } from './fixtures';

import type { OutputData } from '../../../../types';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('duplicate-created refs and later default child IDs', () => {
  it('reserves effective default IDs for an insert into an earlier duplicate-created parent', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      children: { accepts: true, allow: ['seeded'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    tools.set('seeded', tool('seeded', {}, {
      defaultChildren: [{ type: 'paragraph', id: 'n1', data: { text: 'Default' } }],
    }));
    const doc: OutputData = { blocks: [
      { id: 'frame', type: 'frame', data: {}, content: [] },
    ] };
    const { plan, draft } = planOn(doc, [
      { name: 'block.duplicate', ref: '__proto__', args: { id: 'frame' } },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$__proto__', demote: true } },
    ], { tools });

    expect(plan.results).toEqual([
      { id: 'n2', childIds: [] },
      { id: 'n3', childIds: ['n1'] },
    ]);
    expect(draft.get('n3')?.type).toBe('seeded');
    expect(draft.childrenOf('n2')).toEqual(['n3']);
    expect(draft.childrenOf('n3')).toEqual(['n1']);
    expect(draft.get('n1')?.data.text).toEqual([{ text: 'Default' }]);
    expect(draft.childrenOf('frame')).toEqual([]);
  });

  it('uses the duplicate destination parent for a later sibling-position insert', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      children: { accepts: true, allow: ['seeded'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    tools.set('seeded', tool('seeded', {}, {
      defaultChildren: [{ type: 'paragraph', id: 'n1', data: { text: 'Default' } }],
    }));
    const doc: OutputData = { blocks: [
      { id: 'source', type: 'seeded', data: {}, content: [] },
      { id: 'frame', type: 'frame', data: {}, content: ['anchor'] },
      { id: 'anchor', type: 'seeded', data: {}, content: [], parent: 'frame' },
    ] };
    const { plan, draft } = planOn(doc, [
      { name: 'block.duplicate', ref: 'copy', args: { id: 'source', position: { before: 'anchor' } } },
      { name: 'block.insert', args: { type: 'paragraph', position: { after: '$copy' }, demote: true } },
    ], { tools });

    expect(plan.results).toEqual([
      { id: 'n2', childIds: [] },
      { id: 'n3', childIds: ['n1'] },
    ]);
    expect(draft.get('n3')?.type).toBe('seeded');
    expect(draft.childrenOf('frame')).toEqual(['n2', 'n3', 'anchor']);
    expect(draft.childrenOf('n2')).toEqual([]);
    expect(draft.childrenOf('n3')).toEqual(['n1']);
    expect(draft.get('n1')?.data.text).toEqual([{ text: 'Default' }]);
    expect(draft.childrenOf(null)).toEqual(['source', 'frame']);
  });
});
