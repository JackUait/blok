import type { BlokConfig } from '../../../../../types/configs/blok-config';
import { isHttpUrl } from '../../../../tools/link/registry';
import { PasteMenuController, type LinkPasteMenu } from '../../../../tools/link/paste-menu/controller';
import type { PasteMenuActionType } from '../../../../tools/link/paste-menu/options';
import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext, PatternMatch } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

/** The block a URL paste landed on, captured before the menu steals focus. */
type TargetBlock = BlokModules['BlockManager']['currentBlock'] | null;

/**
 * Pattern Handler Priority.
 * Checks if data matches tool patterns.
 */
export class PatternHandler extends BasePasteHandler implements PasteHandler {
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;

  private readonly config?: BlokConfig;
  private readonly menu: LinkPasteMenu;

  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
    config?: BlokConfig,
    menu?: LinkPasteMenu
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
    this.config = config;
    this.menu = menu ?? new PasteMenuController({ t: (key: string): string => Blok.I18n.t(key) });
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    const text = data;

    if (!text || text.length > PatternHandler.PATTERN_PROCESSING_MAX_LENGTH) {
      return 0;
    }

    const pattern = this.toolRegistry.findToolForPattern(text);

    return pattern ? 60 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const pattern = this.toolRegistry.findToolForPattern(data);

    if (!pattern) {
      return false;
    }

    // Notion-style menu: on a URL paste, offer the view choice instead of
    // auto-claiming. Opt-in (linkPaste.menu); requires a collapsed caret.
    if (this.isLinkMenuEnabled() && isHttpUrl(data) && !this.hasSelection()) {
      this.openLinkPasteMenu(data, context);

      return true;
    }

    const event = this.composePasteEvent('pattern', {
      key: pattern.key,
      data: data,
    });

    const match: PatternMatch = {
      key: pattern.key,
      data: data,
      tool: pattern.tool.name,
      event,
    };

    await this.insertPatternBlock(match, context.canReplaceCurrentBlock);

    return true;
  }

  /**
   * Insert pattern block.
   * Public method for other handlers to call.
   */
  async insertPatternBlock(match: PatternMatch, canReplace: boolean): Promise<void> {
    const { BlockManager, Caret } = this.Blok;

    const insertedBlock = await BlockManager.paste(match.tool, match.event, canReplace);

    Caret.setToBlock(insertedBlock, Caret.positions.END);
  }

  private isLinkMenuEnabled(): boolean {
    return this.config?.linkPaste?.menu === true;
  }

  private hasSelection(): boolean {
    const selection = window.getSelection();

    return selection !== null && !selection.isCollapsed && selection.toString().length > 0;
  }

  private getCaretRect(): DOMRect | null {
    const selection = window.getSelection();

    if (selection && selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();

      if (rect.width > 0 || rect.height > 0) {
        return rect;
      }
    }

    const holder = this.Blok.BlockManager.currentBlock?.holder;

    return holder ? holder.getBoundingClientRect() : null;
  }

  private openLinkPasteMenu(url: string, context: HandlerContext): void {
    // Capture the paste target now: opening the popover moves focus out of the
    // block, so currentBlock may drift before the user picks (notably in WebKit).
    const targetBlock = this.Blok.BlockManager.currentBlock ?? null;

    this.menu.open({
      url,
      hasSelection: this.hasSelection(),
      position: this.getCaretRect(),
      ...(targetBlock?.holder ? { trigger: targetBlock.holder } : {}),
      onSelect: (type: PasteMenuActionType): void => {
        void this.applyMenuAction(type, url, context, targetBlock);
      },
      onDismiss: (): void => {
        this.insertPlainLink(url, targetBlock);
      },
    });
  }

  private restoreTarget(targetBlock: TargetBlock): void {
    if (targetBlock?.holder) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(targetBlock.holder);
    }
  }

  private async applyMenuAction(
    type: PasteMenuActionType,
    url: string,
    context: HandlerContext,
    targetBlock: TargetBlock
  ): Promise<void> {
    this.restoreTarget(targetBlock);

    switch (type) {
      case 'bookmark':
        await this.insertForcedPatternBlock('bookmark', url, context.canReplaceCurrentBlock);
        break;
      case 'embed':
        await this.insertForcedPatternBlock('embed', url, context.canReplaceCurrentBlock);
        break;
      case 'plain':
        this.insertPlainLink(url, targetBlock);
        break;
      case 'mention':
        // Built + unit-tested, but not yet served live (see PasteMenuController).
        break;
    }
  }

  private async insertForcedPatternBlock(tool: string, url: string, canReplace: boolean): Promise<void> {
    const event = this.composePasteEvent('pattern', { key: tool, data: url });

    await this.insertPatternBlock({ key: tool, data: url, tool, event }, canReplace);
  }

  private insertPlainLink(url: string, targetBlock: TargetBlock): void {
    this.restoreTarget(targetBlock);

    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'nofollow';
    anchor.textContent = url;

    // Replace the empty paste target with a default block holding the link.
    // Caret-independent so it survives the popover's focus changes (Escape).
    this.Blok.BlockManager.insert({
      data: { text: anchor.outerHTML },
      replace: true,
      needToFocus: true,
    });
  }
}
