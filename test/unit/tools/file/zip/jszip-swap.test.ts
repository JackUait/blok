import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(__dirname, '../../../../..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  resolutions?: Record<string, string>;
};
const lockfile = readFileSync(resolve(ROOT, 'yarn.lock'), 'utf8');

// Blok reads zips with src/tools/file/zip; nothing in the tree imports jszip any more.
describe('jszip is gone', () => {
  it('has no jszip dependency, resolution or stand-in package', () => {
    expect(manifest.dependencies?.jszip).toBeUndefined();
    expect(manifest.devDependencies?.jszip).toBeUndefined();
    expect(manifest.resolutions?.jszip).toBeUndefined();
    expect(existsSync(resolve(ROOT, 'shims/jszip'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/tools/file/zip/jszip-shim.ts'))).toBe(false);
  });

  it.each(['jszip@', 'pako@npm:', 'lie@npm:', 'setimmediate@npm:'])('locks no %s package', (descriptor) => {
    expect(lockfile).not.toContain(`"${descriptor}`);
  });
});
