import type { AgentContract } from '../../../types/tool-manifest';

import { mcpInstructions } from './instructions';
import { DEFAULTS } from './options';
import { listMcpPrompts, type McpPrompt } from './prompts';
import type { UnavailableCommand } from './session';
import { listMcpTools, type McpTool } from './tools';

// tools/list renders the stored contract, so a live handle names what it refuses from that list.
export const liveUnavailableCommands = (stored: AgentContract, live: AgentContract): UnavailableCommand[] => {
  const here = new Map(live.commands.map((entry) => [entry.name, entry]));

  return stored.commands.flatMap((entry) => {
    const liveEntry = here.get(entry.name);

    if (!entry.available || liveEntry?.available === true) {
      return [];
    }

    return [{ name: entry.name, reason: liveEntry?.unavailableReason ?? 'runtime' }];
  });
};

/** Everything blok-mcp tells a client before any document is open. */
export interface McpSurface {
  tools: McpTool[];
  instructions: string;
  prompts: McpPrompt[];
  /** blok_open reports the contract of the handle's mode. */
  contractRevision: { stored: string; live: string };
  /** What a live handle refuses of the listed commands; blok_open sends it only when not empty. */
  liveUnavailableCommands: UnavailableCommand[];
}

export const mcpSurface = (
  contracts: { stored: AgentContract; live: AgentContract },
  options: { schema?: 'envelope' | 'full' | 'mixed'; handleIdleMs?: number },
): McpSurface => ({
  tools: listMcpTools(contracts.stored, {
    schema: options.schema ?? DEFAULTS.schema,
    handleIdleMs: options.handleIdleMs ?? DEFAULTS.handleIdleMs,
  }),
  instructions: mcpInstructions(contracts.stored),
  prompts: listMcpPrompts(),
  contractRevision: { stored: contracts.stored.revision, live: contracts.live.revision },
  liveUnavailableCommands: liveUnavailableCommands(contracts.stored, contracts.live),
});
