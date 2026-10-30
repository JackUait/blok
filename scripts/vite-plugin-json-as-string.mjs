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
 * Lazy UI locales ship as values against one shared key list (see
 * locale-message-codec.mjs); the decoded object is the same as the source.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MESSAGE_KEYS_ID,
  buildKeyList,
  encodeMessages,
  isLazyMessageLocale,
  keyListModule,
} from './locale-message-codec.mjs';

const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/i18n/locales');
const RESOLVED_KEYS_ID = `\0${MESSAGE_KEYS_ID}`;

export default function jsonAsStringPlugin() {
  let keys = null;
  let encodeLocales = true;
  const keyList = () => (keys ??= buildKeyList(LOCALES_DIR));

  return {
    name: 'blok:json-as-string',
    enforce: 'pre',
    configResolved(config) {
      // The dev server re-transforms an edited locale without rebuilding the
      // key list, so it keeps plain objects.
      encodeLocales = config.command === 'build';
    },
    buildStart() {
      keys = null;
    },
    resolveId: {
      filter: { id: new RegExp(`^${MESSAGE_KEYS_ID}$`) },
      handler: () => RESOLVED_KEYS_ID,
    },
    load: {
      filter: { id: new RegExp(`^\\0${MESSAGE_KEYS_ID}$`) },
      handler: () => ({ code: keyListModule(keyList()), map: null, moduleType: 'js' }),
    },
    transform: {
      filter: { id: /\.json(?:\?|$)/ },
      handler(code, id) {
        if (!id.split('?')[0].endsWith('.json')) {
          return null;
        }

        const file = id.split('?')[0];

        if (encodeLocales && isLazyMessageLocale(file)) {
          const payload = JSON.stringify(JSON.stringify(encodeMessages(keyList(), JSON.parse(code))));

          return {
            code: `import decode from '${MESSAGE_KEYS_ID}';\nexport default /* @__PURE__ */ decode(JSON.parse(${payload}));`,
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
