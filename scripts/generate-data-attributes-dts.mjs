/**
 * Generates `types/data-attributes.d.ts` — the published declaration for
 * `Blok.DATA_ATTR` — from `src/components/constants/data-attributes.ts`.
 *
 * WHY THIS EXISTS: `types/*.d.ts` is the package's published type surface and
 * MUST NOT re-export from raw `../src/...` (see
 * `test/unit/architecture/published-types-no-src-refs.test.ts`), so DATA_ATTR's
 * ~110 literal key/value pairs had to be transcribed by hand. They drifted:
 * 17 attributes the runtime shipped were missing from the declaration —
 * including `nestedBlocks` (`data-blok-nested-blocks`), the container slot every
 * nesting tool's stylesheet targets — plus one phantom key that never existed in
 * the runtime at all. Consumers typing `DATA_ATTR.nestedBlocks` got TS2339 and
 * had to hard-code the raw string.
 *
 * Run it whenever you add/rename/remove a data attribute:
 *   node scripts/generate-data-attributes-dts.mjs
 *
 * The architecture test fails until `types/data-attributes.d.ts` matches the
 * source, so drift cannot ship silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO_ROOT, 'src', 'components', 'constants', 'data-attributes.ts');
const TARGET = join(REPO_ROOT, 'types', 'data-attributes.d.ts');

const HEADER = `/**
 * Centralized data attributes used across the Blok editor.
 * This is the single source of truth for all data-blok-* attributes.
 *
 * Access via Blok.DATA_ATTR
 *
 * AUTO-GENERATED from \`src/components/constants/data-attributes.ts\` by
 * \`scripts/generate-data-attributes-dts.mjs\`. Do NOT edit by hand — re-run the
 * script. Kept self-contained (no \`../src\` re-export) so consumers' \`tsc\` never
 * pulls raw implementation source into their program. Enforced by
 * \`test/unit/architecture/published-types-no-src-refs.test.ts\`.
 */
export const DATA_ATTR: {`;

const FOOTER = `};

/**
 * Type for DATA_ATTR keys
 */
export type DataAttrKey = keyof typeof DATA_ATTR;

/**
 * Type for DATA_ATTR values
 */
export type DataAttrValue = (typeof DATA_ATTR)[DataAttrKey];

/**
 * Helper function to create a CSS selector from an attribute
 *
 * @param attr - The data attribute name from DATA_ATTR
 * @param value - Optional value for the attribute (defaults to presence selector)
 * @returns CSS selector string
 *
 * @example
 * createSelector(DATA_ATTR.element) // '[data-blok-element]'
 * createSelector(DATA_ATTR.selected, true) // '[data-blok-selected="true"]'
 * createSelector(DATA_ATTR.tool, 'paragraph') // '[data-blok-tool="paragraph"]'
 */
export const createSelector: (attr: DataAttrValue, value?: string | boolean) => string;
`;

const source = readFileSync(SOURCE, 'utf-8');

const bodyStart = source.indexOf('export const DATA_ATTR = {');

if (bodyStart === -1) {
  throw new Error('generate-data-attributes-dts: could not find `export const DATA_ATTR = {` in the source.');
}

const bodyEnd = source.indexOf('} as const;', bodyStart);

if (bodyEnd === -1) {
  throw new Error('generate-data-attributes-dts: could not find the closing `} as const;` of DATA_ATTR.');
}

const bodyLines = source
  .slice(source.indexOf('\n', bodyStart) + 1, bodyEnd)
  .split('\n');

const RULE = /^\s*\/\/\s*=+\s*$/;
const PAIR = /^(\s*)([A-Za-z_$][\w$]*)\s*:\s*('data-blok-[^']*')\s*,\s*$/;

const out = [];
let pairCount = 0;

for (const line of bodyLines) {
  // Section banners are three lines in the source (rule / title / rule). Keep the
  // title comment, drop the rules — a declaration file reads better without them.
  if (RULE.test(line)) {
    continue;
  }

  const pair = line.match(PAIR);

  if (pair) {
    const [, indent, key, value] = pair;

    out.push(`${indent}readonly ${key}: ${value};`);
    pairCount += 1;
    continue;
  }

  // Comment lines and blank lines pass through verbatim so the published
  // declaration keeps the source's documentation.
  const trimmed = line.trim();

  if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    out.push(line);
    continue;
  }

  throw new Error(
    `generate-data-attributes-dts: unexpected line inside DATA_ATTR — the object must hold only ` +
      `\`key: 'data-blok-…',\` entries and comments.\n  ${line}`,
  );
}

if (pairCount === 0) {
  throw new Error('generate-data-attributes-dts: found no attribute entries — refusing to write an empty declaration.');
}

// Collapse the blank-line runs left behind by the removed banner rules.
const body = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');

writeFileSync(TARGET, `${HEADER}\n${body}\n${FOOTER}`, 'utf-8');

console.log(`Wrote ${pairCount} data-attribute declarations to types/data-attributes.d.ts`);
