/**
 * Adapter parity law for the toolbar-anchor channel.
 *
 * Core's `getToolbarAnchorElement()` is DOM-only, and the adapters exposed it as
 * `(host, block) => HTMLElement` — resolved OUTSIDE the component tree. A
 * framework block therefore could not hand back the element it renders; the only
 * way to name one was to stamp a self-invented attribute in the template and
 * `querySelector` for it from the spec hook, in every block that needed an
 * anchor.
 *
 * The fix is a channel FROM inside the component: `toolbarAnchorRef` (React,
 * Vue) and `ctx.setToolbarAnchor` (Angular, which has no ref props). All three
 * must have it — an ergonomic escape hatch present in one adapter and not the
 * others is exactly the drift the shared contract exists to prevent — and the
 * hand-authored published `.d.ts` files must declare it, or it is unreachable
 * for a TypeScript consumer.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

describe('toolbar anchor from inside the component — adapter parity', () => {
  it.each([
    ['packages/react/src/createReactBlock.tsx', 'toolbarAnchorRef'],
    ['packages/vue/src/createVueBlock.ts', 'toolbarAnchorRef'],
    ['packages/angular/src/block-context.ts', 'setToolbarAnchor'],
  ])('%s offers %s', (path, member) => {
    expect(read(path), `${path} has no ${member} channel`).toContain(member);
  });

  it.each([
    ['packages/react/src/createReactBlock.tsx'],
    ['packages/vue/src/createVueBlock.ts'],
    ['packages/angular/src/createAngularBlock.ts'],
  ])('%s refuses a DETACHED anchor rather than positioning against a zero rect', (path) => {
    const source = read(path);
    const anchorImpl = /getToolbarAnchorElement\(\): HTMLElement \| undefined \{[\s\S]*?\n {4}\}/.exec(source)?.[0] ?? '';

    expect(anchorImpl, `${path} does not implement getToolbarAnchorElement`).not.toBe('');
    expect(anchorImpl, `${path} hands back the ref without an isConnected guard`)
      .toContain('isConnected');
  });

  it.each([
    ['packages/react/types/index.d.ts', 'toolbarAnchorRef'],
    ['packages/vue/types/index.d.ts', 'toolbarAnchorRef'],
  ])('%s publishes %s', (path, member) => {
    expect(read(path), `${path} does not publish ${member}`).toContain(member);
  });
});
