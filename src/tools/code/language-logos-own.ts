/**
 * Language marks drawn for Blok, for the languages whose real logo cannot be
 * vendored (copyleft or unverified license) or that have none. Original
 * artwork on a 24×24 grid, in the same flat single-mark style as the vendored
 * set. Copyright JackUait, Apache-2.0 like the rest of Blok.
 *
 * `body` paints in `currentColor` (the theme-adjusted brand color) and is
 * clipped by `cuts`: anything drawn black there becomes a hole, so the row's
 * own background (hover, selection) shows through. `over` paints on top,
 * unclipped. A fixed hex inside a part is a second brand color.
 */

export interface DrawnLogo {
  hex: string;
  body: string;
  cuts?: string;
  over?: string;
}

export const OWN_LANGUAGE_LOGOS: Readonly<Record<string, DrawnLogo>> = {
  /** Java: a steaming cup on a saucer. */
  java: {
    hex: '#e76f00',
    body: '<path d="M4.5 10.5h12v3.8a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" fill="currentColor"/><path d="M16.3 11.8h1.4a2.4 2.4 0 0 1 0 4.8h-2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 22h15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    over: '<path d="M8.6 2.8c-1.6 1.5 1.6 2.6 0 4.8M12.4 2c-1.6 1.5 1.6 2.6 0 4.8" fill="none" stroke="#5382a1" stroke-width="1.6" stroke-linecap="round"/>',
  },
  /** C#: a hexagon with C and #. */
  csharp: {
    hex: '#68217a',
    body: '<path d="M12 1.2 21.6 6.6v10.8L12 22.8 2.4 17.4V6.6z" fill="currentColor"/>',
    cuts: '<path d="M11.8 8.3a4.4 4.4 0 1 0 0 7.4" fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round"/><path d="M15.2 9.2v5.6M17.9 9.2v5.6M13.9 11h5.3M13.9 13h5.3" stroke="#000" stroke-width="1.35" stroke-linecap="round"/>',
  },
  /** PHP: an oval with php. */
  php: {
    hex: '#777bb4',
    body: '<ellipse cx="12" cy="12" rx="11.6" ry="8" fill="currentColor"/>',
    cuts: '<path d="M5.4 9.8v5.6M5.4 9.9h1.6a1.55 1.55 0 0 1 0 3.1H5.4M10.4 8.6v5.4M10.4 11.2a1.5 1.5 0 0 1 3 0V14M16 9.8v5.6M16 9.9h1.6a1.55 1.55 0 0 1 0 3.1H16" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** Ruby: a cut gem. */
  ruby: {
    hex: '#cc342d',
    body: '<path d="M6 3.5h12l4.5 5.5L12 21.5 1.5 9z" fill="currentColor"/>',
    cuts: '<path d="M1.5 9h21M9 3.5 6.6 9 12 21.5 17.4 9 15 3.5M6.6 9 12 3.8 17.4 9" fill="none" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/>',
  },
  /** Rust: a gear stamped with R. */
  rust: {
    hex: '#b7410e',
    body: '<path d="M10.38 2.74L10.86 0.66L13.14 0.66L13.62 2.74L16.14 3.56L17.74 2.15L19.59 3.50L18.75 5.46L20.31 7.60L22.43 7.41L23.14 9.58L21.31 10.68L21.31 13.32L23.14 14.42L22.43 16.59L20.31 16.40L18.75 18.54L19.59 20.50L17.74 21.85L16.14 20.44L13.62 21.26L13.14 23.34L10.86 23.34L10.38 21.26L7.86 20.44L6.26 21.85L4.41 20.50L5.25 18.54L3.69 16.40L1.57 16.59L0.86 14.42L2.69 13.32L2.69 10.68L0.86 9.58L1.57 7.41L3.69 7.60L5.25 5.46L4.41 3.50L6.26 2.15L7.86 3.56Z" fill="currentColor"/>',
    cuts: '<path d="M8.9 17V7.2h3.9a2.6 2.6 0 0 1 0 5.2H8.9M12.6 12.4l3 4.6" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** R: a ring behind a bold R. */
  r: {
    hex: '#276dc3',
    body: '<ellipse cx="11" cy="10.4" rx="10.2" ry="7.2" fill="none" stroke="#8b919b" stroke-width="2.6"/>',
    cuts: '<path d="M9.8 20.6V9.6h4.8a3 3 0 0 1 0 6H9.8M14 15.6l3.6 5" fill="none" stroke="#000" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>',
    over: '<path d="M9.8 20.6V9.6h4.8a3 3 0 0 1 0 6H9.8M14 15.6l3.6 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** SQL: a database cylinder. */
  sql: {
    hex: '#e38c00',
    body: '<path d="M4.5 5.5v13a7.5 3.2 0 0 0 15 0v-13a7.5 3.2 0 0 0-15 0z" fill="currentColor"/>',
    cuts: '<path d="M4.5 5.5a7.5 3.2 0 0 0 15 0M4.5 10a7.5 3.2 0 0 0 15 0M4.5 14.4a7.5 3.2 0 0 0 15 0" fill="none" stroke="#000" stroke-width="1.15"/>',
  },
  /** Shell: a terminal with a prompt. */
  shell: {
    hex: '#2b2d31',
    body: '<rect x="1.5" y="3.5" width="21" height="17" rx="3.5" fill="currentColor"/>',
    cuts: '<path d="m6 9 3.2 3L6 15M11.6 15.4h6" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  },
};
