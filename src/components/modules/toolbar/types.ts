import type { Block } from '../../block';

/**
 * HTML Elements used for Toolbar UI
 */
export interface ToolbarNodes {
  wrapper: HTMLElement | undefined;
  content: HTMLElement | undefined;
  actions: HTMLElement | undefined;
  plusButton: HTMLElement | undefined;
  settingsToggler: HTMLElement | undefined;
  /**
   * Index signature to satisfy ModuleNodes constraint
   */
  [key: string]: unknown;
}

/**
 * Options for positioning the toolbar
 */
export interface PositioningOptions {
  /**
   * The block to position the toolbar near
   */
  targetBlock: Block;
  /**
   * Optional target element that was hovered (for content offset calculation)
   */
  hoveredTarget: Element | null;
  /**
   * Whether the current view is mobile
   */
  isMobile: boolean;
}

/**
 * Options for the click-vs-drag handler
 */
export interface ClickHandlerOptions {
  /**
   * Function called before click callback.
   * Return false to abort the click.
   */
  beforeCallback?: () => boolean;
}
