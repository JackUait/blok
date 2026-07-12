import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — core keyboard handlers must know when they are inside a
 * table cell.
 *
 * A table cell is a nested-blocks container: the blocks inside it are real
 * blocks, so every core keyboard path happily treats them as siblings of the
 * document. That is how Shift+Arrow inside a cell used to start a CROSS-BLOCK
 * selection over the cell's own lines instead of the table's rectangular CELL
 * selection — the core handler simply had no idea it was in a table.
 *
 * THE LAW: every core entry point into `CrossBlockSelection.toggleBlockSelectedState`
 * must be gated by a flag that consults the single named guard
 * `shouldDeferSelectionToTableCell` (which itself builds on
 * `isCurrentBlockInsideTableCell`). Scattering ad-hoc `closest('[data-blok-table-cell-blocks]')`
 * checks at each call site is exactly the drift this law exists to prevent, so
 * the guard must be defined ONCE and reused.
 *
 * If this test fails because you added a new cross-block-selection entry point:
 * gate it on a `shouldEnableCBS`-style flag that ANDs in
 * `!this.shouldDeferSelectionToTableCell`, or add the file to EXEMPTIONS with a
 * reason why a table cell cannot be the caret's container there.
 */

const SRC_ROOT = join(__dirname, '../../../src');
const CBS_CALL = 'CrossBlockSelection.toggleBlockSelectedState';
const GUARD = 'shouldDeferSelectionToTableCell';
const CELL_CONTAINER_ATTR = 'data-blok-table-cell-blocks';
const COMPOSER = 'components/modules/blockEvents/composers/keyboardNavigation.ts';

/**
 * Files that call into cross-block selection but cannot be inside a table cell,
 * with the reason. Keys are paths relative to src/.
 */
const EXEMPTIONS: Record<string, string> = {
  'components/modules/crossBlockSelection.ts':
    'Defines the module itself — it is the callee, not a keyboard entry point.',
};

const collectSourceFiles = (dir: string): string[] => {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return collectSourceFiles(full);
    }

    return full.endsWith('.ts') ? [full] : [];
  });
};

const sourceFiles = collectSourceFiles(SRC_ROOT);

describe('ARCHITECTURE LAW: core keyboard handlers consult the table-cell guard', () => {
  it('defines the guard exactly once, in the keyboard-navigation composer', () => {
    const definitions = sourceFiles.filter((file) =>
      readFileSync(file, 'utf8').includes(`get ${GUARD}(`)
    );

    expect(definitions.map((file) => relative(SRC_ROOT, file))).toEqual([COMPOSER]);
  });

  it('builds the guard on the shared isCurrentBlockInsideTableCell check', () => {
    const source = readFileSync(join(SRC_ROOT, COMPOSER), 'utf8');
    const guardBody = source.slice(source.indexOf(`get ${GUARD}(`));

    expect(guardBody).toContain('isCurrentBlockInsideTableCell');
  });

  it('gates every cross-block-selection call site on the guard', () => {
    const offenders = sourceFiles.flatMap((file) => {
      const relPath = relative(SRC_ROOT, file);

      if (EXEMPTIONS[relPath] !== undefined) {
        return [];
      }

      const source = readFileSync(file, 'utf8');

      if (!source.includes(CBS_CALL)) {
        return [];
      }

      const lines = source.split('\n');

      return lines.flatMap((line, index) => {
        if (!line.includes(CBS_CALL)) {
          return [];
        }

        /**
         * The call must sit under a guard flag. We look back a few lines for the
         * `if (...)` that admits it, and require the file to derive that flag
         * from the table-cell guard.
         */
        const context = lines.slice(Math.max(0, index - 4), index).join('\n');
        const isGated = /shouldEnableCBS/.test(context) && source.includes(GUARD);

        return isGated ? [] : [`${relPath}:${index + 1}`];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('does not scatter raw table-cell container checks across the composer', () => {
    const source = readFileSync(join(SRC_ROOT, COMPOSER), 'utf8');
    const rawChecks = source
      .split('\n')
      .filter((line) => line.includes(CELL_CONTAINER_ATTR))
      // Doc comments may name the attribute; only executable lines count.
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));

    // Only the two shared resolvers (isCurrentBlockInsideTableCell and
    // getTableCellContainer) may name the container attribute directly.
    expect(rawChecks).toHaveLength(2);
  });
});
