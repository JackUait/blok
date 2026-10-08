import { failure } from './errors';
import { splitCommandName } from './names';

import type { AgentBatch, AgentCommand } from '../../../types/agent';
import type { PlannerCommand, SchemaValidator } from './types';

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !isArray(value);
const isCommandName = (name: string): name is AgentCommand['name'] => name.includes('.');

const toolActions = (commands: ReadonlyMap<string, PlannerCommand>, tool: string): string[] =>
  [...commands.values()]
    .filter(entry => typeof entry.source === 'object' && entry.source.tool === tool)
    .map(entry => entry.name).sort();

export const checkEnvelope = (
  batch: unknown,
  commands: ReadonlyMap<string, PlannerCommand>,
  validate: SchemaValidator
): { batch: AgentBatch; writes: boolean } => {
  if (!isRecord(batch) || !isArray(batch.commands) || batch.commands.length === 0) {
    throw failure('INVALID_ARGS', 'A batch is { commands: [ { name, args } ... ] } with at least one command.', { path: '/commands' });
  }
  if (batch.expectRevision !== undefined && typeof batch.expectRevision !== 'string') {
    throw failure('INVALID_ARGS', 'expectRevision must be the string a read or result returned.', { path: '/expectRevision' });
  }

  const list = batch.commands;
  const entries: Array<{ command: AgentCommand; entry: PlannerCommand }> = [];

  for (const [index, raw] of list.entries()) {
    const path = `/commands/${index}`;

    if (!isRecord(raw) || typeof raw.name !== 'string' || !isRecord(raw.args)
      || (raw.ref !== undefined && typeof raw.ref !== 'string')) {
      throw failure('INVALID_ARGS', 'Each command is { name: string, args: object, ref?: string }.', { commandIndex: index, path });
    }

    const name = raw.name;
    const entry = commands.get(name);

    if (entry === undefined || !isCommandName(name)) {
      const split = splitCommandName(name);
      const actions = split === null ? [] : toolActions(commands, split.namespace);

      throw failure('UNKNOWN_COMMAND', actions.length > 0 && split !== null
        ? `"${name}" is not an action of "${split.namespace}". Its actions: ${actions.join(', ')}.`
        : `"${name}" is not a command here. Call describe() for the list.`, {
        commandIndex: index, path: `${path}/name`,
        ...(actions.length > 0 && split !== null ? { details: { tool: split.namespace, actions } } : {}),
      });
    }
    if (!entry.available) {
      throw failure('COMMAND_UNAVAILABLE', `"${name}" is not available here${entry.unavailableReason === 'service'
        ? ': the host has not provided a service it needs' : ''}.`, {
        commandIndex: index, path: `${path}/name`,
        details: {
          ...(entry.unavailableReason === undefined ? {} : { reason: entry.unavailableReason }),
          ...(entry.requires === undefined ? {} : { requires: entry.requires }),
        },
      });
    }

    const problems = validate(entry.args, raw.args);
    const first = problems[0];

    if (first !== undefined) {
      throw failure('INVALID_ARGS', `${name}: ${first.message}`, {
        commandIndex: index, path: `${path}/args${first.path}`, details: { problems },
      });
    }

    entries.push({
      command: { name, args: raw.args, ...(typeof raw.ref === 'string' ? { ref: raw.ref } : {}) },
      entry,
    });
  }

  entries.forEach(({ command, entry }, index) => {
    if ((entry.effects === 'host' || command.name === 'history.undo' || command.name === 'history.redo') && entries.length > 1) {
      throw failure('INVALID_ARGS', `"${command.name}" must be the only command in its batch. Send the other commands in a separate execute call.`, {
        commandIndex: index, path: `/commands/${index}/name`,
      });
    }
  });

  return {
    batch: {
      commands: entries.map(({ command }) => command),
      ...(typeof batch.expectRevision === 'string' ? { expectRevision: batch.expectRevision } : {}),
    },
    writes: entries.some(({ entry }) => !entry.readOnly),
  };
};
