/**
 * Emit imported JSON (emoji CLDR locales, UI messages, emoji-mart data — ~30 MB
 * of dist before this) as `JSON.parse("…")` instead of JS object literals.
 *
 * Consumers that bundle this package parse every dist module — dynamic imports
 * included — and a giant object literal costs thousands of AST nodes where a
 * JSON.parse string costs one. Unstringified locale data is what OOMed consumer
 * CI builds at Node's default heap. (Vite 8/rolldown ignores `json.stringify`
 * in this setup, so the transform is done as a plugin.)
 *
 * Emits a default export only — all JSON consumers in src use default imports
 * or `.default` on dynamic imports (guarded by test/unit/build tests).
 */
export default function jsonAsStringPlugin() {
  return {
    name: 'blok:json-as-string',
    enforce: 'pre',
    transform: {
      filter: { id: /\.json(?:\?|$)/ },
      handler(code, id) {
        if (!id.split('?')[0].endsWith('.json')) {
          return null;
        }

        const stringified = JSON.stringify(JSON.stringify(JSON.parse(code)));

        return {
          code: `export default /* @__PURE__ */ JSON.parse(${stringified});`,
          map: null,
          moduleType: 'js',
        };
      },
    },
  };
}
