/**
 * Position of the notification container on screen.
 * - 'bottom-left' (default)
 * - 'bottom-right'
 * - 'bottom-center'
 * - 'top-left'
 * - 'top-right'
 * - 'top-center'
 */
export type NotifierPosition = 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-left' | 'top-right' | 'top-center';

/**
 * A button on an alert toast. A toast with actions stays until closed.
 */
export interface NotifierAction {
  label: string;
  onClick(): void;

  /**
   * The main action: drawn as a solid button.
   */
  primary?: boolean;

  /**
   * The click starts work: the button shows a spinner until the toast changes.
   */
  busyOnClick?: boolean;
}

/**
 * Base options interface for notifications
 */
export interface NotifierOptions {
  /**
   * Notification message (can contains HTML)
   */
  message: string;

  /**
   * Type of notification:
   * - 'alert' (default)
   * - 'confirm'
   * - 'prompt'
   */
  type?: string;

  /**
   * We have some default styles: 'success' and 'error'
   */
  style?: string;

  /**
   * Notification expire time in ms (8s by default)
   * Only 'alert' notifies expires
   */
  time?: number;

  /**
   * Buttons on an alert toast. With any, the toast does not expire and shows a close button.
   */
  actions?: NotifierAction[];

  /**
   * Accessible label of the close button shown with `actions`.
   */
  dismissText?: string;

  /**
   * A muted second line under the message. Plain text.
   */
  detail?: string;

  /**
   * Image tiles on a toast with `actions`, up to 3 drawn. Each is a `blob:` or
   * `data:image/` URL; `null` (or any other URL) draws a broken-image glyph.
   */
  thumbnails?: (string | null)[];
}

/**
 * Confirm notification options
 */
export interface ConfirmNotifierOptions extends NotifierOptions {
  /**
   * Text for confirmation button
   * 'Confirm' by default
   */
  okText?: string;

  /**
   * Confirm button pressing callback
   * @param {Event} event
   */
  okHandler?: (event: Event) => void;

  /**
   * Text for cancel button
   * 'Cancel' by default
   */
  cancelText?: string;

  /**
   * Cancel button or cross button pressing callback
   * @param {Event} event
   */
  cancelHandler?: (event: Event) => void;
}

/**
 * Prompt notification options
 */
export interface PromptNotifierOptions extends NotifierOptions {
  /**
   * Text for the Submit button
   * 'OK' by default
   */
  okText?: string;

  /**
   * Submit button pressing callback
   * Gets input's value as a parameter
   * @param {string} value
   */
  okHandler: (value: string) => void;

  /**
   * Text for the cancel button
   * 'Cancel' by default
   */
  cancelText?: string;

  /**
   * Cross button pressing callback
   * @param {Event} event
   */
  cancelHandler?: (event: Event) => void;

  /**
   * Type of input
   * 'text' by default
   */
  inputType?: string;

  /**
   * Input placeholder
   */
  placeholder?: string;

  /**
   * Input default value
   */
  default?: string;
}
