/** Non-image MIME prefixes claimed for paste/drop routing. Image files stay with the Image tool. */
export const PASTE_MIME_TYPES = [
  'application/*',
  'text/*',
  'audio/*',
  'video/*',
  'font/*',
  'model/*',
] as const;

/** Common file extensions claimed for paste/drop routing (OR'd with MIME prefixes). */
export const PASTE_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'rar', '7z', 'gz', 'tar',
  'csv', 'txt', 'rtf', 'md', 'json',
  'mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'mkv',
] as const;

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';
