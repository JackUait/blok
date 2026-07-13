import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGACY_GRAMMAR } from '../../../src/components/migration/legacy-grammar.mjs';

/**
 * The Editor.js→Blok migration compatibility matrix is documented in two
 * user-facing places — MIGRATION.md and the docs site's `migration-data.ts`
 * (COMPATIBILITY_GROUPS). Both are hand-written PROSE, so they can silently
 * drift from the actual coverage encoded in the shared `LEGACY_GRAMMAR`.
 *
 * This law makes that drift a red test: every legacy type the grammar actually
 * migrates MUST be documented as auto-migrated in both surfaces, and every
 * cross-type mapping (e.g. linkTool→bookmark) MUST name its target. Add a
 * grammar entry without updating the docs and this fails.
 */

interface GrammarEntry {
  legacyType: string;
  targetType: string;
}

const REPO_ROOT = resolve(__dirname, '../../..');
const MIGRATION_MD = readFileSync(resolve(REPO_ROOT, 'MIGRATION.md'), 'utf8');
const MIGRATION_DATA = readFileSync(
  resolve(REPO_ROOT, 'docs/src/components/migration/migration-data.ts'),
  'utf8'
);

const entries = LEGACY_GRAMMAR as GrammarEntry[];

/** Extract the string[] `tools` list of a COMPATIBILITY_GROUPS entry by id. */
const compatGroupTools = (source: string, id: string): string[] => {
  const groupStart = source.indexOf(`id: "${id}"`);

  expect(groupStart, `COMPATIBILITY_GROUPS is missing the "${id}" group`).toBeGreaterThan(-1);

  const toolsStart = source.indexOf('tools: [', groupStart);
  const toolsEnd = source.indexOf(']', toolsStart);
  const slice = source.slice(toolsStart, toolsEnd);

  return Array.from(slice.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
};

describe('migration grammar ↔ docs consistency law', () => {
  it('documents every grammar legacy type in the MIGRATION.md compatibility matrix', () => {
    const missing = entries
      .map((e) => e.legacyType)
      .filter((legacyType) => !MIGRATION_MD.includes(`\`${legacyType}\``));

    expect(missing, `MIGRATION.md matrix is missing rows for: ${missing.join(', ')}`).toEqual([]);
  });

  it('names the target type for every cross-type mapping in MIGRATION.md', () => {
    // Only the mappings whose target differs from the source need naming
    // (linkTool→bookmark, raw→code, attaches→bookmark, warning→callout, …).
    const rowFor = (legacyType: string): string =>
      MIGRATION_MD.split('\n').find((line) => line.includes(`\`${legacyType}\``) && line.trim().startsWith('|')) ?? '';

    const undocumented = entries
      .filter((e) => e.targetType !== e.legacyType)
      .filter((e) => !rowFor(e.legacyType).includes(e.targetType));

    expect(
      undocumented.map((e) => `${e.legacyType}→${e.targetType}`),
      'MIGRATION.md rows must name their Blok target type'
    ).toEqual([]);
  });

  it('lists every grammar legacy type in the docs COMPATIBILITY_GROUPS "auto" group', () => {
    const autoTools = compatGroupTools(MIGRATION_DATA, 'auto');
    const missing = entries
      .map((e) => e.legacyType)
      .filter((legacyType) => !autoTools.includes(legacyType));

    expect(
      missing,
      `docs COMPATIBILITY_GROUPS "auto" is missing: ${missing.join(', ')} (present: ${autoTools.join(', ')})`
    ).toEqual([]);
  });

  it('does not claim a grammar-migrated type is a drop-in (mutually exclusive groups)', () => {
    const dropInTools = compatGroupTools(MIGRATION_DATA, 'drop-in');
    const overlap = entries.map((e) => e.legacyType).filter((legacyType) => dropInTools.includes(legacyType));

    expect(overlap, `these are auto-migrated by the grammar, not drop-in: ${overlap.join(', ')}`).toEqual([]);
  });
});
