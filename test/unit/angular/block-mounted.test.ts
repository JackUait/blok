/**
 * D4 (adapter half), Angular mirror of the React/Vue contract.
 *
 * Angular's portal mounts the component SYNCHRONOUSLY inside `register()`
 * (create + first change detection), so the settled moment is core's
 * `rendered()` hook — one step later than `render()`, with the host in the
 * document and the author's `ngAfterViewInit` (hence `ctx.mountChildren`)
 * already run.
 *
 * - `onMounted(block, { origin, api })` fires ONCE and carries core's
 *   create-vs-restore origin.
 * - `block:childrenMounted` is emitted on the editor bus after the child
 *   holders are mounted into the slot.
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
import type { API, BlockToolConstructorOptions, BlockToolData } from '../../../types';

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
const makeApi = (): API & { events: { emit: ReturnType<typeof vi.fn> } } =>
  ({
    blocks: { isPointerDragActive: false },
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  } as unknown as API & { events: { emit: ReturnType<typeof vi.fn> } });

describe('createAngularBlock post-mount signals', () => {
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

  it('fires onMounted once the mounted DOM (and the child holders) exist', () => {
    const children = [makeChild('a'), makeChild('b')];
    const seen: { slotChildren: number }[] = [];

    const Tool = createAngularBlock({
      type: 'ng-steps',
      propSchema: {},
      component: StepsProbe,
      onMounted: (block) => {
        const slot = block.holder.querySelector('[data-blok-nested-blocks]');

        seen.push({ slotChildren: slot === null ? -1 : slot.children.length });
      },
    });

    const blockApi = makeContainerApi(children);
    const holder = document.createElement('div');

    Object.defineProperty(blockApi, 'holder', { value: holder, configurable: true });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: blockApi,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    holder.appendChild(tool.render());
    document.body.appendChild(holder);

    expect(seen).toHaveLength(0);

    tool.rendered();

    expect(seen).toEqual([{ slotChildren: 2 }]);

    holder.remove();
  });

  it('hands onMounted the construction origin and the editor api, exactly once', () => {
    const onMounted = vi.fn();
    const Tool = createAngularBlock({
      type: 'ng-card',
      propSchema: {},
      component: StepsProbe,
      onMounted,
    });

    const api = makeApi();
    const blockApi = makeContainerApi([]);
    const tool = new Tool({
      data: {} as BlockToolData,
      block: blockApi,
      api,
      readOnly: false,
      origin: 'user',
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    tool.rendered();
    // A second rendered() (core re-runs the hook for a re-materialised block)
    // must not repeat a creation signal.
    tool.rendered();

    expect(onMounted).toHaveBeenCalledTimes(1);
    expect(onMounted).toHaveBeenCalledWith(blockApi, { origin: 'user', api });
  });

  it('stays silent when no portal registry ever mounted the component', () => {
    const onMounted = vi.fn();
    const Tool = createAngularBlock({
      type: 'ng-card',
      propSchema: {},
      component: StepsProbe,
      onMounted,
    });

    // Vanilla-core usage: without the directive there is no registry, so the
    // authored component is never created — "mounted" would be a lie.
    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      config: {},
    } as BlockToolConstructorOptions);

    tool.render();
    tool.rendered();

    expect(onMounted).not.toHaveBeenCalled();
  });

  it('defaults the onMounted origin to api when the caller supplied none', () => {
    const onMounted = vi.fn();
    const Tool = createAngularBlock({
      type: 'ng-card',
      propSchema: {},
      component: StepsProbe,
      onMounted,
    });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    tool.rendered();

    expect(onMounted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'api' })
    );
  });

  it('emits block:childrenMounted once the holders are in the slot', () => {
    const children = [makeChild('a'), makeChild('b')];
    const api = makeApi();
    /** Whether every holder was already inside the slot at emit time. */
    const mountedAtEmit: boolean[] = [];

    api.events.emit.mockImplementation(() => {
      mountedAtEmit.push(
        children.every(
          child => child.holder.parentElement?.hasAttribute('data-blok-nested-blocks') === true
        )
      );
    });

    const Tool = createAngularBlock({
      type: 'ng-steps',
      propSchema: {},
      component: StepsProbe,
    });

    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeContainerApi(children),
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    document.body.appendChild(tool.render());

    expect(api.events.emit).toHaveBeenCalledWith('block:childrenMounted', {
      blockId: 'container',
      childIds: ['a', 'b'],
    });
    expect(mountedAtEmit).toContain(true);
  });
});
