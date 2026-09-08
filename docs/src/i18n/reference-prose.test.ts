// docs/src/i18n/reference-prose.test.ts
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';
import { parseProse } from '../components/common/Prose';

/**
 * The readability guard for the documentation reference.
 *
 * The reference pages render their body copy through `<Prose>`, whose grammar is
 * four tokens wide: a blank line starts a paragraph, `- ` starts a list item,
 * two spaces then `- ` starts a sub-item, and backticks mark code. Nothing else
 * renders, so a value that ignores the grammar reaches the reader as one
 * unbroken slab no matter how long it is. That is what this file measures.
 *
 * Scope is the reference only. The pages that sell Blok (`home`, the migration
 * hero, walls, objections and move bands, `changelog`, `demo`) are written to a
 * different brief and are deliberately outside it, as is site chrome.
 */

/** Namespaces whose every key is reference copy. */
const REFERENCE_NAMESPACES = ['api', 'tools', 'presets', 'server'] as const;

/**
 * `migration` is the one mixed namespace: a landing page sits on top of the
 * reference. These prefixes are the landing page.
 */
const MIGRATION_PROMO_PREFIXES = ['hero', 'persuadeHero', 'wall', 'objection', 'move'];

/**
 * A value shorter than this is a label, a heading or a table cell, not body
 * copy. Applying paragraph rules to it would only ban ordinary short answers.
 */
const PROSE_WORDS = 25;

/** Past either of these a reader needs structure to find anything. */
const WALL_SENTENCES = 5;
const WALL_WORDS = 60;

/** A paragraph past either of these is the wall the split was meant to remove. */
const PARAGRAPH_SENTENCES = 5;
const PARAGRAPH_WORDS = 90;

/** A list item carrying more than this is a paragraph wearing a bullet. */
const ITEM_SENTENCES = 3;

/** Measured against the reference as it stands; the worst survivor is 34 words. */
const SENTENCE_WORDS = 34;

/**
 * Empty on purpose. Every entry must state what makes the value an exception,
 * because an entry with no reason is a suppressed failure, not an exemption.
 */
const LONG_SENTENCE_EXEMPT: Record<string, string> = {};

type Bundle = Record<string, unknown>;

const walk = (node: unknown, path: string, into: Map<string, string>): void => {
  if (typeof node === 'string') {
    into.set(path, node);

    return;
  }

  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node as Bundle)) {
      walk((node as Bundle)[key], path === '' ? key : `${path}.${key}`, into);
    }
  }
};

const guardedValues = (bundle: Bundle): Map<string, string> => {
  const found = new Map<string, string>();

  for (const namespace of REFERENCE_NAMESPACES) {
    walk(bundle[namespace], namespace, found);
  }

  const migration = new Map<string, string>();

  walk(bundle.migration, 'migration', migration);

  for (const [key, value] of migration) {
    const leaf = key.slice('migration.'.length);

    if (!MIGRATION_PROMO_PREFIXES.some((prefix) => leaf.startsWith(prefix))) {
      found.set(key, value);
    }
  }

  return found;
};

const words = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length;

/**
 * Splits after terminal punctuation. It over-splits on "e.g." and on a version
 * number, which only ever makes the sentence rules more forgiving, never
 * stricter, so no value fails because of the heuristic.
 */
const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

const isProse = (value: string): boolean => words(value) >= PROSE_WORDS || sentences(value).length >= 2;

const proseEntries = (bundle: Bundle): [string, string][] =>
  [...guardedValues(bundle)].filter(([, value]) => isProse(value));

const BUNDLES: [string, Bundle][] = [
  ['en', en as Bundle],
  ['ru', ru as Bundle],
];

/** Every stretch of text the reader meets as one run: a paragraph, an item, a sub-item. */
const runsOf = (text: string): string[] =>
  parseProse(text).flatMap((block) =>
    block.kind === 'paragraph'
      ? [block.text]
      : block.items.flatMap((item) => [item.text, ...item.children]),
  );

/**
 * The shape a value renders as, ignoring the words: P for a paragraph, then one
 * L per list carrying its items' sub-item counts. Two locales that describe the
 * same thing must give the reader the same skeleton.
 */
const shapeOf = (text: string): string =>
  parseProse(text)
    .map((block) =>
      block.kind === 'paragraph'
        ? 'P'
        : `L(${block.items.map((item) => item.children.length).join(',')})`,
    )
    .join('|');

describe('reference prose', () => {
  it('guards a surface large enough for the rules below to mean something', () => {
    // Guards the guard: a collector that silently walks nothing would make every
    // assertion in this file pass.
    const thin = BUNDLES.map(([locale, bundle]) => [locale, proseEntries(bundle).length] as const)
      .filter(([, count]) => count <= 300)
      .map(([locale, count]) => `${locale}: only ${count} prose values collected`);

    expect(thin).toEqual([]);
  });

  it('breaks every long value into paragraphs or a list', () => {
    const walls = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle)
        .filter(([, value]) => sentences(value).length >= WALL_SENTENCES || words(value) >= WALL_WORDS)
        .filter(([, value]) => !value.includes('\n'))
        .map(([key, value]) => `${locale} ${key} (${words(value)} words, ${sentences(value).length} sentences)`),
    );

    expect(walls).toEqual([]);
  });

  it('keeps every paragraph inside a value short', () => {
    const long = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle).flatMap(([key, value]) =>
        parseProse(value)
          .filter((block) => block.kind === 'paragraph')
          .filter(
            (block) =>
              block.kind === 'paragraph' &&
              (sentences(block.text).length > PARAGRAPH_SENTENCES || words(block.text) > PARAGRAPH_WORDS),
          )
          .map((block) =>
            block.kind === 'paragraph'
              ? `${locale} ${key} (${words(block.text)} words, ${sentences(block.text).length} sentences)`
              : '',
          ),
      ),
    );

    expect(long).toEqual([]);
  });

  it('keeps every list item to a point rather than a paragraph', () => {
    const long = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle).flatMap(([key, value]) =>
        parseProse(value).flatMap((block) =>
          block.kind === 'list'
            ? [...block.items, ...block.items.flatMap((item) => item.children.map((text) => ({ text })))]
                .filter((item) => sentences(item.text).length > ITEM_SENTENCES)
                .map((item) => `${locale} ${key} (${sentences(item.text).length} sentences in one item)`)
            : [],
        ),
      ),
    );

    expect(long).toEqual([]);
  });

  it('keeps every sentence readable', () => {
    // Measured per block. Flattening a value first would run the last sentence
    // of a lead-in into the first list item and report a wall that is not there.
    const long = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle)
        .filter(([key]) => LONG_SENTENCE_EXEMPT[key] === undefined)
        .flatMap(([key, value]) =>
          runsOf(value)
            .flatMap((run) => sentences(run))
            .filter((sentence) => words(sentence) > SENTENCE_WORDS)
            .map((sentence) => `${locale} ${key} (${words(sentence)} words)`),
        ),
    );

    expect(long).toEqual([]);
  });

  it('never joins clauses with a dash instead of a full stop', () => {
    // A dash between clauses is how a wall hides from the sentence rules. Short
    // labels are exempt by the prose floor, which is what keeps the Russian
    // copula ("Всё — это блок") legal.
    const dashed = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle)
        .filter(([, value]) => /[—–]/u.test(value))
        .map(([key]) => `${locale} ${key}`),
    );

    expect(dashed).toEqual([]);
  });

  it('uses only the four tokens Prose renders', () => {
    // Everything else reaches the reader as literal punctuation.
    const unsupported = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle)
        .filter(([, value]) =>
          value.split('\n').some((line) => /\*\*|^\s*#|^\s*\d+\.\s|^\s*>/u.test(line)),
        )
        .map(([key]) => `${locale} ${key}`),
    );

    expect(unsupported).toEqual([]);
  });

  it('never opens a value with a list', () => {
    // A list with no lead-in reads as an answer to a question nobody asked.
    const headless = BUNDLES.flatMap(([locale, bundle]) =>
      proseEntries(bundle)
        .filter(([, value]) => /^\s*-\s/u.test(value))
        .map(([key]) => `${locale} ${key}`),
    );

    expect(headless).toEqual([]);
  });

  it('gives a key the same shape in both locales', () => {
    // A Russian reader who scans for the third bullet must find a third bullet.
    const english = guardedValues(en as Bundle);
    const russian = guardedValues(ru as Bundle);

    const drifted = [...english]
      .filter(([key, value]) => russian.has(key) && isProse(value))
      .filter(([key, value]) => shapeOf(value) !== shapeOf(russian.get(key) ?? ''))
      .map(([key, value]) => `${key}: en ${shapeOf(value)} vs ru ${shapeOf(russian.get(key) ?? '')}`);

    expect(drifted).toEqual([]);
  });
});
