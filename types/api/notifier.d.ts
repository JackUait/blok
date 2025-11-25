import {ConfirmNotifierOptions, NotifierOptions, PromptNotifierOptions} from '../configs/notifier';

/**
 * Notifier API
 */
export interface Notifier {

  /**
   * Show web notification
   *
   * @param {NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions}
   */
  show: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void;
}
