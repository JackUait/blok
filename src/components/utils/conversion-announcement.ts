import type { BlockToolData } from '../../../types/tools/block-tool-data';
import { equals } from '../utils';
import { announce } from './announcer';
import { translateToolTitle, type I18nInstance } from './tools';

import type { ToolboxConfigEntry } from '@/types';

/**
 * The parts of a block tool the announcement reads. A core adapter and the
 * public `api.tools.getBlockTools()` entries both fit.
 */
interface ConvertedTool {
  name: string;
  toolbox?: ToolboxConfigEntry[];
}

/**
 * Says which block a conversion made, like Notion: "Converted to Heading 2",
 * or "2 blocks converted to Heading 2" for several blocks.
 * The name is the convert menu's title for the toolbox entry the data matches.
 * Only user gestures call this: a host's blocks.convert() stays silent.
 * @param i18n - translates message keys
 * @param tool - the tool the blocks became
 * @param data - the data the blocks were made with
 * @param count - how many blocks the user converted
 */
export const announceConversion = (i18n: I18nInstance, tool: ConvertedTool, data: BlockToolData, count = 1): void => {
  const entries = tool.toolbox ?? [];
  // Compare every key any entry sets, as the convert menu does: { level: 2 } alone would also match a toggle heading.
  const keys = [...new Set(entries.flatMap((entry) => Object.keys(entry.data ?? {})))];
  const entry = entries.find((candidate) => keys.every((key) => equals(candidate.data?.[key], data[key])));
  const name = translateToolTitle(i18n, entry ?? {}, tool.name);

  announce(count > 1 ? i18n.t('a11y.blocksConvertedTo', { count, name }) : i18n.t('a11y.convertedTo', { name }));
};

/**
 * {@link announceConversion} for a block tool, which knows its target only by name.
 * @param api - the tool's API
 * @param api.i18n - translates message keys
 * @param api.tools - lists the installed block tools
 * @param api.tools.getBlockTools - returns the installed block tools
 * @param toolName - the tool the block became
 * @param data - the data the block was made with
 */
export const announceToolConversion = (
  api: { i18n: I18nInstance; tools: { getBlockTools(): ConvertedTool[] } },
  toolName: string,
  data: BlockToolData
): void => {
  const tool = api.tools.getBlockTools().find((candidate) => candidate.name === toolName);

  if (tool !== undefined) {
    announceConversion(api.i18n, tool, data);
  }
};
