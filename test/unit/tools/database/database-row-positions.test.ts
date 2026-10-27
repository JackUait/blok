import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';

import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { sortRows } from '../../../../src/tools/database/database-query';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

const row = (id: string, position: string): DatabaseRow => ({ id, position, properties: {} });
const schema: PropertyDefinition[] = [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];

/** The library's own order: plain code-unit compare. */
const ordered = (keys: string[]): string[] => [...keys].sort((a, b) => (a < b ? -1 : 1));

describe('row positions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('row order follows the order the keys were minted in', () => {
    // a0 < a0V < a0l < a1 is the library's order; localeCompare puts a0l first.
    const minted = (): string[] => {
      const mid = generateKeyBetween('a0', 'a1');
      const later = generateKeyBetween(mid, 'a1');

      return ['a0', mid, later, 'a1'];
    };

    it('in the model', () => {
      const keys = minted();
      const model = new DatabaseModel({ schema });

      model.setRows([...keys].reverse().map((key) => row(key, key)));

      expect(model.getOrderedRows().map((r) => r.position)).toEqual(keys);
    });

    it('in a view with no sorts', () => {
      const keys = minted();

      expect(sortRows([...keys].reverse().map((key) => row(key, key)), [], schema).map((r) => r.position)).toEqual(keys);
    });

    it('for a row dropped above the first row', () => {
      const top = DatabaseModel.positionBetween(null, 'a0');
      const model = new DatabaseModel({ schema });

      model.setRows([row('first', 'a0'), row('dropped', top)]);

      expect(model.getOrderedRows().map((r) => r.id)).toEqual(['dropped', 'first']);
    });
  });

  describe('positionBetween never throws on a stored key', () => {
    // `a${String(i).padStart(3, '0')}` keys: the library rejects a fraction ending in 0.
    it.each<[string | null, string | null]>([
      ['a000', 'a001'],
      ['a001', 'a010'],
      ['a010', null],
      [null, 'a000'],
      ['a000', null],
      ['0', null],
      [null, '0'],
      ['row-1', 'row-2'],
      ['', 'a0'],
      ['a2', 'a1'],
    ])('between %j and %j', (after, before) => {
      const key = DatabaseModel.positionBetween(after, before);
      const [low, high] = after !== null && before !== null && after > before ? [before, after] : [after, before];

      expect(ordered([low ?? '', key, high ?? '￿'])).toEqual([low ?? '', key, high ?? '￿']);
      expect(key).not.toBe(low);
      expect(key).not.toBe(high);
    });

    it('keeps minting valid keys after a legacy one', () => {
      const first = DatabaseModel.positionBetween('a000', 'a001');
      const second = DatabaseModel.positionBetween(first, 'a001');

      expect(ordered(['a000', first, second, 'a001'])).toEqual(['a000', first, second, 'a001']);
      expect(new Set([first, second]).size).toBe(2);
    });
  });
});
