import { describe, expect, it } from 'vitest';

import { homeSlotElement, resolveHomeSlot } from '../../../../src/components/utils/home-slot';
import type { HomeSlotBlock } from '../../../../src/components/utils/home-slot';

/** A block holder, with an optional child slot inside it. */
const makeHolder = (withSlot: 'none' | 'toggle' | 'nested' = 'none'): { holder: HTMLElement; slot: HTMLElement | null } => {
  const holder = document.createElement('div');

  if (withSlot === 'none') {
    return { holder, slot: null };
  }

  const slot = document.createElement('div');

  slot.setAttribute(withSlot === 'toggle' ? 'data-blok-toggle-children' : 'data-blok-nested-blocks', '');
  holder.appendChild(slot);

  return { holder, slot };
};

const lookup = (blocks: Record<string, HomeSlotBlock>) => (id: string): HomeSlotBlock | undefined => blocks[id];

describe('home-slot', () => {
  it('resolves to root for a root block', () => {
    expect(resolveHomeSlot(null, lookup({}))).toEqual({ kind: 'root' });
  });

  it('resolves to the direct parent\'s own slot', () => {
    const toggle = makeHolder('toggle');

    expect(resolveHomeSlot('t', lookup({
      t: { holder: toggle.holder, name: 'toggle', parentId: null },
    }))).toEqual({ kind: 'slot', slot: toggle.slot });
  });

  it('resolves a child of a slotless block to the slot of the nearest ancestor that owns one', () => {
    const toggle = makeHolder('toggle');
    const paragraph = makeHolder();

    expect(resolveHomeSlot('p', lookup({
      t: { holder: toggle.holder, name: 'toggle', parentId: null },
      p: { holder: paragraph.holder, name: 'paragraph', parentId: 't' },
    }))).toEqual({ kind: 'slot', slot: toggle.slot });
  });

  it('resolves to root when no ancestor owns a slot', () => {
    expect(resolveHomeSlot('p', lookup({
      p: { holder: makeHolder().holder, name: 'paragraph', parentId: null },
    }))).toEqual({ kind: 'root' });
  });

  it('resolves to self-placing when a table or database sits between the block and any slot', () => {
    const table = makeHolder('nested');
    const paragraph = makeHolder();

    expect(resolveHomeSlot('p', lookup({
      tb: { holder: table.holder, name: 'table', parentId: null },
      p: { holder: paragraph.holder, name: 'paragraph', parentId: 'tb' },
    }))).toEqual({ kind: 'self-placing' });
  });

  it('resolves a DIRECT table child to self-placing, but homeSlotElement keeps the first-cell slot', () => {
    const table = makeHolder('nested');
    const blocks = lookup({ tb: { holder: table.holder, name: 'table', parentId: null } });

    expect(resolveHomeSlot('tb', blocks)).toEqual({ kind: 'self-placing' });
    expect(homeSlotElement('tb', blocks)).toBe(table.slot);
  });

  it('keeps a toggle nested in a table cell assessable: its children live in the toggle slot', () => {
    const table = makeHolder('nested');
    const toggle = makeHolder('toggle');

    expect(resolveHomeSlot('t', lookup({
      tb: { holder: table.holder, name: 'table', parentId: null },
      t: { holder: toggle.holder, name: 'toggle', parentId: 'tb' },
    }))).toEqual({ kind: 'slot', slot: toggle.slot });
  });

  it('resolves to unassessable when an ancestor on the walk has no holder', () => {
    expect(resolveHomeSlot('p', lookup({
      p: { holder: undefined, name: 'paragraph', parentId: null },
    }))).toEqual({ kind: 'unassessable' });
    expect(homeSlotElement('p', lookup({
      p: { holder: undefined, name: 'paragraph', parentId: null },
    }))).toBeNull();
  });

  it('treats a missing parent or a parent cycle as root, like the hierarchy always has', () => {
    const a = makeHolder();
    const b = makeHolder();

    expect(resolveHomeSlot('ghost', lookup({}))).toEqual({ kind: 'root' });
    expect(resolveHomeSlot('a', lookup({
      a: { holder: a.holder, name: 'paragraph', parentId: 'b' },
      b: { holder: b.holder, name: 'paragraph', parentId: 'a' },
    }))).toEqual({ kind: 'root' });
  });

  it('homeSlotElement returns the slot element or null', () => {
    const toggle = makeHolder('toggle');
    const blocks = lookup({ t: { holder: toggle.holder, name: 'toggle', parentId: null } });

    expect(homeSlotElement('t', blocks)).toBe(toggle.slot);
    expect(homeSlotElement(null, blocks)).toBeNull();
  });
});
