import type { SanitizerConfig } from '../../types';

/**
 * Composes a base sanitizer config from a list of per-tool configs using the
 * exact merge semantics of `BlockToolAdapter.baseSanitizeConfig`: a plain
 * later-wins `Object.assign` fold (inline tools first, then tunes). Function
 * rules are carried by reference; rules for the same tag are replaced, never
 * deep-merged.
 * @param configs - sanitize configs in composition order
 * @returns composed base sanitizer config
 */
export function composeBaseSanitizeConfig(configs: SanitizerConfig[]): SanitizerConfig {
  const baseConfig: SanitizerConfig = {};

  configs.forEach((config) => Object.assign(baseConfig, config));

  return baseConfig;
}
