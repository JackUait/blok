/**
 * Put the eager English messages, and the key list every lazy locale decodes
 * against, in chunks of their own with stable names.
 *
 * The main build and `scripts/build-locales.mjs` both bundle English. Each
 * writes it to `chunks/<name>-<hash>.mjs`; the bytes, and so the file name,
 * match, so `/locales` reuses the main build's file instead of shipping a
 * second copy. Wire this plugin into BOTH builds, or the copies split again.
 */
const MESSAGE_GROUPS = [
  { name: 'messages-en', test: /[\\/]src[\\/]components[\\/]i18n[\\/]locales[\\/]en\.json(?:\?|$)/ },
  // The virtual module from vite-plugin-json-as-string.mjs.
  { name: 'message-keys', test: /^\0virtual:blok-message-keys$/ },
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
