import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type * as DatabaseCsv from '../../../../../src/tools/database/database-csv';
import type * as Logger from '../../../../../src/components/utils/logger';

const loads = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock('../../../../../src/tools/database/database-csv', async (importOriginal) => {
  loads.count += 1;
  const actual = await importOriginal<typeof DatabaseCsv>();

  return {
    ...actual,
    csvDatabaseBlocks: (...args: Parameters<typeof actual.csvDatabaseBlocks>) => {
      if (loads.fail) {
        throw new Error('chunk failed');
      }

      return actual.csvDatabaseBlocks(...args);
    },
  };
});

vi.mock('../../../../../src/components/utils/logger', async (importOriginal) => ({
  ...await importOriginal<typeof Logger>(),
  log: vi.fn(),
}));

import { offerCsvDatabase } from '../../../../../src/components/modules/paste/csv-database-offer';
import type { CsvOfferDeps } from '../../../../../src/components/modules/paste/csv-database-offer';
import { log } from '../../../../../src/components/utils/logger';

const deps = (): CsvOfferDeps & { inserted: string[] } => {
  const inserted: string[] = [];
  const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];

  return {
    inserted,
    blocks: {
      getById: vi.fn((id: string) => ({ id }) as never),
      getBlockIndex: vi.fn((id: string) => ['b1', 'b2'].indexOf(id)),
      insertAt: vi.fn((type?: string) => {
        inserted.push(type ?? '');

        return {} as never;
      }),
      delete: vi.fn(async () => undefined),
    },
    notify: vi.fn(),
    t: (key: string) => key,
    newId: () => ids.shift() ?? 'id-x',
  };
};

describe('offerCsvDatabase loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loads.fail = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the database CSV code only when the user converts', async () => {
    const d = deps();

    expect(offerCsvDatabase('a,b\n1,2', ['b1', 'b2'], d)).toBe(true);
    expect(loads.count).toBe(0);

    vi.mocked(d.notify).mock.calls[0][0].actions?.[0]?.onClick();
    await vi.waitFor(() => expect(d.inserted).toContain('database'));
    expect(loads.count).toBe(1);
  });

  it('logs a failed convert and lets the user try again', async () => {
    const d = deps();

    offerCsvDatabase('a,b\n1,2', ['b1', 'b2'], d);
    const action = vi.mocked(d.notify).mock.calls[0][0].actions?.[0];

    loads.fail = true;
    action?.onClick();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.any(String), 'warn', expect.any(Error)));
    expect(d.inserted).toEqual([]);

    loads.fail = false;
    action?.onClick();
    await vi.waitFor(() => expect(d.inserted).toContain('database'));
  });
});
