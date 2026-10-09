import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { offerCsvDatabase } from '../../../../../src/components/modules/paste/csv-database-offer';
import type { CsvOfferDeps } from '../../../../../src/components/modules/paste/csv-database-offer';

const deps = (): CsvOfferDeps & { order: string[] } => {
  const order: string[] = [];
  const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8'];

  return {
    order,
    blocks: {
      getById: vi.fn((id: string) => ({ id }) as never),
      getBlockIndex: vi.fn((id: string) => ['b1', 'b2', 'b3'].indexOf(id)),
      insertAt: vi.fn((type?: string) => {
        order.push(`insert:${type ?? ''}`);

        return {} as never;
      }),
      delete: vi.fn(async (index?: number) => {
        order.push(`delete:${String(index)}`);
      }),
      beginTransaction: vi.fn(() => order.push('begin')),
      endTransaction: vi.fn(() => order.push('end')),
    },
    notify: vi.fn(),
    t: (key: string) => key,
    newId: () => ids.shift() ?? 'id-x',
  };
};

describe('offerCsvDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers a database when every pasted table line became a block', () => {
    const d = deps();

    expect(offerCsvDatabase('Task,Points\nWrite,3\nShip,5', ['b1', 'b2', 'b3'], d)).toBe(true);
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({
      message: 'tools.database.csvPasteOffer',
      actions: [expect.objectContaining({ label: 'tools.database.csvPasteConvert', primary: true })],
    }));
  });

  it('offers nothing for prose, or when a line merged into an existing block', () => {
    const d = deps();

    expect(offerCsvDatabase('Hello there\nGeneral Kenobi', ['b1', 'b2'], d)).toBe(false);
    expect(offerCsvDatabase('Task,Points\nWrite,3\nShip,5', ['b2', 'b3'], d)).toBe(false);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('replaces the pasted paragraphs with the database and its rows, in one undo step', async () => {
    const d = deps();

    offerCsvDatabase('Task,Points\nWrite,3\nShip,5', ['b1', 'b2', 'b3'], d);
    const action = vi.mocked(d.notify).mock.calls[0][0].actions?.[0];

    action?.onClick();
    await vi.waitFor(() => expect(d.order).toContain('end'));

    expect(d.order).toEqual(['begin', 'insert:database', 'insert:database-row', 'insert:database-row', 'delete:1', 'delete:2', 'end']);
    expect(d.blocks.insertAt).toHaveBeenNthCalledWith(1, 'database', expect.objectContaining({ schema: expect.any(Array) }), { replace: 'b1', id: 'id-1' });
    expect(d.blocks.insertAt).toHaveBeenNthCalledWith(2, 'database-row', expect.objectContaining({ title: 'Write' }), expect.objectContaining({ parentId: 'id-1', position: 'end' }));
    expect(d.blocks.delete).toHaveBeenCalledWith(1, false);
  });

  it('keeps cell text as typed: markup and entities are text, not HTML', async () => {
    const d = deps();

    offerCsvDatabase('Task\tNote\n<b>bold</b> & co\tx', ['b1', 'b2'], d);
    vi.mocked(d.notify).mock.calls[0][0].actions?.[0]?.onClick();
    await vi.waitFor(() => expect(d.order).toContain('end'));

    expect(d.blocks.insertAt).toHaveBeenNthCalledWith(2, 'database-row', expect.objectContaining({ title: '<b>bold</b> & co' }), expect.anything());
  });
});
