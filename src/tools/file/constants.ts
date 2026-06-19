/** Non-image MIME prefixes claimed for paste/drop routing. Image files stay with the Image tool. Audio files route to the Audio tool. */
export const PASTE_MIME_TYPES = [
  'application/*',
  'text/*',
  'video/*',
  'font/*',
  'model/*',
] as const;

/** Common file extensions claimed for paste/drop routing (OR'd with MIME prefixes). */
export const PASTE_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'rar', '7z', 'gz', 'tar',
  'csv', 'txt', 'rtf', 'md', 'json',
  'mp4', 'mov', 'avi', 'mkv',
] as const;

/** Default upload ceiling (bytes) when the consumer does not configure `maxSize`. */
export const DEFAULT_MAX_SIZE = 30 * 1024 * 1024; // 30 MiB

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';
