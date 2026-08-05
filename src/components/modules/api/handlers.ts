import type { Handlers, LiveHandlers } from '../../../../types/api';
import { Module } from '../../__module';
import { isFunction } from '../../utils';

/**
 * @class HandlersAPI
 *
 * Runtime setter for the editor's live callback config (`onChange`, `onSave`,
 * `onEnter`, `onSubmit`, `onBeforeRender`, `onAfterRender`).
 *
 * The core already consults every one of these on the shared config object at
 * the moment it needs them — per keypress, per change batch, per render — and
 * for several the PRESENCE of a function is the semantics (an `onSubmit` turns
 * Enter into serialize-and-submit; an `onSave` arms the change pipeline). What
 * was missing was a way to write that object after boot: core spread-copies the
 * config it is constructed with, so a host mutating its own object changes
 * nothing. Without this setter, a framework adapter had to decide callback
 * presence once, at construction, and destroy/recreate the editor to change it.
 */
export class HandlersAPI extends Module {
  /**
   * Available methods
   * @returns {Handlers}
   */
  public get methods(): Handlers {
    return {
      set: (handlers: LiveHandlers): void => this.set(handlers),
    };
  }

  /**
   * Installs, replaces or removes live editor callbacks in place.
   *
   * Only keys PRESENT on the passed object are touched, so a caller can flip one
   * handler without knowing about the others. A key whose value is `undefined`
   * (or anything non-callable) unsets the handler — the clearing direction is
   * what keeps callback presence genuinely reactive instead of a one-way latch.
   * @param handlers - partial map of live handlers to install or unset
   */
  public set(handlers: LiveHandlers): void {
    const apply = <K extends keyof LiveHandlers>(key: K): void => {
      if (!(key in handlers)) {
        return;
      }

      const value = handlers[key];

      this.config[key] = isFunction(value) ? value : undefined;
    };

    apply('onChange');
    apply('onSave');
    apply('onEnter');
    apply('onSubmit');
    apply('onBeforeRender');
    apply('onAfterRender');
  }
}
