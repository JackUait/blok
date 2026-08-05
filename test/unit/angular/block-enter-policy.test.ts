/**
 * B1 (adapter half), Angular mirror: `keepsChildrenOnEnter` is the per-tool
 * Enter policy a custom container declares so Enter on its empty LAST child
 * stays INSIDE it instead of escaping to the container's parent.
 *
 * The adapter exposes it through the generic `statics` passthrough rather than a
 * bespoke spec field, so this pins the WHOLE path — generated class → core's
 * `BlockToolAdapter`, which is where the Enter composer actually reads it. A
 * generic "statics are copied onto the class" assertion does not cover that
 * boundary: the flag also has to survive `BlockToolStatics`' Omit and the
 * adapter's reserved-statics filter.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createAngularBlock } from '../../../packages/angular/src/createAngularBlock';
import { BlockToolAdapter } from '../../../src/components/tools/block';
import type { ToolConstructable } from '../../../types/tools';

type AdapterOptions = ConstructorParameters<typeof BlockToolAdapter>[0];

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  template: '<div></div>',
})
class StepsProbe {}

/** Wrap a generated tool class the way core's Tools module does. */
const asCoreTool = (constructable: ToolConstructable): BlockToolAdapter =>
  new BlockToolAdapter({
    name: 'ng-steps',
    constructable,
    config: {},
    api: {} as AdapterOptions['api'],
    isDefault: false,
    isInternal: false,
  });

const buildSteps = (keepsChildrenOnEnter: boolean | undefined): ToolConstructable =>
  createAngularBlock({
    type: 'ng-steps',
    propSchema: {},
    component: StepsProbe,
    ...(keepsChildrenOnEnter === undefined ? {} : { statics: { keepsChildrenOnEnter } }),
  }) as unknown as ToolConstructable;

describe('angular Enter policy reaches core through the statics passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a declared keepsChildrenOnEnter is what core reads off the tool', () => {
    expect(asCoreTool(buildSteps(true)).keepsChildrenOnEnter).toBe(true);
  });

  it('a block that declares nothing keeps the default escape', () => {
    expect(asCoreTool(buildSteps(undefined)).keepsChildrenOnEnter).toBe(false);
  });

  it('an explicit false is honoured, not treated as "declared"', () => {
    expect(asCoreTool(buildSteps(false)).keepsChildrenOnEnter).toBe(false);
  });

  it('carries the container statics together without shadowing the factory-owned ones', () => {
    const tool = asCoreTool(
      createAngularBlock({
        type: 'ng-steps',
        propSchema: {},
        component: StepsProbe,
        statics: { ownsChildren: true, keepsChildrenOnEnter: true },
      }) as unknown as ToolConstructable
    );

    expect(tool.ownsChildren).toBe(true);
    expect(tool.keepsChildrenOnEnter).toBe(true);
    expect(tool.isReadOnlySupported).toBe(true);
  });
});
