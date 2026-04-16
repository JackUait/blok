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

    this.builtInNotifier = new Notifier(config.notifierPosition ?? DEFAULT_NOTIFIER_POSITION);
    this.customNotifier = (config as { notifier?: (opts: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void }).notifier;
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
   * Show notification — delegates to custom handler if provided, else built-in
   * @param {NotifierOptions} options - message option
   */
  public show(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void {
    if (this.customNotifier !== undefined) {
      this.customNotifier(options);
      return;
    }

    this.builtInNotifier.show(options);
  }
}
