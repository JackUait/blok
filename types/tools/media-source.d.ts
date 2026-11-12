/**
 * Which insert sources a media tool (image, video, audio, file) exposes in its
 * empty state.
 *
 * - `'both'` (default): a file can be chosen, dropped, or added from a link.
 * - `'upload'`: file upload only — there is no link button and no URL field.
 * - `'url'`: link only — the URL field is shown at once; the file picker and
 *   drag/paste-to-upload are off.
 */
export type MediaSource = 'upload' | 'url' | 'both';
