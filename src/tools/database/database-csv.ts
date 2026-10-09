import type { BodyBlock } from './row-body';
import { formatDateDisplay, toIsoDay } from './cells/date-format';
import { formatNumberValue } from './cells/number-format';
import { filesOf, personIdsOf } from './property-values';
import type { PropertyDefinition, PropertyType, PropertyValue, SelectOption } from './types';
import { htmlToPlainText } from '../../components/utils/plain-text';

const BOM = '﻿';

const delimiterOf = (text: string): ',' | '\t' => {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const count = (char: string): number => firstLine.split(char).length - 1;

  return count('\t') > count(',') ? '\t' : ',';
};

/**
 * RFC 4180 CSV, or tab-separated text when the first line has more tabs than
 * commas. A leading BOM is dropped; trailing blank lines are dropped.
 */
export const parseCsv = (input: string): string[][] => {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  const state = { row: [] as string[], cell: '', quoted: false };
  const endCell = (): void => {
    state.row.push(state.cell);
    state.cell = '';
  };
  const endRow = (): void => {
    endCell();
    rows.push(state.row);
    state.row = [];
  };
  /** One character; returns how many extra characters it used. */
  const quotedChar = (char: string, next: string | undefined): number => {
    if (char !== '"') {
      state.cell += char;

      return 0;
    }
    if (next === '"') {
      state.cell += '"';

      return 1;
    }
    state.quoted = false;

    return 0;
  };
  const plainChar = (char: string, next: string | undefined): number => {
    if (char === '"' && state.cell === '') {
      state.quoted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\n' || char === '\r') {
      endRow();

      return char === '\r' && next === '\n' ? 1 : 0;
    } else {
      state.cell += char;
    }

    return 0;
  };

  const step = (i: number): number => i + 1 + (state.quoted ? quotedChar(text[i], text[i + 1]) : plainChar(text[i], text[i + 1]));

  for (const cursor = { i: 0 }; cursor.i < text.length; cursor.i = step(cursor.i)) {
    // Each step reads one character, or two for an escaped quote or CRLF.
  }
  if (state.cell !== '' || state.row.length > 0) endRow();

  const isBlank = (row: string[]): boolean => row.length === 1 && row[0] === '';

  while (rows.length > 0 && isBlank(rows[rows.length - 1])) rows.pop();

  return rows;
};

const quote = (cell: string): string => (/[",\r\n\t]|^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** CSV with a BOM, so spreadsheet apps read it as UTF-8, and CRLF line ends (RFC 4180). */
export const serializeCsv = (rows: string[][]): string =>
  BOM + rows.map((row) => row.map(quote).join(',')).join('\r\n');

export interface CsvTextContext {
  locale: string;
  /** A person's display name, from the host's people directory. */
  personName?: (id: string) => string | undefined;
}

const bodyText = (value: PropertyValue | undefined): string => {
  const blocks: unknown = typeof value === 'object' && value !== null && !Array.isArray(value) ? value.blocks : undefined;

  if (!Array.isArray(blocks)) return '';

  return blocks
    .map((block: BodyBlock) => {
      const text = (block.data as { text?: unknown } | undefined)?.text;

      return typeof text === 'string' ? htmlToPlainText(text).trim() : '';
    })
    .filter((line) => line !== '')
    .join('\n');
};

/** A cell value as text, the way the view shows it. Checkboxes write Yes or No. */
export const csvCellText = (property: PropertyDefinition, value: PropertyValue | undefined, ctx: CsvTextContext): string => {
  switch (property.type) {
    case 'select':
    case 'multiSelect':
    case 'status': {
      const options = property.config?.options ?? [];

      return personIdsOf(value ?? null)
        .map((id) => options.find((option) => option.id === id)?.label)
        .filter((label): label is string => label !== undefined)
        .join(', ');
    }
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    case 'number':
      return typeof value === 'number' ? formatNumberValue(value, property.number ?? {}, ctx.locale) : '';
    case 'date':
    case 'createdTime':
    case 'lastEditedTime':
      return formatDateDisplay(value, ctx.locale, property.date) ?? '';
    case 'person':
    case 'createdBy':
    case 'lastEditedBy':
      return personIdsOf(value ?? null).map((id) => ctx.personName?.(id) ?? id).join(', ');
    case 'files':
      return filesOf(value).map((file) => file.url).join(', ');
    case 'uniqueId': {
      const prefix = property.uniqueId?.prefix;

      return typeof value === 'number' ? `${prefix !== undefined && prefix !== '' ? `${prefix}-` : ''}${value}` : '';
    }
    case 'richText':
      return typeof value === 'string' ? value : bodyText(value);
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
};

const NUMBER = /^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/;
const YES = /^(yes|true)$/i;
const NO = /^(no|false)$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const US_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const URL = /^https?:\/\/\S+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isNumber = (text: string): boolean => text !== '' && text !== '-' && NUMBER.test(text);

/** `YYYY-MM-DD`, or Notion's import format MM/DD/YYYY (research/05 §9.3). */
const toDay = (text: string): string | null => {
  if (ISO_DAY.test(text)) return text;
  const us = US_DAY.exec(text);

  if (us !== null) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const time = Date.parse(text);

  return Number.isNaN(time) || !/\d{4}/.test(text) ? null : toIsoDay(new Date(time));
};

const isDay = (text: string): boolean => ISO_DAY.test(text) || US_DAY.test(text);

/**
 * A column's type from its cells. Every filled cell must agree, else text:
 * Notion imports mixed columns as text (research/05 §9.3). The per-type
 * rules beyond that are Blok's own; Notion's are unverified.
 */
export const inferColumnType = (cells: string[]): PropertyType => {
  const filled = cells.map((cell) => cell.trim()).filter((cell) => cell !== '');

  if (filled.length === 0) return 'text';
  const checks: Array<[PropertyType, (text: string) => boolean]> = [
    ['number', isNumber],
    ['checkbox', (text) => YES.test(text) || NO.test(text)],
    ['date', isDay],
    ['url', (text) => URL.test(text)],
    ['email', (text) => EMAIL.test(text)],
  ];

  return checks.find(([, test]) => filled.every(test))?.[0] ?? 'text';
};

/** A cell's text as a stored value. Types with no text form (people, files, computed) give undefined. */
const parseCell = (property: PropertyDefinition, raw: string): PropertyValue | undefined => {
  const text = raw.trim();

  switch (property.type) {
    case 'number':
      return isNumber(text) ? Number(text.replace(/,/g, '')) : null;
    case 'checkbox':
      return YES.test(text);
    case 'date':
      return text === '' ? null : toDay(text);
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return raw;
    case 'select':
    case 'multiSelect':
    case 'status':
    case 'richText':
    case 'person':
    case 'files':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
    default:
      return undefined;
  }
};

export interface CsvImportOptions {
  newId: () => string;
  /** The name a blank header gets, numbered by its column. */
  untitled: string;
}

export interface CsvImport {
  schema: PropertyDefinition[];
  /** Row values by property id, in file order. */
  rows: Array<Record<string, PropertyValue>>;
}

const position = (index: number): string => `a${String(index).padStart(4, '0')}`;

/** A new database from a CSV: the first row names the columns, the first column is the title. */
export const buildCsvImport = (table: string[][], options: CsvImportOptions): CsvImport => {
  const [header = [], ...body] = table;
  const width = Math.max(header.length, ...body.map((row) => row.length), 1);
  const schema: PropertyDefinition[] = Array.from({ length: width }, (_, column) => {
    const name = (header[column] ?? '').trim();

    return {
      id: options.newId(),
      name: name === '' ? `${options.untitled} ${column + 1}` : name,
      type: column === 0 ? 'title' : inferColumnType(body.map((row) => row[column] ?? '')),
      position: position(column),
    };
  });
  const rows = body.map((row) => Object.fromEntries(schema.map((property, column) =>
    [property.id, parseCell(property, row[column] ?? '') ?? null])));

  return { schema, rows };
};

export interface CsvMergePlan {
  rows: Array<Record<string, PropertyValue>>;
  /** Headers that name no property, so their cells are dropped. */
  skippedColumns: string[];
  /** Select options to add, by property id. */
  newOptions: Record<string, Array<Pick<SelectOption, 'id' | 'label'>>>;
}

/**
 * Merge with CSV: headers must match property names exactly, and every CSV
 * row becomes a new row. Notion never updates an existing row here
 * (research/05 §9.3), so neither does Blok.
 */
export const planCsvMerge = (
  table: string[][],
  schema: PropertyDefinition[],
  options: { newId: () => string }
): CsvMergePlan => {
  const [header = [], ...body] = table;
  const columns = header.map((name) => schema.find((property) => property.name === name));
  const newOptions: CsvMergePlan['newOptions'] = {};
  const optionId = (property: PropertyDefinition, label: string): string => {
    const known = property.config?.options.find((option) => option.label === label)
      ?? newOptions[property.id]?.find((option) => option.label === label);

    if (known !== undefined) return known.id;
    const created = { id: options.newId(), label };

    newOptions[property.id] = [...(newOptions[property.id] ?? []), created];

    return created.id;
  };
  const valueOf = (property: PropertyDefinition, raw: string): PropertyValue | undefined => {
    const text = raw.trim();

    if (property.type === 'select') return text === '' ? null : optionId(property, text);
    if (property.type === 'multiSelect') return text.split(',').map((part) => part.trim()).filter((part) => part !== '').map((label) => optionId(property, label));
    // Status options sit in status groups; an unknown label has no group to go in.
    if (property.type === 'status') return property.config?.options.find((option) => option.label === text)?.id ?? null;

    return parseCell(property, raw);
  };
  const rows = body.map((row) => Object.fromEntries(columns.flatMap((property, column) => {
    const value = property === undefined ? undefined : valueOf(property, row[column] ?? '');

    return property === undefined || value === undefined ? [] : [[property.id, value]];
  })));

  return {
    rows,
    skippedColumns: header.filter((_, column) => columns[column] === undefined),
    newOptions,
  };
};
