import { describe, it, expect } from 'vitest';

import ToolsAPI from '../../../../../src/components/modules/api/tools';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';
import type { EditorConfig } from '../../../../../types';
import type { EditorEventMap } from '../../../../../src/components/events';
import type BlockToolAdapter from '../../../../../src/components/tools/block';

type CreateToolsApiResult = {
  toolsApi: ToolsAPI;
  blockTools: Map<string, BlockToolAdapter>;
};

const createToolsApi = (
  blockToolsEntries: Array<[string, BlockToolAdapter]> = []
): CreateToolsApiResult => {
  const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as EditorConfig,
    eventsDispatcher,
  };

  const toolsApi = new ToolsAPI(moduleConfig);
  const blockTools = new Map(blockToolsEntries);

  toolsApi.state = {
    Tools: {
      blockTools,
    },
  } as unknown as EditorModules;

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
});
