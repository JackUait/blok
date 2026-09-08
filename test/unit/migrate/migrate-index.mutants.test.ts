import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  migrate,
  migrateLegacyBlocks,
  migrateLegacyOutputData,
  needsLegacyMigration,
  matchLegacyRule,
} from '../../../src/migrate';
import { migrateBlocks as migrateBlocksDependency } from '../../../src/components/migration/block-migrations';

import type * as BlockMigrationsModule from '../../../src/components/migration/block-migrations';
import type { LegacyGrammarEntry, LossyFieldReport } from '../../../src/migrate';
import type { OutputBlockData, OutputData } from '../../../types';

/**
 * Mutation coverage for the public `@bloklabs/core/migrate` surface.
 *
 * One mutant needs a spy rather than an output assertion: `resolved.migrations
 * !== undefined` replaced by `true` (243:24). Calling `migrateBlocks` with an
 * undefined migration map is an identity `.map` — every block comes back by
 * reference — and `expandLegacyBlocks` shallow-copies every block afterwards
 * anyway, so the mutant produces byte-identical output. The only observable
 * difference is that the host data pass runs at all, so `migrateBlocks` is
 * mocked (a dependency, not the module under test) with a delegating spy and
 * the test asserts it is never entered when no `migrations` option is given.
 *
 * No mutant in this file was proven equivalent; all 27 are killed.
 */
vi.mock('../../../src/components/migration/block-migrations', async (importOriginal) => {
  const actual = await importOriginal<typeof BlockMigrationsModule>();

  return {
    ...actual,
    migrateBlocks: vi.fn(actual.migrateBlocks),
  };
});

const realBlockMigrations = await vi.importActual<typeof BlockMigrationsModule>(
  '../../../src/components/migration/block-migrations'
);

/**
 * Deterministic id source that also records what it handed out, so a test can
 * assert the migrated ids ARE the minted ones rather than merely id-shaped.
 */
const counterIds = (): (() => string) & { minted: string[] } => {
  const minted: string[] = [];
  const generate = (): string => {
    const id = `id-${minted.length + 1}`;

    minted.push(id);

    return id;
  };

  return Object.assign(generate, { minted });
};

const alertRule: LegacyGrammarEntry = {
  legacyType: 'alert',
  targetType: 'callout',
  cardinality: '1:1',
  contributesNesting: true,
  lossyFields: [],
  docNote: 'Host rule',
  detect: (block: OutputBlockData) => block.type === 'alert',
  expand: (block: OutputBlockData) => [{ ...block, type: 'callout', data: { emoji: '!' } }],
};

const alertBlocks: OutputBlockData[] = [{ id: 'a1', type: 'alert', data: {} }];
const alertDoc: OutputData = { time: 1, version: '1.0.0', blocks: alertBlocks };

const lossyBlocks: OutputBlockData[] = [
  { id: 'q1', type: 'quote', data: { text: 'x', alignment: 'center' } },
  { id: 'i1', type: 'image', data: { url: 'u', withBackground: true } },
];
const lossyDoc: OutputData = { time: 1, version: '1.0.0', blocks: lossyBlocks };

const expectedLossyFields: LossyFieldReport[] = [
  { blockType: 'quote', field: 'alignment', verb: 'ignored' },
  { blockType: 'image', field: 'withBackground', verb: 'dropped' },
];

const legacyListBlocks: OutputBlockData[] = [
  {
    type: 'list',
    data: {
      style: 'unordered',
      items: [
        { content: 'a', items: [] },
        { content: 'b', items: [] },
      ],
    },
  },
];

const cleanDoc: OutputData = {
  time: 11,
  version: '2.0.0',
  blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hello' } }],
};

/** Every block id must be exactly one of the ids the host generator handed out. */
const expectIdsCameFrom = (blocks: OutputBlockData[], generateId: (() => string) & { minted: string[] }): void => {
  expect(generateId.minted.length).toBeGreaterThan(0);
  expect([...blocks.map((block) => block.id)].sort()).toEqual([...generateId.minted].sort());
};

beforeEach(() => {
  vi.clearAllMocks();
  // Re-arm after clearAllMocks so every test gets the real implementation back.
  vi.mocked(migrateBlocksDependency).mockImplementation(realBlockMigrations.migrateBlocks);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('option normalization (options object or bare rules array)', () => {
  it('accepts a bare rules array in every rules-taking entry point', () => {
    expect(needsLegacyMigration(alertBlocks)).toBe(false);

    expect(matchLegacyRule(alertBlocks[0], [alertRule])?.targetType).toBe('callout');
    expect(needsLegacyMigration(alertBlocks, [alertRule])).toBe(true);
    expect(migrateLegacyBlocks(alertBlocks, [alertRule])[0].type).toBe('callout');
    expect(migrateLegacyOutputData(alertDoc, [alertRule]).blocks[0].type).toBe('callout');
    expect(migrate(alertDoc, [alertRule]).data.blocks[0].type).toBe('callout');
  });

  it('reads the options-object form, honouring generateId and rules', () => {
    const generateId = counterIds();
    const migrated = migrateLegacyBlocks(legacyListBlocks, { generateId });

    expect(migrated.length).toBeGreaterThan(1);
    expectIdsCameFrom(migrated, generateId);

    expect(migrateLegacyBlocks(alertBlocks, { rules: [alertRule] })[0].type).toBe('callout');
  });
});

describe('lossy-field sink', () => {
  it('routes lossy fields to the host sink instead of the console', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reports: LossyFieldReport[] = [];

    migrateLegacyBlocks(lossyBlocks, {
      generateId: counterIds(),
      onLossyField: (report) => reports.push(report),
    });

    expect(reports).toEqual(expectedLossyFields);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the console warning when no sink is supplied', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => migrateLegacyBlocks(lossyBlocks, { generateId: counterIds() })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(expectedLossyFields.length);
  });
});

describe('matchLegacyRule', () => {
  it('returns the grammar entry that claims a legacy block', () => {
    const entry = matchLegacyRule({ id: 'w1', type: 'warning', data: { title: 't', message: 'm' } });

    expect(entry).not.toBeNull();
    expect(entry?.legacyType).toBe('warning');
    expect(entry?.targetType).toBe('callout');
  });

  it('returns null when no rule claims the block', () => {
    expect(matchLegacyRule({ id: 'p1', type: 'paragraph', data: { text: 'x' } })).toBeNull();
  });
});

describe('migrate — result envelope and report', () => {
  it('keeps the envelope and reports nothing for a clean document', () => {
    const result = migrate(cleanDoc, { generateId: counterIds() });

    expect(result.data.time).toBe(11);
    expect(result.data.version).toBe('2.0.0');
    expect(result.data.blocks).toHaveLength(1);
    expect(result.data.blocks[0].type).toBe('paragraph');
    expect(result.report.lossyFields).toEqual([]);
    expect(result.report.errors).toEqual([]);
  });

  it('collects lossy fields and forwards each one to the host sink', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: LossyFieldReport[] = [];

    const { report } = migrate(lossyDoc, {
      generateId: counterIds(),
      onLossyField: (lossy) => seen.push(lossy),
    });

    expect(report.lossyFields).toEqual(expectedLossyFields);
    expect(seen).toEqual(expectedLossyFields);
  });

  it('reports lossy fields without a host sink and without throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => migrate(lossyDoc, { generateId: counterIds() })).not.toThrow();
    expect(migrate(lossyDoc, { generateId: counterIds() }).report.lossyFields).toEqual(expectedLossyFields);
  });

  it('forwards generateId and rules to the grammar pass', () => {
    const generateId = counterIds();
    const { data } = migrate({ time: 1, version: '1.0.0', blocks: legacyListBlocks }, { generateId });

    expect(data.blocks.length).toBeGreaterThan(1);
    expectIdsCameFrom(data.blocks, generateId);

    expect(migrate(alertDoc, { rules: [alertRule], generateId: counterIds() }).data.blocks[0].type).toBe('callout');
  });
});

describe('migrate — host data pass', () => {
  it('applies host data migrations to the stored data', () => {
    const { data } = migrate(
      { time: 1, version: '1.0.0', blocks: [{ id: 'c1', type: 'myCard', data: { name: 'Old' } }] },
      {
        migrations: { myCard: (stored) => ({ ...stored, name: 'New' }) },
        generateId: counterIds(),
      }
    );

    expect(data.blocks[0].data).toEqual({ name: 'New' });
  });

  it('records a throwing data rule with its type and the thrown error', () => {
    const boom = new Error('bad rule');

    const { data, report } = migrate(
      { time: 1, version: '1.0.0', blocks: [{ id: 'c1', type: 'myCard', data: { name: 'Old' } }] },
      {
        migrations: {
          myCard: () => {
            throw boom;
          },
        },
        generateId: counterIds(),
      }
    );

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].type).toBe('myCard');
    expect(report.errors[0].error).toBe(boom);
    expect(data.blocks[0].data).toEqual({ name: 'Old' });
  });

  it('skips the host data pass entirely when no migrations are supplied', () => {
    migrate(cleanDoc, { generateId: counterIds() });

    expect(vi.mocked(migrateBlocksDependency)).not.toHaveBeenCalled();

    migrate(cleanDoc, { migrations: { paragraph: (stored) => stored }, generateId: counterIds() });

    expect(vi.mocked(migrateBlocksDependency)).toHaveBeenCalledTimes(1);
  });
});
