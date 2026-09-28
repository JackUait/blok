/**
 * Tracks whether the user has driven a surface with the keyboard since it opened.
 *
 * Where focus sits is NOT that signal: opening a submenu moves focus into it by
 * itself (its search field, or its first row in keyboard modality). A pointer
 * close that treats "focus is inside" as "the keyboard is in use" can never
 * close a menu that focused itself, and the trigger row stays lit forever.
 *
 * Engaged means: the surface was opened by the keyboard, or a key was pressed
 * while focus was inside it.
 */
export class KeyboardEngagement {
  private engaged: boolean;

  /**
   * Capture on window: Flipper stops propagation of the keys it owns, and
   * window capture runs before every other listener.
   * @param event - any keydown on the page
   */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.target instanceof Node && this.root.contains(event.target)) {
      this.engaged = true;
    }
  };

  /**
   * @param root - the surface whose keyboard use is tracked
   * @param openedByKeyboard - true when a key press opened it
   */
  constructor(private readonly root: HTMLElement, openedByKeyboard: boolean) {
    this.engaged = openedByKeyboard;
    window.addEventListener('keydown', this.onKeydown, true);
  }

  /**
   * @returns true once the user has used the keyboard in the surface
   */
  public get isEngaged(): boolean {
    return this.engaged;
  }

  /**
   * Stops tracking. Call when the surface closes.
   */
  public destroy(): void {
    window.removeEventListener('keydown', this.onKeydown, true);
  }
}
