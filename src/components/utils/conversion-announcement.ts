import type { BlockToolData } from '../../../types/tools/block-tool-data';
import type { BlockToolAdapter } from '../tools/block';
import { equals } from '../utils';
import { announce } from './announcer';
import { translateToolTitle, type I18nInstance } from './tools';

/**
 * Says which block a markdown shortcut made, like Notion: "Converted to Heading 2".
 * The name is the convert menu's title for the toolbox entry the data matches.
 * @param i18n - translates message keys
 * @param tool - the tool the block became
 * @param data - the data the block was made with
 */
export const announceConversion = (i18n: I18nInstance, tool: BlockToolAdapter, data: BlockToolData): void => {
  const entries = tool.toolbox ?? [];
  // Compare every key any entry sets, as the convert menu does: { level: 2 } alone would also match a toggle heading.
  const keys = [...new Set(entries.flatMap((entry) => Object.keys(entry.data ?? {})))];
  const entry = entries.find((candidate) => keys.every((key) => equals(candidate.data?.[key], data[key])));

  announce(i18n.t('a11y.convertedTo', { name: translateToolTitle(i18n, entry ?? {}, tool.name) }));
};
