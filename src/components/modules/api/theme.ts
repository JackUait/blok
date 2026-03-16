import type { Theme } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * API module for theme mode control.
 */
export class ThemeAPI extends Module {
  public get methods(): Theme {
    const themeManager = this.Blok.ThemeManager;

    return {
      get: () => themeManager.getMode(),
      set: (mode) => themeManager.setMode(mode),
      getResolved: () => themeManager.getResolved(),
    };
  }
}
