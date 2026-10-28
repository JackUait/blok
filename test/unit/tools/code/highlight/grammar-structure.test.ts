/**
 * Every grammar, loaded the way Blok loads them, must have exactly the shape
 * Prism 1.30.0 builds: same tokens in the same order, same regex source and
 * flags, same greedy/lookbehind/alias, same shared references. This catches
 * porting slips that no test input happens to exercise.
 *
 * The fixture was serialized from the real Prism before it was removed.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHighlighter } from '../../../../../src/tools/code/highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader, GRAMMARS } from '../../../../../src/tools/code/highlight/grammar-loader';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/prism-upstream/grammar-structure.json');

/**
 * Same walk as the generator: regexes as source+flags, a revisit as the path of
 * its first visit, an explicit `undefined` as a marker. Compared as JSON text,
 * so key order counts at every level: token order decides what matches first.
 */
const serialize = (root: unknown): unknown => {
  const seen = new Map<unknown, string>();

  const walk = (value: unknown, path: string): unknown => {
    if (value instanceof RegExp) {
      return { $re: value.source, flags: value.flags };
    }

    if (value === undefined) {
      return { $undefined: true };
    }

    if (value === null || typeof value !== 'object') {
      return typeof value === 'function' ? undefined : value;
    }

    const first = seen.get(value);

    if (first !== undefined) {
      return { $ref: first };
    }

    seen.set(value, path);

    if (Array.isArray(value)) {
      return value.map((item: unknown, i) => walk(item, `${path}[${i}]`));
    }

    const out: Record<string, unknown> = {};

    for (const key of Object.keys(value)) {
      const walked = walk((value as Record<string, unknown>)[key], `${path}.${key}`);

      if (walked !== undefined) {
        out[key] = walked;
      }
    }

    return out;
  };

  return walk(root, '$');
};

describe('grammar structure matches Prism 1.30.0', () => {
  it('builds the same grammars with every language loaded', async () => {
    const hl = createHighlighter();
    const load = createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: true });

    for (const id of Object.keys(GRAMMARS).filter((name) => name !== 'mermaid')) {
      await load(id);
    }

    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    const actual = serialize({ ...hl.languages }) as Record<string, unknown>;

    expect(Object.keys(actual)).toEqual(Object.keys(expected));

    for (const name of Object.keys(expected)) {
      expect(JSON.stringify(actual[name], null, 1), name).toBe(JSON.stringify(expected[name], null, 1));
    }
  });
});
