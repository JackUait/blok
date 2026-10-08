import type { CoreCommandName } from '../../../types/agent';
import { RESERVED_NAMESPACES } from '../tool-manifest';

export { RESERVED_NAMESPACES };

export const CORE_COMMAND_NAMES: readonly CoreCommandName[] = [
  'doc.read', 'doc.find', 'doc.setTitle', 'doc.setIcon',
  'block.insert', 'block.update', 'block.delete', 'block.move', 'block.convert', 'block.duplicate',
  'text.insert', 'text.delete', 'text.replace', 'text.format',
  'markdown.insert', 'markdown.export',
  'history.undo', 'history.redo',
];

export const isReservedNamespace = (namespace: string): boolean =>
  RESERVED_NAMESPACES.some(reserved => reserved === namespace);

export const splitCommandName = (name: string): { namespace: string; action: string } | null => {
  const dot = name.indexOf('.');

  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }

  return { namespace: name.slice(0, dot), action: name.slice(dot + 1) };
};
