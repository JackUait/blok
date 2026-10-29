// @vitest-environment node
/**
 * What every parse5 call site in Blok returns today, over the parser corpus.
 * The move to src/html must keep every row byte-identical.
 *
 * Re-record (only on purpose, on code that still runs parse5):
 *   RECORD_HTML_GOLDENS=1 yarn test test/unit/html/call-site-goldens.test.ts
 */
import { createHash } from 'node:crypto';
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
  keys: string[];
  rows: string[][];
}

const fileOf = (group: string): string => join(DIR, `${group}.json.gz`);
const hashOf = (key: string): string => createHash('sha1').update(key).digest('base64').slice(0, 12);
const preview = (text: string): string => JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}…` : text);

const readGolden = (group: string): GoldenFile =>
  JSON.parse(gunzipSync(readFileSync(fileOf(group))).toString('utf8')) as GoldenFile;

const runGroup = (group: GoldenGroup): string[][] =>
  group.keys.map((_, index) => group.suites.map((suite) => JSON.stringify(capture(() => suite.run(index)))));

describe('call-site goldens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // htmlToBlocks stamps Date.now() into the ids it mints.
    vi.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const groups = goldenGroups();

  it.each(groups.map((group) => [group.name, group] as const))('%s', (name, group) => {
    expect(group.keys.length).toBeGreaterThanOrEqual(MIN_INPUTS[name]);

    const rows = runGroup(group);
    const suites = group.suites.map((suite) => suite.name);
    const keys = group.keys.map(hashOf);

    if (RECORD) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(fileOf(name), gzipSync(JSON.stringify({ suites, keys, rows } satisfies GoldenFile), { level: 9 }));

      return;
    }

    expect(existsSync(fileOf(name)), `no golden for ${name}; record with RECORD_HTML_GOLDENS=1`).toBe(true);

    const golden = readGolden(name);
    const changedInput = keys.findIndex((hash, index) => golden.keys[index] !== hash);

    expect({ suites, inputs: keys.length, changedInput }, `${name}: the corpus or the call sites changed; re-record on parse5 code`)
      .toEqual({ suites: golden.suites, inputs: golden.keys.length, changedInput: -1 });

    const mismatches = rows.flatMap((row, index) => row.flatMap((actual, column) => (actual === golden.rows[index][column]
      ? []
      : [{ suite: suites[column], input: preview(group.keys[index]), expected: golden.rows[index][column], actual }])));
    const bySuite = Object.fromEntries(suites
      .map((suite) => [suite, mismatches.filter((row) => row.suite === suite).length])
      .filter(([, count]) => count !== 0));

    expect({ count: mismatches.length, first: mismatches.slice(0, 5) }, JSON.stringify(bySuite)).toEqual({ count: 0, first: [] });
  }, 300_000);
});
