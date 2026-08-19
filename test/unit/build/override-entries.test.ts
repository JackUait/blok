import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { init, parse } from 'es-module-lexer';
import { rollup } from 'rollup';
import { describe, expect, it } from 'vitest';

import { ENTRIES, WRAPPER_MARKER } from '../../../scripts/override/generate-override-entries.mjs';

const dist = resolve(__dirname, '../../../dist');

const exportNames = (path: string): string[] => {
  const [, exports] = parse(readFileSync(path, 'utf8'));
  return exports.map((e) => e.n).sort();
};

describe('dist override wrappers', () => {
  it('wraps every published entry and ships the runtime', async () => {
    await init;
    for (const entry of ENTRIES) {
      for (const ext of entry.formats) {
        const wrapper = join(dist, `${entry.file}.${ext}`);
        const impl = join(dist, `${entry.file}-impl.${ext}`);
        expect(existsSync(impl), `${entry.file}-impl.${ext} missing`).toBe(true);
        expect(readFileSync(wrapper, 'utf8').startsWith(WRAPPER_MARKER), `${entry.file}.${ext} not wrapped`).toBe(true);
      }
    }
    expect(existsSync(join(dist, 'override-runtime.mjs'))).toBe(true);
    expect(existsSync(join(dist, 'override-runtime.cjs'))).toBe(true);
  });

  it('guards exactly the impl export set (no drift)', async () => {
    await init;
    for (const entry of ENTRIES) {
      expect(
        exportNames(join(dist, `${entry.file}.mjs`)),
        `${entry.file}.mjs wrapper exports drifted from impl`
      ).toEqual(exportNames(join(dist, `${entry.file}-impl.mjs`)));
    }
  });

  it('pins the blok→core registry key mapping', () => {
    expect(readFileSync(join(dist, 'blok.mjs'), 'utf8')).toContain(`resolveOverrideEntry('core'`);
  });

  it('keeps the runtime copies in sync with the source', () => {
    const source = readFileSync(resolve(__dirname, '../../../scripts/override/override-runtime.mjs'), 'utf8');
    expect(readFileSync(join(dist, 'override-runtime.mjs'), 'utf8')).toBe(source);
  });

  it('does not regress consumer tree-shaking (probe: import one symbol)', async () => {
    const bundleSize = async (importFrom: string): Promise<number> => {
      const bundle = await rollup({
        input: 'probe',
        plugins: [
          {
            name: 'virtual-probe',
            resolveId: (id: string) => (id === 'probe' ? id : null),
            load: (id: string) =>
              id === 'probe' ? `import { version } from '${join(dist, importFrom)}'; console.log(version);` : null,
          },
        ],
        onwarn: () => undefined,
      });
      const { output } = await bundle.generate({ format: 'es' });
      await bundle.close();
      return output.reduce((sum, chunk) => sum + ('code' in chunk ? chunk.code.length : 0), 0);
    };

    const viaWrapper = await bundleSize('blok.mjs');
    const viaImpl = await bundleSize('blok-impl.mjs');
    // The wrapper may add its own bytes (runtime + guards) but must not defeat
    // tree-shaking of the impl — a failure here means the whole editor got
    // retained for a one-symbol import and shows up as a ~100x blowup.
    expect(viaWrapper).toBeLessThan(viaImpl + 8_192);
  }, 60_000);
});
