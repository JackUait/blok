import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ROLLUP_FUNCTIONS, computeRollup, rollupFunctionsFor, rollupResultType } from '../../../../src/tools/database/rollup';
import type { PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';

const number: PropertyDefinition = { id: 'amount', name: 'Amount', type: 'number', position: 'a0' };
const text: PropertyDefinition = { id: 'notes', name: 'Notes', type: 'text', position: 'a1' };
const date: PropertyDefinition = { id: 'due', name: 'Due', type: 'date', position: 'a2' };
const checkbox: PropertyDefinition = { id: 'done', name: 'Done', type: 'checkbox', position: 'a3' };
const select: PropertyDefinition = {
  id: 'stage', name: 'Stage', type: 'select', position: 'a4',
  config: { options: [{ id: 'idea', label: 'Idea', position: 'a0' }, { id: 'ship', label: 'Ship', position: 'a1' }] },
};
const status: PropertyDefinition = {
  id: 'progress', name: 'Progress', type: 'status', position: 'a5',
  config: {
    options: [
      { id: 'ns', label: 'Not started', position: 'a0', groupId: 'todo' },
      { id: 'ip', label: 'In progress', position: 'a0', groupId: 'inProgress' },
      { id: 'dn', label: 'Done', position: 'a0', groupId: 'complete' },
    ],
  },
};
const tags: PropertyDefinition = {
  id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a6',
  config: { options: [{ id: 'a', label: 'A', position: 'a0' }, { id: 'b', label: 'B', position: 'a1' }] },
};

const roll = (fn: Parameters<typeof computeRollup>[0], target: PropertyDefinition, values: Array<PropertyValue | undefined>): PropertyValue =>
  computeRollup(fn, values, target);

describe('rollup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('knows the 24 Notion API functions', () => {
    expect(ROLLUP_FUNCTIONS).toHaveLength(24);
    expect(new Set(ROLLUP_FUNCTIONS).size).toBe(24);
  });

  describe('counts', () => {
    it('count is the number of related rows', () => {
      expect(roll('count', text, ['a', '', undefined])).toBe(3);
    });

    it('count_values counts each value, so a multi-select row gives one per option', () => {
      expect(roll('count_values', tags, [['a', 'b'], ['a'], []])).toBe(3);
    });

    it('unique counts distinct values', () => {
      expect(roll('unique', text, ['x', 'x', 'y', ''])).toBe(2);
    });

    it('empty and not_empty count rows', () => {
      expect(roll('empty', text, ['x', '', undefined])).toBe(2);
      expect(roll('not_empty', text, ['x', '', undefined])).toBe(1);
    });

    it('percent_empty is a fraction, so the percent number format prints it', () => {
      expect(roll('percent_empty', text, ['x', '', undefined, 'y'])).toBe(0.5);
      expect(roll('percent_not_empty', text, ['x', '', undefined, 'y'])).toBe(0.5);
    });

    it('a percent over no rows is empty, not a division by zero', () => {
      expect(roll('percent_empty', text, [])).toBeNull();
    });
  });

  describe('numbers', () => {
    const values = [3, 1, '4', null, 2];

    it.each([
      ['sum', 10],
      ['average', 2.5],
      ['median', 2.5],
      ['min', 1],
      ['max', 4],
      ['range', 3],
    ] as const)('%s', (fn, expected) => {
      expect(roll(fn, number, values)).toBe(expected);
    });

    it('a sum over no numbers is empty', () => {
      expect(roll('sum', number, [null, undefined])).toBeNull();
    });
  });

  describe('dates', () => {
    const values = ['2026-03-04', '2026-01-02', '2026-02-10T09:30', null];

    it('earliest_date and latest_date keep the stored date', () => {
      expect(roll('earliest_date', date, values)).toBe('2026-01-02');
      expect(roll('latest_date', date, values)).toBe('2026-03-04');
    });

    it('date_range is a stored range from the earliest to the latest', () => {
      expect(roll('date_range', date, values)).toBe('2026-01-02/2026-03-04');
    });

    it('reads the start of a range', () => {
      expect(roll('earliest_date', date, ['2026-05-01/2026-05-09', '2026-06-01'])).toBe('2026-05-01');
    });
  });

  describe('checkbox', () => {
    const values = [true, false, true, undefined];

    it.each([
      ['checked', 2],
      ['unchecked', 2],
      ['percent_checked', 0.5],
      ['percent_unchecked', 0.5],
    ] as const)('%s', (fn, expected) => {
      expect(roll(fn, checkbox, values)).toBe(expected);
    });
  });

  describe('show original and unique', () => {
    it('keeps every option of a select, repeats included, as a multi-select value', () => {
      expect(roll('show_original', select, ['idea', 'ship', 'idea', ''])).toEqual(['idea', 'ship', 'idea']);
    });

    it('flattens multi-select values', () => {
      expect(roll('show_original', tags, [['a', 'b'], ['a']])).toEqual(['a', 'b', 'a']);
    });

    it('show_unique drops repeats', () => {
      expect(roll('show_unique', tags, [['a', 'b'], ['a']])).toEqual(['a', 'b']);
    });

    it('joins text values with a comma', () => {
      expect(roll('show_original', text, ['x', '', 'y'])).toBe('x, y');
    });

    it('keeps person values as id objects', () => {
      const person: PropertyDefinition = { id: 'who', name: 'Who', type: 'person', position: 'a9' };

      expect(roll('show_unique', person, [[{ id: 'u1' }], [{ id: 'u1' }, { id: 'u2' }]])).toEqual([{ id: 'u1' }, { id: 'u2' }]);
    });
  });

  describe('per group', () => {
    it('count_per_group counts each status group', () => {
      expect(roll('count_per_group', status, ['ns', 'ip', 'ip', 'dn'])).toBe('To-do: 1, In progress: 2, Complete: 1');
    });

    it('percent_per_group gives each option a share', () => {
      expect(roll('percent_per_group', select, ['idea', 'ship', 'idea', 'idea'])).toBe('Idea: 75%, Ship: 25%');
    });
  });

  describe('result type', () => {
    it('counts and number functions give a number', () => {
      expect(rollupResultType('count', text).type).toBe('number');
      expect(rollupResultType('sum', number).type).toBe('number');
    });

    it('percents give a number shown as a percent', () => {
      expect(rollupResultType('percent_checked', checkbox)).toMatchObject({ type: 'number', number: { format: 'percent' } });
    });

    it('date functions give a date', () => {
      expect(rollupResultType('latest_date', date).type).toBe('date');
      expect(rollupResultType('date_range', date).type).toBe('date');
    });

    it('show original keeps the target type for lists of options, people and relations', () => {
      expect(rollupResultType('show_original', select)).toMatchObject({ type: 'multiSelect', config: select.config });
      expect(rollupResultType('show_original', tags).type).toBe('multiSelect');
      expect(rollupResultType('show_original', text).type).toBe('text');
    });
  });

  describe('functions offered per target type', () => {
    it('offers number functions only for a number target', () => {
      expect(rollupFunctionsFor(number)).toContain('sum');
      expect(rollupFunctionsFor(text)).not.toContain('sum');
    });

    it('offers date functions only for a date target', () => {
      expect(rollupFunctionsFor(date)).toContain('date_range');
      expect(rollupFunctionsFor(number)).not.toContain('date_range');
    });

    it('offers checked functions only for a checkbox target', () => {
      expect(rollupFunctionsFor(checkbox)).toContain('percent_checked');
      expect(rollupFunctionsFor(text)).not.toContain('checked');
    });

    it('offers per-group functions for option properties', () => {
      expect(rollupFunctionsFor(status)).toContain('count_per_group');
      expect(rollupFunctionsFor(text)).not.toContain('count_per_group');
    });
  });
});
