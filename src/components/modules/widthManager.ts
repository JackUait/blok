import { Module } from '../__module';

const DEFAULT_NARROW_WIDTH = '650px';
const DEFAULT_FULL_WIDTH = '100%';
const CSS_VAR = '--blok-content-width';

/**
 * Manages the editor-level width mode.
 *
 * Applies a CSS custom property (--blok-content-width) to the editor wrapper
 * element, which block content elements read via CSS cascade.
 */
export class WidthManager extends Module {
  private currentMode: 'narrow' | 'full' = 'narrow';

  /**
   * Called by Core after all modules are constructed and wired.
   */
  public prepare(): void {
    const initialMode = this.config.defaultWidth ?? 'narrow';
    this.currentMode = initialMode;
    this.applyWidth(initialMode);
  }

  /**
   * Returns the current width mode.
   */
  public getWidth(): 'narrow' | 'full' {
    return this.currentMode;
  }

  /**
   * Sets the editor width mode.
   * No-op if already in the requested mode.
   */
  public setWidth(mode: 'narrow' | 'full'): void {
    if (this.currentMode === mode) {
      return;
    }
    this.currentMode = mode;
    this.applyWidth(mode);

    const callback = this.config.onWidthChange;
    if (typeof callback === 'function') {
      callback(mode, this.resolveValue(mode));
    }
  }

  /**
   * Toggles between 'narrow' and 'full'.
   */
  public toggle(): void {
    this.setWidth(this.currentMode === 'narrow' ? 'full' : 'narrow');
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private applyWidth(mode: 'narrow' | 'full'): void {
    const value = this.resolveValue(mode);
    this.Blok.UI.nodes.wrapper.style.setProperty(CSS_VAR, value);
  }

  private resolveValue(mode: 'narrow' | 'full'): string {
    if (mode === 'narrow') {
      return this.config.narrowWidth ?? DEFAULT_NARROW_WIDTH;
    }
    return this.config.fullWidth ?? DEFAULT_FULL_WIDTH;
  }
}
