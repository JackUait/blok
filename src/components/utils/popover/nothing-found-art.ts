/**
 * Illustration for the popover's "Nothing found" state: an empty list with a
 * lens resting over it. Not a Blok Line icon (64x48, opacity tints, popover
 * background fill), so it lives here and not in the icons registry.
 * Kept on one line: whitespace between tags would become text and leak into
 * the message's textContent. The lens is filled with the popover background
 * so it hides the rows under it. The data-blok-nothing-found-* hooks are the
 * targets of the entry animation in popover-abstract.ts.
 */
export const NOTHING_FOUND_ART = '<svg width="64" height="48" viewBox="0 0 64 48" fill="none" aria-hidden="true" focusable="false" style="display:block;overflow:visible"><rect x="4.75" y="4.75" width="46.5" height="34.5" rx="8" fill="currentColor" fill-opacity="0.07" stroke="currentColor" stroke-opacity="0.22" stroke-width="1.5"/><g data-blok-nothing-found-row stroke="currentColor" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"><path d="M13 14.5h.01M19.5 14.5h22"/></g><g data-blok-nothing-found-row stroke="currentColor" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"><path d="M13 22h.01M19.5 22h16"/></g><g data-blok-nothing-found-row stroke="currentColor" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"><path d="M13 29.5h.01M19.5 29.5h10"/></g><g data-blok-nothing-found-lens style="transform-box:view-box;transform-origin:46px 33px"><circle cx="44" cy="31" r="8.25" fill="var(--blok-popover-bg)" stroke="currentColor" stroke-width="2"/><path d="M50 37l5.5 5.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></g></svg>';
