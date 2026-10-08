import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoLeakedCoreTypeImports } from '../../../scripts/angular-staging-guard.mjs';

const script = readFileSync(join(__dirname, '../../../scripts/build-angular.mjs'), 'utf-8');

describe('build-angular staging', () => {
  it('applies rewriteTypeImports to every staged shared/**/*.ts file', () => {
    // src/shared is staged wholesale via cpSync; without a rewrite pass the
    // fail-loud guard throws on any shared file importing from '../../types'
    // (e.g. shared/output-data.ts). The walk must recurse: shared/rich-text/
    // files import '../../../types'.
    expect(script).toMatch(
      /for \(const (\w+) of readdirSync\(path\.resolve\(stagingDir, 'shared'\), \{ recursive: true \}\)\)[\s\S]{0,200}?rewriteTypeImports\(path\.resolve\(stagingDir, 'shared', \1\)\);/
    );
  });

  it('applies rewriteTypeImports to every staged angular/*.ts file', () => {
    // The adapter sources import repo-root types through the `@/types` alias.
    // Naming the files to rewrite ONE BY ONE means every new adapter file
    // silently ships an unresolvable '@/types' import (blok-instance.ts and
    // block-portal-registry.ts each broke the ng-packagr build that way), so
    // the rewrite must run inside the loop over the staged angular directory.
    // `staged` is the per-entry path bound by the loop over the staged angular
    // directory, so rewriting it means every file gets the pass.
    expect(script).toMatch(/for \(const entry of readdirSync\(path\.resolve\(stagingDir, 'angular'\)/);
    expect(script).toMatch(/rewriteTypeImports\(staged\);/);
    // …and no per-file call may remain, or the loop is not the single source.
    expect(script).not.toMatch(/rewriteTypeImports\(path\.resolve\(stagingDir, 'angular\//);
  });

  it('derives the staged adapters contract from src/adapters.ts', () => {
    // A hand-copied duplicate of src/adapters.ts's re-export list drifts the
    // moment core adds one (this is how `BlockChildrenMounted` went missing).
    expect(script).toMatch(/readFileSync\(path\.resolve\(root, 'src\/adapters\.ts'\), 'utf8'\)/);
  });
});

describe('the leftover core type import guard', () => {
  const roots: string[] = [];

  /** Writes files under a fresh staging dir. Keys are paths relative to it. */
  const stage = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'blok-angular-staging-'));
    const stagingDir = join(root, 'staging');

    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(stagingDir, path)), { recursive: true });
      writeFileSync(join(stagingDir, path), content);
    }

    return stagingDir;
  };

  afterEach(() => {
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('throws for a shared file that still imports the repo-root types', () => {
    const stagingDir = stage({
      'shared/output-data.ts': "import type { OutputData } from '../../types';\nexport type X = OutputData;\n",
    });

    expect(() => assertNoLeakedCoreTypeImports(stagingDir)).toThrow(/Leftover core type import.*shared\/output-data\.ts/);
  });

  // A staged sibling at the right path must not hide a real leak that climbs out of staging.
  it('throws for a leak even when the climbed-out path exists on disk', () => {
    const stagingDir = stage({ 'shared/a.ts': "import type { T } from '../../types/t';\n" });

    // '../../types/t' from staging/shared/ is <root>/types/t, outside staging, like the repo-root types/.
    mkdirSync(join(stagingDir, '..', 'types'), { recursive: true });
    writeFileSync(join(stagingDir, '..', 'types', 't.ts'), 'export type T = string;\n');

    expect(() => assertNoLeakedCoreTypeImports(stagingDir)).toThrow(/Leftover core type import/);
  });

  it('passes a staged sibling module named types', () => {
    const stagingDir = stage({
      'shared/table/types.ts': 'export const isCellWithBlocks = (): boolean => true;\n',
      'shared/tool-actions/table.ts': "import { isCellWithBlocks } from '../table/types';\nexport const x = isCellWithBlocks;\n",
    });

    expect(() => assertNoLeakedCoreTypeImports(stagingDir)).not.toThrow();
  });
});
