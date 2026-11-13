import type { BlockId, BlockToolData } from '../../../types';
import type { StubData } from '../../tools/stub';
import type { BlockToolAdapter } from '../tools/block';
import type { BlokModules } from '../../types-internal/blok-modules';

import { humanizeToolName } from './string';

/**
 * Map of legacy EditorJS tool names to their Blok equivalents.
 * Used when loading or pasting blocks to migrate old data.
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  delimiter: 'divider',
};

type StubTools = Pick<BlokModules['Tools'], 'stubTool' | 'unavailable'>;

/**
 * Data for the Stub tool that stands in for a tool this editor does not have.
 * @param Tools - the Tools module
 * @param tool - the missing tool name
 * @param data - the missing block's data
 * @param [id] - the missing block's id
 */
export const composeStubData = (Tools: StubTools, tool: string, data: BlockToolData, id?: BlockId): StubData => {
  const unavailable = Tools.unavailable.get(tool) as BlockToolAdapter | undefined;
  const toolboxTitle = unavailable?.toolbox?.[0]?.title;

  return {
    savedData: {
      ...(id !== undefined && { id }),
      type: tool,
      data,
    },
    title: toolboxTitle ?? humanizeToolName(tool),
  };
};

/**
 * Picks the tool a block of `type` is built with: the tool itself, its alias,
 * or the Stub tool when neither is registered.
 * @param Tools - the Tools module
 * @param isRegistered - whether this editor can build a block with a tool name
 * @param type - the block's tool name
 * @param data - the block's data
 * @param [id] - the block's id, kept in the stub data
 */
export const resolveBlockTool = (
  Tools: StubTools,
  isRegistered: (name: string) => boolean,
  type: string,
  data: BlockToolData,
  id?: BlockId
): { tool: string; data: BlockToolData } => {
  if (isRegistered(type)) {
    return { tool: type, data };
  }

  const aliasTarget = TOOL_ALIASES[type];

  if (aliasTarget !== undefined && isRegistered(aliasTarget)) {
    return { tool: aliasTarget, data };
  }

  return { tool: Tools.stubTool, data: composeStubData(Tools, type, data, id) };
};
