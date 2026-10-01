# Image Darkroom — Geometry (project 2) and Adjust + Filters (project 3)

Follows `2026-09-30-image-darkroom-design.md` (project 1, shipped 1b6f481d).
Both projects stay **non-destructive**: edits are saved as data and applied with CSS
at render time. The file is never re-encoded.

## Saved data (additive, NOT breaking)

New optional top-level fields on `ImageData`. Absent = today's behaviour, so old
documents render the same and old renderers just ignore the new fields.

```ts
/** Clockwise quarter turn, applied after the mirror. */
export type ImageRotation = 0 | 90 | 180 | 270;

export type ImageFilterPreset =
  'none' | 'vivid' | 'dramatic' | 'warm' | 'mono' | 'noir' | 'fade' | 'sepia';

/** Each value is -100..100; 0 (or absent) = unchanged. */
export interface ImageAdjust { brightness?: number; contrast?: number; saturation?: number }

interface ImageData {
  rotation?: ImageRotation;   // omit for 0
  flipX?: boolean;            // mirror left↔right, BEFORE rotation. omit for false
  straighten?: number;        // degrees, -45..45, clockwise, after rotation. omit for 0
  filter?: ImageFilterPreset; // omit for 'none'
  adjust?: ImageAdjust;       // omit when every value is 0
}
```

Normalisation (`save()` and render): unknown values are dropped; `straighten` is
clamped to ±45 and rounded to 0.1; adjust values are clamped to ±100 and rounded to
integers; zero entries are removed; an empty `adjust` is removed.

### Coordinate model

- **Oriented image O** = the natural image mirrored (if `flipX`), then turned by
  `rotation`. Its size is the natural size, swapped for 90/270.
- **Straighten** turns O's content by θ about O's centre. O's box does not move.
- **`crop`** (x, y, w, h in percent) is an axis-aligned rect in **O's box**. It must
  stay inside O's box (0..100, as today) AND be fully covered by the turned content.
  With θ = 0 and no rotation/flip this is exactly today's meaning.
- With θ ≠ 0 the crop is never the full rect, so `crop` is always present then.

## Shared pure modules

### `src/tools/image/geometry.ts`

```ts
export interface Geometry { rotation: ImageRotation; flipX: boolean; straighten: number }
export const IDENTITY: Geometry;
export function readGeometry(data: Partial<ImageData>): Geometry;          // normalises
export function geometryFields(g: Geometry): Pick<ImageData,'rotation'|'flipX'|'straighten'>; // omits defaults
export function isIdentity(g: Geometry): boolean;
export function orientedSize(n: Size, g: Geometry): Size;                   // swap on 90/270
/** View-space turn: rotate the result 90° counter-clockwise (iOS button). */
export function rotateLeft(g: Geometry, crop: ImageCrop): { g: Geometry; crop: ImageCrop };
/** View-space mirror left↔right. */
export function flipHorizontal(g: Geometry, crop: ImageCrop): { g: Geometry; crop: ImageCrop };
/** Min camera scale s (stage px per O px) so a frame of `frame` stage px fits inside O turned by θ (degrees). */
export function coverScale(frame: Size, o: Size, theta: number): number;
/** Clamp a frame centre (O px, origin = O's top-left) so the frame (O px), turned back by -θ, stays inside O. */
export function clampCentre(c: Point, frame: Size /* O px */, o: Size, theta: number): Point;
/** Fit a crop inside the turned content (shrinks about its centre, keeps aspect). */
export function coverCrop(crop: ImageCrop, o: Size, theta: number): ImageCrop;
/** CSS for the <img> inside an O-sized plane: size %, offset %, transform. */
export function planeImageStyle(n: Size, g: Geometry): { width: string; height: string; left: string; top: string; transform: string };
```

Rules derived for the code:

- Mirror then turn: `transform: rotate(θ + q·90deg) scaleX(-1)` on the img, origin
  centre (CSS applies right to left, so the mirror runs first).
- `rotateLeft`: q' = (q + 3) % 4; crop' = { x: y, y: 100 − x − w, w: h, h: w }; θ kept.
- `flipHorizontal`: q' = (4 − q) % 4; flipX' = !flipX; θ' = −θ; crop' = { x: 100 − x − w, ... }.
- Cover test is exact: a rect fits in an axis-aligned box iff its bounding box does,
  so the frame turned by −θ fits O iff
  `(fw·|cos θ| + fh·|sin θ|) ≤ O.w` and `(fw·|sin θ| + fh·|cos θ|) ≤ O.h`, and the
  centre clamp is that bbox's half extents in O's local (un-turned) axes.

### `src/tools/image/adjust.ts`

```ts
export const FILTER_PRESETS: readonly ImageFilterPreset[]; // 'none' first
export const ADJUST_KEYS: readonly (keyof ImageAdjust)[];  // brightness, contrast, saturation
export function readAdjust(data: Partial<ImageData>): { filter: ImageFilterPreset; adjust: Required<ImageAdjust> };
export function adjustFields(filter, adjust): Pick<ImageData,'filter'|'adjust'>; // omits defaults
/** CSS `filter` value; '' when nothing applies. Preset first, then adjust. */
export function cssFilter(filter: ImageFilterPreset, adjust: ImageAdjust): string;
```

Mapping (only CSS filter functions, so the editor preview and every renderer match):

- brightness b → `brightness(1 + b/200)` (0.5..1.5)
- contrast c → `contrast(1 + c/200)`
- saturation s → `saturate(1 + s/100)` (0..2)
- No warmth control: CSS filters cannot add a cool (blue) tint without an SVG filter,
  and an SVG filter does not travel with the data. Warm lives in a preset.
- Each adjust function is emitted only when its value is non-zero, in the order
  brightness, contrast, saturate.
- presets: vivid `saturate(1.35) contrast(1.1)`, dramatic `contrast(1.3) saturate(1.15) brightness(0.95)`,
  warm `sepia(0.25) saturate(1.25)`, mono `grayscale(1)`, noir `grayscale(1) contrast(1.4) brightness(0.9)`,
  fade `contrast(0.85) brightness(1.08) saturate(0.75)`, sepia `sepia(0.75)`.

## Renderers

Every place that draws the image honours geometry + filter the same way:

1. `renderImage` (`ui.ts`) — editor and read-only block.
2. The lightbox (`ui.ts`).
3. The darkroom photo, its fly-in and the fly-out clone (`darkroom/`).

**Identity geometry keeps today's DOM byte for byte** (wrapper > img with
`translate(-x%, -y%)` when cropped, bare img otherwise), so old documents and every
existing test pin render unchanged. Only a non-identity geometry adds the plane:

```
wrapper .blok-image-crop [data-role=image-crop]  overflow:hidden, aspect = crop px aspect in O
  plane  [data-role=image-plane]  width (100/w)·100%, aspect O.w/O.h, translate(-x%, -y%), position:relative
    <img> position:absolute, planeImageStyle(n, g)
```

Non-identity geometry without crop uses crop = full rect. Filters go on the `<img>`
as `style.filter` in every branch.

**One builder.** `src/tools/image/image-view.ts` exports the DOM builder used by
`renderImage`, the lightbox, the darkroom photo and the fly-out clone, so the four
paths cannot drift (the table-cell five-copies failure). `cssFilter` and
`planeImageStyle` are the only style sources.

Natural size is needed for a non-identity geometry (the img box is not the plane
box). Use `data.naturalWidth/Height` when cached, else measure on load. Until it is
known the img stays `visibility: hidden` (stretching a 90° image into a square plane
would flash a distorted frame).

Other touch points that must learn the new fields:

- `ImageTool.save()` rebuilds `out` field by field; `validate()`; `document-schema.ts`
  (the image object has `additionalProperties: false`).
- `collectNavigation` and both `openLightbox` call sites pass the new fields.
- `index.ts` sets the figure `aspect-ratio` from the natural size: use the oriented size.
- `applyCrop`'s `widthForAspectChange` must compare oriented aspects.
- `media-height.ts` and the resizer measure `.blok-image-crop ?? img`: a non-identity
  geometry always has the wrapper, so it must be measured, never the turned img.

Static HTML (`src/view/emitters.ts`) ignores crop today; it keeps ignoring geometry
and filters. The Markdown loss report adds `rotation`, `mirror`, `straighten`,
`filter`, `adjustments`. `document-schema.ts` documents the new fields.

## Darkroom UI

- **Mode switcher** (now that a second mode exists): a `role="tablist"` segmented
  control above the bottom panel: Crop · Adjust · Filters. Each tab has
  `aria-controls` to its `role="tabpanel"`; Left/Right/Home/End move and select
  (automatic activation); inactive panels are `hidden`. Opacity-only dissolve for
  the chrome during gestures, as today.
- **Crop mode** (moment 3 added):
  - The ratio pill as today.
  - Rotate-left button and Flip button in the top bar's lead, after Reset. Each is one
    history step. Rotate springs the photo through −90° (reduced motion: jump).
  - **Straighten dial**: a horizontal ruler under the frame, `role="slider"`,
    −45..45, `aria-valuenow`, arrows ±1°, Shift ±5°, Home = 0. Drag scrubs; the photo
    turns under the steady frame and auto-zooms to stay covered (cover rule above);
    the thirds grid shows while scrubbing. A detent snaps to 0 within 1°. One history
    step per drag.
- **Adjust mode**: a radiogroup of three tools (Brightness, Contrast, Saturation). The selected tool drives the same ruler dial, −100..100. Each tool's chip
  shows a dot when non-zero.
- **Filters mode**: a radiogroup strip of thumbnails, each the photo with that
  preset's CSS filter, labelled by name. Selection applies live.
- **Reset** resets everything (crop, geometry, adjust, filter).
- **Done** returns `DarkroomResult`:
  `{ crop: ImageCrop | null; geometry: Geometry; filter: ImageFilterPreset; adjust: Required<ImageAdjust> }`.
  `ImageTool.applyCrop` writes them back through `geometryFields`/`adjustFields`.
- **History** snapshots hold the whole edit state (rect, ratioKey, geometry, filter,
  adjust). Rotation/flip/chip/preset are one step each; a dial drag or a dial key
  burst (250 ms idle) is one step.
- The selected mode tab, tool chip and filter thumbnail are never blue (neutral
  tokens, checked by a test).

## i18n

New keys under `tools.image.*` (20): `editModes` (tablist label), `editModeCrop`,
`editModeAdjust`, `editModeFilters`, `rotateLeft`, `flip`, `straighten`,
`adjustTools` (group label), `adjustBrightness`, `adjustContrast`, `adjustSaturation`,
`filterPresets` (group label), `filterNone`, `filterVivid`, `filterDramatic`,
`filterWarm`, `filterMono`, `filterNoir`, `filterFade`, `filterSepia`. All 69 locales,
per the i18n new-key checklist.

## Icons

`IconRotateLeft` and `IconFlipHorizontal` (none exist today). Per
`src/components/icons/README.md`, `iconGroups` in `index.html`,
`generate-icons-dts`, and a relationship test.

## Darkroom components (standalone, unit-tested, then wired into `index.ts`)

```ts
// darkroom/dial.ts — the ruler used by Straighten and every Adjust tool
export interface DialOptions {
  min: number; max: number; value: number;
  step?: number;     // arrow key, default 1
  bigStep?: number;  // Shift+arrow, default 5
  label: string;     // aria-label
  valueText(v: number): string; // aria-valuetext
  onInput(v: number): void;     // every change while dragging / per key
  onCommit(v: number): void;    // pointerup, or 250 ms after the last key
}
export interface Dial { el: HTMLElement; set(v: number): void; configure(o: Pick<DialOptions,'min'|'max'|'label'|'valueText'> & { value: number }): void; destroy(): void }
export function createDial(o: DialOptions): Dial;
// role="slider", aria-valuemin/max/now/text, tabindex 0, Home = 0, End none.
// Drag: horizontal pointer drag, 1 unit per 6 px, snaps to 0 within 1 unit; ticks every 5.

// darkroom/mode-tabs.ts
export function createModeTabs(o: { modes: { key: string; label: string }[]; panels: Record<string, HTMLElement>;
  selected: string; label: string; onSelect(key: string): void }): { el: HTMLElement; select(key: string): void; destroy(): void };

// darkroom/adjust-panel.ts — tool radiogroup + one dial
export function createAdjustPanel(o: { i18n?: I18nInstance; value: Required<ImageAdjust>;
  onInput(a: Required<ImageAdjust>): void; onCommit(a: Required<ImageAdjust>): void }): { el: HTMLElement; set(a: Required<ImageAdjust>): void; destroy(): void };

// darkroom/filter-strip.ts — radiogroup of preset thumbnails
export function createFilterStrip(o: { i18n?: I18nInstance; url: string; value: ImageFilterPreset;
  onSelect(p: ImageFilterPreset): void }): { el: HTMLElement; set(p: ImageFilterPreset): void; destroy(): void };
```

## Testing (TDD)

- Pure: geometry (dihedral round trips: 4× rotateLeft = identity, 2× flip = identity,
  crop maps to the same pixels; cover exactness incl. θ = ±45; clampCentre), adjust
  (normalisation, css string, presets), history equality on the new fields.
- Renderer: wrapper/plane/img styles for every rotation × flip, filters in both
  branches, lightbox parity, save() normalisation.
- Darkroom wiring (jsdom): mode tabs, rotate/flip buttons, dial slider ARIA + keys,
  presets, Reset, Done result, undo across modes, neutral selected states.
- E2E: rotate + flip + straighten save the expected data and the block renders turned;
  a filter preset saves and the block's img carries the CSS filter; undo inside.

## Not breaking

All new fields are optional and additive; `ImageCrop` is unchanged. `openDarkroom`
is internal. New exported types in `types/tools/image.d.ts` only add surface.

**Forward-compatibility caveat (release note):** with `rotation`/`flipX`/`straighten`
set, `crop` is in oriented coordinates, so an OLDER Blok that ignores the new fields
shows the unturned image cropped to the wrong region.
