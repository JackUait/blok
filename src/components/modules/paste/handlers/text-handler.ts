import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { ListItemStyle } from '../../../../tools/list/types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { Dom } from '../../../dom';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PasteData } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

/**
 * Text Handler Priority.
 * Handles plain text that doesn't match other handlers.
 * This is the fallback handler with lowest priority.
 */
export class TextHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
    private readonly config: BlokConfig
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    // This is the fallback handler, so it always can handle with lowest priority
    if (typeof data !== 'string') {
      return 0;
    }

    return data.length > 0 ? 10 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const listTarget = await this.resolveListTarget();
    const dataToInsert = this.processPlain(data, listTarget);

    if (!dataToInsert.length) {
      return false;
    }

    await this.insertPasteData(dataToInsert, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * When the paste TARGET is a list item, a multi-line plain-text paste should
   * continue that list (Notion parity): the continuation lines inherit the
   * item's style + depth instead of becoming default paragraphs. Returns the
   * target item's list style and depth, or null when the target is not a list.
   */
  private async resolveListTarget(): Promise<{ style: ListItemStyle; depth: number } | null> {
    const { BlockManager } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock || currentBlock.name !== 'list') {
      return null;
    }

    const data = await currentBlock.data;
    const rawStyle = data.style;
    const style: ListItemStyle =
      rawStyle === 'ordered' || rawStyle === 'checklist' ? rawStyle : 'unordered';
    const depthValue = typeof data.depth === 'number' ? data.depth : 0;

    return {
      style,
      depth: Math.max(0, depthValue),
    };
  }

  /**
   * Split plain text by new line symbols and return it as array of Block data.
   * When a list target is provided AND the paste spans multiple lines, the
   * produced blocks are list items carrying the inherited style/depth (consumed
   * by {@link BasePasteHandler.insertPasteData}); single-line pastes stay inline
   * in the current block so no list propagation is needed.
   */
  private processPlain(plain: string, listTarget: { style: ListItemStyle; depth: number } | null): PasteData[] {
    const { defaultBlock } = this.config;

    if (!plain || !defaultBlock) {
      return [];
    }

    const rawLines = plain.split(/\r?\n/);
    const contentLines = rawLines.filter((text) => text.trim());

    // Preserve a single leading blank segment when a multi-line paste begins
    // with blank line(s). It signals "there is no real inline first line", so
    // the caret-split is suppressed downstream (base.ts firstSegmentIsEmpty)
    // and the current block's content is never merged into — the pasted lines
    // become their own blocks. Only applied for 2+ content lines so a single
    // blank-prefixed line keeps its inline paste behavior.
    const startsBlank = rawLines[0]?.trim() === '' && contentLines.length > 1;
    const lines = startsBlank ? ['', ...contentLines] : contentLines;
    const applyListStyle = listTarget != null && contentLines.length > 1;

    return lines.map((text) => {
      const content = Dom.make('div');

      content.textContent = text;

      if (applyListStyle && listTarget) {
        // Carrier attributes read back by the insert loop in base.ts. They live
        // on the content root (not in innerHTML), so the list tool's onPaste —
        // which reads content.innerHTML for text — is unaffected.
        content.setAttribute('data-blok-paste-list-style', listTarget.style);
        content.setAttribute('data-blok-paste-list-depth', String(listTarget.depth));
      }

      const event = this.composePasteEvent('tag', {
        data: content,
      });

      return {
        content,
        tool: applyListStyle ? 'list' : defaultBlock,
        isBlock: false,
        event,
      };
    });
  }
}
