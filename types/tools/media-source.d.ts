/**
 * Which insert sources a media tool (image, video, audio, file) exposes in its
 * empty state.
 *
 * - `'both'` (default): offer both file Upload and Link (URL/embed) tabs.
 * - `'upload'`: file upload only — the Link tab and URL bar are hidden.
 * - `'url'`: link/embed only — the Upload dropzone, file picker, and
 *   drag/paste-to-upload affordances are hidden.
 *
 * With a single source the tab switcher is omitted entirely.
 */
export type MediaSource = 'upload' | 'url' | 'both';
