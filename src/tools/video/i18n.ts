import type { I18nInstance } from '../../components/utils/tools';

/**
 * Resolve a translation key, falling back to an inline English string when the
 * host editor has not registered the key. Keeps the video tool usable before
 * locale messages are wired and gives the i18n regression scan a single place
 * to find the source copy. Optional variables are interpolated in both the
 * translated message and its fallback, preserving the same caller contract.
 */
export function tr(
  i18n: I18nInstance | undefined,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>
): string {
  if (i18n?.has(key)) return i18n.t(key, vars);

  if (vars === undefined) return fallback;

  return fallback.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const replacement = vars[name];

    return replacement === undefined ? placeholder : String(replacement);
  });
}
