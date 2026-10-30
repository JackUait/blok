import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const readManifest = (dir: string): { files?: string[]; exports?: unknown } =>
  JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf-8')) as { files?: string[]; exports?: unknown };

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]
  );

describe('adapter pack contents', () => {
  it.each(['packages/react', 'packages/vue'])('%s packs only folders its exports can reach', (dir) => {
    const manifest = readManifest(dir);
    const reachable = JSON.stringify(manifest.exports);
    const unreachable = (manifest.files ?? []).filter((entry) => !reachable.includes(`./${entry}/`));

    expect(unreachable, `${dir} ships folders no import can load`).toEqual([]);
  });

  it('the Angular build strips source maps from what it packs', () => {
    const script = readFileSync(join(repoRoot, 'scripts/build-angular.mjs'), 'utf-8');

    expect(script).toMatch(/sourceMappingURL/);

    const packDir = join(repoRoot, 'packages/angular/dist');

    if (existsSync(packDir)) {
      const files = listFiles(packDir);

      expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
      expect(
        files.filter((file) => file.endsWith('.mjs') && readFileSync(file, 'utf-8').includes('sourceMappingURL'))
      ).toEqual([]);
    }
  });
});
