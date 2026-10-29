// Kept apart from database-csv.ts so the paste module can read a pasted table without loading the database code.
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

/**
 * Pasted text read as a table: two or more rows of the same two or more
 * columns. Anything else is prose and stays as paragraphs.
 */
export const pastedTable = (text: string): string[][] | null => {
  const table = parseCsv(text);
  const width = table[0]?.length ?? 0;

  return table.length >= 2 && width >= 2 && table.every((row) => row.length === width) ? table : null;
};
