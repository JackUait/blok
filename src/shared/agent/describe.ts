import type { ContractSlice, DescribedCommand } from '../../../types/agent';
import type { AgentContract, CommandEntry } from '../../../types/tool-manifest';
import { validateAgainst } from '../schema/validate';
import { failure } from './errors';
import { matchVariants, titleSentence, variantSentence } from './variant-hint';

// A tool's actions repeat its commands; only their preconditions are new, so they move onto the command.
const preconditionsOf = (contract: AgentContract, command: CommandEntry): string[] => {
  if (typeof command.source !== 'object') {
    return [];
  }
  const { tool } = command.source;
  const action = contract.manifest.blocks.find(entry => entry.name === tool)?.actions.find(entry => entry.command === command.name);

  return action?.preconditions ?? [];
};

const described = (contract: AgentContract, command: CommandEntry): DescribedCommand => {
  const preconditions = preconditionsOf(contract, command);

  return preconditions.length === 0 ? command : { ...command, preconditions };
};

export const describeContract = (
  contract: AgentContract,
  query: { tool?: string; command?: string } = {}
): AgentContract | ContractSlice => {
  // Models often pass a command name as tool; answer it rather than spend another call.
  const commandName = query.command
    ?? (query.tool !== undefined
      && !contract.manifest.blocks.some(entry => entry.name === query.tool)
      && contract.commands.some(entry => entry.name === query.tool) ? query.tool : undefined);

  if (commandName !== undefined) {
    const command = contract.commands.find(entry => entry.name === commandName);

    if (command === undefined) {
      throw failure('UNKNOWN_COMMAND', `No command "${commandName}". Call describe() for the list.`);
    }

    return { command: described(contract, command) };
  }
  if (query.tool !== undefined) {
    const tool = contract.manifest.blocks.find(entry => entry.name === query.tool);

    if (tool === undefined) {
      const hint = variantSentence(query.tool, matchVariants(query.tool, contract.manifest.blocks, validateAgainst))
        || titleSentence(query.tool, contract.manifest.blocks);
      const known = contract.manifest.blocks.map(entry => entry.name).join(', ');

      throw failure('UNKNOWN_TOOL', `No block tool "${query.tool}".${hint} Known: ${known}.`);
    }

    const { actions: _actions, ...entry } = tool;

    return {
      tool: entry,
      commands: contract.commands
        .filter(command => typeof command.source === 'object' && command.source.tool === query.tool)
        .map(command => described(contract, command)),
    };
  }

  return {
    index: {
      tools: contract.manifest.blocks.map(entry => ({ name: entry.name, summary: entry.summary })),
      commands: contract.commands.map(entry => ({ name: entry.name, summary: entry.summary })),
      guidance: contract.guidance.general,
    },
  };
};
