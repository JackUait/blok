import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
// The vocabulary module owns the labels; its unit test pins them by quoting them.
const ALLOWED = new Set(['access-vocabulary.ts', 'access-vocabulary.test.ts']);

/**
 * Role / level labels as shown in the UI. Assembled without contiguous literals
 * so this file itself does not violate the law it enforces.
 */
const FORBIDDEN = [
  ['A', 'dministrateur'].join(''),
  ['M', 'embre'].join(''),
  ['L', 'ecteur'].join(''),
  ['L', 'ecture seule'].join(''),
  ['P', 'eut voir'].join(''),
  ['P', 'eut modifier'].join(''),
  ['A', 'ccès complet'].join(''),
];

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) return collect(path);
    if (!/\.(ts|tsx|js|mjs)$/.test(entry)) return [];
    if (ALLOWED.has(basename(path))) return [];
    return [path];
  });
}

describe('self-host product — role labels live in access-vocabulary', () => {
  it('contains no hard-coded French role/level labels outside access-vocabulary.ts', () => {
    const hits = collect(SRC).flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.flatMap((line, index) => {
        // Plural panel title "Membres" is not the singular role label.
        const probed = line.replaceAll(/Membres/g, '·······');
        return FORBIDDEN.filter((label) => probed.includes(label))
          .map((label) => `${relative(SRC, file)}:${index + 1}: ${label} ← ${line.trim()}`);
      });
    });
    expect(hits).toEqual([]);
  });
});
