import type { CustomInlineSanitizeRule, HostService, SanitizerConfig, SnapshotBlock, ToolConfig, ToolRegistrySnapshot } from '../../../types';
import { BUILT_IN_RUNTIME_PARTS } from '../../shared/tool-actions';
import type { ToolRuntime, ToolRuntimeRegistry } from '../../shared/tool-actions/runtime';
import { AudioTool } from '../../tools/audio';
import { CalloutTool } from '../../tools/callout';
import { CodeTool } from '../../tools/code';
import { Column } from '../../tools/column';
import { ColumnList } from '../../tools/column-list';
import { DatabaseTool } from '../../tools/database';
import { FileTool } from '../../tools/file';
import { ImageTool } from '../../tools/image';
import { Bookmark } from '../../tools/link/bookmark';
import { Embed } from '../../tools/link/embed';
import { ListItem } from '../../tools/list';
import { Quote } from '../../tools/quote';
import { TabsTool } from '../../tools/tabs';
import { SELF_PLACING_PARENTS } from '../../tools/nested-blocks';
import { Table } from '../../tools/table';
import { VideoTool } from '../../tools/video';
import { isRestrictedInTableCell } from '../../tools/table/table-restrictions';
import { log } from '../utils/logger';
import { translateToolTitle } from '../utils/tools';
import type { I18nInstance } from '../utils/tools';
import type { BlockToolAdapter } from './block';
import type { InlineToolAdapter } from './inline';
import type { BlockTuneAdapter } from './tune';

/** The tool's only tag rule, when it is JSON (a function rule names no attributes). */
const jsonRuleOf = (config: SanitizerConfig): { sanitizeRule?: CustomInlineSanitizeRule } => {
  const tags = Object.keys(config);
  const rule: unknown = tags.length === 1 ? config[tags[0]] : undefined;

  if (rule === true) {
    return { sanitizeRule: true };
  }
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    return {};
  }
  const attributes: Record<string, boolean | string> = {};

  for (const [attribute, value] of Object.entries(rule)) {
    if (typeof value !== 'boolean' && typeof value !== 'string') {
      return {};
    }
    attributes[attribute] = value;
  }

  return { sanitizeRule: attributes };
};

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
        ...(tool.isAnnotation ? { isAnnotation: true } : {}),
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
  inlineTools: [...tools.inlineTools.values()].map(tool => {
    const description = describeSafely(tool.name, tool.toolClass, tool.settings);

    return {
      name: tool.name,
      title: tool.title,
      description,
      sanitizeTags: Object.keys(tool.sanitizeConfig),
      // Only a tool with no description is read from its sanitizer.
      ...(description === null ? jsonRuleOf(tool.sanitizeConfig) : {}),
      ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }),
    };
  }),
  tunes: [...tools.blockTunes.values()].map(tune => ({
    name: tune.name,
    description: describeSafely(tune.name, tune.toolClass, tune.settings),
  })),
});

/**
 * Built-in classes whose BUILT_IN_RUNTIME_PARTS entry the editor uses. Keyed by class, not by
 * registration name: an alias gets the parts, a custom class under a built-in name does not.
 * test/unit/architecture/agent-runtime-parts-editor-parity-law.test.ts fails for a missing entry.
 */
const PART_OWNERS = new Map<unknown, string>([
  [Table, 'table'],
  [ColumnList, 'column_list'],
  [Column, 'column'],
  [TabsTool, 'tabs'],
  [CalloutTool, 'callout'],
  [CodeTool, 'code'],
  [Quote, 'quote'],
  [DatabaseTool, 'database'],
  [Embed, 'embed'],
  [Bookmark, 'bookmark'],
  [ImageTool, 'image'],
  [VideoTool, 'video'],
  [AudioTool, 'audio'],
  [FileTool, 'file'],
  // Feeds only the agent planner; in-editor conversion still runs the list's conversionConfig functions.
  [ListItem, 'list'],
]);

export const runtimesFromTools = (tools: ToolsLike): ToolRuntimeRegistry => new Map(
  [...tools.blockTools.values()]
    .filter(tool => !tool.isInternal)
    .map((tool): [string, ToolRuntime] => {
      const toolClass = tool.toolClass;
      const owner = PART_OWNERS.get(toolClass);
      const parts = owner === undefined ? undefined : BUILT_IN_RUNTIME_PARTS[owner];

      return [tool.name, {
        name: tool.name,
        sanitize: tool.sanitizeConfig,
        ...(parts?.normalize === undefined ? {} : { normalize: parts.normalize }),
        ...(parts?.rejectWrite === undefined ? {} : { rejectWrite: parts.rejectWrite }),
        ...(parts?.defaultChildren === undefined ? {} : { defaultChildren: parts.defaultChildren }),
        actions: toolClass.actionHandlers ?? {},
        ...(parts?.conversion === undefined ? {} : { conversion: parts.conversion }),
      }];
    })
);
