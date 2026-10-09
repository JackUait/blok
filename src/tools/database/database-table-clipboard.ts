import { parseUntrustedHtml } from '../../components/utils/inert-html';
import { parseDateValue } from './cells/date-value';
import { personIdsOf } from './property-values';
import type { PropertyDefinition, PropertyValue } from './types';

/**
 * Table cells as clipboard text: TSV for spreadsheets and plain fields,
 * an HTML table for rich targets. Values travel as their display text, so
 * a select copies its label, never its option id.
 */

const TRUE_WORDS: ReadonlySet<string> = new Set(['true', 'yes', '1', 'x', '✓', '✔', 'checked']);

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A TSV field: quoted when it holds a tab, a line break or a quote, as spreadsheets write it. */
const tsvField = (text: string): string =>
  /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** The text a cell copies as. */
export const cellText = (property: PropertyDefinition, value: PropertyValue | undefined): string => {
  // A checkbox with no value is unchecked.
  if (property.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }
  if (value === null || value === undefined) {
    return '';
  }
  const options = property.config?.options ?? [];
  const labelOf = (id: string): string => options.find((option) => option.id === id)?.label ?? '';

  switch (property.type) {
    case 'select':
    case 'status':
      return typeof value === 'string' ? labelOf(value) : '';
    case 'multiSelect':
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').map(labelOf).filter((label) => label !== '').join(', ') : '';
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'person':
      return personIdsOf(value).join(', ');
    case 'files':
      return Array.isArray(value)
        ? value.flatMap((file) => (typeof file === 'object' && file !== null && 'url' in file ? [String(file.url)] : [])).join(', ')
        : '';
    case 'checkbox':
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'date':
    case 'richText':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
    default:
      return typeof value === 'string' ? value : '';
  }
};

/** A grid of cell texts as clipboard text and HTML. */
export const gridToClipboard = (grid: string[][]): { text: string; html: string } => ({
  text: grid.map((row) => row.map(tsvField).join('\t')).join('\n'),
  html: `<table>${grid.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</table>`,
});

/** Splits TSV text into rows of fields, honouring quoted fields. */
const parseTsv = (text: string): string[][] => {
  const rows: string[][] = [[]];
  const state = { field: '', quoted: false, skip: false };
  const pushField = (): void => {
    rows[rows.length - 1].push(state.field);
    state.field = '';
  };
  const quotedChar = (char: string, next: string | undefined): void => {
    if (char === '"' && next === '"') {
      state.field += '"';
      state.skip = true;
    } else if (char === '"') {
      state.quoted = false;
    } else {
      state.field += char;
    }
  };
  const plainChar = (char: string, next: string | undefined): void => {
    if (char === '"' && state.field === '') {
      state.quoted = true;
    } else if (char === '\t') {
      pushField();
    } else if (char === '\n' || char === '\r') {
      state.skip = char === '\r' && next === '\n';
      pushField();
      rows.push([]);
    } else {
      state.field += char;
    }
  };

  [...text].forEach((char, index, chars) => {
    if (state.skip) {
      state.skip = false;

      return;
    }
    (state.quoted ? quotedChar : plainChar)(char, chars[index + 1]);
  });
  pushField();

  // A trailing line break ends the last row, it does not start a new one.
  return rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '' ? rows.slice(0, -1) : rows;
};

/**
 * Clipboard data as a grid of texts. An HTML table wins over the text: a
 * spreadsheet puts both, and the table keeps cells with line breaks whole.
 * Only text is read out of the HTML, in an inert document, so nothing in it
 * loads or runs and no markup reaches a cell.
 */
export const parseClipboard = (data: { html?: string; text?: string }): string[][] => {
  const table = data.html === undefined || data.html === '' ? null : parseUntrustedHtml(data.html).querySelector('table');
  const rows = table === null
    ? []
    : [...table.querySelectorAll('tr')]
      .map((tr) => [...tr.querySelectorAll('td, th')].map((cell) => (cell.textContent ?? '').trim()))
      .filter((row) => row.length > 0);

  if (rows.length > 0) {
    return rows;
  }

  return data.text === undefined || data.text === '' ? [] : parseTsv(data.text);
};

/**
 * A pasted text as a value of the property, or undefined when the property
 * cannot hold it (an unknown option label, a non-number, a read-only type).
 * An empty text clears the cell.
 */
export const valueFromText = (property: PropertyDefinition, text: string): PropertyValue | undefined => {
  const trimmed = text.trim();

  if (trimmed === '') {
    return property.type === 'checkbox' ? false : null;
  }
  const options = property.config?.options ?? [];
  const optionId = (label: string): string | undefined =>
    options.find((option) => option.label.trim().toLowerCase() === label.trim().toLowerCase())?.id;

  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return text;
    case 'number': {
      const number = Number(trimmed.replace(/,/g, ''));

      return Number.isFinite(number) ? number : undefined;
    }
    case 'checkbox':
      return TRUE_WORDS.has(trimmed.toLowerCase());
    case 'select':
    case 'status':
      return optionId(trimmed);
    case 'multiSelect': {
      const ids = trimmed.split(',').map(optionId).filter((id): id is string => id !== undefined);

      return ids.length > 0 ? ids : undefined;
    }
    case 'date':
      return parseDateValue(trimmed) === null ? undefined : trimmed;
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
