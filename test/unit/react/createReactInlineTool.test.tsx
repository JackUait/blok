import React, { useEffect, type ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';

/** Captures every config the mocked Blok constructor receives (for useBlok wiring). */
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

import { createReactInlineTool } from '../../../packages/react/src/createReactInlineTool';
import type { ReactInlineToolRenderProps } from '../../../packages/react/src/createReactInlineTool';
import {
  createBlockPortalRegistry,
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';
import { useBlok } from '../../../packages/react/src/useBlok';
import type { InlineToolConstructorOptions, MenuConfig } from '../../../types/tools';

const unmountSpy = vi.fn();

function ColorIcon({ active }: ReactInlineToolRenderProps): ReactElement {
  useEffect(() => unmountSpy, []);

  return <span data-testid="color-icon" data-active={active ? 'true' : 'false'}>C</span>;
}

/** A single MenuConfig item as returned by the factory's render(). */
interface RenderedItem {
  name?: string;
  title?: string;
  icon?: string | HTMLElement;
  onActivate?: (item: unknown) => void;
  isActive?: () => boolean;
}

const firstItem = (rendered: MenuConfig): RenderedItem =>
  (Array.isArray(rendered) ? rendered[0] : rendered) as RenderedItem;

const makeOptions = (
  registry: BlockPortalRegistry | undefined,
  extraConfig: Record<string, unknown> = {}
): InlineToolConstructorOptions =>
  ({
    api: {} as never,
    config: {
      ...(registry === undefined ? {} : { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry }),
      [BLOK_TOOL_NAME_CONFIG_KEY]: 'descriptionColor',
      ...extraConfig,
    },
  }) as unknown as InlineToolConstructorOptions;

describe('createReactInlineTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorConfigs.length = 0;
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('is marked as a React inline tool and as an inline tool for core', () => {
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon });

    expect(Tool.__isBlokReactInlineTool).toBe(true);
    expect(Tool.isInline).toBe(true);
  });

  it('render() returns a MenuConfig with a mutation-free host icon and registers ONE portal entry', () => {
    const registry = createBlockPortalRegistry();
    const Tool = createReactInlineTool({ type: 'descriptionColor', title: 'Color', component: ColorIcon });
    const tool = new Tool(makeOptions(registry));

    const item = firstItem(tool.render() as MenuConfig);

    expect(item.icon).toBeInstanceOf(HTMLElement);
    expect((item.icon as HTMLElement).getAttribute('data-blok-mutation-free')).toBe('true');
    expect(item.name).toBe('descriptionColor');
    expect(item.title).toBe('Color');

    const entries = Array.from(registry.getSnapshot().values());

    expect(entries).toHaveLength(1);
    expect(entries[0].hostEl).toBe(item.icon);
    expect(entries[0].props.active).toBe(false);
  });

  it('mounts the icon component through BlockPortalHost with active:false', () => {
    const registry = createBlockPortalRegistry();
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon });
    const tool = new Tool(makeOptions(registry));

    const item = firstItem(tool.render() as MenuConfig);

    document.body.appendChild(item.icon as HTMLElement);
    render(<BlockPortalHost registry={registry} />);

    const icon = (item.icon as HTMLElement).querySelector('[data-testid="color-icon"]');

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('data-active')).toBe('false');
  });

  it('exposes the consumer tool config (internal keys stripped) to the component', () => {
    const registry = createBlockPortalRegistry();
    const seen: unknown[] = [];

    function ConfigProbe({ config }: ReactInlineToolRenderProps<{ palette: string }>): ReactElement {
      seen.push(config);

      return <i />;
    }

    const Tool = createReactInlineTool<{ palette: string }>({
      type: 'descriptionColor',
      component: ConfigProbe,
    });
    const tool = new Tool(makeOptions(registry, { palette: 'warm' }));

    const item = firstItem(tool.render() as MenuConfig);

    document.body.appendChild(item.icon as HTMLElement);
    render(<BlockPortalHost registry={registry} />);

    expect(seen.at(-1)).toEqual({ palette: 'warm' });
  });

  it('isActive() pushes { active: true } only on change and the mounted icon re-renders in place', () => {
    const registry = createBlockPortalRegistry();
    const setPropsSpy = vi.spyOn(registry, 'setProps');
    const checkState = vi.fn(() => true);
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon, checkState });
    const tool = new Tool(makeOptions(registry));

    const item = firstItem(tool.render() as MenuConfig);

    document.body.appendChild(item.icon as HTMLElement);
    render(<BlockPortalHost registry={registry} />);

    act(() => {
      expect(item.isActive?.()).toBe(true);
    });

    const icon = (item.icon as HTMLElement).querySelector('[data-testid="color-icon"]');

    expect(icon?.getAttribute('data-active')).toBe('true');
    expect(setPropsSpy).toHaveBeenCalledTimes(1);

    // Same value again: no redundant external-store notification
    act(() => {
      expect(item.isActive?.()).toBe(true);
    });
    expect(setPropsSpy).toHaveBeenCalledTimes(1);
  });

  it('onActivate captures the LIVE selection at activation time and hands its range to surround', () => {
    const registry = createBlockPortalRegistry();
    const surround = vi.fn();
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon, surround });
    const tool = new Tool(makeOptions(registry));

    const item = firstItem(tool.render() as MenuConfig);

    // Selection is made AFTER render — the handler must read it live.
    const paragraph = document.createElement('p');

    paragraph.textContent = 'colorize me';
    document.body.appendChild(paragraph);

    const range = document.createRange();

    range.selectNodeContents(paragraph);
    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    item.onActivate?.(item);

    expect(surround).toHaveBeenCalledTimes(1);
    expect(String(surround.mock.calls[0][0])).toBe('colorize me');
  });

  it('onActivate is a no-op (no throw) when nothing is selected', () => {
    const registry = createBlockPortalRegistry();
    const surround = vi.fn();
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon, surround });
    const tool = new Tool(makeOptions(registry));

    const item = firstItem(tool.render() as MenuConfig);

    expect(() => item.onActivate?.(item)).not.toThrow();
    expect(surround).not.toHaveBeenCalled();
  });

  it('destroy() unregisters the entry and unmounts the component — no leaked roots', () => {
    const registry = createBlockPortalRegistry();
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon });
    const tool = new Tool(makeOptions(registry));

    const item = firstItem(tool.render() as MenuConfig);

    document.body.appendChild(item.icon as HTMLElement);
    render(<BlockPortalHost registry={registry} />);

    expect((item.icon as HTMLElement).querySelector('[data-testid="color-icon"]')).not.toBeNull();

    act(() => {
      tool.destroy?.();
    });

    expect(registry.getSnapshot().size).toBe(0);
    expect(unmountSpy).toHaveBeenCalledTimes(1);
    expect((item.icon as HTMLElement).querySelector('[data-testid="color-icon"]')).toBeNull();
  });

  it('destroy() is idempotent', () => {
    const registry = createBlockPortalRegistry();
    const unregisterSpy = vi.spyOn(registry, 'unregister');
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon });
    const tool = new Tool(makeOptions(registry));

    void tool.render();

    tool.destroy?.();
    tool.destroy?.();

    expect(unregisterSpy).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot().size).toBe(0);
  });

  it('two instances register distinct keys; render-probe + destroy leaves the registry empty', () => {
    const registry = createBlockPortalRegistry();
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon });

    const toolA = new Tool(makeOptions(registry));
    const toolB = new Tool(makeOptions(registry));

    void toolA.render();
    void toolB.render();

    expect(registry.getSnapshot().size).toBe(2);

    // Throwaway probe pattern (toolOpensPopover): render then destroy
    toolB.destroy?.();
    expect(registry.getSnapshot().size).toBe(1);

    toolA.destroy?.();
    expect(registry.getSnapshot().size).toBe(0);
  });

  it('works without a registry (vanilla core): render() returns a MenuConfig with an empty host and nothing crashes', () => {
    const Tool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon, checkState: () => true });
    const tool = new Tool(makeOptions(undefined));

    const item = firstItem(tool.render() as MenuConfig);

    expect(item.icon).toBeInstanceOf(HTMLElement);
    expect((item.icon as HTMLElement).childNodes).toHaveLength(0);
    expect(item.isActive?.()).toBe(true);
    expect(() => tool.destroy?.()).not.toThrow();
  });
});

describe('useBlok wiring for react inline tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorConfigs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects the portal registry and tool name into a react-inline-tool config, leaving vanilla tools untouched', async () => {
    const InlineTool = createReactInlineTool({ type: 'descriptionColor', component: ColorIcon });

    class VanillaTool {
      public render(): HTMLElement {
        return document.createElement('div');
      }
    }

    const { unmount } = renderHook(() =>
      useBlok({
        tools: {
          descriptionColor: InlineTool,
          vanilla: { class: VanillaTool, config: { keep: 1 } },
        },
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    const tools = constructorConfigs[0].tools as Record<
      string,
      { class?: unknown; config?: Record<string, unknown> }
    >;

    expect(tools.descriptionColor.class).toBe(InlineTool);
    expect(tools.descriptionColor.config?.[BLOK_PORTAL_REGISTRY_CONFIG_KEY]).toBeDefined();
    expect(tools.descriptionColor.config?.[BLOK_TOOL_NAME_CONFIG_KEY]).toBe('descriptionColor');

    expect(tools.vanilla.config?.keep).toBe(1);
    expect(tools.vanilla.config?.[BLOK_PORTAL_REGISTRY_CONFIG_KEY]).toBeUndefined();

    unmount();
  });
});
