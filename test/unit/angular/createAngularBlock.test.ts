import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAngularBlock, type BlockToolStatics } from '../../../packages/angular/src/createAngularBlock';
import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/angular/src/block-portal-registry';
import type { BlockAPI } from '../../../types/api';
import type { API, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

interface CounterData {
  count: number;
  label: string;
}

@Component({ standalone: true, template: '', changeDetection: ChangeDetectionStrategy.Default })
class CounterComponent {
  readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<CounterData>;
}

/** Same as CounterComponent, but renders its data so a real mount is observable. */
@Component({
  standalone: true,
  template: `<span class="view">{{ ctx.data().count }}</span>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
class CounterViewComponent {
  readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<CounterData>;
}

const makeBlockApi = (id = 'blk-1'): BlockAPI =>
  ({ id, contentIds: [], getChildren: () => [], dispatchChange: vi.fn() } as unknown as BlockAPI);

const makeApi = (dragActive = false): API =>
  ({ blocks: { isPointerDragActive: dragActive } } as unknown as API);

const makeRegistry = (): BlockPortalRegistry & {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  destroyAll: ReturnType<typeof vi.fn>;
} =>
  ({ register: vi.fn(), unregister: vi.fn(), flush: vi.fn(), destroyAll: vi.fn() } as never);

const makeTool = (
  data: Partial<CounterData>,
  registry: BlockPortalRegistry,
  api: API = makeApi(),
  readOnly = false
): {
  render(): HTMLElement;
  save(): BlockToolData;
  setData(d: BlockToolData): Promise<boolean>;
  setReadOnly(s: boolean): void;
  rendered(): void;
  moved(): void;
  removed(): void;
  destroy(): void;
} => {
  const Tool = createAngularBlock<CounterData>({
    type: 'ng-counter',
    propSchema: { count: { default: 0 }, label: { default: 'n' } },
    component: CounterComponent,
  });

  return new Tool({
    data: data as BlockToolData,
    block: makeBlockApi(),
    api,
    readOnly,
    config: { [REGISTRY_CONFIG_KEY]: registry },
  } as BlockToolConstructorOptions);
};

describe('createAngularBlock — factory contract', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('marks the constructable so the directive can detect Angular blocks', () => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });

    expect((Tool as unknown as { __isBlokAngularBlock?: boolean }).__isBlokAngularBlock).toBe(true);
  });

  it('declares static isReadOnlySupported (else core throws when read-only enabled)', () => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      toolbox: { title: 'Counter', icon: '<svg></svg>' },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });

    expect((Tool as unknown as { isReadOnlySupported?: boolean }).isReadOnlySupported).toBe(true);
    expect((Tool as unknown as { toolbox?: { title: string } }).toolbox?.title).toBe('Counter');
  });

  it('exposes setReadOnly on the PROTOTYPE (enables core in-place toggle path)', () => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });

    expect(typeof (Tool.prototype as unknown as { setReadOnly?: unknown }).setReadOnly).toBe('function');
  });

  it('save() returns the complete frozen mirror with ONLY schema keys', () => {
    const tool = makeTool({ count: 3, label: 'hi' }, makeRegistry());
    const saved = tool.save() as unknown as CounterData;

    expect(saved).toEqual({ count: 3, label: 'hi' });
    expect(Object.isFrozen(saved)).toBe(true);
  });

  it('save() refills a cleared key with its default (Yjs key-resurrection guard)', () => {
    const tool = makeTool({ count: 5 }, makeRegistry());

    expect(tool.save()).toEqual({ count: 5, label: 'n' });
  });

  it('render() returns a mutation-free host and registers the portal entry', () => {
    const registry = makeRegistry();
    const tool = makeTool({ count: 1 }, registry);
    const host = tool.render();

    expect(host.getAttribute('data-blok-mutation-free')).toBe('true');
    expect(registry.register).toHaveBeenCalledTimes(1);
    const entry = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][1];

    expect(entry.hostEl).toBe(host);
    expect(entry.component).toBe(CounterComponent);
  });

  it('setData() updates the mirror, flushes CD, and resolves true (defeats remount)', async () => {
    const registry = makeRegistry();
    const tool = makeTool({ count: 1 }, registry);

    tool.render();
    const result = await tool.setData({ count: 9 } as BlockToolData);

    expect(result).toBe(true);
    expect(tool.save()).toEqual({ count: 9, label: 'n' });
    expect(registry.flush).toHaveBeenCalled();
  });

  it('setData() short-circuits identical data without flushing, still returns true', async () => {
    const registry = makeRegistry();
    const tool = makeTool({ count: 1, label: 'n' }, registry);

    tool.render();
    (registry.flush as ReturnType<typeof vi.fn>).mockClear();
    const result = await tool.setData({ count: 1, label: 'n' } as BlockToolData);

    expect(result).toBe(true);
    expect(registry.flush).not.toHaveBeenCalled();
  });

  it('removed() and destroy() unregister the portal entry', () => {
    const registry = makeRegistry();
    const tool = makeTool({ count: 1 }, registry);

    tool.render();
    tool.removed();
    tool.destroy();

    expect(registry.unregister).toHaveBeenCalledTimes(2);
  });
});

/**
 * C2 half (b), driven through a REAL portal registry: core composes the
 * REPLACEMENT block — which mounts under the SAME block id — BEFORE it calls
 * REMOVED + destroy() on the block it replaces (`Blocks.insert(index, block,
 * replace = true)`). The superseded instance's teardown therefore lands on a
 * mount it no longer owns; without passing its own host it destroys the live
 * componentRef and clears the live host, leaving a permanently blank block.
 */
describe('createAngularBlock — portal ownership on teardown', () => {
  let envInjector: EnvironmentInjector;
  let appRef: ApplicationRef;
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({});
    envInjector = TestBed.inject(EnvironmentInjector);
    appRef = TestBed.inject(ApplicationRef);
    errorHandler = TestBed.inject(ErrorHandler);
  });

  afterEach(() => vi.restoreAllMocks());

  const makeViewTool = (
    count: number,
    registry: BlockPortalRegistry
  ): { render(): HTMLElement; removed(): void; destroy(): void } => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterViewComponent,
    });

    return new Tool({
      data: { count } as BlockToolData,
      block: makeBlockApi('blk-same'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);
  };

  it('a superseded instance cannot unregister the mount that replaced it', () => {
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    const superseded = makeViewTool(1, registry);

    superseded.render();

    // Core composes the replacement first — same id, new host.
    const replacement = makeViewTool(2, registry);
    const replacementHost = replacement.render();

    // …and only then tears the old block down (REMOVED, then destroy()).
    superseded.removed();
    superseded.destroy();

    expect(replacementHost.querySelector('.view')?.textContent).toBe('2');
  });

  it('the live instance can still tear its own mount down', () => {
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    const tool = makeViewTool(1, registry);
    const host = tool.render();

    expect(host.querySelector('.view')?.textContent).toBe('1');

    tool.removed();

    expect(host.querySelector('.view')).toBeNull();
  });
});

describe('createAngularBlock — commit + drag-deferred dispatch', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('commit() merges the patch, flushes CD, and dispatches change once', () => {
    const registry = makeRegistry();
    const block = makeBlockApi();
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: { count: 1 } as BlockToolData,
      block,
      api: makeApi(false),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    const ctx = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .context as AngularBlockRenderContext<CounterData>;

    ctx.commit({ count: 2 });

    expect(tool.save()).toEqual({ count: 2, label: 'n' });
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
    expect(registry.flush).toHaveBeenCalled();
  });

  it('commit() is idempotent: a patch that changes nothing neither dispatches nor flushes', () => {
    const registry = makeRegistry();
    const block = makeBlockApi();
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: { count: 1 } as BlockToolData,
      block,
      api: makeApi(false),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    const ctx = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .context as AngularBlockRenderContext<CounterData>;

    (registry.flush as ReturnType<typeof vi.fn>).mockClear();
    ctx.commit({ count: 1 });

    expect(block.dispatchChange).not.toHaveBeenCalled();
    expect(registry.flush).not.toHaveBeenCalled();
    expect(tool.save()).toEqual({ count: 1, label: 'n' });
  });

  it('commit() defers dispatchChange while a pointer drag is active', () => {
    const registry = makeRegistry();
    const block = makeBlockApi();
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: { count: 1 } as BlockToolData,
      block,
      api: makeApi(true), // drag active
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    const ctx = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .context as AngularBlockRenderContext<CounterData>;

    ctx.commit({ count: 2 });

    // Dispatch is deferred to a later frame while dragging.
    expect(block.dispatchChange).not.toHaveBeenCalled();
  });
});

describe('createAngularBlock — core tool-contract passthrough', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('resolves getToolbarAnchorElement against the rendered host, at call time', () => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
      getToolbarAnchorElement: host => host.querySelector<HTMLElement>('[data-anchor]'),
    });
    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: makeRegistry() },
    } as BlockToolConstructorOptions);

    const host = tool.render();

    // The anchor only exists once the component has rendered into the host —
    // the resolver must run at CALL time, not at construction.
    expect(tool.getToolbarAnchorElement()).toBeUndefined();

    const anchor = document.createElement('div');

    anchor.setAttribute('data-anchor', '');
    host.appendChild(anchor);

    expect(tool.getToolbarAnchorElement()).toBe(anchor);
  });

  it('reports no anchor when the spec declares none (core keeps its default positioning)', () => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: makeRegistry() },
    } as BlockToolConstructorOptions);

    tool.render();

    expect(tool.getToolbarAnchorElement()).toBeUndefined();
  });

  it('forwards authored statics onto the generated tool class', () => {
    const conversionConfig = { export: 'text', import: 'text' };
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
      statics: { ownsChildren: true, conversionConfig, shortcut: 'CMD+SHIFT+K' },
    });

    const asCoreTool = Tool as unknown as BlockToolConstructable;

    expect(asCoreTool.ownsChildren).toBe(true);
    expect(asCoreTool.conversionConfig).toBe(conversionConfig);
    expect(asCoreTool.shortcut).toBe('CMD+SHIFT+K');
  });

  it('never lets authored statics clobber the members the adapter owns', () => {
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      toolbox: { title: 'Counter', icon: '<svg></svg>' },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
      statics: { toolbox: undefined, isReadOnlySupported: false } as BlockToolStatics,
    });

    expect(Tool.toolbox).toEqual({ title: 'Counter', icon: '<svg></svg>' });
    expect(Tool.isReadOnlySupported).toBe(true);
    expect(Tool.__isBlokAngularBlock).toBe(true);
  });
});

describe('createAngularBlock — editor api and per-child decoration', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  /** A fake child block: just the id + holder `mountChildBlocks` moves around. */
  const makeChild = (id: string): BlockAPI => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);

    return { id, holder } as unknown as BlockAPI;
  };

  const makeContainerApi = (children: BlockAPI[]): BlockAPI =>
    ({
      id: 'container',
      contentIds: children.map(child => child.id),
      getChildren: () => children,
      dispatchChange: vi.fn(),
    } as unknown as BlockAPI);

  const renderWithChildren = (
    children: BlockAPI[]
  ): {
    ctx: AngularBlockRenderContext<CounterData>;
    tool: { setData(d: BlockToolData): Promise<boolean> };
    slot: HTMLElement;
  } => {
    const registry = makeRegistry();
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: { count: 0 } as BlockToolData,
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    const host = tool.render();
    const ctx = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .context as AngularBlockRenderContext<CounterData>;
    const slot = document.createElement('div');

    host.appendChild(slot);

    return { ctx, tool, slot };
  };

  it('hands the editor api to the block context', () => {
    const registry = makeRegistry();
    const api = makeApi();
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: {} as BlockToolData,
      block: makeBlockApi(),
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();

    const ctx = (registry.register as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .context as AngularBlockRenderContext<CounterData>;

    expect(ctx.api).toBe(api);
  });

  it('stamps per-child attributes on the holders, which stay DIRECT slot children', () => {
    const children = [makeChild('a'), makeChild('b')];
    const { ctx, slot } = renderWithChildren(children);

    ctx.mountChildren(slot, (child, index) => ({
      'data-step-index': String(index),
      'data-child-id': child.id,
    }));

    expect(children[0].holder.getAttribute('data-step-index')).toBe('0');
    expect(children[0].holder.getAttribute('data-child-id')).toBe('a');
    expect(children[1].holder.getAttribute('data-step-index')).toBe('1');
    // Anti-wrapper guard: holders must remain DIRECT children of the slot.
    expect(children[0].holder.parentElement).toBe(slot);
    expect(children[1].holder.parentElement).toBe(slot);
  });

  it('drops the attributes the callback stopped producing on the next mount', async () => {
    const children = [makeChild('a')];
    const { ctx, tool, slot } = renderWithChildren(children);

    ctx.mountChildren(slot, () => ({ 'data-active': 'true', 'data-legacy': 'x' }));
    expect(children[0].holder.getAttribute('data-legacy')).toBe('x');

    ctx.mountChildren(slot, () => ({ 'data-active': 'false' }));

    expect(children[0].holder.getAttribute('data-active')).toBe('false');
    expect(children[0].holder.hasAttribute('data-legacy')).toBe(false);

    // The decorator is retained across the factory's own remounts (data change).
    await tool.setData({ count: 1, label: 'n' } as BlockToolData);

    expect(children[0].holder.getAttribute('data-active')).toBe('false');
  });
});
