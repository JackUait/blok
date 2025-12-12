/**
 * Describes methods for work with Selections
 */
export interface Selection {
  /**
   * Looks ahead from selection and find passed tag with class name
   * @param {string} tagName - tag to find
   * @param {string} className - tag's class name
   * @return {HTMLElement|null}
   */
  findParentTag(tagName: string, className?: string): HTMLElement|null;

  /**
   * Expand selection to passed tag
   * @param {HTMLElement} node - tag that should contain selection
   */
  expandToTag(node: HTMLElement): void;

  /**
   * Sets fake background.
   * Allows to imitate selection while focus moved away
  */
  setFakeBackground(): void;

  /**
   * Removes fake background
   */
  removeFakeBackground(): void;

  /**
   * Clears all fake background state - both DOM elements and internal flags
   * This is useful for cleanup after undo/redo operations or when the selection context has been lost
   */
  clearFakeBackground(): void;

  /**
   * Save selection range.
   * Allows to save selection to be able to temporally move focus away.
   * Might be useful for inline tools
   */
  save(): void;

  /**
   * Restore saved selection range
   */
  restore(): void;
}
