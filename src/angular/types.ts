import type { BlokConfig, EditorWidth } from '@jackuait/blok';

/**
 * Configuration for the Angular adapter. Same as `BlokConfig` but without
 * `holder` (the adapter owns the host element), plus the reactive `width` prop.
 * Mirrors the React adapter's `UseBlokConfig`.
 */
export type BlokAngularConfig = Omit<BlokConfig, 'holder'> & {
  /** Editor content width mode. Synced reactively after mount via `editor.width.set()`. */
  width?: EditorWidth;
};
