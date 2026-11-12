# Media empty state "One surface" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the shared empty and uploading states of the image, video, audio and file blocks (and the cover picker card) to the "One surface" design picked in the lab.

**Architecture:** `renderMediaEmptyState` keeps its public shape (`MediaEmptyStateElement`, `setError`, `onFile`, `onUrl`, `sources`) but builds one surface instead of header + tabs + panel. Upload and link controls live in one grid cell and are switched by `data-mode` on the card, with no re-render. Upload progress stays in `image/uploading-state.ts` (now used by file too) and is restyled to the same surface; the drawings get new per-kind progress rules in `media-empty.css`.

**Tech Stack:** TypeScript, plain DOM, CSS (`src/styles`), Vitest + jsdom, Playwright.

**Spec:** the lab, `https://claude.ai/artifact/9e8iAWBGbXfrRJguFdWb5D` (version 10), and the trait list below, which is copied from it.

## Global Constraints

- TDD: every behaviour change starts with a failing test.
- Work in the worktree `~/Packages/.blok-undo/media-surface`. Commit there, `git fetch`, rebase on `origin/main`, push `HEAD:main`. Never commit in the shared checkout.
- Stage explicit paths only. Never reset or check out a path this plan did not write.
- Run only related tests, one vitest at a time, `--maxWorkers=2`, heap ≤ 4096 MB (tsc may use 6144 in a tracked-files copy).
- No attribution lines in commits.
- No blue selected states. No focus ring on click. Hints only on hover.
- Comments: short, only where something silently breaks.
- Do not touch `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json`.
- Locale keys are never removed (removing one changes the published `BlokMessageKey` union and every ledger digest). Retired keys stay in the dictionaries.
- Stable hooks that must keep working: `[data-blok-media-empty-state]`, `.blok-media-empty`, `.blok-media-empty__card`, `[data-blok-testid="file-input"]` (exactly one file input, present from first render), `[data-action="choose-file"]`, `[data-action="submit-url"]`, `[data-role="error"]`, `input[type="url"]`, `.blok-media-empty__embed-input`, `data-blok-field="text"` on the URL input's direct parent, `[data-blok-media-preview="<kind>"]`, `--blok-media-progress`, `data-uploading`, `[data-role="uploading|filename|pct|size|fill"]`, `[data-action="cancel"]`, every `blok-image-uploading__*` class.

## The design, trait by trait (the checklist)

**Surface (all blocks)**
- S1. One surface: `--blok-bg-secondary`, radius `--blok-radius-block`, 1px transparent border. No header strip, no inner panel, no tabs.
- S2. Row layout: drawing on the left (168px wide), then a column: title, sentence, actions. Padding `--blok-space-5` block / `--blok-space-6` inline, gap `--blok-space-6`.
- S3. Title: the block's existing "Add …" string, 16px, weight 650, letter-spacing -0.01em, `--blok-text-primary`.
- S4. Sentence under the title: 13.5px, `--blok-text-secondary`. One per block. The size limit follows it in `--blok-text-tertiary`, never wrapping inside itself, first letter upper-cased by CSS.
- S5. Actions, 12px below the sentence: primary "Choose …" (ink button with the up-arrow) and a ghost "From a link" button (white fill, 1px inset `--blok-border-primary`, chain icon, 13px/500).
- S6. Hover: border becomes `--blok-border-primary`; the drawing lifts and plays its demo (unchanged).
- S7. Drag a file over it: border `--blok-color-accent`, fill = 6% accent over the surface, title text becomes the "Drop to add" string in accent, sentence becomes "Let go anywhere in this block.", the drawing turns accent (unchanged rules). The buttons stay. No overlay.
- S8. Narrow (container ≤ 470px): column layout, everything centred, drawing 150px on top.
- S9. In the cover picker popover: no drawing, no fill of its own, padding 14px 14px 16px, title 14px, sentence 13px, left aligned. Buttons "Choose file" and "Link".
- S10. One source: upload-only has one button and its own sentence; link-only shows the field at once, no cross, sentence "Paste a link to it below."

**Link field (Quiet / Worded)**
- L1. "From a link" swaps the buttons for the field in the same place. The surface height does not change. Cross-fade 320ms with a 4px rise.
- L2. The field is the shared text field look (`data-blok-field="text"`: grey fill, no visible outline), 40px tall, max 440px wide.
- L3. Left: the chain icon. It stays a chain. It turns `--blok-text-primary` when the link is valid. No letter tile, no brand logo, no type badge.
- L4. The link text is coloured by the existing URL mirror: faded scheme and `www.`, dark host, muted path.
- L5. "Add ↵" is plain bold text with a small key cap, no black fill. It is not visible at all until the link is valid, then it slides in (max-width + opacity). Hover gives it the hover fill.
- L6. A cross button (28px, `aria-label` from `notifier.cancel`) at the far right closes the field: it clears the text, returns to the buttons and focuses "From a link". Esc in the field does the same.
- L7. Enter adds a valid link. Pasting does not add by itself.
- L8. Opening the field focuses the input.

**Uploading (all blocks)**
- U1. Same surface and row layout. Title = the status label ("Uploading"). Below: file name · percent (· size when known). Then a 2px bar: ink on `--blok-border-primary`, 12px below.
- U2. A small cross (existing cancel button) sits at the top right. (Not in the lab; uploads must stay cancellable.)
- U3. Image: the picture loads top to bottom behind a 2px accent scan line; the sun rises as it finishes; the photo straightens.
- U4. Video "Scrub": a 2px accent playhead crosses the screen left to right; the picture appears behind it; the timeline fills in accent in step; the play button is hidden while uploading.
- U5. Audio "Draw": bars start as dots (scaleY .1) and are drawn left to right with a small overshoot; the newest 2–3 bars are accent, older ones ink; the breathing animation stops; the two title lines write in.
- U6. File "Chunks": the page's lines and badge hide; a 5×5 grid of 7px squares fills in reading order (scale .45 → 1); the newest ~4 are accent, older ones ink-grey; in the last 4% the grid fades and the lines and badge return. The three sheets do not move. No blue wash.
- U7. At 100% the drawing lands with one bounce (520ms).
- U8. Reduced motion: no animation, progress still shown.

**Kept as is:** the drawings, their pointer tilt, shadows, hover demos, spring exit, the paste "catch" bounce, error line under the card, file paste, click or Enter/Space on the card opening the picker.

**Removed on purpose:** tabs and their keyboard model, the header label, the inner panel, the hint under the button, the separate size line, the drop overlay, the link read-back (letter tile, brand logo, type badge), the black Add button and its shine, the `swap` option, `src/tools/file/uploading-state.ts`.

## Review Focus

- A link-only block (`sources: 'url'`) must show a usable field with no cross and no way to reach an empty slot. Test in Task 2.
- Dragging a file while the link field is open must still upload and must not leave the field focused with stale text after the block re-renders. Test in Task 2.
- A very long file name in the uploading state must ellipsize and never push the percent or the cancel cross out of the surface. Test in Task 4 (e2e geometry).
- Long translations (German, Russian) of the sentence and both buttons must wrap, not overflow, at 320px. Test in Task 5 (e2e at 320px in `ru`).
- Progress values outside 0–100 and `NaN` must not break the drawings (`--blok-media-progress` clamped). Covered by the existing clamp tests; keep them green in Task 3.

---

### Task 1: New strings in every locale, passed to the renderer

**Files:**
- Modify: `src/components/i18n/locales/*.json` (69 files)
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md` (digests, retention rows if any value equals English)
- Modify: `test/unit/components/i18n/lifecycle-coverage.test.ts` (count pins), `test/unit/components/i18n/untranslated-strings.test.ts` (only if a retention is needed)
- Regenerate: `types/message-keys.d.ts` (`node scripts/generate-message-keys-dts.mjs`)
- Modify: `src/components/utils/media-empty-state.ts` (label fields only), `src/tools/{image,video,audio,file}/empty-state.ts`, `src/tools/audio/cover-picker.ts`
- Test: `test/unit/tools/{image,file}/empty-state.mutants.test.ts`, new `test/unit/components/i18n/media-one-surface-strings.test.ts`

**Interfaces:**
- Produces: new optional fields on `MediaEmptyStateLabels`: `hint: string`, `hintUpload: string`, `hintLink: string`, `dropAnywhere: string`, `cancelLink: string`. (Required from Task 2 on; the old `upload`, `orDropHere`, `sourceAria` fields are deleted in Task 2.)

New keys and English values (inserted right after each tool's `emptyAdd*` / `coverAdd` key):

| Key | English |
|---|---|
| `tools.image.emptyHint` | Drag a picture here, choose one from your device, or paste a link. |
| `tools.video.emptyHint` | Drag a video here, choose one from your device, or paste a link. |
| `tools.audio.emptyHint` | Drag an audio file here, choose one from your device, or paste a link. |
| `tools.file.emptyHint` | Drag any file here, choose one from your device, or paste a link. |
| `tools.image.emptyHintUpload` | Drag a picture here or choose one from your device. |
| `tools.video.emptyHintUpload` | Drag a video here or choose one from your device. |
| `tools.audio.emptyHintUpload` | Drag an audio file here or choose one from your device. |
| `tools.file.emptyHintUpload` | Drag any file here or choose one from your device. |
| `tools.image.emptyHintLink` | Paste a link to it below. (shared by all four blocks and the cover picker, like `tools.image.uploadingLabel`) |
| `tools.image.emptyDropAnywhere` | Let go anywhere in this block. (shared) |
| `tools.audio.coverHint` | Drag an image here, choose one, or paste a link. |

`cancelLink` uses the existing `notifier.cancel`.

- [ ] **Step 1: Failing test** `media-one-surface-strings.test.ts`: every locale has the 11 keys, non-empty, ending in the locale's sentence stop for the hint keys is NOT asserted (scripts differ); assert only presence, non-empty, and that no non-English locale value equals the English one. English values equal the table.
- [ ] **Step 2:** Run it; expect FAIL (keys missing).
- [ ] **Step 3:** Draft translations with five parallel subagents by locale group, each writing scratch JSON only (`{locale: {key: value}}`), told to reuse each locale's existing wording from `emptyOrDropHere`, `emptyChooseFile`, `emptyLink`, `emptyDropToUpload`. Apply with one script that inserts after the anchor key in every file.
- [ ] **Step 4:** Rewrite both ledger digest columns per locale; add retention rows + `COGNATE_RETENTIONS` only where a value must equal English; bump the `lifecycle-coverage` pins; regenerate `types/message-keys.d.ts`.
- [ ] **Step 5:** Add the label fields and pass them from the four adapters and the cover picker (`hint`, `hintUpload`, `hintLink`, `dropAnywhere`, `cancelLink`), with English fallbacks in the `tr(…)` callers that use them. Update the two `empty-state.mutants` tests' expected label objects first (fail), then the code (pass).
- [ ] **Step 6:** Run `test/unit/components/i18n/` (one run), the four empty-state test files, `published-types-no-src-refs`, and `node scripts/i18n/check-translations.mjs`. All green.
- [ ] **Step 7:** Commit `feat(media): strings for the one-surface empty state`, rebase, push.

### Task 2: The empty state becomes one surface, with the Quiet link field

**Files:**
- Modify: `src/components/utils/media-empty-state.ts`, `src/styles/media-empty.css`, `src/styles/media-empty-narrow.css`, `src/styles/audio.css` (cover picker card rules), `src/tools/audio/cover-picker.ts` (drop `swap`), the four `empty-state.ts` adapters (drop `upload`, `orDropHere`, `sourceAria`), `types/tools/media-source.d.ts` + `types/tools/{image,video,audio,file}.d.ts` (comments only)
- Test (rewrite first): `test/unit/components/utils/media-empty-state.test.ts`
- Test (update selectors): everything in the inventory that uses `[data-tab]`, `[data-src]`, `[role="tab"]`, `[role="tablist"]`, `.blok-media-empty__panel|__label|__tabs|__hint|__meta|__tile`, `embed-bar--large`, `data-site`, `data-logo`, `__embed-host`, `__embed-type`: tool empty-state/index/mutants tests, `media-url-upload-failure`, `media-upload-error`, `cover-picker.test.ts`, `input-fields.test.ts`, style tests (`media-preview-shadows`, `image-state-radius`, `media-radius`), e2e (`image.spec`, `video.spec`, `undo-audit/remaining.spec`, `field-entry-fields.spec`, `keyboard-and-focus.spec`, `rtl-block-content.spec`)
- Regenerate: `test/unit/styles/__snapshots__/main-css-rules.snap.txt`, `main-css-keyframes.snap.txt`; adjust `MEDIA_EMPTY_PREVIEW_BYTES` only if the budget is exceeded by this change alone

**Interfaces:**
- Produces DOM:
  ```
  div.blok-media-empty[data-blok-media-empty-state]            (container-type: inline-size)
    div.blok-media-empty__card[role=group][aria-label][tabindex=0][data-mode="upload|link"][data-sources][data-preview?]
      span.blok-media-preview                                   (only with `preview`)
      div.blok-media-empty__body
        div.blok-media-empty__title
        div.blok-media-empty__hint  > (text) + span.blok-media-empty__meta?
        div.blok-media-empty__slot
          div.blok-media-empty__actions                         (absent for sources 'url')
            button.blok-media-empty__choose[data-action="choose-file"]
            button.blok-media-empty__from-link[data-action="from-link"]   (only 'both')
          div.blok-media-empty__embed-bar[data-blok-field="text"][data-valid]   (absent for 'upload')
            span.blok-media-empty__embed-icon
            span.blok-media-empty__embed-mirror + input.blok-media-empty__embed-input[type=url]
            button.blok-media-empty__embed-submit[data-action="submit-url"]
            button.blok-media-empty__embed-cancel[data-action="cancel-link"]   (only 'both')
      input[type=file][hidden][data-blok-testid="file-input"]   (absent for 'url')
    div.blok-media-empty__error[data-role="error"][role="alert"]
  ```
- The inactive half of the slot carries `inert` and is hidden by CSS (`visibility: hidden; opacity: 0`).
- `MediaEmptyStateOptions.swap` and `MediaEmptyStateSwap` are deleted.

Tests to write first (names are the spec):
- `builds one surface: no tablist, no tabs, no header label, no panel`
- `shows the title, the sentence for the sources, and the size limit after it` (three sources × sentence field)
- `"From a link" switches data-mode to link, keeps the same nodes, focuses the URL input`
- `the cross and Esc clear the link, return to upload mode and focus "From a link"`
- `a link-only block starts in link mode with no cross and no file input`
- `an upload-only block has no "From a link" button and no URL field`
- `Add is aria-disabled and data-valid is false until the link is valid; Enter adds a valid link; a click on Add adds it`
- `the chain icon never turns into a letter or a logo` (no `data-site`, `data-logo`, no `__embed-host`)
- `dragging a file over the card swaps the title and sentence and restores them on leave and on drop`
- `a file dropped while the link field is open is uploaded`
- `exactly one file input exists from first render`
- `the drawing node is the same before and after switching modes, and is never put in upload mode by the link field`
- keep, adapted: pointer tilt (`--mx/--my` now tracked on the card), `data-hover`/`data-leaving`, paste catch, file paste, `setError` wiring, Enter/Space on the card.

CSS decisions not derivable from the tests: values in the trait list above; `.blok-media-empty__slot { display: grid }` with both halves in `grid-area: 1 / 1`; the Add button uses `max-width: 0 → 100px`; the cross is `28px`; link field `min-height: 40px`; keep the shared `[data-blok-field]` look (do not restyle fill or border); keep the mirror rules; delete the rules for removed parts and their rows in `media-radius.test.ts` / `image-state-radius.test.ts` in the same change; leave `__input`, `__search`, `__submit`, `__badge`, `__glyph` rules untouched (not part of this work).

- [ ] **Step 1:** Rewrite `media-empty-state.test.ts` to the list above. Run: FAIL.
- [ ] **Step 2:** Rewrite the renderer. Run: PASS.
- [ ] **Step 3:** Update the style tests to the new selectors and values (S1–S10, L1–L6). Run: FAIL. Rewrite the CSS. Run: PASS. Regenerate the two snapshots (`--update=all` scoped to `test/unit/styles/css-split-equivalence.test.ts`) and read the diff: only media-empty selectors may change.
- [ ] **Step 4:** Update every other unit test in the inventory (replace `[data-tab="embed"]` clicks with `[data-action="from-link"]`, `[data-tab="upload"]` with `[data-action="cancel-link"]`, delete tablist assertions, replace them with the mode assertions). Run each touched file alone.
- [ ] **Step 5:** Update the e2e specs: link flow helpers; `field-entry-fields` height 40; replace the two tablist a11y tests with "From a link opens the field and focuses it" and "Esc returns focus to From a link"; RTL spec measures `__title` and `__actions`. Run those specs only.
- [ ] **Step 6:** Scoped eslint on changed files; tsc in a tracked-files copy.
- [ ] **Step 7:** Commit `feat(media)!: BREAKING the empty uploader is one surface, without tabs` with a `BREAKING CHANGE:` body (old markup: header + `role=tablist` + `data-tab`/`data-active-tab` + inner panel; new: one surface, `data-mode`, `data-action="from-link"`/`"cancel-link"`; migration: target the new hooks). Rebase, push.

### Task 3: Upload animations in the drawings

**Files:**
- Modify: `src/components/utils/media-preview-art.ts` (new parts), `src/components/utils/media-empty-preview.ts` (`data-done`), `src/styles/media-empty.css`
- Test: `test/unit/components/utils/media-preview-file-art.test.ts`, new `test/unit/components/utils/media-preview-upload-art.test.ts`, `test/unit/styles/media-preview-shadows.test.ts` (new CSS assertions), `test/unit/tools/image/uploading-state.test.ts` (data-done)

**Interfaces:**
- New parts, all `blok-media-preview__*`, single-outline shapes only (the 3D projector samples each shape as one path):
  - image: `__veil` rect over the screen (42,14,120×70), `__scan` rect (42,13.5,120×2)
  - video: `__veil` rect over the screen (32,16,136×62), `__playhead` rect (31.5,16,2×62)
  - file: 25 × `__chunk` rects, 7×7, `style="--n:0…24"`, x = 78 + (n mod 5)·9.75, y = 42 + ⌊n/5⌋·10, inside the front sheet; the `__fill` rect is removed from the file drawing
  - audio: the two title lines get `__line--write` with `--row: 0 / 1`
- `setPreviewProgress` also sets `data-done` when the value is ≥ 100 and removes it below; `clearPreviewProgress` removes it.
- All new progress rules are scoped by `[data-blok-media-preview="image|video|audio|file"]` so the embed scenes and the search drawing keep today's rules.

Tests first: the art contains the new parts with the geometry above and no multi-subpath paths; ids stay unique; CSS has, per kind, a `[data-uploading]` rule whose transform or fill reads `var(--p)` for veil, scan, playhead, bar, chunk; the play button group is hidden under `[data-uploading]` for video; a reduced-motion block covers the new animations; `--blok-media-progress` still defaults to 0; `data-done` toggles at 100.

- [ ] Steps: failing tests → art + helper → CSS (U3–U8) → snapshots → run `test/unit/components/utils/media-preview*`, `test/unit/styles/` files touched, the four index tests' uploading assertions → commit `feat(media): each drawing shows its upload in its own way`, push.

### Task 4: The uploading state is the same surface; file uses the shared one

**Files:**
- Modify: `src/styles/image.css` (`.blok-image-uploading*`), `src/styles/file.css` (delete `.blok-file-uploading*`, `.blok-file-bar*`, `.blok-file-cancel` rules), `src/tools/file/index.ts` (use `../image/uploading-state`), `index.html` (playground import), `test/unit/architecture/agent-coverage.ledger.ts`, `scripts/mutation-test-seconds.json`
- Delete: `src/tools/file/uploading-state.ts`, `test/unit/tools/file/uploading-state.test.ts`, `test/unit/tools/file/uploading-state.mutants.test.ts`
- Test: `test/unit/tools/file/index.test.ts` + `.mutants`, `test/unit/styles/image-uploading-layout.test.ts`, `media-radius.test.ts`, `image-state-radius.test.ts`, `test/unit/playground/block-states-spec.test.ts`, new e2e `test/playwright/tests/ui/media-uploading-surface.spec.ts`

**Interfaces:**
- Consumes: `renderUploadingState(opts: UploadingStateOptions): UploadingStateElement` from `src/tools/image/uploading-state.ts`, unchanged. File passes `statusLabel: tools.file.uploading`, `preview: 'file'`, `fileName`, `onCancel`, `i18n`.
- The image uploading DOM and classes do not change. Layout is CSS only: the card is a grid; header, panel and content use `display: contents`; areas `art | title cancel / art | name·pct·size / art | bar`.

Tests first: file block shows `[data-role="uploading"]` with `[data-blok-media-preview="file"]`, file name, percent, a cancel that aborts; style tests assert the card uses `--blok-bg-secondary`, `--blok-radius-block`, the 2px bar, and that the old file rules are gone; e2e: at 760px and 320px the name ellipsizes and the percent and cross stay inside the card, for a 120-character file name.

- [ ] Steps: failing tests → switch file → CSS → delete the file component and its tests → ledger/json/playground → snapshots → related unit + the new e2e → commit `feat(media): uploading looks like the empty state, for file too`, push.

### Task 5: Compare the real build with the lab, state by state

- [ ] Build and open the playground (`verify` skill, playwright-cli). For image, video, audio, file: screenshot at rest, hover, drag-over, link empty, link pasted, uploading at ~60% (throttled or stubbed uploader), light and dark, at 760px and 320px, plus the cover picker card in the database drawer, plus `ru` at 320px.
- [ ] Compare each against the trait list. Fix every difference with a test first; anything that cannot be matched is raised with the reason, not footnoted.
- [ ] Run the e2e specs that reference the uploader (inventory group 2), the selection-paint matrix for the four tools, and the a11y specs touched.
- [ ] Commit fixes in small slices, push.

### Task 6: Land

- [ ] `git fetch`; confirm `origin/main` contains every commit; check CI state for the pushed SHAs.
- [ ] Fast-forward the user's checkout if its tree allows it; otherwise say so.
- [ ] Update memory (`media-empty-one-surface-lab.md` → shipped, release note owed, BREAKING markup).
- [ ] Remove the worktree per the worktree rules.
