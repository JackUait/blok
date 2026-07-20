import { createContext, useContext, type ReactNode } from 'react';
import type { UseBlokConfig } from './types';

/**
 * Context holding app-wide Blok defaults (shared tools registry, default theme,
 * i18n). Merged UNDER per-instance config by `useBlok` / `<BlokEditor>`. Mirrors
 * Vue's and Angular's `provideBlok`.
 */
export const BlokDefaultsContext = createContext<Partial<UseBlokConfig>>({});

/**
 * Registers app-wide Blok defaults for every `useBlok` / `<BlokEditor>` rendered
 * beneath it. Per-instance config overrides these, and the `tools` registry is
 * merged (shared registry composes with per-instance additions) rather than
 * replaced. Mirrors Vue's and Angular's `provideBlok`.
 *
 * @example
 * ```tsx
 * <BlokProvider defaults={{ theme: 'dark', tools: sharedTools }}>
 *   <App />
 * </BlokProvider>
 * ```
 */
export function BlokProvider({
  defaults,
  children,
}: {
  defaults: Partial<UseBlokConfig>;
  children?: ReactNode;
}): React.ReactElement {
  return <BlokDefaultsContext.Provider value={defaults}>{children}</BlokDefaultsContext.Provider>;
}

/** Reads the app-wide Blok defaults from the nearest `BlokProvider` (or `{}`). */
export function useBlokDefaults(): Partial<UseBlokConfig> {
  return useContext(BlokDefaultsContext);
}

/**
 * Merge app-wide `defaults` UNDER a per-instance `config`: a defined config value
 * overrides the default, and the `tools` registry is merged across both layers.
 * Returns the original `config` reference when there are no defaults, so the
 * no-provider path stays identity-stable (no spurious editor recreation).
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

  // tools registries MERGE across layers (a shared registry composes with
  // per-instance additions) rather than the instance replacing the default.
  if (defaults.tools !== undefined || config.tools !== undefined) {
    merged.tools = { ...defaults.tools, ...config.tools };
  }

  return merged;
}
