import type { Notifier as INotifier } from '../../../../types/api';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { Notifier } from '../../utils/notifier';
import type { ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions } from '../../utils/notifier/types';
import { DEFAULT_NOTIFIER_POSITION } from '../../utils/notifier/types';

/**
 * Notifier API module — routes show() to the custom handler when the consumer
 * provides one in BlokConfig.notifier, otherwise falls back to the built-in notifier.
 */
export class NotifierAPI extends Module {
  /**
   * Built-in notifier utility instance (used only when no custom handler is provided)
   */
  private builtInNotifier: Notifier;

  /**
   * Optional consumer-provided notifier handler from BlokConfig
   */
  /**
   * The built-in notifier keys a toast by the object it was shown with; `show`
   * may send a copy, so `dismiss`/`resolve` must pass that copy back.
   */
  private readonly sentCopies = new WeakMap<NotifierOptions, NotifierOptions>();
  private readonly customNotifier:
    | ((options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void)
    | undefined;

  /**
   * @param moduleConfiguration - Module Configuration
   * @param moduleConfiguration.config - Blok's config
   * @param moduleConfiguration.eventsDispatcher - Blok's event dispatcher
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({ config, eventsDispatcher });

    // Toasts mount outside the editor, so they read its direction from the wrapper.
    this.builtInNotifier = new Notifier(config.notifierPosition ?? DEFAULT_NOTIFIER_POSITION, () => this.Blok.UI?.nodes.wrapper);
    this.customNotifier = config.notifier;
  }

  /**
   * Available methods
   */
  public get methods(): INotifier {
    return {
      show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void =>
        this.show(options),
    };
  }

  /**
   * Close a toast shown with this options object. A custom notifier cannot be closed from here.
   * @param options - the object passed to `show`
   */
  public dismiss(options: NotifierOptions): void {
    if (this.customNotifier === undefined) {
      this.builtInNotifier.dismiss(this.sentCopies.get(options) ?? options);
    }
  }

  /**
   * Show a card's success state, then close it. A custom notifier cannot be reached from here.
   * @param options - the object passed to `show`
   * @param message - plain text
   */
  public resolve(options: NotifierOptions, message: string): void {
    if (this.customNotifier === undefined) {
      this.builtInNotifier.resolve(this.sentCopies.get(options) ?? options, message);
    }
  }

  /**
   * @param options - the object passed to `show`
   * @returns true once that toast has closed; always true with a custom notifier, which cannot be closed from here
   */
  public isClosed(options: NotifierOptions): boolean {
    return this.customNotifier !== undefined || this.builtInNotifier.isClosed(this.sentCopies.get(options) ?? options);
  }

  /**
   * Show notification — delegates to custom handler if provided, else built-in
   * @param {NotifierOptions} options - message option
   */
  public show(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void {
    if (this.customNotifier !== undefined) {
      this.customNotifier(options);
      return;
    }

    if (options.type === 'confirm') {
      const confirmOptions = options as ConfirmNotifierOptions;

      this.builtInNotifier.show({
        ...confirmOptions,
        okText: confirmOptions.okText || this.Blok.I18n.t('notifier.confirm'),
        cancelText: confirmOptions.cancelText || this.Blok.I18n.t('notifier.cancel'),
      });

      return;
    }

    if (options.type === 'prompt') {
      const promptOptions = options as PromptNotifierOptions;

      this.builtInNotifier.show({
        ...promptOptions,
        okText: promptOptions.okText || this.Blok.I18n.t('notifier.ok'),
        cancelText: promptOptions.cancelText || this.Blok.I18n.t('notifier.cancel'),
      });

      return;
    }

    if (options.actions !== undefined && options.dismissText === undefined) {
      const sent = { ...options, dismissText: this.Blok.I18n.t('notifier.dismiss') };

      this.sentCopies.set(options, sent);
      this.builtInNotifier.show(sent);

      return;
    }

    this.builtInNotifier.show(options);
  }
}
