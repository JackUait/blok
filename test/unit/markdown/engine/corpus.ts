import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';

export interface CorpusCase {
  input: string;
  source: string;
  /** A CommonMark spec example: also recorded with GFM off. */
  commonmark?: boolean;
}

const FIXTURES = path.join(__dirname, 'fixtures');

/** Fixtures are stored gzipped: tsconfig includes every JSON file, and 13 MB of plain fixtures run tsc out of memory. */
export const readFixture = <T>(name: string): T =>
  JSON.parse(gunzipSync(readFileSync(path.join(FIXTURES, `${name}.gz`))).toString('utf8')) as T;

/**
 * Write rows to a gzipped fixture, one row per line so a diff of the
 * unzipped file reads case by case.
 * @param name - fixture name without `.gz`
 * @param rows - one entry per corpus case
 */
export const writeFixture = (name: string, rows: unknown[]): void => {
  writeFileSync(path.join(FIXTURES, `${name}.gz`), gzipSync(`[\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]\n`, { level: 9 }));
};

/** Fragments the fuzzer glues together: every construct's opener and closer, and the characters between them. */
const FRAGMENTS = [
  '*', '**', '***', '_', '__', '~', '~~', '`', '``', '```', '~~~', '$', '$$', '\\', '\\*', '\\$',
  '[', ']', '(', ')', '![', '](', '[^1]', '[^1]: ', '[^a b]', '[x]', '[x]: /u "t"', '[x]: <a b>', '][x]',
  '<', '>', '<a href="x">', '</a>', '<div>', '</div>', '<!--', '-->', '<br>', '<https://a.b>', '<a@b.co>',
  '&amp;', '&#35;', '&#x41;', '&nbsp;', '&copy', '&bogus;', '&#0;',
  '|', ' | ', '|---|', '| :-: |', '---', '***', '___', '===',
  '- ', '* ', '+ ', '1. ', '2) ', '- [ ] ', '- [x] ', '> ', '>', '# ', '## ', '###### ', '#######',
  ' ', '  ', '   ', '    ', '\t', '\n', '\n', '\n\n', '  \n', '\\\n',
  'foo', 'bar', 'a', 'b c', 'é', '中文', '😀', '1', '5', 'x^2', '+', '/', '-', '.', ',', ':', '"', "'",
  'www.example.com', 'https://a.b/c?d=e&f', 'http://x.y/(z)', 'mailto:a@b.co', 'a@b.co', 'xmpp:a@b.co',
  '$5', '$5/$month', '$x$', '$$\n', '\\(', '{', '}',
];

/** A seeded PRNG (mulberry32) so the fuzz corpus is the same on every run. */
const prng = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Random documents: some glued from fragments, some made by splicing
 * fragments into upstream inputs, which keeps their structure mostly intact.
 * @param count - how many documents
 * @param seed - PRNG seed
 * @param bases - documents to mutate
 */
export const fuzzCorpus = (count: number, seed: number, bases: string[]): CorpusCase[] => {
  const random = prng(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const cases: CorpusCase[] = [];

  for (let index = 0; index < count; index++) {
    if (index % 2 === 0) {
      const length = 1 + Math.floor(random() * 40);
      const parts = Array.from({ length }, () => pick(FRAGMENTS));

      cases.push({ input: parts.join(''), source: `fuzz:${seed}:${index}` });
      continue;
    }

    let doc = pick(bases).slice(0, 600);
    const edits = 1 + Math.floor(random() * 4);

    for (let edit = 0; edit < edits; edit++) {
      const at = Math.floor(random() * (doc.length + 1));
      const cut = random() < 0.3 ? Math.floor(random() * 4) : 0;

      doc = doc.slice(0, at) + pick(FRAGMENTS) + doc.slice(at + cut);
    }

    cases.push({ input: doc, source: `fuzz:${seed}:${index}` });
  }

  return cases;
};

/** The upstream corpus plus the fuzz corpus, in golden order. */
export const loadCorpus = (): CorpusCase[] => {
  const upstream = readFixture<CorpusCase[]>('upstream-corpus.json');

  return [...upstream, ...fuzzCorpus(FUZZ_COUNT, FUZZ_SEED, upstream.map(entry => entry.input))];
};

export const FUZZ_SEED = 20261028;
export const FUZZ_COUNT = 2000;

/**
 * An mdast tree without what the engine does not produce: source positions,
 * `spread` and plugin `data`.
 * @param node - any mdast value
 */
export const normalizeTree = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(normalizeTree);
  }

  if (node === null || typeof node !== 'object') {
    return node;
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === 'position' || key === 'spread' || key === 'data') {
      continue;
    }

    out[key] = normalizeTree(value);
  }

  return out;
};

/**
 * A tree with the inline content of every leaf dropped: block structure only.
 * @param node - a normalized tree
 */
export const stripPhrasing = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(stripPhrasing);
  }

  if (node === null || typeof node !== 'object') {
    return node;
  }

  const record = node as Record<string, unknown>;
  const leaf = record.type === 'paragraph' || record.type === 'heading' || record.type === 'tableCell';

  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => !(leaf && key === 'children'))
    .map(([key, value]) => [key, stripPhrasing(value)]));
};

/** Block ids carry a timestamp; number them in order of first sight instead. */
export const normalizeIds = (value: unknown): unknown => {
  const seen = new Map<string, string>();

  return JSON.parse(JSON.stringify(value).replace(/md-[a-z0-9]+-[a-z0-9]+/g, (id) => {
    if (!seen.has(id)) {
      seen.set(id, `id${seen.size}`);
    }

    return seen.get(id) ?? id;
  }));
};
