/**
 * Describes API module allowing to access some Blok UI elements and methods
 */
export interface Ui {
  /**
   * Allows accessing some Blok UI elements
   */
  nodes: UiNodes,
}

/**
 * Allows accessing some Blok UI elements
 */
export interface UiNodes {
  /**
   * Top-level blok instance wrapper
   */
  wrapper: HTMLElement,

  /**
   * Element that holds all the Blocks
   */
  redactor: HTMLElement,
}
