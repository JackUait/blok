/**
 * Language marks drawn for Blok, for the languages whose real logo cannot be
 * vendored (copyleft or unverified license) or that have none. Original
 * artwork on a 24×24 grid, in the same flat single-mark style as the vendored
 * set. Copyright JackUait, Apache-2.0 like the rest of Blok.
 *
 * `body` paints in `currentColor` (the theme-adjusted brand color) and is
 * clipped by `cuts`: anything drawn black there becomes a hole, so the row's
 * own background (hover, selection) shows through. `over` paints on top,
 * unclipped. A fixed hex inside a part is a second brand color; a
 * `color-mix` with currentColor is a lighter or deeper facet of the first,
 * so facets follow the theme-adjusted color too.
 */

export interface DrawnLogo {
  hex: string;
  body: string;
  cuts?: string;
  over?: string;
}

export const OWN_LANGUAGE_LOGOS: Readonly<Record<string, DrawnLogo>> = {
  /** Java: a cup whose steam is a pair of braces. */
  java: {
    hex: '#e76f00',
    body: '<path d="M4.4 11.2h12.2v3.4a6.1 6.1 0 0 1-6.1 6.1 6.1 6.1 0 0 1-6.1-6.1z" fill="currentColor"/><path d="M16.4 12.4h1.3a2.4 2.4 0 0 1 0 4.8h-1.9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.8 22.3h15.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    cuts: '<path d="M6 12.6h9" stroke="#000" stroke-width=".9" stroke-linecap="round" opacity=".55"/>',
    over: '<path d="M9.1 2.4c-.9 0-1.2.5-1.2 1.2v1c0 .6-.4 1-1 1 .6 0 1 .4 1 1v1c0 .7.3 1.2 1.2 1.2M12 2.4c.9 0 1.2.5 1.2 1.2v1c0 .6.4 1 1 1-.6 0-1 .4-1 1v1c0 .7-.3 1.2-1.2 1.2" fill="none" stroke="#5382a1" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** C#: a faceted hexagon with a C and a musical sharp. */
  csharp: {
    hex: '#68217a',
    body: '<path d="M12 1.2 21.6 6.6v10.8L12 22.8 2.4 17.4V6.6z" fill="currentColor"/><path d="M12 1.2 21.6 6.6 12 12z" style="fill:color-mix(in srgb,currentColor 78%,#fff)"/><path d="M21.6 17.4 12 22.8V12z" style="fill:color-mix(in srgb,currentColor 82%,#000)"/>',
    cuts: '<path d="M11.6 8.2a4.4 4.4 0 1 0 0 7.6" fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round"/><path d="M15.4 8.9 15 15.3M18 8.6l-.4 6.4" stroke="#000" stroke-width="1.15" stroke-linecap="round"/><path d="m13.9 11.6 5.4-1.3M13.9 14.1l5.4-1.3" stroke="#000" stroke-width="1.55" stroke-linecap="round"/>',
  },
  /** PHP: an elephant head in the PHP oval. */
  php: {
    hex: '#777bb4',
    body: '<ellipse cx="12" cy="12" rx="11.6" ry="8.2" fill="currentColor"/>',
    cuts: '<path d="M13.4 6.6c2.8-.9 5.4 1 5.4 4.1 0 2.6-1.8 4.6-4.2 4.6z" fill="#000"/><circle cx="12" cy="10.6" r="3.9" fill="#000"/><path d="M9 12.2c-.9 1.6-1 3.6-2.6 4.1-.9.3-1.6-.3-1.4-1.1" fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round"/>',
    over: '<path d="M13.9 7.4c1.8.1 3.1 1.5 3.1 3.3 0 1.4-.7 2.6-1.9 3.2" fill="none" stroke="currentColor" stroke-width=".85" stroke-linecap="round"/><circle cx="11.2" cy="9.7" r=".65" fill="currentColor"/>',
  },
  /** Ruby: a brilliant-cut gem with flat facet shading. */
  ruby: {
    hex: '#cc342d',
    body: '<path d="M2 8.6 7 3.4l2.6 5.2z" style="fill:color-mix(in srgb,currentColor 70%,#fff)"/><path d="M7 3.4h10l-2.6 5.2H9.6z" style="fill:color-mix(in srgb,currentColor 52%,#fff)"/><path d="M17 3.4l5 5.2h-7.6z" style="fill:color-mix(in srgb,currentColor 82%,#fff)"/><path d="M2 8.6h7.6L12 21.4z" fill="currentColor"/><path d="M9.6 8.6h4.8L12 21.4z" style="fill:color-mix(in srgb,currentColor 80%,#fff)"/><path d="M14.4 8.6H22L12 21.4z" style="fill:color-mix(in srgb,currentColor 78%,#000)"/>',
    cuts: '<path d="M2 8.6h20M9.6 8.6 12 21.4l2.4-12.8M7 3.4l2.6 5.2M17 3.4l-2.6 5.2" fill="none" stroke="#000" stroke-width=".55" stroke-linejoin="round"/>',
  },
  /** Rust: a crab, after Ferris, the public-domain Rust mascot (our own drawing). */
  rust: {
    hex: '#c2410c',
    body: '<circle cx="4.2" cy="5.6" r="2.9" fill="currentColor"/><circle cx="19.8" cy="5.6" r="2.9" fill="currentColor"/><path d="M5 8.2 7.6 11.4M19 8.2l-2.6 3.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M5.9 15.2 3 16.6M6.6 17.1 4.5 19.4M18.1 15.2l2.9 1.4M17.4 17.1l2.1 2.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.6 14.4c0-2.6 2-4.4 3.4-4.6.6-.9 1.4-1.3 2.1-1 .6-.6 1.3-.6 1.9-.6s1.3 0 1.9.6c.7-.3 1.5.1 2.1 1 1.4.2 3.4 2 3.4 4.6 0 2.4-3.3 3.9-7.4 3.9s-7.4-1.5-7.4-3.9z" fill="currentColor"/>',
    cuts: '<path d="M4.2 5.6 2.9 1.9h2.9zM19.8 5.6l-1.3-3.7h2.9z" fill="#000"/><circle cx="10" cy="12.8" r="1.25" fill="#000"/><circle cx="14" cy="12.8" r="1.25" fill="#000"/><path d="M10.7 15.4q1.3.9 2.6 0" fill="none" stroke="#000" stroke-width=".9" stroke-linecap="round"/>',
    over: '<circle cx="10.2" cy="13" r=".55" fill="#1b1a17"/><circle cx="14.2" cy="13" r=".55" fill="#1b1a17"/>',
  },
  /** R: a slanted ring behind a bold R. */
  r: {
    hex: '#276dc3',
    body: '<ellipse cx="11.4" cy="10.2" rx="10.4" ry="6.6" transform="rotate(-10 11.4 10.2)" fill="none" stroke="#9aa1ab" stroke-width="2.9"/>',
    cuts: '<path d="M9.6 21V9.4h5.1a3.15 3.15 0 0 1 0 6.3H9.6M14.3 15.7l3.9 5.3" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
    over: '<path d="M9.6 21V9.4h5.1a3.15 3.15 0 0 1 0 6.3H9.6M14.3 15.7l3.9 5.3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** SQL: a database cylinder whose bands are table rows. */
  sql: {
    hex: '#e38c00',
    body: '<path d="M4 6v12.4c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4V6z" fill="currentColor"/><ellipse cx="12" cy="6" rx="8" ry="3.4" style="fill:color-mix(in srgb,currentColor 62%,#fff)"/>',
    cuts: '<path d="M4 6c0 1.9 3.6 3.4 8 3.4S20 7.9 20 6M4 10.9c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4M4 15.4c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4M12 9.4v12.4" fill="none" stroke="#000" stroke-width="1"/>',
  },
  /** Shell: a terminal with a green prompt; the cursor blinks on its row's hover or focus. */
  shell: {
    hex: '#23262c',
    body: '<rect x="1.5" y="3.2" width="21" height="17.6" rx="3.8" fill="#23262c" stroke="#ffffff" stroke-opacity=".16"/><circle cx="4.9" cy="6.3" r=".8" fill="#ff5f57"/><circle cx="7.3" cy="6.3" r=".8" fill="#febc2e"/><circle cx="9.7" cy="6.3" r=".8" fill="#28c840"/>',
    over: '<path d="m5.6 10.6 3.2 2.9-3.2 2.9" fill="none" stroke="#3ddc84" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path data-blok-code-logo-cursor="" d="M11.2 16.6h6" stroke="#f1f1f1" stroke-width="1.9" stroke-linecap="round"/>',
  },
};
