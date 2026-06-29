import {
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import type { BlokAngularConfig } from './types';

/**
 * DI token holding app-wide Blok defaults (shared tools registry, default theme,
 * i18n). Merged under per-instance inputs by `BlokEditorComponent`.
 */
export const BLOK_DEFAULT_CONFIG = new InjectionToken<Partial<BlokAngularConfig>>(
  'BLOK_DEFAULT_CONFIG'
);

/**
 * Standalone provider registering app-wide Blok defaults.
 *
 * @example
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideBlok({ theme: 'dark', tools: sharedTools })],
 * });
 * ```
 */
export function provideBlok(defaults: Partial<BlokAngularConfig>): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: BLOK_DEFAULT_CONFIG, useValue: defaults }]);
}
