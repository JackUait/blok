// Accept any image type by default; consumers restrict via the `types` config.
export const DEFAULT_MIME_TYPES = ['image/*'] as const;

export const DEFAULT_MAX_SIZE = 30 * 1024 * 1024; // 30 MiB

export const DEFAULT_CAPTION_PLACEHOLDER = 'Write a caption…';

export const MIN_WIDTH_PERCENT = 10;
export const MAX_WIDTH_PERCENT = 100;

// Hard pixel floor for images resized inside a table cell. The global 10% floor
// is a percent of the cell, so a narrow column could shrink an image to an
// unusable sliver; this keeps in-cell images at least a legible thumbnail width.
export const IMAGE_TABLE_CELL_MIN_WIDTH_PX = 120;

// Local copy of the table tool's CELL_ATTR ('data-blok-table-cell'), duplicated
// so the image bundle need not import the whole table module for one selector.
// A drift guard in resize-floor.test.ts asserts this stays equal to CELL_ATTR.
export const TABLE_CELL_ATTR = 'data-blok-table-cell';

// How many times a rendered image silently re-fetches its src after a load
// error before surfacing the broken-image state. Overridable via config.
export const DEFAULT_RELOAD_ATTEMPTS = 5;

export const URL_PATTERN = /^https?:\/\/\S+\.(jpe?g|png|gif|webp|svg)(\?\S*)?$/i;
