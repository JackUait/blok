/**
 * Put the English parts, and the key lists the lazy UI and emoji locales
 * decode against, in chunks of their own with stable names.
 *
 * The main build and `scripts/build-locales.mjs` both bundle English. Each
 * writes it to `chunks/<name>-<hash>.mjs`; the bytes, and so the file name,
 * match, so `/locales` reuses the main build's files instead of shipping a
 * second copy. Wire this plugin into BOTH builds, or the copies split again.
 */
const MESSAGE_GROUPS = [
  // The two English parts (see english-parts.mjs). /locales merges them, so
  // it reuses both files.
  { name: 'messages-en', test: /[\\/]src[\\/]components[\\/]i18n[\\/]locales[\\/]english-core\.ts$/ },
  { name: 'messages-en-database', test: /[\\/]src[\\/]components[\\/]i18n[\\/]locales[\\/]english-database\.ts$/ },
  // The virtual modules from vite-plugin-json-as-string.mjs.
  { name: 'message-keys', test: /^\0virtual:blok-message-keys$/ },
  { name: 'emoji-locale-keys', test: /^\0virtual:blok-emoji-keys$/ },
];

/**
 * Append the message groups to the output's chunk groups. rolldown ignores
 * `advancedChunks` once `codeSplitting` is set, so keep whichever is in use.
 * @param {Record<string, unknown>} options - rolldown output options
 * @returns {Record<string, unknown> | null}
 */
export const withMessageGroups = (options) => {
  const key = options.codeSplitting === undefined && options.advancedChunks !== undefined
    ? 'advancedChunks'
    : 'codeSplitting';
  const current = options[key];

  if (current === false) {
    return null;
  }

  const base = typeof current === 'object' && current !== null ? current : {};

  return {
    ...options,
    [key]: { ...base, groups: [ ...(base.groups ?? []), ...MESSAGE_GROUPS ] },
  };
};

export default function sharedMessageChunksPlugin() {
  return {
    name: 'blok:shared-message-chunks',
    apply: 'build',
    outputOptions: withMessageGroups,
  };
}
