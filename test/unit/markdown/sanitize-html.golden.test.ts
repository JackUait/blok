import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { isClobbered } from '../../../src/components/utils/dom-clobbering';
import { sanitizeBlockHtml } from '../../../src/markdown/sanitize-html';

interface GoldenRow {
  id: string;
  kind: 'benign' | 'hostile';
  source: string;
  input: string;
  output: string;
  outputWithBase: string;
}

const FIXTURES = path.join(__dirname, '../../fixtures/markdown-sanitize');
const BASE_URL = 'https://github.com/owner/repo/blob/main/README.md';

/** Gzipped: tsconfig type-checks every JSON file. */
const readGolden = (): GoldenRow[] => {
  const parsed = JSON.parse(gunzipSync(readFileSync(path.join(FIXTURES, 'golden.json.gz'))).toString('utf8')) as { cases: GoldenRow[] };

  return parsed.cases;
};

const golden = readGolden();

/**
 * jsdom does not let form controls shadow form properties, so DOMPurify kept
 * these forms when the golden was recorded. In a browser it drops them whole, and so do we.
 * @param html - golden input
 */
const hasClobberingForm = (html: string): boolean =>
  Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('form')).some(isClobbered);

describe('sanitizeBlockHtml goldens (recorded from DOMPurify 3.4.17 with Blok config)', () => {
  it('has the recorded corpus', () => {
    expect(golden.filter((row) => row.kind === 'hostile')).toHaveLength(472);
    expect(golden.filter((row) => row.kind === 'benign').length).toBeGreaterThan(300);
  });

  it.each([ 'benign', 'hostile' ] as const)('gives the recorded bytes for every %s input, with and without a base URL', async (kind) => {
    const mismatches: string[] = [];

    for (const row of golden.filter((entry) => entry.kind === kind && !hasClobberingForm(entry.input))) {
      if (await sanitizeBlockHtml(row.input) !== row.output) {
        mismatches.push(`${row.id} (no base)`);
      }
      if (await sanitizeBlockHtml(row.input, BASE_URL) !== row.outputWithBase) {
        mismatches.push(`${row.id} (base)`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('drops a form whose controls shadow its properties, with everything in it', async () => {
    const rows = golden.filter((entry) => hasClobberingForm(entry.input));
    const outputs = await Promise.all(rows.map(async (row) => ({ id: row.id, output: await sanitizeBlockHtml(row.input) })));
    const leaks = outputs.filter(({ output }) => /<(form|input)\b/i.test(output) || output.includes('123')).map(({ id }) => id);

    expect(rows.length).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
  });

  it('gives the same bytes when its own output is sanitized again', async () => {
    const unstable: string[] = [];

    for (const row of golden) {
      if (await sanitizeBlockHtml(row.output) !== row.output) {
        unstable.push(row.id);
      }
    }

    expect(unstable).toEqual([]);
  });
});

describe('sanitizeBlockHtml source', () => {
  it('does not depend on DOMPurify', () => {
    const source = readFileSync(path.join(__dirname, '../../../src/markdown/sanitize-html.ts'), 'utf8');

    expect(source).not.toMatch(/(from|import\()\s*['"]dompurify['"]/);
  });
});
