import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FORMULA_FUNCTION_NAMES } from '../../../../../src/tools/database/formula';

const README = resolve(__dirname, '../../../../../src/tools/database/formula/README.md');

/** Rows of the function table: "| `name` | ... | <url> | ...". */
const documentedRows = (): Array<{ name: string; line: string }> =>
  readFileSync(README, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = /^\| `([A-Za-z0-9]+)` \|/.exec(line);

      return match === null ? [] : [{ name: match[1], line }];
    });

describe('formula README function table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every function the engine implements, once', () => {
    const names = documentedRows().map((row) => row.name);

    expect([...names].sort()).toEqual([...FORMULA_FUNCTION_NAMES].sort());
  });

  it('gives every function a source URL or an unverified label', () => {
    const missing = documentedRows().filter((row) => !/https:\/\/|unverified/.test(row.line));

    expect(missing).toEqual([]);
  });

  it.each(['larger', 'largerEq', 'smaller', 'smallerEq', 'start', 'end'])('does not implement %s, removed in Formulas 2.0', (name) => {
    expect(FORMULA_FUNCTION_NAMES).not.toContain(name);
  });
});
