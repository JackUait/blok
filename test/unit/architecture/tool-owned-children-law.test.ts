import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — tool-owned children are never an indent target.
 *
 * Blok's hierarchy is universal: any block can parent any other, and the user's
 * Tab nests a block under its preceding sibling with `setBlockParent`. That is
 * right for a toggle, a callout, a column, a nested paragraph — blocks whose
 * children are free user content.
 *
 * It is catastrophic for a tool whose `contentIds` are its OWN machinery. A
 * table's children ARE its cell blocks; a column_list's ARE its columns. An
 * adopted outsider becomes a rogue child that the tool renders wherever its
 * children go — the shipped bug: Tab out of a table's last cell, press Tab
 * again, and the paragraph you just created teleports INTO the table's first
 * cell.
 *
 * Two halves, one law:
 *
 * 1. TOOLS DECLARE. A tool that CLAIMS AN EXISTING BLOCK as its own child —
 *    `setBlockParent(someBlock, this.<my>BlockId)` — is running a managed child
 *    registry, and must declare `static get ownsChildren(): boolean`. Note the
 *    fingerprint is claiming, not creating: `insertInsideParent(this.blockId, …)`
 *    (toggle, callout, column, header) means "grow my free content stack" and is
 *    NOT tool ownership.
 *
 * 2. CORE ENFORCES IN ONE PLACE. Tab-indent has two gestures — single-block
 *    (keyboardNavigation) and multi-select (blockSelectionKeys). Both must
 *    resolve their nesting target through `getIndentTarget`, the one function
 *    that consults `ownsChildren`. Reaching for the raw `getPrecedingSibling`
 *    to nest is how the rule gets enforced in one gesture and forgotten in the
 *    other.
 *
 * 3. TOOLS DEFEND THEIR RENDER. The Tab-indent guard (halves 1-2) only stops
 *    ONE adoption gesture. `setBlockParent` is called raw by ~30 other sites
 *    (paste, drag, database, keyboard, the tool's own seeding) and none validate
 *    child type, and a document can arrive ALREADY corrupted on disk. So an
 *    ownsChildren tool must never blindly render every `getChildren()` result as
 *    a structural slot: a rogue non-owned child would materialise as a phantom
 *    slot (the shipped "2 columns silently became 4, content scrambled" bug).
 *    Each ownsChildren tool must carry a render-side rogue-child defense —
 *    either it renders ONLY children of its owned type, or it renders from its
 *    own model and evicts children the model does not back. Registered per tool
 *    in RENDER_DEFENSE so a NEW container tool cannot ship without one.
 */

const SRC_ROOT = join(__dirname, '../../../src');
const TOOLS_ROOT = join(SRC_ROOT, 'tools');
const COMPOSERS_ROOT = join(SRC_ROOT, 'components/modules/blockEvents/composers');

/**
 * Tools that claim existing blocks but whose children are still free user
 * content, with the reason. Keys are paths relative to src/tools/.
 */
const EXEMPTIONS: Record<string, string> = {};

/**
 * A tool taking an EXISTING block and making it its own child: the fingerprint
 * of a managed child registry (a table's cell blocks, a column_list's columns).
 */
const CLAIMS_EXISTING_CHILD = /setBlockParent\(\s*[^,)]+,\s*this\.[A-Za-z]*[Bb]lockId\b/;

const OWNS_CHILDREN_DECLARATION = /static\s+get\s+ownsChildren\s*\(\s*\)\s*:\s*boolean\s*\{[^}]*return\s+true/;

/**
 * The render-side rogue-child defense each ownsChildren tool must carry, keyed by
 * tool directory. `pattern` is a fingerprint of the defense in the tool's source;
 * `mechanism` documents WHAT it is so a reviewer can verify the fingerprint still
 * means what it claims. Adding a new ownsChildren tool WITHOUT an entry here fails
 * the law — forcing the author to build (and name) the defense, not discover its
 * absence in production.
 */
const RENDER_DEFENSE: Record<string, { pattern: RegExp; mechanism: string }> = {
  'column-list': {
    // rendered() mounts/resizes ONLY children whose tool name is `column`, so a
    // rogue non-column child can never render as a phantom extra column.
    pattern: /\.filter\(\s*\w+\s*=>\s*\w+\.name\s*===\s*COLUMN_TOOL\b/,
    mechanism: 'rendered() renders only children whose name === COLUMN_TOOL',
  },
  table: {
    // The grid renders from the model by coordinate; removeGhostChildren() then
    // deletes any child the model does not place in a cell (findCellForBlock null).
    pattern: /findCellForBlock\(\s*\w+\.id\s*\)\s*===\s*null/,
    mechanism: 'removeGhostChildren() evicts children not referenced by any cell',
  },
};

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
};

/**
 * Strips line and block comments so a call named only in prose — including this
 * law's own explanations inside the source it guards — is never counted.
 * @param source - raw TypeScript source
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * The directory directly under src/tools/ that owns a file — the unit a tool
 * class is declared in (`table/table-cell-blocks.ts` → `table`). Shared helpers
 * sitting directly in src/tools/ belong to no tool and are skipped.
 * @param file - absolute path to a source file
 */
const toolDirOf = (file: string): string | null => {
  const [dir, ...rest] = relative(TOOLS_ROOT, file).split('/');

  return rest.length > 0 && dir !== undefined ? dir : null;
};

describe('ARCHITECTURE LAW: tool-owned children are never an indent target', () => {
  describe('tools declare ownsChildren', () => {
    const claimingTools = new Map<string, string[]>();

    for (const file of collectSourceFiles(TOOLS_ROOT)) {
      const relPath = relative(TOOLS_ROOT, file);

      if (relPath in EXEMPTIONS) {
        continue;
      }

      if (!CLAIMS_EXISTING_CHILD.test(stripComments(readFileSync(file, 'utf8')))) {
        continue;
      }

      const dir = toolDirOf(file);

      if (dir === null) {
        continue;
      }

      claimingTools.set(dir, [...(claimingTools.get(dir) ?? []), relPath]);
    }

    it('finds the known container tools (the scan is not vacuous)', () => {
      expect([...claimingTools.keys()].sort()).toEqual(['column-list', 'table']);
    });

    it.each([...claimingTools.entries()])(
      '%s declares `static get ownsChildren(): boolean { return true }`',
      (dir, claimSites) => {
        const source = readFileSync(join(TOOLS_ROOT, dir, 'index.ts'), 'utf8');

        expect(
          OWNS_CHILDREN_DECLARATION.test(source),
          `${dir} claims existing blocks as its own children (${claimSites.join(', ')}), so its ` +
          `contentIds are a managed registry. ${dir}/index.ts must declare ownsChildren = true, ` +
          'or core will let the user Tab an outside block into it. If this tool actually hosts ' +
          'free user content, add it to EXEMPTIONS with the reason.'
        ).toBe(true);
      }
    );
  });

  describe('core enforces it in one place', () => {
    const NESTING_CALLERS = ['keyboardNavigation.ts', 'blockSelectionKeys.ts'];

    it.each(NESTING_CALLERS)('%s resolves its indent target via getIndentTarget', (file) => {
      const source = stripComments(readFileSync(join(COMPOSERS_ROOT, file), 'utf8'));

      expect(source).toContain('getIndentTarget(');
      expect(
        source.includes('getPrecedingSibling('),
        `${file} must nest through getIndentTarget (which consults ownsChildren), not the raw ` +
        'getPrecedingSibling — that is how a table becomes an indent target again.'
      ).toBe(false);
    });

    it('getIndentTarget is the only place that consults ownsChildren for nesting', () => {
      const source = stripComments(readFileSync(join(COMPOSERS_ROOT, 'structural-siblings.ts'), 'utf8'));

      expect(source).toMatch(/getIndentTarget[\s\S]*ownsChildren/);
    });
  });

  describe('ownsChildren tools defend their render against a rogue child', () => {
    // Every tool directory whose index.ts DECLARES ownsChildren — the precise
    // trigger for needing a render defense (its children are rendered as slots).
    const declaringDirs = (): string[] => {
      const dirs = new Set<string>();

      for (const file of collectSourceFiles(TOOLS_ROOT)) {
        if (!file.endsWith('/index.ts')) {
          continue;
        }

        if (!OWNS_CHILDREN_DECLARATION.test(readFileSync(file, 'utf8'))) {
          continue;
        }

        const dir = toolDirOf(file);

        if (dir !== null) {
          dirs.add(dir);
        }
      }

      return [...dirs].sort();
    };

    const ownsChildrenDirs = declaringDirs();

    it('finds the known ownsChildren tools (the scan is not vacuous)', () => {
      expect(ownsChildrenDirs).toEqual(['column-list', 'table']);
    });

    it.each(ownsChildrenDirs)(
      '%s carries the render-side rogue-child defense registered in RENDER_DEFENSE',
      (dir) => {
        const defense = RENDER_DEFENSE[dir];

        expect(
          defense,
          `${dir}/index.ts declares ownsChildren, so it renders its children as structural slots. ` +
          'It MUST defend that render against a rogue non-owned child (render only the owned type, ' +
          'or render from a model and evict children the model does not back) — otherwise a rogue ' +
          'child adopted via raw setBlockParent, drag, paste, or a corrupt saved document renders as ' +
          'a phantom slot. Register its defense fingerprint + mechanism in RENDER_DEFENSE.'
        ).toBeDefined();

        const source = collectSourceFiles(join(TOOLS_ROOT, dir))
          .map((file) => stripComments(readFileSync(file, 'utf8')))
          .join('\n');

        expect(
          defense.pattern.test(source),
          `${dir}'s registered rogue-child defense (${defense.mechanism}) was not found in its ` +
          'source — the render-side guard is missing or was refactored away. Restore it, or update ' +
          'RENDER_DEFENSE to fingerprint the replacement defense.'
        ).toBe(true);
      }
    );
  });
});
