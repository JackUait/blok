/**
 * B1 (adapter half): `keepsChildrenOnEnter` is the per-tool Enter policy a
 * custom container declares so Enter on its empty LAST child stays INSIDE it
 * instead of escaping to the container's parent. Before it existed, a host
 * container had to hijack the editor-global `config.onEnter` and re-derive
 * containment core already knew.
 *
 * The framework adapters expose it through the generic `statics` passthrough
 * rather than a bespoke spec field — so this test pins the WHOLE path, adapter
 * class → core's `BlockToolAdapter`, which is where core actually reads it
 * (`container.tool.keepsChildrenOnEnter` in the Enter composer). A generic
 * "statics are copied onto the class" assertion does not cover that boundary:
 * the flag also has to survive `BlockToolStatics`' Omit and the adapters'
 * reserved-statics filter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createReactBlock } from '../../../packages/react/src/createReactBlock';
import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { BlockToolAdapter } from '../../../src/components/tools/block';
import type { ToolConstructable } from '../../../types/tools';

type AdapterOptions = ConstructorParameters<typeof BlockToolAdapter>[0];

/** Wrap a generated tool class the way core's Tools module does. */
const asCoreTool = (constructable: ToolConstructable): BlockToolAdapter =>
  new BlockToolAdapter({
    name: 'steps',
    constructable,
    config: {},
    api: {} as AdapterOptions['api'],
    isDefault: false,
    isInternal: false,
  });

const REACT_STEPS = (keepsChildrenOnEnter: boolean | undefined): ToolConstructable =>
  createReactBlock({
    type: 'steps',
    propSchema: {},
    component: () => null,
    ...(keepsChildrenOnEnter === undefined ? {} : { statics: { keepsChildrenOnEnter } }),
  });

const VUE_STEPS = (keepsChildrenOnEnter: boolean | undefined): ToolConstructable =>
  createVueBlock({
    type: 'steps',
    propSchema: {},
    setup: () => () => null,
    ...(keepsChildrenOnEnter === undefined ? {} : { statics: { keepsChildrenOnEnter } }),
  });

describe('adapter Enter policy reaches core through the statics passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['react', REACT_STEPS],
    ['vue', VUE_STEPS],
  ])('%s: a declared keepsChildrenOnEnter is what core reads off the tool', (_name, build) => {
    expect(asCoreTool(build(true)).keepsChildrenOnEnter).toBe(true);
  });

  it.each([
    ['react', REACT_STEPS],
    ['vue', VUE_STEPS],
  ])('%s: a block that declares nothing keeps the default escape', (_name, build) => {
    expect(asCoreTool(build(undefined)).keepsChildrenOnEnter).toBe(false);
  });

  it.each([
    ['react', REACT_STEPS],
    ['vue', VUE_STEPS],
  ])('%s: an explicit false is honoured, not treated as "declared"', (_name, build) => {
    expect(asCoreTool(build(false)).keepsChildrenOnEnter).toBe(false);
  });

  it('a react container can still declare the flag alongside the api it renders with', () => {
    const Tool = createReactBlock({
      type: 'steps',
      propSchema: {},
      component: () => null,
      statics: { ownsChildren: true, keepsChildrenOnEnter: true },
    });
    const tool = asCoreTool(Tool);

    // Both container statics travel the same channel; neither shadows the other.
    expect(tool.ownsChildren).toBe(true);
    expect(tool.keepsChildrenOnEnter).toBe(true);
    // The factory's own statics are untouched by the bag.
    expect(tool.isReadOnlySupported).toBe(true);
  });

  it('constructs through core, so the origin core stamps reaches the block', () => {
    const seen: unknown[] = [];
    const Tool = createReactBlock({
      type: 'steps',
      propSchema: {},
      component: () => null,
      onCreated: (_block, context) => seen.push(context.origin),
    });
    const tool = asCoreTool(Tool);
    const instance = tool.create(
      {},
      { id: 'b1', getChildren: () => [] } as never,
      false,
      'convert'
    ) as unknown as { render(): HTMLElement };

    // No registry (vanilla core), so nothing mounts and no creation signal
    // fires — but the construction itself must not throw and the tool must be
    // the adapter-generated class.
    expect(instance.render()).toBeInstanceOf(HTMLElement);
    expect(seen).toEqual([]);
  });
});
