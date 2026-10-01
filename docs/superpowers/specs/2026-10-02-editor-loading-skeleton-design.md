# Editor loading skeleton — design

Date: 2026-10-02
Status: approved in chat, awaiting spec review

## Goal

Show a polished loading animation while the editor waits for its document.
It is built into Blok and appears by default for every consumer. When data
arrives, the skeleton morphs into the real content.

## When it shows

Two real waits exist before first content:

1. `persistence.load()`: `Core.render()` (`src/components/core.ts`) awaits
   the host's promise before `Renderer.render()`.
2. Collaboration first sync: `Collaboration.load()` comes up empty and
   read-only. Blocks arrive when `firstSynced` or `cacheAdopted` first latches
   (`src/components/modules/collaboration/index.ts`).

When a host passes `data` directly, there is no wait and no loader.

### Anti-flash timing

- The skeleton appears only if the wait is still pending after `delay`
  (default 150 ms).
- Once visible, it stays at least 400 ms.
- A wait that finishes before `delay` shows nothing.

## Visual

### Waiting

- An overlay inside the editor wrapper shows a heading bar, three paragraph
  bars of uneven widths, and two list rows (bullet + bar).
- Bars use neutral gray tokens. No blue anywhere.
- One soft light band sweeps diagonally across all bars as a single
  gradient. The gradient is fixed to the overlay, not to each bar, so it
  reads as one beam over the page.
- Bars "breathe" (subtle opacity change), each with a phase offset.

### Handoff

1. Real blocks render under the overlay with opacity 0.
2. Bar `i` pairs with block holder `i` (by index).
3. FLIP: measure each bar and its target holder's content box. The bar
   glides and resizes onto that box.
4. The bar dissolves (opacity + small blur). The real block fades in and
   un-blurs.
5. Staggered top to bottom, ~40 ms apart, ~500 ms total.
6. Extra bars with no block fade out in place. Extra blocks fade in with
   the same stagger.
7. Overlay is removed when all animations finish.

`isReady` resolves after the handoff, so `autofocus` lands on visible
content. Handoff animations use WAAPI so they can be awaited and cancelled.

### Reduced motion

Under `prefers-reduced-motion: reduce`: static bars (no sweep, no
breathing) and a plain 150 ms crossfade, no FLIP.

## Accessibility

- Editor wrapper gets `aria-busy="true"` while loading.
- A visually hidden `role="status"` (polite) element says the `ui.loading`
  string ("Loading content…").
- Overlay is `aria-hidden="true"` and `inert`. It never takes focus or
  pointer events.

## Failure and teardown

- `load()` rejects: skeleton fades out, current error path is unchanged.
- `destroy()` during loading: timers and animations are cancelled, overlay
  removed, nothing leaks.

## Public surface (additive, not breaking)

None of these exist in v1.15.2.

### Config

In `types/configs/blok-config.d.ts`:

```ts
loader?: boolean | {
  /** Skeleton rows, top to bottom. Default: heading, 3 paragraphs, 2 list rows. */
  skeleton?: Array<'heading' | 'paragraph' | 'list'>;
  /** Ms to wait before showing. Default 150. */
  delay?: number;
};
```

Default `true`. `false` disables it.

### CSS tokens

With dark-mode values:

- `--blok-skeleton-bar`
- `--blok-skeleton-sheen`
- `--blok-skeleton-radius`

### Data attributes

- `data-blok-loading` on the editor wrapper while loading.
- `data-blok-testid="loading-skeleton"` on the overlay.
- Run `node scripts/generate-data-attributes-dts.mjs` after adding.

### i18n

One new key, `ui.loading`, in every locale (follow the
`blok-translations` skill and the 7-layer new-key checklist).

## Code layout

- `src/components/utils/loading-skeleton.ts`: builds overlay DOM from a
  skeleton spec. Pure.
- `src/components/utils/skeleton-handoff.ts`: FLIP handoff. Input: bar
  elements + target holders. Returns a promise. Respects reduced motion.
- `src/components/modules/ui.ts`: `showLoading()` / `hideLoading(holders)`.
  Owns the delay and minimum-visible timers, `aria-busy`, status text.
- `src/components/core.ts` `render()`: wraps the `load()` branch.
- `src/components/modules/collaboration/index.ts`: hides the loader when
  `firstSynced` or `cacheAdopted` first latches.
- `src/styles/loading.css` (new) + keyframes in `src/styles/keyframes.css`.
  CSS snapshot tests are updated on purpose.

## Testing (TDD)

Unit:

- Skeleton spec → correct bars (default and custom).
- Fake timers: nothing under `delay`; visible at least 400 ms.
- `aria-busy` and status text toggle.
- `loader: false` shows nothing.
- `load()` rejection removes overlay.
- `destroy()` mid-load cancels timers, removes overlay.
- Handoff pairs bars to holders by index; extra bars and extra blocks.
- Tokens are neutral (no blue), like `selected-state-neutral.test.ts`.

E2E (slow `persistence.load` fixture):

- Skeleton visible during load.
- Content appears, overlay gone.
- Caret and typing work afterwards.
- Reduced-motion emulation: no sweep animation.

Playground: `?slowLoad=2000` URL toggle to watch it.

## Out of scope

- Custom loader element / render callback.
- A loader for hosts that fetch data themselves and pass `data`.
