import type { HostService, ToolRegistrySnapshot } from '../../types';
import { BUILT_IN_TOOL_RUNTIMES } from './tool-actions';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from './tool-descriptions';
import { BUILT_IN_BLOCK_STATICS, BUILT_IN_INLINE_STATICS } from './tool-descriptions/built-in-statics';
import { BUILT_IN_INLINE_DESCRIPTIONS, BUILT_IN_TUNE_DESCRIPTIONS } from './tool-descriptions/inline';

export const buildBuiltInSnapshot = (input: {
  blokVersion: string;
  readOnly?: boolean;
  services?: HostService[];
}): ToolRegistrySnapshot => ({
  blokVersion: input.blokVersion,
  readOnly: input.readOnly ?? false,
  defaultBlock: 'paragraph',
  services: input.services ?? [],
  blocks: Object.entries(BUILT_IN_BLOCK_STATICS).map(([name, entry]) => ({
    name,
    title: entry.title,
    description: BUILT_IN_BLOCK_DESCRIPTIONS[name]({}),
    statics: entry.statics,
    insertable: true,
    inlineTools: entry.inlineTools,
    tunes: entry.tunes,
    handlers: Object.keys(BUILT_IN_TOOL_RUNTIMES.get(name)?.actions ?? {}),
  })),
  inlineTools: Object.entries(BUILT_IN_INLINE_STATICS).map(([name, entry]) => ({
    name,
    title: entry.title,
    description: BUILT_IN_INLINE_DESCRIPTIONS[name](),
    sanitizeTags: entry.sanitizeTags,
    ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
  })),
  tunes: Object.entries(BUILT_IN_TUNE_DESCRIPTIONS).map(([name, describe]) => ({
    name,
    description: describe(),
  })),
});
