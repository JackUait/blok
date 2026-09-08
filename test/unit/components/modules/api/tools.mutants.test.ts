import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ToolsAPI } from '../../../../../src/components/modules/api/tools';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig, ToolConfig } from '@/types';
import type { Mock } from 'vitest';

/**
 * Mutant notes for src/components/modules/api/tools.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

type ToolsModuleMock = {
  updateToolConfig: Mock<(name: string, config: Partial<ToolConfig>) => void>;
  setInlineToolbar: Mock<(inlineToolbar: boolean | string[]) => void>;
  available: Map<string, unknown>;
};

const makeApi = (config: BlokConfig): { api: ToolsAPI; tools: ToolsModuleMock } => {
  const tools: ToolsModuleMock = {
    updateToolConfig: vi.fn(),
    setInlineToolbar: vi.fn(),
    available: new Map<string, unknown>([['paragraph', {}]]),
  };

  const api = new ToolsAPI({
    config,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  // Only the Tools module is reachable from the methods under test.
  api.state = { Tools: tools } as unknown as BlokModules;

  return { api,
    tools };
};

describe('ToolsAPI.getToolsConfig', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('omits the optional keys the editor config never set', () => {
    const { api } = makeApi({ tools: {} });

    expect(api.methods.getToolsConfig()).toStrictEqual({ tools: {} });
  });

  it('omits only the optional keys that are missing', () => {
    const { api } = makeApi({ tools: {},
      tunes: ['moveUp'] });

    expect(api.methods.getToolsConfig()).toStrictEqual({ tools: {},
      tunes: ['moveUp'] });
  });

  it('carries every optional key the editor config did set', () => {
    const { api } = makeApi({
      tools: {},
      inlineToolbar: ['bold'],
      tunes: ['moveUp'],
      theme: 'dark',
    });

    expect(api.methods.getToolsConfig()).toStrictEqual({
      tools: {},
      inlineToolbar: ['bold'],
      tunes: ['moveUp'],
      theme: 'dark',
    });
  });
});

describe('ToolsAPI reactive setters', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('forwards a tool config update', () => {
    const { api, tools } = makeApi({ tools: {} });

    api.methods.update('image', { endpoint: '/upload' });

    expect(tools.updateToolConfig.mock.calls).toStrictEqual([['image', { endpoint: '/upload' }]]);
  });

  it('forwards the global inline toolbar setting', () => {
    const { api, tools } = makeApi({ tools: {} });

    api.methods.setInlineToolbar(['bold', 'italic']);

    expect(tools.setInlineToolbar.mock.calls).toStrictEqual([[['bold', 'italic']]]);
  });

  it('reports whether a tool is installed', () => {
    const { api } = makeApi({ tools: {} });

    expect(api.methods.isInstalled('paragraph')).toBe(true);
    expect(api.methods.isInstalled('image')).toBe(false);
  });
});
