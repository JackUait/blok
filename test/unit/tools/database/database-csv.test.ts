import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  buildCsvImport,
  csvCellText,
  inferColumnType,
  parseCsv,
  planCsvMerge,
  serializeCsv,
} from '../../../../src/tools/database/database-csv';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const ctx = { locale: 'en-US', personName: (id: string): string | undefined => (id === 'u1' ? 'Ada' : undefined) };

describe('database CSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseCsv', () => {
    it('reads quoted commas, quotes, line breaks, CRLF and a BOM', () => {
      const text = '﻿Name,Notes\r\n"Smith, Jo","He said ""hi"""\r\n"Two\nlines",x\r\n';

      expect(parseCsv(text)).toEqual([
        ['Name', 'Notes'],
        ['Smith, Jo', 'He said "hi"'],
        ['Two\nlines', 'x'],
      ]);
    });

    it('reads tab-separated text, as a spreadsheet copies it', () => {
      expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('keeps empty cells and drops trailing blank lines', () => {
      expect(parseCsv('a,,c\n\n')).toEqual([['a', '', 'c']]);
    });
  });

  describe('serializeCsv', () => {
    it('quotes only cells that need it and doubles inner quotes', () => {
      expect(serializeCsv([['Name', 'Notes'], ['Smith, Jo', 'He said "hi"'], ['plain', 'two\nlines']]))
        .toBe('﻿Name,Notes\r\n"Smith, Jo","He said ""hi"""\r\nplain,"two\nlines"');
    });

    it('reads back what it wrote', () => {
      const table = [['a', 'b, c'], ['"q"', '\n']];

      expect(parseCsv(serializeCsv(table))).toEqual(table);
    });
  });

  describe('csvCellText', () => {
    const select: PropertyDefinition = {
      id: 'p-tags',
      name: 'Tags',
      type: 'multiSelect',
      position: 'a1',
      config: { options: [{ id: 'o1', label: 'Red', position: 'a0' }, { id: 'o2', label: 'Blue', position: 'a1' }] },
    };

    it('writes each type as people read it', () => {
      expect(csvCellText(select, ['o2', 'o1'], ctx)).toBe('Blue, Red');
      expect(csvCellText({ id: 'c', name: 'Done', type: 'checkbox', position: 'a' }, true, ctx)).toBe('Yes');
      expect(csvCellText({ id: 'c', name: 'Done', type: 'checkbox', position: 'a' }, undefined, ctx)).toBe('No');
      expect(csvCellText({ id: 'n', name: 'N', type: 'number', position: 'a' }, 42.5, ctx)).toBe('42.5');
      expect(csvCellText({ id: 'd', name: 'D', type: 'date', position: 'a' }, '2026-10-09', ctx)).toBe('October 9, 2026');
      expect(csvCellText({ id: 'p', name: 'P', type: 'person', position: 'a' }, [{ id: 'u1' }, { id: 'u2' }], ctx)).toBe('Ada, u2');
      expect(csvCellText({ id: 'f', name: 'F', type: 'files', position: 'a' }, [{ id: 'f1', name: 'a.png', url: 'https://x/a.png' }], ctx)).toBe('https://x/a.png');
      expect(csvCellText({ id: 'u', name: 'ID', type: 'uniqueId', position: 'a', uniqueId: { prefix: 'T' } }, 7, ctx)).toBe('T-7');
      expect(csvCellText({ id: 't', name: 'T', type: 'text', position: 'a' }, null, ctx)).toBe('');
    });
  });

  describe('inferColumnType', () => {
    it('picks a type only when every filled cell agrees, else text', () => {
      expect(inferColumnType(['1', '2.5', '-3', '1,200', ''])).toBe('number');
      expect(inferColumnType(['Yes', 'No', ''])).toBe('checkbox');
      expect(inferColumnType(['2026-10-09', '10/31/2026'])).toBe('date');
      expect(inferColumnType(['October 9, 2026', 'Oct 12, 2026 → Oct 14, 2026'])).toBe('date');
      expect(inferColumnType(['https://a.com', 'http://b.org/x'])).toBe('url');
      expect(inferColumnType(['a@b.co', 'c@d.org'])).toBe('email');
      expect(inferColumnType(['1', 'two'])).toBe('text');
      expect(inferColumnType(['', ''])).toBe('text');
    });
  });

  describe('buildCsvImport', () => {
    it('makes the first column the title and infers the rest', () => {
      let n = 0;
      const result = buildCsvImport(
        [['Task', 'Points', 'Due', 'Done'], ['Write', '3', '10/09/2026', 'Yes'], ['Ship', '', '2026-10-12', 'No']],
        { newId: () => `id${n++}`, untitled: 'Untitled' }
      );

      expect(result.schema.map((p) => [p.name, p.type])).toEqual([
        ['Task', 'title'],
        ['Points', 'number'],
        ['Due', 'date'],
        ['Done', 'checkbox'],
      ]);
      const [title, points, due, done] = result.schema.map((p) => p.id);

      expect(result.rows).toEqual([
        { [title]: 'Write', [points]: 3, [due]: '2026-10-09', [done]: true },
        { [title]: 'Ship', [points]: null, [due]: '2026-10-12', [done]: false },
      ]);
    });

    it('names a blank header and keeps short rows', () => {
      const result = buildCsvImport([['', 'B'], ['x']], { newId: () => Math.random().toString(36), untitled: 'Column' });

      expect(result.schema.map((p) => p.name)).toEqual(['Column 1', 'B']);
      expect(Object.values(result.rows[0])).toEqual(['x', '']);
    });
  });

  describe('planCsvMerge', () => {
    const schema: PropertyDefinition[] = [
      { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'p-pts', name: 'Points', type: 'number', position: 'a1' },
      { id: 'p-tag', name: 'Tag', type: 'select', position: 'a2', config: { options: [{ id: 'o1', label: 'Red', position: 'a0' }] } },
    ];

    it('only adds rows, even when a title already exists (research/05 §9.3)', () => {
      const plan = planCsvMerge([['Name', 'Points'], ['Write', '5']], schema, { newId: () => 'o-new' });

      expect(plan.rows).toEqual([{ 'p-title': 'Write', 'p-pts': 5 }]);
    });

    it('matches headers to property names exactly and skips the rest', () => {
      const plan = planCsvMerge([['Name', 'points', 'Extra'], ['A', '1', 'x']], schema, { newId: () => 'o-new' });

      expect(plan.rows).toEqual([{ 'p-title': 'A' }]);
      expect(plan.skippedColumns).toEqual(['points', 'Extra']);
    });

    it('reuses select options by label and adds the missing ones', () => {
      const plan = planCsvMerge([['Name', 'Tag'], ['A', 'Red'], ['B', 'Green'], ['C', 'Green']], schema, { newId: () => 'o-new' });

      expect(plan.rows.map((r) => r['p-tag'])).toEqual(['o1', 'o-new', 'o-new']);
      expect(plan.newOptions).toEqual({ 'p-tag': [{ id: 'o-new', label: 'Green' }] });
    });
  });

  describe('export then merge gives back the stored values', () => {
    const roundTrip = (property: PropertyDefinition, value: unknown, localized: PropertyDefinition = property): unknown => {
      const text = csvCellText(localized, value as never, ctx);
      const plan = planCsvMerge([[localized.name], [text]], [property], { newId: () => 'o-new', localized: [localized] });

      return plan.rows[0]?.[property.id];
    };

    it('keeps numbers, whatever their display format', () => {
      expect(roundTrip({ id: 'n', name: 'N', type: 'number', position: 'a', number: { format: 'dollar' } }, 1234.5)).toBe(1234.5);
      expect(roundTrip({ id: 'n', name: 'N', type: 'number', position: 'a', number: { format: 'percent' } }, 0.25)).toBe(0.25);
    });

    it('keeps days, day ranges and times, even when the property shows relative dates', () => {
      const date: PropertyDefinition = { id: 'd', name: 'D', type: 'date', position: 'a' };

      expect(roundTrip(date, '2026-10-09')).toBe('2026-10-09');
      expect(roundTrip(date, '2026-10-09/2026-10-12')).toBe('2026-10-09/2026-10-12');
      expect(roundTrip(date, '2026-10-09T15:30')).toBe('2026-10-09T15:30');
      expect(roundTrip({ ...date, date: { dateFormat: 'relative' } }, '2026-10-09')).toBe('2026-10-09');
    });

    it('keeps a checkbox, a url and a select', () => {
      expect(roundTrip({ id: 'c', name: 'C', type: 'checkbox', position: 'a' }, true)).toBe(true);
      expect(roundTrip({ id: 'u', name: 'U', type: 'url', position: 'a' }, 'https://a.com/x?y=1,2')).toBe('https://a.com/x?y=1,2');
      expect(roundTrip({ id: 's', name: 'S', type: 'select', position: 'a', config: { options: [{ id: 'o1', label: 'Red', position: 'a0' }] } }, 'o1')).toBe('o1');
    });

    it('keeps a multi-select label that holds a comma', () => {
      const tags: PropertyDefinition = {
        id: 't',
        name: 'Tags',
        type: 'multiSelect',
        position: 'a',
        config: { options: [{ id: 'o1', label: 'Smith, Jo', position: 'a0' }, { id: 'o2', label: 'Ann', position: 'a1' }] },
      };

      expect(roundTrip(tags, ['o1', 'o2'])).toEqual(['o1', 'o2']);
    });

    it('matches the localized column name and option label a non-English export wrote', () => {
      const saved: PropertyDefinition = { id: 's', name: 'Status', type: 'status', position: 'a', config: { options: [{ id: 'o1', label: 'Done', position: 'a0' }] } };
      const shown: PropertyDefinition = { ...saved, name: 'Статус', config: { options: [{ id: 'o1', label: 'Готово', position: 'a0' }] } };

      expect(roundTrip(saved, 'o1', shown)).toBe('o1');
    });
  });
});
