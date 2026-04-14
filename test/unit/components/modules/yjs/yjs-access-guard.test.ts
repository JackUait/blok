import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { resolve, relative } from 'node:path';

/**
 * Architecture guard: prevent the table-row-removal bug class from ever
 * reappearing via raw Yjs access.
 *
 * Background:
 *   The original bug was caused by `BlockObserver.mapTransactionOrigin`
 *   misclassifying a local `'no-capture'` write as `'remote'`, which then
 *   made `BlockYjsSync.handleYjsUpdate` call `block.setData(staleYjsData)`
 *   on an authoring block mid-operation. Layer 1 of the fix: exhaustive
 *   switch over `LOCAL_ORIGIN_TAGS` in `BlockObserver`.
 *
 * This test is layer 2: it enforces at build time that no module outside
 * `DocumentStore` writes to the raw Y.Doc or to a raw Y.Array/Y.Map outside
 * an explicit `transact` wrapper. Any future contributor who introduces a
 * raw `ydoc.transact(fn, 'my-origin')` call bypasses the `LocalOriginTag`
 * type barrier and can silently re-create the class of bugs the origin
 * whitelist exists to prevent.
 *
 * If this test fails, fix the offending file by routing the write through
 * `DocumentStore.transact` or `DocumentStore.transactWithoutCapture` instead
 * of accessing the raw Y.Doc.
 */
describe('Architecture: raw Yjs access guard', () => {
  const repoRoot = resolve(__dirname, '../../../../../');
  const srcFiles = globSync('src/**/*.ts', {
    cwd: repoRoot,
    absolute: true,
    ignore: ['src/**/*.d.ts'],
  });

  const DOCUMENT_STORE_PATH = resolve(repoRoot, 'src/components/modules/yjs/document-store.ts');

  it('no module outside DocumentStore calls `.ydoc.transact(`', () => {
    const offenders: string[] = [];

    for (const file of srcFiles) {
      if (file === DOCUMENT_STORE_PATH) {
        continue;
      }

      const source = readFileSync(file, 'utf8');

      if (/\.ydoc\.transact\s*\(/.test(source)) {
        offenders.push(relative(repoRoot, file));
      }
    }

    expect(
      offenders,
      `Raw ydoc.transact() found — route through DocumentStore.transact/transactWithoutCapture instead:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('DocumentStore.ydoc is not declared public', () => {
    const source = readFileSync(DOCUMENT_STORE_PATH, 'utf8');

    // The only permitted forms are `private readonly ydoc` or a bare
    // `readonly ydoc` (TS defaults class fields to public, so bare is
    // disallowed — explicit `private` is required).
    const publicMatch = source.match(/public\s+readonly\s+ydoc\b/);

    expect(
      publicMatch,
      'DocumentStore.ydoc must be `private readonly` — exposing it gives ' +
        'callers a way to bypass the LocalOriginTag type barrier and ' +
        'reintroduce the table-row-removal bug class.'
    ).toBeNull();

    expect(source).toMatch(/private\s+readonly\s+ydoc\b/);
  });
});
