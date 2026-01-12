import type { CollapsedExitRecord } from '../types';
import { ensureStrongElement, isElementEmpty, resolveBoundary } from '../utils/bold-dom-utils';

/**
 * Centralized data attributes for collapsed bold state tracking
 */
const ATTR = {
  COLLAPSED_LENGTH: 'data-blok-bold-collapsed-length',
  COLLAPSED_ACTIVE: 'data-blok-bold-collapsed-active',
  PREV_LENGTH: 'data-blok-bold-prev-length',
  LEADING_WHITESPACE: 'data-blok-bold-leading-ws',
} as const;

/**
 * Unified manager for collapsed bold selection behavior.
 * Consolidates enter/exit logic, typeahead absorption, and boundary guards.
 */
export class CollapsedBoldManager {
  private static instance: CollapsedBoldManager | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): CollapsedBoldManager {
    if (!CollapsedBoldManager.instance) {
      CollapsedBoldManager.instance = new CollapsedBoldManager();
    }

    return CollapsedBoldManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (CollapsedBoldManager.instance) {
      CollapsedBoldManager.instance.records.clear();
    }
    CollapsedBoldManager.instance = null;
  }

  /**
   * Check if there are any active exit records
   */
  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }

  /**
   * Check if an element is an active collapsed bold placeholder
   * Used by BoldNormalizationPass to avoid removing elements in use
   * @param element - The element to check
   */
  public isActivePlaceholder(element: HTMLElement): boolean {
    return element.getAttribute(ATTR.COLLAPSED_ACTIVE) === 'true' ||
           element.hasAttribute(ATTR.COLLAPSED_LENGTH);
  }

  /**
   * Get the ATTR constants for external use
   */
  public static get ATTR(): typeof ATTR {
    return ATTR;
  }
}
