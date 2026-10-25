import { createHeadlessAgentSetup } from '../view/agent-runtime';

import type { AgentContract, BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';
import type { HostService } from '../../types/tools/tool-description';
import type { ToolRuntimeRegistry } from '../shared/tool-actions/runtime';

export interface McpContracts {
  stored: AgentContract;
  live: AgentContract;
  runtimes: ToolRuntimeRegistry;
  richTextFieldsFor(type: string): string[];
}

export const buildMcpContracts = (input: {
  manifest?: BlokCustomToolsFile;
  overrides?: ManifestOverrides;
  pageTitles: 'off' | 'page-map';
  /** Stored opens can create page documents, so a page block inserts there. */
  createsPages?: boolean;
  richTextFields?: Record<string, string[]>;
}): McpContracts => {
  const services: HostService[] = input.pageTitles === 'page-map' ? ['pageBackend'] : [];
  const stored = createHeadlessAgentSetup({
    customTools: input.manifest,
    overrides: input.overrides,
    services,
    runtime: 'node',
    ...(input.createsPages === true && input.pageTitles === 'page-map' && { prepares: ['page'] }),
  });
  const live = createHeadlessAgentSetup({
    customTools: input.manifest,
    overrides: input.overrides,
    services,
    runtime: 'node-live',
  });
  const fromManifest = new Map(stored.contract.manifest.blocks.map(block => [block.name, block.richTextFields ?? []]));

  return {
    stored: stored.contract,
    live: live.contract,
    runtimes: stored.tools,
    richTextFieldsFor: type => fromManifest.get(type) ?? input.richTextFields?.[type] ?? [],
  };
};
