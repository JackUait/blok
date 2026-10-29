// @vitest-environment node
/**
 * What every parse5 call site in Blok returns today, over the parser corpus.
 * The move to src/html must keep every row byte-identical.
 *
 * Re-record (only on purpose, on code that still runs parse5):
 *   RECORD_HTML_GOLDENS=1 yarn test test/unit/html/call-site-goldens.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { capture, goldenGroups } from './call-site-goldens.cases';
import type { GoldenGroup } from './call-site-goldens.cases';

const DIR = join(__dirname, '..', '..', 'fixtures', 'html-goldens');
const RECORD = process.env.RECORD_HTML_GOLDENS === '1';
/** A smaller group means the corpus or a document builder lost inputs. */
const MIN_INPUTS: Record<string, number> = { fragments: 6000, pages: 11, documents: 400 };

/** `rows[input][suite]` is the JSON of what that suite returned for that input. */
interface GoldenFile {
  suites: string[];
  inputs: unknown[];
  rows: string[][];
}

const fileOf = (group: string): string => join(DIR, `${group}.json.gz`);
const preview = (input: unknown): string => {
  const text = JSON.stringify(input);

  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
};

const readGolden = (group: string): GoldenFile =>
  JSON.parse(gunzipSync(readFileSync(fileOf(group))).toString('utf8')) as GoldenFile;

const runGroup = (group: GoldenGroup, inputs: unknown[]): string[][] =>
  inputs.map((input) => group.suites.map((suite) => JSON.stringify(capture(() => suite.run(input)))));

describe('call-site goldens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // htmlToBlocks stamps Date.now() into the ids it mints.
    vi.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(goldenGroups().map((group) => [group.name, group] as const))('%s', (name, group) => {
    const suites = group.suites.map((suite) => suite.name);

    if (RECORD) {
      const inputs = group.liveInputs();

      expect(inputs.length).toBeGreaterThanOrEqual(MIN_INPUTS[name]);
      mkdirSync(DIR, { recursive: true });
      writeFileSync(fileOf(name), gzipSync(JSON.stringify({ suites, inputs, rows: runGroup(group, inputs) } satisfies GoldenFile), { level: 9 }));

      return;
    }

    expect(existsSync(fileOf(name)), `no golden for ${name}; record with RECORD_HTML_GOLDENS=1`).toBe(true);

    const golden = readGolden(name);

    expect(golden.inputs.length).toBeGreaterThanOrEqual(MIN_INPUTS[name]);
    expect(suites, `${name}: the call sites changed; record the new ones on parse5 code`).toEqual(golden.suites);

    const rows = runGroup(group, golden.inputs);
    const mismatches = rows.flatMap((row, index) => row.flatMap((actual, column) => (actual === golden.rows[index][column]
      ? []
      : [{ suite: suites[column], input: preview(golden.inputs[index]), expected: golden.rows[index][column], actual }])));
    const bySuite = Object.fromEntries(suites
      .map((suite) => [suite, mismatches.filter((row) => row.suite === suite).length])
      .filter(([, count]) => count !== 0));

    expect({ count: mismatches.length, first: mismatches.slice(0, 5) }, JSON.stringify(bySuite)).toEqual({ count: 0, first: [] });
  }, 300_000);
});
