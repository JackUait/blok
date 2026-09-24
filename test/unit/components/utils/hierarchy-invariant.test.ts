import { afterEach, describe, it, expect } from 'vitest';

import {
  assertHierarchy,
  validateFlatOrder,
  validateTreeOrder,
  validateHierarchy,
  validateHolderAttachment,
  validateHomeSlots
} from '../../../../src/components/utils/hierarchy-invariant';
import type { OutputBlockData } from '../../../../types';

describe('hierarchy-invariant', () => {
  describe('validateHierarchy', () => {
    it('returns no violations for a consistent tree', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['h1', 'p1'] },
        { id: 'h1', type: 'header', data: {}, parent: 'c1' },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];

      expect(validateHierarchy(blocks)).toHaveLength(0);
    });

    it('flags a child whose parent is missing from the input', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: {}, parent: 'ghost' },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe('child-parent-missing');
      expect(violations[0].blockId).toBe('p1');
      expect(violations[0].parentId).toBe('ghost');
    });

    it('flags a child not listed in its parent\'s content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: [] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe('child-not-in-parent-content');
      expect(violations[0].blockId).toBe('p1');
      expect(violations[0].parentId).toBe('c1');
    });

    it('flags a dangling id inside content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['ghost'] },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations.some(v => v.kind === 'content-id-dangling')).toBe(true);
    });

    it('flags a child listed in the wrong parent\'s content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['p1'] },
        { id: 'c2', type: 'callout', data: {}, content: [] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c2' },
      ];
      const violations = validateHierarchy(blocks);

      // c1 lists p1 but p1.parent === c2 → content-parent-mismatch AND
      // c2 has p1 as child but c2.content[] is empty → child-not-in-parent-content
      expect(violations.some(v => v.kind === 'content-parent-mismatch' && v.blockId === 'c1')).toBe(true);
      expect(violations.some(v => v.kind === 'child-not-in-parent-content' && v.blockId === 'p1')).toBe(true);
    });

    it('flags duplicate ids inside content[]', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['p1', 'p1'] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];
      const violations = validateHierarchy(blocks);

      expect(violations.some(v => v.kind === 'content-duplicate')).toBe(true);
    });

    it('treats a root block with no parent and no content as valid', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: {} },
      ];

      expect(validateHierarchy(blocks)).toHaveLength(0);
    });

    it('handles two-level nesting (callout > toggle > paragraph)', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: ['t1'] },
        { id: 't1', type: 'toggle', data: {}, parent: 'c1', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 't1' },
      ];

      expect(validateHierarchy(blocks)).toHaveLength(0);
    });
  });

  describe('assertHierarchy', () => {
    it('is a noop for a valid tree', () => {
      const blocks: OutputBlockData[] = [
        { id: 'p1', type: 'paragraph', data: {} },
      ];

      expect(() => assertHierarchy(blocks, 'test')).not.toThrow();
    });

    it('throws with a readable message when drift is present', () => {
      const blocks: OutputBlockData[] = [
        { id: 'c1', type: 'callout', data: {}, content: [] },
        { id: 'p1', type: 'paragraph', data: {}, parent: 'c1' },
      ];

      expect(() => assertHierarchy(blocks, 'after save')).toThrow(/Hierarchy invariant violated at after save/);
      expect(() => assertHierarchy(blocks, 'after save')).toThrow(/p1.*parent=c1/);
    });
  });

  describe('validateHolderAttachment', () => {
    // Regression class: toggle-heading level convert stranded children in
    // detached DOM — the model kept the blocks while their holders sat in a
    // removed subtree. A block is stranded exactly when its PARENT's holder
    // is connected but its own is not: the parent is visible, the child is
    // gone — invisible to the user, unrecoverable by undo, effectively data
    // loss.

    const makeHolder = (connected: boolean): HTMLElement => {
      const el = document.createElement('div');

      if (connected) {
        document.body.appendChild(el);
      }

      return el;
    };

    const cleanup = (holders: HTMLElement[]): void => {
      holders.forEach(h => h.remove());
    };

    it('flags a child whose holder is detached while its parent holder is connected', () => {
      const holders = [makeHolder(true), makeHolder(false)];

      try {
        const violations = validateHolderAttachment([
          { id: 'parent', holder: holders[0], parentId: null },
          { id: 'stranded-child', holder: holders[1], parentId: 'parent' },
        ]);

        expect(violations).toHaveLength(1);
        expect(violations[0].blockId).toBe('stranded-child');
        expect(violations[0].message).toMatch(/stranded/i);
      } finally {
        cleanup(holders);
      }
    });

    it('reports nothing when parent and child are both connected', () => {
      const holders = [makeHolder(true), makeHolder(true)];

      try {
        expect(validateHolderAttachment([
          { id: 'parent', holder: holders[0], parentId: null },
          { id: 'child', holder: holders[1], parentId: 'parent' },
        ])).toHaveLength(0);
      } finally {
        cleanup(holders);
      }
    });

    it('reports nothing when parent and child are both detached (whole subtree/editor out of the document)', () => {
      const holders = [makeHolder(false), makeHolder(false)];

      expect(validateHolderAttachment([
        { id: 'parent', holder: holders[0], parentId: null },
        { id: 'child', holder: holders[1], parentId: 'parent' },
      ])).toHaveLength(0);
    });

    it('does not flag ROOT blocks or blocks whose parent is not in the set (unit fixtures attach holders selectively)', () => {
      const holders = [makeHolder(true), makeHolder(false), makeHolder(false)];

      try {
        expect(validateHolderAttachment([
          { id: 'attached-root', holder: holders[0], parentId: null },
          { id: 'detached-root', holder: holders[1], parentId: null },
          { id: 'orphan', holder: holders[2], parentId: 'ghost' },
        ])).toHaveLength(0);
      } finally {
        cleanup(holders);
      }
    });

    it('reports nothing for an empty block list', () => {
      expect(validateHolderAttachment([])).toHaveLength(0);
    });
  });

  describe('validateHomeSlots', () => {
    interface Fixture {
      id: string;
      name: string;
      parentId: string | null;
      holder: HTMLElement;
    }

    /** An editor root with block holders; `slot` marks a holder that owns a child slot. */
    const makeEditor = (): { root: HTMLElement; holder: (slot?: 'toggle' | 'nested') => HTMLElement } => {
      const root = document.createElement('div');

      root.setAttribute('data-blok-redactor', '');
      document.body.appendChild(root);

      return {
        root,
        holder: (slot) => {
          const holder = document.createElement('div');

          holder.setAttribute('data-blok-element', '');

          if (slot !== undefined) {
            const slotElement = document.createElement('div');

            slotElement.setAttribute(slot === 'toggle' ? 'data-blok-toggle-children' : 'data-blok-nested-blocks', '');
            holder.appendChild(slotElement);
          }

          return holder;
        },
      };
    };

    const slotOf = (holder: HTMLElement): HTMLElement => {
      const slot = holder.querySelector<HTMLElement>('[data-blok-toggle-children], [data-blok-nested-blocks]');

      if (slot === null) {
        throw new Error('fixture holder has no slot');
      }

      return slot;
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('flags a block nested under a slotless toggle child whose holder sits at the editor root', () => {
      // toggle > p1 > p2: p1 owns no slot, so p2 belongs in the toggle's slot.
      const { root, holder } = makeEditor();
      const toggle: Fixture = { id: 'toggle', name: 'toggle', parentId: null, holder: holder('toggle') };
      const p1: Fixture = { id: 'p1', name: 'paragraph', parentId: 'toggle', holder: holder() };
      const p2: Fixture = { id: 'p2', name: 'paragraph', parentId: 'p1', holder: holder() };

      root.append(toggle.holder, p2.holder);
      slotOf(toggle.holder).appendChild(p1.holder);

      const violations = validateHomeSlots([toggle, p1, p2], root);

      expect(violations.map(v => v.blockId)).toEqual(['p2']);
      expect(violations[0].message).toMatch(/p2.*home slot/);
    });

    it('accepts the same tree once the nested block sits in the toggle slot', () => {
      const { root, holder } = makeEditor();
      const toggle: Fixture = { id: 'toggle', name: 'toggle', parentId: null, holder: holder('toggle') };
      const p1: Fixture = { id: 'p1', name: 'paragraph', parentId: 'toggle', holder: holder() };
      const p2: Fixture = { id: 'p2', name: 'paragraph', parentId: 'p1', holder: holder() };

      root.append(toggle.holder);
      slotOf(toggle.holder).append(p1.holder, p2.holder);

      expect(validateHomeSlots([toggle, p1, p2], root)).toEqual([]);
    });

    it('flags a root block whose holder is inside a container slot', () => {
      const { root, holder } = makeEditor();
      const toggle: Fixture = { id: 'toggle', name: 'toggle', parentId: null, holder: holder('toggle') };
      const loose: Fixture = { id: 'loose', name: 'paragraph', parentId: null, holder: holder() };

      root.append(toggle.holder);
      slotOf(toggle.holder).appendChild(loose.holder);

      expect(validateHomeSlots([toggle, loose], root).map(v => v.blockId)).toEqual(['loose']);
    });

    it('flags a direct child that sits in a nested slot one level too deep', () => {
      const { root, holder } = makeEditor();
      const callout: Fixture = { id: 'callout', name: 'callout', parentId: null, holder: holder('toggle') };
      const inner: Fixture = { id: 'inner', name: 'toggle', parentId: 'callout', holder: holder('toggle') };
      const sibling: Fixture = { id: 'sibling', name: 'paragraph', parentId: 'callout', holder: holder() };

      root.append(callout.holder);
      slotOf(callout.holder).appendChild(inner.holder);
      slotOf(inner.holder).appendChild(sibling.holder);

      expect(validateHomeSlots([callout, inner, sibling], root).map(v => v.blockId)).toEqual(['sibling']);
    });

    it('lets slotless children (list items, plain headings) sit flat after their parent', () => {
      const { root, holder } = makeEditor();
      const item: Fixture = { id: 'item', name: 'list', parentId: null, holder: holder() };
      const nested: Fixture = { id: 'nested', name: 'list', parentId: 'item', holder: holder() };

      root.append(item.holder, nested.holder);

      expect(validateHomeSlots([item, nested], root)).toEqual([]);
    });

    it('skips blocks a table or database places, but still checks a toggle nested in a cell', () => {
      const { root, holder } = makeEditor();
      const table: Fixture = { id: 'table', name: 'table', parentId: null, holder: holder('nested') };
      const cellToggle: Fixture = { id: 'cellToggle', name: 'toggle', parentId: 'table', holder: holder('toggle') };
      const cellParagraph: Fixture = { id: 'cellParagraph', name: 'paragraph', parentId: 'table', holder: holder() };
      const underToggle: Fixture = { id: 'underToggle', name: 'paragraph', parentId: 'cellToggle', holder: holder() };
      const underCellP: Fixture = { id: 'underCellP', name: 'paragraph', parentId: 'cellParagraph', holder: holder() };

      root.append(table.holder, underToggle.holder, underCellP.holder);
      // Cells are placed by the table itself, never "first slot".
      root.append(cellToggle.holder, cellParagraph.holder);

      expect(validateHomeSlots([table, cellToggle, cellParagraph, underToggle, underCellP], root).map(v => v.blockId))
        .toEqual(['underToggle']);
    });

    it('skips blocks whose holder or home slot is not in the document', () => {
      const { root, holder } = makeEditor();
      const detachedToggle: Fixture = { id: 'dt', name: 'toggle', parentId: null, holder: holder('toggle') };
      const child: Fixture = { id: 'child', name: 'paragraph', parentId: 'dt', holder: holder() };
      const detachedRoot: Fixture = { id: 'dr', name: 'paragraph', parentId: null, holder: holder() };

      // child is connected, but its parent (and so its home slot) is not.
      root.append(child.holder);

      expect(validateHomeSlots([detachedToggle, child, detachedRoot], root)).toEqual([]);
    });

    it('skips the whole editor while its root area is detached (adapters boot on a detached holder)', () => {
      const { root, holder } = makeEditor();
      const loose: Fixture = { id: 'loose', name: 'paragraph', parentId: null, holder: holder() };

      root.remove();
      document.body.appendChild(loose.holder);

      expect(validateHomeSlots([loose], root)).toEqual([]);
    });

    it('without a root area, only flags a root block that sits in a child slot', () => {
      const { root, holder } = makeEditor();
      const toggle: Fixture = { id: 'toggle', name: 'toggle', parentId: null, holder: holder('toggle') };
      const inSlot: Fixture = { id: 'inSlot', name: 'paragraph', parentId: null, holder: holder() };
      const parent: Fixture = { id: 'parent', name: 'paragraph', parentId: null, holder: holder() };
      const insideParent: Fixture = { id: 'insideParent', name: 'paragraph', parentId: 'parent', holder: holder() };

      root.append(toggle.holder, parent.holder);
      slotOf(toggle.holder).appendChild(inSlot.holder);
      parent.holder.appendChild(insideParent.holder);

      expect(validateHomeSlots([toggle, inSlot, parent, insideParent], null).map(v => v.blockId)).toEqual(['inSlot']);
    });

    it('never flags partial stubs without a holder', () => {
      expect(validateHomeSlots([
        { id: 'a', name: 'toggle', parentId: null, holder: undefined },
        { id: 'b', name: 'paragraph', parentId: 'a', holder: undefined },
      ], null)).toEqual([]);
    });
  });

  describe('validateFlatOrder', () => {
    const block = (id: string, parentId: string | null, contentIds: string[] = [], name = 'paragraph'): {
      id: string;
      name: string;
      parentId: string | null;
      contentIds: string[];
    } => ({ id, name, parentId, contentIds });

    it('flags a root block that sits between a container and its children (drag escape)', () => {
      // Flat a,out,in,c1,c2,b — "in" is a root block wedged inside out's subtree.
      const violations = validateFlatOrder([
        block('a', null),
        block('out', null, ['c1', 'c2'], 'toggle'),
        block('in', null),
        block('c1', 'out'),
        block('c2', 'out'),
        block('b', null),
      ]);

      expect(violations).toHaveLength(1);
      expect(violations[0].index).toBe(2);
      expect(violations[0].expected).toBe('c1');
      expect(violations[0].actual).toBe('in');
      expect(violations[0].message).toMatch(/depth-first/);
    });

    it('accepts a depth-first flat order', () => {
      expect(validateFlatOrder([
        block('a', null),
        block('out', null, ['c1', 'c2'], 'toggle'),
        block('c1', 'out', ['g1']),
        block('g1', 'c1'),
        block('c2', 'out'),
        block('in', null),
        block('b', null),
      ])).toEqual([]);
    });

    it('flags a child placed before its parent', () => {
      expect(validateFlatOrder([
        block('c1', 't'),
        block('t', null, ['c1'], 'toggle'),
      ])).toHaveLength(1);
    });

    it('takes sibling order from the flat array, not a stale contentIds (the saver derives content[] from it)', () => {
      expect(validateFlatOrder([
        block('t', null, ['c2', 'c1'], 'toggle'),
        block('c1', 't'),
        block('c2', 't'),
      ])).toEqual([]);
    });

    it('treats a dangling parentId as root, like the saver does', () => {
      expect(validateFlatOrder([
        block('a', null),
        block('orphan', 'ghost'),
      ])).toEqual([]);
    });

    it('flags a root block wedged inside a table subtree', () => {
      expect(validateFlatOrder([
        block('tb', null, ['x', 'y'], 'table'),
        block('x', 'tb'),
        block('root', null),
        block('y', 'tb'),
      ])).toHaveLength(1);
    });

    it('reports a parent cycle instead of looping', () => {
      expect(validateFlatOrder([
        block('a', 'b', ['b']),
        block('b', 'a', ['a']),
      ])).toHaveLength(1);
    });

    it('reports nothing for an empty list', () => {
      expect(validateFlatOrder([])).toEqual([]);
    });
  });
  describe('validateTreeOrder', () => {
    const block = (id: string, parentId: string | null, contentIds: string[] = [], name = 'paragraph'): {
      id: string;
      name: string;
      parentId: string | null;
      contentIds: string[];
    } => ({ id, name, parentId, contentIds });

    it('accepts a flat order that walks roots in array order and children by contentIds', () => {
      expect(validateTreeOrder([
        block('a', null),
        block('t', null, ['c2', 'c1'], 'toggle'),
        block('c2', 't', ['g'], 'toggle'),
        block('g', 'c2'),
        block('c1', 't'),
        block('b', null),
      ])).toEqual([]);
    });

    it('flags siblings whose flat order differs from contentIds', () => {
      const violations = validateTreeOrder([
        block('t', null, ['c2', 'c1'], 'toggle'),
        block('c1', 't'),
        block('c2', 't'),
      ]);

      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe('flat-order-not-tree-order');
      expect(violations[0].index).toBe(1);
      expect(violations[0].expected).toBe('c2');
      expect(violations[0].actual).toBe('c1');
      expect(violations[0].message).toMatch(/contentIds/);
    });

    it('accepts children missing from contentIds after the listed ones, in flat order', () => {
      expect(validateTreeOrder([
        block('t', null, ['c2'], 'toggle'),
        block('c2', 't'),
        block('u1', 't'),
        block('u2', 't'),
      ])).toEqual([]);
    });

    it('flags an unlisted child placed before a listed one', () => {
      expect(validateTreeOrder([
        block('t', null, ['c2'], 'toggle'),
        block('u1', 't'),
        block('c2', 't'),
      ])).toHaveLength(1);
    });

    it('ignores a contentIds entry whose block names another parent', () => {
      expect(validateTreeOrder([
        block('t', null, ['x', 'c1'], 'toggle'),
        block('c1', 't'),
        block('s', null, ['x'], 'toggle'),
        block('x', 's'),
      ])).toEqual([]);
    });

    it('ignores dangling and duplicate contentIds entries', () => {
      expect(validateTreeOrder([
        block('t', null, ['ghost', 'c1', 'c1', 'c2'], 'toggle'),
        block('c1', 't'),
        block('c2', 't'),
      ])).toEqual([]);
    });

    it('flags a root block wedged inside a container subtree', () => {
      expect(validateTreeOrder([
        block('t', null, ['c1', 'c2'], 'toggle'),
        block('c1', 't'),
        block('r', null),
        block('c2', 't'),
      ])).toHaveLength(1);
    });

    it('treats a dangling parentId as root', () => {
      expect(validateTreeOrder([
        block('a', null),
        block('orphan', 'ghost'),
      ])).toEqual([]);
    });

    it('reports a parent cycle instead of looping', () => {
      expect(validateTreeOrder([
        block('a', 'b', ['b']),
        block('b', 'a', ['a']),
      ])).toHaveLength(1);
    });

    it('reports nothing for an empty list', () => {
      expect(validateTreeOrder([])).toEqual([]);
    });
  });
});
