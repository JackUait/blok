import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Risk R1 guard: the entire Vue adapter is authored as `.ts` render functions,
 * never `.vue` Single-File-Components. An SFC would drag back `@vitejs/plugin-vue`
 * + `vue-tsc` + a dedicated Vitest project AND re-adopt the vitest #9855
 * descriptorCache cross-poisoning landmine. Fail loudly if one ever appears.
 */
const collectFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? collectFiles(full) : [full];
  });

describe('Vue adapter no-SFC invariant', () => {
  it('contains zero .vue files under src/vue', () => {
    const vueDir = join(process.cwd(), 'src', 'vue');
    const sfcFiles = collectFiles(vueDir).filter((f) => f.endsWith('.vue'));

    expect(sfcFiles).toEqual([]);
  });
});
