/**
 * Emit imported JSON (emoji CLDR locales, UI messages, emoji grid data — ~30 MB
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
 *
 * Lazy UI and emoji locales ship as values against one shared key list per
 * kind (see locale-data-codec.mjs); the decoded object is the same as the
 * source.
 */
import { LOCALE_KINDS, buildKeyList, encodeLocale, keyListModule, localeKindOf } from './locale-data-codec.mjs';

const kindByResolvedId = new Map(LOCALE_KINDS.map((kind) => [`\0${kind.keysId}`, kind]));

export default function jsonAsStringPlugin() {
  const keyLists = new Map();
  let encodeLocales = true;
  const keyList = (kind) => {
    if (!keyLists.has(kind)) {
      keyLists.set(kind, buildKeyList(kind));
    }

    return keyLists.get(kind);
  };

  return {
    name: 'blok:json-as-string',
    enforce: 'pre',
    configResolved(config) {
      // The dev server re-transforms an edited locale without rebuilding the
      // key list, so it keeps plain objects.
      encodeLocales = config.command === 'build';
    },
    buildStart() {
      keyLists.clear();
    },
    resolveId: {
      filter: { id: /^virtual:blok-[a-z]+-keys$/ },
      handler: (id) => (kindByResolvedId.has(`\0${id}`) ? `\0${id}` : null),
    },
    load: {
      filter: { id: /^\0virtual:blok-[a-z]+-keys$/ },
      handler(id) {
        const kind = kindByResolvedId.get(id);

        return kind === undefined ? null : { code: keyListModule(kind, keyList(kind)), map: null, moduleType: 'js' };
      },
    },
    transform: {
      filter: { id: /\.json(?:\?|$)/ },
      handler(code, id) {
        if (!id.split('?')[0].endsWith('.json')) {
          return null;
        }

        const kind = encodeLocales ? localeKindOf(id.split('?')[0]) : null;

        if (kind !== null) {
          const payload = JSON.stringify(JSON.stringify(encodeLocale(kind, keyList(kind), JSON.parse(code))));

          return {
            code: `import decode from '${kind.keysId}';\nexport default /* @__PURE__ */ decode(JSON.parse(${payload}));`,
            map: null,
            moduleType: 'js',
          };
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
