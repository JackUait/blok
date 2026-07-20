import { inject, provide, type InjectionKey } from 'vue';
import type { UseBlokConfig } from './types';

/**
 * Injection key holding app-wide Blok defaults (shared tools registry, default
 * theme, i18n). Merged UNDER per-instance config by `useBlok` (and therefore by
 * `<BlokEditor>`, which wires `useBlok`).
 */
export const BLOK_DEFAULT_CONFIG: InjectionKey<Partial<UseBlokConfig>> = Symbol('BLOK_DEFAULT_CONFIG');

/**
 * Registers app-wide Blok defaults in the current component's provide scope
 * (call inside a parent component's `setup`). Mirrors React's `BlokProvider` and
 * Angular's `provideBlok`.
 *
 * @example
 * ```ts
 * setup() {
 *   provideBlok({ theme: 'dark', tools: sharedTools });
 * }
 * ```
 */
export function provideBlok(defaults: Partial<UseBlokConfig>): void {
  provide(BLOK_DEFAULT_CONFIG, defaults);
}

/**
 * Reads the app-wide Blok defaults from the nearest `provideBlok` (or `{}`).
 * Mirrors React's `useBlokDefaults`. Call inside `setup`.
 */
export function useBlokDefaults(): Partial<UseBlokConfig> {
  return inject(BLOK_DEFAULT_CONFIG, {});
}

/**
 * Merge app-wide `defaults` UNDER a per-instance `config`: a defined config value
 * overrides the default, and the `tools` registry is merged across both layers
 * (a shared registry composes with per-instance additions) rather than replaced.
 * Returns the original `config` reference when there are no defaults, so the
 * no-provider path stays identity-stable. Mirrors React's `mergeBlokDefaults`.
 */
export function mergeBlokDefaults(
  defaults: Partial<UseBlokConfig>,
  config: UseBlokConfig
): UseBlokConfig {
  if (Object.keys(defaults).length === 0) {
    return config;
  }

  const merged: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(config)) {
    const value = (config as Record<string, unknown>)[key];

    if (value !== undefined) {
      merged[key] = value;
    }
  }

  if (defaults.tools !== undefined || config.tools !== undefined) {
    merged.tools = { ...defaults.tools, ...config.tools };
  }

  return merged;
}
