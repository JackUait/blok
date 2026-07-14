/**
 * @module Announcer
 * @description Provides screen reader announcements via ARIA live regions
 * Following WAI-ARIA best practices for dynamic content updates
 */

const POLITE_REGION_ID = 'blok-announcer';
const ASSERTIVE_REGION_ID = 'blok-announcer-assertive';

/**
 * How long (ms) a message is left in place before the queue advances to the
 * next one. Gives assistive technology time to pick the message up while
 * keeping rapid successive announcements flowing in order.
 */
const MESSAGE_SETTLE_MS = 150;

/**
 * Visually-hidden (sr-only) styling, applied INLINE.
 *
 * The live region is mounted on document.body — OUTSIDE Blok's interface roots
 * ([data-blok-interface] / [data-blok-popover]). Blok's compiled Tailwind
 * utilities are scoped to only match inside those roots (see
 * scripts/scope-utilities), so `.sr-only`-style utility CLASSES silently stop
 * applying here and the region renders full-width. Inline styles carry the
 * hiding with the element wherever it lives, independent of that scoping.
 */
const SR_ONLY_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: '0',
};

type Politeness = 'polite' | 'assertive';

interface AnnouncerConfig {
  /** Politeness level: 'polite' for non-critical, 'assertive' for important */
  politeness?: Politeness;
  /** Clear announcement after this many milliseconds (default: 1000) */
  clearAfter?: number;
}

interface QueuedAnnouncement {
  message: string;
  politeness: Politeness;
  clearAfter: number;
}

/**
 * Singleton class that manages ARIA live regions for screen reader announcements.
 *
 * Uses two dedicated regions — a polite `role=status` region and an assertive
 * `role=alert` region — instead of flipping `aria-live` on a single region.
 * Announcements are serialized through a FIFO queue so rapid successive
 * (and mixed-politeness) messages don't clobber each other.
 *
 * Supports multiple Blok instances on the same page via reference counting.
 */
class Announcer {
  /**
   * Singleton instance
   */
  private static instance: Announcer | null = null;

  /**
   * Reference count for multi-instance support.
   * Tracks how many Blok instances are using this announcer.
   */
  private static referenceCount = 0;

  /**
   * The polite ARIA live region (role=status)
   */
  private politeRegion: HTMLElement | null = null;

  /**
   * The assertive ARIA live region (role=alert)
   */
  private assertiveRegion: HTMLElement | null = null;

  /**
   * FIFO queue of pending announcements
   */
  private queue: QueuedAnnouncement[] = [];

  /**
   * Whether the queue is currently being drained
   */
  private isProcessing = false;

  /**
   * Pending timeouts, tracked so they can be cleared on destroy
   */
  private timeoutIds: Set<ReturnType<typeof setTimeout>> = new Set();

  /**
   * Private constructor for singleton
   */
  private constructor() {
    this.politeRegion = this.createLiveRegion(POLITE_REGION_ID, 'status', 'polite');
    this.assertiveRegion = this.createLiveRegion(ASSERTIVE_REGION_ID, 'alert', 'assertive');
  }

  /**
   * Get singleton instance
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
   * Release a reference. Clamped so it can never underflow below zero, then
   * tears down the shared instance once the last reference is released.
   */
  public static release(): void {
    if (!Announcer.instance) {
      return;
    }

    Announcer.referenceCount = Math.max(0, Announcer.referenceCount - 1);

    if (Announcer.referenceCount > 0) {
      return;
    }

    Announcer.instance.destroy();
    Announcer.instance = null;
  }

  /**
   * Creates an ARIA live region element, reusing an existing one if present
   * (multiple Blok instances on the same page).
   * Uses sr-only pattern to hide from sighted users while remaining accessible.
   */
  private createLiveRegion(id: string, role: string, politeness: Politeness): HTMLElement {
    const existingRegion = document.getElementById(id);

    if (existingRegion) {
      return existingRegion;
    }

    const region = document.createElement('div');

    region.id = id;
    Object.assign(region.style, SR_ONLY_STYLE);
    region.setAttribute('role', role);
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('data-blok-announcer', '');

    document.body.appendChild(region);

    return region;
  }

  /**
   * Announce a message to screen readers
   * @param message - The message to announce
   * @param config - Configuration options
   */
  public announce(message: string, config: AnnouncerConfig = {}): void {
    const { politeness = 'polite', clearAfter = 1000 } = config;

    this.queue.push({
      message,
      politeness,
      clearAfter,
    });

    this.processQueue();
  }

  /**
   * Drains the queue one message at a time. Each message clears its target
   * region, writes the message on the next frame, then advances to the next
   * queued message after a short settle delay so nothing gets clobbered.
   */
  private processQueue(): void {
    if (this.isProcessing) {
      return;
    }

    const item = this.queue.shift();

    if (!item) {
      return;
    }

    const region = item.politeness === 'assertive' ? this.assertiveRegion : this.politeRegion;

    if (!region) {
      return;
    }

    this.isProcessing = true;

    // Clear then set on a tracked macrotask (not requestAnimationFrame, which is
    // absent in non-DOM/torn-down environments and cannot be cancelled on destroy)
    // so re-announcing the same text still fires.
    region.textContent = '';

    this.schedule(() => {
      region.textContent = item.message;

      // Blank the region after the caller-specified delay.
      this.schedule(() => {
        region.textContent = '';
      }, item.clearAfter);

      // Advance to the next queued message once this one has settled.
      this.schedule(() => {
        this.isProcessing = false;
        this.processQueue();
      }, MESSAGE_SETTLE_MS);
    }, 0);
  }

  /**
   * Schedules a tracked timeout so it can be cleaned up on destroy.
   */
  private schedule(callback: () => void, delay: number): void {
    const id = setTimeout(() => {
      this.timeoutIds.delete(id);
      callback();
    }, delay);

    this.timeoutIds.add(id);
  }

  /**
   * Clean up the live regions and pending work.
   */
  public destroy(): void {
    this.timeoutIds.forEach((id) => clearTimeout(id));
    this.timeoutIds.clear();

    this.queue = [];
    this.isProcessing = false;

    if (this.politeRegion) {
      this.politeRegion.remove();
      this.politeRegion = null;
    }

    if (this.assertiveRegion) {
      this.assertiveRegion.remove();
      this.assertiveRegion = null;
    }
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
  // Ensure instance (and its live regions) exist
  Announcer.getInstance();
};

/**
 * Clean up the announcer and remove the live regions.
 * Only removes the DOM elements when all Blok instances have been destroyed.
 * Does nothing when no instance exists (never lazily creates one just to destroy it).
 */
export const destroyAnnouncer = (): void => {
  Announcer.release();
};
