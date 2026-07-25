/**
 * Pure, DOM-free registry of every tool's STATIC presentational classes.
 *
 * Both the editor's block tools and the view's emitters read from here, which
 * is what makes view↔read-only visual parity structurally impossible to drift
 * (enforced by `test/unit/view/golden-harness.test.ts`, guarantee 4).
 *
 * Two hard constraints on every module in this directory:
 *
 * 1. PURE — no DOM, no `twMerge` at call time. Export `readonly string[]`; the
 *    consumer merges. `src/view/*` may only import from `src/shared/*` (its
 *    purity contract, enforced by
 *    `test/unit/architecture/view-entry-law.test.ts`), and importing anything
 *    that touches `globalThis.window` at module load would break Node rendering.
 * 2. ENUMERABLE — every class a module can emit must be reachable from
 *    {@link ALL_STATIC_CLASSES}, because `scripts/generate-view-css.mjs`
 *    generates the stylesheet from it and the view-stylesheet law asserts that
 *    each one has a matching rule. For data-dependent tools that means
 *    enumerating every variant, not just the default.
 *
 * Edit-only classes (placeholders, focus rings, hover affordances, resize
 * grips, `group/*` markers) do NOT belong here — they stay at the tool's call
 * site.
 */
import { HEADER_LEVEL_CLASSES, headerClasses } from './header';
import { PARAGRAPH_CLASSES } from './paragraph';
import { quoteClasses } from './quote';

/** Static classes for tools whose set does not vary with block data. */
const STATIC_BY_TOOL: Record<string, readonly string[]> = {
  paragraph: PARAGRAPH_CLASSES,
};

/**
 * Classes for tools whose set DOES vary with block data. Each factory must
 * tolerate missing or wrongly-typed fields — saved documents are wire data, and
 * a viewer must never throw on a malformed block.
 */
const FACTORY_BY_TOOL: Record<string, (data: Record<string, unknown>) => readonly string[]> = {
  header: (data) => headerClasses(num(data, 'level', 1), bool(data, 'isToggleable')),
  quote: (data) => quoteClasses(str(data, 'size') === 'large' ? 'large' : 'default'),
};

/**
 * Read a numeric data field defensively.
 * @param data - block data
 * @param key - field name
 * @param fallback - value used when the field is absent or not a number
 */
function num(data: Record<string, unknown>, key: string, fallback: number): number {
  return typeof data[key] === 'number' ? (data[key]) : fallback;
}

/**
 * Read a string data field defensively.
 * @param data - block data
 * @param key - field name
 */
function str(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === 'string' ? (data[key]) : undefined;
}

/**
 * Read a boolean data field defensively.
 * @param data - block data
 * @param key - field name
 */
function bool(data: Record<string, unknown>, key: string): boolean {
  return data[key] === true;
}

/**
 * Resolve a block's static presentational classes.
 * @param type - tool type (`block.type`)
 * @param data - the block's saved data, for tools whose classes vary with it
 * @returns the classes to stamp, or an empty array for an unknown tool
 */
export const classesFor = (type: string, data: Record<string, unknown>): readonly string[] => {
  const factory = FACTORY_BY_TOOL[type];

  if (factory !== undefined) {
    return factory(data);
  }

  return STATIC_BY_TOOL[type] ?? [];
};

/**
 * Every class any tool can emit — deduped and sorted. Both the stylesheet
 * generator's Tailwind input and the law test's coverage assertion read this.
 *
 * Data-dependent tools MUST enumerate every reachable variant here; the
 * generator cannot infer them from a factory. Missing a variant means the
 * generated stylesheet silently lacks its rule.
 */
export const ALL_STATIC_CLASSES: readonly string[] = [
  ...new Set([
    ...Object.values(STATIC_BY_TOOL).flat(),
    /** Every heading level, toggleable and not. */
    ...Object.keys(HEADER_LEVEL_CLASSES).flatMap((level) => [
      ...headerClasses(Number(level), false),
      ...headerClasses(Number(level), true),
    ]),
    /** Both quote sizes. */
    ...quoteClasses('default'),
    ...quoteClasses('large'),
  ]),
].sort();
