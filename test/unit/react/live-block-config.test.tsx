import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/** Captures every config the mocked Blok constructor receives. */
const constructorConfigs: Array<Record<string, unknown>> = [];
const destroySpy = vi.fn();

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void> = Promise.resolve();
    public destroy = destroySpy;
    public readOnly = { set: vi.fn().mockResolvedValue(false) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };

    public constructor(config: Record<string, unknown>) {
      constructorConfigs.push(config);
    }
  },
}));

import { useBlok } from '../../../packages/react/src/useBlok';
import { getRegistry } from '../../../packages/react/src/registry-map';
import {
  createBlockPortalRegistry,
  BLOK_TOOL_NAME_CONFIG_KEY,
} from '../../../packages/react/src/block-portal-registry';
import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import type { UseBlokConfig } from '../../../packages/react/src/types';
import type { BlockAPI } from '../../../types/api';
import type { API, Blok } from '../../../types';

interface NoteData {
  text: string;
}

interface GoodsConfig {
  canManageGoods: boolean;
  cdnUrl: string;
  uploadByFile: (file: string) => string;
}

const GoodsTool = createReactBlock<NoteData, GoodsConfig>({
  type: 'goods',
  propSchema: { text: { default: '' } },
  component: ({ config }: ReactBlockRenderProps<NoteData, GoodsConfig>) => (
    <span className="view">{String(config.canManageGoods)}</span>
  ),
});

const makeBlockApi = (id = 'blk-1'): BlockAPI =>
  ({
    id,
    contentIds: [],
    getChildren: () => [],
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI);

const makeApi = (): API => ({ blocks: { isPointerDragActive: false } } as unknown as API);

const makeConfig = (canManageGoods: boolean, tag = 'v1'): UseBlokConfig =>
  (({
    tools: {
      goods: {
        class: GoodsTool,
        config: {
          canManageGoods,
          cdnUrl: 'https://cdn.example',
          uploadByFile: (file: string) => `${tag}-${file}`,
        },
      },
    },
  }));

async function flushReady(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('block portal registry — per-tool live config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setToolConfig replaces the config prop of every mounted entry of that tool', () => {
    const registry = createBlockPortalRegistry();
    const Component = (): null => null;

    registry.register('a', {
      hostEl: document.createElement('div'),
      component: Component,
      toolName: 'goods',
      props: { config: { canManageGoods: false } },
    });
    registry.register('b', {
      hostEl: document.createElement('div'),
      component: Component,
      toolName: 'other',
      props: { config: { unrelated: true } },
    });

    registry.setToolConfig('goods', { canManageGoods: true });

    expect(registry.getSnapshot().get('a')?.props.config).toEqual({ canManageGoods: true });
    // Entries of OTHER tools are untouched.
    expect(registry.getSnapshot().get('b')?.props.config).toEqual({ unrelated: true });
  });

  it('a register AFTER setToolConfig starts from the latest config, not its construction snapshot', () => {
    const registry = createBlockPortalRegistry();
    const Component = (): null => null;

    registry.setToolConfig('goods', { canManageGoods: true });

    registry.register('late', {
      hostEl: document.createElement('div'),
      component: Component,
      toolName: 'goods',
      props: { config: { canManageGoods: false } },
    });

    expect(registry.getSnapshot().get('late')?.props.config).toEqual({ canManageGoods: true });
  });
});

describe('useBlok — live tool-config VALUES for react blocks (no editor recreation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorConfigs.length = 0;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Construct the react-block tool exactly as core would, from the config useBlok built. */
  const constructToolFromEditorConfig = (): { render(): HTMLElement } => {
    const tools = constructorConfigs[0].tools as Record<
      string,
      { class: new (options: unknown) => { render(): HTMLElement }; config: Record<string, unknown> }
    >;
    const entry = tools.goods;

    return new entry.class({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: entry.config,
    });
  };

  it('injects the registered tool name into each react-block tool config', async () => {
    const { result, unmount } = renderHook(() => useBlok(makeConfig(false)));

    await flushReady();

    const tools = constructorConfigs[0].tools as Record<string, { config: Record<string, unknown> }>;

    expect(tools.goods.config[BLOK_TOOL_NAME_CONFIG_KEY]).toBe('goods');
    expect(result.current).not.toBeNull();

    unmount();
  });

  it('a changed non-function config value reaches mounted blocks in place', async () => {
    const { result, rerender, unmount } = renderHook(
      (props: { config: UseBlokConfig }) => useBlok(props.config),
      { initialProps: { config: makeConfig(false) } }
    );

    await flushReady();

    const editor = result.current as Blok;
    const registry = getRegistry(editor);

    if (registry === undefined) {
      throw new Error('registry not associated with editor');
    }

    // Core constructs a block of the tool; it registers a portal entry.
    const tool = constructToolFromEditorConfig();

    act(() => {
      tool.render();
    });

    const before = registry.getSnapshot().get('blk-1')?.props.config as Record<string, unknown>;

    expect(before.canManageGoods).toBe(false);

    // The host re-renders with a flipped permission — same editor, new value.
    rerender({ config: makeConfig(true) });

    const after = registry.getSnapshot().get('blk-1')?.props.config as Record<string, unknown>;

    expect(after.canManageGoods).toBe(true);
    // No recreation: the value travelled through the live-config channel.
    // (constructorConfigs would grow if the editor were rebuilt.)
    expect(constructorConfigs).toHaveLength(1);

    unmount();
  });

  it('re-renders that only change function identities do not push a new config', async () => {
    const { result, rerender, unmount } = renderHook(
      (props: { config: UseBlokConfig }) => useBlok(props.config),
      { initialProps: { config: makeConfig(false, 'v1') } }
    );

    await flushReady();

    const editor = result.current as Blok;
    const registry = getRegistry(editor);

    if (registry === undefined) {
      throw new Error('registry not associated with editor');
    }

    const tool = constructToolFromEditorConfig();

    act(() => {
      tool.render();
    });

    const before = registry.getSnapshot().get('blk-1')?.props.config;

    // New render, new inline closure identities, same values.
    rerender({ config: makeConfig(false, 'v2') });

    const after = registry.getSnapshot().get('blk-1')?.props.config;

    // Same config object — no spurious block re-render...
    expect(after).toBe(before);
    // ...yet the function slot still reaches the LATEST closure (live binding).
    const upload = (after as Record<string, unknown>).uploadByFile as (file: string) => string;

    expect(upload('f')).toBe('v2-f');

    unmount();
  });
});
