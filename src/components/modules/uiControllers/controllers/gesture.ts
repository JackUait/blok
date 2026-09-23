import { DATA_ATTR } from '../../../constants';
import { isCaretAtEndOfInput, isCaretAtStartOfInput } from '../../../utils/caret/boundaries';

import { Controller } from './_base';

/** Keys that neither edit nor act: they never start a gesture. */
const PASSIVE_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'Process', 'Dead', 'Unidentified',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);

/** Input types that continue a typing run; `historyUndo`/`historyRedo` are left to the keyboard router. */
const TYPING_INPUT_TYPES = new Set(['insertText', 'insertReplacementText', 'deleteContentBackward', 'deleteContentForward']);
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
    if (!(event instanceof KeyboardEvent) || event.isComposing || this.isToolboxOpen() || !this.owns(event)) {
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
    if (this.owns(event)) {
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
    if (!this.pointerHeld && this.isInsideWrapper(event.target)) {
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
  private keyKind(event: KeyboardEvent): 'typing' | 'discrete' | null {
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

    if (key === 'Backspace' && input !== null && !isCaretAtStartOfInput(input)) {
      return 'typing';
    }

    if (key === 'Delete' && input !== null && !isCaretAtEndOfInput(input)) {
      return 'typing';
    }

    return 'discrete';
  }

  /**
   * The input holding a collapsed caret, or null
   */
  private caretInput(): HTMLElement | null {
    const selection = window.getSelection();

    if (selection === null || !selection.isCollapsed || selection.anchorNode === null) {
      return null;
    }

    const block = this.Blok.BlockManager.getBlockByChildNode(selection.anchorNode);

    return block?.inputs.find((input) => input.contains(selection.anchorNode)) ?? null;
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
   * @param event - the event that starts the gesture
   */
  private owns(event: Event): boolean {
    if (this.isInsideWrapper(event.target)) {
      return true;
    }

    const anchor = window.getSelection()?.anchorNode ?? null;

    return anchor !== null && this.isInsideWrapper(anchor);
  }

  /**
   * @param target - an event target or node
   */
  private isInsideWrapper(target: EventTarget | null): boolean {
    return target instanceof Node && this.wrapperElement !== null && this.wrapperElement.contains(target);
  }
}
