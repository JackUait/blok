import { createHeadlessAgentSetup } from './agent-runtime';

import type { AgentContract, BlokCustomToolsFile, ManifestOverrides } from '../../types/tool-manifest';
import type { HostService } from '../../types/tools/tool-description';
import type { ToolRuntimeRegistry } from '../shared/tool-actions/runtime';

export interface McpContracts {
  stored: AgentContract;
  live: AgentContract;
  runtimes: ToolRuntimeRegistry;
  richTextFieldsFor(type: string): string[];
}

export interface McpContractInput {
  manifest?: BlokCustomToolsFile;
  overrides?: ManifestOverrides;
  pageTitles: 'off' | 'page-map';
  /** blok-mcp can create page documents, so a page block inserts in both contracts. */
  createsPages?: boolean;
  richTextFields?: Record<string, string[]>;
  /** A sync URL is set: live handles read the room's version history. */
  versionHistory?: boolean;
  /** The host gave an uploader: `<tool>.uploadFile` runs. */
  uploadsFiles?: boolean;
  /** BlokMcpOptions.comments. */
  comments?: boolean;
}

/** One mode's contract. Both modes get the same inputs; only the runtime tag differs. */
const setupFor = (input: McpContractInput, runtime: 'node' | 'node-live'): ReturnType<typeof createHeadlessAgentSetup> => {
  // With a sync URL every handle is live (resolveMode), so the listed stored contract may name the history reads too.
  const services: HostService[] = [
    ...(input.pageTitles === 'page-map' ? ['pageBackend' as const] : []),
    ...(input.versionHistory === true ? ['versionHistory' as const] : []),
    ...(input.uploadsFiles === true ? ['uploader' as const] : []),
  ];

  return createHeadlessAgentSetup({
    customTools: input.manifest,
    overrides: input.overrides,
    services,
    runtime,
    ...(input.createsPages === true && input.pageTitles === 'page-map' && { prepares: ['page'] }),
    // The sync server's history restores too.
    ...(input.versionHistory === true && { restores: true }),
    ...(input.uploadsFiles === true && { uploadsFiles: true }),
    ...(input.comments === false && { comments: false }),
  });
};

const richTextFieldsOf = (input: McpContractInput, contract: AgentContract): ((type: string) => string[]) => {
  const fromManifest = new Map(contract.manifest.blocks.map(block => [block.name, block.richTextFields ?? []]));

  return type => fromManifest.get(type) ?? input.richTextFields?.[type] ?? [];
};

export const buildMcpContracts = (input: McpContractInput): McpContracts => {
  const stored = setupFor(input, 'node');
  const live = setupFor(input, 'node-live');

  return {
    stored: stored.contract,
    live: live.contract,
    runtimes: stored.tools,
    richTextFieldsFor: richTextFieldsOf(input, stored.contract),
  };
};

/** What blok-mcp was started with, as far as its contracts care. */
export interface McpContractFlags {
  manifest?: BlokCustomToolsFile;
  overrides?: ManifestOverrides;
  pageTitles?: 'off' | 'page-map';
  richTextFields?: Record<string, string[]>;
  /** A sync URL is configured. */
  sync: boolean;
  /** A document source is configured. */
  source: boolean;
  /** The host gave an uploader. */
  uploads: boolean;
  comments?: boolean;
}

const contractInputOf = (flags: McpContractFlags): McpContractInput => {
  const pageTitles = flags.pageTitles ?? 'off';

  return {
    manifest: flags.manifest,
    overrides: flags.overrides,
    pageTitles,
    // Stored saves the new document through the source; live joins its room once (opener.createPage).
    createsPages: pageTitles === 'page-map' && (flags.sync || flags.source),
    richTextFields: flags.richTextFields,
    versionHistory: flags.sync,
    uploadsFiles: flags.uploads,
    comments: flags.comments !== false,
  };
};

/** The contracts blok-mcp serves for these start options. */
export const mcpContractsFor = (flags: McpContractFlags): McpContracts => buildMcpContracts(contractInputOf(flags));

/** One mode's contract and tools, built once: what a single call on a handle needs. */
export const mcpContractFor = (
  flags: McpContractFlags,
  mode: 'stored' | 'live',
): { contract: AgentContract; runtimes: ToolRuntimeRegistry; richTextFieldsFor(type: string): string[] } => {
  const input = contractInputOf(flags);
  const setup = setupFor(input, mode === 'live' ? 'node-live' : 'node');

  // Both setups build the same tool registry and manifest, so one mode's serves.
  return { contract: setup.contract, runtimes: setup.tools, richTextFieldsFor: richTextFieldsOf(input, setup.contract) };
};
