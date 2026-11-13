/** Every string the file preview shows. Templates keep their `{name}` slots; `fill` sets them. */
export interface PreviewLabels {
  close: string;
  raw: string;
  render: string;
  loading: string;
  error: string;
  /** The line under the error title: what to do next. */
  errorDetail?: string;
  /** That line when there is no safe link to download from. */
  errorNoLinkDetail?: string;
  download: string;
  openInNewTab: string;
  backToContent: string;
  text: string;
  pages: string;
  pagesOne: string;
  sheets: string;
  sheetsOne: string;
  slides: string;
  slidesOne: string;
  lines: string;
  linesOne: string;
  rows: string;
  rowsOne: string;
  pageOf: string;
  prevPage: string;
  nextPage: string;
  zoomIn: string;
  zoomOut: string;
  slideN: string;
  sum: string;
  average: string;
  count: string;
  table: string;
  wrap: string;
  copy: string;
  copied: string;
  outline: string;
  logAll: string;
  logErrors: string;
  logWarnings: string;
}

export const DEFAULT_PREVIEW_LABELS: PreviewLabels = {
  close: 'Close preview',
  raw: 'Source',
  render: 'Preview',
  loading: 'Loading…',
  error: "Couldn't load preview",
  download: 'Download',
  openInNewTab: 'Open in new tab',
  backToContent: 'Back to content',
  text: 'Text',
  pages: '{count} pages',
  pagesOne: '1 page',
  sheets: '{count} sheets',
  sheetsOne: '1 sheet',
  slides: '{count} slides',
  slidesOne: '1 slide',
  lines: '{count} lines',
  linesOne: '1 line',
  rows: '{count} rows',
  rowsOne: '1 row',
  pageOf: 'Page {page} / {total}',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  slideN: 'Slide {number}',
  sum: 'Sum',
  average: 'Average',
  count: 'Count',
  table: 'Table',
  wrap: 'Wrap lines',
  copy: 'Copy',
  copied: 'Copied',
  outline: 'On this page',
  logAll: 'All',
  logErrors: 'Errors',
  logWarnings: 'Warnings',
};

/** Labels a caller left out fall back to English. */
export function resolvePreviewLabels(labels: Partial<PreviewLabels>): PreviewLabels {
  const given = Object.fromEntries(Object.entries(labels).filter(([, value]) => value !== undefined));

  return { ...DEFAULT_PREVIEW_LABELS, ...given };
}

/** Put values into a template's `{name}` slots. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => (name in values ? String(values[name]) : slot));
}

/** "1 page" or "12 pages": the singular label for one, the counted one otherwise. */
export function counted(count: number, one: string, many: string): string {
  return count === 1 ? one : fill(many, { count });
}
