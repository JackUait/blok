import React, { createContext, useContext, type ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';

/** Captures every config the mocked Blok constructor receives. */
const constructorConfigs: Array<Record<string, unknown>> = [];

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void> = Promise.resolve();
    public destroy = vi.fn();
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
import { BlokContent } from '../../../packages/react/src/BlokContent';
import { createReactBlock } from '../../../packages/react/src/createReactBlock';
import { getRegistry } from '../../../packages/react/src/registry-map';
import { BLOK_PORTAL_REGISTRY_CONFIG_KEY } from '../../../packages/react/src/block-portal-registry';
import type { Blok } from '../../../types';

const HostContext = createContext('default');

function ContextProbe(): ReactElement {
  const value = useContext(HostContext);

  return <span className="ctx-probe">{value}</span>;
}

const ReactTool = createReactBlock({
  type: 'probe',
  propSchema: {},
  component: ContextProbe,
});

class VanillaTool {
  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

async function flushReady(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Run tool.render() inside act() and hand back the host element. */
const renderTool = (tool: { render(): HTMLElement }): HTMLElement => {
  const holder: { host: HTMLElement | null } = { host: null };

  act(() => {
    holder.host = tool.render();
  });

  if (holder.host === null) {
    throw new Error('tool.render() did not run');
  }

  return holder.host;
};

describe('createReactBlock end-to-end wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorConfigs.length = 0;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('marks the factory output as a React block', () => {
    expect(ReactTool.__isBlokReactBlock).toBe(true);
  });

  it('injects the editor portal registry into a react-block tool config', async () => {
    const { unmount } = renderHook(() => useBlok({ tools: { probe: ReactTool } }));

    await flushReady();

    const config = constructorConfigs[0];
    const tools = config.tools as Record<string, { class?: unknown; config?: Record<string, unknown> }>;

    expect(tools.probe.class).toBe(ReactTool);
    expect(tools.probe.config?.[BLOK_PORTAL_REGISTRY_CONFIG_KEY]).toBeDefined();

    unmount();
  });

  it('does NOT inject a registry into a vanilla tool config', async () => {
    const { unmount } = renderHook(() =>
      useBlok({ tools: { probe: ReactTool, vanilla: { class: VanillaTool, config: { keep: 1 } } } })
    );

    await flushReady();

    const tools = constructorConfigs[0].tools as Record<string, unknown>;
    const vanilla = tools.vanilla as { config: Record<string, unknown> };

    expect(vanilla.config.keep).toBe(1);
    expect(vanilla.config[BLOK_PORTAL_REGISTRY_CONFIG_KEY]).toBeUndefined();

    unmount();
  });

  it('associates a registry with the created editor and drops it on unmount', async () => {
    const captured: { editor: Blok | null } = { editor: null };

    const { unmount } = renderHook(() => {
      const editor = useBlok({ tools: { probe: ReactTool } });

      if (editor !== null) {
        captured.editor = editor;
      }

      return editor;
    });

    await flushReady();

    expect(captured.editor).not.toBeNull();
    expect(getRegistry(captured.editor as Blok)).toBeDefined();

    unmount();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(getRegistry(captured.editor as Blok)).toBeUndefined();
  });

  it('BlokContent mounts the portal host: host-tree context reaches block tools', async () => {
    // The hack-3 regression test: a block tool authored with createReactBlock and
    // registered through useBlok must receive React context from the tree that
    // renders BlokContent — no external store, no hand-rolled createRoot.
    function Editor(): ReactElement {
      const editor = useBlok({ tools: { probe: ReactTool } });

      return <BlokContent editor={editor} />;
    }

    render(
      <HostContext.Provider value="from-host-tree">
        <Editor />
      </HostContext.Provider>
    );

    await flushReady();

    const editorConfig = constructorConfigs[0];
    const tools = editorConfig.tools as Record<string, { config: Record<string, unknown> }>;
    const registry = tools.probe.config[BLOK_PORTAL_REGISTRY_CONFIG_KEY];

    expect(registry).toBeDefined();

    // Simulate core constructing + rendering the block tool.
    const tool = new ReactTool({
      data: {},
      block: { id: 'blk-1', getChildren: () => [], dispatchChange: vi.fn() } as never,
      api: { blocks: {} } as never,
      readOnly: false,
      config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    expect(host.querySelector('.ctx-probe')?.textContent).toBe('from-host-tree');
  });
});
