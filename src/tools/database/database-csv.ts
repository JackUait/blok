import type { BodyBlock } from './row-body';
import { formatDateDisplay, toIsoDay, toIsoTime } from './cells/date-format';
import { filesOf, personIdsOf } from './property-values';
import { isOutputData, placeText, verificationStatus } from './tier3-values';

import type { DatabaseData, DatabaseRowData, DateFormat, PropertyDefinition, PropertyType, PropertyValue, SelectOption } from './types';
import { htmlToPlainText } from '../../components/utils/plain-text';
import { generateNKeysBetween } from '../../shared/database/fractional-index';
import { freePropertyName, newView } from '../../shared/database/schema-ops';
import { positionBetween } from '../../shared/database/positions';
import { planTypeChange } from './property-conversion';

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
  /** A related row's title, for relation values and page refs in computed values. */
  rowTitle?: (id: string) => string | undefined;
}

const isRef = (item: unknown): item is { id: string } =>
  typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string';

/** A relation, formula or rollup value: page refs become titles, the rest prints plainly. */
const computedText = (value: PropertyValue | undefined, ctx: CsvTextContext): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (Array.isArray(value)) {
    return (value as unknown[])
      .map((item) => (isRef(item) ? ctx.rowTitle?.(item.id) ?? item.id : String(item)))
      .join(', ');
  }

  return '';
};

const bodyText = (value: PropertyValue | undefined): string => {
  const blocks: unknown = isOutputData(value) ? value.blocks : undefined;

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
    // The bare number: a currency or percent display would not read back.
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    // A relative date ("Today") or a short one ("Oct 9", no year) would not read back, so it writes the full date.
    case 'date':
    case 'createdTime':
    case 'lastEditedTime': {
      const format = property.date?.dateFormat;

      return formatDateDisplay(value, ctx.locale, { ...property.date, ...(format === 'relative' || format === 'short' ? { dateFormat: 'full' } : {}) }) ?? '';
    }
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
    case 'place':
      return placeText(value);
    case 'verification':
      return value === null || value === undefined ? '' : verificationStatus(value);
    case 'relation':
    case 'formula':
    case 'rollup':
      return computedText(value, ctx);
    // A button holds no value.
    case 'button':
      return '';
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
const PHONE = /^\+?[\d\s()-]+$/;

const isNumber = (text: string): boolean => text !== '' && text !== '-' && NUMBER.test(text);

/** Seven or more digits with phone punctuation. It runs after Number and Date, which claim bare digits and ISO days. */
const isPhone = (text: string): boolean => PHONE.test(text) && (text.match(/\d/g) ?? []).length >= 7;

const ISO_DAY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** Blok's English date display, as an export writes it: "October 9, 2026", maybe with a time. */
const WRITTEN_DAY = /^[A-Za-z]{3,9}\.? \d{1,2}, \d{4}(,? \d{1,2}:\d{2}( ?[AP]M)?)?$/i;

/**
 * How a "03/04/2026" cell reads: month first, day first, or not at all.
 * research/30 §9b: the import's date format picks it, and Year/Month/Day leaves such cells empty.
 */
const slashDay = (match: RegExpExecArray, format: DateFormat | undefined): string | null => {
  if (format === 'year_month_day') return null;
  const [month, day] = format === 'day_month_year' ? [match[2], match[1]] : [match[1], match[2]];

  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;

  return `${match[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

/** One date: `YYYY-MM-DD`, Notion's import format MM/DD/YYYY (research/05 §9.3), or written out. */
const toDatePart = (text: string, format?: DateFormat): string | null => {
  if (ISO_DAY.test(text) || ISO_DAY_TIME.test(text)) return text;
  const us = US_DAY.exec(text);

  if (us !== null) return slashDay(us, format);
  const time = Date.parse(text);

  if (Number.isNaN(time) || !/\d{4}/.test(text)) return null;
  const date = new Date(time);

  return /\d:\d{2}/.test(text) ? `${toIsoDay(date)}T${toIsoTime(date)}` : toIsoDay(date);
};

/** A date or a range, as the date property stores it. A range is written "start → end". */
const toDay = (text: string, format?: DateFormat): string | null => {
  const parts = text.split('→').map((part) => toDatePart(part.trim(), format));

  return parts.length > 2 || parts.some((part) => part === null) ? null : parts.join('/');
};

const isDay = (text: string): boolean => text.split('→').every((part) => {
  const trimmed = part.trim();

  return ISO_DAY.test(trimmed) || ISO_DAY_TIME.test(trimmed) || US_DAY.test(trimmed) || WRITTEN_DAY.test(trimmed);
});

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
    // research/30 §9a: by the values, never the header. Person and Status are never guessed.
    ['phone', isPhone],
  ];

  return checks.find(([, test]) => filled.every(test))?.[0] ?? 'text';
};

/** A cell's text as a stored value. Types with no text form (people, files, computed) give undefined. */
const parseCell = (property: PropertyDefinition, raw: string, dateFormat?: DateFormat): PropertyValue | undefined => {
  const text = raw.trim();

  switch (property.type) {
    case 'number':
      return isNumber(text) ? Number(text.replace(/,/g, '')) : null;
    case 'checkbox':
      return YES.test(text);
    case 'date':
      return text === '' ? null : toDay(text, dateFormat);
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return raw;
    // Text names a place but holds no coordinates; the host geocodes it.
    case 'place':
      return text === '' ? null : { address: text };
    case 'verification':
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
    // Computed types are worked out from other rows, and a relation's titles cannot name a row id.
    case 'relation':
    case 'formula':
    case 'rollup':
    case 'button':
    default:
      return undefined;
  }
};

/** The "Setup CSV columns" switches beside the per-column targets. */
export interface CsvImportSettings {
  headers: boolean;
  dateFormats: Array<DateFormat | undefined>;
}

/** Where a CSV column goes: nowhere, the title, or a new property of a type. */
export type CsvColumnTarget = 'skip' | PropertyType;

export interface CsvImportOptions {
  newId: () => string;
  /** The name a blank header gets, numbered by its column. */
  untitled: string;
  /** One target per column. Without it every column takes its detected type. */
  targets?: CsvColumnTarget[];
  /** The title's name when no column maps to it, or when the file has no header line. */
  titleName?: string;
  /** False: the first line is a row, and columns are named "Column N" (research/30 §9c). Default true. */
  headers?: boolean;
  /** How each date column's text is read (research/30 §9b). Month first when unset. */
  dateFormats?: Array<DateFormat | undefined>;
}

export interface CsvImport {
  schema: PropertyDefinition[];
  /** Row values by property id, in file order. */
  rows: Array<Record<string, PropertyValue>>;
}

export interface CsvColumn {
  name: string;
  /** The first column is the title; the rest are inferred from their cells. */
  detected: PropertyType;
}

const position = (index: number): string => `a${String(index).padStart(4, '0')}`;

/**
 * Repeated headers become "Tag", "Tag 1", "Tag 2", as Notion's import does
 * (research/21 §4). Merge numbers them the same way, so a file merges back
 * into the database it made.
 */
const numberedHeaders = (headers: string[]): string[] =>
  headers.reduce<string[]>((names, header) => [...names, freePropertyName(names, header)], []);

/** Each column's name and detected type, as the "Setup CSV columns" step lists them. */
export const csvColumns = (table: string[][], untitled = 'Column', headers = true): CsvColumn[] => {
  const [header = [], ...body] = table;
  const width = Math.max(header.length, ...body.map((row) => row.length), 1);
  const names = numberedHeaders(Array.from({ length: width }, (_, column) => {
    const typed = headers ? (header[column] ?? '').trim() : '';

    return typed === '' ? `${untitled} ${column + 1}` : typed;
  }));

  return names.map((name, column) => ({
    name,
    detected: column === 0 ? 'title' : inferColumnType(body.map((row) => row[column] ?? '')),
  }));
};

/** Types whose values come from text through the type-change rules: options in first-appearance order. */
const CONVERTED_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['select', 'multiSelect', 'status', 'person']);

/** A new database from a CSV: the first row names the columns. Columns and rows keep file order. */
export const buildCsvImport = (table: string[][], options: CsvImportOptions): CsvImport => {
  const headers = options.headers !== false;
  const body = headers ? table.slice(1) : table;
  const columns = csvColumns(table, options.untitled, headers);
  const wanted = columns.map((column, index) => options.targets?.[index] ?? column.detected);
  // One title: the first column that asks for it.
  const titleAt = wanted.indexOf('title');
  const demoted = (index: number): CsvColumnTarget => (columns[index].detected === 'title' ? 'text' : columns[index].detected);
  const targets = wanted.map((target, index) => (target === 'title' && index !== titleAt ? demoted(index) : target));
  const kept = columns.flatMap((column, index) => {
    const type = targets[index];

    return type === 'skip' ? [] : [{ column: index, name: column.name, type }];
  });
  const titleName = options.titleName ?? 'Name';
  // research/30 §9c: without a header line the title keeps its own name. §9a: so does a title headed "Title".
  const named = kept.map((field) => (field.type === 'title' && (!headers || field.name === 'Title') ? { ...field, name: titleName } : field));
  const titled: Array<{ column: number; name: string; type: PropertyType }> = titleAt === -1 ? [{ column: -1, name: titleName, type: 'title' }, ...named] : named;
  // The title keeps its name; another column that has it takes "Name 1".
  const titleNames = titled.filter((field) => field.type === 'title').map((field) => field.name);
  const fields = titled.reduce<typeof titled>((list, field) => [
    ...list,
    field.type === 'title' ? field : { ...field, name: freePropertyName([...titleNames, ...list.map((f) => f.name)], field.name) },
  ], []);
  const schema: PropertyDefinition[] = fields.map((field, index) => ({
    id: options.newId(),
    name: field.name,
    type: CONVERTED_TYPES.has(field.type) ? 'text' : field.type,
    position: position(index),
  }));
  const rows = body.map((row) => Object.fromEntries(schema.map((property, index) => {
    const raw = fields[index].column === -1 ? '' : row[fields[index].column] ?? '';

    return [property.id, parseCell(property, raw, options.dateFormats?.[fields[index].column]) ?? null];
  })));
  const ordered = rows.map((properties, index) => ({ id: String(index), position: position(index), properties }));
  const finished = schema.map((property, index) => {
    const type = fields[index].type;
    const plan = CONVERTED_TYPES.has(type) ? planTypeChange(property, type, ordered, options.newId) : null;

    if (plan === null) return property;
    for (const write of plan.writes) rows[Number(write.rowId)][property.id] = write.value;

    return plan.property;
  });

  return { schema: finished, rows };
};

export interface CsvMergePlan {
  rows: Array<Record<string, PropertyValue>>;
  /** Headers set to "Don't import", so their cells are dropped. */
  skippedColumns: string[];
  /** Select options to add, by property id. */
  newOptions: Record<string, Array<Pick<SelectOption, 'id' | 'label'>>>;
  /** Properties to add at the end, for the columns that go to a new property, in CSV order. */
  newProperties: PropertyDefinition[];
}

/** Where a merged CSV column goes: nowhere, an existing property, or a new property of a type. */
export type CsvMergeTarget = CsvColumnTarget | { property: string };

/** Types a merged column can fill from text. A person comes from a name in the people directory; computed and file values have no text form. */
const MERGEABLE_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'title', 'text', 'number', 'checkbox', 'date', 'url', 'email', 'phone', 'place', 'select', 'multiSelect', 'status', 'person',
]);

export const isMergeableProperty = (property: PropertyDefinition): boolean => MERGEABLE_TYPES.has(property.type);

export interface CsvMergeOptions {
  /** The schema as this person reads it: an export writes localized names and labels. */
  localized?: PropertyDefinition[];
  /** False: the first line is a row and the columns are "Column N" (research/30 §9c). Default true. */
  headers?: boolean;
  untitled?: string;
  /** The host's people directory: a Person cell's names become these people. */
  people?: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * Each column's default on merge (research/30 §9f): the property its header
 * names, else a new property of the detected type. A header that names a
 * property no text can fill is not imported.
 */
export const csvMergeTargets = (table: string[][], schema: PropertyDefinition[], options: CsvMergeOptions = {}): CsvMergeTarget[] => {
  // Detection reads the rows below the first line either way, as csvColumns does.
  const body = table.slice(1);
  const shown = (property: PropertyDefinition): PropertyDefinition | undefined => options.localized?.find((p) => p.id === property.id);
  const named = (property: PropertyDefinition, same: (name: string) => boolean): boolean =>
    [property.name, shown(property)?.name].some((name) => name !== undefined && same(name));

  return csvColumns(table, options.untitled, options.headers !== false).map((column, index): CsvMergeTarget => {
    const lower = column.name.toLowerCase();
    // Case is ignored (research/31 §5b). Names differing only in case are unmeasured: exact wins, else schema order.
    const property = schema.find((p) => named(p, (name) => name === column.name))
      ?? schema.find((p) => named(p, (name) => name.toLowerCase() === lower));

    if (property !== undefined) return isMergeableProperty(property) ? { property: property.id } : 'skip';

    return column.detected === 'title' ? inferColumnType(body.map((row) => row[index] ?? '')) : column.detected;
  });
};

/**
 * A multi-select cell's labels. The export joins them with ", ", so a comma
 * inside a known label keeps its pieces together.
 */
const splitLabels = (text: string, isKnown: (label: string) => boolean): string[] => {
  const parts = text.split(',');
  const labels: string[] = [];

  for (const cursor = { i: 0 }; cursor.i < parts.length;) {
    const end = [...parts.keys()].reverse().find((j) => j >= cursor.i && isKnown(parts.slice(cursor.i, j + 1).join(',').trim())) ?? cursor.i;

    labels.push(parts.slice(cursor.i, end + 1).join(',').trim());
    cursor.i = end + 1;
  }

  return labels.filter((label) => label !== '');
};

/**
 * Merge with CSV: every CSV row becomes a new row. Notion never updates an
 * existing row here (research/05 §9.3, research/30 §9f), so neither does Blok.
 * A column with no property becomes a new one at the end (§9f "Extra").
 */
export const planCsvMerge = (
  table: string[][],
  schema: PropertyDefinition[],
  options: CsvMergeOptions & {
    newId: () => string;
    /** One target per column. Without it, csvMergeTargets. */
    targets?: CsvMergeTarget[];
    /** How each new date column's text is read (research/30 §9b). */
    dateFormats?: Array<DateFormat | undefined>;
  }
): CsvMergePlan => {
  const headers = options.headers !== false;
  const body = headers ? table.slice(1) : table;
  const columns = csvColumns(table, options.untitled, headers);
  const defaults = csvMergeTargets(table, schema, options);
  const titleId = schema.find((p) => p.type === 'title')?.id;
  const targets = columns.map((_, index): CsvMergeTarget => {
    const target = options.targets?.[index] ?? defaults[index];

    if (target !== 'title') return target;

    // One title per database: a new title means the existing one.
    return titleId === undefined ? 'skip' : { property: titleId };
  });
  const shown = (property: PropertyDefinition): PropertyDefinition | undefined => options.localized?.find((p) => p.id === property.id);
  const newOptions: CsvMergePlan['newOptions'] = {};
  const knownOption = (property: PropertyDefinition, label: string): SelectOption | undefined => {
    const localizedLabel = (id: string): string | undefined => shown(property)?.config?.options.find((option) => option.id === id)?.label;

    return property.config?.options.find((option) => option.label === label || localizedLabel(option.id) === label);
  };
  const optionId = (property: PropertyDefinition, label: string): string => {
    const known = knownOption(property, label) ?? newOptions[property.id]?.find((option) => option.label === label);

    if (known !== undefined) return known.id;
    const created = { id: options.newId(), label };

    newOptions[property.id] = [...(newOptions[property.id] ?? []), created];

    return created.id;
  };
  const valueOf = (property: PropertyDefinition, raw: string): PropertyValue | undefined => {
    const text = raw.trim();

    if (property.type === 'select') return text === '' ? null : optionId(property, text);
    if (property.type === 'multiSelect') return splitLabels(text, (label) => knownOption(property, label) !== undefined).map((label) => optionId(property, label));
    // Status options sit in status groups; an unknown label has no group to go in.
    if (property.type === 'status') return knownOption(property, text)?.id ?? null;
    // research/30 §9d: a name that is not a member is dropped. A name two people share is dropped too: picking one would guess.
    if (property.type === 'person') {
      const named = (label: string): Array<{ id: string }> => (options.people ?? []).filter((person) => person.name === label);
      const ids = splitLabels(text, (label) => named(label).length > 0).flatMap((label) => {
        const matches = named(label);

        return matches.length === 1 ? [matches[0].id] : [];
      });

      return [...new Set(ids)].map((id) => ({ id }));
    }

    return parseCell(property, raw);
  };
  const lastPosition = [...schema].sort((a, b) => (a.position < b.position ? -1 : 1)).at(-1)?.position ?? null;
  const names = schema.map((p) => p.name);
  const fresh = targets.flatMap((target, column) => (typeof target === 'string' && target !== 'skip' ? [{ column, type: target }] : []));
  const positions = fresh.reduce<string[]>((list) => [...list, positionBetween(list.at(-1) ?? lastPosition, null)], []);
  const added = fresh.map((field, index) => {
    const name = freePropertyName(names, columns[field.column].name);
    const property: PropertyDefinition = { id: options.newId(), name, type: CONVERTED_TYPES.has(field.type) ? 'text' : field.type, position: positions[index] };

    names.push(name);

    return { ...field, property };
  });
  const newAt = new Map(added.map((field) => [field.column, field.property]));
  const rows = body.map((row) => Object.fromEntries(targets.flatMap((target, column) => {
    const raw = row[column] ?? '';
    const fresh = newAt.get(column);

    if (fresh !== undefined) return [[fresh.id, parseCell(fresh, raw, options.dateFormats?.[column]) ?? null]];
    const property = typeof target === 'string' ? undefined : schema.find((p) => p.id === target.property);
    const value = property === undefined ? undefined : valueOf(property, raw);

    return property === undefined || value === undefined ? [] : [[property.id, value]];
  })));
  const ordered = rows.map((properties, index) => ({ id: String(index), position: position(index), properties }));
  const newProperties = added.map((field) => {
    const plan = CONVERTED_TYPES.has(field.type) ? planTypeChange(field.property, field.type, ordered, options.newId) : null;

    if (plan === null) return field.property;
    for (const write of plan.writes) rows[Number(write.rowId)][field.property.id] = write.value;

    return plan.property;
  });

  return {
    rows,
    skippedColumns: columns.filter((_, column) => targets[column] === 'skip').map((column) => column.name),
    newOptions,
    newProperties,
  };
};

/**
 * Pasted text read as a table: two or more rows of the same two or more
 * columns. Anything else is prose and stays as paragraphs.
 */
export const pastedTable = (text: string): string[][] | null => {
  const table = parseCsv(text);
  const width = table[0]?.length ?? 0;

  return table.length >= 2 && width >= 2 && table.every((row) => row.length === width) ? table : null;
};

export interface CsvDatabaseBlocks {
  id: string;
  data: DatabaseData;
  rows: Array<{ id: string; data: DatabaseRowData }>;
}

/** A whole database from a CSV table: the database block's data and its row blocks, ready to insert. */
export const csvDatabaseBlocks = (
  table: string[][],
  options: CsvImportOptions & { viewName: string; title: string }
): CsvDatabaseBlocks => {
  const id = options.newId();
  const imported = buildCsvImport(table, options);
  const titleProperty = imported.schema.find((property) => property.type === 'title');
  const viewId = options.newId();
  const positions = generateNKeysBetween(null, null, imported.rows.length);

  return {
    id,
    data: {
      title: options.title,
      schema: imported.schema,
      views: [newView({ id: viewId, name: options.viewName, type: 'table', position: 'a0' }, imported.schema)],
      activeViewId: viewId,
    },
    rows: imported.rows.map((properties, index) => {
      const title = titleProperty === undefined ? undefined : properties[titleProperty.id];

      return {
        id: options.newId(),
        data: { properties, position: positions[index], title: typeof title === 'string' ? title : '' },
      };
    }),
  };
};
