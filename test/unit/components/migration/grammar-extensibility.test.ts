import { describe, it, expect, vi } from 'vitest';
import {
  expandLegacyBlocks,
  matchLegacyRule,
  hasLegacyBlocks,
  analyzeLegacyFormat,
} from '../../../../src/components/migration/legacy-grammar.mjs';
import type { OutputBlockData } from '../../../../types';

/**
 * The legacy grammar is the machinery that knows how to turn an Editor.js-era
 * block into Blok's flat-with-references model — recursion into container
 * bodies, the orphan re-parenting invariant, 1:N splits, id minting. Hosts
 * migrating a tool the built-in table doesn't cover (a marketplace `alert`, a
 * flat-with-count `toggle`) had to re-implement that dispatch loop themselves.
 *
 * These tests pin the extension surface: host-supplied grammar entries,
 * expanders that consume following siblings, and the per-block match primitive.
 */

const counterIds = (): (() => string) => {
  let n = 0;

  return () => `gen-${n++}`;
};

const ctx = (): { generateId: () => string } => ({ generateId: counterIds() });

describe('host-supplied grammar entries', () => {
  /** A marketplace-style `alert` → callout + child paragraph (type change AND 1:N split). */
  const alertRule = {
    legacyType: 'alert',
    targetType: 'callout',
    cardinality: '1:N' as const,
    contributesNesting: true,
    lossyFields: [],
    docNote: 'Host rule: `alert` → `callout` + message paragraph.',
    detect: (block: OutputBlockData) => block.type === 'alert',
    expand: (block: OutputBlockData, c: { generateId: () => string }) => {
      const calloutId = block.id ?? c.generateId();
      const childId = c.generateId();

      return [
        { id: calloutId, type: 'callout', data: { emoji: '🚨' }, content: [childId] },
        { id: childId, type: 'paragraph', data: { text: block.data.message }, parent: calloutId },
      ];
    },
  };

  it('expands a host entry through the shared interpreter', () => {
    const blocks: OutputBlockData[] = [{ id: 'a1', type: 'alert', data: { message: 'boom' } }];

    const out = expandLegacyBlocks(blocks, { ...ctx(), rules: [alertRule] });

    expect(out.map((b) => b.type)).toEqual(['callout', 'paragraph']);
    expect(out[1].parent).toBe('a1');
    expect(out[0].content).toEqual([out[1].id]);
  });

  it('recurses host entries inside a legacy container body (orphans re-parented)', () => {
    const blocks: OutputBlockData[] = [
      {
        id: 'tog',
        type: 'toggleList',
        data: {
          title: 'Heads up',
          body: { blocks: [{ id: 'a1', type: 'alert', data: { message: 'boom' } }] },
        },
      },
    ];

    const out = expandLegacyBlocks(blocks, { ...ctx(), rules: [alertRule] });

    const toggle = out.find((b) => b.type === 'toggle');
    const callout = out.find((b) => b.type === 'callout');

    expect(toggle?.content).toEqual(['a1']);
    expect(callout?.parent).toBe('tog');
  });

  it('lets a host entry take precedence over a built-in of the same type', () => {
    const rawRule = {
      legacyType: 'raw',
      targetType: 'paragraph',
      cardinality: '1:1' as const,
      contributesNesting: false,
      lossyFields: [],
      docNote: 'Host override',
      detect: (block: OutputBlockData) => block.type === 'raw',
      expand: (block: OutputBlockData) => [{ ...block, type: 'paragraph', data: { text: block.data.html } }],
    };

    const blocks: OutputBlockData[] = [{ id: 'r1', type: 'raw', data: { html: '<b>hi</b>' } }];

    // Built-in `raw` maps to `code`; the host entry wins.
    expect(expandLegacyBlocks(blocks, ctx())[0].type).toBe('code');
    expect(expandLegacyBlocks(blocks, { ...ctx(), rules: [rawRule] })[0].type).toBe('paragraph');
  });

  it('reports host-matched blocks through the detection helpers', () => {
    const blocks: OutputBlockData[] = [{ id: 'a1', type: 'alert', data: { message: 'boom' } }];

    expect(hasLegacyBlocks(blocks)).toBe(false);
    expect(hasLegacyBlocks(blocks, [alertRule])).toBe(true);
    expect(analyzeLegacyFormat(blocks, [alertRule])).toEqual({ hasLegacyBlocks: true, hasNesting: true });
  });
});

describe('sibling-consuming expanders', () => {
  /** Legacy `toggle` storing its body as a COUNT of following siblings. */
  const countToggleRule = {
    legacyType: 'toggle',
    targetType: 'toggle',
    cardinality: '1:N' as const,
    contributesNesting: true,
    lossyFields: [],
    docNote: 'Host rule: flat toggle with `items` count of following siblings.',
    detect: (block: OutputBlockData) => block.type === 'toggle' && typeof block.data?.items === 'number',
    expand: (
      block: OutputBlockData,
      c: { generateId: () => string },
      position: { siblings: OutputBlockData[]; index: number }
    ) => {
      const toggleId = block.id ?? c.generateId();
      const span = typeof block.data.items === 'number' ? block.data.items : 0;
      const followers = position.siblings.slice(position.index + 1, position.index + 1 + span);
      const children = followers.map((child) => ({
        ...child,
        id: child.id ?? c.generateId(),
        parent: toggleId,
      }));

      return {
        blocks: [
          { id: toggleId, type: 'toggle', data: { text: block.data.text }, content: children.map((ch) => ch.id) },
          ...children,
        ],
        consumed: followers.length,
      };
    },
  };

  it('lets an expander absorb the declared number of following siblings', () => {
    const blocks: OutputBlockData[] = [
      { id: 't1', type: 'toggle', data: { text: 'Parent', items: 2 } },
      { id: 'p1', type: 'paragraph', data: { text: 'one' } },
      { id: 'p2', type: 'paragraph', data: { text: 'two' } },
      { id: 'p3', type: 'paragraph', data: { text: 'after' } },
    ];

    const out = expandLegacyBlocks(blocks, { ...ctx(), rules: [countToggleRule] });

    expect(out.map((b) => b.id)).toEqual(['t1', 'p1', 'p2', 'p3']);
    expect(out[0].content).toEqual(['p1', 'p2']);
    expect(out[1].parent).toBe('t1');
    expect(out[2].parent).toBe('t1');
    // The sibling past the span stays a root block.
    expect(out[3].parent).toBeUndefined();
  });

  it('clamps an over-long span in a truncated document instead of over-consuming', () => {
    const blocks: OutputBlockData[] = [
      { id: 't1', type: 'toggle', data: { text: 'Parent', items: 5 } },
      { id: 'p1', type: 'paragraph', data: { text: 'one' } },
    ];

    const out = expandLegacyBlocks(blocks, { ...ctx(), rules: [countToggleRule] });

    expect(out.map((b) => b.id)).toEqual(['t1', 'p1']);
    expect(out[1].parent).toBe('t1');
  });

  it('treats a negative or absent consumed count as consuming nothing', () => {
    const rule = {
      legacyType: 'weird',
      targetType: 'paragraph',
      cardinality: '1:1' as const,
      contributesNesting: false,
      lossyFields: [],
      docNote: 'Host rule',
      detect: (block: OutputBlockData) => block.type === 'weird',
      expand: (block: OutputBlockData) => ({
        blocks: [{ ...block, type: 'paragraph', data: {} }],
        consumed: -3,
      }),
    };

    const blocks: OutputBlockData[] = [
      { id: 'w1', type: 'weird', data: {} },
      { id: 'p1', type: 'paragraph', data: { text: 'kept' } },
    ];

    const out = expandLegacyBlocks(blocks, { ...ctx(), rules: [rule] });

    expect(out.map((b) => b.id)).toEqual(['w1', 'p1']);
  });
});

describe('matchLegacyRule', () => {
  it('returns the matching entry for one block without scanning an array', () => {
    const entry = matchLegacyRule({ type: 'raw', data: { html: '<b>x</b>' } });

    expect(entry?.legacyType).toBe('raw');
    expect(entry?.targetType).toBe('code');
  });

  it('returns null for a block no entry claims', () => {
    expect(matchLegacyRule({ type: 'paragraph', data: { text: 'x' } })).toBeNull();
  });

  it('considers host-supplied entries first', () => {
    const rule = {
      legacyType: 'alert',
      targetType: 'callout',
      cardinality: '1:1' as const,
      contributesNesting: false,
      lossyFields: [],
      docNote: 'Host rule',
      detect: (block: OutputBlockData) => block.type === 'alert',
      expand: (block: OutputBlockData) => [block],
    };

    const block = { type: 'alert', data: {} } as OutputBlockData;

    expect(matchLegacyRule(block)).toBeNull();
    expect(matchLegacyRule(block, [rule])?.targetType).toBe('callout');
  });
});

describe('Editor.js list v2 (`meta`) coverage', () => {
  it('reads the ordered-list start from `data.meta.start`', () => {
    const blocks: OutputBlockData[] = [
      {
        type: 'list',
        data: {
          style: 'ordered',
          meta: { start: 5 },
          items: [{ content: 'one', items: [] }, { content: 'two', items: [] }],
        },
      },
    ];

    const out = expandLegacyBlocks(blocks, ctx());

    expect(out[0].data.start).toBe(5);
    expect(out[1].data.start).toBeUndefined();
  });

  it('reads the checked state from `item.meta.checked`', () => {
    const blocks: OutputBlockData[] = [
      {
        type: 'list',
        data: {
          style: 'checklist',
          meta: {},
          items: [
            { content: 'done', meta: { checked: true }, items: [] },
            { content: 'todo', meta: { checked: false }, items: [] },
          ],
        },
      },
    ];

    const out = expandLegacyBlocks(blocks, ctx());

    expect(out.map((b) => b.data.checked)).toEqual([true, false]);
  });

  it('reads nested `item.meta.checked` through nested items', () => {
    const blocks: OutputBlockData[] = [
      {
        type: 'list',
        data: {
          style: 'checklist',
          items: [
            { content: 'parent', meta: { checked: true }, items: [{ content: 'child', meta: { checked: true }, items: [] }] },
          ],
        },
      },
    ];

    const out = expandLegacyBlocks(blocks, ctx());

    expect(out.map((b) => b.data.checked)).toEqual([true, true]);
  });

  it('warns that `meta.counterType` has no Blok equivalent', () => {
    const warn = vi.fn();
    const blocks: OutputBlockData[] = [
      {
        type: 'list',
        data: {
          style: 'ordered',
          meta: { counterType: 'upper-roman' },
          items: [{ content: 'one', items: [] }],
        },
      },
    ];

    expandLegacyBlocks(blocks, { ...ctx(), warn });

    expect(warn).toHaveBeenCalledWith('list', 'meta.counterType', 'dropped');
  });
});
