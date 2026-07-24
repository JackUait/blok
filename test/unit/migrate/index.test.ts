import { describe, it, expect } from 'vitest';
import {
  migrateLegacyBlocks,
  migrateLegacyOutputData,
  needsLegacyMigration,
  migrateOutputData,
} from '../../../src/migrate';
import type { OutputBlockData } from '../../../types';

/**
 * Public data-migration API (`@bloklabs/core/migrate`). Promotes the internal
 * legacy→hierarchical expansion so consumers can migrate a stored document
 * ahead of load instead of hand-rolling shape conversion. See KB gap #51.
 */
describe('migrateLegacyBlocks', () => {
  it('expands a legacy nested list into flat blocks with parent/content refs', () => {
    const legacy: OutputBlockData[] = [
      {
        type: 'list',
        data: {
          style: 'unordered',
          items: [
            { content: 'one', items: [] },
            { content: 'two', items: [] },
          ],
        },
      },
    ];

    const migrated = migrateLegacyBlocks(legacy);

    // The nested-items list explodes into separate list-item blocks.
    expect(migrated.length).toBeGreaterThan(legacy.length);
    // Every produced block carries a minted id.
    expect(migrated.every((b) => typeof b.id === 'string' && b.id.length > 0)).toBe(true);
  });

  it('leaves already-current blocks structurally intact (idempotent)', () => {
    const current: OutputBlockData[] = [
      { id: 'p1', type: 'paragraph', data: { text: 'hello' } },
    ];

    const once = migrateLegacyBlocks(current);
    const twice = migrateLegacyBlocks(once);

    expect(once).toEqual(twice);
    expect(once[0].type).toBe('paragraph');
    expect(once[0].data).toEqual({ text: 'hello' });
  });
});

describe('migrateLegacyOutputData', () => {
  it('migrates blocks while preserving the OutputData envelope', () => {
    const data = {
      time: 123,
      version: '1.0.0',
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }],
    };

    const migrated = migrateLegacyOutputData(data);

    expect(migrated.time).toBe(123);
    expect(migrated.version).toBe('1.0.0');
    expect(migrated.blocks[0].type).toBe('paragraph');
  });
});

describe('needsLegacyMigration', () => {
  it('is true for legacy nested data and false for hierarchical data', () => {
    const legacy: OutputBlockData[] = [
      {
        type: 'list',
        data: { style: 'unordered', items: [{ content: 'a', items: [] }] },
      },
    ];
    const current: OutputBlockData[] = [
      { id: 'p1', type: 'paragraph', data: { text: 'a' } },
    ];

    expect(needsLegacyMigration(legacy)).toBe(true);
    expect(needsLegacyMigration(current)).toBe(false);
  });
});

describe('migrateOutputData (host-supplied rules)', () => {
  it('upgrades a custom block by type via a host rule while preserving the envelope', () => {
    const saved = {
      time: 42,
      version: '1.0.0',
      blocks: [
        { id: 'a', type: 'myCard', data: { name: 'Old' } },
        { id: 'b', type: 'paragraph', data: { text: 'keep' } },
      ],
    };

    const migrated = migrateOutputData(saved, {
      myCard: (data) => ({ ...data, title: (data as { name?: string }).name }),
    });

    expect(migrated.time).toBe(42);
    expect(migrated.version).toBe('1.0.0');
    expect(migrated.blocks[0].data).toEqual({ name: 'Old', title: 'Old' });
    // Untouched block passes through unchanged.
    expect(migrated.blocks[1].data).toEqual({ text: 'keep' });
  });
});
