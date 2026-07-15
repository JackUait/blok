import type { ReadOnlyModeConfig } from '../../../types';

/**
 * Normalized shape of the `readOnly` config option
 */
export interface NormalizedReadOnlyConfig {
  enabled: boolean;
  hideControls: boolean;
}

/**
 * Single source of truth for interpreting the `readOnly` config option.
 * The object form always means read-only is enabled.
 * @param value - raw `readOnly` value from BlokConfig
 */
export function normalizeReadOnlyConfig(value: boolean | ReadOnlyModeConfig | undefined): NormalizedReadOnlyConfig {
  if (typeof value === 'object' && value !== null) {
    return { enabled: true, hideControls: value.hideControls === true };
  }

  return { enabled: value === true, hideControls: false };
}
