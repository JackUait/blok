/**
 * Use external package module for notifications
 * @see https://github.com/codex-team/js-notifier
 */
import type { ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions } from 'codex-notifier';

type CodexNotifierModule = {
  show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void;
};

/**
 * Util for showing notifications
 */
export default class Notifier {
  /**
   * Cached notifier module instance
   */
  private notifierModule: CodexNotifierModule | null = null;

  /**
   * Promise used to avoid multiple parallel loads of the notifier module
   */
  private loadingPromise: Promise<CodexNotifierModule> | null = null;

  /**
   * Lazily load codex-notifier only when necessary.
   * @returns {Promise<CodexNotifierModule>} loaded notifier module
   */
  private loadNotifierModule(): Promise<CodexNotifierModule> {
    if (this.notifierModule !== null) {
      return Promise.resolve(this.notifierModule);
    }

    if (this.loadingPromise === null) {
      this.loadingPromise = import('codex-notifier')
        .then((module) => {
          const resolvedModule = (module?.default ?? module) as unknown;

          if (!this.isNotifierModule(resolvedModule)) {
            throw new Error('codex-notifier module does not expose a "show" method.');
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
        console.error('[Editor.js] Failed to display notification. Reason:', error);
      });
  }

  /**
   * Narrow unknown module to codex-notifier module shape
   * @param {unknown} candidate - module to verify
   */
  private isNotifierModule(candidate: unknown): candidate is CodexNotifierModule {
    return typeof candidate === 'object' && candidate !== null && 'show' in candidate && typeof (candidate as { show?: unknown }).show === 'function';
  }
}
