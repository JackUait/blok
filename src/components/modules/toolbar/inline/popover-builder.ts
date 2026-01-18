import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { I18n } from '../../../modules/i18n';
import type { InlineToolAdapter } from '../../../tools/inline';
import type { InlineTool as IInlineTool } from '../../../../../types';
import type { PopoverItemParams } from '../../../utils/popover';
import { PopoverItemType } from '../../../utils/popover';
import { beautifyShortcut, capitalize } from '../../../utils';
import { translateToolName } from '../../../utils/tools';

/**
 * InlinePopoverBuilder converts tool instances to popover items.
 *
 * Responsibilities:
 * - Build popover items from tool instances
 * - Process individual popover items (HTML, Separator, Default)
 * - Add hints with title and shortcut
 * - Add separator after first item with children
 */
export class InlinePopoverBuilder {
  /**
   * Getter function to access Blok modules dynamically
   */
  private getBlok: () => BlokModules;

  /**
   * Getter function to access I18n module dynamically
   */
  private getI18n: () => I18n;

  constructor(
    getBlok: () => BlokModules,
    getI18n: () => I18n
  ) {
    this.getBlok = getBlok;
    this.getI18n = getI18n;
  }

  /**
   * Build popover items from tool instances
   */
  public async build(items: Map<InlineToolAdapter, IInlineTool>): Promise<PopoverItemParams[]> {
    const popoverItems: PopoverItemParams[] = [];
    const toolsEntries = Array.from(items.entries());

    for (const [index, [tool, instance]] of toolsEntries.entries()) {
      const renderedTool = await instance.render();
      const { Tools } = this.getBlok();
      const toolData = Tools.inlineTools.get(tool.name);
      const shortcut = toolData?.shortcut;
      const shortcutBeautified = shortcut !== undefined ? beautifyShortcut(shortcut) : undefined;

      const toolTitle = translateToolName(this.getI18n(), tool.titleKey, tool.title || capitalize(tool.name));

      const itemsArray = Array.isArray(renderedTool) ? renderedTool : [renderedTool];
      const isFirstItem = index === 0;

      for (const item of itemsArray) {
        const processed = this.processPopoverItem(item, tool.name, toolTitle, shortcutBeautified, isFirstItem);

        popoverItems.push(...processed);
      }
    }

    return popoverItems;
  }

  /**
   * Process a single popover item and return the items to add
   */
  private processPopoverItem(
    item: PopoverItemParams | HTMLElement,
    toolName: string,
    toolTitle: string,
    shortcutBeautified: string | undefined,
    isFirstItem: boolean
  ): PopoverItemParams[] {
    const result: PopoverItemParams[] = [];

    const commonPopoverItemParams = {
      name: toolName,
      hint: {
        title: toolTitle,
        description: shortcutBeautified,
      },
    } as PopoverItemParams;

    // Skip raw HTMLElement items (legacy)
    if (item instanceof HTMLElement) {
      return result;
    }

    if (item.type === PopoverItemType.Html) {
      result.push({
        ...commonPopoverItemParams,
        ...item,
        type: PopoverItemType.Html,
      });

      return result;
    }

    if (item.type === PopoverItemType.Separator) {
      result.push({
        type: PopoverItemType.Separator,
      });

      return result;
    }

    // Default item
    const popoverItem = {
      ...commonPopoverItemParams,
      ...item,
      type: PopoverItemType.Default,
    } as PopoverItemParams;

    result.push(popoverItem);

    // Append separator after first item with children
    if ('children' in popoverItem && isFirstItem) {
      result.push({
        type: PopoverItemType.Separator,
      });
    }

    return result;
  }
}
