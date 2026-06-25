import { provide, type InjectionKey } from 'vue';
import type { UseBlokConfig } from './types';

/**
 * Injection key holding app-wide Blok defaults (shared tools registry, default
 * theme, i18n). Merged UNDER per-instance props by `<BlokEditor>`.
 */
export const BLOK_DEFAULT_CONFIG: InjectionKey<Partial<UseBlokConfig>> = Symbol('BLOK_DEFAULT_CONFIG');

/**
 * Registers app-wide Blok defaults in the current component's provide scope
 * (call inside a parent component's `setup`). Mirrors Angular's `provideBlok`.
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
