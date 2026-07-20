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
import type { UseBlokConfig } from '../../../packages/react/src/types';

class UploaderTool {
  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

type ToolsConfigShape = {
  uploader: {
    class: typeof UploaderTool;
    config: {
      onPick: (value: string) => string;
      uploader: { uploadByFile: (file: string) => string };
      maxSize: number;
    };
  };
};

const makeTools = (tag: string): ToolsConfigShape => ({
  uploader: {
    class: UploaderTool,
    config: {
      onPick: (value: string) => `${tag}-pick-${value}`,
      uploader: { uploadByFile: (file: string) => `${tag}-upload-${file}` },
      maxSize: 30,
    },
  },
});

async function flushReady(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useBlok live tool-config functions (no frozen identities, no recreation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorConfigs.length = 0;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getConstructedToolConfig = (): {
    onPick: (value: string) => string;
    uploader: { uploadByFile: (file: string) => string };
    maxSize: number;
  } => {
    const tools = constructorConfigs[0].tools as ToolsConfigShape;

    return tools.uploader.config;
  };

  it('a tool-config function passed at construction delegates to the LATEST render closure', async () => {
    // The hack-4 regression test: consumers may pass inline closures in tool
    // configs. The editor must always call the newest closure — without being
    // destroyed/recreated and without the consumer freezing identities.
    const initialProps: { config: UseBlokConfig } = {
      config: { tools: makeTools('v1') },
    };
    const { rerender, unmount } = renderHook(
      (props: { config: UseBlokConfig }) => useBlok(props.config),
      { initialProps }
    );

    await flushReady();

    // Core holds the function captured at construction time…
    const constructed = getConstructedToolConfig();

    expect(constructed.onPick('x')).toBe('v1-pick-x');

    // …the consumer re-renders with brand-new closures (new identities)…
    rerender({ config: { tools: makeTools('v2') } });

    // …and the SAME construction-time reference now reaches the latest closure.
    expect(constructed.onPick('x')).toBe('v2-pick-x');

    // No editor recreation happened.
    expect(constructorConfigs).toHaveLength(1);
    expect(destroySpy).not.toHaveBeenCalled();

    unmount();
  });

  it('delegation reaches functions NESTED inside config objects (uploader.uploadByFile)', async () => {
    const initialProps: { config: UseBlokConfig } = {
      config: { tools: makeTools('v1') },
    };
    const { rerender, unmount } = renderHook(
      (props: { config: UseBlokConfig }) => useBlok(props.config),
      { initialProps }
    );

    await flushReady();

    const constructed = getConstructedToolConfig();

    expect(constructed.uploader.uploadByFile('f')).toBe('v1-upload-f');

    rerender({ config: { tools: makeTools('v2') } });

    expect(constructed.uploader.uploadByFile('f')).toBe('v2-upload-f');

    unmount();
  });

  it('falls back to the construction-time function when the latest config drops it', async () => {
    const initialProps: { config: UseBlokConfig } = {
      config: { tools: makeTools('v1') },
    };
    const { rerender, unmount } = renderHook(
      (props: { config: UseBlokConfig }) => useBlok(props.config),
      { initialProps }
    );

    await flushReady();

    const constructed = getConstructedToolConfig();

    rerender({
      config: {
        tools: { uploader: { class: UploaderTool, config: { maxSize: 30 } } },
      },
    });

    expect(constructed.onPick('x')).toBe('v1-pick-x');

    unmount();
  });

  it('non-function config values and the tool class pass through untouched', async () => {
    const tools = makeTools('v1');
    const { unmount } = renderHook(() => useBlok({ tools }));

    await flushReady();

    const constructedTools = constructorConfigs[0].tools as ToolsConfigShape;

    expect(constructedTools.uploader.class).toBe(UploaderTool);
    expect(constructedTools.uploader.config.maxSize).toBe(30);

    unmount();
  });

  it('does not mutate the consumer-owned tools object', async () => {
    const tools = makeTools('v1');
    const original = tools.uploader.config.onPick;
    const { unmount } = renderHook(() => useBlok({ tools }));

    await flushReady();

    expect(tools.uploader.config.onPick).toBe(original);

    unmount();
  });
});
