import type { Notifier as INotifier } from '../../../../types/api';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { Notifier } from '../../utils/notifier';
import type { ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions } from '../../utils/notifier/types';

/**
 *
 */
export class NotifierAPI extends Module {
  /**
   * Notifier utility Instance
   */
  private notifier: Notifier;

  /**
   * @param moduleConfiguration - Module Configuration
   * @param moduleConfiguration.config - Blok's config
   * @param moduleConfiguration.eventsDispatcher - Blok's event dispatcher
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({
      config,
      eventsDispatcher,
    });

    this.notifier = new Notifier();
  }

  /**
   * Available methods
   */
  public get methods(): INotifier {
    return {
      show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void => this.show(options),
    };
  }

  /**
   * Show notification
   * @param {NotifierOptions} options - message option
   */
  public show(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions): void {
    return this.notifier.show(options);
  }
}
