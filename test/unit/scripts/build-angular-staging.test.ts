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
});
