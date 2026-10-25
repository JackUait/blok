import { parsePartialJson } from '../../../agent/partial-json';

/**
 * Picks the Ask AI status line for one step of a run, as an i18n key.
 * Tool input comes from the model, so every field is checked before use.
 */

/** Built-in tools with a line of their own. Others get the generic line. */
const INSERT_KEYS: Record<string, string> = {
  paragraph: 'assistant.status.paragraph',
  header: 'assistant.status.heading',
  list: 'assistant.status.list',
  table: 'assistant.status.table',
  callout: 'assistant.status.callout',
  code: 'assistant.status.code',
  quote: 'assistant.status.quote',
  toggle: 'assistant.status.toggle',
  image: 'assistant.status.image',
  database: 'assistant.status.database',
  column_list: 'assistant.status.columns',
  divider: 'assistant.status.divider',
};

const COMMAND_KEYS: Record<string, string> = {
  'markdown.insert': 'assistant.status.markdown',
  'block.delete': 'assistant.status.remove',
  'block.move': 'assistant.status.move',
  'block.duplicate': 'assistant.status.block',
  'doc.setTitle': 'assistant.status.title',
  'doc.setIcon': 'assistant.status.title',
};

const READ_COMMANDS = new Set(['doc.read', 'doc.find', 'markdown.export']);
// Each runs alone in its batch, so it names the whole step.
const VERSION_READS = new Set(['history.versions', 'history.read', 'history.changes']);

type Command = { name: string; args: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const firstWrite = (input: unknown): Command | null => {
  const commands = isRecord(input) && Array.isArray(input.commands) ? input.commands : [];

  for (const command of commands) {
    if (isRecord(command) && typeof command.name === 'string' && !READ_COMMANDS.has(command.name)) {
      return { name: command.name, args: isRecord(command.args) ? command.args : {} };
    }
  }

  return null;
};

const stringArg = (args: Record<string, unknown>, key: string): string | undefined =>
  (typeof args[key] === 'string' ? args[key] : undefined);

const executeKey = (input: unknown, typeOf: (id: string) => string | undefined): string => {
  const command = firstWrite(input);

  if (command === null) {
    return 'assistant.status.editing';
  }

  const { name, args } = command;

  if (VERSION_READS.has(name)) {
    return 'assistant.status.reading';
  }

  // hasOwn: a model-sent "toString" must not find Object.prototype.
  if (name === 'block.insert' || name === 'block.convert') {
    const type = stringArg(args, 'type') ?? '';

    return Object.hasOwn(INSERT_KEYS, type) ? INSERT_KEYS[type] : 'assistant.status.block';
  }
  if (Object.hasOwn(COMMAND_KEYS, name)) {
    return COMMAND_KEYS[name];
  }
  if (name.startsWith('text.')) {
    return 'assistant.status.text';
  }

  const id = stringArg(args, 'id') ?? '';
  // A tool action is named <tool>.<action>; block.update names the block by id.
  const tool = name === 'block.update' ? typeOf(id) : name.split('.')[0];

  if (tool === 'table') {
    return 'assistant.status.table';
  }

  return name.startsWith('history.') ? 'assistant.status.editing' : 'assistant.status.edit';
};

/**
 * @param activity - 'thinking', or the tool the model calls
 * @param input - that tool's input
 * @param typeOf - the tool name of a block in the document
 */
export const stepStatusKey = (activity: string, input: unknown, typeOf: (id: string) => string | undefined): string => {
  switch (activity) {
    case 'thinking':
      return 'assistant.status.thinking';
    case 'blok_read':
      return 'assistant.status.reading';
    case 'blok_describe':
      return 'assistant.status.checking';
    case 'blok_execute':
      return executeKey(input, typeOf);
    default:
      return 'assistant.status.working';
  }
};

/** A key is final once a later key has started, or its command is done. */
const settled = (record: Record<string, unknown>, key: string, done: boolean): boolean => {
  const keys = Object.keys(record);

  return done || (keys.includes(key) && keys.indexOf(key) < keys.length - 1);
};

const isWhole = (json: string): boolean => {
  try {
    JSON.parse(json);

    return true;
  } catch {
    return false;
  }
};

/** The arg that picks the line, which may still be cut off mid-stream. */
const DECIDING_ARG: Record<string, string> = { 'block.insert': 'type', 'block.convert': 'type', 'block.update': 'id' };

/**
 * The line for a `blok_execute` call whose input is still streaming, or null
 * while the part that picks the line may still be cut off.
 * @param json - the call's input so far
 * @param typeOf - the tool name of a block in the document
 */
export const streamStatusKey = (json: string, typeOf: (id: string) => string | undefined): string | null => {
  const input = parsePartialJson(json);
  const commands = isRecord(input) && Array.isArray(input.commands) ? input.commands.filter(isRecord) : [];
  const whole = isWhole(json);

  for (const [index, command] of commands.entries()) {
    const done = whole || index < commands.length - 1;
    const { name } = command;

    if (typeof name !== 'string' || !settled(command, 'name', done)) {
      return null;
    }
    if (READ_COMMANDS.has(name)) {
      continue;
    }

    const args = isRecord(command.args) ? command.args : {};
    const deciding = Object.hasOwn(DECIDING_ARG, name) ? DECIDING_ARG[name] : undefined;

    if (deciding !== undefined && !settled(args, deciding, done)) {
      return null;
    }

    return executeKey({ commands: [{ name, args }] }, typeOf);
  }

  return null;
};
