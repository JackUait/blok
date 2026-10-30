import { Module } from '../../__module';
import { Dom as dom$ } from '../../dom';
import { findOwn } from '../../utils/own-element';
import { recordPasteHandling } from '../../utils/paste-continuation';
import { log } from '../../utils/logger';
import { waitAtMost } from '../../utils/lazy-styles';
import { rangeAtTextOffsets, textOffsetOf } from '../../utils/caret/selection';

import { BLOK_MIME_TYPE, NEXT_SPACE_MIMES, NOTION_BLOCKS_V3_MIME } from './constants';
import { ToolRegistry } from './tool-registry';
// Type only: the pipeline loads on the first paste.
import type { PasteEngine } from './engine';
import type { Block } from '../../block';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';

/**
 * Where a paste was made, read in its event. Kept as a block id and a text
 * offset, not as nodes: the block can be re-rendered while the pipeline loads.
 */
interface PastePlace {
  blockId: string | undefined;
  /** Index of the input the caret was in, or null when it was in none. */
  inputIndex: number | null;
  /** Text offsets of the selection in that input; equal for a caret. */
  offset: number;
  endOffset: number;
  /**
   * The selection itself. It follows edits made during the load, so it is
   * used while its own nodes are still in that input.
   */
  range: Range | null;
  startNode: Node | null;
  endNode: Node | null;
}

/** How long a first-load paste waits for the one before it. Matches the table's paste continuation. */
const FIRST_PASTE_WAIT_MS = 5000;

/**
 * A block's inputs, read from its DOM: a block re-rendered during the load can
 * still list its old ones.
 * @param block - the block
 */
const inputsOf = (block: Block | undefined): HTMLElement[] => (block?.holder instanceof HTMLElement ? dom$.findAllInputs(block.holder) : []);

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

/** A clipboard that holds only `text`, for paste without formatting. */
const plainTextOnly = (text: string): DataTransfer => snapshotOf({
  types: ['text/plain'],
  getData: (type: string): string => (type === 'text/plain' ? text : ''),
} as unknown as DataTransfer);

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
  private engineLoaded = false;
  /** Pastes made before the pipeline loaded, run one at a time in order. Null when none wait. */
  private firstPastes: Promise<void> | null = null;

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
   * Loads the paste pipeline. A caller that changes the document before it
   * pastes awaits this first, so a failed load changes nothing.
   */
  public async load(): Promise<void> {
    await this.engine();
  }

  /** Loads the pipeline ahead of the first paste. A failure stays silent: the next paste loads it again. */
  public warm(): void {
    if (!this.isDestroyed && !this.Blok.ReadOnly.isEnabled) {
      this.engine().catch(() => undefined);
    }
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
  public async processDataTransfer(dataTransfer: DataTransfer, pasteTarget?: Element, loadedAtEvent = this.engineLoaded): Promise<void> {
    const snapshot = snapshotOf(dataTransfer);

    await this.withEngine(snapshot, false, loadedAtEvent, engine => engine.processDataTransfer(snapshot, pasteTarget));
  }

  /** The paste pipeline. One shared load; a failed one is dropped so the next paste tries again. */
  private engine(): Promise<PasteEngine> {
    if (this.engineLoad !== null) {
      return this.engineLoad;
    }

    const load = import('./engine').then(({ PasteEngine: Engine }) => {
      const engine = new Engine(this.Blok, this.config, this.toolRegistry);

      this.engineLoaded = true;

      return engine;
    });

    this.engineLoad = load;
    load.catch(() => {
      if (this.engineLoad === load) {
        this.engineLoad = null;
      }
    });

    return load;
  }

  /**
   * Runs a paste or drop the editor already took from the browser. A paste
   * made before the pipeline loaded waits in line, and runs at the place it
   * was made: the person may move the caret meanwhile. A failed load still
   * lands the plain text, since the event's default was prevented.
   * @param clipboard - the event's data, already copied
   * @param plainOnly - paste without formatting, so no HTML hook runs
   * @param loadedAtEvent - whether the pipeline had loaded when the event fired
   * @param paste - the pipeline call
   */
  private async withEngine(clipboard: DataTransfer, plainOnly: boolean, loadedAtEvent: boolean, paste: (engine: PasteEngine) => Promise<void>): Promise<void> {
    if (loadedAtEvent && this.firstPastes === null) {
      const engine = await this.engine();

      if (this.canStillPaste()) {
        await paste(engine);
      }

      return;
    }

    const place = this.placeOfPaste();

    // Made after the load: it does not wait behind first-load pastes, one of which may never settle.
    if (loadedAtEvent) {
      return this.pasteAt(place, clipboard, plainOnly, paste);
    }
    const turn = waitAtMost(this.firstPastes ?? Promise.resolve(), FIRST_PASTE_WAIT_MS).then(() => this.pasteAt(place, clipboard, plainOnly, paste));
    const done = turn.catch(() => undefined);

    this.firstPastes = done;
    void done.then(() => {
      if (this.firstPastes === done) {
        this.firstPastes = null;
      }
    });

    return turn;
  }

  private async pasteAt(place: PastePlace, clipboard: DataTransfer, plainOnly: boolean, paste: (engine: PasteEngine) => Promise<void>): Promise<void> {
    const engine = await this.engine().catch((error: unknown) => {
      if (this.canStillPaste()) {
        log('Paste: the paste code failed to load, so the clipboard text was pasted without formatting.', 'warn', error);
        this.pasteAsPlainText(place, clipboard, plainOnly);
      }

      return null;
    });

    if (engine === null || !this.canStillPaste()) {
      return;
    }
    if (!this.returnTo(place)) {
      log('Paste: the place of the paste left the editor while the paste code loaded, so nothing was pasted.', 'warn');

      return;
    }
    // Same synchronous step as returnTo: the pipeline reads the current block before it awaits.
    await paste(engine);
  }

  private pasteAsPlainText(place: PastePlace, clipboard: DataTransfer, plainOnly: boolean): void {
    const html = clipboard.getData('text/html');

    // The host hook sees every HTML paste, as it does when the pipeline runs.
    if (!plainOnly && html !== '' && this.config.onBeforePaste) {
      this.config.onBeforePaste(html);
    }
    if (this.returnTo(place) && this.caretInEditor()) {
      this.insertPlainText(clipboard.getData('text/plain'));
    }
  }

  /** Destroy or read-only can land while the pipeline loads. */
  private canStillPaste(): boolean {
    return !this.isDestroyed && !this.Blok.ReadOnly.isEnabled;
  }

  private placeOfPaste(): PastePlace {
    const block = this.Blok.BlockManager.currentBlock;
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const inputs = inputsOf(block);
    const inputIndex = range === null ? -1 : inputs.findIndex(input => input.contains(range.startContainer));
    const input = inputs[inputIndex];

    if (range === null || input === undefined) {
      return { blockId: block?.id, inputIndex: null, offset: 0, endOffset: 0, range: null, startNode: null, endNode: null };
    }

    const offset = textOffsetOf(input, range.startContainer, range.startOffset);
    // A selection that runs past this input is kept up to the input's end.
    const endOffset = input.contains(range.endContainer) ? textOffsetOf(input, range.endContainer, range.endOffset) : (input.textContent ?? '').length;

    return {
      blockId: block?.id,
      inputIndex,
      offset,
      endOffset: Math.max(offset, endOffset),
      range: range.cloneRange(),
      startNode: range.startContainer,
      endNode: range.endContainer,
    };
  }

  private caretInEditor(): boolean {
    const anchor = window.getSelection()?.anchorNode ?? null;

    return anchor !== null && this.Blok.UI.nodes.holder.contains(anchor);
  }

  /**
   * Puts the caret back where the paste was made. When that block is gone,
   * the paste goes to the caret if it is still in the editor.
   * @param place - read in the paste event
   * @returns false when there is nowhere in the editor to paste
   */
  private returnTo(place: PastePlace): boolean {
    const { BlockManager } = this.Blok;

    if (place.blockId === undefined) {
      return true;
    }

    const block = BlockManager.getBlockById(place.blockId);

    if (block === undefined) {
      const anchor = window.getSelection()?.anchorNode;

      if (!this.caretInEditor() || !(anchor instanceof Node)) {
        return false;
      }
      BlockManager.setCurrentBlockByChildNode(anchor);

      return true;
    }

    BlockManager.currentBlock = block;

    // Read afresh: a block re-rendered during the load can still list its old inputs.
    const inputs = inputsOf(block);
    const input = place.inputIndex === null ? undefined : inputs[place.inputIndex] ?? inputs.at(-1);

    if (input !== undefined) {
      const kept = place.range;
      // A removed node moves the Range to its parent, so it is trusted only while it still sits in its own nodes.
      const range = kept !== null && kept.startContainer === place.startNode && kept.endContainer === place.endNode &&
        input.contains(kept.startContainer) && input.contains(kept.endContainer)
        ? kept
        : rangeAtTextOffsets(input, place.offset, place.endOffset);

      // Focus first: moving focus between inputs can reset the selection.
      input.focus({ preventScroll: true });
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      block.currentInput = input;
    }

    return true;
  }

  private insertPlainText(text: string): void {
    if (text === '') {
      return;
    }

    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');

    this.Blok.Caret.insertContentAtCaretPosition(escaped);
  }

  private async processAsText(plainData: string, loadedAtEvent: boolean): Promise<void> {
    await this.withEngine(plainTextOnly(plainData), true, loadedAtEvent, engine => engine.processAsText(plainData));
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
    const loadedAtEvent = this.engineLoaded;
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
        await this.processAsText(clipboard.getData('text/plain'), loadedAtEvent);
      } else {
        await this.processDataTransfer(clipboard, pasteTarget, loadedAtEvent);
      }
    }

    Toolbar.moveAndOpen();
  };
}
