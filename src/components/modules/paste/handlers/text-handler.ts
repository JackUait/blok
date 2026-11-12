import type { BlokConfig } from '../../../../../types/configs/blok-config';
import type { ListItemStyle } from '../../../../tools/list/types';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import { nanoid } from 'nanoid';

import { Dom } from '../../../dom';
import { offerCsvDatabase } from '../csv-database-offer';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PasteData } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

/** `---`, `***` or `___` (3+ marks, spaces between allowed) on a line of its own. Anchored, so linear. */
const SEPARATOR_LINE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * Whether line `index` is a separator: a mark line with a blank line or the
 * text edge on both sides. A dash line right under text is a setext heading
 * underline, and prose underlined that way stays text.
 */
const isSeparatorAt = (lines: string[], index: number): boolean =>
  SEPARATOR_LINE.test(lines[index]) &&
  (lines[index - 1] ?? '').trim() === '' &&
  (lines[index + 1] ?? '').trim() === '';

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
    const withSeparators = context.literalText !== true && this.Blok.Tools.blockTools.has('divider');
    const dataToInsert = this.processPlain(data, listTarget, withSeparators);

    if (!dataToInsert.length) {
      return false;
    }

    const before = this.offersDatabase() ? new Set(this.Blok.BlockManager.blocks.map((block) => block.id)) : null;

    await this.insertPasteData(dataToInsert, context.canReplaceCurrentBlock);
    if (before !== null) {
      offerCsvDatabase(data, this.Blok.BlockManager.blocks.filter((block) => !before.has(block.id)).map((block) => block.id), {
        blocks: this.Blok.BlocksAPI.methods,
        notify: (options) => this.Blok.NotifierAPI.methods.show(options),
        t: (key) => this.Blok.I18n.t(key),
        newId: () => nanoid(),
      });
    }

    return true;
  }

  /** The CSV-to-database offer needs both database tools. */
  private offersDatabase(): boolean {
    const tools = this.Blok.Tools.blockTools;

    return tools.has('database') && tools.has('database-row');
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
  private processPlain(
    plain: string,
    listTarget: { style: ListItemStyle; depth: number } | null,
    withSeparators: boolean
  ): PasteData[] {
    const { defaultBlock } = this.config;

    if (!plain || !defaultBlock) {
      return [];
    }

    const rawLines = plain.split(/\r?\n/);
    const separators = new Set(withSeparators ? rawLines.flatMap((_, index) => isSeparatorAt(rawLines, index) ? [index] : []) : []);

    if (separators.size > 0) {
      return this.processWithSeparators(rawLines, separators, listTarget, defaultBlock);
    }

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

    return lines.map((text) => this.textLine(text, applyListStyle ? listTarget : null, defaultBlock));
  }

  /**
   * Separator lines become dividers. The other lines are pasted as they would
   * be with no separator. A divider batch is a block batch, so a blank first
   * line needs no empty lead: base.ts splits at the caret only when the first
   * and last items are text.
   */
  private processWithSeparators(
    rawLines: string[],
    separators: Set<number>,
    listTarget: { style: ListItemStyle; depth: number } | null,
    defaultBlock: string
  ): PasteData[] {
    const contentLines = rawLines.filter((text, index) => text.trim() && !separators.has(index));
    const lineListTarget = contentLines.length > 1 ? listTarget : null;

    return rawLines.flatMap((text, index) => {
      if (separators.has(index)) {
        const content = Dom.make('hr');

        return [{ content, tool: 'divider', isBlock: true, event: this.composePasteEvent('tag', { data: content }) }];
      }

      return text.trim() ? [this.textLine(text, lineListTarget, defaultBlock)] : [];
    });
  }

  /** One pasted line as a text block, or a list item when it continues a list. */
  private textLine(text: string, listTarget: { style: ListItemStyle; depth: number } | null, defaultBlock: string): PasteData {
    const content = Dom.make('div');

    content.textContent = text;

    if (listTarget) {
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
      tool: listTarget ? 'list' : defaultBlock,
      isBlock: false,
      event,
    };
  }
}
