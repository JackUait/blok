/**
 * Adapter parity law for the `useBlocks` reactivity scope.
 *
 * `useBlocks` subscribes to the editor's document-wide `block changed`, so every
 * consumer re-rendered on every change anywhere — a container block that renders
 * only its own children still re-rendered on each keystroke in an unrelated
 * block, and a page of N containers turned one keystroke into N re-renders.
 *
 * The filter lives ONCE, in the shared `changeTouchesSubtree` core, and all three
 * adapters must expose it — a reactivity escape hatch that exists in React but
 * not Vue/Angular is exactly the drift the shared core was built to prevent. The
 * hand-authored published `.d.ts` files must declare it too: a runtime option no
 * declaration mentions is unreachable for a TypeScript consumer (the same way
 * `renderLatex` was).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

describe('useBlocks subtree scope — adapter parity', () => {
  it('the filter lives in the shared core, not in an adapter', () => {
    const shared = read('src/components/utils/blocks-api.ts');

    expect(shared).toContain('export const changeTouchesSubtree');
  });

  it.each([
    ['packages/react/src/useBlocks.ts', 'UseBlocksOptions'],
    ['packages/vue/src/useBlocks.ts', 'UseBlocksOptions'],
    ['packages/angular/src/useBlocks.ts', 'InjectBlocksOptions'],
  ])('%s takes a scope option and applies it through the shared filter', (path, optionsType) => {
    const source = read(path);

    expect(source, `${path} does not declare ${optionsType}`).toContain(`interface ${optionsType}`);
    expect(source, `${path} does not accept a \`within\` scope`).toMatch(/within\?:/);
    expect(source, `${path} re-implements scoping instead of using the shared core`)
      .toContain('changeTouchesSubtree');
  });

  it.each([
    ['packages/react/types/index.d.ts', 'useBlocks'],
    ['packages/vue/types/index.d.ts', 'useBlocks'],
  ])('%s publishes the scope option on %s', (path, fnName) => {
    const declaration = read(path);
    const signature = new RegExp(`declare function ${fnName}\\([^)]*\\)`, 's').exec(declaration)?.[0] ?? '';

    expect(signature, `${path} declares ${fnName} with no options parameter`).toContain('options');
    expect(declaration, `${path} does not publish the scope option type`).toMatch(/within\?:/);
  });
});
