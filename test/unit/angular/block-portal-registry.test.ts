import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  Injector,
  signal,
  type WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';
import { createBlockPortalRegistry } from '../../../packages/angular/src/block-portal-registry';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  template: `<span class="view">{{ ctx.data().count }}</span>`,
})
class CounterProbe {
  readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<{ count: number }>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  template: `<span>boom</span>`,
})
class ThrowingProbe {
  constructor() {
    throw new Error('render boom');
  }
}

const makeCtx = (
  count: WritableSignal<{ count: number }>
): AngularBlockRenderContext<{ count: number }> =>
  ({
    data: count,
    commit: vi.fn(),
    block: { id: 'b1' },
    readOnly: signal(false),
    mountChildren: vi.fn(),
  } as unknown as AngularBlockRenderContext<{ count: number }>);

describe('createBlockPortalRegistry', () => {
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

  it('register mounts the component into the host element and renders initial data', () => {
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    const host = document.createElement('div');
    const data = signal({ count: 7 });

    registry.register('b1', { hostEl: host, component: CounterProbe, context: makeCtx(data) });

    expect(host.querySelector('.view')?.textContent).toBe('7');
  });

  it('flush re-runs change detection to reflect new signal data in place', () => {
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    const host = document.createElement('div');
    const data = signal({ count: 1 });

    registry.register('b1', { hostEl: host, component: CounterProbe, context: makeCtx(data) });
    data.set({ count: 2 });
    registry.flush('b1');

    expect(host.querySelector('.view')?.textContent).toBe('2');
  });

  it('unregister tears the component out of the host', () => {
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    const host = document.createElement('div');

    registry.register('b1', { hostEl: host, component: CounterProbe, context: makeCtx(signal({ count: 1 })) });
    registry.unregister('b1');

    expect(host.querySelector('.view')).toBeNull();
  });

  it('routes a throwing component render to the ErrorHandler instead of propagating', () => {
    const spy = vi.spyOn(errorHandler, 'handleError').mockImplementation(() => undefined);
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);

    expect(() =>
      registry.register('b1', {
        hostEl: document.createElement('div'),
        component: ThrowingProbe,
        context: makeCtx(signal({ count: 1 })),
      })
    ).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('destroyAll unmounts every registered block', () => {
    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    const a = document.createElement('div');
    const b = document.createElement('div');

    registry.register('a', { hostEl: a, component: CounterProbe, context: makeCtx(signal({ count: 1 })) });
    registry.register('b', { hostEl: b, component: CounterProbe, context: makeCtx(signal({ count: 1 })) });
    registry.destroyAll();

    expect(a.querySelector('.view')).toBeNull();
    expect(b.querySelector('.view')).toBeNull();
  });

  it('unregister destroys the per-block element injector to prevent leaks', () => {
    const realCreate = Injector.create.bind(Injector);
    const destroySpies: Array<ReturnType<typeof vi.fn>> = [];

    vi.spyOn(Injector, 'create').mockImplementation((opts) => {
      const inj = realCreate(opts);
      // Capture the original destroy BEFORE replacing it, so the spy delegates
      // to the real implementation without causing infinite recursion.
      const originalDestroy = (inj as Injector & { destroy?: () => void }).destroy?.bind(inj);
      const spy = vi.fn(() => originalDestroy?.());
      (inj as unknown as { destroy: () => void }).destroy = spy;
      destroySpies.push(spy);
      return inj;
    });

    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    registry.register('b1', {
      hostEl: document.createElement('div'),
      component: CounterProbe,
      context: makeCtx(signal({ count: 1 })),
    });

    expect(destroySpies).toHaveLength(1);
    registry.unregister('b1');
    expect(destroySpies[0]).toHaveBeenCalledTimes(1);
  });

  it('destroyAll destroys the element injector for every registered block', () => {
    const realCreate = Injector.create.bind(Injector);
    const destroySpies: Array<ReturnType<typeof vi.fn>> = [];

    vi.spyOn(Injector, 'create').mockImplementation((opts) => {
      const inj = realCreate(opts);
      // Capture the original destroy BEFORE replacing it, so the spy delegates
      // to the real implementation without causing infinite recursion.
      const originalDestroy = (inj as Injector & { destroy?: () => void }).destroy?.bind(inj);
      const spy = vi.fn(() => originalDestroy?.());
      (inj as unknown as { destroy: () => void }).destroy = spy;
      destroySpies.push(spy);
      return inj;
    });

    const registry = createBlockPortalRegistry(envInjector, appRef, errorHandler);
    registry.register('a', {
      hostEl: document.createElement('div'),
      component: CounterProbe,
      context: makeCtx(signal({ count: 1 })),
    });
    registry.register('b', {
      hostEl: document.createElement('div'),
      component: CounterProbe,
      context: makeCtx(signal({ count: 2 })),
    });

    expect(destroySpies).toHaveLength(2);
    registry.destroyAll();
    expect(destroySpies[0]).toHaveBeenCalledTimes(1);
    expect(destroySpies[1]).toHaveBeenCalledTimes(1);
  });
});
