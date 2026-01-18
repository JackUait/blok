/**
 * Result of selection validation
 */
export interface SelectionValidationResult {
  /** Whether the inline toolbar can be shown */
  allowed: boolean;
  /** Optional reason for disallowing (useful for debugging) */
  reason?: string;
}

/**
 * Options for positioning the inline toolbar
 */
export interface InlinePositioningOptions {
  /** Wrapper element to position */
  wrapper: HTMLElement;
  /** Selection rectangle */
  selectionRect: DOMRect;
  /** Wrapper offset rectangle */
  wrapperOffset: DOMRect;
  /** Content area bounds */
  contentRect: DOMRect;
  /** Popover width */
  popoverWidth: number;
}

/**
 * Inline toolbar nodes
 */
export interface InlineToolbarNodes {
  wrapper: HTMLElement | undefined;
  /**
   * Index signature to satisfy ModuleNodes constraint
   */
  [key: string]: unknown;
}
