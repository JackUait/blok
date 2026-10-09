import { richTextHelpers } from './rich-text-ops';

import type { AgentPorts, PlannerCommand, PlannerContext, PlannerTool, PlannerToolEntry, PlannerToolRuntime, SchemaValidator } from './types';

export type ContractLike = { commands: readonly PlannerCommand[]; manifest: { defaultBlock: string; blocks: readonly PlannerToolEntry[] } };

export const plannerContextFrom = (
  contract: ContractLike,
  runtimes: ReadonlyMap<string, PlannerToolRuntime>,
  ports: AgentPorts,
  validate: SchemaValidator,
  services: Partial<Record<string, unknown>>
): Omit<PlannerContext, 'prepared'> => ({
  tools: new Map<string, PlannerTool>(contract.manifest.blocks.map(entry => [entry.name, {
    entry,
    runtime: runtimes.get(entry.name) ?? { actions: {} },
  }])),
  commands: new Map<string, PlannerCommand>(contract.commands.map(entry => [entry.name, entry])),
  ports,
  validate,
  defaultBlock: contract.manifest.defaultBlock,
  richText: richTextHelpers,
  services,
});
