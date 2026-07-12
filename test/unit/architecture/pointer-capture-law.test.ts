/**
 * Architectural enforcement: the Pointer-Capture Cancel Law.
 *
 * `element.setPointerCapture(id)` redirects every subsequent pointer event for
 * that pointer to the capturing element. The trap: WITH POINTER CAPTURE THE
 * BROWSER FIRES `pointercancel` INSTEAD OF `pointerup` whenever it takes the
 * gesture over — a touch pan, a browser gesture, the pointer device being
 * disconnected, or the captured element being removed from the DOM.
 *
 * A drag subsystem that only listens for `pointerup` therefore leaks on cancel:
 * its `isDragging` flag stays true, its document listeners stay attached,
 * `user-select: none` stays on the page, and — worst — the commit callback that
 * runs on pointerup NEVER RUNS, so the mid-drag DOM mutations are never written
 * back to the model. That is exactly what the table's column resizer did
 * (src/tools/table/table-resize.ts): a cancelled touch drag left the columns
 * visually resized while the model kept the old widths, and the next render
 * silently reverted them.
 *
 * The law: every source file that calls `setPointerCapture` must also handle
 * `pointercancel`. Mechanically scanned below — a new drag subsystem cannot
 * dodge it. Exemptions require a stated reason.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

/**
 * Files that call setPointerCapture but legitimately do not need a
 * pointercancel handler. Each entry MUST say why.
 */
const EXEMPTIONS: Record<string, string> = {};

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      return listSourceFiles(full);
    }

    return full.endsWith('.ts') ? [full] : [];
  });

const capturingFiles = (): string[] =>
  listSourceFiles(SRC_DIR)
    .filter(file => readFileSync(file, 'utf-8').includes('setPointerCapture('))
    .map(file => relative(REPO_ROOT, file))
    .sort();

describe('pointer-capture cancel law', () => {
  const files = capturingFiles();

  it('finds the pointer-capturing drag subsystems (guard against a silent no-op scan)', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('src/tools/table/table-resize.ts');
  });

  it.each(files)('%s handles pointercancel', file => {
    const exemption = EXEMPTIONS[file];

    if (exemption !== undefined) {
      expect(exemption.length, `${file} exemption must state a reason`).toBeGreaterThan(0);

      return;
    }

    const source = readFileSync(resolve(REPO_ROOT, file), 'utf-8');

    expect(
      source.includes('pointercancel'),
      `${file} calls setPointerCapture but never handles pointercancel — a cancelled gesture ` +
      'will leave the drag state dangling and skip the commit callback'
    ).toBe(true);
  });
});
