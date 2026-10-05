# Find bar: Bloom + Word hop — design

Status: approved direction (user picked "Word hop + Bloom" on 2026-10-05 from the GIF doc
https://claude.ai/code/artifact/a8c9340a-5bc1-4fdf-acce-deb91fa7aec9). Spec awaiting review.

## Goal

Make opening the find bar feel alive, in the springy, playful style of the approved embed morph
and notifier launch. The motion lives in the bar only.

- **Bloom.** The bar grows out of a dot in its corner. Width and height ride separate springs, so it
  stretches, overshoots and settles. Its parts land in reading order. Opening the replace row
  stretches the bar down on a spring.
- **Word hop.** When Cmd/Ctrl+F runs with text selected, a copy of that word lifts off the page,
  flies on an arc into the find field and lands with a squash.

## Must not change

- Match painting: the CSS highlights and the one 1.5px lens ring stay as they are. The hop never
  writes to editor DOM, so there is no Yjs write and no undo step. (Dimming the word on the page,
  shown in the mockup, is dropped: it would need a DOM write or a new highlight.)
- No new visible controls. The decorative layers below are `aria-hidden` and take no pointer events.
- Placement: the host's `find.placement` / `find.offset` decide where the bar rests. The bar's
  layout box is at its final size and spot from the first frame. Only paint animates.
- Close: keeps today's fade, which must fit the 120ms discrete `display`/`overlay` window.
- `prefers-reduced-motion: reduce`: no bloom, no hop, no spring. The bar appears as it does today
  under reduced motion.
- The `aria-live` counter text updates at once. Only its paint may be delayed.

## Probe results (2026-10-05, Chromium / Firefox / WebKit via Playwright)

| Mechanism | Result |
| --- | --- |
| `@starting-style` + transition on a `::before` | works in all three |
| WAAPI with `pseudoElement: '::before'` | works in all three |
| `linear()` overshoot on `grid-template-rows` 0fr→1fr | does NOT render; clamps at 1fr in all three |

So the springs are drawn by a decorative skin layer, not by the grid row.

## Mechanism

### Skin + clip (no layout animation)

- The bar's background, border radius and shadow move onto a `::before` "skin" on
  `[data-blok-find-bar]`. At rest it fills the bar (`inset: 0`).
- Bloom animates the skin's width and height from a 40px dot pinned to the bar's anchor corner.
  The bar's content is clipped to the same box with `clip-path: inset(...)`.
- The two springs have different stiffness, and `clip-path: inset()` is one property. So both the
  skin and the clip use keyframes *sampled* from the two springs, ~30 steps, with `easing: linear`.
  The sampled keyframes are computed in JS from the measured final size.
- The anchor corner follows placement and direction. It is top-end by default, bottom-* rows anchor
  at the bottom, and RTL mirrors "end". It matches today's `transform-origin` rules in `find.css`.
- The current `@starting-style` translate/scale entrance on `[data-blok-find-bar]` is removed, so
  two entrances never stack.

### Bloom choreography (open from closed)

| t (ms) | What |
| --- | --- |
| 0 | skin + clip start as a 40px dot; width spring (soft, ~200/17) and height spring (~320/19) begin |
| 0 | bar fades in over the first ~25% of the height spring |
| 60 | field grows from its start edge (`scaleX` .2 → 1) |
| 160 | query text slides in 8px from the start edge |
| 240 | counter rises in (existing roll curve) |
| 120 + 45·i | each control pops in (`scale` .3 → 1, small rotate) in reading order |

Every part animation uses WAAPI with `fill: 'backwards'`, so nothing is left as a resting inline
style when it ends. A bar reopened mid-close cancels the running animations first.

### Replace row

- Opening snaps the layout: the row's `0fr → 1fr` change has no transition on the way open. The
  skin and the content clip carry the spring instead. They grow from the old bar height to the new
  one with overshoot, plus a small width pinch (−14px at ~18%), then rest at `inset: 0`. This is the
  same skin + clip as the bloom, so content never shows outside the skin.
- The replace field drops from under the find field, then Replace and Replace all follow with
  70ms / 130ms delays.
- Closing the row keeps today's eased `1fr → 0fr` transition, with no spring.

### Word hop

- **Capture.** `Find.open()` reads the selection's on-screen rect and the computed font of its start
  element BEFORE `bar.open()` and `search({ reveal: true })`, because reveal can scroll.
- **It plays when ALL hold:**
  - the prefill came from a document range (not a host `<input>`/`<textarea>`, which has no rect);
  - the rect is non-empty and inside the viewport;
  - reduced motion is off (checked with `matchMedia` in JS).
- **Bar already open:** a re-press with a selection refills the query. It hops with no bloom.
- **The flight:** a temporary `aria-hidden` chip is placed in the dock, so it renders in the top
  layer. Its position is converted into the dock's coordinate space, because the center placement's
  `translate` makes the dock the containing block. It carries the copied font, size and colour and the
  selection tint. It flies a ~560ms arc (peak lift ~70px, spin up to −14°, scale up to 1.18) to the
  start of the input text, losing the tint as it goes. It starts 120ms into the bloom.
- **While in flight:** the input keeps its value and focus. Its text, caret and `select()` tint are
  hidden visually (`color` / `caret-color` transparent and the selection colour cleared, through a
  data attribute).
- **Landing:** the chip is removed, the input text shows, the field squashes (`scale(1.04, .9)`) and
  springs back, and the counter rolls in.
- **Interruptions:** typing, Escape/close, or a second Cmd/Ctrl+F during the flight ends the hop at
  once: chip removed, text shown.

### Code layout

- `src/components/modules/find/find-motion.ts` (new) holds:
  - the pure spring sampler: stiffness/damping → samples + duration;
  - `bloom(bar, corner)` → its animations;
  - `stretchSkin(bar, from, to)`;
  - `hop(dock, source, target)`.

  It has no Find state, so it is unit-testable.
- `find-bar.ts`: `open()` takes an optional `hop` source (rect + font). It calls bloom when opening
  from closed and hop when a source is given. `setReplaceOpen` calls `stretchSkin` and staggers the
  replace parts.
- The bar's paint moves from `[data-blok-find-bar]` to `[data-blok-find]::before`, and the exit fade
  moves from the bar to the dock. The skin is on the dock rather than the bar because the bar's own
  `clip-path` would clip a `::before` shadow.
- `index.ts`: `Find.open()` captures the hop source next to `selectedTextForPrefill()`.
- `find.css`: the skin `::before`, the in-flight attribute, and the reduced-motion guards. The old
  `@starting-style` bar entrance is removed.

## Tests (TDD: each written first and seen failing)

- **Unit, `find-motion.test.ts`:**
  - the sampler starts at 0, ends at 1 and overshoots for an underdamped spring;
  - bloom samples start at the dot and end at the full box for each anchor corner (incl. RTL, bottom).
- **Unit, `find-bar.test.ts`:**
  - open with a hop source creates and later removes the chip;
  - reduced motion → no animations and no chip;
  - a host-input prefill → no hop;
  - close mid-flight removes the chip and shows the text.
- **E2E, `find-in-page.spec.ts`:**
  - after the bloom settles, the bar sits exactly at the configured placement for top-end,
    bottom-start, top-center and RTL (the existing geometry specs must stay green);
  - Cmd/Ctrl+F on a selection shows a chip in flight, then the query text in the field, and the
    saved blocks and undo stack are unchanged;
  - the replace row ends with the replace field lined up under the find field (existing spec);
  - with `reducedMotion: 'reduce'`, the bar is fully visible on the first frame and no chip appears.

## Not a breaking change

This is visual only. No exported symbol, type, config key, data attribute, CSS variable or saved
data changes.

## Open, decided in the plan

- Whether the spring sampler should be shared with the notifier and embed (they have their own
  curves today). Default: keep it local to find. Extract only if a third user appears.
