/**
 * Use local module for notifications
 */
import type { ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions, NotifierPosition } from './notifier/types';
import { DEFAULT_NOTIFIER_POSITION } from './notifier/types';

type NotifierModule = {
  show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions, position?: NotifierPosition, directionSource?: Element) => void;
  dismiss: (options: NotifierOptions) => void;
  resolve: (options: NotifierOptions, message: string) => void;
  isClosed: (options: NotifierOptions) => boolean;
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
   * Default position for notifications
   */
  private position: NotifierPosition;

  /**
   * @param position - notification container position
   * @param getDirectionSource - returns the editor element whose direction toasts take
   */
  constructor(
    position: NotifierPosition = DEFAULT_NOTIFIER_POSITION,
    private readonly getDirectionSource?: () => Element | null | undefined
  ) {
    this.position = position;
  }

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
        const source = this.getDirectionSource?.();

        if (source === undefined || source === null) {
          notifier.show(options, this.position);
        } else {
          notifier.show(options, this.position, source);
        }
      })
      .catch((error) => {
        console.error('[Blok] Failed to display notification. Reason:', error);
      });
  }

  /**
   * Close the toast shown with this options object, if still open.
   * @param options - the object passed to `show`
   */
  public dismiss(options: NotifierOptions): void {
    void this.loadNotifierModule()
      .then((notifier) => {
        notifier.dismiss(options);
      })
      .catch((error) => {
        console.error('[Blok] Failed to dismiss notification. Reason:', error);
      });
  }

  /**
   * Show the success state on the card shown with this options object, then close it.
   * @param options - the object passed to `show`
   * @param message - plain text
   */
  public resolve(options: NotifierOptions, message: string): void {
    void this.loadNotifierModule()
      .then((notifier) => {
        notifier.resolve(options, message);
      })
      .catch((error) => {
        console.error('[Blok] Failed to update notification. Reason:', error);
      });
  }

  /**
   * @param options - the object passed to `show`
   * @returns true once that toast was drawn and has closed
   */
  public isClosed(options: NotifierOptions): boolean {
    return this.notifierModule?.isClosed(options) ?? false;
  }

  /**
   * Narrow unknown module to notifier module shape
   * @param {unknown} candidate - module to verify
   */
  private isNotifierModule(candidate: unknown): candidate is NotifierModule {
    return typeof candidate === 'object' && candidate !== null && 'show' in candidate && typeof (candidate as { show?: unknown }).show === 'function';
  }
}
