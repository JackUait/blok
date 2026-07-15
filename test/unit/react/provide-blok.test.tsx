import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useBlok } from '../../../packages/react/src/useBlok';
import { BlokProvider } from '../../../packages/react/src/provide-blok';
import type { UseBlokConfig } from '../../../packages/react/src/types';

interface MockInstance {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  theme: { set: ReturnType<typeof vi.fn> };
  width: { set: ReturnType<typeof vi.fn> };
  placeholder: { set: ReturnType<typeof vi.fn> };
  render: ReturnType<typeof vi.fn>;
  config: Record<string, unknown>;
}

let instances: MockInstance[] = [];

vi.mock('../../../src/blok', () => ({
  Blok: class MockBlok {
    public isReady: Promise<void>;
    public destroy = vi.fn();
    public readOnly = { set: vi.fn().mockResolvedValue(true) };
    public focus = vi.fn();
    public theme = { set: vi.fn() };
    public width = { set: vi.fn() };
    public placeholder = { set: vi.fn() };
    public render = vi.fn();
    public config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.isReady = Promise.resolve();
      instances.push(this as unknown as MockInstance);
    }
  },
}));

function Harness({ config }: { config: UseBlokConfig }): React.ReactElement {
  useBlok(config);

  return <div />;
}

describe('React provideBlok / BlokProvider', () => {
  beforeEach(() => {
    instances = [];
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds app-wide defaults into useBlok config', async () => {
    render(
      <BlokProvider defaults={{ theme: 'dark' }}>
        <Harness config={{}} />
      </BlokProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances).toHaveLength(1);
    expect(instances[0].config.theme).toBe('dark');
  });

  it('lets a per-instance prop override the provided default', async () => {
    render(
      <BlokProvider defaults={{ theme: 'dark' }}>
        <Harness config={{ theme: 'light' }} />
      </BlokProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances[0].config.theme).toBe('light');
  });

  it('merges the tools registry across provider defaults and per-instance props', async () => {
    const sharedTool = { class: class A {} };
    const localTool = { class: class B {} };

    render(
      <BlokProvider defaults={{ tools: { shared: sharedTool } as UseBlokConfig['tools'] }}>
        <Harness config={{ tools: { local: localTool } as UseBlokConfig['tools'] }} />
      </BlokProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    const tools = instances[0].config.tools as Record<string, unknown>;

    expect(tools.shared).toBe(sharedTool);
    expect(tools.local).toBe(localTool);
  });

  it('leaves config untouched when no provider is present', async () => {
    render(<Harness config={{ theme: 'light' }} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(instances[0].config.theme).toBe('light');
  });
});
