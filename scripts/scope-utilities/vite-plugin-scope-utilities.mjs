import { scopeUtilitiesLayer } from './scope-tailwind-utilities.mjs';

/**
 * Vite plugin: scope Blok's compiled Tailwind utilities to Blok's interface
 * roots and hoist them out of `@layer utilities`. See
 * scope-tailwind-utilities.mjs for the full rationale.
 *
 * The library imports main.css with `?inline`, so Vite inlines it as
 * `export default "<css>"`. Storybook imports it as a stylesheet, and in dev
 * Vite wraps that as `const __vite__css = "<css>"` before this post plugin
 * runs. Both shapes are unwrapped, scoped, and re-embedded. Raw CSS is handled
 * only when the module is not already JavaScript.
 */
function scopeJsonString(literal) {
  let css;
  try {
    css = JSON.parse(literal); // Vite inlines via JSON.stringify
  } catch {
    return null;
  }
  if (!/@layer\s+utilities\s*\{/.test(css)) return null;
  return JSON.stringify(scopeUtilitiesLayer(css));
}

/**
 * Storybook imports main.css as a stylesheet. In dev, Vite wraps that CSS in
 * a JS module (`const __vite__css = "<css>"`) before post plugins run. Scope
 * the string only — parsing the wrapper as CSS throws "Unknown word updateStyle".
 */
function scopeViteCssModule(code) {
  const marker = 'const __vite__css = ';
  const start = code.indexOf(marker);
  if (start < 0 || code[start + marker.length] !== '"') return null;

  const literalStart = start + marker.length;
  let end = literalStart + 1;
  while (end < code.length) {
    if (code[end] === '\\') {
      end += 2;
      continue;
    }
    if (code[end] === '"') break;
    end += 1;
  }
  if (code[end] !== '"') return null;

  const scoped = scopeJsonString(code.slice(literalStart, end + 1));
  if (!scoped) return null;
  return code.slice(0, literalStart) + scoped + code.slice(end + 1);
}

export default function scopeUtilitiesPlugin() {
  const hasUtilitiesLayer = (s) => /@layer\s+utilities\s*\{/.test(s);

  return {
    name: 'blok:scope-tailwind-utilities',
    enforce: 'post',
    transform(code, id) {
      if (!id.includes('styles/main.css')) return null;

      if (code.includes('__vite__updateStyle')) {
        const rewritten = scopeViteCssModule(code);
        return rewritten ? { code: rewritten, map: null } : null;
      }

      // `?inline` shape: the module body is exactly `export default "<css>"`.
      const trimmed = code.trim();
      const prefix = 'export default ';
      if (trimmed.startsWith(prefix)) {
        const scoped = scopeJsonString(trimmed.slice(prefix.length).replace(/;$/, ''));
        if (!scoped) return null;
        return { code: `${prefix}${scoped};`, map: null };
      }

      // Raw-CSS shape (defensive). Skip JS so a stylesheet wrapper is never parsed as CSS.
      if (!trimmed.startsWith('import ') && hasUtilitiesLayer(code)) {
        return { code: scopeUtilitiesLayer(code), map: null };
      }

      return null;
    },
  };
}
