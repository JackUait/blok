import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  buildCsvImport,
  csvCellText,
  csvColumns,
  inferColumnType,
  parseCsv,
  csvMergeTargets,
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

    it('writes a button cell as empty text: it holds no value', () => {
      expect(csvCellText({ id: 'b', name: 'Act', type: 'button', position: 'a0', button: { label: 'Go' } }, 'stray', { locale: 'en-US' })).toBe('');
    });

    it('writes computed values as text and relations as the related titles', () => {
      const prop = (id: string, type: PropertyDefinition['type']): PropertyDefinition => ({ id, name: id, type, position: 'a0' });
      const titles: Record<string, string> = { r1: 'Alpha', r2: 'Bravo' };
      const withTitles = { locale: 'en-US', rowTitle: (id: string): string | undefined => titles[id] };

      expect(csvCellText(prop('rel', 'relation'), [{ id: 'r1' }, { id: 'r2' }], withTitles)).toBe('Alpha, Bravo');
      expect(csvCellText(prop('f', 'formula'), 42, withTitles)).toBe('42');
      expect(csvCellText(prop('f', 'formula'), true, withTitles)).toBe('Yes');
      expect(csvCellText(prop('f', 'formula'), 'done', withTitles)).toBe('done');
      expect(csvCellText(prop('ro', 'rollup'), [{ id: 'r2' }], withTitles)).toBe('Bravo');
      expect(csvCellText(prop('ro', 'rollup'), null, withTitles)).toBe('');
    });

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
    // Not measured in Notion: a header that already looks numbered takes the next free number.
    it('gives every column a unique name, even when a header already looks numbered', () => {
      const result = buildCsvImport([['Tag', 'Tag 1', 'Tag'], ['a', 'b', 'c']], { newId: () => Math.random().toString(36), untitled: 'Column' });

      expect(result.schema.map((p) => p.name)).toEqual(['Tag', 'Tag 1', 'Tag 2']);
      expect(result.rows[0]).toEqual(Object.fromEntries(result.schema.map((p, i) => [p.id, ['a', 'b', 'c'][i]])));
    });

    it('numbers a header that clashes with a blank header\'s name', () => {
      const result = buildCsvImport([['', 'Column 1'], ['x', 'y']], { newId: () => Math.random().toString(36), untitled: 'Column' });

      expect(result.schema.map((p) => p.name)).toEqual(['Column 1', 'Column 1 1']);
    });
  });

  // research/27 §2: the file Notion's "Setup CSV columns" step was measured with.
  const R27 = parseCsv([
    'Name,Due,Amount,Site,Email,Done,Stage',
    'Alpha,2026-03-04,12,https://example.com,a@example.com,Yes,Todo',
    'Bravo,2026-03-05,7.5,https://example.org,b@example.com,No,Doing',
    'Charlie,2026-03-06,100,https://example.net,c@example.com,Yes,Todo',
  ].join('\n'));
  const ids = (): (() => string) => {
    const counter = { n: 0 };

    return () => `id${counter.n++}`;
  };

  describe('csvColumns', () => {
    it('detects the types Notion detected: title, date, number, URL, email, checkbox; repeated short strings stay text', () => {
      expect(csvColumns(R27)).toEqual([
        { name: 'Name', detected: 'title' },
        { name: 'Due', detected: 'date' },
        { name: 'Amount', detected: 'number' },
        { name: 'Site', detected: 'url' },
        { name: 'Email', detected: 'email' },
        { name: 'Done', detected: 'checkbox' },
        { name: 'Stage', detected: 'text' },
      ]);
    });

    it('numbers repeated headers as the import does', () => {
      expect(csvColumns([['Name', 'Tag', 'Tag'], ['a', 'b', 'c']]).map((c) => c.name)).toEqual(['Name', 'Tag', 'Tag 1']);
    });
  });

  describe('buildCsvImport with a column mapping', () => {
    const options = { untitled: 'Column', titleName: 'Name' };

    it('drops a column set to Don\'t import from the schema and the rows', () => {
      const result = buildCsvImport(R27, { ...options, newId: ids(), targets: ['title', 'skip', 'number', 'skip', 'skip', 'skip', 'skip'] });

      expect(result.schema.map((p) => [p.name, p.type])).toEqual([['Name', 'title'], ['Amount', 'number']]);
      expect(result.rows.map((row) => Object.keys(row).length)).toEqual([2, 2, 2]);
    });

    it('makes Select options in first-appearance order, rows and columns in file order', () => {
      const result = buildCsvImport(R27, { ...options, newId: ids(), targets: ['title', 'date', 'number', 'url', 'email', 'checkbox', 'select'] });
      const stage = result.schema.find((p) => p.name === 'Stage');
      const title = result.schema[0];

      expect(stage?.type).toBe('select');
      expect(stage?.config?.options.map((o) => o.label)).toEqual(['Todo', 'Doing']);
      expect(new Set(stage?.config?.options.map((o) => o.color)).size).toBe(2);
      expect(result.schema.map((p) => p.name)).toEqual(['Name', 'Due', 'Amount', 'Site', 'Email', 'Done', 'Stage']);
      expect(result.rows.map((row) => row[title.id])).toEqual(['Alpha', 'Bravo', 'Charlie']);
      const todo = stage?.config?.options[0].id;

      expect(result.rows.map((row) => row[stage?.id ?? ''])).toEqual([todo, stage?.config?.options[1].id, todo]);
    });

    it('splits multi-select labels and gives a status property its groups', () => {
      const table = [['Name', 'Tags', 'State'], ['a', 'x, y', 'Open'], ['b', 'y', 'Shut']];
      const result = buildCsvImport(table, { ...options, newId: ids(), targets: ['title', 'multiSelect', 'status'] });
      const [, tags, state] = result.schema;

      expect(tags.config?.options.map((o) => o.label)).toEqual(['x', 'y']);
      expect((result.rows[0][tags.id] as string[]).length).toBe(2);
      expect(state.type).toBe('status');
      expect(state.status?.groups.length).toBeGreaterThan(0);
      expect(state.config?.options.map((o) => o.label)).toEqual(['Open', 'Shut']);
    });

    it('maps any column to the title; the first column then imports as its own type', () => {
      const result = buildCsvImport(R27, { ...options, newId: ids(), targets: ['text', 'skip', 'skip', 'skip', 'title', 'skip', 'skip'] });

      expect(result.schema.map((p) => [p.name, p.type])).toEqual([['Name', 'text'], ['Email', 'title']]);
      expect(result.rows[0][result.schema[1].id]).toBe('a@example.com');
    });

    it('adds an empty title when no column maps to it', () => {
      const result = buildCsvImport(R27, { ...options, newId: ids(), targets: ['skip', 'skip', 'number', 'skip', 'skip', 'skip', 'skip'] });

      expect(result.schema.map((p) => [p.name, p.type])).toEqual([['Name', 'title'], ['Amount', 'number']]);
      expect(result.rows.map((row) => row[result.schema[0].id])).toEqual(['', '', '']);
    });

    it('reads phone as text and person as empty, since a name cannot name a person', () => {
      const table = [['Name', 'Phone', 'Owner'], ['a', '+1 555', 'Ada']];
      const result = buildCsvImport(table, { ...options, newId: ids(), targets: ['title', 'phone', 'person'] });
      const [, phone, owner] = result.schema;

      expect([phone.type, owner.type]).toEqual(['phone', 'person']);
      expect(result.rows[0][phone.id]).toBe('+1 555');
      expect(result.rows[0][owner.id]).toEqual([]);
    });
  });

  // research/30 §9: the two files Notion's detection was measured with.
  const DETECT = parseCsv([
    'Name,When,Phone,Owner,State,Score',
    'Alpha,03/04/2026,+1 555 123 4567,Jane Roe,Not started,1',
    'Bravo,03/05/2026,(555) 123-4567,jroe@example.com,In progress,2',
    'Charlie,03/06/2026,555-123-4567,John Doe,Done,3',
  ].join('\n'));
  const NEUTRAL = parseCsv([
    'Title,Contact,Status,Person,Progress,Tags',
    'Alpha,+1 555 123 4567,Not started,Jane Roe,Not started,red',
    'Bravo,(555) 123-4567,In progress,John Doe,In progress,blue',
    'Charlie,555-123-4567,Done,Jane Roe,Done,red',
  ].join('\n'));

  describe('detection as research/30 §9a measured', () => {
    it('detects Phone from the values, whatever the header says', () => {
      expect(csvColumns(DETECT).map((c) => c.detected)).toEqual(['title', 'date', 'phone', 'text', 'text', 'number']);
      expect(csvColumns(NEUTRAL)[1]).toEqual({ name: 'Contact', detected: 'phone' });
    });

    it('never detects Person or Status, even under headers named so', () => {
      expect(csvColumns(NEUTRAL).map((c) => c.detected)).toEqual(['title', 'phone', 'text', 'text', 'text', 'text']);
    });

    it('keeps numbers, ISO dates and short digit runs out of Phone', () => {
      expect(inferColumnType(['1234567', '7654321'])).toBe('number');
      expect(inferColumnType(['2026-03-04', '2026-03-05'])).toBe('date');
      expect(inferColumnType(['12-34', '5-6'])).toBe('text');
      // DD.MM.YYYY, a common spreadsheet date export, is not a phone number.
      expect(inferColumnType(['03.04.2026', '2026.03.04'])).toBe('text');
    });
  });

  describe('the Date type\'s format sets how the text is read (research/30 §9b)', () => {
    const when = (format?: 'full' | 'short' | 'month_day_year' | 'day_month_year' | 'year_month_day'): unknown[] => {
      const result = buildCsvImport(DETECT, { untitled: 'Column', newId: ids(), dateFormats: [undefined, format] });
      const due = result.schema[1];

      return result.rows.map((row) => row[due.id]);
    };

    it('reads 03/04/2026 as March 4 under Full date, Short date and Month/Day/Year', () => {
      for (const format of [undefined, 'full', 'short', 'month_day_year'] as const) {
        expect(when(format)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06']);
      }
    });

    it('reads it as April 3 under Day/Month/Year', () => {
      expect(when('day_month_year')).toEqual(['2026-04-03', '2026-05-03', '2026-06-03']);
    });

    it('leaves the cells empty under Year/Month/Day', () => {
      expect(when('year_month_day')).toEqual([null, null, null]);
    });
  });

  // research/30 §9a: a first column headed "Title" read "Name" in Notion's preview.
  it('names a title column headed "Title" with the title name; any other header keeps its text', () => {
    const named = (header: string): string | undefined =>
      buildCsvImport([[header, 'Notes'], ['A', 'x']], { untitled: 'Column', titleName: 'Name', newId: ids() }).schema[0].name;

    expect(named('Title')).toBe('Name');
    expect(named('Task')).toBe('Task');
  });

  // Unmeasured: Blok keeps property names unique, so the renamed title never doubles a "Name" column.
  it('never gives two properties the name "Name"', () => {
    const names = (table: string[][], targets?: Array<'title' | 'text'>): string[] =>
      buildCsvImport(table, { untitled: 'Column', titleName: 'Name', newId: ids(), ...(targets === undefined ? {} : { targets }) }).schema.map((p) => p.name);

    expect(names([['Title', 'Name'], ['A', 'x']])).toEqual(['Name', 'Name 1']);
    expect(names([['Code', 'Name'], ['A', 'x']], ['text', 'text'])).toEqual(['Name', 'Code', 'Name 1']);
  });

  describe('"Use first row as headers" off (research/30 §9c)', () => {
    const imported = buildCsvImport(NEUTRAL, {
      untitled: 'Column',
      titleName: 'Name',
      newId: ids(),
      headers: false,
      targets: ['title', 'phone', 'text', 'text', 'status', 'select'],
    });

    it('names the title "Name" and every other column "Column N" by its position', () => {
      expect(imported.schema.map((p) => p.name)).toEqual(['Name', 'Column 2', 'Column 3', 'Column 4', 'Column 5', 'Column 6']);
    });

    it('imports the header line as the first row, keeping file order', () => {
      const title = imported.schema[0].id;

      expect(imported.rows.map((row) => row[title])).toEqual(['Title', 'Alpha', 'Bravo', 'Charlie']);
      expect(imported.rows[0][imported.schema[2].id]).toBe('Status');
    });

    it('keeps the chosen types, and the header\'s value becomes the first Select option', () => {
      expect(imported.schema.map((p) => p.type)).toEqual(['title', 'phone', 'text', 'text', 'status', 'select']);
      expect(imported.schema[5].config?.options.map((o) => o.label)).toEqual(['Tags', 'red', 'blue']);
    });

    it('lists the columns as "Column N" while detection still reads the rows below the header line', () => {
      expect(csvColumns(NEUTRAL, 'Column', false)).toEqual([
        { name: 'Column 1', detected: 'title' },
        { name: 'Column 2', detected: 'phone' },
        { name: 'Column 3', detected: 'text' },
        { name: 'Column 4', detected: 'text' },
        { name: 'Column 5', detected: 'text' },
        { name: 'Column 6', detected: 'text' },
      ]);
    });
  });

  describe('Person and Status mapped by hand (research/30 §9d)', () => {
    const imported = buildCsvImport(DETECT, { untitled: 'Column', newId: ids(), targets: ['title', 'date', 'phone', 'person', 'status', 'number'] });
    const [, , , owner, state] = imported.schema;

    it('drops Person values: a name or an email cannot name a person, as in Notion', () => {
      expect(owner.type).toBe('person');
      expect(imported.rows.map((row) => row[owner.id])).toEqual([[], [], []]);
    });

    // Deliberate deviation: Notion dropped every Status value and left the property with no options or groups.
    // As with any change from text to Status, the new options carry no group, so they read as the first group (To-do).
    it('keeps Status values as options, in the first status group', () => {
      expect(state.type).toBe('status');
      expect(state.config?.options.map((o) => o.label)).toEqual(['Not started', 'In progress', 'Done']);
      expect(state.status?.groups[0]?.kind).toBe('todo');
      expect(state.config?.options.map((o) => o.groupId)).toEqual([undefined, undefined, undefined]);
      expect(imported.rows.map((row) => row[state.id])).toEqual(state.config?.options.map((o) => o.id));
    });
  });

  // research/30 §9e: "red" got Brown and "blue" got Red in Notion.
  it('does not colour a Select option after its name', () => {
    const result = buildCsvImport([['Name', 'Tags'], ['a', 'red'], ['b', 'blue'], ['c', 'green']], { untitled: 'Column', newId: ids(), targets: ['title', 'select'] });
    const colors = Object.fromEntries((result.schema[1].config?.options ?? []).map((o) => [o.label, o.color]));

    expect(colors.red).not.toBe('red');
    expect(colors.blue).not.toBe('blue');
    expect(colors.green).not.toBe('green');
  });

  describe('planCsvMerge', () => {
    const schema: PropertyDefinition[] = [
      { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'p-pts', name: 'Points', type: 'number', position: 'a1' },
      { id: 'p-tag', name: 'Tag', type: 'select', position: 'a2', config: { options: [{ id: 'o1', label: 'Red', position: 'a0' }] } },
    ];

    it.each([1, 11])('adds a column to a database imported from a CSV with %i columns', (count) => {
      // buildCsvImport keys its schema a0000, a0001, … and a0000 or a0010 ends in a zero.
      const headers = Array.from({ length: count }, (_, i) => `C${i}`);
      const imported = buildCsvImport([headers, headers.map(() => 'x')], { newId: ids(), untitled: 'Column' });
      const plan = planCsvMerge([['Brand new'], ['v']], imported.schema, { newId: ids() });
      const last = imported.schema.map((p) => p.position).sort().at(-1) ?? '';

      expect(plan.newProperties.map((p) => p.name)).toEqual(['Brand new']);
      expect(plan.newProperties[0].position > last).toBe(true);
    });

    it('only adds rows, even when a title already exists (research/05 §9.3)', () => {
      const plan = planCsvMerge([['Name', 'Points'], ['Write', '5']], schema, { newId: () => 'o-new' });

      expect(plan.rows).toEqual([{ 'p-title': 'Write', 'p-pts': 5 }]);
    });

    // research/30 §9f: "Extra" matched nothing and became a new Text property at the end.
    // research/31 §5b: "tag" matched "Tag", so the match ignores case.
    it('matches headers to property names in any case and adds the rest as new properties of their detected type', () => {
      const plan = planCsvMerge([['Name', 'points', 'Extra'], ['A', '1', 'x']], schema, { newId: ids() });

      expect(plan.rows).toEqual([{ 'p-title': 'A', 'p-pts': 1, [plan.newProperties[0].id]: 'x' }]);
      expect(plan.newProperties.map((p) => [p.name, p.type])).toEqual([['Extra', 'text']]);
      expect(plan.newProperties.every((p) => p.position > 'a2')).toBe(true);
      expect(plan.skippedColumns).toEqual([]);
    });

    it('matches a header in another case, also against the name this person reads', () => {
      const localized = schema.map((p) => (p.id === 'p-tag' ? { ...p, name: 'Etikett' } : p));

      expect(csvMergeTargets([['NAME', 'tag', 'etikett'], ['A', 'Red', 'Red']], schema, { localized }))
        .toEqual([{ property: 'p-title' }, { property: 'p-tag' }, { property: 'p-tag' }]);
    });

    // Not measured in Notion: two names differing only in case. The exact one wins, else the first in schema order.
    it('prefers the property whose name matches exactly, else the first in schema order', () => {
      const twins: PropertyDefinition[] = [
        { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-lo', name: 'tag', type: 'text', position: 'a1' },
        { id: 'p-up', name: 'Tag', type: 'text', position: 'a2' },
      ];

      expect(csvMergeTargets([['Name', 'Tag', 'tag', 'TAG'], ['A', 'x', 'y', 'z']], twins))
        .toEqual([{ property: 'p-name' }, { property: 'p-up' }, { property: 'p-lo' }, { property: 'p-lo' }]);
    });

    it('maps a column onto the existing property, a new type, or nowhere, as the targets say', () => {
      const plan = planCsvMerge([['Name', 'Due', 'Extra'], ['R1', 'Red', 'x']], schema, {
        newId: ids(),
        targets: [{ property: 'p-title' }, { property: 'p-tag' }, 'skip'],
      });

      expect(plan.newProperties).toEqual([]);
      expect(plan.rows).toEqual([{ 'p-title': 'R1', 'p-tag': 'o1' }]);
      expect(plan.skippedColumns).toEqual(['Extra']);
    });

    it('names a new property apart from an existing one, and builds a new Select from the values', () => {
      const plan = planCsvMerge([['Name', 'Tag'], ['A', 'x'], ['B', 'y']], schema, { newId: ids(), targets: [{ property: 'p-title' }, 'select'] });
      const [tag] = plan.newProperties;

      expect([tag.name, tag.type]).toEqual(['Tag 1', 'select']);
      expect(tag.config?.options.map((o) => o.label)).toEqual(['x', 'y']);
      expect(plan.rows.map((row) => row[tag.id])).toEqual(tag.config?.options.map((o) => o.id));
    });

    it('reads a new date column in the chosen format', () => {
      const plan = planCsvMerge([['Name', 'When'], ['A', '03/04/2026']], schema, { newId: ids(), dateFormats: [undefined, 'day_month_year'] });

      expect(plan.rows[0][plan.newProperties[0].id]).toBe('2026-04-03');
    });

    // research/35 §8: Notion offers a Person property under "Existing property".
    // research/30 §9d: names that are not workspace members are dropped.
    describe('into a Person property', () => {
      const withWho: PropertyDefinition[] = [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-who', name: 'Who', type: 'person', position: 'a1' },
      ];
      const people = [
        { id: 'u1', name: 'Ada' },
        { id: 'u2', name: 'Grace' },
        { id: 'u3', name: 'Sam' },
        { id: 'u4', name: 'Sam' },
        { id: 'u5', name: 'Lovelace, Ada' },
      ];
      const file = parseCsv(readFileSync(resolve(__dirname, 'fixtures/merge-people.csv'), 'utf-8'));

      it('maps a header naming the Person property onto it', () => {
        expect(csvMergeTargets(file, withWho)).toEqual([{ property: 'p-title' }, { property: 'p-who' }]);
      });

      it('fills each cell with the directory people it names, and drops every name it cannot match to one person', () => {
        const plan = planCsvMerge(file, withWho, { newId: ids(), people });

        expect(plan.rows.map((row) => [row['p-title'], row['p-who']])).toEqual([
          ['Alpha', [{ id: 'u1' }]],
          ['Bravo', [{ id: 'u1' }, { id: 'u2' }]],
          // Not a member.
          ['Charlie', []],
          // Two people share the name: neither is picked.
          ['Delta', []],
          ['Echo', []],
          // A name with a comma stays one name.
          ['Foxtrot', [{ id: 'u5' }]],
          // Case is not measured: only the exact name matches.
          ['Golf', []],
        ]);
        expect(plan.newProperties).toEqual([]);
      });

      it('leaves every cell empty without a people directory', () => {
        const plan = planCsvMerge(file, withWho, { newId: ids() });

        expect(plan.rows.every((row) => Array.isArray(row['p-who']) && row['p-who'].length === 0)).toBe(true);
      });
    });

    it('defaults each column: a matching property, else its detected type; a computed match is not imported', () => {
      const withFormula: PropertyDefinition[] = [...schema, { id: 'p-f', name: 'Total', type: 'formula', position: 'a3' }];

      expect(csvMergeTargets([['Name', 'Points', 'Total', 'When'], ['A', '1', '2', '2026-03-04']], withFormula))
        .toEqual([{ property: 'p-title' }, { property: 'p-pts' }, 'skip', 'date']);
    });

    it('without a header line, names the columns "Column N" and matches none of them', () => {
      expect(csvMergeTargets([['Name', 'Points'], ['A', '1']], schema, { headers: false, untitled: 'Column' })).toEqual(['text', 'number']);
    });

    // Not measured in Notion: repeated headers are numbered as on import, so a file merges into the database it made.
    it('matches repeated headers to the numbered properties an import makes, keeping every column', () => {
      const tags: PropertyDefinition[] = [
        { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-t', name: 'Tag', type: 'text', position: 'a1' },
        { id: 'p-t1', name: 'Tag 1', type: 'text', position: 'a2' },
        { id: 'p-t2', name: 'Tag 2', type: 'text', position: 'a3' },
      ];

      expect(planCsvMerge([['Name', 'Tag', 'Tag', 'Tag'], ['C', 'c1', 'c2', 'c3']], tags, { newId: () => 'o-new' }).rows)
        .toEqual([{ 'p-name': 'C', 'p-t': 'c1', 'p-t1': 'c2', 'p-t2': 'c3' }]);
      expect(planCsvMerge([['Name', 'Tag 1', 'Tag'], ['C', 'x', 'y']], tags, { newId: () => 'o-new' }).rows)
        .toEqual([{ 'p-name': 'C', 'p-t1': 'x', 'p-t': 'y' }]);
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

    it('writes a place as its name or address and reads the text back as an address', () => {
      const place: PropertyDefinition = { id: 'pl', name: 'Where', type: 'place', position: 'a' };

      expect(csvCellText(place, { name: 'Office', address: '1 Main St', lat: 1, lon: 2 }, ctx)).toBe('Office');
      expect(roundTrip(place, { address: '1 Main St' })).toEqual({ address: '1 Main St' });
      expect(roundTrip(place, null)).toBeNull();
    });

    it('writes a verification as its status and never imports one', () => {
      const verification: PropertyDefinition = { id: 'v', name: 'Verified', type: 'verification', position: 'a' };

      expect(csvCellText(verification, { state: 'verified' }, ctx)).toBe('verified');
      expect(csvCellText(verification, { state: 'verified', expiresAt: '2000-01-01' }, ctx)).toBe('expired');
      expect(roundTrip(verification, { state: 'verified' })).toBeUndefined();
    });

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
      // Short date drops this year's year ("Oct 9"): it would read back as another year.
      const thisYear = `${new Date().getFullYear()}-03-04`;

      expect(roundTrip({ ...date, date: { dateFormat: 'short' } }, thisYear)).toBe(thisYear);
      expect(csvCellText({ ...date, date: { dateFormat: 'short' } }, thisYear, ctx)).toContain(String(new Date().getFullYear()));
      // A past year shows no year either (research/26 §5e).
      expect(roundTrip({ ...date, date: { dateFormat: 'short' } }, '2025-03-04')).toBe('2025-03-04');
      expect(roundTrip({ ...date, date: { dateFormat: 'short' } }, '2025-03-04T15:30')).toBe('2025-03-04T15:30');
      // And a future one (research/27 §4a).
      expect(roundTrip({ ...date, date: { dateFormat: 'short' } }, '2027-03-04')).toBe('2027-03-04');
      expect(roundTrip({ ...date, date: { dateFormat: 'short' } }, '2027-03-04T15:30')).toBe('2027-03-04T15:30');
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
