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
   * Observer to add data-testid to notifications
   */
  private observer: MutationObserver | null = null;

  /**
   * Start observing notifications to add data-testid for testing purposes
   */
  private startObserver(): void {
    if (this.observer || typeof MutationObserver === 'undefined') {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('cdx-notifies')) {
              node.setAttribute('data-testid', 'notifier-container');
            }
            if (node.classList.contains('cdx-notify')) {
              this.addTestId(node);
            }

            const notifications = node.querySelectorAll('.cdx-notify');

            notifications.forEach((n) => this.addTestId(n as HTMLElement));
          }
        });
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Add data-testid to notification element based on its class
   * @param node - notification element
   */
  private addTestId(node: HTMLElement): void {
    if (node.classList.contains('cdx-notify--success')) {
      node.setAttribute('data-testid', 'notification-success');
    } else if (node.classList.contains('cdx-notify--error')) {
      node.setAttribute('data-testid', 'notification-error');
    } else {
      node.setAttribute('data-testid', 'notification');
    }

    const confirmBtn = node.querySelector('.cdx-notify__button--confirm');

    if (confirmBtn) {
      confirmBtn.setAttribute('data-testid', 'notification-confirm-button');
    }
    const cancelBtn = node.querySelector('.cdx-notify__button--cancel');

    if (cancelBtn) {
      cancelBtn.setAttribute('data-testid', 'notification-cancel-button');
    }
  }

  /**
   * Destroy observer
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Show web notification
   * @param {NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions} options - notification options
   */
  public show(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void {
    this.startObserver();

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
