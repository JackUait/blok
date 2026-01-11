import type { CollapsedExitRecord } from './types';

/**
 * Singleton handler for managing collapsed bold exit state.
 * When user toggles bold off with a collapsed caret, this tracks
 * the boundary where subsequent typing should appear.
 */
export class CollapsedBoldExitHandler {
  private static instance: CollapsedBoldExitHandler | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): CollapsedBoldExitHandler {
    if (!CollapsedBoldExitHandler.instance) {
      CollapsedBoldExitHandler.instance = new CollapsedBoldExitHandler();
    }

    return CollapsedBoldExitHandler.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    CollapsedBoldExitHandler.instance = null;
  }

  /**
   * Check if there are any active exit records
   */
  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }
}
