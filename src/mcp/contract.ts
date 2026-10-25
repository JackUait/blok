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
  /** blok-mcp can create page documents, so a page block inserts in both contracts. */
  createsPages?: boolean;
  richTextFields?: Record<string, string[]>;
  /** A sync URL is set: live handles read the room's version history. */
  versionHistory?: boolean;
}): McpContracts => {
  // With a sync URL every handle is live (resolveMode), so the listed stored contract may name the history reads too.
  const services: HostService[] = [
    ...(input.pageTitles === 'page-map' ? ['pageBackend' as const] : []),
    ...(input.versionHistory === true ? ['versionHistory' as const] : []),
  ];
  const prepares = input.createsPages === true && input.pageTitles === 'page-map' ? { prepares: ['page'] } : {};
  const stored = createHeadlessAgentSetup({
    customTools: input.manifest,
    overrides: input.overrides,
    services,
    runtime: 'node',
    ...prepares,
  });
  const live = createHeadlessAgentSetup({
    customTools: input.manifest,
    overrides: input.overrides,
    services,
    runtime: 'node-live',
    ...prepares,
  });
  const fromManifest = new Map(stored.contract.manifest.blocks.map(block => [block.name, block.richTextFields ?? []]));

  return {
    stored: stored.contract,
    live: live.contract,
    runtimes: stored.tools,
    richTextFieldsFor: type => fromManifest.get(type) ?? input.richTextFields?.[type] ?? [],
  };
};
