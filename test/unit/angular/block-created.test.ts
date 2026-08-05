/**
 * C3 (adapter half), Angular mirror: `onCreated` is the seeding hook. It encodes
 * the create-vs-restore predicate once, in the adapter, so a container never has
 * to re-derive it from `origin` — and never reaches for `origin === 'user'`,
 * which silently drops `api.blocks.insert('steps')` and turn-into.
 *
 * Fired only for the CREATION origins (`user`, `api`, `convert`, and an absent
 * origin), never for a restore (`load`, `replay`, `paste`) or the off-tree
 * `probe`, and never before the component has mounted.
 */
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  viewChild,
  type AfterViewInit,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAngularBlock } from '../../../packages/angular/src/createAngularBlock';
import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/angular/src/block-portal-registry';
import type { BlockAPI } from '../../../types/api';
import type { API, BlockOrigin, BlockToolConstructorOptions, BlockToolData } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

/** A container component that mounts the child holders into its own slot. */
@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  template: '<div #slot></div>',
})
class StepsProbe implements AfterViewInit {
  public readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<
    Record<string, never>
  >;

  private readonly slot = viewChild.required<ElementRef<HTMLElement>>('slot');

  public ngAfterViewInit(): void {
    this.ctx.mountChildren(this.slot().nativeElement);
  }
}

/** A fake child block: just the id + holder `mountChildBlocks` moves around. */
const makeChild = (id: string): BlockAPI => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  return { id, holder } as unknown as BlockAPI;
};

/** A container BlockAPI whose children the test controls. */
const makeContainerApi = (children: BlockAPI[]): BlockAPI =>
  ({
    id: 'container',
    contentIds: children.map(child => child.id),
    getChildren: () => children,
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI);

/** A fake editor api with a spying events bus. */
const makeApi = (): API =>
  ({
    blocks: { isPointerDragActive: false },
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  } as unknown as API);

describe('createAngularBlock onCreated', () => {
  let registry: BlockPortalRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
    registry = createBlockPortalRegistry(
      TestBed.inject(EnvironmentInjector),
      TestBed.inject(ApplicationRef),
      TestBed.inject(ErrorHandler)
    );
  });

  afterEach(() => {
    registry.destroyAll();
    vi.restoreAllMocks();
  });

  it('fires once for a user creation, after the component mounted, with the origin and api', () => {
    const children = [makeChild('a')];
    /** Slot child count observed inside the hook (-1 = the slot did not exist). */
    const slotChildrenAtCall: number[] = [];
    const onCreated = vi.fn((block: BlockAPI) => {
      const slot = block.holder.querySelector('[data-blok-nested-blocks]');

      slotChildrenAtCall.push(slot === null ? -1 : slot.children.length);
    });

    const Tool = createAngularBlock({
      type: 'ng-steps',
      propSchema: {},
      component: StepsProbe,
      onCreated,
    });

    const api = makeApi();
    const blockApi = makeContainerApi(children);
    const holder = document.createElement('div');

    Object.defineProperty(blockApi, 'holder', { value: holder, configurable: true });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: blockApi,
      api,
      readOnly: false,
      origin: 'user',
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    holder.appendChild(tool.render());
    document.body.appendChild(holder);

    // Never while core is still inside render() — the signal rides the mount.
    expect(onCreated).not.toHaveBeenCalled();

    tool.rendered();
    // A second rendered() (core re-runs the hook for a re-materialised block)
    // must not repeat a creation signal.
    tool.rendered();

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(blockApi, { origin: 'user', api });
    // The child holders are already adopted, so a seeding hook reads real children.
    expect(slotChildrenAtCall).toEqual([1]);

    holder.remove();
  });

  it.each<[BlockOrigin | undefined, boolean]>([
    ['user', true],
    ['api', true],
    ['convert', true],
    [undefined, true],
    ['load', false],
    ['replay', false],
    ['paste', false],
    ['probe', false],
  ])('origin %s → onCreated fired: %s', (origin, expected) => {
    const onCreated = vi.fn();
    const Tool = createAngularBlock({
      type: 'ng-card',
      propSchema: {},
      component: StepsProbe,
      onCreated,
    });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      ...(origin === undefined ? {} : { origin }),
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    tool.rendered();

    expect(onCreated).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it('stays silent when no portal registry ever mounted the component', () => {
    const onCreated = vi.fn();
    const Tool = createAngularBlock({
      type: 'ng-card',
      propSchema: {},
      component: StepsProbe,
      onCreated,
    });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      origin: 'user',
      config: {},
    } as BlockToolConstructorOptions);

    tool.render();
    tool.rendered();

    expect(onCreated).not.toHaveBeenCalled();
  });

  it('fires after onMounted, so a seeding hook sees whatever onMounted set up', () => {
    const order: string[] = [];
    const Tool = createAngularBlock({
      type: 'ng-card',
      propSchema: {},
      component: StepsProbe,
      onMounted: () => order.push('mounted'),
      onCreated: () => order.push('created'),
    });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      origin: 'user',
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    tool.rendered();

    expect(order).toEqual(['mounted', 'created']);
  });
});
