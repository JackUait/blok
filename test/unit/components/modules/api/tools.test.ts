import { describe, it, expect } from 'vitest';

import { ToolsAPI } from '../../../../../src/components/modules/api/tools';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';

type CreateToolsApiResult = {
  toolsApi: ToolsAPI;
  blockTools: Map<string, BlockToolAdapter>;
};

const createToolsApi = (
  blockToolsEntries: Array<[string, BlockToolAdapter]> = [],
  configOverrides: Partial<BlokConfig> = {}
): CreateToolsApiResult => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: { ...configOverrides } as BlokConfig,
    eventsDispatcher,
  };

  const toolsApi = new ToolsAPI(moduleConfig);
  const blockTools = new Map(blockToolsEntries);

  toolsApi.state = {
    Tools: {
      blockTools,
    },
  } as unknown as BlokModules;

  return {
    toolsApi,
    blockTools,
  };
};

describe('ToolsAPI', () => {
  it('exposes getBlockTools via methods getter', () => {
    const toolA = { name: 'toolA' } as unknown as BlockToolAdapter;
    const toolB = { name: 'toolB' } as unknown as BlockToolAdapter;
    const { toolsApi } = createToolsApi([
      ['toolA', toolA],
      ['toolB', toolB],
    ]);

    expect(toolsApi.methods.getBlockTools()).toEqual([toolA, toolB]);
  });

  it('returns empty list when no block tools are registered', () => {
    const { toolsApi } = createToolsApi();

    expect(toolsApi.methods.getBlockTools()).toEqual([]);
  });

  describe('getToolsConfig', () => {
    it('returns tools config from the editor configuration', () => {
      const toolsConfig = {
        paragraph: { class: class {} },
        header: { class: class {} },
      };
      const { toolsApi } = createToolsApi([], { tools: toolsConfig });

      expect(toolsApi.methods.getToolsConfig()).toEqual({
        tools: toolsConfig,
      });
    });

    it('returns inlineToolbar setting when present in config', () => {
      const toolsConfig = { paragraph: { class: class {} } };
      const { toolsApi } = createToolsApi([], {
        tools: toolsConfig,
        inlineToolbar: ['bold', 'italic'],
      });

      expect(toolsApi.methods.getToolsConfig()).toEqual({
        tools: toolsConfig,
        inlineToolbar: ['bold', 'italic'],
      });
    });

    it('returns tunes setting when present in config', () => {
      const toolsConfig = { paragraph: { class: class {} } };
      const { toolsApi } = createToolsApi([], {
        tools: toolsConfig,
        tunes: ['delete'],
      });

      expect(toolsApi.methods.getToolsConfig()).toEqual({
        tools: toolsConfig,
        tunes: ['delete'],
      });
    });

    it('returns empty tools object when no tools configured', () => {
      const { toolsApi } = createToolsApi();

      expect(toolsApi.methods.getToolsConfig()).toEqual({
        tools: undefined,
      });
    });

    it('returns theme setting when present in config', () => {
      const toolsConfig = { paragraph: { class: class {} } };
      const { toolsApi } = createToolsApi([], {
        tools: toolsConfig,
        theme: 'dark',
      });

      expect(toolsApi.methods.getToolsConfig()).toEqual({
        tools: toolsConfig,
        theme: 'dark',
      });
    });
  });
});
