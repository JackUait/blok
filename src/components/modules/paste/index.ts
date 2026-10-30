import { Module } from '../../__module';
import { Dom as dom$ } from '../../dom';
import { findOwn } from '../../utils/own-element';
import { recordPasteHandling } from '../../utils/paste-continuation';
import { log } from '../../utils/logger';

import { BLOK_MIME_TYPE, NEXT_SPACE_MIMES, NOTION_BLOCKS_V3_MIME } from './constants';
import { ToolRegistry } from './tool-registry';
// Type only: the pipeline loads on the first paste.
import type { PasteEngine } from './engine';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';

/**
 * A copy of a DataTransfer that stays readable after its event is over.
 * Reads every listed type plus the flavours the pipeline asks for by name,
 * since `types` does not always list them.
 * @param dataTransfer - the event's clipboard or drop data
 */
const snapshotOf = (dataTransfer: DataTransfer): DataTransfer => {
  const types = Array.from(dataTransfer.types ?? []);
  const named = ['text/plain', 'text/html', BLOK_MIME_TYPE, NOTION_BLOCKS_V3_MIME, ...NEXT_SPACE_MIMES];
  const data = new Map([...new Set([...types, ...named])].filter(type => type !== 'Files').map(type => [type, dataTransfer.getData(type)]));
  const files = Array.from(dataTransfer.files ?? []);
  const items = Array.from(dataTransfer.items ?? []).map((item) => {
    const file = item.kind === 'file' ? item.getAsFile() : null;

    return { kind: item.kind, type: item.type, getAsFile: (): File | null => file };
  });
  // FilesHandler checks for setData to tell a DataTransfer from other data.
  const snapshot = { types, files, items, getData: (type: string): string => data.get(type) ?? '', setData: (): void => undefined };

  return snapshot as unknown as DataTransfer;
};

/**
 * @class Paste
 * @classdesc Contains methods to handle paste on blok
 * @module Paste
 * @version 2.0.0
 */
export class Paste extends Module {
  /** If string's length is greater than this number we don't check paste patterns */
  public static readonly PATTERN_PROCESSING_MAX_LENGTH = 450;

  /** Custom Blok mime-type to handle in-blok copy/paste actions */
  public readonly MIME_TYPE = BLOK_MIME_TYPE;

  private toolRegistry!: ToolRegistry;
  private engineLoad: Promise<PasteEngine> | null = null;

  /**
   * Whether the most recent keyboard activity had Shift held. A `paste`
   * ClipboardEvent carries no modifier flags, so we read Shift from the
   * keydown/keyup that drives Cmd/Ctrl+Shift+V and use it to route the paste
   * to the raw plain-text path (paste-without-formatting), bypassing the
   * markdown/HTML→blocks conversion pipeline.
   */
  private isShiftHeld = false;

  /**
   * Set onPaste callback and collect tools' paste configurations.
   */
  public async prepare(): Promise<void> {
    const { Tools } = this.Blok;

    this.toolRegistry = new ToolRegistry(Tools.blockTools, this.config);

    await this.toolRegistry.processTools();
  }

  /**
   * Closes the link paste menu if it is still open.
   */
  public destroy(): void {
    this.engineLoad?.then(engine => engine.destroy(), () => undefined);
  }

  /**
   * Process text data (public API).
   * Used by API.renderFromHTML() to process HTML or plain text.
   * @param data - Text or HTML string to process
   * @param isHTML - If true, process as HTML, otherwise as plain text
   */
  public async processText(data: string, isHTML = false): Promise<void> {
    await (await this.engine()).processText(data, isHTML);
  }

  /**
   * The blocks a paste of `html` gives, without touching this editor.
   * @param html - the HTML to paste
   */
  public async blocksFromHtml(html: string): Promise<OutputBlockData[]> {
    return (await this.engine()).blocksFromHtml(html);
  }

  /**
   * Set read-only state.
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      this.setCallback();
    } else {
      this.unsetCallback();
    }
  }

  /**
   * Handle pasted data transfer object. Reads it at once: the browser empties
   * a clipboard once its event is over, and the pipeline may still be loading.
   */
  public async processDataTransfer(dataTransfer: DataTransfer, pasteTarget?: Element): Promise<void> {
    const snapshot = snapshotOf(dataTransfer);
    const engine = await this.engineForEvent(snapshot.getData('text/plain'));

    await engine?.processDataTransfer(snapshot, pasteTarget);
  }

  /** The paste pipeline. One shared load; a failed one is dropped so the next paste tries again. */
  private engine(): Promise<PasteEngine> {
    if (this.engineLoad !== null) {
      return this.engineLoad;
    }

    const load = import('./engine').then(({ PasteEngine: Engine }) => new Engine(this.Blok, this.config, this.toolRegistry));

    this.engineLoad = load;
    load.catch(() => {
      if (this.engineLoad === load) {
        this.engineLoad = null;
      }
    });

    return load;
  }

  /**
   * The pipeline for a paste or drop the editor already took from the browser,
   * or null when there is nothing left to do. A failed load still lands the
   * plain text: the event's default was prevented, so nothing else would.
   * @param plainText - the event's text/plain flavour
   */
  private async engineForEvent(plainText: string): Promise<PasteEngine | null> {
    try {
      const engine = await this.engine();

      return this.canStillPaste() ? engine : null;
    } catch (error) {
      if (this.canStillPaste()) {
        log('Paste: the paste code failed to load, so the clipboard text was pasted without formatting.', 'warn', error);
        this.insertPlainText(plainText);
      }

      return null;
    }
  }

  /** The editor can be destroyed while the pipeline loads. */
  private canStillPaste(): boolean {
    return !this.isDestroyed;
  }

  private insertPlainText(text: string): void {
    if (text === '') {
      return;
    }

    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');

    this.Blok.Caret.insertContentAtCaretPosition(escaped);
  }

  private async processAsText(plainData: string): Promise<void> {
    const engine = await this.engineForEvent(plainData);

    await engine?.processAsText(plainData);
  }

  /**
   * Set onPaste callback handler.
   */
  private setCallback(): void {
    const holder = this.Blok.UI.nodes.holder;

    this.listeners.on(holder, 'paste', this.handlePasteEventWrapper);
    this.listeners.on(holder, 'keydown', this.handleShiftStateWrapper);
    this.listeners.on(holder, 'keyup', this.handleShiftStateWrapper);
    this.listeners.on(holder, 'drop', this.handleDropEventWrapper);
    this.listeners.on(holder, 'dragover', this.handleDragOverEventWrapper);
    this.listeners.on(holder, 'dragleave', this.handleDragLeaveEventWrapper);
  }

  /**
   * Unset onPaste callback handler.
   */
  private unsetCallback(): void {
    const holder = this.Blok.UI.nodes.holder;

    this.listeners.off(holder, 'paste', this.handlePasteEventWrapper);
    this.listeners.off(holder, 'keydown', this.handleShiftStateWrapper);
    this.listeners.off(holder, 'keyup', this.handleShiftStateWrapper);
    this.listeners.off(holder, 'drop', this.handleDropEventWrapper);
    this.listeners.off(holder, 'dragover', this.handleDragOverEventWrapper);
    this.listeners.off(holder, 'dragleave', this.handleDragLeaveEventWrapper);
  }

  /**
   * Wrapper handler for paste event that matches listeners.on signature.
   */
  private handlePasteEventWrapper = (event: Event): void => {
    recordPasteHandling(event, this.handlePasteEvent(event as ClipboardEvent));
  };

  /**
   * Track whether Shift is currently held so a following paste can route to
   * the raw plain-text path. Reading shiftKey on both keydown and keyup keeps
   * the flag in sync as the modifier is pressed and released.
   */
  private handleShiftStateWrapper = (event: Event): void => {
    this.isShiftHeld = (event as KeyboardEvent).shiftKey;
  };

  private handleDropEventWrapper = (event: Event): void => {
    void this.handleDropEvent(event as DragEvent);
  };

  private handleDragOverEventWrapper = (event: Event): void => {
    this.handleDragOverEvent(event as DragEvent);
  };

  private handleDragLeaveEventWrapper = (event: Event): void => {
    this.handleDragLeaveEvent(event as DragEvent);
  };

  private dataTransferHasFiles(dataTransfer: DataTransfer | null | undefined): boolean {
    if (!dataTransfer) {
      return false;
    }

    const types = Array.from(dataTransfer.types ?? []);

    if (types.includes('Files')) {
      return true;
    }

    return Boolean(dataTransfer.files?.length);
  }

  private dropIndicatorHolder: HTMLElement | null = null;

  private handleDragOverEvent = (event: DragEvent): void => {
    const { dataTransfer } = event;

    if (!this.dataTransferHasFiles(dataTransfer)) {
      return;
    }

    event.preventDefault();

    if (dataTransfer) {
      dataTransfer.dropEffect = 'copy';
    }

    this.updateDropIndicator(event);
  };

  private updateDropIndicator(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const blockHolder = target?.closest('[data-blok-element]');

    if (!(blockHolder instanceof HTMLElement)) {
      this.clearDropIndicator();

      return;
    }

    const rect = blockHolder.getBoundingClientRect();
    const edge = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';

    if (this.dropIndicatorHolder && this.dropIndicatorHolder !== blockHolder) {
      this.dropIndicatorHolder.removeAttribute('data-drop-indicator');
      this.dropIndicatorHolder.style.removeProperty('--drop-indicator-depth');
    }

    blockHolder.setAttribute('data-drop-indicator', edge);
    blockHolder.style.setProperty('--drop-indicator-depth', String(this.computeDropDepth(blockHolder)));
    this.dropIndicatorHolder = blockHolder;
  }

  private computeDropDepth(blockHolder: HTMLElement): number {
    const ancestorBlocks = blockHolder.parentElement?.closest('[data-blok-element]')
      ? this.countAncestorBlocks(blockHolder)
      : 0;

    const listWrapper = findOwn(blockHolder, '[data-list-depth]');
    const listDepthRaw = listWrapper?.getAttribute('data-list-depth') ?? '0';
    const listDepth = Number.parseInt(listDepthRaw, 10);
    const listContribution = Number.isNaN(listDepth) ? 0 : listDepth;

    return ancestorBlocks + listContribution;
  }

  private countAncestorBlocks(blockHolder: HTMLElement): number {
    const parent = blockHolder.parentElement?.closest('[data-blok-element]') as HTMLElement | null;

    if (!parent) {
      return 0;
    }

    return 1 + this.countAncestorBlocks(parent);
  }

  private clearDropIndicator(): void {
    if (this.dropIndicatorHolder) {
      this.dropIndicatorHolder.removeAttribute('data-drop-indicator');
      this.dropIndicatorHolder.style.removeProperty('--drop-indicator-depth');
      this.dropIndicatorHolder = null;
    }
  }

  private handleDragLeaveEvent = (event: DragEvent): void => {
    const holder = this.Blok.UI.nodes.holder;
    const related = event.relatedTarget as Node | null;

    if (related && holder.contains(related)) {
      return;
    }

    this.clearDropIndicator();
  };

  private handleDropEvent = async (event: DragEvent): Promise<void> => {
    this.clearDropIndicator();

    if (this.Blok.DragManager?.isDragging) {
      return;
    }

    if (!this.dataTransferHasFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();

    const { BlockManager, Toolbar } = this.Blok;
    const currentBlock = BlockManager.setCurrentBlockByChildNode(event.target as HTMLElement);

    if (!currentBlock) {
      return;
    }

    if (this.toolRegistry.isException(currentBlock.name)) {
      return;
    }

    if (event.dataTransfer) {
      const dropTarget = event.target instanceof Element ? event.target : undefined;

      await this.processDataTransfer(event.dataTransfer, dropTarget);
    }

    Toolbar.moveAndOpen();
  };

  /**
   * Check if browser behavior suits better.
   */
  private isNativeBehaviour(element: EventTarget): boolean {
    return dom$.isNativeInput(element) ||
      (element instanceof HTMLElement && (
        element.contentEditable === 'plaintext-only' ||
        element.getAttribute('contenteditable') === 'plaintext-only'
      ));
  }

  /**
   * Check if Blok should process pasted data and pass data transfer object to handler.
   */
  private handlePasteEvent = async (event: ClipboardEvent): Promise<void> => {
    /**
     * If the event was already handled (e.g., by the table grid paste listener),
     * skip processing to prevent duplicate content insertion.
     */
    if (event.defaultPrevented) {
      return;
    }

    /**
     * Layer 20: paste-during-drag bail (regression: wrong-block-dropped family).
     *
     * DragController captures live Block references when the drag starts and
     * commits them in `handleDrop` on mouseup. A paste firing mid-drag would
     * call `BlockManager.paste` / `insert` / `convertToTool`, any of which
     * reshuffles the flat blocks array under DragController's feet — the
     * resulting indices are stale and a later move() silently drops an
     * unrelated block. Mirrors the Cmd+Z-during-drag guard in
     * uiControllers/controllers/keyboard.ts handleZ.
     *
     * Swallow the paste so the drag completes cleanly; the user can paste
     * after releasing the mouse.
     */
    if (this.Blok.DragManager?.isDragging) {
      event.preventDefault();

      return;
    }

    // Read now: the awaits below can outlive the event, and the browser empties its clipboard then.
    const clipboard = event.clipboardData ? snapshotOf(event.clipboardData) : null;
    const { BlockManager, BlockEvents, Toolbar } = this.Blok;

    /**
     * A paste over a cross-block text selection replaces it. The range spans two
     * editing hosts, so nothing deletes it on its own — left in place, the
     * pasted content would be inserted BESIDE the still-selected text.
     *
     * Afterwards `event.target` may be detached (the merge can rebuild the host
     * it pointed at), so the destination is re-read from the caret the deletion
     * left behind rather than from the event.
     */
    const replacedTextSelection = await BlockEvents.clearCrossBlockTextSelectionForPaste();

    if (replacedTextSelection) {
      event.preventDefault();
    }

    const currentBlock = (replacedTextSelection ? BlockManager.currentBlock : undefined) ??
      BlockManager.setCurrentBlockByChildNode(event.target as HTMLElement);

    if (
      !currentBlock ||
      (event.target && this.isNativeBehaviour(event.target) && clipboard && !clipboard.types.includes('Files'))
    ) {
      return;
    }

    if (this.toolRegistry.isException(currentBlock.name)) {
      return;
    }

    event.preventDefault();

    if (clipboard) {
      const eventTarget = event.target instanceof Element ? event.target : undefined;
      const pasteTarget = replacedTextSelection ? currentBlock.currentInput : eventTarget;

      // Cmd/Ctrl+Shift+V (paste without formatting): insert the clipboard's
      // raw text/plain payload, skipping the markdown/HTML→blocks conversion
      // that processDataTransfer would otherwise apply.
      if (this.isShiftHeld) {
        await this.processAsText(clipboard.getData('text/plain'));
      } else {
        await this.processDataTransfer(clipboard, pasteTarget);
      }
    }

    Toolbar.moveAndOpen();
  };
}
