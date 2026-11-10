import type { Block } from '../../../block';
import type { GestureKind } from '../../yjs/undo-history';
import { DATA_ATTR } from '../../../constants';
import { isCaretAtEndOfInput, isCaretAtStartOfInput } from '../../../utils/caret/boundaries';
import { isPasteContinuation } from '../../../utils/paste-continuation';

import { Controller } from './_base';

/** Keys that neither edit nor act: they never start a gesture. */
const PASSIVE_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'Process', 'Dead', 'Unidentified',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);

/** Input types that continue a typing run; `historyUndo`/`historyRedo` are left to the keyboard router. */
const TYPING_INPUT_TYPES = new Set(['insertText', 'insertReplacementText', 'insertLineBreak', 'deleteContentBackward', 'deleteContentForward']);
const IGNORED_INPUT_TYPES = new Set(['insertCompositionText', 'historyUndo', 'historyRedo']);

/**
 * Tells the undo history where each user gesture starts. A gesture start is
 * the only thing that closes an undo step and the moment its caret-before is
 * taken, before any handler moves the caret.
 *
 * Listens on the window in the capture phase: the inline toolbar and the
 * block menus are mounted outside the editor, and window capture runs before
 * every document listener, whatever its registration order. The inline tools'
 * shortcut manager is a page-level singleton that swallows Cmd+B on the
 * document, and it registers before every editor but the first.
 */
export class GestureController extends Controller {
  private wrapperElement: HTMLElement | null = null;

  /** Whether this controller holds the step open for a pointer press. */
  private pointerHeld = false;

  /** Whether this controller holds the step open for an IME composition. */
  private composing = false;

  private readonly keydownHandler = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.isComposing || this.isToolboxOpen() || !(this.owns(event) || this.ownsNavigationKey(event))) {
      return;
    }

    const kind = this.keyKind(event);

    if (kind !== null) {
      this.Blok.YjsManager.beginGesture(kind);
    }
  };

  private readonly beforeinputHandler = (event: Event): void => {
    if (!(event instanceof InputEvent) || event.isComposing || IGNORED_INPUT_TYPES.has(event.inputType) || this.isToolboxOpen() || !this.owns(event)) {
      return;
    }

    this.Blok.YjsManager.beginGesture(TYPING_INPUT_TYPES.has(event.inputType) ? 'typing' : 'discrete');
  };

  private readonly discreteHandler = (event: Event): void => {
    if (this.owns(event) && !isPasteContinuation(event)) {
      this.Blok.YjsManager.beginGesture('discrete');
    }
  };

  private readonly pointerdownHandler = (event: Event): void => {
    const insideToolbox = this.isToolboxOpen() && event.target instanceof Element && event.target.closest('[data-blok-popover]') !== null;

    if (insideToolbox || !this.owns(event)) {
      return;
    }

    this.Blok.YjsManager.beginGesture('discrete');

    // A drag inside the editor may pause longer than the capture timeout.
    // Only the main button drags; a right press opens a context menu, which
    // on macOS takes its pointerup and would leave the hold on.
    const drags = !(event instanceof MouseEvent) || event.button === 0;

    if (drags && !this.pointerHeld && this.isInsideWrapper(event.target)) {
      this.pointerHeld = true;
      this.Blok.YjsManager.holdCapture();
    }
  };

  private readonly pointerReleaseHandler = (): void => {
    if (this.pointerHeld) {
      this.pointerHeld = false;
      this.Blok.YjsManager.releaseCapture();
    }
  };

  private readonly compositionstartHandler = (event: Event): void => {
    if (this.composing || !this.owns(event)) {
      return;
    }

    this.Blok.YjsManager.beginGesture('typing');
    // The user may pause over the candidate list; the composition stays one step.
    this.composing = true;
    this.Blok.YjsManager.holdCapture();
  };

  private readonly compositionendHandler = (): void => {
    if (this.composing) {
      this.composing = false;
      this.Blok.YjsManager.releaseCapture();
    }
  };

  /**
   * Set the editor wrapper element
   * @param element - the editor wrapper
   */
  public setWrapperElement(element: HTMLElement): void {
    this.wrapperElement = element;
  }

  /**
   * Start listening for gesture starts
   */
  public override enable(): void {
    const on = this.readOnlyMutableListeners.on;

    on(window, 'keydown', this.keydownHandler, true);
    on(window, 'beforeinput', this.beforeinputHandler, true);
    on(window, 'pointerdown', this.pointerdownHandler, true);
    on(window, 'paste', this.discreteHandler, true);
    on(window, 'cut', this.discreteHandler, true);
    on(window, 'drop', this.discreteHandler, true);
    on(window, 'compositionstart', this.compositionstartHandler, true);
    on(window, 'compositionend', this.compositionendHandler, true);
    on(window, 'pointerup', this.pointerReleaseHandler, true);
    on(window, 'pointercancel', this.pointerReleaseHandler, true);
    // Ctrl+click on macOS is a main-button press that opens a context menu.
    on(window, 'contextmenu', this.pointerReleaseHandler, true);
    on(window, 'blur', this.pointerReleaseHandler);
    on(window, 'blur', this.compositionendHandler);
  }

  /**
   * Stop listening and release any hold
   */
  public override disable(): void {
    this.pointerReleaseHandler();
    this.compositionendHandler();
    super.disable();
  }

  /**
   * Classify a key press
   * @param event - the keydown
   * @returns the gesture kind, or null for a key that starts no gesture
   */
  private keyKind(event: KeyboardEvent): GestureKind | null {
    const key = event.key ?? '';

    if (PASSIVE_KEYS.has(key)) {
      return null;
    }

    if (event.ctrlKey || event.metaKey || this.Blok.BlockSelection.anyBlockSelected) {
      return 'discrete';
    }

    if (key.length === 1) {
      return 'typing';
    }

    // Deleting inside the text types; deleting across the edge merges blocks.
    const input = this.caretInput();

    if (key === 'Backspace' && input !== null) {
      return isCaretAtStartOfInput(input) ? 'merge' : 'typing';
    }

    if (key === 'Delete' && input !== null && !isCaretAtEndOfInput(input)) {
      return 'typing';
    }

    if (key === 'Enter' && input !== null && !event.altKey) {
      return this.enterKind(event);
    }

    return 'discrete';
  }

  /**
   * Enter with a collapsed caret in a block input. In code it types a newline
   * (Notion U153); elsewhere Shift+Enter types a soft break (U032) and Enter
   * splits the block.
   * @param event - the keydown
   */
  private enterKind(event: KeyboardEvent): GestureKind {
    const lineBreaks = this.caretBlock()?.tool.isLineBreaksEnabled === true;

    if (lineBreaks) {
      return event.shiftKey ? 'discrete' : 'typing';
    }

    return event.shiftKey ? 'typing' : 'split';
  }

  /**
   * The block holding a collapsed caret, or undefined
   */
  private caretBlock(): Block | undefined {
    const selection = window.getSelection();

    if (selection === null || !selection.isCollapsed || selection.anchorNode === null) {
      return undefined;
    }

    return this.Blok.BlockManager.getBlockByChildNode(selection.anchorNode);
  }

  /**
   * The input holding a collapsed caret, or null
   */
  private caretInput(): HTMLElement | null {
    const anchor = window.getSelection()?.anchorNode ?? null;

    return this.caretBlock()?.inputs.find((input) => input.contains(anchor)) ?? null;
  }

  /**
   * While the block menu is open, its search typing and its pick continue the
   * step that opened it (the "/" or the plus button).
   */
  private isToolboxOpen(): boolean {
    return this.wrapperElement?.hasAttribute(DATA_ATTR.toolboxOpened) === true;
  }

  /**
   * Whether the gesture belongs to this editor: its target is inside the
   * editor, or the caret is (for the toolbar and menus mounted on the body).
   * A target in a nested editor is that editor's, wherever the caret is.
   * @param event - the event that starts the gesture
   */
  private owns(event: Event): boolean {
    if (event.target instanceof Node && this.wrapperElement?.contains(event.target) === true) {
      return this.isInsideWrapper(event.target);
    }

    const anchor = window.getSelection()?.anchorNode ?? null;

    return (anchor !== null && this.isInsideWrapper(anchor)) || this.isInsideOutsideTitle(event.target);
  }

  /**
   * The page title can be mounted outside the wrapper (`pageTitle.holder`).
   * Without its own gesture, a title step takes its caret-before after the edit.
   * @param target - the event target
   */
  private isInsideOutsideTitle(target: EventTarget | null): boolean {
    const title = this.Blok.PageTitle?.titleElement ?? null;

    return title !== null && target instanceof Node && title.contains(target) && this.wrapperElement?.contains(title) !== true;
  }

  /**
   * In navigation mode focus sits on the page body with no caret, and the keys
   * act on this editor's selected blocks. Only a key aimed at the body: one
   * typed into a menu field must not close the step, nor may a click.
   * @param event - the keydown
   */
  private ownsNavigationKey(event: Event): boolean {
    return event.target === document.body && this.Blok.BlockSelection.anyBlockSelected;
  }

  /**
   * A node inside another editor nested in this one (a database card page)
   * belongs to that editor: its gestures must not close this editor's step.
   * @param target - an event target or node
   */
  private isInsideWrapper(target: EventTarget | null): boolean {
    if (!(target instanceof Node) || this.wrapperElement === null || !this.wrapperElement.contains(target)) {
      return false;
    }

    const element = target instanceof Element ? target : target.parentElement;

    return element?.closest(`[${DATA_ATTR.editor}]`) === this.wrapperElement;
  }
}
