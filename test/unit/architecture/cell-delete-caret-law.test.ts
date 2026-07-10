import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — deleting selected blocks must never strand the caret.
 *
 * `BlockManager.deleteSelectedBlocksAndInsertReplacement()` inserts a
 * replacement block ONLY when the whole document was selected (or the caller
 * forces one). For a PARTIAL selection it returns `undefined` and sets no
 * caret. When the deleted blocks lived inside a nested-blocks container (a
 * table cell), focus then falls onto <body> — the user's caret escapes the
 * cell they were editing.
 *
 * This bug shipped precisely because the deletion logic is DUPLICATED across
 * handlers (document-level keydown, block-level keydown, cut, block-settings
 * menu): one copy was fixed, the others silently kept the bug.
 *
 * THE LAW: every call site of `deleteSelectedBlocksAndInsertReplacement` must
 * handle the no-replacement case by calling `scheduleCaretIntoNestedContainer`
 * (from `src/components/utils/nested-container-caret.ts`) in the same file —
 * OR be listed in EXEMPTIONS below with a reason why the caret cannot strand.
 *
 * If this test failed because you added a new call site: capture the common
 * nested container BEFORE deleting (`findCommonNestedContainer`), and when no
 * replacement block is returned, call `scheduleCaretIntoNestedContainer`.
 * See `handleBackspace` in `uiControllers/controllers/keyboard.ts` for the
 * canonical shape.
 */

const SRC_ROOT = join(__dirname, '../../../src');
const DELETE_CALL = 'deleteSelectedBlocksAndInsertReplacement';
const RESTORE_CALL = 'scheduleCaretIntoNestedContainer';
const HELPER_PATH = join(SRC_ROOT, 'components/utils/nested-container-caret.ts');

/**
 * Call-site files exempt from the law, with the reason the caret cannot
 * strand there. Keys are paths relative to src/.
 */
const EXEMPTIONS: Record<string, string> = {
  'components/modules/blockManager/blockManager.ts':
    'Defines the method itself; callers own caret handling.',
  'components/modules/blockSelection.ts':
    'Type-over path passes forceReplacement=true, so a replacement block is ' +
    'ALWAYS returned and the caret is set to it (the table claims it back ' +
    'into the cell via the removed-block cell record).',
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

const findCallSiteFiles = (): string[] => {
  return collectSourceFiles(SRC_ROOT).filter((file) => {
    const source = readFileSync(file, 'utf8');

    return source.includes(`${DELETE_CALL}(`);
  });
};

describe('cell-delete caret law', () => {
  it('the shared caret-restore helper exists (guards against rename breaking the law silently)', () => {
    expect(existsSync(HELPER_PATH)).toBe(true);
    expect(readFileSync(HELPER_PATH, 'utf8')).toContain(`export function ${RESTORE_CALL}`);
  });

  it('finds the known call sites (guards against the scan going stale after a rename)', () => {
    const files = findCallSiteFiles().map((file) => relative(SRC_ROOT, file));

    // The method definition plus at least the four known consumer files.
    // If deleteSelectedBlocksAndInsertReplacement was renamed, update
    // DELETE_CALL above so the law keeps scanning the real call sites.
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files).toContain('components/modules/blockManager/blockManager.ts');
    expect(files).toContain('components/modules/uiControllers/controllers/keyboard.ts');
    expect(files).toContain('components/modules/blockEvents/composers/blockSelectionKeys.ts');
    expect(files).toContain('components/modules/toolbar/blockSettings.ts');
    expect(files).toContain('components/modules/blockSelection.ts');
  });

  it('every call site restores the caret into the nested container (or is exempt with a reason)', () => {
    const violations: string[] = [];

    for (const file of findCallSiteFiles()) {
      const relPath = relative(SRC_ROOT, file);

      if (relPath in EXEMPTIONS) {
        continue;
      }

      const source = readFileSync(file, 'utf8');

      if (!source.includes(`${RESTORE_CALL}(`)) {
        violations.push(relPath);
      }
    }

    expect(
      violations,
      `These files call ${DELETE_CALL} without restoring the caret into the ` +
      `nested-blocks container on the no-replacement path:\n` +
      violations.map((violation) => `  - ${violation}`).join('\n') +
      `\nDeleting a partial block selection inside a table cell there will drop ` +
      `focus onto <body>. Call ${RESTORE_CALL} (see keyboard.ts#handleBackspace) ` +
      `or add an exemption with a reason.`
    ).toEqual([]);
  });

  it('every exemption still points at a real call site (no stale entries)', () => {
    const files = new Set(findCallSiteFiles().map((file) => relative(SRC_ROOT, file)));

    for (const [exemptPath, reason] of Object.entries(EXEMPTIONS)) {
      expect(files.has(exemptPath), `Stale exemption: ${exemptPath} no longer calls ${DELETE_CALL}`).toBe(true);
      expect(reason.length, `Exemption for ${exemptPath} needs a non-trivial reason`).toBeGreaterThan(20);
    }
  });
});
