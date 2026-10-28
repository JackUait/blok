import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = resolve(__dirname, '../../../../..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  resolutions?: Record<string, string>;
};
const lockfile = readFileSync(resolve(ROOT, 'yarn.lock'), 'utf8');

// pptx-renderer depends on jszip itself; without the resolution
// the real jszip (and pako) would quietly come back into the bundle.
describe('jszip is replaced by the in-house shim', () => {
  it('points every jszip import at the shim package', () => {
    expect(manifest.resolutions?.jszip).toBe('portal:./shims/jszip');
  });

  it('does not depend on jszip directly', () => {
    expect(manifest.dependencies?.jszip).toBeUndefined();
    expect(manifest.devDependencies?.jszip).toBeUndefined();
  });

  it.each(['jszip@npm:', 'pako@npm:', 'lie@npm:', 'setimmediate@npm:'])('locks no %s package', (descriptor) => {
    expect(lockfile).not.toContain(`"${descriptor}`);
  });
});
