# Image Chrome: Frame and Islands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the image block's single floating toolbar, gray resize bars and caption-row Alt chip with a selection ring, three split-animated tool islands, dot handles with a snapping width readout, and an on-image alt pill with an explaining hint.

**Architecture:** `renderOverlay` (`src/tools/image/ui.ts`) keeps every `data-action` button and groups them into `data-island` wrappers. A pure `island-placement.ts` decides whether islands float above the image or sit inside it. The shared `resizer.ts` gains opt-in snapping. The image tool (`src/tools/image/index.ts`) wires the ring, readout, placement and alt pill. All looks live in `src/styles/image.css` (+ the toolbar base rule in `main.css`) and new tokens in `colors.css`.

**Tech Stack:** TypeScript, plain DOM, CSS (custom properties, keyframes), Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-image-chrome-frame-islands-design.md`

## Global Constraints

- Image block only. Video and embed must behave exactly as today (they import `attachResizeHandle` from `src/tools/image/resizer.ts`).
- Every existing `data-action` name stays: `align-trigger`, `align-left|center|right`, `caption-toggle`, `replace`, `crop`, `fullscreen`, `download`, `more`, hidden `delete` alias, `alt-edit`.
- Saved data shape does not change. `data.width` stays a percent (10–100).
- "Selected" = block holder has `data-blok-selected="true"`. Never key new rules off the tool's `data-selected` (always `"false"`).
- Nothing selected or pressed is blue. Pressed = `--blok-icon-active-bg` / `--blok-icon-active-text`.
- Every new color is a token defined in all three places of `src/styles/colors.css`: bare `:root` (light, ~line 239), `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` (~line 639), `:root[data-theme="dark"]` (~line 828).
- `@media (prefers-reduced-motion: reduce)`: no animation, final state at once.
- Tier thresholds unchanged: medium < 360 px wide, compact < 230 px wide or < 80 px tall.
- Snap points `[25, 50, 75, 100]`, tolerance 2 (percent).
- Islands float 20 px above the figure; fallback sits 10 px inside the top edge.
- New i18n keys (English): `tools.image.altAdd` = "Add alt text", `tools.image.altHintTitle` = "What is alt text?", `tools.image.altHintBody` = "A short description of the image. Screen readers read it aloud, and browsers show it when the image can't load. Search engines use it too.", `tools.image.altExample` = "A golden retriever catching a frisbee".
- Comments: short, only for what silently breaks if changed (repo `CLAUDE.md`).
- Tests: run only the related files (user rule — never full `yarn test`). Multiple paths go in ONE vitest run.
- Another session edits `src/tools/image/index.ts` concurrently. Work in a worktree under `~/Packages/.blok-undo/`, commit per task, rebase on `origin/main` before pushing, never `git commit -a`.

## Review Focus

1. **Image is the first block / scrolled to top** — islands must not be cut off above the editor or the viewport; they drop inside. Pinned in Task 2 (unit) and Task 9 (e2e).
2. **Video and embed resizing** — must not start snapping. Pinned in Task 1 (no-`snapPoints` equivalence test).
3. **Caption hidden** — the alt pill must still show (today the chip vanishes with the caption). Pinned in Task 7.
4. **Hint over an open editor** — hovering the pill while the alt editor is open must show no hint. Pinned in Task 7 (unit) and Task 9 (e2e).
5. **Snapping below a table-cell floor** — a snap to 25 % must not undercut `minWidthPx`. Pinned in Task 1.

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/jackuait/Packages/blok
git fetch origin
git worktree add ~/Packages/.blok-undo/image-chrome -b image-chrome origin/main
cd ~/Packages/.blok-undo/image-chrome
yarn install --immutable
```

Every later path is relative to the worktree.

---

### Task 1: Opt-in width snapping in the shared resizer

**Files:**
- Modify: `src/tools/image/resizer.ts` (`ComputeWidthInput`, `computeWidthResult`, `AttachResizeHandleOptions`, `attachResizeHandle`)
- Modify: `src/tools/image/constants.ts` (new constants)
- Test: `test/unit/tools/image/resizer.test.ts`

**Interfaces:**
- Produces: `ComputeWidthInput.snapPoints?: readonly number[]`; `AttachResizeHandleOptions.snapPoints?: readonly number[]`; `export const IMAGE_SNAP_POINTS = [25, 50, 75, 100] as const`; `export const SNAP_TOLERANCE_PERCENT = 2`.

- [ ] **Step 1: Write the failing tests** (append to `resizer.test.ts`)

```ts
describe('computeWidthResult snapping', () => {
  const base = { edge: 'right' as const, containerWidth: 1000, startWidth: 600, startX: 0, alignFrac: 0 };

  it('without snapPoints the result is unchanged (video and embed path)', () => {
    expect(computeWidthResult({ ...base, currentX: -115 })).toEqual({ percent: 49, clampedToMin: false });
  });

  it('snaps to a point within 2 percent', () => {
    expect(computeWidthResult({ ...base, currentX: -115, snapPoints: [25, 50, 75, 100] }).percent).toBe(50);
    expect(computeWidthResult({ ...base, currentX: -70, snapPoints: [25, 50, 75, 100] }).percent).toBe(53);
  });

  it('snaps at exactly 2 percent away, not at 3', () => {
    expect(computeWidthResult({ ...base, currentX: -80, snapPoints: [50] }).percent).toBe(50);
    expect(computeWidthResult({ ...base, currentX: -70, snapPoints: [50] }).percent).toBe(53);
  });

  it('never snaps below a pixel floor', () => {
    const r = computeWidthResult({ ...base, currentX: -340, minWidthPx: 260, snapPoints: [25] });
    expect(r.percent).toBe(26);
    expect(r.clampedToMin).toBe(false);
  });
});
```

The numbers: right edge with `alignFrac: 0` moves the width 1:1 with the pointer. 600 − 115 = 485 px → 49 % (1 from 50, snaps). 600 − 80 = 520 → 52 % (exactly 2, snaps). 600 − 70 = 530 → 53 % (3, stays). 600 − 340 = 260 → 26 %, which is the 260 px floor; 25 is within 2 but below the floor, so it clamps back to 26.

Also add an `attachResizeHandle` test that passes `snapPoints` and checks `onPreview` receives the snapped value (copy the pointer-event pattern already used in this file's `attachResizeHandle` describe block; dispatch `pointerdown` at x=0, `pointermove` at x=-80 on a figure whose `getBoundingClientRect` width is stubbed to 600 and a container stubbed to 1000, `alignment: 'left'`; expect `onPreview` last called with `50`).

- [ ] **Step 2: Run to see them fail**

Run: `yarn test test/unit/tools/image/resizer.test.ts`
Expected: the snap tests FAIL (49/52 returned instead of 50); the "unchanged" test PASSES.

- [ ] **Step 3: Implement**

`constants.ts`, after `MAX_WIDTH_PERCENT`:

```ts
export const IMAGE_SNAP_POINTS = [25, 50, 75, 100] as const;
export const SNAP_TOLERANCE_PERCENT = 2;
```

`resizer.ts`: import `SNAP_TOLERANCE_PERCENT`; add to `ComputeWidthInput`:

```ts
  /** Widths (percent) the drag pulls to when within SNAP_TOLERANCE_PERCENT. Omit for no snapping. */
  snapPoints?: readonly number[];
```

In `computeWidthResult`, replace the last line:

```ts
  const snapped = snapTo(raw, input.snapPoints);
  return { percent: clampPercent(snapped, minPercent), clampedToMin: raw < floor };
```

and add below it:

```ts
function snapTo(value: number, points: readonly number[] | undefined): number {
  if (!points) return value;
  const hit = points.find((p) => Math.abs(value - p) <= SNAP_TOLERANCE_PERCENT);
  return hit ?? value;
}
```

Add `snapPoints?: readonly number[];` to `AttachResizeHandleOptions` and pass `snapPoints: opts.snapPoints` into the `computeWidthResult` call in `onMove`.

- [ ] **Step 4: Run to see them pass**

Run: `yarn test test/unit/tools/image/resizer.test.ts test/unit/tools/video test/unit/tools/link/embed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/resizer.ts src/tools/image/constants.ts test/unit/tools/image/resizer.test.ts
git commit -m "feat(image): opt-in width snapping in the shared resizer"
```

---

### Task 2: Island placement helper

**Files:**
- Create: `src/tools/image/island-placement.ts`
- Test: `test/unit/tools/image/island-placement.test.ts`

**Interfaces:**
- Produces: `export const ISLAND_GAP_PX = 20;` `export type IslandPlacement = 'above' | 'inside';` `export function resolveIslandPlacement(input: { figureTop: number; islandHeight: number; boundaryTop: number }): IslandPlacement;` `export function islandBoundaryTop(figure: HTMLElement): number;`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ISLAND_GAP_PX, islandBoundaryTop, resolveIslandPlacement } from '../../../../src/tools/image/island-placement';

describe('resolveIslandPlacement', () => {
  it('floats above when the islands fit between the boundary and the figure', () => {
    expect(resolveIslandPlacement({ figureTop: 200, islandHeight: 34, boundaryTop: 0 })).toBe('above');
  });

  it('fits exactly when the room equals island height plus the gap', () => {
    expect(resolveIslandPlacement({ figureTop: 34 + ISLAND_GAP_PX, islandHeight: 34, boundaryTop: 0 })).toBe('above');
    expect(resolveIslandPlacement({ figureTop: 34 + ISLAND_GAP_PX - 1, islandHeight: 34, boundaryTop: 0 })).toBe('inside');
  });

  it('sits inside when the figure is the first thing in the editor', () => {
    expect(resolveIslandPlacement({ figureTop: 108, islandHeight: 34, boundaryTop: 100 })).toBe('inside');
  });

  it('sits inside when the figure top is scrolled off screen', () => {
    expect(resolveIslandPlacement({ figureTop: -40, islandHeight: 34, boundaryTop: 0 })).toBe('inside');
  });
});

describe('islandBoundaryTop', () => {
  it('uses the editor top when it is below the viewport top', () => {
    const editor = document.createElement('div');
    editor.setAttribute('data-blok-redactor', '');
    const figure = document.createElement('div');
    editor.appendChild(figure);
    document.body.appendChild(editor);
    editor.getBoundingClientRect = () => ({ top: 120 } as DOMRect);
    expect(islandBoundaryTop(figure)).toBe(120);
    editor.remove();
  });

  it('uses the viewport top when the editor is scrolled above it', () => {
    const editor = document.createElement('div');
    editor.setAttribute('data-blok-redactor', '');
    const figure = document.createElement('div');
    editor.appendChild(figure);
    document.body.appendChild(editor);
    editor.getBoundingClientRect = () => ({ top: -500 } as DOMRect);
    expect(islandBoundaryTop(figure)).toBe(0);
    editor.remove();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn test test/unit/tools/image/island-placement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { DATA_ATTR } from '../../components/constants/data-attributes';

export const ISLAND_GAP_PX = 20;

export type IslandPlacement = 'above' | 'inside';

export function resolveIslandPlacement(input: {
  figureTop: number;
  islandHeight: number;
  boundaryTop: number;
}): IslandPlacement {
  const room = input.figureTop - input.boundaryTop;
  return room >= input.islandHeight + ISLAND_GAP_PX ? 'above' : 'inside';
}

/** The higher of the viewport top and the editor's top edge: islands must not poke out past either. */
export function islandBoundaryTop(figure: HTMLElement): number {
  const editor = figure.closest<HTMLElement>(`[${DATA_ATTR.redactor}]`);
  const editorTop = editor ? editor.getBoundingClientRect().top : 0;
  return Math.max(0, editorTop);
}
```

Check the import path compiles (`DATA_ATTR` is exported from `src/components/constants/data-attributes.ts`; `DATA_ATTR.redactor` = `'data-blok-redactor'`).

- [ ] **Step 4: Run it to see it pass**

Run: `yarn test test/unit/tools/image/island-placement.test.ts test/unit/architecture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/island-placement.ts test/unit/tools/image/island-placement.test.ts
git commit -m "feat(image): decide whether tool islands float above or sit inside"
```

---

### Task 3: Group the toolbar into islands

**Files:**
- Modify: `src/tools/image/ui.ts` (`renderOverlay`, remove `appendDivider`)
- Test: `test/unit/tools/image/ui.test.ts`, `test/unit/tools/image/ui.mutants.test.ts` (fix divider assertions)

**Interfaces:**
- Produces: toolbar root children are `[data-island="layout"]`, `[data-island="edit"]`, `[data-island="view"]`, then the hidden `delete` alias. Each island has class `blok-image-toolbar__island`.

- [ ] **Step 1: Write the failing test** (in the `renderOverlay` describe)

```ts
  it('groups the actions into layout, edit and view islands, in order', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    const islands = Array.from(overlay.querySelectorAll<HTMLElement>(':scope > [data-island]'));
    expect(islands.map((i) => i.dataset.island)).toEqual(['layout', 'edit', 'view']);
    const actions = (i: HTMLElement): string[] =>
      Array.from(i.querySelectorAll<HTMLElement>(':scope > button[data-action], :scope > div > button[data-action="align-trigger"]'))
        .map((b) => b.dataset.action ?? '');
    expect(actions(islands[0])).toEqual(['align-trigger', 'caption-toggle']);
    expect(actions(islands[1])).toEqual(['crop', 'replace']);
    expect(actions(islands[2])).toEqual(['fullscreen', 'download', 'more']);
  });

  it('draws no dividers — each island is its own card', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    expect(overlay.querySelector('.blok-image-toolbar__divider')).toBeNull();
  });

  it('keeps the hidden delete alias outside the islands', () => {
    const overlay = renderOverlay(makeOverlayOpts());
    const alias = overlay.querySelector('[data-action="delete"]');
    expect(alias?.parentElement).toBe(overlay);
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `yarn test test/unit/tools/image/ui.test.ts -t "islands|dividers|delete alias"`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `renderOverlay`, replace the body between `root.className = ...` and the delete alias with:

```ts
  const layout = appendIsland(root, 'layout');
  appendAlignCtrl(layout, opts);
  appendSimpleButton(layout, {
    action: 'caption-toggle',
    label: tr(opts.i18n, 'tools.image.toggleCaption'),
    pressed: opts.state.captionVisible,
    icon: IconCaption,
    onClick: opts.onToggleCaption,
  });

  const edit = appendIsland(root, 'edit');
  appendSimpleButton(edit, { action: 'crop', label: tr(opts.i18n, 'tools.image.crop'), icon: IconCrop, onClick: opts.onCrop });
  appendSimpleButton(edit, { action: 'replace', label: tr(opts.i18n, 'tools.image.replace'), icon: IconReplace, onClick: opts.onReplace });

  const view = appendIsland(root, 'view');
  appendSimpleButton(view, { action: 'fullscreen', label: tr(opts.i18n, 'tools.image.viewFullscreen'), icon: IconExpandFullscreen, onClick: opts.onFullscreen });
  appendSimpleButton(view, { action: 'download', label: tr(opts.i18n, 'tools.image.downloadOriginal'), icon: IconDownload, onClick: opts.onDownload });
  // (existing `more` button creation, appended to `view` instead of `root`)
```

`appendAlignCtrl(parent, opts)` — rename its first param from `root` to `parent` and append the wrapper to `parent`. Delete `appendDivider`. Add:

```ts
function appendIsland(parent: HTMLElement, name: 'layout' | 'edit' | 'view'): HTMLElement {
  const island = document.createElement('div');
  island.className = 'blok-image-toolbar__island';
  island.setAttribute('data-island', name);
  parent.appendChild(island);
  return island;
}
```

- [ ] **Step 4: Run the image UI tests**

Run: `yarn test test/unit/tools/image/ui.test.ts test/unit/tools/image/ui.mutants.test.ts test/unit/tools/image/index.test.ts`
Expected: new tests PASS. Any old test asserting `.blok-image-toolbar__divider` or `root.children` order fails — update those assertions to the island structure (they describe the old layout, not a behaviour we keep). Do not touch tests about `data-action` presence, labels, align popover, or tooltips; they must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts test/unit/tools/image/ui.test.ts test/unit/tools/image/ui.mutants.test.ts
git commit -m "feat(image): group toolbar actions into layout, edit and view islands"
```

---

### Task 4: Tokens

**Files:**
- Modify: `src/styles/colors.css` (3 places)
- Test: create `test/unit/styles/image-chrome-tokens.test.ts`

**Interfaces:**
- Produces: `--blok-image-frame-ring`, `--blok-image-frame-ring-strong`, `--blok-image-readout-bg`, `--blok-image-readout-fg`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf-8');
const TOKENS = ['--blok-image-frame-ring', '--blok-image-frame-ring-strong', '--blok-image-readout-bg', '--blok-image-readout-fg'];

describe('image chrome tokens', () => {
  it.each(TOKENS)('%s is defined for light, system-dark and forced-dark', (token) => {
    const count = css.split(`${token}:`).length - 1;
    expect(count).toBe(3);
  });

  it('the selection ring is not blue', () => {
    const values = css.match(/--blok-image-frame-ring(?:-strong)?:\s*([^;]+);/g) ?? [];
    for (const v of values) expect(v).not.toMatch(/accent|#2383e2|blue/i);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `yarn test test/unit/styles/image-chrome-tokens.test.ts`
Expected: FAIL (count 0).

- [ ] **Step 3: Implement** — next to `--blok-overlay-ring` in each of the three blocks:

Light (bare `:root`):
```css
  --blok-image-frame-ring: rgba(55, 53, 47, 0.16);
  --blok-image-frame-ring-strong: rgba(55, 53, 47, 0.4);
  --blok-image-readout-bg: #191919;
  --blok-image-readout-fg: #ffffff;
```

Both dark blocks:
```css
    --blok-image-frame-ring: rgba(255, 255, 255, 0.18);
    --blok-image-frame-ring-strong: rgba(255, 255, 255, 0.45);
    --blok-image-readout-bg: #f1f1ef;
    --blok-image-readout-fg: #191919;
```

- [ ] **Step 4: Run the style gates**

Run: `yarn test test/unit/styles/image-chrome-tokens.test.ts test/unit/styles/selected-state-neutral.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles/colors.css test/unit/styles/image-chrome-tokens.test.ts
git commit -m "feat(image): tokens for the selection ring and width readout"
```

---

### Task 5: Islands, ring, dots and split motion in CSS

**Files:**
- Modify: `src/styles/main.css:679-694` (toolbar base rule)
- Modify: `src/styles/image.css` (toolbar states ~150-212, resize handle ~289-330, reduced-motion ~708)
- Modify: `test/unit/styles/image-control-tiers.test.ts`
- Update: `test/unit/styles/__snapshots__/main-css-rules.snap.txt` (regenerated)

**Interfaces:**
- Consumes: Task 3 DOM (`[data-island]`, `.blok-image-toolbar__island`), Task 4 tokens, `data-islands-placement` and `data-role="image-selection-ring"` and `data-resizing` (written in Task 6).

- [ ] **Step 1: Write the failing CSS tests** (append to `image-control-tiers.test.ts`, reusing its `findRuleBody` and `css`; read `main.css` too)

```ts
const mainCss = readFileSync(resolve(__dirname, '../../../src/styles/main.css'), 'utf-8');

describe('image islands (frame and islands design)', () => {
  it('the toolbar is a transparent row; each island is the card', () => {
    const island = findRuleBody('[data-blok-tool="image"] .blok-image-toolbar__island');
    expect(island).toContain('background: var(--blok-overlay-surface)');
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*background: transparent/);
  });

  it('medium tier shows only the edit island and more', () => {
    expect(css).toMatch(/\.blok-image-toolbar\[data-tier="medium"\] \[data-island="layout"\][^{]*\{\s*display: none/);
    expect(css).toMatch(/\.blok-image-toolbar\[data-tier="medium"\] \[data-island="view"\] > :not\(\[data-action="more"\]\)/);
  });

  it('compact tier keeps only the more button', () => {
    expect(css).toMatch(/\.blok-image-toolbar\[data-compact="true"\] \[data-island="layout"\],\s*\[data-blok-tool="image"\] \.blok-image-toolbar\[data-compact="true"\] \[data-island="edit"\]/);
  });

  it('selection is read from the block holder, not the dead data-selected', () => {
    expect(css).toContain('[data-blok-selected="true"] [data-blok-tool="image"] [data-role="image-selection-ring"]');
  });

  it('handles are dots, not 6px bars', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');
    expect(body).toContain('width: 9px');
    expect(body).toContain('height: 9px');
    expect(body).toContain('border-radius: 50%');
  });

  it('reduced motion switches the split off', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.blok-image-toolbar__island[\s\S]*animation: none/);
  });
});
```

Change the existing `'resize handles are fixed at 6px wide'` test to the dot test above (delete the old one), and delete the `align-pill` test only if the `.blok-image-toolbar__pill` rule is removed (it is not in this plan — keep it).

- [ ] **Step 2: Run to see them fail**

Run: `yarn test test/unit/styles/image-control-tiers.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`main.css` toolbar base rule becomes:

```css
[data-blok-tool="image"] .blok-image-toolbar {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 20px);
  transform: translateX(-50%);
  display: inline-flex;
  gap: 6px;
  background: transparent;
  opacity: 0;
  pointer-events: none;
  z-index: 2;
}
```

(20px must equal `ISLAND_GAP_PX` in `island-placement.ts`.)

In `image.css`, replace the toolbar show rule, divider rule, and tier rules (~lines 150–212) with:

```css
[data-blok-tool="image"] .blok-image-toolbar[data-islands-placement="inside"] {
  bottom: auto;
  top: 10px;
}
[data-blok-tool="image"] .blok-image-toolbar__island {
  display: inline-flex;
  gap: 1px;
  padding: 3px;
  border-radius: 9px;
  background: var(--blok-overlay-surface);
  box-shadow: inset 0 0 0 1px var(--blok-overlay-ring), var(--blok-image-shadow-toolbar);
}
[data-blok-tool="image"] .blok-image-inner:hover .blok-image-toolbar,
[data-blok-selected="true"] [data-blok-tool="image"] .blok-image-toolbar,
[data-blok-tool="image"][data-settings-open="true"] .blok-image-toolbar,
[data-blok-tool="image"][data-align-open="true"] .blok-image-toolbar,
[data-blok-tool="image"][data-alt-open="true"] .blok-image-toolbar {
  opacity: 1;
  pointer-events: auto;
  /* One animation name for every show state, so hover -> select does not replay it. */
  animation: blok-image-islands-split-gap 500ms cubic-bezier(0.34, 1.3, 0.64, 1) 320ms both;
}
[data-blok-tool="image"] .blok-image-inner:hover .blok-image-toolbar__island,
[data-blok-selected="true"] [data-blok-tool="image"] .blok-image-toolbar__island,
[data-blok-tool="image"][data-settings-open="true"] .blok-image-toolbar__island,
[data-blok-tool="image"][data-align-open="true"] .blok-image-toolbar__island,
[data-blok-tool="image"][data-alt-open="true"] .blok-image-toolbar__island {
  animation:
    blok-image-islands-rise 380ms cubic-bezier(0.2, 0.9, 0.25, 1) both,
    blok-image-islands-round 500ms cubic-bezier(0.34, 1.3, 0.64, 1) 320ms both;
}
@keyframes blok-image-islands-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}
@keyframes blok-image-islands-split-gap {
  from { gap: 0; }
  to { gap: 6px; }
}
@keyframes blok-image-islands-round {
  from { border-radius: 3px; }
  to { border-radius: 9px; }
}
[data-blok-tool="image"][data-resizing="true"] .blok-image-toolbar {
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}
[data-blok-tool="image"] .blok-image-inner[data-loading="true"] .blok-image-toolbar {
  opacity: 0;
  pointer-events: none;
}
/* Medium tier: the edit island plus "more"; "more" opens block settings, which hold everything else. */
[data-blok-tool="image"] .blok-image-toolbar[data-tier="medium"] [data-island="layout"] {
  display: none;
}
[data-blok-tool="image"] .blok-image-toolbar[data-tier="medium"] [data-island="view"] > :not([data-action="more"]) {
  display: none;
}
[data-blok-tool="image"] .blok-image-toolbar[data-compact="true"] [data-island="layout"],
[data-blok-tool="image"] .blok-image-toolbar[data-compact="true"] [data-island="edit"],
[data-blok-tool="image"] .blok-image-toolbar[data-compact="true"] [data-island="view"] > :not([data-action="more"]) {
  display: none;
}

[data-blok-tool="image"] [data-role="image-selection-ring"] {
  position: absolute;
  inset: 0;
  border-radius: var(--blok-radius-lg);
  box-shadow: 0 0 0 1px var(--blok-image-frame-ring);
  opacity: 0;
  pointer-events: none;
  transition: inset 300ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 200ms ease, box-shadow 150ms ease;
}
[data-blok-selected="true"] [data-blok-tool="image"] [data-role="image-selection-ring"],
[data-blok-tool="image"][data-settings-open="true"] [data-role="image-selection-ring"],
[data-blok-tool="image"][data-align-open="true"] [data-role="image-selection-ring"],
[data-blok-tool="image"][data-alt-open="true"] [data-role="image-selection-ring"],
[data-blok-tool="image"][data-resizing="true"] [data-role="image-selection-ring"] {
  inset: -6px;
  opacity: 1;
}
[data-blok-tool="image"][data-resizing="true"] [data-role="image-selection-ring"] {
  box-shadow: 0 0 0 1.5px var(--blok-image-frame-ring-strong);
}
```

Keep the existing `button`, `button svg`, `button:hover`, `aria-pressed` rules (change the pressed rule's colors to `var(--blok-icon-active-bg)` / `var(--blok-icon-active-text)`).

Replace the resize-handle visual rule (~289) with a dot on the ring's midline (ring is 6 px outside; dot centre on it):

```css
[data-blok-tool="image"] [data-role="resize-handle"] {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--blok-overlay-surface);
  box-shadow: 0 0 0 1px var(--blok-image-frame-ring-strong), 0 1px 3px rgba(0, 0, 0, 0.15);
  cursor: ew-resize;
  opacity: 0;
  transform: translateY(-50%) scale(0);
  transition: opacity 120ms ease, transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 2;
}
[data-blok-tool="image"] [data-role="resize-handle"]::before {
  content: '';
  position: absolute;
  inset: -14px -10px;
}
[data-blok-tool="image"] [data-role="resize-handle"][data-edge="left"]  { left: -10.5px; }
[data-blok-tool="image"] [data-role="resize-handle"][data-edge="right"] { right: -10.5px; }
```

Update the existing show rule for handles: swap `[data-blok-tool="image"][data-selected="true"] [data-role="resize-handle"]` for `[data-blok-selected="true"] [data-blok-tool="image"] [data-role="resize-handle"]`, and set `opacity: 1; transform: translateY(-50%) scale(1);` in it. Hover/active rules become `transform: translateY(-50%) scale(1.45);`.

Inside the existing `@media (prefers-reduced-motion: reduce)` block (~line 708) add:

```css
  [data-blok-tool="image"] .blok-image-toolbar,
  [data-blok-tool="image"] .blok-image-toolbar__island,
  [data-blok-tool="image"] [data-role="resize-handle"],
  [data-blok-tool="image"] [data-role="image-selection-ring"] {
    animation: none !important;
    transition: none !important;
  }
```

- [ ] **Step 4: Run the style gates and refresh the golden CSS snapshot**

Run: `yarn test test/unit/styles/image-control-tiers.test.ts test/unit/styles/image-chrome-tokens.test.ts test/unit/styles/selected-state-neutral.test.ts`
Expected: PASS.

Then: `yarn test test/unit/styles/css-split-equivalence.test.ts -u` and read the snapshot diff: only image toolbar/handle/ring rules and the three new `@keyframes` may change. Then run `yarn test test/unit/styles test/unit/architecture` — expect PASS. If the byte-budget check fails, report it; do not raise the budget.

- [ ] **Step 5: Commit**

```bash
git add src/styles/main.css src/styles/image.css test/unit/styles/image-control-tiers.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "feat(image): islands, selection ring, dot handles and the split motion"
```

---

### Task 6: Wire ring, placement, readout and snapping in the tool

**Files:**
- Modify: `src/tools/image/index.ts` (`renderRendered` overlay block ~988-1045, `observeOverlayWidth`, `attachResizeHandles`, destroy/cleanup ~854)
- Test: `test/unit/tools/image/index.test.ts`

**Interfaces:**
- Consumes: `IMAGE_SNAP_POINTS` (Task 1), `resolveIslandPlacement`, `islandBoundaryTop` (Task 2).
- Produces: figure contains `[data-role="image-selection-ring"]` and `[data-role="image-resize-readout"]`; toolbar has `data-islands-placement`; root gets `data-resizing="true"` during a drag.

- [ ] **Step 1: Write the failing tests** (follow the rendering helpers already in `index.test.ts` for a rendered image block)

```ts
describe('image chrome wiring', () => {
  it('renders a selection ring inside the figure', async () => {
    const { root } = await renderRenderedImage();
    expect(root.querySelector('.blok-image-inner > [data-role="image-selection-ring"]')).not.toBeNull();
  });

  it('stamps an island placement on the toolbar', async () => {
    const { root } = await renderRenderedImage();
    const toolbar = root.querySelector('[data-role="image-overlay"]');
    expect(['above', 'inside']).toContain(toolbar?.getAttribute('data-islands-placement'));
  });

  it('puts the islands inside when the figure has no room above', async () => {
    const { root } = await renderRenderedImage();
    const figure = root.querySelector<HTMLElement>('.blok-image-inner');
    if (!figure) throw new Error('figure missing');
    figure.getBoundingClientRect = () => ({ top: 5, left: 0, width: 400, height: 300, right: 400, bottom: 305 } as DOMRect);
    figure.dispatchEvent(new MouseEvent('mouseenter'));
    expect(root.querySelector('[data-role="image-overlay"]')?.getAttribute('data-islands-placement')).toBe('inside');
  });

  it('marks the root as resizing and shows the readout while a handle is dragged', async () => {
    const { root } = await renderRenderedImage();
    const handle = root.querySelector<HTMLElement>('[data-role="resize-handle"][data-edge="right"]');
    if (!handle) throw new Error('handle missing');
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, pointerId: 1, bubbles: true }));
    expect(root.getAttribute('data-resizing')).toBe('true');
    expect(root.querySelector('[data-role="image-resize-readout"]')?.textContent).toMatch(/^\d+%/);
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, pointerId: 1, bubbles: true }));
    expect(root.hasAttribute('data-resizing')).toBe(false);
  });
});
```

If `index.test.ts` has no `renderRenderedImage` helper, write one at the top of this describe using the same construction the file already uses for a rendered image (constructor with `data: { url }`, `render()`, fire the img `load`).

- [ ] **Step 2: Run to see them fail**

Run: `yarn test test/unit/tools/image/index.test.ts -t "image chrome wiring"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the `if (!this.readOnly)` overlay block, before `renderOverlay`:

```ts
      const ring = document.createElement('div');
      ring.setAttribute('data-role', 'image-selection-ring');
      ring.setAttribute('aria-hidden', 'true');
      figure.appendChild(ring);
```

After `figure.appendChild(overlay);`:

```ts
      const syncPlacement = (): void => {
        const placement = resolveIslandPlacement({
          figureTop: figure.getBoundingClientRect().top,
          islandHeight: overlay.getBoundingClientRect().height,
          boundaryTop: islandBoundaryTop(figure),
        });
        overlay.setAttribute('data-islands-placement', placement);
      };
      syncPlacement();
      figure.addEventListener('mouseenter', syncPlacement);
      window.addEventListener('scroll', syncPlacement, { passive: true, capture: true });
      this.placementDetach = () => {
        figure.removeEventListener('mouseenter', syncPlacement);
        window.removeEventListener('scroll', syncPlacement, { capture: true });
      };
```

Add field `private placementDetach: (() => void) | null = null;` and in the teardown next to `this.overlayResizeObserver?.disconnect()` call `this.placementDetach?.(); this.placementDetach = null;`. Also call `this.placementDetach?.()` at the start of the render path that rebuilds the figure (same place the observer is disconnected) so re-renders never stack listeners.

In `attachResizeHandles`, before the loop:

```ts
    const readout = document.createElement('div');
    readout.setAttribute('data-role', 'image-resize-readout');
    readout.setAttribute('aria-hidden', 'true');
    figure.appendChild(readout);
    const container = figure.parentElement ?? figure;
```

and change the `attachResizeHandle({...})` options:

```ts
        container,
        snapPoints: IMAGE_SNAP_POINTS,
        onPreview: (percent) => {
          figure.style.setProperty('width', `${percent}%`);
          this.root?.setAttribute('data-resizing', 'true');
          readout.setAttribute('data-edge', edge);
          const px = Math.round((container.getBoundingClientRect().width * percent) / 100);
          readout.textContent = `${percent}% · ${px} px`;
        },
        onCommit: (percent) => {
          this.root?.removeAttribute('data-resizing');
          this.data.width = percent;
          this.block.dispatchChange();
        },
```

A drag with no movement never calls `onCommit`; clear the flag on `pointerup` too:

```ts
      handle.addEventListener('pointerup', () => this.root?.removeAttribute('data-resizing'));
      handle.addEventListener('pointercancel', () => this.root?.removeAttribute('data-resizing'));
```

Readout CSS (append to `image.css`, near the handle rules):

```css
[data-blok-tool="image"] [data-role="image-resize-readout"] {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  padding: 5px 7px;
  border-radius: 6px;
  background: var(--blok-image-readout-bg);
  color: var(--blok-image-readout-fg);
  font: 600 11px/1 var(--blok-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  z-index: 3;
}
[data-blok-tool="image"] [data-role="image-resize-readout"][data-edge="right"] { left: calc(100% + 18px); }
[data-blok-tool="image"] [data-role="image-resize-readout"][data-edge="left"]  { right: calc(100% + 18px); }
[data-blok-tool="image"][data-resizing="true"] [data-role="image-resize-readout"] { opacity: 1; }
[data-blok-tool="image"] .blok-image-inner[data-resize-blocked="true"] {
  animation: blok-image-resize-nudge 250ms ease;
}
@keyframes blok-image-resize-nudge {
  30% { translate: -3px 0; }
  60% { translate: 2px 0; }
}
```

Before adding the nudge keyframes, grep `image.css` / `main.css` for an existing `[data-resize-blocked]` recoil rule shared with video/embed. If one already animates the image figure, reuse it and skip the nudge.

- [ ] **Step 4: Run**

Run: `yarn test test/unit/tools/image/index.test.ts test/unit/tools/image/index.mutants.test.ts test/unit/styles/css-split-equivalence.test.ts -u` then the same without `-u`.
Expected: PASS; snapshot diff only shows the readout/nudge rules.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/index.ts src/styles/image.css test/unit/tools/image/index.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "feat(image): selection ring, island placement and a snapping width readout"
```

---

### Task 7: i18n keys for the alt pill

**Files:**
- Modify: `src/components/i18n/locales/*.json` (69 files), `types/message-keys.d.ts` (regenerated), `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md` (digests), `test/unit/components/i18n/lifecycle-coverage.test.ts` (pinned counts), and `COGNATE_RETENTIONS` in `untranslated-strings.test.ts` only if a locale keeps an English-identical value.

Follow `blok-translations` skill and the repo memory "i18n new-key checklist" exactly: all 7 layers.

- [ ] **Step 1: Add the four keys to `en.json`** right after `"tools.image.altPlaceholder"`, with the English values from Global Constraints.
- [ ] **Step 2: Run the i18n tests to see them fail**

Run: `yarn test test/unit/components/i18n/`
Expected: FAIL — 68 locales missing four keys; lifecycle counts off.

- [ ] **Step 3: Translate.** Dispatch 5 parallel subagents, one per locale group, each writing ONLY a scratch JSON `{ locale: { key: value } }` under the session scratchpad. `altExample` must be a natural example description in each language (a dog catching a frisbee), not a literal word-by-word copy. Apply all with one script that inserts the four keys after `tools.image.altPlaceholder` in every locale file, preserving formatting.
- [ ] **Step 4: Regenerate and re-pin**

```bash
node scripts/generate-message-keys-dts.mjs
```

Rewrite the ledger digest columns for every changed locale; update `lifecycle-coverage.test.ts` counts (these keys are `executable-literal`: they appear as string literals in `src/`, which happens in Task 8 — pin counts after Task 8 lands, or run this step's test again then).

- [ ] **Step 5: Run**

Run: `yarn test test/unit/components/i18n/ test/unit/architecture/published-types-no-src-refs.test.ts && yarn i18n:check`
Expected: PASS, except lifecycle counts if Task 8 has not landed — note it and re-run after Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/components/i18n/locales types/message-keys.d.ts docs/plans/2026-07-19-all-locales-translation-audit-ledger.md test/unit/components/i18n
git commit -m "feat(i18n): alt pill strings in every locale"
```

---

### Task 8: Alt pill on the image, hint, lighter editor

**Files:**
- Modify: `src/tools/image/ui.ts` (new `renderAltPill`; `renderCaptionRow` loses its Alt button and `onAlt`/`hasAlt` options)
- Modify: `src/tools/image/index.ts` (`renderRendered` caption row call; `promptAlt` anchor selector)
- Modify: `src/tools/image/alt-popover.ts` (order + placeholder + aria-label)
- Modify: `src/styles/image.css` (remove `.blok-image-caption-row__alt*` rules ~lines 110-148; add pill + popover note styles)
- Tests: `test/unit/tools/image/ui.test.ts`, `test/unit/tools/image/index.test.ts`, `test/unit/tools/image/alt-popover.test.ts`, `test/unit/tools/image/alt-popover.mutants.test.ts`, `test/playwright/tests/undo-audit/w4-tools.spec.ts:255`, `test/playwright/tests/ui/field-entry-fields.spec.ts:130`

**Interfaces:**
- Produces: `export interface AltPillOptions { alt?: string; onOpen(): void; isEditorOpen(): boolean; i18n?: I18nInstance }` and `export function renderAltPill(opts: AltPillOptions): HTMLButtonElement` in `ui.ts`. The button has `data-action="alt-edit"`, class `blok-image-alt-pill`, `data-state="missing" | "set"`.

- [ ] **Step 1: Write the failing unit tests** (in `ui.test.ts`; the tooltip module is already mocked at the top of the file)

```ts
describe('renderAltPill', () => {
  it('reads "Add alt text" with a help mark when alt is missing', () => {
    const pill = renderAltPill({ onOpen: noop, isEditorOpen: () => false });
    expect(pill.getAttribute('data-action')).toBe('alt-edit');
    expect(pill.getAttribute('data-state')).toBe('missing');
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    expect(pill.textContent).toContain('Add alt text');
    expect(pill.querySelector('.blok-image-alt-pill__help')).not.toBeNull();
  });

  it('shows "Alt" and the start of the text when alt is set, with no help mark', () => {
    const pill = renderAltPill({ alt: 'Pink yarn mascot', onOpen: noop, isEditorOpen: () => false });
    expect(pill.getAttribute('data-state')).toBe('set');
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(pill.textContent).toContain('Alt');
    expect(pill.textContent).toContain('Pink yarn mascot');
    expect(pill.querySelector('.blok-image-alt-pill__help')).toBeNull();
  });

  it('opens the editor on click without bubbling to the block', () => {
    const onOpen = vi.fn();
    const parent = document.createElement('div');
    const parentClick = vi.fn();
    parent.addEventListener('click', parentClick);
    const pill = renderAltPill({ onOpen, isEditorOpen: () => false });
    parent.appendChild(pill);
    pill.click();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('binds the explaining hint as a hover tooltip', () => {
    const pill = renderAltPill({ onOpen: noop, isEditorOpen: () => false });
    expect(tooltip.onHover).toHaveBeenCalledWith(pill, expect.anything(), expect.objectContaining({ delay: expect.any(Number) }));
  });

  it('does not show the hint while the alt editor is open', () => {
    const pill = renderAltPill({ onOpen: noop, isEditorOpen: () => true });
    pill.dispatchEvent(new MouseEvent('mouseenter'));
    pill.dispatchEvent(new FocusEvent('focus'));
    expect(tooltip.show).not.toHaveBeenCalled();
  });
});
```

Replace the old caption-row alt tests (`ui.test.ts` lines ~176-200 and ~680) with one test: `renderCaptionRow` renders no `[data-action="alt-edit"]`.

In `index.test.ts`:

```ts
  it('puts the alt pill on the figure, not in the caption row', async () => {
    const { root } = await renderRenderedImage();
    expect(root.querySelector('.blok-image-inner > [data-action="alt-edit"]')).not.toBeNull();
    expect(root.querySelector('.blok-image-caption-row [data-action="alt-edit"]')).toBeNull();
  });

  it('keeps the alt pill when the caption is hidden', async () => {
    const { root } = await renderRenderedImage({ captionVisible: false });
    expect(root.querySelector('.blok-image-inner > [data-action="alt-edit"]')).not.toBeNull();
  });

  it('renders no alt pill in read-only mode', async () => {
    const { root } = await renderRenderedImage({}, { readOnly: true });
    expect(root.querySelector('[data-action="alt-edit"]')).toBeNull();
  });
```

In `alt-popover.test.ts`:

```ts
  it('puts the field first and the one-line note under it', () => {
    const detach = openAltPopover({ anchor, value: '', onSave: noop, onCancel: noop });
    const popover = document.querySelector('[data-role="image-alt-popover"]');
    const kids = Array.from(popover?.children ?? []).map((c) => c.tagName);
    expect(kids).toEqual(['TEXTAREA', 'P']);
    detach();
  });

  it('uses an example as the placeholder and names the field', () => {
    const detach = openAltPopover({ anchor, value: '', onSave: noop, onCancel: noop });
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-role="image-alt-popover"] textarea');
    expect(textarea?.placeholder).toBe('A golden retriever catching a frisbee');
    expect(textarea?.getAttribute('aria-label')).toBe('Alt text');
    detach();
  });
```

Update `alt-popover.mutants.test.ts:79` to expect `i18n:tools.image.altExample` for the placeholder.

- [ ] **Step 2: Run to see them fail**

Run: `yarn test test/unit/tools/image/ui.test.ts test/unit/tools/image/index.test.ts test/unit/tools/image/alt-popover.test.ts test/unit/tools/image/alt-popover.mutants.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`ui.ts`:

```ts
export interface AltPillOptions {
  alt?: string;
  onOpen(): void;
  isEditorOpen(): boolean;
  i18n?: I18nInstance;
}

const ALT_HINT_DELAY_MS = 350;

export function renderAltPill(opts: AltPillOptions): HTMLButtonElement {
  const hasAlt = Boolean(opts.alt);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'blok-image-alt-pill';
  btn.setAttribute('data-action', 'alt-edit');
  btn.setAttribute('data-state', hasAlt ? 'set' : 'missing');
  btn.setAttribute('aria-pressed', hasAlt ? 'true' : 'false');
  btn.setAttribute('aria-label', tr(opts.i18n, 'tools.image.altEdit'));

  const mark = document.createElement('span');
  mark.className = 'blok-image-alt-pill__mark';
  mark.setAttribute('aria-hidden', 'true');
  btn.appendChild(mark);

  const text = document.createElement('span');
  text.className = 'blok-image-alt-pill__text';
  if (hasAlt) {
    const label = document.createElement('b');
    label.textContent = tr(opts.i18n, 'tools.image.altButton');
    text.append(label, ` ${opts.alt ?? ''}`);
  } else {
    text.textContent = tr(opts.i18n, 'tools.image.altAdd');
  }
  btn.appendChild(text);

  if (!hasAlt) {
    const help = document.createElement('span');
    help.className = 'blok-image-alt-pill__help';
    help.setAttribute('aria-hidden', 'true');
    help.textContent = '?';
    btn.appendChild(help);
  }

  const hint = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = tr(opts.i18n, 'tools.image.altHintTitle');
  hint.append(title, document.createElement('br'), tr(opts.i18n, 'tools.image.altHintBody'));

  const showHint = (): void => {
    if (opts.isEditorOpen()) return;
    tooltipShow(btn, hint, { delay: ALT_HINT_DELAY_MS });
  };
  tooltipOnHover(btn, hint, { delay: ALT_HINT_DELAY_MS });
  btn.addEventListener('focus', showHint);
  btn.addEventListener('mouseenter', () => {
    if (opts.isEditorOpen()) tooltipHide();
  });

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    tooltipHide();
    opts.onOpen();
  });

  return btn;
}
```

Import `show as tooltipShow` alongside the existing tooltip imports. Before relying on `onHover` + a guarding `mouseenter`: read `src/components/utils/tooltip.ts:562` to confirm listener order (the `onHover` binding may show after its own delay even if our `mouseenter` hid first). If `onHover` cannot be vetoed, drop `tooltipOnHover` here and bind `mouseenter` → `showHint` / `mouseleave` → `tooltipHide` by hand; update the "binds the hint" test to assert `tooltip.show` is called on `mouseenter` when the editor is closed. Pick whichever the tooltip code actually supports; the "does not show while open" test is the contract.

`renderCaptionRow`: delete the `if (opts.onAlt) { ... }` block and the `onAlt`/`hasAlt` fields from `CaptionRowOptions`.

`index.ts`, in `renderRendered`, after the overlay block (inside `if (!this.readOnly)`):

```ts
      figure.appendChild(renderAltPill({
        alt: this.data.alt,
        onOpen: () => this.promptAlt(),
        isEditorOpen: () => this.altPopoverDetach !== null,
        i18n: this.api.i18n,
      }));
```

Remove `onAlt`/`hasAlt` from the `renderCaptionRow` call. In `promptAlt`, change the anchor query to `'.blok-image-inner > [data-action="alt-edit"]'`.

`alt-popover.ts`: append `textarea` before `description` (keep the `describedBy` id wiring); set `textarea.placeholder = tr(opts.i18n, 'tools.image.altExample');` and `textarea.setAttribute('aria-label', tr(opts.i18n, 'tools.image.altPlaceholder'));`.

`image.css`: delete every `.blok-image-caption-row__alt` rule. Add:

```css
[data-blok-tool="image"] .blok-image-alt-pill {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 20px);
  padding: 5px 9px 5px 7px;
  border: 0;
  border-radius: var(--blok-radius-pill);
  background: var(--blok-overlay-surface);
  box-shadow: inset 0 0 0 1px var(--blok-overlay-ring), 0 2px 8px rgba(15, 15, 15, 0.08);
  color: var(--blok-text-primary);
  font: 500 11px/1 inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms ease, transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 2;
}
[data-blok-tool="image"] .blok-image-alt-pill:active { transform: scale(0.94); }
[data-blok-tool="image"] .blok-image-inner:hover .blok-image-alt-pill,
[data-blok-selected="true"] [data-blok-tool="image"] .blok-image-alt-pill,
[data-blok-tool="image"][data-alt-open="true"] .blok-image-alt-pill,
[data-blok-tool="image"][data-settings-open="true"] .blok-image-alt-pill,
[data-blok-tool="image"] .blok-image-alt-pill:focus-visible {
  opacity: 1;
}
[data-blok-tool="image"] .blok-image-inner[data-loading="true"] .blok-image-alt-pill,
[data-blok-tool="image"] .blok-image-toolbar[data-compact="true"] ~ .blok-image-alt-pill {
  display: none;
}
[data-blok-tool="image"] .blok-image-alt-pill__mark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--blok-text-tertiary);
  flex: none;
}
[data-blok-tool="image"] .blok-image-alt-pill[data-state="set"] .blok-image-alt-pill__mark {
  width: 6px;
  height: 3px;
  border-radius: 0;
  background: none;
  border: solid currentColor;
  border-width: 0 0 1.5px 1.5px;
  transform: rotate(-45deg) translate(1px, -1px);
}
[data-blok-tool="image"] .blok-image-alt-pill__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-blok-tool="image"] .blok-image-alt-pill[data-state="set"] .blok-image-alt-pill__text { color: var(--blok-text-secondary); }
[data-blok-tool="image"] .blok-image-alt-pill[data-state="set"] b { color: var(--blok-text-primary); font-weight: 600; margin-inline-end: 4px; }
[data-blok-tool="image"] .blok-image-alt-pill__help {
  width: 14px;
  height: 14px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px var(--blok-border-primary);
  color: var(--blok-text-tertiary);
  font: 600 9px/1 inherit;
}
```

The pill must come AFTER the toolbar in the figure for the `~` compact rule; the append order above guarantees it. Check `--blok-text-tertiary` / `--blok-text-secondary` / `--blok-border-primary` / `--blok-radius-pill` exist in `colors.css` before using them (grep); substitute the nearest existing token if not.

Style the popover note (find the existing `.blok-image-alt-popover__description` rule; change it to):

```css
.blok-image-alt-popover__description {
  margin: 6px 2px 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--blok-text-tertiary);
}
```

Also add `.blok-image-alt-pill` to the existing reduced-motion block with `transition: none !important;`.

Update the two e2e specs: `w4-tools.spec.ts:255` and `field-entry-fields.spec.ts:130` already use `[data-action="alt-edit"]` scoped to the block — they need only a `hover()` on the figure first if the pill is hidden until hover (Playwright refuses to click `opacity: 0`? No — it clicks invisible-by-opacity elements; run them and change only if they fail).

- [ ] **Step 4: Run**

Run: `yarn test test/unit/tools/image test/unit/styles test/unit/components/i18n/`
Then: `yarn test test/unit/styles/css-split-equivalence.test.ts -u`, review, re-run without `-u`.
Then: `yarn e2e test/playwright/tests/undo-audit/w4-tools.spec.ts test/playwright/tests/ui/field-entry-fields.spec.ts`
Expected: PASS. Now re-pin `lifecycle-coverage.test.ts` counts if Task 7 left them red.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image src/styles/image.css test/unit/tools/image test/unit/styles test/unit/components/i18n test/playwright/tests/undo-audit/w4-tools.spec.ts test/playwright/tests/ui/field-entry-fields.spec.ts
git commit -m "feat(image): alt text pill on the image with an explaining hint"
```

---

### Task 9: End-to-end behaviour

**Files:**
- Create: `test/playwright/tests/tools/image-chrome.spec.ts`

Copy the `resetBlok` / `createBlok` / `gotoTestPage` / `ensureBlokBundleBuilt` setup from `test/playwright/tests/tools/image.spec.ts:1-60`. Use a data-URL or the fixture images in `test/playwright/fixtures/image` so no network is needed (check what `image.spec.ts` uses offline; `placehold.co` needs network — prefer a fixture).

- [ ] **Step 1: Write the specs**

```ts
// Islands need ISLAND_GAP_PX + their height (~54 px) above the figure, so give the image
// three paragraphs of room; one short paragraph is not enough and gives 'inside'.
test('hover shows the islands; selecting adds the ring', async ({ page }) => {
  await createBlok(page, { blocks: [
    { type: 'paragraph', data: { text: 'One' } },
    { type: 'paragraph', data: { text: 'Two' } },
    { type: 'paragraph', data: { text: 'Three' } },
    { id: 'img', type: 'image', data: { url: FIXTURE_URL } },
  ] });
  const block = page.locator('[data-blok-id="img"]');
  const figure = block.locator('.blok-image-inner');
  await figure.hover();
  await expect(block.locator('[data-island="edit"]')).toBeVisible();
  await expect(block.locator('[data-role="image-overlay"]')).toHaveAttribute('data-islands-placement', 'above');
  await page.evaluate(() => window.blokInstance?.blocks.getById?.('img')?.select?.());
  await expect(block.locator('[data-role="image-selection-ring"]')).toHaveCSS('opacity', '1');
});

test('an image as the first block puts its islands inside', async ({ page }) => {
  await createBlok(page, { blocks: [{ id: 'img', type: 'image', data: { url: FIXTURE_URL } }] });
  const block = page.locator('[data-blok-id="img"]');
  await block.locator('.blok-image-inner').hover();
  await expect(block.locator('[data-role="image-overlay"]')).toHaveAttribute('data-islands-placement', 'inside');
});

test('dragging a handle shows the readout, snaps to 50% and saves it', async ({ page }) => {
  await createBlok(page, { blocks: [{ id: 'img', type: 'image', data: { url: FIXTURE_URL, width: 60, alignment: 'left' } }] });
  const block = page.locator('[data-blok-id="img"]');
  await block.locator('.blok-image-inner').hover();
  const handle = block.locator('[data-role="resize-handle"][data-edge="right"]');
  const box = await requireBoundingBox(handle, 'right handle');
  const container = await requireBoundingBox(block, 'block');
  const target = container.x + container.width * 0.51;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target, box.y + box.height / 2, { steps: 8 });
  await expect(block.locator('[data-role="image-resize-readout"]')).toHaveText(/^50%/);
  await page.mouse.up();
  const saved = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data?.width);
  expect(saved).toBe(50);
});

test('alt: hint on hover, no hint while editing, Enter saves', async ({ page }) => {
  await createBlok(page, { blocks: [
    { type: 'paragraph', data: { text: 'Above' } },
    { id: 'img', type: 'image', data: { url: FIXTURE_URL } },
  ] });
  const block = page.locator('[data-blok-id="img"]');
  await block.locator('.blok-image-inner').hover();
  const pill = block.locator('[data-action="alt-edit"]');
  await pill.hover();
  await expect(page.getByText('What is alt text?')).toBeVisible();
  await pill.click();
  const field = page.getByRole('dialog').locator('textarea');
  await expect(field).toBeFocused();
  await pill.hover({ force: true });
  await expect(page.getByText('What is alt text?')).toBeHidden();
  await field.fill('Pink yarn mascot');
  await page.keyboard.press('Enter');
  await expect(pill).toHaveAttribute('data-state', 'set');
  await expect(pill).toContainText('Pink yarn mascot');
});

test('reduced motion shows the islands without animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createBlok(page, { blocks: [
    { type: 'paragraph', data: { text: 'Above' } },
    { id: 'img', type: 'image', data: { url: FIXTURE_URL } },
  ] });
  const block = page.locator('[data-blok-id="img"]');
  await block.locator('.blok-image-inner').hover();
  await expect(block.locator('[data-island="edit"]')).toHaveCSS('animation-name', 'none');
});
```

Check the real block-selection API before using `select()`: search `types/api/blocks.d.ts` / `BlockAPI` for how a test selects a block (another spec may click the block's left gutter or press Escape after focusing the caption). Use whatever an existing e2e spec already does.

- [ ] **Step 2: Run**

Run: `yarn e2e test/playwright/tests/tools/image-chrome.spec.ts`
Expected: PASS. Any fail → it is a real gap; fix the code (TDD red already achieved because the features were added in Tasks 5–8; if a test passes on first run, temporarily revert the matching production line to watch it fail, then restore).

- [ ] **Step 3: Run the existing image e2e specs**

Run: `yarn e2e test/playwright/tests/tools/image.spec.ts test/playwright/tests/tools/image-more-button-selected.spec.ts test/playwright/tests/tools/image-crop.spec.ts test/playwright/tests/tools/columns-blocks/image-in-column.spec.ts`
Expected: PASS. Failures that assert the old toolbar position (top-right inside) or 6px bars describe the replaced design — update them to the islands; failures about behaviour are bugs.

- [ ] **Step 4: Commit**

```bash
git add test/playwright/tests/tools
git commit -m "test(image): end-to-end cover for islands, ring, snapping readout and alt pill"
```

---

### Task 10: Look at it, then land

- [ ] **Step 1: Visual check** with the `verify` skill against the built bundle: light and dark theme, an image in a narrow column (medium and compact tiers), an image as first block, a hidden caption, hover → select → drag → alt edit. Take screenshots; fix only what is visibly wrong, with a test first when it is behaviour.
- [ ] **Step 2: Related gates** (user rule — not the full suite)

```bash
yarn test test/unit/tools/image test/unit/tools/video test/unit/tools/link/embed test/unit/styles test/unit/architecture test/unit/components/i18n
yarn lint:scoped <changed files>   # or: npx eslint <changed files>
npx tsc --noEmit -p tsconfig.json   # NODE_OPTIONS=--max-old-space-size=8192
```

- [ ] **Step 3: Refactor pass** — run the `refactor:refactor` skill on the branch diff; remove any comment that restates code.
- [ ] **Step 4: Land**

```bash
git fetch origin && git rebase origin/main
# re-run Step 2's vitest line if the rebase touched src/tools/image or src/styles
cd /Users/jackuait/Packages/blok && git merge --ff-only image-chrome   # only if the main checkout is clean of the user's WIP in these paths; otherwise push from the worktree:
git -C ~/Packages/.blok-undo/image-chrome push origin image-chrome:main
git status   # "up to date with origin"
```

- [ ] **Step 5: Tell the user** the release-note line: "The image Alt button moved from the caption row onto the image. Consumer CSS aimed at `.blok-image-caption-row__alt` no longer matches." Not breaking (no data, attribute, token or type removed).
