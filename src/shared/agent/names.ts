import type { CoreCommandName } from '../../../types/agent';
import { RESERVED_NAMESPACES } from '../tool-manifest';

export { RESERVED_NAMESPACES };

export const CORE_COMMAND_NAMES: readonly CoreCommandName[] = [
  'doc.read', 'doc.find', 'doc.setTitle', 'doc.setIcon',
  'block.insert', 'block.update', 'block.delete', 'block.move', 'block.convert', 'block.duplicate',
  'text.insert', 'text.delete', 'text.replace', 'text.format',
  'markdown.insert', 'markdown.export', 'html.insert',
  'history.undo', 'history.redo',
  'history.versions', 'history.read', 'history.changes', 'history.restore',
];

/** Calls on the host's version history; the executor runs them, not the planner. */
export const VERSION_COMMANDS = ['history.versions', 'history.read', 'history.changes', 'history.restore'] as const;

export type VersionCommandName = typeof VERSION_COMMANDS[number];

export type VersionReadName = Exclude<VersionCommandName, 'history.restore'>;

export const isVersionRead = (name: string): name is VersionReadName =>
  name !== 'history.restore' && VERSION_COMMANDS.some(command => command === name);

export const isReservedNamespace = (namespace: string): boolean =>
  RESERVED_NAMESPACES.some(reserved => reserved === namespace);

export const splitCommandName = (name: string): { namespace: string; action: string } | null => {
  const dot = name.indexOf('.');

  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }

  return { namespace: name.slice(0, dot), action: name.slice(dot + 1) };
};

// The core commands whose result can name a new block. The planner refuses a ref on any other core command.
const REF_CORE_COMMANDS: ReadonlySet<string> = new Set(['block.insert', 'block.duplicate']);

/** Whether a command may carry a ref: a tool action, or a core command that creates a block. */
export const carriesRef = (entry: { name: string; source: 'core' | { tool: string } }): boolean =>
  entry.source !== 'core' || REF_CORE_COMMANDS.has(entry.name);
