/**
 * Adapter parity law for the per-child decoration channel.
 *
 * Child holders MUST stay direct children of a container's slot — core's
 * reparenting looks for the next sibling whose `holder.parentElement` IS the
 * container, and caret navigation decides "same container" by that identity — so
 * decoration is expressed as ATTRIBUTES, never as wrapper elements. Core's
 * child-holder decoration law blesses two levels for that: the child's holder and
 * the child's `[data-blok-element-content]` wrapper.
 *
 * Only the holder half used to be reachable, so a container aligning anything to
 * a child's CONTENT box had to encode core's wrapper chain in its own CSS
 * (`[data-step] > [data-blok-element-content] > …`) — engine DOM structure
 * hard-coded in host stylesheets, which breaks silently whenever that chain
 * changes.
 *
 * The law: ONE implementation of the decoration pass, in the shared core, wired
 * by all three adapters — the pass had been copy-pasted into each of them, which
 * is exactly how "React clears a dropped hook but Vue doesn't" happens.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

const ADAPTER_SOURCES = [
  'packages/react/src/createReactBlock.tsx',
  'packages/vue/src/createVueBlock.ts',
  'packages/angular/src/createAngularBlock.ts',
];

describe('per-child decoration — adapter parity', () => {
  it('the decoration pass lives in the shared core', () => {
    const shared = read('src/tools/child-decoration.ts');

    expect(shared).toContain('export const applyChildDecoration');
    expect(shared).toContain('export const createChildDecorationLedger');

    // The content wrapper is found by DOCUMENT ORDER, not by walking direct
    // children: block tunes wrap the content node, so it is not reliably a child
    // of the holder. Assert on the resolver's body, not on the prose above it.
    const resolver = /const contentWrapperOf =[\s\S]*?;\n/.exec(shared)?.[0] ?? '';

    expect(resolver, 'no contentWrapperOf resolver found').not.toBe('');
    expect(resolver).toContain('querySelector');
    expect(resolver).not.toContain('firstElementChild');
    expect(resolver).not.toContain('children');
  });

  it.each(ADAPTER_SOURCES)('%s uses the shared pass instead of its own copy', (path) => {
    const source = read(path);

    expect(source, `${path} does not call the shared pass`).toContain('applyChildDecoration');
    expect(
      source,
      `${path} still carries its own copy of the decoration pass — the three will drift`
    ).not.toMatch(/const applyChildAttributes\s*=/);
  });

  it.each(ADAPTER_SOURCES)('%s exposes the content-wrapper half', (path) => {
    expect(read(path), `${path} has no childContentAttributes channel`)
      .toContain('childContentAttributes');
  });

  it.each([
    ['packages/react/types/index.d.ts'],
    ['packages/vue/types/index.d.ts'],
    ['packages/angular/src/block-context.ts'],
  ])('%s publishes the content-wrapper half', (path) => {
    expect(read(path), `${path} does not publish childContentAttributes`)
      .toContain('childContentAttributes');
  });
});
