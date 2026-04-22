/**
 * Centralized helper for promoting blok-owned elements into the browser's
 * CSS Top Layer via the HTML Popover API.
 *
 * Why this module exists
 * ----------------------
 * The CSS Top Layer (entered via `popover="manual"` + `showPopover()`) escapes
 * every ancestor stacking context. It's the only reliable way to render blok
 * UI above arbitrary host-page content. But it comes with a UA stylesheet
 * that styles the `[popover]` attribute as a modal dialog:
 *
 *   - `position: fixed; inset: 0; margin: auto` → pins the element to the
 *     bottom-right corner of the viewport, ignoring any inline top/left.
 *   - `width: fit-content; height: max-content; max-width: 100vw;
 *     max-height: 100vh` → resizes the element.
 *   - `border: solid; padding: 0.25em` → adds visual chrome.
 *   - `background: Canvas` → paints a Canvas-color background underneath
 *     transparent areas of the element.
 *
 * Every blok floating-UI element promoted to the Top Layer must override
 * those defaults. Doing it per-element invites the bug where a new element
 * is added, the dev forgets the CSS reset, and the element renders in the
 * bottom-right corner of the viewport with a Canvas background.
 *
 * The chokepoint
 * --------------
 * `promoteToTopLayer` is the single sanctioned entry point. It tags the
 * element with `data-blok-top-layer="true"` so a single CSS rule in
 * `src/styles/main.css` can neutralize the UA defaults for every current and
 * future caller. An architectural test
 * (`test/unit/architecture/no-raw-popover-api.test.ts`) fails the build if
 * any source file outside this module touches the Popover API directly.
 */

const POPOVER_ATTR = 'popover';
const POPOVER_VALUE_MANUAL = 'manual';

/**
 * Marker attribute applied to every Top-Layer-promoted blok element. The
 * `[data-blok-top-layer][popover]` CSS rule in `src/styles/main.css` keys off
 * this attribute to neutralize UA `[popover]` defaults. Renaming this constant
 * requires a coordinated update to that rule (and its coverage test in
 * `test/unit/styles/top-layer-css.test.ts`).
 */
export const TOP_LAYER_MARKER_ATTR = 'data-blok-top-layer';

/**
 * Feature-detects the native HTML Popover API. Older Safari (<17) and older
 * Firefox (<125) lack it; helper calls become safe no-ops on those platforms.
 */
export const supportsPopoverAPI = (): boolean => {
  return typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
};

/**
 * Promote `el` into the CSS Top Layer.
 *
 * Sets `popover="manual"` (so the UA hands show/hide control to script),
 * tags the element with `data-blok-top-layer="true"` (so the CSS reset
 * applies), and calls `showPopover()`.
 *
 * @returns `true` if the element entered the Top Layer, `false` if the API
 * is unsupported or the call was rejected (already open, etc.). Callers that
 * need to fall back to z-index stacking can branch on the return value.
 */
export const promoteToTopLayer = (el: HTMLElement): boolean => {
  /**
   * Tag the element unconditionally — the `[data-blok-top-layer]` selector
   * drives the scoped CSS custom property inheritance in colors.css (so
   * tokens like `--blok-image-lightbox-backdrop` resolve on elements
   * appended to document.body). The tag has to land even on browsers that
   * lack the Popover API, otherwise the backdrop/toolbar backgrounds paint
   * transparent.
   */
  el.setAttribute(TOP_LAYER_MARKER_ATTR, 'true');

  if (!supportsPopoverAPI()) {
    return false;
  }

  if (!el.hasAttribute(POPOVER_ATTR)) {
    el.setAttribute(POPOVER_ATTR, POPOVER_VALUE_MANUAL);
  }

  try {
    el.showPopover();

    return true;
  } catch {
    /**
     * Most common reason: the element is already in the Top Layer (double
     * `show()` from racing event handlers). Caller can ignore.
     */
    return false;
  }
};

/**
 * Reverse of {@link promoteToTopLayer}. Hides the popover, removes the
 * `popover` attribute (so the UA `[popover]:not(:popover-open)` display:none
 * rule no longer applies) and clears the `data-blok-top-layer` marker.
 */
export const removeFromTopLayer = (el: HTMLElement): void => {
  /**
   * Always strip the marker — it was set unconditionally by promote() so
   * scoped CSS tokens could resolve without popover support.
   */
  el.removeAttribute(TOP_LAYER_MARKER_ATTR);

  if (!supportsPopoverAPI()) {
    return;
  }

  if (el.hasAttribute(POPOVER_ATTR)) {
    try {
      el.hidePopover();
    } catch {
      /**
       * Element wasn't open (already hidden, never promoted). Still need to
       * strip the attribute below.
       */
    }
    el.removeAttribute(POPOVER_ATTR);
  }
};

/**
 * @returns `true` if the element is currently tagged as Top-Layer-promoted by
 * this helper. Used by positioning math that needs to know whether the
 * containing block is the viewport (Top Layer) or the document (regular flow).
 */
export const isPromotedToTopLayer = (el: HTMLElement): boolean => {
  return el.hasAttribute(TOP_LAYER_MARKER_ATTR);
};

/**
 * Strip the `popover` attribute from an element WITHOUT calling hidePopover().
 *
 * Reserved for off-DOM measurement clones: the popover wrapper is cloned to
 * measure its dimensions, but UA `[popover]:not(:popover-open) { display:none }`
 * would zero out the clone's box. Removing the attribute restores layout for
 * the measurement, after which the clone is detached and discarded.
 *
 * Using this helper (rather than calling `removeAttribute('popover')` inline)
 * keeps the architectural rule "all popover-attribute manipulation lives in
 * this module" intact, so reviewers and future devs see the single chokepoint.
 */
export const stripPopoverAttribute = (el: HTMLElement): void => {
  el.removeAttribute(POPOVER_ATTR);
};
