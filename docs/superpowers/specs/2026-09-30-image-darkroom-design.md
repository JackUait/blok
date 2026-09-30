# Image Darkroom — design

Date: 2026-09-30
Status: approved in brainstorming, awaiting spec review

## Goal

Replace the image crop modal with an immersive, always-dark editor that feels like
iOS Photos: the photo moves under a steady frame, every motion runs on springs,
and the photo flies out of its block and back in.

This is **project 1 of 3**:

1. **Darkroom shell** (this spec) — crop only, on today's saved data.
2. Geometry — rotate, straighten dial, flip. New optional saved fields, all renderers.
3. Adjust + Filters — non-destructive, saved as data, applied with CSS at render time.

Decided for projects 2–3: edits stay **non-destructive** (saved as data, applied at
render time, never baked into a new file). That is why the editor renders with DOM +
CSS, not canvas: the preview must use the same CSS the renderers will use.

## Non-goals

- Rotate, straighten, flip, Adjust, Filters, smart auto-crop.
- A mode switcher (Crop / Adjust / Filters). It appears only when a second mode exists.
- Any change to saved data. `ImageCrop` stays `{ x, y, w, h, shape? }` in percent of
  the intrinsic image.

## Not breaking

Saved data is unchanged. `openCropModal` and the crop editor live under `src/` with no
published surface. No `BREAKING` label.

## User-visible behaviour

### Look

- Full viewport, always dark in every theme (neutral black lets colours read true).
- Top bar: Cancel (left), live `W × H px` readout (centre, monospace), Done (right,
  white fill, black ink — never blue).
- Stage in the middle. The frame is centred and fitted to the largest box the stage
  allows at the crop's aspect.
- Bottom glass pill: Free, 1:1, 4:3, 16:9, Circle, Oval. The selected chip uses
  `--blok-icon-active-bg` / `--blok-icon-active-text` (neutral).

### Signature moments

| # | Moment | Behaviour |
|---|--------|-----------|
| 1 | Fly-in / fly-out | Photo lifts from the block into the Darkroom and flies back into the block after Done/Cancel. |
| 2 | Photo under a steady frame | Pan the photo, zoom around the pointer, handle release springs the frame back to centre-fit while the photo scales with it. Rubber-band past image edges. |
| 4 | Chrome dissolves | During a gesture the top bar and pill fade out; the thirds grid fades in. |
| 5 | Shape morph | Changing shape springs frame size and corner radius together; readout tweens. |
| 6 | Hold to peek | Hold still on the photo (~350 ms) or hold `\` to see the whole uncropped photo. |
| 8 | Undo inside | Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z step through edits while open. |

Moment 3 (straighten dial) belongs to project 2. Moment 7 (auto-crop) is dropped.

## Architecture

New module `src/tools/image/darkroom/`:

| File | Role | Pure? |
|------|------|-------|
| `index.ts` | `openDarkroom(opts)` — builds DOM, wires dialog, gestures, motion, history | no |
| `camera.ts` | rect ↔ camera conversion, cover/zoom limits, zoom-around-point | yes |
| `gestures.ts` | one pointer pipeline: pan, handle resize, pinch, wheel, hold-to-peek | no |
| `motion.ts` | fly-in, fly-out, chrome dissolve, shape morph orchestration | no |
| `history.ts` | snapshot stack with gesture grouping | yes |
| `darkroom.css` | all styles, dark tokens, reduced-motion paths | — |

Shared: `src/components/utils/spring.ts` — spring engine (pure, injectable clock).
The rubber-band curve stays in `src/tools/image/spring.ts`: `ui.ts` and two test files
import it, and the darkroom imports it from there too.

Kept: `crop-math.ts` (`clampRect`, `applyRatio`, `isFullRect`, `resizeRect`,
`widthForAspectChange`, `MIN = 5`).

Deleted: `crop-editor.ts`, `crop-editor.css`, `crop-modal.ts`, `crop-modal.css`.

### Entry point

`openDarkroom(opts)` takes today's `OpenCropModalOptions` plus
`sourceEl?: HTMLImageElement` (the block's rendered image, used for the fly-in/out).
It returns a teardown `() => void` (instant close), as today.

The single caller, `ImageTool.enterCrop` (`src/tools/image/index.ts`), switches to it.
`applyCrop` and `cancelCrop` keep their logic. The fly-out needs the post-apply block
image, so `openDarkroom` takes a `getTargetEl(): HTMLElement | null` callback that
it calls after `onApply`/`onCancel` has run.

### Dialog wiring

Built on `openModalDialog` (top layer, background `inert`, focus trap, focus restore):

- `outside: false` — the whole viewport is the surface; a drag released on the dark
  surround must never cancel.
- Escape dismisses through the dialog's layer only. The editor never adds its own
  Escape listener (one Escape must call `onCancel` once).
- The surface carries `data-blok-keyboard-owner`. `KeyboardController` stands down
  inside it, so Cmd+Z undoes the crop, not the document. Without it the key reaches
  the document: the dialog is outside every editor wrapper.
- Closing uses `close()`, not `closeAnimated()`: the fly-out runs on a clone outside
  the dialog, and `closeAnimated` only waits for a CSS `animationend` on one element.

### Camera model

State: `{ s, tx, ty }` for the photo, plus `frame: { w, h }` in stage pixels, plus
`shapeKey`.

- The photo is one `<img>` at natural size, positioned with
  `transform: translate(tx, ty) scale(s)`, `transform-origin: 0 0`. Composited, no
  per-frame layout.
- `rectToCamera(rect, natural, frameBox)`:
  `s = frameBox.w / (rect.w / 100 × natural.w)`,
  `tx = frameBox.x − rect.x / 100 × natural.w × s`, same for `ty`.
- `cameraToRect(camera, natural, frameBox)` is its inverse. The saved rect is only
  produced at open, Done and for the readout.
- Limits:
  - **Cover:** the photo always covers the frame. Min `s` = `max(frame.w / natural.w,
    frame.h / natural.h)`.
  - **Max zoom:** the crop can't be narrower than `MIN` (5%) of the image, so max
    `s` = `frame.w / (0.05 × natural.w)` (and the same for height).
  - Pan past the cover limit rubber-bands (`applyRubberBand`), springs back on release.
- `zoomAt(camera, factor, point)` keeps the image point under `point` fixed.
- Fallback when `naturalWidth` is 0 (SVG with no size): use the rendered box as the
  natural size and hide the readout.

### Gestures

One pointer pipeline on the stage, `touch-action: none`, pointer capture on start.

- **Pan:** one pointer on the photo, after moving more than 4 px.
- **Hold to peek:** one pointer that stays within 4 px for 350 ms. The dim fades out
  and shows the whole photo; release fades it back. Movement before 350 ms cancels
  the hold and starts a pan.
- **Handle resize:** 8 handles (edges only in Free and Oval, as today). The frame
  resizes on screen; the photo stays still. Ratio rules come from `applyRatio`.
  On release the frame springs to centre-fit and the camera scales with it so the
  framed content stays the same.
- **Pinch:** two pointers → `zoomAt` around their midpoint, with pan from the
  midpoint's movement.
- **Wheel:** `ctrlKey` (macOS trackpad pinch) or plain wheel → `zoomAt` around the
  pointer. A burst ends after 250 ms idle.

Keyboard, with the stage focused:

- Arrows pan 1% of the frame (Shift: 10%).
- `+` / `-` zoom about the frame centre.
- `\` held peeks.
- Enter = Done. Escape = Cancel (the dialog's path).
- The shape pill keeps `rovingRadioGroup`.

### Motion

**Spring engine** (`src/components/utils/spring.ts`):

- Multi-value spring: one instance animates a record of numbers.
- Critically damped by default. Stiffness, damping and mass are internal constants.
- Integrates on real elapsed time from an injectable clock (default:
  `requestAnimationFrame` + `performance.now`), so it doesn't depend on frame rate.
- `retarget(to)` keeps the current velocity.
- Settles when every |displacement| and |velocity| is below epsilon; fires `onSettle`.
- `prefers-reduced-motion`: jump straight to the target and settle at once.

**Fly-in:** the photo starts at `sourceEl.getBoundingClientRect()` with the block's
current crop and corner radius, and the surround starts at opacity 0. One spring drives
the camera, frame and radius to the stage fit while the surround fades in. `sourceEl`
gets `visibility: hidden` until the fly-out ends. If there's no `sourceEl`, or it's
off-screen, the fallback is a scale-from-0.96 plus fade.

**Fly-out:**

1. Freeze the photo at its final camera.
2. Call `onApply` (or `onCancel`), then close the dialog with `close()`.
3. Wait one frame. `getTargetEl()` gives the re-rendered block image. Measure it.
4. A clone of the framed photo (fixed position, top layer) springs to that box and
   radius while a surround clone fades out.
5. Remove the clones and show the block image.

If the target is missing or off-screen, cross-fade the clone out instead.

**Chrome dissolve:** at gesture start, the top bar and pill go to opacity 0 (120 ms)
and come back 400 ms after the gesture ends. Opacity only: never `hidden`,
`display: none` or `aria-hidden`, so focus and the focus trap are untouched. The
thirds grid does the reverse.

**Shape morph:** the frame is a box with `border-radius` and
`box-shadow: 0 0 0 9999px <dim>` as the mask. A shape change springs `frame.w`,
`frame.h` and the radius together (0 for a rectangle, 50% for Circle and Oval). The
readout shows the rect implied by the spring's current values.

### History

`history.ts`: a stack of `{ rect, shapeKey }` with a cursor.

- A new entry is pushed once per finished gesture: pointerup, the end of a wheel
  burst, a shape change, a keyboard nudge burst (250 ms idle), or Reset.
- Undo and redo move the cursor; the camera springs to the snapshot.
- A push after an undo drops the redo tail.
- Done passes only the final rect to `onApply`, so the document gets one undo step.
- Cancel throws the stack away.

### Done semantics (unchanged)

- Circle or Oval → `{ ...rect, shape }`.
- Rect covering the full image → `null`.
- Otherwise → `rect`.

## Accessibility

Kept (existing e2e contract):

- `role="dialog"`, labelled by `tools.image.cropDialogLabel`.
- Initial focus on Done.
- `data-action="done" | "cancel" | "reset"` on the buttons.
- The dim layer keeps `data-blok-testid="image-crop-backdrop"`.
- The ratio group is `role="radiogroup"` with roving focus; chips keep `data-ratio`.

New:

- The stage is focusable, `role="application"`, labelled with a new
  `tools.image.cropStageLabel` whose text names the keys.
- The readout is `aria-live="polite"` and updates once per settled gesture, not per
  frame.
- Reset stays in the top bar next to Cancel.

## Failure paths

- **Image fails to load:** show the shared media error state inside the Darkroom with
  only Cancel enabled.
- **Host re-renders or destroys the block mid-edit:** the teardown closes the
  Darkroom at once, with no fly-out (same as today's `detachCrop`).
- **Stage resize (window resize, rotation):** re-fit the frame and keep the rect. The
  camera is recomputed, not animated.

## i18n

New key: `tools.image.cropStageLabel`. Existing crop keys are reused. Add it across
every locale following the i18n new-key checklist.

## Testing (TDD — each test written and seen failing first)

Unit, pure:

- `camera`: rect → camera → rect round trip across aspects and zooms; cover minimum;
  max zoom at `MIN`; `zoomAt` keeps the point fixed; SVG zero-size fallback.
- `spring`: settles; retarget keeps velocity; multi-value; reduced motion jumps;
  frame-rate independent under a fake clock.
- `history`: grouping, undo/redo, the redo tail drops on push, Reset is an entry.

Unit, wiring (`openDarkroom` in jsdom):

- Surface has `data-blok-keyboard-owner`.
- Outside pointerdown does not cancel.
- Escape calls `onCancel` exactly once.
- Enter applies.
- Done semantics (circle/oval shape, full rect → `null`).
- Chrome dissolve never sets `hidden` or `aria-hidden`.
- The selected shape chip has no blue and uses neutral tokens.

Retired and replaced: `test/unit/tools/image/crop-editor.test.ts`,
`crop-editor.mutants.test.ts`, `test/unit/tools/image-crop-editor.test.ts`,
`image-crop-modal.test.ts`. Every other test that references the crop editor, modal
or CSS gets updated (grep `image-crop`, `crop-editor`, `openCropModal`).

E2E (`test/playwright/tests/tools/image-crop.spec.ts`, rewritten):

- Pan changes the saved crop.
- Wheel zoom narrows the crop.
- Handle release springs the frame back to centre.
- A shape change saves `shape`.
- Cmd+Z inside the Darkroom undoes a crop edit, not the document.
- Escape once cancels with no data change.
- The fly-out lands on the block's image box.
- A reduced-motion run applies with no animation.

## Open questions

None.
