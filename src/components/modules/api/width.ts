import type { Width } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * API module for editor-level width mode control.
 */
export class WidthAPI extends Module {
  public get methods(): Width {
    const widthManager = this.Blok.WidthManager;

    return {
      get: () => widthManager.getWidth(),
      set: (mode) => widthManager.setWidth(mode),
      toggle: () => widthManager.toggle(),
    };
  }
}
