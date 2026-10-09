import type { ContractSlice } from '../../../types/agent';
import type { AgentContract } from '../../../types/tool-manifest';
import { failure } from './errors';

export const describeContract = (
  contract: AgentContract,
  query: { tool?: string; command?: string } = {}
): AgentContract | ContractSlice => {
  if (query.command !== undefined) {
    const command = contract.commands.find(entry => entry.name === query.command);

    if (command === undefined) {
      throw failure('UNKNOWN_COMMAND', `No command "${query.command}". Call describe() for the list.`);
    }

    return { command };
  }
  if (query.tool !== undefined) {
    const tool = contract.manifest.blocks.find(entry => entry.name === query.tool);

    if (tool === undefined) {
      throw failure('UNKNOWN_TOOL', `No block tool "${query.tool}". Call describe() for the list.`);
    }

    return { tool, commands: contract.commands.filter(entry => typeof entry.source === 'object' && entry.source.tool === query.tool) };
  }

  return {
    index: {
      tools: contract.manifest.blocks.map(entry => ({ name: entry.name, summary: entry.summary })),
      commands: contract.commands.map(entry => ({ name: entry.name, summary: entry.summary })),
      guidance: contract.guidance.general,
    },
  };
};
