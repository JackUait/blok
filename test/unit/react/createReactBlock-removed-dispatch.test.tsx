import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';

import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import { createBlockPortalRegistry } from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';
import type { BlockAPI } from '../../../types/api';
import type { API } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

interface CounterData {
  count: number;
}

describe('createReactBlock — a change deferred by a drag', () => {
  const frames = new Map<number, FrameRequestCallback>();
  const runFrames = (): void => {
    const pending = [...frames.values()];

    frames.clear();
    pending.forEach(callback => callback(0));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    frames.clear();
    document.body.innerHTML = '';
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
    document.body.innerHTML = '';
  });

  it.each(['removed', 'destroy'] as const)('is not dispatched on a block that was %s before the drag ended', (teardown) => {
    const registry = createBlockPortalRegistry();
    const { unmount } = render(<BlockPortalHost registry={registry} />);
    const dispatchChange = vi.fn();
    const blockApi = { id: 'blk-1', contentIds: [], getChildren: () => [], dispatchChange } as unknown as BlockAPI;
    const dragState = { active: true };
    const api = {
      blocks: {
        get isPointerDragActive(): boolean {
          return dragState.active;
        },
      },
    } as unknown as API;

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 } },
      component: ({ data, commit }: ReactBlockRenderProps<CounterData>) => (
        <button onClick={() => commit({ count: data.count + 1 })}>{data.count}</button>
      ),
    });
    const tool = new Tool({ data: { count: 0 }, block: blockApi, api, readOnly: false, config: { [REGISTRY_CONFIG_KEY]: registry } });
    const holder: { host: HTMLElement | null } = { host: null };

    act(() => {
      holder.host = tool.render();
    });
    if (holder.host === null) {
      throw new Error('tool.render() did not run');
    }
    document.body.appendChild(holder.host);
    const button = screen.getByRole('button');

    act(() => {
      fireEvent.click(button);
    });
    expect(dispatchChange).not.toHaveBeenCalled();

    act(() => {
      tool[teardown]();
    });
    dragState.active = false;
    act(() => {
      runFrames();
    });

    expect(dispatchChange).not.toHaveBeenCalled();
    unmount();
  });
});
