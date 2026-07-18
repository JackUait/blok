import { Component, inject, signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAngularBlock } from '../../../packages/angular/src/createAngularBlock';
import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';
import type { BlockPortalRegistry } from '../../../packages/angular/src/block-portal-registry';
import type { BlockAPI } from '../../../types/api';
import type { API, BlockToolConstructorOptions, BlockToolData } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

interface CounterData {
  count: number;
  label: string;
}

@Component({ standalone: true, template: '' })
class CounterComponent {
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
