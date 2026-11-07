import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAngularBlock } from '../../../packages/angular/src/createAngularBlock';
import { BLOK_BLOCK_CONTEXT, type AngularBlockRenderContext } from '../../../packages/angular/src/block-context';
import type { BlockPortalRegistry } from '../../../packages/angular/src/block-portal-registry';
import type { BlockAPI } from '../../../types/api';
import type { API, BlockToolConstructorOptions, BlockToolData } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokAngularPortalRegistry';

interface CounterData {
  count: number;
}

@Component({ standalone: true, template: '', changeDetection: ChangeDetectionStrategy.Default })
class CounterComponent {
  readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<CounterData>;
}

describe('createAngularBlock — a change deferred by a drag', () => {
  const frames = new Map<number, FrameRequestCallback>();
  const runFrames = (): void => {
    const pending = [...frames.values()];

    frames.clear();
    pending.forEach(callback => callback(0));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    frames.clear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = frames.size + 1;

      frames.set(id, callback);

      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['removed', 'destroy'] as const)('is not dispatched on a block that was %s before the drag ended', (teardown) => {
    const register = vi.fn();
    const registry = { register, unregister: vi.fn(), flush: vi.fn(), destroyAll: vi.fn() } as unknown as BlockPortalRegistry;
    const dispatchChange = vi.fn();
    const block = { id: 'blk-1', contentIds: [], getChildren: () => [], dispatchChange } as unknown as BlockAPI;
    const dragState = { active: true };
    const api = {
      blocks: {
        get isPointerDragActive(): boolean {
          return dragState.active;
        },
        getChildren: () => [],
      },
    } as unknown as API;
    const Tool = createAngularBlock<CounterData>({
      type: 'ng-counter',
      propSchema: { count: { default: 0 } },
      component: CounterComponent,
    });
    const tool = new Tool({
      data: { count: 1 } as BlockToolData,
      block,
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as BlockToolConstructorOptions);

    tool.render();
    const ctx = (register.mock.calls[0][1] as { context: AngularBlockRenderContext<CounterData> }).context;

    ctx.commit({ count: 2 });
    expect(dispatchChange).not.toHaveBeenCalled();

    tool[teardown]();
    dragState.active = false;
    runFrames();

    expect(dispatchChange).not.toHaveBeenCalled();
  });
});
