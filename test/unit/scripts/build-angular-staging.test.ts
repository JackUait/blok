import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(__dirname, '../../../scripts/build-angular.mjs'), 'utf-8');

describe('build-angular staging', () => {
  it('applies rewriteTypeImports to every staged shared/*.ts file', () => {
    // src/shared is staged wholesale via cpSync; without a rewrite pass the
    // fail-loud guard throws on any shared file importing from '../../types'
    // (e.g. shared/output-data.ts).
    expect(script).toMatch(
      /for \(const entry of readdirSync\(path\.resolve\(stagingDir, 'shared'\)[\s\S]{0,200}?rewriteTypeImports\(path\.resolve\(stagingDir, 'shared', entry\.name\)\);/
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
