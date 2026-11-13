import { mountViewToggle, type PreviewChrome } from './preview-chrome';
import { counted } from './preview-labels';
import { MAX_GRID_CELLS, mountSheetGrid, type GridCell } from './sheet-grid';

const DELIMITERS = [',', ';', '\t'];
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** The separator a file uses: the one that shows up most in its first line, outside quotes. */
function sniffDelimiter(text: string): string {
  const counts = new Map(DELIMITERS.map((delimiter) => [delimiter, 0]));
  const state = { quoted: false };
  for (const ch of text) {
    if (ch === '"') {
      state.quoted = !state.quoted;
    } else if (!state.quoted && (ch === '\n' || ch === '\r')) {
      break;
    } else if (!state.quoted && counts.has(ch)) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }

  return DELIMITERS.reduce((best, delimiter) => ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0) ? delimiter : best));
}

/**
 * Rows and fields of a CSV file (RFC 4180): a quoted field may hold the
 * separator, line breaks and `""` for a quote. The separator is a comma,
 * semicolon or tab, whichever the first line uses most.
 */
export function parseCsv(source: string): string[][] {
  const text = source.startsWith('﻿') ? source.slice(1) : source;
  if (text === '') {
    return [];
  }
  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  const state = { row: [] as string[], field: '', quoted: false, i: 0 };
  const endField = (): void => {
    state.row.push(state.field);
    state.field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(state.row);
    state.row = [];
  };
  while (state.i < text.length) {
    const ch = text[state.i];
    if (state.quoted && ch === '"' && text[state.i + 1] === '"') {
      state.field += '"';
      state.i += 2;
    } else if (ch === '"') {
      state.quoted = !state.quoted;
      state.i += 1;
    } else if (!state.quoted && ch === delimiter) {
      endField();
      state.i += 1;
    } else if (!state.quoted && (ch === '\n' || ch === '\r')) {
      endRow();
      state.i += ch === '\r' && text[state.i + 1] === '\n' ? 2 : 1;
    } else {
      state.field += ch;
      state.i += 1;
    }
  }
  // A final line break already closed the last row.
  if (state.field !== '' || state.row.length > 0) {
    endRow();
  }

  return rows;
}

const toCell = (field: string): GridCell => ({ text: field, value: NUMBER.test(field) ? Number(field) : null });

/** A CSV file as a spreadsheet grid, with a Table / Source switch in the header. */
export function renderCsv(chrome: PreviewChrome, text: string): void {
  const { body, labels } = chrome;
  body.replaceChildren();
  const rows = parseCsv(text);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 1);

  const table = document.createElement('div');
  table.className = 'blok-file-preview-office blok-file-preview-xlsx';
  table.setAttribute('data-role', 'file-preview-csv');
  const sheet = { name: '', rows: rows.slice(0, Math.floor(MAX_GRID_CELLS / width)).map((row) => row.map(toCell)) };
  const bar = mountSheetGrid(table, [sheet], chrome, { tabs: false });

  const source = document.createElement('pre');
  source.className = 'blok-file-preview-pre';
  source.setAttribute('data-role', 'file-preview-csv-raw');
  source.textContent = text;
  source.hidden = true;
  body.append(table, source);

  chrome.setFacts([counted(Math.max(0, rows.length - 1), labels.rowsOne, labels.rows)]);
  mountViewToggle(chrome.header, labels.table, labels.raw, (raw) => {
    table.hidden = raw;
    source.hidden = !raw;
    if (bar !== null) {
      bar.hidden = raw;
    }
  });
}
