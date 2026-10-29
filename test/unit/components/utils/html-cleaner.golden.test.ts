import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { cleanHtml, type CleanerTags } from '../../../../src/components/utils/html-cleaner';
import { hasUnsafeUrlProtocol, OTHER_URL_ATTRIBUTES } from '../../../../src/shared/url-policy';
import { GOLDEN_CONFIGS, GOLDEN_ODD_CONFIGS } from '../../../fixtures/html-cleaner/configs';

interface GoldenEntry {
  id: string;
  source: string;
  config: string;
  input: string;
  options?: { keepNestedBlockElements?: boolean };
  output?: string;
  throws?: string;
  hazard?: string[];
}

/** What the new engine gives where it differs from html-janitor on purpose. */
interface Deviation {
  id: string;
  output?: string;
  throws?: string;
}

const FIXTURES = path.join(__dirname, '../../../fixtures/html-cleaner');
const DEVIATIONS_FILE = path.join(FIXTURES, 'deviations.json.gz');

/** Gzipped: tsconfig type-checks every JSON file. */
const readGz = <T>(file: string): T => JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as T;

const { entries } = readGz<{ entries: GoldenEntry[] }>(path.join(FIXTURES, 'golden.json.gz'));
const deviations = new Map(readGz<Deviation[]>(DEVIATIONS_FILE).map((deviation) => [ deviation.id, deviation ]));

const configFor = (name: string): CleanerTags => (
  Object.hasOwn(GOLDEN_CONFIGS, name) ? GOLDEN_CONFIGS[name] : GOLDEN_ODD_CONFIGS[name]
) as CleanerTags;

const run = (entry: GoldenEntry): Deviation => {
  try {
    return { id: entry.id, output: cleanHtml(entry.input, configFor(entry.config)) };
  } catch (error) {
    return { id: entry.id, throws: String(error) };
  }
};

/**
 * Holes the old engine left in its output: an event handler or a script URL
 * outside href/src (also inside template content, which it never cleaned), or a `<constructor>` tag that got
 * `Object` as its rule. Attributes named `constructor` are not holes: a bare
 * `true` rule keeps every attribute.
 * @param html - engine output
 */
const unsafeParts = (html: string): string[] => {
  const template = document.createElement('template');

  template.innerHTML = html;

  const elementsOf = (scope: DocumentFragment): Element[] => Array.from(scope.querySelectorAll('*')).flatMap((element) => [
    element,
    ...element instanceof HTMLTemplateElement ? elementsOf(element.content) : [],
  ]);

  return elementsOf(template.content).flatMap((element) => [
    ...element.localName === 'constructor' ? [ '<constructor>' ] : [],
    ...Array.from(element.attributes)
      .filter(({ name, value }) => name.startsWith('on') || (OTHER_URL_ATTRIBUTES.has(name) && hasUnsafeUrlProtocol(value, name)))
      .map(({ name }) => name),
  ]);
};

// keepNestedBlockElements is an html-janitor option Blok never sets.
const parityEntries = entries.filter((entry) => entry.options === undefined);

// Runs the engine over ~26 000 entries under jsdom once; the tests share the results.
describe('cleanHtml parity with html-janitor 2.0.4', { timeout: 300_000 }, () => {
  let results: Deviation[] = [];

  beforeAll(() => {
    results = parityEntries.map(run);

    // Re-record: store what the engine gives wherever it differs, then check against that.
    if (process.env.HTML_CLEANER_DEVIATIONS_REWRITE === '1') {
      const changed = results.filter((result, index) => {
        const entry = parityEntries[index];

        return result.output !== entry.output || result.throws !== entry.throws;
      });

      writeFileSync(DEVIATIONS_FILE, gzipSync(`[\n${changed.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`, { level: 9 }));
      deviations.clear();
      changed.forEach((row) => deviations.set(row.id, row));
    }
  }, 300_000);

  it('runs the whole recorded corpus', () => {
    expect(parityEntries.length).toBeGreaterThan(26000);
  });

  it('matches html-janitor except where a recorded hazard is fixed on purpose', () => {
    const unexpected = results.flatMap((result, index) => {
      const entry = parityEntries[index];
      const expected = deviations.get(entry.id) ?? { output: entry.output, throws: entry.throws };

      return result.output === expected.output && result.throws === expected.throws ? [] : [ entry.id ];
    });

    expect(unexpected).toEqual([]);
  });

  it('deviates only on hazard entries, and every deviation is safe', () => {
    const byId = new Map(parityEntries.map((entry) => [ entry.id, entry ]));
    const problems = [ ...deviations.values() ].flatMap((deviation) => {
      const entry = byId.get(deviation.id);

      if (entry === undefined || entry.hazard === undefined) {
        return [ `${deviation.id}: differs but is not a recorded hazard` ];
      }

      const parts = deviation.output === undefined ? [] : unsafeParts(deviation.output);

      return parts.length === 0 ? [] : [ `${deviation.id}: ${parts.join(', ')}` ];
    });

    expect(problems).toEqual([]);
  });

  it('leaves no hole in any output', () => {
    const holes = results.flatMap(({ id, output }) => (
      output === undefined || unsafeParts(output).length === 0 ? [] : [ id ]
    ));

    expect(holes).toEqual([]);
  });
});
