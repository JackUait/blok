import { AgentFailure, failure, problemOf, warning } from './errors';
import { carriesRef, splitCommandName, VERSION_COMMANDS } from './names';

import type { AgentBatch, AgentCommand, AgentWarning } from '../../../types/agent';
import type { PlannerCommand, SchemaValidator } from './types';

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !isArray(value);
const isCommandName = (name: string): name is AgentCommand['name'] => name.includes('.');

const toolActions = (commands: ReadonlyMap<string, PlannerCommand>, tool: string): string[] =>
  [...commands.values()]
    .filter(entry => typeof entry.source === 'object' && entry.source.tool === tool)
    .map(entry => entry.name).sort();

const checkCommand = (
  raw: unknown,
  index: number,
  commands: ReadonlyMap<string, PlannerCommand>,
  validate: SchemaValidator
): { command: AgentCommand; entry: PlannerCommand; corrected?: AgentWarning } => {
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

  const sent = validate(entry.args, raw.args);
  // A command that cannot carry a ref keeps the plain unknown-field error.
  const misplacedRef = raw.ref === undefined && carriesRef(entry)
    ? sent.find(problem => problem.path === '/ref' && problem.message.startsWith('unknown field'))
    : undefined;
  const hoisted = misplacedRef !== undefined && typeof raw.args.ref === 'string' ? raw.args.ref : undefined;
  // A copy: the pre-flight reads the raw batch again and counts args.ref as declared.
  const args = hoisted === undefined ? raw.args : Object.fromEntries(Object.entries(raw.args).filter(([key]) => key !== 'ref'));
  const problems = hoisted === undefined ? sent : validate(entry.args, args);

  if (misplacedRef !== undefined && hoisted === undefined) {
    throw failure('INVALID_ARGS', `${name}: "ref" goes next to name and args, not inside args: `
      + `{ "name": "${name}", "args": { ... }, "ref": ${JSON.stringify(raw.args.ref)} }.`, {
      commandIndex: index, path: `${path}/args/ref`, details: { problems },
    });
  }
  const first = problems[0];

  if (first !== undefined) {
    throw failure('INVALID_ARGS', `${name}: ${first.message}`, {
      commandIndex: index, path: `${path}/args${first.path}`, details: { problems },
    });
  }

  const ref = hoisted ?? (typeof raw.ref === 'string' ? raw.ref : undefined);

  return {
    command: { name, args, ...(ref === undefined ? {} : { ref }) },
    entry,
    ...(hoisted !== undefined && {
      corrected: warning('CORRECTED', '"ref" goes next to name and args, not inside args. It was moved there this time.', {
        commandIndex: index, field: 'ref',
      }),
    }),
  };
};

const attempt = <T>(run: () => T): T | AgentFailure => {
  try {
    return run();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error;
    }
    throw error;
  }
};

// History and versions run before planning, so they cannot share a batch. A command with a host
// hook runs alone too: an earlier command could change the form or button the person sees.
const ALONE_COMMANDS: ReadonlySet<string> = new Set(['history.undo', 'history.redo', ...VERSION_COMMANDS, 'database.submitForm', 'database.pressButton']);

export const checkEnvelope = (
  batch: unknown,
  commands: ReadonlyMap<string, PlannerCommand>,
  validate: SchemaValidator
): { batch: AgentBatch; writes: boolean; warnings?: AgentWarning[] } => {
  if (!isRecord(batch) || !isArray(batch.commands) || batch.commands.length === 0) {
    throw failure('INVALID_ARGS', 'A batch is { commands: [ { name, args } ... ] } with at least one command.', { path: '/commands' });
  }
  if (batch.expectRevision !== undefined && typeof batch.expectRevision !== 'string') {
    throw failure('INVALID_ARGS', 'expectRevision must be the string a read or result returned.', { path: '/expectRevision' });
  }

  const list = batch.commands;
  const entries: Array<{ index: number; command: AgentCommand; entry: PlannerCommand; corrected?: AgentWarning }> = [];
  const problems: AgentFailure[] = [];

  // Check every command, so one failed batch names every mistake. entries() also visits holes.
  for (const [index, raw] of list.entries()) {
    const checked = attempt(() => checkCommand(raw, index, commands, validate));

    if (checked instanceof AgentFailure) {
      problems.push(checked);
    } else {
      entries.push({ index, ...checked });
    }
  }

  entries.forEach(({ command, entry, index }) => {
    if ((entry.effects === 'host' || ALONE_COMMANDS.has(command.name)) && list.length > 1) {
      problems.push(failure('INVALID_ARGS', `"${command.name}" must be the only command in its batch. Send the other commands in a separate execute call.`, {
        commandIndex: index, path: `/commands/${index}/name`,
      }));
    }
  });

  // Command problems lead, so the first error is the one a stop-at-first check would throw.
  const [first, ...rest] = problems;

  if (first !== undefined) {
    throw rest.length === 0 ? first : new AgentFailure({ ...first.error, others: rest.map(problem => problemOf(problem.error)) });
  }

  const warnings = entries.flatMap(({ corrected }) => corrected === undefined ? [] : [corrected]);

  return {
    batch: {
      commands: entries.map(({ command }) => command),
      ...(typeof batch.expectRevision === 'string' ? { expectRevision: batch.expectRevision } : {}),
    },
    writes: entries.some(({ entry }) => !entry.readOnly),
    ...(warnings.length > 0 && { warnings }),
  };
};
