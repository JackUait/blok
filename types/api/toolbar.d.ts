/**
 * Options for closing the toolbar
 */
export interface ToolbarCloseOptions {
  /**
   * Whether to mark toolbar as explicitly closed (prevents hover reopen).
   * Default: true
   */
  setExplicitlyClosed?: boolean;
}

/**
 * Overrides for BlockSettings popover placement
 */
export interface ToolbarBlockSettingsOptions {
  /**
   * When true, the popover opens to the left of its anchor (default).
   * Set to false to open to the right instead.
   */
  placeLeftOfAnchor?: boolean;
}

/**
 * Describes Toolbar API methods
 */
export interface Toolbar {
  /**
   * Closes Toolbar
   * @param options - Optional configuration
   */
  close(options?: ToolbarCloseOptions): void;

  /**
   * Opens Toolbar
   */
  open(): void;

  /**
   * Toggles Block Setting of the current block
   * @param {boolean} openingState —  opening state of Block Setting
   * @param {HTMLElement} trigger — element to anchor the settings popover to
   * @param {ToolbarBlockSettingsOptions} options — additional popover placement overrides
   */
  toggleBlockSettings(openingState?: boolean, trigger?: HTMLElement, options?: ToolbarBlockSettingsOptions): void;

  /**
   * Toggle toolbox
   * @param {boolean} openingState —  opening state of the toolbox
   */
  toggleToolbox(openingState?: boolean): void;

  /**
   * Runtime setter for `config.hideToolbar` (reactive contract).
   *
   * When hidden, the hover toolbar (plus button / drag handle) never opens and
   * the editor gutter reserved for it collapses (the wrapper's
   * `data-blok-toolbar-hidden` attribute is kept in sync). The keyboard "/"
   * menu keeps working.
   * @param hidden - true to hide the hover toolbar and collapse the gutter
   */
  setHidden(hidden: boolean): void;
}
