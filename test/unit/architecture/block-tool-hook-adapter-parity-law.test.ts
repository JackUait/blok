/**
 * Adapter parity law for the optional BlockTool instance hooks core asks.
 *
 * A framework block is a generated class, so a hook core asks on the tool
 * instance (`isReadOnly`, `isDataReadOnly`, ...) reaches it only if the factory
 * forwards it to the spec. Nothing else ties the adapters to core's contract:
 * a hook added to `types/tools/block-tool.d.ts` and forwarded by one adapter
 * silently does nothing in the others. Add a new core hook here when you
 * forward it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

const HOOKS = ['isReadOnly', 'isDataReadOnly', 'onNavigationEnter', 'getToolbarAnchorElement'];

const FACTORIES = [
  'packages/react/src/createReactBlock.tsx',
  'packages/vue/src/createVueBlock.ts',
  'packages/angular/src/createAngularBlock.ts',
];

const PUBLISHED_SPECS = [
  'packages/react/types/index.d.ts',
  'packages/vue/types/index.d.ts',
];

describe('core BlockTool hooks reach every framework adapter', () => {
  it.each(HOOKS)('core declares %s on BlockTool', (hook) => {
    expect(read('types/tools/block-tool.d.ts')).toMatch(new RegExp(`\\n\\s+${hook}\\?\\(`));
  });

  it.each(FACTORIES.flatMap((path) => HOOKS.map((hook) => [path, hook])))('%s forwards %s', (path, hook) => {
    const source = read(path);

    expect(source, `${path} has no ${hook} method on the generated class`).toMatch(new RegExp(`public ${hook}\\(`));
    expect(source, `${path} has no ${hook} in its spec`).toMatch(new RegExp(`\\n\\s+${hook}\\?: \\(`));
  });

  it.each(PUBLISHED_SPECS.flatMap((path) => HOOKS.map((hook) => [path, hook])))('%s publishes %s', (path, hook) => {
    expect(read(path), `${path} does not publish ${hook}`).toMatch(new RegExp(`\\n\\s+${hook}\\?: \\(`));
  });
});
