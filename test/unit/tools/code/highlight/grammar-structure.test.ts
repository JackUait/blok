/**
 * Every grammar, loaded the way Blok loads them, must have exactly the shape
 * Prism 1.30.0 builds: same tokens in the same order, same regex source and
 * flags, same greedy/lookbehind/alias, same shared references. This catches
 * porting slips that no test input happens to exercise.
 *
 * The fixture was serialized from the real Prism before it was removed.
 */
import { createHash } from 'node:crypto';
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

/**
 * Patterns Blok changed on purpose. Each holds a hash of Prism's serialized
 * value, so a Prism bump that touches the pattern fails here and needs a new
 * review, and a hash of Blok's value, so it cannot drift unnoticed.
 */
const DEVIATIONS: Array<{ path: Array<string | number>; prism: string; blok: string; reason: string }> = [
  {
    path: ['csharp', 'return-type', 'pattern'],
    prism: '5bb72b67bb039ff4',
    blok: 'f17b1440026e72ae',
    reason: 'typeExpressionFromChainStart: a start inside a dotted name is skipped, so long names stay linear',
  },
  {
    path: ['markdown', 'title', 0, 'pattern'],
    prism: '2ef9d7853e46f671',
    blok: 'e75c64c6711f6998',
    reason: 'a start with an earlier \\S on the same line is skipped, so a line with no title stays linear',
  },
  {
    path: ['markdown', 'url-reference', 'pattern'],
    prism: '575bda7857a0f0c6',
    blok: '7ce872499393825b',
    reason: 'a [ with an earlier [ and no ] between is skipped, so runs of [ stay linear',
  },
  {
    path: ['csharp', 'class-name', 7, 'pattern'],
    prism: 'aa66d7eea3741b07',
    blok: '4102fbbb7a6b8f31',
    reason: 'typeExpressionFromChainStart: a start inside a dotted name is skipped, so long names stay linear',
  },
];

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const at = (root: unknown, path: Array<string | number>): Record<string | number, unknown> => {
  return path.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root) as Record<string | number, unknown>;
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

    for (const { path, prism, blok, reason } of DEVIATIONS) {
      const key = path[path.length - 1];
      const expectedParent = at(expected, path);

      expect(hash(expectedParent[key]), `Prism side of ${path.join('.')}`).toBe(prism);
      expect(hash(at(actual, path)[key]), `${path.join('.')}: ${reason}`).toBe(blok);
      expectedParent[key] = at(actual, path)[key];
    }

    for (const name of Object.keys(expected)) {
      expect(JSON.stringify(actual[name], null, 1), name).toBe(JSON.stringify(expected[name], null, 1));
    }
  });
});
