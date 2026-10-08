import type { HostService, SnapshotBlock, ToolConfig, ToolRegistrySnapshot } from '../../../types';
import { BUILT_IN_RUNTIME_PARTS } from '../../shared/tool-actions';
import type { ToolRuntime, ToolRuntimeRegistry } from '../../shared/tool-actions/runtime';
import { CalloutTool } from '../../tools/callout';
import { SELF_PLACING_PARENTS } from '../../tools/nested-blocks';
import { Table } from '../../tools/table';
import { isRestrictedInTableCell } from '../../tools/table/table-restrictions';
import { log } from '../utils/logger';
import { translateToolTitle } from '../utils/tools';
import type { I18nInstance } from '../utils/tools';
import type { BlockToolAdapter } from './block';
import type { InlineToolAdapter } from './inline';
import type { BlockTuneAdapter } from './tune';

export interface ToolsLike {
  blockTools: ReadonlyMap<string, BlockToolAdapter>;
  inlineTools: ReadonlyMap<string, InlineToolAdapter>;
  blockTunes: ReadonlyMap<string, BlockTuneAdapter>;
}

const describeSafely = <Description>(
  name: string,
  toolClass: { describe?(config: ToolConfig): Description },
  config: ToolConfig
): Description | null => {
  try {
    const describe = toolClass.describe;

    if (typeof describe !== 'function') {
      return null;
    }

    return describe.call(toolClass, config);
  } catch (error) {
    log(`Tool "${name}": describe() threw; listing it as structural.`, 'warn', error);

    return null;
  }
};

export const snapshotFromTools = (
  tools: ToolsLike,
  input: { blokVersion: string; readOnly: boolean; defaultBlock: string; services: HostService[]; i18n: I18nInstance }
): ToolRegistrySnapshot => ({
  blokVersion: input.blokVersion,
  readOnly: input.readOnly,
  defaultBlock: input.defaultBlock,
  services: input.services,
  blocks: [...tools.blockTools.values()].filter(tool => !tool.isInternal).map((tool): SnapshotBlock => {
    const toolClass = tool.toolClass;
    const toolbox = tool.toolbox ?? [];
    const conversion = tool.conversionConfig ?? {};

    return {
      name: tool.name,
      title: translateToolTitle(input.i18n, toolbox[0] ?? {}, tool.name),
      description: describeSafely(tool.name, toolClass, tool.settings),
      statics: {
        toolbox: toolbox.map((entry, index) => ({
          name: entry.name ?? `${tool.name}-${index}`,
          title: translateToolTitle(input.i18n, entry, tool.name),
          ...(entry.data === undefined ? {} : { data: entry.data }),
          ...(entry.preview?.descriptionKey === undefined ? {} : {
            previewCaption: input.i18n.t(entry.preview.descriptionKey, entry.preview.descriptionParams),
          }),
        })),
        richTextFields: tool.richTextFields,
        acceptsChildren: tool.acceptsChildren,
        ...(tool.childTools === undefined ? {} : { childTools: tool.childTools }),
        ownsChildren: tool.ownsChildren,
        isLayout: tool.isLayout,
        deletesChildren: tool.deletesChildren,
        selfPlacesChildren: SELF_PLACING_PARENTS.has(tool.name),
        restrictedInTableCell: isRestrictedInTableCell(tool.name),
        conversion: {
          ...(typeof conversion.import === 'string' ? { import: conversion.import } : {}),
          ...(typeof conversion.export === 'string' ? { export: conversion.export } : {}),
        },
        convertible: {
          import: typeof conversion.import === 'string' || typeof conversion.import === 'function',
          export: typeof conversion.export === 'string' || typeof conversion.export === 'function',
        },
        ...(tool.assetKind === undefined ? {} : { assetKind: tool.assetKind }),
        hasPrepareInsert: typeof toolClass.prepareInsert === 'function',
      },
      insertable: !(toolClass.toolbox !== undefined && tool.toolbox === undefined),
      inlineTools: [...tool.inlineTools.keys()],
      tunes: [...tool.tunes.keys()],
      handlers: Object.keys(toolClass.actionHandlers ?? {}),
    };
  }),
  inlineTools: [...tools.inlineTools.values()].map(tool => ({
    name: tool.name,
    title: tool.title,
    description: describeSafely(tool.name, tool.toolClass, tool.settings),
    sanitizeTags: Object.keys(tool.sanitizeConfig),
    ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }),
  })),
  tunes: [...tools.blockTunes.values()].map(tune => ({
    name: tune.name,
    description: describeSafely(tune.name, tune.toolClass, tune.settings),
  })),
});

export const runtimesFromTools = (tools: ToolsLike): ToolRuntimeRegistry => new Map(
  [...tools.blockTools.values()]
    .filter(tool => !tool.isInternal)
    .map((tool): [string, ToolRuntime] => {
      const toolClass = tool.toolClass;
      const tableParts = toolClass === Table ? BUILT_IN_RUNTIME_PARTS.table : undefined;
      const parts = Object.is(toolClass, CalloutTool) ? BUILT_IN_RUNTIME_PARTS.callout : tableParts;

      return [tool.name, {
        name: tool.name,
        sanitize: tool.sanitizeConfig,
        ...(parts?.normalize === undefined ? {} : { normalize: parts.normalize }),
        ...(parts?.defaultChildren === undefined ? {} : { defaultChildren: parts.defaultChildren }),
        actions: toolClass.actionHandlers ?? {},
      }];
    })
);
