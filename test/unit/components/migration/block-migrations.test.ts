import { describe, it, expect, vi } from 'vitest';
import {
  applyBlockMigration,
  migrateBlocks,
  migrateOutputData,
} from '../../../../src/components/migration/block-migrations';
import type { BlockMigrations } from '../../../../src/components/migration/block-migrations';
import type { BlockToolData } from '@/types';
import type { OutputBlockData } from '@/types';

/**
 * Host-supplied per-type block migrations. Lets a host declare "old data shape →
 * new data shape" rules for ANY block type from the outside — without editing
 * the tool class (which is all `upgradeData` allows). One pure engine backs both
 * the editor-config path (applied at load) and the standalone `@bloklabs/core/migrate`
 * batch API, so the two cannot drift.
 */
describe('applyBlockMigration', () => {
  it('returns the data unchanged when no rule is registered for the type', () => {
    const data: BlockToolData = { text: 'hi' };

    expect(applyBlockMigration('paragraph', data, {})).toBe(data);
    expect(applyBlockMigration('paragraph', data, { other: (d) => d })).toBe(data);
  });

  it('applies the matching rule to the data', () => {
    const migrations: BlockMigrations = {
      myCard: (data) => ({ ...data, title: (data as { name?: string }).name }),
    };

    const result = applyBlockMigration('myCard', { name: 'Old' }, migrations);

    expect(result).toEqual({ name: 'Old', title: 'Old' });
  });

  it('treats a rule returning null/undefined as "no change" (returns the input)', () => {
    const data: BlockToolData = { name: 'x' };

    expect(applyBlockMigration('myCard', data, { myCard: () => undefined as unknown as BlockToolData })).toBe(data);
    expect(applyBlockMigration('myCard', data, { myCard: () => null as unknown as BlockToolData })).toBe(data);
  });

  it('catches a throwing rule, returns the original data, and reports via onError', () => {
    const data: BlockToolData = { name: 'x' };
    const boom = new Error('bad migration');
    const onError = vi.fn();

    const result = applyBlockMigration('myCard', data, { myCard: () => { throw boom; } }, onError);

    expect(result).toBe(data);
    expect(onError).toHaveBeenCalledWith('myCard', boom);
  });
});

describe('migrateBlocks', () => {
  it('applies rules by block type across a block array, leaving unmatched blocks intact', () => {
    const blocks: OutputBlockData[] = [
      { id: 'a', type: 'myCard', data: { name: 'Card' } },
      { id: 'b', type: 'paragraph', data: { text: 'keep' } },
    ];
    const migrations: BlockMigrations = {
      myCard: (data) => ({ ...data, title: (data as { name?: string }).name }),
    };

    const result = migrateBlocks(blocks, migrations);

    expect(result[0].data).toEqual({ name: 'Card', title: 'Card' });
    expect(result[1].data).toEqual({ text: 'keep' });
    // Envelope fields (id/type) are preserved.
    expect(result[0].id).toBe('a');
    expect(result[0].type).toBe('myCard');
  });
});

describe('migrateOutputData', () => {
  it('migrates blocks while preserving the OutputData envelope', () => {
    const data = {
      time: 123,
      version: '1.0.0',
      blocks: [{ id: 'a', type: 'myCard', data: { name: 'Card' } }],
    };
    const migrated = migrateOutputData(data, {
      myCard: (d) => ({ ...d, title: (d as { name?: string }).name }),
    });

    expect(migrated.time).toBe(123);
    expect(migrated.version).toBe('1.0.0');
    expect(migrated.blocks[0].data).toEqual({ name: 'Card', title: 'Card' });
  });
});
