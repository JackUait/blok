import type { InlineTool as IInlineTool } from '../../../../../types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { Dom as $ } from '../../../dom';
import { SelectionUtils } from '../../../selection/index';
import { CommonInternalSettings } from '../../../tools/base';
import type { InlineToolAdapter } from '../../../tools/inline';

/**
 * InlineToolsManager handles getting and creating inline tool instances.
 *
 * Responsibilities:
 * - Get available tools for current block
 * - Filter tools by read-only mode
 * - Create tool instances from adapters
 * - Get shortcut names for tools
 */
export class InlineToolsManager {
  /**
   * Getter function to access Blok modules dynamically
   */
  private getBlok: () => BlokModules;

  constructor(getBlok: () => BlokModules) {
    this.getBlok = getBlok;
  }

  /**
   * Get tools available for current block (filtered by read-only)
   */
  public getAvailableTools(): InlineToolAdapter[] {
    const { ReadOnly } = this.getBlok();
    const currentBlock = this.getCurrentBlock();

    if (!currentBlock) {
      return [];
    }

    return Array.from(currentBlock.tool.inlineTools.values()).filter((tool) => {
      return !(ReadOnly.isEnabled && !tool.isReadOnlySupported);
    });
  }

  /**
   * Create tool instances from adapters
   */
  public createInstances(tools: InlineToolAdapter[]): Map<InlineToolAdapter, IInlineTool> {
    const instances = new Map<InlineToolAdapter, IInlineTool>();

    tools.forEach((tool) => {
      const instance = tool.create();

      instances.set(tool, instance);
    });

    return instances;
  }

  /**
   * Get shortcut name for a tool (delegates to internal tools)
   */
  public getToolShortcut(toolName: string): string | undefined {
    const { Tools } = this.getBlok();

    const tool = Tools.inlineTools.get(toolName);
    const internalTools = Tools.internal.inlineTools;

    if (Array.from(internalTools.keys()).includes(toolName)) {
      return this.inlineTools[toolName]?.[CommonInternalSettings.Shortcut];
    }

    return tool?.shortcut;
  }

  /**
   * Get the current block from selection or BlockManager
   */
  private getCurrentBlock(): ReturnType<typeof this.getBlok>['BlockManager']['currentBlock'] | null {
    const { BlockManager } = this.getBlok();
    const currentBlock = BlockManager.currentBlock
      ?? (() => {
        const selection = this.resolveSelection();
        const anchorNode = selection?.anchorNode;

        if (!anchorNode) {
          return null;
        }

        const anchorElement = $.isElement(anchorNode) ? anchorNode as HTMLElement : anchorNode.parentElement;

        if (!anchorElement) {
          return null;
        }

        return BlockManager.getBlock(anchorElement);
      })();

    return currentBlock;
  }

  /**
   * Resolves the current selection, handling test mocks
   */
  private resolveSelection(): Selection | null {
    const selectionOverride = (SelectionUtils as unknown as { selection?: Selection | null }).selection;

    if (selectionOverride !== undefined) {
      return selectionOverride;
    }

    const instanceOverride = (SelectionUtils as unknown as { instance?: Selection | null }).instance;

    if (instanceOverride !== undefined) {
      return instanceOverride;
    }

    return SelectionUtils.get();
  }

  /**
   * Get inline tools
   */
  private get inlineTools(): Record<string, IInlineTool> {
    const { Tools } = this.getBlok();
    const result = {} as Record<string, IInlineTool>;

    Array.from(Tools.inlineTools.entries())
      .forEach(([name, tool]) => {
        result[name] = tool.create();
      });

    return result;
  }
}
