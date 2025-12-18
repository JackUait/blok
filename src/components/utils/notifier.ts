/**
 * Use local module for notifications
 */
import type { ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions } from './notifier/types';

type NotifierModule = {
  show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void;
};

/**
 * Util for showing notifications
 */
export class Notifier {
  /**
   * Cached notifier module instance
   */
  private notifierModule: NotifierModule | null = null;

  /**
   * Promise used to avoid multiple parallel loads of the notifier module
   */
  private loadingPromise: Promise<NotifierModule> | null = null;

  /**
   * Lazily load notifier only when necessary.
   * @returns {Promise<NotifierModule>} loaded notifier module
   */
  private loadNotifierModule(): Promise<NotifierModule> {
    if (this.notifierModule !== null) {
      return Promise.resolve(this.notifierModule);
    }

    if (this.loadingPromise === null) {
      this.loadingPromise = import('./notifier/index')
        .then((module) => {
          const resolvedModule = module as unknown;

          if (!this.isNotifierModule(resolvedModule)) {
            throw new Error('notifier module does not expose a "show" method.');
          }

          this.notifierModule = resolvedModule;

          return resolvedModule;
        })
        .catch((error) => {
          this.loadingPromise = null;

          throw error;
        });
    }

    return this.loadingPromise;
  }

  /**
   * Show web notification
   * @param {NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions} options - notification options
   */
  public show(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void {
    void this.loadNotifierModule()
      .then((notifier) => {
        notifier.show(options);
      })
      .catch((error) => {
        console.error('[Blok] Failed to display notification. Reason:', error);
      });
  }

  /**
   * Narrow unknown module to notifier module shape
   * @param {unknown} candidate - module to verify
   */
  private isNotifierModule(candidate: unknown): candidate is NotifierModule {
    return typeof candidate === 'object' && candidate !== null && 'show' in candidate && typeof (candidate as { show?: unknown }).show === 'function';
  }
}