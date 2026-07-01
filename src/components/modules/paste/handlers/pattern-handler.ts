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

    // Notion-style menu: a URL paste always offers the view choice (Plain /
    // Bookmark / Embed) instead of auto-claiming. Requires a collapsed caret; a
    // selection keeps the native "hyperlink the selection" behavior.
    if (isHttpUrl(data) && !this.hasSelection()) {
      this.openLinkPasteMenu(data, context.canReplaceCurrentBlock);

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

  private openLinkPasteMenu(url: string, canReplace: boolean): void {
    // Capture the paste target now: opening the popover moves focus out of the
    // block, so currentBlock may drift before the user picks (notably in WebKit).
    const targetBlock = this.Blok.BlockManager.currentBlock ?? null;

    // Show the link straight away and anchor the menu at its end, like Notion:
    // the pasted link stays visible while the user chooses bookmark/embed/plain.
    // An empty, replaceable block BECOMES the link; a block with content instead
    // gets the link inserted inline at the caret so its other content survives.
    const linkBlock = canReplace ? this.insertPlainLink(url, targetBlock) : targetBlock;

    if (!canReplace) {
      this.insertInlineLink(url);
    }

    this.menu.open({
      url,
      hasSelection: this.hasSelection(),
      allowGenericEmbed: this.config?.linkPaste?.allowGenericEmbed === true,
      position: this.getLinkEndRect(linkBlock, url) ?? this.getCaretRect(),
      ...(linkBlock?.holder ? { trigger: linkBlock.holder } : {}),
      onSelect: (type: PasteMenuActionType): void => {
        void this.applyMenuAction(type, url, linkBlock, canReplace);
      },
      onDismiss: (): void => {
        // The link is already inserted; dismissing simply keeps it as-is.
      },
    });
  }

  /**
   * The end of the just-inserted link, used to anchor the menu right after it.
   * Prefers the last client rect so a wrapped link anchors at its visual end.
   */
  private getLinkEndRect(block: TargetBlock, url: string): DOMRect | null {
    const anchor = this.findInsertedAnchor(block, url);

    if (!anchor) {
      return null;
    }

    const rects = anchor.getClientRects();
    const rect = rects.length > 0 ? rects[rects.length - 1] : anchor.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    return new DOMRect(rect.right, rect.top, 0, rect.height);
  }

  /**
   * The anchor just inserted for `url` (matched by exact href), or the first
   * anchor as a fallback. Lets us anchor the menu at — and later remove — the
   * pasted link even when the block already held other links.
   */
  private findInsertedAnchor(block: TargetBlock, url: string): HTMLAnchorElement | null {
    const holder: HTMLElement | undefined = block?.holder;

    if (!holder) {
      return null;
    }

    const anchors = holder.querySelectorAll<HTMLAnchorElement>('a');

    if (anchors.length === 0) {
      return null;
    }

    for (const anchor of Array.from(anchors)) {
      if (anchor.getAttribute('href') === url) {
        return anchor;
      }
    }

    return anchors[0];
  }

  private restoreTarget(targetBlock: TargetBlock): void {
    if (targetBlock?.holder) {
      this.Blok.BlockManager.setCurrentBlockByChildNode(targetBlock.holder);
    }
  }

  private async applyMenuAction(
    type: PasteMenuActionType,
    url: string,
    linkBlock: TargetBlock,
    canReplace: boolean
  ): Promise<void> {
    switch (type) {
      case 'bookmark':
      case 'embed':
        this.restoreTarget(linkBlock);

        if (canReplace) {
          // Empty block: the link IS the block — swap it for the rich view.
          await this.insertForcedPatternBlock(type, url, true);
        } else {
          // Block has other content: drop the inline link and append the rich
          // view as a NEW block, leaving the surrounding text untouched.
          this.removeInlineLink(linkBlock, url);
          await this.insertForcedPatternBlock(type, url, false);
        }
        break;
      case 'plain':
        // The link is already shown; nothing more to do.
        break;
      case 'mention':
        // Built + unit-tested, but not yet served live (see PasteMenuController).
        break;
    }
  }

  /**
   * Remove the inline link inserted for the menu so a chosen bookmark/embed does
   * not leave a duplicate of the URL behind in the block's text.
   */
  private removeInlineLink(block: TargetBlock, url: string): void {
    this.findInsertedAnchor(block, url)?.remove();
  }

  private async insertForcedPatternBlock(tool: string, url: string, canReplace: boolean): Promise<void> {
    const event = this.composePasteEvent('pattern', { key: tool, data: url });

    await this.insertPatternBlock({ key: tool, data: url, tool, event }, canReplace);
  }

  private insertPlainLink(url: string, targetBlock: TargetBlock): TargetBlock {
    this.restoreTarget(targetBlock);

    // Replace the empty paste target with a default block holding the link.
    // Caret-independent so it survives the popover's focus changes (Escape).
    return this.Blok.BlockManager.insert({
      data: { text: this.buildAnchor(url).outerHTML },
      replace: true,
      needToFocus: true,
    });
  }

  /**
   * Insert the URL as a link at the current caret position, keeping the rest of
   * the block's content intact. Used when the paste target is not an empty
   * replaceable block, so a whole-block replace would destroy existing content.
   */
  private insertInlineLink(url: string): void {
    this.Blok.Caret.insertContentAtCaretPosition(this.buildAnchor(url).outerHTML);
  }

  private buildAnchor(url: string): HTMLAnchorElement {
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'nofollow';
    anchor.textContent = url;

    return anchor;
  }
}
