import type { BlokModules } from '../../../../types-internal/blok-modules';

/**
 * InlineLifecycleManager coordinates initialization with retry logic.
 *
 * Responsibilities:
 * - Schedule initialization with requestIdleCallback
 * - Retry if UI wrapper not ready
 * - Mark as initialized
 * - Guard against duplicate scheduling
 */
export class InlineLifecycleManager {
  /**
   * Getter function to access Blok modules dynamically
   */
  private getBlok: () => BlokModules;

  /**
   * Callback to initialize the toolbar
   */
  private initialize: () => void;

  /**
   * Tracks whether inline toolbar DOM and shortcuts are initialized
   */
  private initialized = false;

  /**
   * Ensures we don't schedule multiple initialization attempts simultaneously
   */
  private initializationScheduled = false;

  constructor(
    getBlok: () => BlokModules,
    initialize: () => void
  ) {
    this.getBlok = getBlok;
    this.initialize = initialize;
  }

  /**
   * Check if initialized
   */
  public get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Mark as initialized
   */
  public markInitialized(): void {
    this.initialized = true;
  }

  /**
   * Check if scheduling is in progress
   */
  public get isScheduled(): boolean {
    return this.initializationScheduled;
  }

  /**
   * Schedule initialization with retry
   */
  public schedule(): void {
    if (this.initialized || this.initializationScheduled) {
      return;
    }

    this.initializationScheduled = true;

    const callback = (): void => {
      this.initializationScheduled = false;
      this.doInitialize();
    };

    const scheduleWithTimeout = (): void => {
      if (typeof window !== 'undefined') {
        window.setTimeout(callback, 0);
      } else {
        callback();
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        scheduleWithTimeout();
      }, { timeout: 2000 });
    } else {
      scheduleWithTimeout();
    }
  }

  /**
   * Ensures toolbar DOM and shortcuts are created
   */
  private doInitialize(): void {
    if (this.initialized) {
      return;
    }

    /**
     * Guard against race condition: the deferred callback from schedule()
     * can fire before UI module has created its wrapper element.
     * If UI isn't ready yet, reschedule and try again.
     */
    const { UI } = this.getBlok();

    if (UI?.nodes?.wrapper === undefined) {
      this.initializationScheduled = false;
      this.schedule();

      return;
    }

    this.initialize();
    this.initialized = true;
  }
}
