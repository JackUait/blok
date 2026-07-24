import { describe, it, expect, vi } from 'vitest';
import {
  migrate,
  migrateLegacyBlocks,
  migrateLegacyOutputData,
  needsLegacyMigration,
  matchLegacyRule,
} from '../../../src/migrate';
import type { OutputBlockData } from '../../../types';

/**
 * The public migration surface (`@bloklabs/core/migrate`) used to hide the
 * grammar context: ids came from an internal generator, host grammar entries
 * had no way in, lossy fields dissolved into `console.warn`, and the two passes
 * (host data rules vs the legacy grammar) were independent with an undocumented
 * — but load-bearing — ordering. These tests pin the surface that fixes that.
 */

const counterIds = (): (() => string) => {
  let n = 0;

  return () => `id-${n++}`;
};

const legacyList: OutputBlockData[] = [
  {
    type: 'list',
    data: { style: 'unordered', items: [{ content: 'one', items: [] }, { content: 'two', items: [] }] },
  },
];

describe('migrateLegacyBlocks options', () => {
  it('mints ids from a caller-supplied generator, making the migration pure', () => {
    const first = migrateLegacyBlocks(legacyList, { generateId: counterIds() });
    const second = migrateLegacyBlocks(legacyList, { generateId: counterIds() });

    expect(first).toEqual(second);
    expect(first.map((b) => b.id)).toEqual(['id-0', 'id-1']);
  });

  it('reports lossy fields to a caller-supplied callback instead of console.warn', () => {
    const onLossyField = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    migrateLegacyBlocks(
      [{ id: 'q1', type: 'quote', data: { text: 'x', alignment: 'center' } }],
      { onLossyField }
    );

    expect(onLossyField).toHaveBeenCalledWith({ blockType: 'quote', field: 'alignment', verb: 'ignored' });
    // The host took delivery of the report, so nothing is dumped to the console.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('applies host-supplied grammar entries', () => {
    const rules = [{
      legacyType: 'alert',
      targetType: 'callout',
      cardinality: '1:1' as const,
      contributesNesting: false,
      lossyFields: [],
      docNote: 'Host rule',
      detect: (block: OutputBlockData) => block.type === 'alert',
      expand: (block: OutputBlockData) => [{ ...block, type: 'callout', data: { emoji: '🚨' } }],
    }];

    const out = migrateLegacyBlocks([{ id: 'a1', type: 'alert', data: {} }], { rules });

    expect(out[0].type).toBe('callout');
  });

  it('threads options through the OutputData wrapper', () => {
    const migrated = migrateLegacyOutputData(
      { time: 1, version: '1.0.0', blocks: legacyList },
      { generateId: counterIds() }
    );

    expect(migrated.time).toBe(1);
    expect(migrated.blocks.map((b) => b.id)).toEqual(['id-0', 'id-1']);
  });
});

describe('needsLegacyMigration + matchLegacyRule', () => {
  it('matches a single block without allocating a throwaway array', () => {
    expect(matchLegacyRule({ type: 'raw', data: { html: '' } })?.targetType).toBe('code');
    expect(matchLegacyRule({ type: 'paragraph', data: {} })).toBeNull();
  });

  it('accounts for host entries in the whole-array check', () => {
    const rules = [{
      legacyType: 'alert',
      targetType: 'callout',
      cardinality: '1:1' as const,
      contributesNesting: false,
      lossyFields: [],
      docNote: 'Host rule',
      detect: (block: OutputBlockData) => block.type === 'alert',
      expand: (block: OutputBlockData) => [block],
    }];
    const blocks: OutputBlockData[] = [{ id: 'a1', type: 'alert', data: {} }];

    expect(needsLegacyMigration(blocks)).toBe(false);
    expect(needsLegacyMigration(blocks, { rules })).toBe(true);
  });
});

describe('migrate (composed entry point)', () => {
  it('runs host data rules BEFORE the legacy grammar', () => {
    const order: string[] = [];

    const result = migrate(
      {
        time: 7,
        version: '1.0.0',
        blocks: [{ id: 'l1', type: 'list', data: { style: 'unordered', items: [{ content: 'a', items: [] }] } }],
      },
      {
        migrations: {
          list: (data) => {
            // A data rule sees the ORIGINAL legacy shape — it runs first, before
            // any block has been moved or split.
            order.push(`rule:${Array.isArray((data as { items?: unknown[] }).items) ? 'nested' : 'flat'}`);

            return data;
          },
        },
        generateId: counterIds(),
      }
    );

    order.push(`grammar:${result.data.blocks.length}`);

    expect(order).toEqual(['rule:nested', 'grammar:1']);
    expect(result.data.time).toBe(7);
    expect(result.data.version).toBe('1.0.0');
  });

  it('returns a lossy-field report of everything the migration dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = migrate({
      time: 1,
      version: '1.0.0',
      blocks: [
        { id: 'q1', type: 'quote', data: { text: 'x', alignment: 'center' } },
        { id: 'i1', type: 'image', data: { url: 'u', withBackground: true } },
      ],
    }, { generateId: counterIds() });

    expect(result.report.lossyFields).toEqual([
      { blockType: 'quote', field: 'alignment', verb: 'ignored' },
      { blockType: 'image', field: 'withBackground', verb: 'dropped' },
    ]);
    warn.mockRestore();
  });

  it('records a throwing data rule instead of failing the whole migration', () => {
    const result = migrate({
      time: 1,
      version: '1.0.0',
      blocks: [{ id: 'c1', type: 'myCard', data: { name: 'Old' } }],
    }, {
      migrations: {
        myCard: () => {
          throw new Error('bad rule');
        },
      },
      generateId: counterIds(),
    });

    // The block keeps its stored data...
    expect(result.data.blocks[0].data).toEqual({ name: 'Old' });
    // ...and the failure is reported rather than swallowed.
    expect(result.report.errors).toHaveLength(1);
    expect(result.report.errors[0].type).toBe('myCard');
    expect((result.report.errors[0].error as Error).message).toBe('bad rule');
  });

  it('is deterministic: the same document migrates to an equal result twice', () => {
    const doc = {
      time: 1,
      version: '1.0.0',
      blocks: legacyList,
    };

    expect(migrate(doc, { generateId: counterIds() }).data)
      .toEqual(migrate(doc, { generateId: counterIds() }).data);
  });
});
