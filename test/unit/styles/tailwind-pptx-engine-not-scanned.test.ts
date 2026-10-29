import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const STYLES_ENTRY = resolve(REPO_ROOT, 'src/styles/main.css');

/**
 * The pptx engine writes inline styles only. Its style strings carry words such
 * as `isolate` and `mask-repeat`, which Tailwind's content scan would turn into
 * real utilities in the editor's main stylesheet.
 */
describe('Tailwind content scan', () => {
  it('skips the pptx engine source', async () => {
    const compiler = await compile(readFileSync(STYLES_ENTRY, 'utf8'), {
      base: dirname(STYLES_ENTRY),
      onDependency: () => undefined,
    });

    const excluded = compiler.sources
      .filter((source) => source.negated)
      .map((source) => resolve(source.base, source.pattern));

    expect(excluded).toContain(resolve(REPO_ROOT, 'src/tools/file/pptx'));
  });
});
