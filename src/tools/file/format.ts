const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Human-readable byte size. Returns '' when size is undefined.
 * Uses binary steps (1 KB = 1024 B) and one decimal, trailing .0 trimmed.
 */
export function humanFileSize(bytes: number | undefined): string {
  if (bytes === undefined) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    UNITS.length - 1,
  );
  const value = bytes / Math.pow(1024, unitIndex);
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${UNITS[unitIndex]}`;
}
