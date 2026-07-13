import { scopeUtilitiesLayer } from './scope-tailwind-utilities.mjs';

/**
 * Vite plugin: scope Blok's compiled Tailwind utilities to Blok's interface
 * roots and hoist them out of `@layer utilities`. See
 * scope-tailwind-utilities.mjs for the full rationale.
 *
 * main.css is imported with `?inline` (see src/components/modules/ui.ts), so
 * Vite generates the utilities via @tailwindcss/vite (a `pre` transform), then
 * inlines the whole stylesheet as a JS string (`export default "<css>"`) before
 * any `post` hook runs. This plugin (enforce: 'post') therefore unwraps that
 * default-export string, scopes the CSS, and re-embeds it. It also handles the
 * raw-CSS shape defensively, in case the module reaches it un-wrapped.
 */
export default function scopeUtilitiesPlugin() {
  const hasUtilitiesLayer = (s) => /@layer\s+utilities\s*\{/.test(s);

  return {
    name: 'blok:scope-tailwind-utilities',
    enforce: 'post',
    transform(code, id) {
      if (!id.includes('styles/main.css')) return null;

      // `?inline` shape: the module body is exactly `export default "<css>"`.
      const trimmed = code.trim();
      const prefix = 'export default ';
      if (trimmed.startsWith(prefix)) {
        const literal = trimmed.slice(prefix.length).replace(/;$/, '');
        let css;
        try {
          css = JSON.parse(literal); // Vite inlines via JSON.stringify
        } catch {
          return null;
        }
        if (!hasUtilitiesLayer(css)) return null;
        return { code: `${prefix}${JSON.stringify(scopeUtilitiesLayer(css))};`, map: null };
      }

      // Raw-CSS shape (defensive).
      if (hasUtilitiesLayer(code)) {
        return { code: scopeUtilitiesLayer(code), map: null };
      }

      return null;
    },
  };
}
