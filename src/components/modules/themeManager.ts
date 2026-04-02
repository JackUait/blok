import type { ResolvedTheme, ThemeMode } from '../../../types/api/theme';
import { Module } from '../__module';

const DARK_MQ = '(prefers-color-scheme: dark)';
const ATTR = 'data-blok-theme';

/**
 * Module-level counter of active ThemeManager instances.
 * Prevents premature attribute cleanup when multiple Blok instances coexist.
 */
const state = { activeInstances: 0 };

/**
 * Reset the instance counter. Exported for testing only.
 */
export function resetActiveInstances(): void {
  state.activeInstances = 0;
}

/**
 * Manages the editor color theme.
 *
 * Sets `data-blok-theme` on `document.documentElement` to control
 * CSS custom property values for light/dark appearance.
 */
export class ThemeManager extends Module {
  private mode: ThemeMode = 'auto';
  private resolved: ResolvedTheme = 'light';
  private mediaQuery: MediaQueryList | null = null;
  private readonly onMediaChange = (e: MediaQueryListEvent): void => {
    const newResolved: ResolvedTheme = e.matches ? 'dark' : 'light';

    if (newResolved !== this.resolved) {
      this.resolved = newResolved;
      this.fireCallback();
    }
  };

  /**
   * Called by Core after all modules are constructed and wired.
   */
  public prepare(): void {
    state.activeInstances++;
    this.mode = this.config.theme ?? 'auto';
    this.applyAttribute();
    this.resolved = this.deriveResolved();

    if (this.mode === 'auto') {
      this.addMediaListener();
    }
  }

  /**
   * Returns the current theme mode.
   */
  public getMode(): ThemeMode {
    return this.mode;
  }

  /**
   * Returns the resolved theme, evaluating OS preference if in auto mode.
   */
  public getResolved(): ResolvedTheme {
    return this.resolved;
  }

  /**
   * Sets the theme mode at runtime.
   */
  public setMode(mode: ThemeMode): void {
    const prevResolved = this.resolved;

    if (this.mode === 'auto') {
      this.removeMediaListener();
    }

    this.mode = mode;
    this.applyAttribute();
    this.resolved = this.deriveResolved();

    if (this.mode === 'auto') {
      this.addMediaListener();
    }

    if (this.resolved !== prevResolved) {
      this.fireCallback();
    }
  }

  /**
   * Cleanup: remove listener and conditionally remove attribute.
   */
  public destroy(): void {
    this.removeMediaListener();
    state.activeInstances--;

    if (state.activeInstances <= 0) {
      state.activeInstances = 0;
      this.removeAttribute();
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private applyAttribute(): void {
    if (typeof document === 'undefined') {
      return;
    }

    if (this.mode === 'auto') {
      if (state.activeInstances <= 1) {
        this.removeAttribute();
      }
    } else {
      document.documentElement.setAttribute(ATTR, this.mode);
    }
  }

  private removeAttribute(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.removeAttribute(ATTR);
  }

  private deriveResolved(): ResolvedTheme {
    if (this.mode !== 'auto') {
      return this.mode;
    }

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'light';
    }

    return window.matchMedia(DARK_MQ).matches ? 'dark' : 'light';
  }

  private addMediaListener(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    this.mediaQuery = window.matchMedia(DARK_MQ);
    this.mediaQuery.addEventListener('change', this.onMediaChange);
  }

  private removeMediaListener(): void {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.onMediaChange);
      this.mediaQuery = null;
    }
  }

  private fireCallback(): void {
    const callback = this.config.onThemeChange;

    if (typeof callback === 'function') {
      callback(this.resolved);
    }
  }
}
