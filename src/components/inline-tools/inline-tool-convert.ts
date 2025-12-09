import type { InlineTool, API, BlockAPI } from '../../../types';
import type { MenuConfig, MenuConfigItem } from '../../../types/tools';
import * as _ from '../utils';
import type { Blocks, Selection, Tools, Caret, I18n } from '../../../types/api';
import SelectionUtils from '../selection';
import { getConvertibleToolsForBlock } from '../utils/blocks';
import I18nInternal from '../i18n';
import { I18nInternalNS } from '../i18n/namespace-internal';
import type BlockToolAdapter from '../tools/block';
import type { ListData, ListItem } from '../../tools/list';

/**
 * Inline tools for converting blocks
 */
export default class ConvertInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * API for working with blok blocks
   */
  private readonly blocksAPI: Blocks;

  /**
   * API for working with Selection
   */
  private readonly selectionAPI: Selection;

  /**
   * API for working with Tools
   */
  private readonly toolsAPI: Tools;

  /**
   * I18n API
   */
  private readonly i18nAPI: I18n;

  /**
   * API for working with Caret
   */
  private readonly caretAPI: Caret;

  /**
   * @param api - Blok API
   */
  constructor({ api }: { api: API }) {
    this.i18nAPI = api.i18n;
    this.blocksAPI = api.blocks;
    this.selectionAPI = api.selection;
    this.toolsAPI = api.tools;
    this.caretAPI = api.caret;
  }

  /**
   * Returns tool's UI config
   */
  public async render(): Promise<MenuConfig> {
    const currentSelection = SelectionUtils.get();

    if (currentSelection === null) {
      return [];
    }

    const currentBlock = this.blocksAPI.getBlockByElement(currentSelection.anchorNode as HTMLElement);

    if (currentBlock === undefined) {
      return [];
    }

    const allBlockTools = this.toolsAPI.getBlockTools() as BlockToolAdapter[];
    const convertibleTools = await getConvertibleToolsForBlock(currentBlock, allBlockTools);

    if (convertibleTools.length === 0) {
      return [];
    }

    // Check if we're in a list block and get the selected item info
    const listItemInfo = this.getSelectedListItemInfo(currentSelection.anchorNode as HTMLElement);

    const convertToItems = convertibleTools.reduce<MenuConfigItem[]>((result, tool) => {
      tool.toolbox?.forEach((toolboxItem) => {
        if (toolboxItem.title === undefined) {
          return;
        }

        result.push({
          icon: toolboxItem.icon,
          title: I18nInternal.t(I18nInternalNS.toolNames, toolboxItem.title),
          name: tool.name,
          closeOnActivate: true,
          onActivate: async () => {
            // If we're in a list block and have a specific item selected, handle it specially
            if (listItemInfo !== null && currentBlock.name === 'list') {
              await this.convertListItem(currentBlock, listItemInfo, tool.name, toolboxItem.data);
            } else {
              const newBlock = await this.blocksAPI.convert(currentBlock.id, tool.name, toolboxItem.data);

              this.caretAPI.setToBlock(newBlock, 'end');
            }
          },
        });
      });

      return result;
    }, []);

    const currentBlockToolboxItem = await currentBlock.getActiveToolboxEntry();
    const currentBlockTitle = currentBlockToolboxItem?.title ?? currentBlock.name;
    const isDesktop =  !_.isMobileScreen();

    return {
      name: 'convert-to',
      title: I18nInternal.t(I18nInternalNS.toolNames, currentBlockTitle),
       hint: {
        title: I18nInternal.ui(I18nInternalNS.ui.inlineToolbar.converter, 'Convert to'),
      },
      children: {
        items: convertToItems,
        onOpen: () => {
          if (isDesktop) {
            this.selectionAPI.setFakeBackground();
            this.selectionAPI.save();
          }
        },
        onClose: () => {
          if (isDesktop) {
            this.selectionAPI.restore();
            this.selectionAPI.removeFakeBackground();
          }
        },
      },
    };
  }

  /**
   * Get information about the selected list item if we're in a list block
   * @param anchorNode - the anchor node of the current selection
   * @returns object with item path and content, or null if not in a list item
   */
  private getSelectedListItemInfo(anchorNode: HTMLElement): { path: number[]; content: string } | null {
    // Find the list item element by traversing up from the anchor node
    const itemElement = this.findListItemElement(anchorNode);

    if (!itemElement) {
      return null;
    }

    const pathAttr = itemElement.getAttribute('data-item-path');

    if (!pathAttr) {
      return null;
    }

    try {
      const path = JSON.parse(pathAttr) as number[];
      const contentEl = this.getListItemContentElement(itemElement);
      const content = contentEl?.innerHTML || '';

      return { path, content };
    } catch {
      return null;
    }
  }

  /**
   * Find the list item element by traversing up from a node
   * @param node - the starting node
   */
  private findListItemElement(node: HTMLElement | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (node.getAttribute?.('data-item-path')) {
      return node;
    }

    return this.findListItemElement(node.parentElement);
  }

  /**
   * Get the content element from a list item
   * @param itemElement - the list item element
   */
  private getListItemContentElement(itemElement: HTMLElement): HTMLElement | null {
    // For checklist items, the content is in a contenteditable div after the checkbox
    const checklistContent = itemElement.querySelector(':scope > div[contenteditable]') as HTMLElement;

    if (checklistContent) {
      return checklistContent;
    }

    // For standard lists, find the content container
    const contentContainer = itemElement.querySelector(':scope > div.flex-1') as HTMLElement;

    if (!contentContainer) {
      return null;
    }

    // Check if there's a nested contenteditable wrapper (for items with children)
    const nestedWrapper = contentContainer.querySelector(':scope > div[contenteditable]') as HTMLElement;

    if (nestedWrapper) {
      return nestedWrapper;
    }

    // Otherwise the content container itself is editable
    return contentContainer;
  }

  /**
   * Convert a single list item to another block type
   * For nested items: creates a separate block between list parts (splits the list)
   * For root items: converts to a separate block
   * @param currentBlock - the current list block
   * @param listItemInfo - information about the selected list item
   * @param targetToolName - the tool to convert to
   * @param toolboxData - optional data overrides for the new block
   */
  private async convertListItem(
    currentBlock: BlockAPI,
    listItemInfo: { path: number[]; content: string },
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<void> {
    const blockIndex = this.blocksAPI.getBlockIndex(currentBlock.id);

    if (blockIndex === undefined) {
      return;
    }

    // Save the current block data before modifying
    const savedData = await currentBlock.save() as { data: ListData } | undefined;

    if (!savedData?.data) {
      return;
    }

    const listData = savedData.data;
    const { path, content } = listItemInfo;

    // Check if this is a nested item
    const isNestedItem = path.length > 1;

    if (isNestedItem) {
      // For nested items, split the list and insert a paragraph between
      await this.convertNestedItemToBlock(
        currentBlock,
        listData,
        path,
        content,
        targetToolName,
        toolboxData,
        blockIndex
      );

      return;
    }

    // For root level items, split the list and insert a paragraph between
    await this.convertRootItemToBlock(
      currentBlock,
      listData,
      path[0],
      content,
      targetToolName,
      toolboxData,
      blockIndex
    );
  }

  /**
   * Convert a root level list item to a separate block by splitting the list
   * Creates: [list with items before] [converted block] [list with items after]
   * @param currentBlock - the current list block
   * @param listData - the list data
   * @param itemIndex - index of the item to convert
   * @param content - content of the item being converted
   * @param targetToolName - the tool to convert to
   * @param toolboxData - optional data overrides
   * @param blockIndex - index of the current block
   */
  private async convertRootItemToBlock(
    currentBlock: BlockAPI,
    listData: ListData,
    itemIndex: number,
    content: string,
    targetToolName: string,
    toolboxData: Record<string, unknown> | undefined,
    blockIndex: number
  ): Promise<void> {
    // Split the list into items before and after the converted item
    const itemsBefore = listData.items.slice(0, itemIndex);
    const itemsAfter = listData.items.slice(itemIndex + 1);

    // Get children of the removed item (they should be promoted to itemsAfter)
    const removedItem = listData.items[itemIndex];
    const promotedChildren = removedItem?.items ? this.deepCloneItems(removedItem.items) : [];

    // Items after includes promoted children first, then remaining items
    const allItemsAfter = [...promotedChildren, ...this.deepCloneItems(itemsAfter)];

    // Create the new paragraph block
    const newBlockData = this.prepareBlockData(targetToolName, content, toolboxData);

    const hasItemsBefore = itemsBefore.length > 0;
    const hasItemsAfter = allItemsAfter.length > 0;

    // Case 1: Items before AND after - update original with before, insert paragraph, insert new list with after
    if (hasItemsBefore && hasItemsAfter) {
      await this.handleSplitWithBothParts(
        currentBlock, listData, itemsBefore, allItemsAfter, targetToolName, newBlockData, blockIndex
      );

      return;
    }

    // Case 2: Only items before - update original with before, insert paragraph after
    if (hasItemsBefore) {
      await this.handleSplitWithOnlyBefore(
        currentBlock, listData, itemsBefore, targetToolName, newBlockData, blockIndex
      );

      return;
    }

    // Case 3: Only items after - insert paragraph before, update original with after
    if (hasItemsAfter) {
      await this.handleSplitWithOnlyAfter(
        currentBlock, listData, allItemsAfter, targetToolName, newBlockData, blockIndex
      );

      return;
    }

    // Case 4: No items remain - delete list, insert paragraph
    this.deleteListBlockIfExists(currentBlock.id);
    const newBlock = this.blocksAPI.insert(targetToolName, newBlockData, undefined, blockIndex, false);

    this.caretAPI.setToBlock(newBlock, 'end');
  }

  /**
   * Handle split when there are items both before and after the converted item
   */
  private async handleSplitWithBothParts(
    currentBlock: BlockAPI,
    listData: ListData,
    itemsBefore: ListItem[],
    itemsAfter: ListItem[],
    targetToolName: string,
    newBlockData: Record<string, unknown>,
    blockIndex: number
  ): Promise<void> {
    await this.blocksAPI.update(currentBlock.id, {
      style: listData.style,
      items: this.deepCloneItems(itemsBefore),
      ...(listData.start !== undefined ? { start: listData.start } : {}),
    });

    const newBlock = this.blocksAPI.insert(targetToolName, newBlockData, undefined, blockIndex + 1, false);

    this.blocksAPI.insert('list', {
      style: listData.style,
      items: itemsAfter,
    }, undefined, blockIndex + 2, false);

    this.caretAPI.setToBlock(newBlock, 'end');
  }

  /**
   * Handle split when there are only items before the converted item
   */
  private async handleSplitWithOnlyBefore(
    currentBlock: BlockAPI,
    listData: ListData,
    itemsBefore: ListItem[],
    targetToolName: string,
    newBlockData: Record<string, unknown>,
    blockIndex: number
  ): Promise<void> {
    await this.blocksAPI.update(currentBlock.id, {
      style: listData.style,
      items: this.deepCloneItems(itemsBefore),
      ...(listData.start !== undefined ? { start: listData.start } : {}),
    });

    const newBlock = this.blocksAPI.insert(targetToolName, newBlockData, undefined, blockIndex + 1, false);

    this.caretAPI.setToBlock(newBlock, 'end');
  }

  /**
   * Handle split when there are only items after the converted item
   */
  private async handleSplitWithOnlyAfter(
    currentBlock: BlockAPI,
    listData: ListData,
    itemsAfter: ListItem[],
    targetToolName: string,
    newBlockData: Record<string, unknown>,
    blockIndex: number
  ): Promise<void> {
    const newBlock = this.blocksAPI.insert(targetToolName, newBlockData, undefined, blockIndex, false);

    await this.blocksAPI.update(currentBlock.id, {
      style: listData.style,
      items: itemsAfter,
    });

    this.caretAPI.setToBlock(newBlock, 'end');
  }

  /**
   * Convert a nested list item to a separate block by splitting the list
   * Creates: [list with items before] [converted block] [list with items after]
   * @param currentBlock - the current list block
   * @param listData - the list data
   * @param path - path to the nested item
   * @param content - content of the item being converted
   * @param targetToolName - the tool to convert to
   * @param toolboxData - optional data overrides
   * @param blockIndex - index of the current block
   */
  private async convertNestedItemToBlock(
    currentBlock: BlockAPI,
    listData: ListData,
    path: number[],
    content: string,
    targetToolName: string,
    toolboxData: Record<string, unknown> | undefined,
    blockIndex: number
  ): Promise<void> {
    // Get the root item index that contains this nested item
    const rootIndex = path[0];

    // Split the list into three parts:
    // 1. Items before the parent (indices 0 to rootIndex-1)
    // 2. The parent item with nested item removed, plus items after converted item become separate
    // 3. Items after the parent (indices rootIndex+1 to end)

    const itemsBefore: ListItem[] = listData.items.slice(0, rootIndex);
    const parentItem = this.deepCloneItems([listData.items[rootIndex]])[0];
    const itemsAfter: ListItem[] = listData.items.slice(rootIndex + 1);

    // Remove the nested item from the parent and get items that should come after
    const { updatedParent, itemsAfterNested } = this.removeNestedItemAndGetAfter(parentItem, path.slice(1));

    // Build the first list (items before + parent with nested removed)
    const firstListItems: ListItem[] = updatedParent !== null
      ? [...itemsBefore, updatedParent]
      : [...itemsBefore];

    // Build the second list (items after nested + items after parent)
    const secondListItems: ListItem[] = [...itemsAfterNested, ...itemsAfter];

    // Create the new paragraph block
    const newBlockData = this.prepareBlockData(targetToolName, content, toolboxData);

    const hasFirstList = firstListItems.length > 0;
    const hasSecondList = secondListItems.length > 0;

    // Case 1: Items before AND after - update original with before, insert paragraph, insert new list with after
    if (hasFirstList && hasSecondList) {
      await this.handleSplitWithBothParts(
        currentBlock, listData, firstListItems, secondListItems, targetToolName, newBlockData, blockIndex
      );

      return;
    }

    // Case 2: Only items before - update original with before, insert paragraph after
    if (hasFirstList) {
      await this.handleSplitWithOnlyBefore(
        currentBlock, listData, firstListItems, targetToolName, newBlockData, blockIndex
      );

      return;
    }

    // Case 3: Only items after - insert paragraph before, update original with after
    if (hasSecondList) {
      await this.handleSplitWithOnlyAfter(
        currentBlock, listData, secondListItems, targetToolName, newBlockData, blockIndex
      );

      return;
    }

    // Case 4: No items remain - delete list, insert paragraph
    this.deleteListBlockIfExists(currentBlock.id);
    const newBlock = this.blocksAPI.insert(targetToolName, newBlockData, undefined, blockIndex, false);

    this.caretAPI.setToBlock(newBlock, 'end');
  }

  /**
   * Remove a nested item from a parent and return items that should come after
   * @param parentItem - the parent item containing nested items (will be cloned)
   * @param nestedPath - path within the parent to the item to remove
   * @returns updated parent (or null if empty) and items that should come after
   */
  private removeNestedItemAndGetAfter(
    parentItem: ListItem,
    nestedPath: number[]
  ): { updatedParent: ListItem | null; itemsAfterNested: ListItem[] } {
    if (nestedPath.length === 0 || !parentItem.items) {
      return { updatedParent: parentItem, itemsAfterNested: [] };
    }

    const nestedIndex = nestedPath[0];

    if (nestedPath.length === 1) {
      return this.removeDirectChildAndGetAfter(parentItem, nestedIndex);
    }

    // Deeper nesting - recurse
    return this.removeDeepNestedItemAndGetAfter(parentItem, nestedPath, nestedIndex);
  }

  /**
   * Remove a direct child item and return items that should come after
   */
  private removeDirectChildAndGetAfter(
    parentItem: ListItem,
    nestedIndex: number
  ): { updatedParent: ListItem | null; itemsAfterNested: ListItem[] } {
    const parentItems = parentItem.items!;
    const itemsAfterNested = parentItems.slice(nestedIndex + 1);
    const itemsBefore = parentItems.slice(0, nestedIndex);

    // Get children of the removed item (they should be promoted)
    const removedItem = parentItems[nestedIndex];
    const promotedChildren = removedItem?.items || [];

    // Create updated parent with new nested items
    const newNestedItems = [...itemsBefore, ...promotedChildren];
    const updatedParent: ListItem = {
      content: parentItem.content,
      checked: parentItem.checked,
    };

    if (newNestedItems.length > 0) {
      updatedParent.items = newNestedItems;
    }

    return { updatedParent, itemsAfterNested };
  }

  /**
   * Remove a deeply nested item and return items that should come after
   */
  private removeDeepNestedItemAndGetAfter(
    parentItem: ListItem,
    nestedPath: number[],
    nestedIndex: number
  ): { updatedParent: ListItem | null; itemsAfterNested: ListItem[] } {
    const parentItems = parentItem.items!;
    const childItem = parentItems[nestedIndex];

    if (!childItem) {
      return { updatedParent: parentItem, itemsAfterNested: [] };
    }

    const result = this.removeNestedItemAndGetAfter(childItem, nestedPath.slice(1));

    // Create updated parent with modified child
    const updatedItems = [...parentItems];

    if (result.updatedParent === null) {
      // Child became empty, remove it
      updatedItems.splice(nestedIndex, 1);
    } else {
      updatedItems[nestedIndex] = result.updatedParent;
    }

    const updatedParent: ListItem = {
      content: parentItem.content,
      checked: parentItem.checked,
    };

    if (updatedItems.length > 0) {
      updatedParent.items = updatedItems;
    }

    return { updatedParent, itemsAfterNested: result.itemsAfterNested };
  }



  /**
   * Delete a list block if it exists
   * @param blockId - the block id to delete
   */
  private deleteListBlockIfExists(blockId: string): void {
    const listBlockIndex = this.blocksAPI.getBlockIndex(blockId);

    if (listBlockIndex === undefined) {
      return;
    }

    this.blocksAPI.delete(listBlockIndex);
  }

  /**
   * Deep clone list items
   * @param items - items to clone
   */
  private deepCloneItems(items: ListItem[]): ListItem[] {
    return items.map(item => {
      const cloned: ListItem = {
        content: item.content,
        checked: item.checked,
      };

      if (item.items && item.items.length > 0) {
        cloned.items = this.deepCloneItems(item.items);
      }

      return cloned;
    });
  }

  /**
   * Prepare block data for the target tool
   * @param toolName - the target tool name
   * @param content - the content to convert
   * @param toolboxData - optional data overrides
   */
  private prepareBlockData(
    toolName: string,
    content: string,
    toolboxData?: Record<string, unknown>
  ): Record<string, unknown> {
    // Handle list conversions specially - list tool expects items array, not text field
    if (toolName === 'list') {
      const style = (toolboxData?.style as string) || 'unordered';

      return {
        style,
        items: [{ content, checked: false }],
      };
    }

    // Common block types and their content field names
    const contentFieldMap: Record<string, string> = {
      paragraph: 'text',
      header: 'text',
    };

    const contentField = contentFieldMap[toolName] || 'text';
    const baseData = { [contentField]: content };

    return toolboxData ? { ...baseData, ...toolboxData } : baseData;
  }
}
