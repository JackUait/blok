// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { describeContract } from '../../../../src/shared/agent/describe';
import { nodeContract } from '../../agent/harness';

const contract = nodeContract();

describe('describeContract', () => {
  it('a tool slice lists each action once, as a command, without the duplicated actions list', () => {
    const slice = describeContract(contract, { tool: 'table' });

    expect(slice).toHaveProperty('tool.name', 'table');
    expect(slice).not.toHaveProperty('tool.actions');
    expect(slice).toHaveProperty('commands');
  });

  it('a tool slice keeps the preconditions the actions declared, on the matching command', () => {
    const slice = describeContract(contract, { tool: 'table' });
    const commands = 'commands' in slice ? slice.commands : [];

    expect(commands.find(command => command.name === 'table.deleteRows')).toMatchObject({
      preconditions: ['At least one row must remain.'],
    });
    expect(commands.find(command => command.name === 'table.insertRows')).not.toHaveProperty('preconditions');
  });

  it('a command slice carries its preconditions too', () => {
    expect(describeContract(contract, { command: 'table.deleteColumns' })).toMatchObject({
      command: { name: 'table.deleteColumns', preconditions: ['At least one column must remain.'] },
    });
    expect(describeContract(contract, { command: 'block.insert' })).not.toHaveProperty('command.preconditions');
  });

  it('the index marks each command this runtime refuses, with the reason the refusal gives', () => {
    const slice = describeContract(contract);
    const listed = 'index' in slice ? slice.index.commands : [];
    const refused = contract.commands.filter(command => !command.available);

    expect(refused.length).toBeGreaterThan(0);
    refused.forEach(command => {
      expect(listed.find(entry => entry.name === command.name)).toEqual({
        name: command.name, summary: command.summary, available: false, reason: command.unavailableReason,
      });
    });
    contract.commands.filter(command => command.available).forEach(command => {
      expect(listed.find(entry => entry.name === command.name)).toEqual({ name: command.name, summary: command.summary });
    });
  });
});
