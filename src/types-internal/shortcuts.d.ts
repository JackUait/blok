/**
 * Declaration for external JS module
 * After that we can use it at the TS modules
 */
declare module '@codexteam/shortcuts' {
  interface ShortcutOptions {
    /**
     * Shortcut name (e.g., 'CMD+K', 'CMD+B')
     */
    name: string;

    /**
     * Element to attach the shortcut to
     */
    on: HTMLElement | Document;

    /**
     * Callback function to execute when shortcut is triggered
     */
    callback: (event: KeyboardEvent) => void;
  }

  /**
   * Shortcut class for handling keyboard shortcuts
   */
  export class Shortcut {
    /**
     * Shortcut name
     */
    public name: string;

    /**
     * Creates a new Shortcut instance
     */
    constructor(options: ShortcutOptions);

    /**
     * Removes the shortcut event listener
     */
    public remove(): void;
  }

  /**
   * Default export
   */
  export default Shortcut;
}

