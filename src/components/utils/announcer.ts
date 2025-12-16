/**
 * @module Announcer
 * @description Provides screen reader announcements via ARIA live regions
 * Following WAI-ARIA best practices for dynamic content updates
 */

const ARIA_LIVE_REGION_ID = 'blok-announcer';

/**
 * Tailwind sr-only pattern for visually hiding content while keeping it accessible
 */
const SR_ONLY_CLASSES = [
  'absolute',
  'w-px',
  'h-px',
  'p-0',
  '-m-px',
  'overflow-hidden',
  '[clip:rect(0,0,0,0)]',
  'whitespace-nowrap',
  'border-0',
].join(' ');

interface AnnouncerConfig {
  /** Politeness level: 'polite' for non-critical, 'assertive' for important */
  politeness?: 'polite' | 'assertive';
  /** Clear announcement after this many milliseconds (default: 1000) */
  clearAfter?: number;
}

/**
 * Singleton class that manages an ARIA live region for screen reader announcements
 * Supports multiple Blok instances on the same page via reference counting
 */
class Announcer {
  /**
   * Singleton instance
   */
  private static instance: Announcer | null = null;

  /**
   * Reference count for multi-instance support
   * Tracks how many Blok instances are using this announcer
   */
  private static referenceCount = 0;

  /**
   * The ARIA live region element
   */
  private liveRegion: HTMLElement | null = null;

  /**
   * Timeout for clearing announcement
   */
  private clearTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Private constructor for singleton
   */
  private constructor() {
    this.createLiveRegion();
  }

  /**
   * Get singleton instance and increment reference count
   */
  public static getInstance(): Announcer {
    if (!Announcer.instance) {
      Announcer.instance = new Announcer();
    }

    return Announcer.instance;
  }

  /**
   * Increment reference count when a Blok instance starts using the announcer
   */
  public static addReference(): void {
    Announcer.referenceCount++;
  }

  /**
   * Creates the ARIA live region element
   * Uses sr-only pattern to hide from sighted users while remaining accessible
   */
  private createLiveRegion(): void {
    // Check if already exists (multiple Blok instances on same page)
    const existingRegion = document.getElementById(ARIA_LIVE_REGION_ID);

    if (existingRegion) {
      this.liveRegion = existingRegion;

      return;
    }

    const region = document.createElement('div');

    region.id = ARIA_LIVE_REGION_ID;
    region.className = SR_ONLY_CLASSES;
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('data-blok-announcer', '');

    document.body.appendChild(region);

    this.liveRegion = region;
  }

  /**
   * Announce a message to screen readers
   * @param message - The message to announce
   * @param config - Configuration options
   */
  public announce(message: string, config: AnnouncerConfig = {}): void {
    const { politeness = 'polite', clearAfter = 1000 } = config;

    // Ensure live region exists (defensive, should always exist after constructor)
    if (!this.liveRegion) {
      this.createLiveRegion();
    }

    // Guard against edge case where createLiveRegion fails
    if (!this.liveRegion) {
      return;
    }

    // Clear any pending timeout
    if (this.clearTimeoutId !== null) {
      clearTimeout(this.clearTimeoutId);
    }

    // Update politeness level
    this.liveRegion.setAttribute('aria-live', politeness);

    // Clear then set to ensure announcement triggers even if same message
    this.liveRegion.textContent = '';

    // Use requestAnimationFrame to ensure DOM update before setting new content
    requestAnimationFrame(() => {
      if (this.liveRegion) {
        this.liveRegion.textContent = message;
      }
    });

    // Clear after delay to prepare for next announcement
    this.clearTimeoutId = setTimeout(() => {
      if (this.liveRegion) {
        this.liveRegion.textContent = '';
      }
    }, clearAfter);
  }

  /**
   * Clean up the live region
   * Only removes the DOM element when all references are released
   */
  public destroy(): void {
    Announcer.referenceCount--;

    // Only clean up when last reference is released
    if (Announcer.referenceCount > 0) {
      return;
    }

    if (this.clearTimeoutId !== null) {
      clearTimeout(this.clearTimeoutId);
      this.clearTimeoutId = null;
    }

    if (this.liveRegion) {
      this.liveRegion.remove();
      this.liveRegion = null;
    }

    Announcer.instance = null;
  }
}

/**
 * Announce a message to screen readers
 * @param message - The message to announce
 * @param config - Configuration options
 */
export const announce = (message: string, config?: AnnouncerConfig): void => {
  Announcer.getInstance().announce(message, config);
};

/**
 * Register a Blok instance as using the announcer
 * Call this when a Blok instance is created
 */
export const registerAnnouncer = (): void => {
  Announcer.addReference();
  // Ensure instance is created
  Announcer.getInstance();
};

/**
 * Clean up the announcer and remove the live region
 * Only removes the DOM element when all Blok instances have been destroyed
 */
export const destroyAnnouncer = (): void => {
  Announcer.getInstance().destroy();
};
