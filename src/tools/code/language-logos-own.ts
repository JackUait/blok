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
  /** Java: a cup of coffee with crema, its steam a pair of braces. */
  java: {
    hex: '#e76f00',
    body: '<path d="M16.4 12.4h1.3a2.4 2.4 0 0 1 0 4.8h-1.9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.4 11.2h12.2v3.4a6.1 6.1 0 0 1-6.1 6.1 6.1 6.1 0 0 1-6.1-6.1z" fill="currentColor"/><path d="M13.6 11.2h3v3.4a6.1 6.1 0 0 1-5 6c1.3-1.3 2-3.4 2-6z" style="fill:color-mix(in srgb,currentColor 84%,#000)"/><path d="M5.7 12.6v2.1a4.9 4.9 0 0 0 1.8 3.8" fill="none" stroke-width="1" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 55%,#fff)"/><ellipse cx="10.5" cy="11.35" rx="5.7" ry="1.05" style="fill:color-mix(in srgb,currentColor 48%,#000)"/><path d="M2.6 21.6h15.8a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1z" fill="currentColor"/><path d="M3.2 21.55h14.6" fill="none" stroke-width=".55" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 58%,#fff)"/>',
    over: '<path d="M8.4 11.35q1.1-.55 2.2 0t2.1-.05" fill="none" stroke="#f3c48a" stroke-width=".55" stroke-linecap="round"/><path d="M9.1 2.4c-.9 0-1.2.5-1.2 1.2v1c0 .6-.4 1-1 1 .6 0 1 .4 1 1v1c0 .7.3 1.2 1.2 1.2" fill="none" stroke="#5382a1" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2.4c.9 0 1.2.5 1.2 1.2v1c0 .6.4 1 1 1-.6 0-1 .4-1 1v1c0 .7-.3 1.2-1.2 1.2" fill="none" stroke="#7fa6c4" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  /** C#: a bevelled hexagon with an engraved C and a musical sharp. */
  csharp: {
    hex: '#68217a',
    body: '<path d="M12 1.2 21.6 6.6v10.8L12 22.8 2.4 17.4V6.6z" fill="currentColor"/><path d="M12 1.2 21.6 6.6 12 12z" style="fill:color-mix(in srgb,currentColor 78%,#fff)"/><path d="M21.6 17.4 12 22.8V12z" style="fill:color-mix(in srgb,currentColor 80%,#000)"/><path d="M2.4 17.4 12 22.8V12z" style="fill:color-mix(in srgb,currentColor 92%,#000)"/><path d="M3.2 7 12 2.1 20.8 7" fill="none" stroke-width=".7" stroke-linejoin="round" style="stroke:color-mix(in srgb,currentColor 52%,#fff)"/><path d="M12.3 8.9a4.4 4.4 0 1 0 0 7.6" fill="none" stroke-width="2.3" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 62%,#000)"/>',
    cuts: '<path d="M11.6 8.2a4.4 4.4 0 1 0 0 7.6" fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round"/><path d="M15.4 8.9 15 15.3M18 8.6l-.4 6.4" stroke="#000" stroke-width="1.15" stroke-linecap="round"/><path d="m13.9 11.6 5.4-1.3M13.9 14.1l5.4-1.3" stroke="#000" stroke-width="1.55" stroke-linecap="round"/>',
  },
  /** PHP: an elephant head, with ear fold, tusk and trunk wrinkles, in the PHP oval. */
  php: {
    hex: '#777bb4',
    body: '<ellipse cx="12" cy="12" rx="11.6" ry="8.2" fill="currentColor"/><path d="M.9 13.4c1.3 4 6 6.8 11.1 6.8s9.8-2.8 11.1-6.8c-2 3.2-6.2 5.3-11.1 5.3S2.9 16.6.9 13.4z" style="fill:color-mix(in srgb,currentColor 80%,#000)"/><path d="M2.1 10.4C3.3 6.7 7.3 4.6 12 4.6" fill="none" stroke-width=".8" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 62%,#fff)"/>',
    cuts: '<path d="M13.4 6.6c2.8-.9 5.4 1 5.4 4.1 0 2.6-1.8 4.6-4.2 4.6z" fill="#000"/><circle cx="12" cy="10.6" r="3.9" fill="#000"/><path d="M9 12.2c-.9 1.6-1 3.6-2.6 4.1-.9.3-1.6-.3-1.4-1.1" fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round"/>',
    over: '<path d="M13.9 7.4c1.8.1 3.1 1.5 3.1 3.3 0 1.4-.7 2.6-1.9 3.2" fill="none" stroke="currentColor" stroke-width=".85" stroke-linecap="round"/><path d="M14.6 8.7c1 .3 1.6 1.1 1.6 2.1 0 .8-.4 1.5-1 1.9-.3-1.4-.5-2.7-.6-4z" fill="currentColor" opacity=".32"/><path d="M8.6 13.3l.95.45M7.95 14.6l.9.55M7.2 15.7l.7.6" stroke="currentColor" stroke-width=".55" stroke-linecap="round" opacity=".6"/><path d="M10.1 13.4c.3.9 1 1.3 1.9 1.2" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="round"/><circle cx="11.2" cy="9.7" r=".65" fill="currentColor"/><circle cx="11.38" cy="9.5" r=".2" fill="#fff"/>',
  },
  /** Ruby: a brilliant cut in twelve shaded facets, with a sparkle. */
  ruby: {
    hex: '#cc342d',
    body: '<path d="M2 8.4L8 3.4L6.2 8.4Z" style="fill:color-mix(in srgb,currentColor 70%,#fff)"/><path d="M6.2 8.4L8 3.4L9.6 8.4Z" style="fill:color-mix(in srgb,currentColor 58%,#fff)"/><path d="M8 3.4L12 3.4L12 8.4L9.6 8.4Z" style="fill:color-mix(in srgb,currentColor 46%,#fff)"/><path d="M12 3.4L16 3.4L14.4 8.4L12 8.4Z" style="fill:color-mix(in srgb,currentColor 54%,#fff)"/><path d="M14.4 8.4L16 3.4L17.8 8.4Z" style="fill:color-mix(in srgb,currentColor 64%,#fff)"/><path d="M17.8 8.4L16 3.4L22 8.4Z" style="fill:color-mix(in srgb,currentColor 80%,#fff)"/><path d="M2 8.4L6.2 8.4L12 21.6Z" fill="currentColor"/><path d="M6.2 8.4L9.6 8.4L12 21.6Z" style="fill:color-mix(in srgb,currentColor 84%,#fff)"/><path d="M9.6 8.4L12 8.4L12 21.6Z" style="fill:color-mix(in srgb,currentColor 90%,#fff)"/><path d="M12 8.4L14.4 8.4L12 21.6Z" style="fill:color-mix(in srgb,currentColor 92%,#000)"/><path d="M14.4 8.4L17.8 8.4L12 21.6Z" style="fill:color-mix(in srgb,currentColor 84%,#000)"/><path d="M17.8 8.4L22 8.4L12 21.6Z" style="fill:color-mix(in srgb,currentColor 72%,#000)"/>',
    cuts: '<path d="M2 8.4h20M8 3.4h8M6.2 8.4L12 21.6M9.6 8.4L12 21.6M12 8.4L12 21.6M14.4 8.4L12 21.6M17.8 8.4L12 21.6M2 8.4 8 3.4 6.2 8.4M8 3.4 9.6 8.4M12 3.4 9.6 8.4M12 3.4 14.4 8.4M16 3.4 14.4 8.4M16 3.4 17.8 8.4 22 8.4" fill="none" stroke="#000" stroke-width=".45" stroke-linejoin="round"/>',
    over: '<path d="M6.6 4.9 7 6l1.1.4L7 6.8l-.4 1.1-.4-1.1-1.1-.4L6.2 6z" fill="#fff"/>',
  },
  /** Rust: a crab after Ferris, the public-domain Rust mascot (our own drawing). */
  rust: {
    hex: '#c2410c',
    body: '<path d="M6 15.2 3.6 15.9 2.4 17.6M6.7 16.9 5 18.4l-.4 2M18 15.2l2.4.7 1.2 1.7M17.3 16.9l1.7 1.5.4 2" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="stroke:color-mix(in srgb,currentColor 84%,#000)"/><path d="M5.1 8.3q.6 2.1 2.5 3.2M18.9 8.3q-.6 2.1-2.5 3.2" fill="none" stroke-width="1.9" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 88%,#000)"/><circle cx="4.2" cy="5.6" r="2.9" fill="currentColor"/><circle cx="19.8" cy="5.6" r="2.9" fill="currentColor"/><circle cx="3.2" cy="6.4" r="1" style="fill:color-mix(in srgb,currentColor 62%,#fff)"/><circle cx="18.8" cy="6.4" r="1" style="fill:color-mix(in srgb,currentColor 62%,#fff)"/><path d="M4.6 14.4c0-2.6 2-4.4 3.4-4.6.6-.9 1.4-1.3 2.1-1 .6-.6 1.3-.6 1.9-.6s1.3 0 1.9.6c.7-.3 1.5.1 2.1 1 1.4.2 3.4 2 3.4 4.6 0 2.4-3.3 3.9-7.4 3.9s-7.4-1.5-7.4-3.9z" fill="currentColor"/><path d="M4.7 15c.6 1.9 3.5 3.3 7.3 3.3s6.7-1.4 7.3-3.3c-1.4 1.1-4.1 1.9-7.3 1.9s-5.9-.8-7.3-1.9z" style="fill:color-mix(in srgb,currentColor 76%,#000)"/><path d="M7.4 10.6c.6-.8 1.5-1.2 2.4-.9M14.2 9.7c.9-.3 1.8.1 2.4.9" fill="none" stroke-width=".75" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 52%,#fff)"/><circle cx="7.6" cy="14.4" r=".55" style="fill:color-mix(in srgb,currentColor 72%,#fff)"/><circle cx="16.4" cy="14.4" r=".55" style="fill:color-mix(in srgb,currentColor 72%,#fff)"/><circle cx="12" cy="10.3" r=".45" style="fill:color-mix(in srgb,currentColor 72%,#fff)"/>',
    cuts: '<path d="M4.2 5.6 2.9 1.9h2.9zM19.8 5.6l-1.3-3.7h2.9z" fill="#000"/><circle cx="10" cy="12.8" r="1.25" fill="#000"/><circle cx="14" cy="12.8" r="1.25" fill="#000"/><path d="M10.7 15.4q1.3.9 2.6 0" fill="none" stroke="#000" stroke-width=".85" stroke-linecap="round"/>',
    over: '<circle cx="10.2" cy="13" r=".58" fill="#1b1a17"/><circle cx="14.2" cy="13" r=".58" fill="#1b1a17"/><circle cx="10.4" cy="12.75" r=".2" fill="#fff"/><circle cx="14.4" cy="12.75" r=".2" fill="#fff"/>',
  },
  /** R: a lit two-tone ring behind a bevelled R. */
  r: {
    hex: '#276dc3',
    body: '<ellipse cx="12" cy="10.2" rx="9.8" ry="6.4" transform="rotate(-10 12 10.2)" fill="none" stroke="#9aa1ab" stroke-width="2.7"/><ellipse cx="12" cy="10.2" rx="9.8" ry="6.4" transform="rotate(-10 12 10.2)" fill="none" stroke="#d6dae0" stroke-width=".7" stroke-dasharray="18 60" stroke-dashoffset="-34"/><ellipse cx="12" cy="10.2" rx="9.8" ry="6.4" transform="rotate(-10 12 10.2)" fill="none" stroke="#6f7680" stroke-width=".7" stroke-dasharray="16 60" stroke-dashoffset="2" opacity=".8"/>',
    cuts: '<path d="M9.6 21V9.4h5.1a3.15 3.15 0 0 1 0 6.3H9.6M14.3 15.7l3.9 5.3" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
    over: '<path d="M9.6 21V9.4h5.1a3.15 3.15 0 0 1 0 6.3H9.6M14.3 15.7l3.9 5.3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.85 20.2V10.2" fill="none" stroke-width=".7" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 55%,#fff)"/>',
  },
  /** SQL: a lit database cylinder whose bands are table rows, with a key on top. */
  sql: {
    hex: '#e38c00',
    body: '<path d="M4 6v12.4c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4V6z" fill="currentColor"/><path d="M17.4 8.6V20.8c1.6-.6 2.6-1.4 2.6-2.4V6c0 1-1 1.9-2.6 2.6z" style="fill:color-mix(in srgb,currentColor 82%,#000)"/><path d="M5.3 9.2v9.4" fill="none" stroke-width="1" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 58%,#fff)"/><ellipse cx="12" cy="6" rx="8" ry="3.4" style="fill:color-mix(in srgb,currentColor 62%,#fff)"/>',
    cuts: '<path d="M4 6c0 1.9 3.6 3.4 8 3.4S20 7.9 20 6M4 10.9c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4M4 15.4c0 1.9 3.6 3.4 8 3.4s8-1.5 8-3.4M9 9.2v12.2M15 9.2v12.2" fill="none" stroke="#000" stroke-width=".95"/>',
    over: '<g fill="none" stroke-width=".8" stroke-linecap="round" style="stroke:color-mix(in srgb,currentColor 70%,#000)"><circle cx="9.6" cy="5.9" r="1.05"/><path d="M10.65 5.9h3.8M13.1 5.9v.9M14.3 5.9v.7"/></g>',
  },
  /** Shell: a terminal with a title bar, log lines and a green prompt; the cursor blinks on its row's hover or focus. */
  shell: {
    hex: '#23262c',
    body: '<rect x="1.5" y="3.2" width="21" height="17.6" rx="3.8" fill="#23262c"/><path d="M5.3 3.2h13.4a3.8 3.8 0 0 1 3.8 3.8v.1h-21V7a3.8 3.8 0 0 1 3.8-3.8z" fill="#30343c"/><rect x="1.5" y="3.2" width="21" height="17.6" rx="3.8" fill="none" stroke="#ffffff" stroke-opacity=".16"/><circle cx="4.9" cy="5.2" r=".85" fill="#ff5f57"/><circle cx="7.3" cy="5.2" r=".85" fill="#febc2e"/><circle cx="9.7" cy="5.2" r=".85" fill="#28c840"/><circle cx="4.7" cy="4.95" r=".28" fill="#fff" opacity=".55"/><circle cx="7.1" cy="4.95" r=".28" fill="#fff" opacity=".55"/><circle cx="9.5" cy="4.95" r=".28" fill="#fff" opacity=".55"/><path d="M4.6 9.6h9M4.6 11.6h6" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".2"/>',
    over: '<path d="m4.7 13.7 2.5 2.2-2.5 2.2" fill="none" stroke="#3ddc84" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 17.9h4.6" stroke="#e6e6e6" stroke-width="1.5" stroke-linecap="round" opacity=".85"/><path data-blok-code-logo-cursor="" d="M15.3 17.9h3.2" stroke="#3ddc84" stroke-width="1.5" stroke-linecap="round"/>',
  },
};
