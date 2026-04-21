# Image Lightbox Pan-by-Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pan (drag) the image inside the fullscreen lightbox at any zoom level, across mouse / touch / pen, with bounds that keep the image center within the viewport.

**Architecture:** Extend existing `transform: scale(x)` on `.blok-image-lightbox__image` to `translate(x, y) scale(z)`. Add pan state + pointer handlers (pointerdown/move/up with pointer capture) on the dialog element. A 3px drag threshold distinguishes drag from click so click-to-close still works. Zooming out to 1 snaps pan to `{0, 0}`; zooming out from higher scales re-clamps existing pan to the new bounds.

**Tech Stack:** TypeScript, vanilla DOM APIs (PointerEvent, pointer capture, `getBoundingClientRect`), Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-04-21-image-lightbox-pan-drag-design.md`

---

## File Structure

- **Modify** `src/tools/image/ui.ts` — add pan state, drag handlers, transform composition inside `openLightbox`.
- **Modify** `src/styles/main.css` — update `.blok-image-lightbox` and `.blok-image-lightbox__image` cursor / `touch-action` / `pointer-events` / transition.
- **Create** `test/unit/tools/image-lightbox-pan.test.ts` — TDD tests for all pan behaviors (kept separate from existing `test/unit/tools/image-lightbox.test.ts` which covers toolbar + CSS regressions).

All drag logic lives inside `openLightbox` — it's local, self-contained, and doesn't warrant extraction. No new files in `src/`.

---

## Shared Test Helpers (used throughout)

Every test in `image-lightbox-pan.test.ts` uses the following imports and helpers — reproduce them verbatim at the top of the file:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { openLightbox } from '../../../src/tools/image/ui';

afterEach(() => {
  document.body.replaceChildren();
});

function dialog(): HTMLElement {
  return document.body.querySelector('.blok-image-lightbox') as HTMLElement;
}

function image(): HTMLImageElement {
  return document.body.querySelector('.blok-image-lightbox__image') as HTMLImageElement;
}

function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  const full: DOMRect = {
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
    width: 0, height: 0, toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  el.getBoundingClientRect = () => full;
}

function openWithCapture(): () => void {
  const close = openLightbox({ url: 'https://example.com/pic.jpg', fileName: 'pic.jpg' });
  const d = dialog();
  d.setPointerCapture = (): void => undefined;
  d.releasePointerCapture = (): void => undefined;
  // 800x600 image fills viewport; gives non-zero clamp bounds.
  stubRect(image(), { width: 800, height: 600 });
  return close;
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
```

---

## Task 1: Compose translate + scale in a single transform string

**Files:**
- Modify: `src/tools/image/ui.ts` (function `openLightbox`, around lines 144-150)
- Test: `test/unit/tools/image-lightbox-pan.test.ts` (new file)

- [ ] **Step 1: Create the test file with shared helpers**

Create `test/unit/tools/image-lightbox-pan.test.ts` with the imports, `afterEach`, and helper functions from the "Shared Test Helpers" section above. Leave the file with no `describe` blocks yet.

- [ ] **Step 2: Write the failing test**

Append to `test/unit/tools/image-lightbox-pan.test.ts`:

```ts
describe('openLightbox transform composition', () => {
  it('initial transform is translate(0,0) scale(1)', () => {
    const close = openWithCapture();
    expect(image().style.transform).toBe('translate(0px, 0px) scale(1)');
    close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts`
Expected: FAIL — received `scale(1)` (no `translate(...)` prefix).

- [ ] **Step 4: Implement the minimal change**

In `src/tools/image/ui.ts`, inside `openLightbox`, locate:

```ts
const zoomState = { value: 1 };

const setZoom = (next: number): void => {
  zoomState.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  img.style.transform = `scale(${zoomState.value})`;
  syncResetLabel();
};
```

Replace with:

```ts
const zoomState = { value: 1 };
const panState = { x: 0, y: 0 };

const applyTransform = (): void => {
  img.style.transform = `translate(${panState.x}px, ${panState.y}px) scale(${zoomState.value})`;
};

const setZoom = (next: number): void => {
  zoomState.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  applyTransform();
  syncResetLabel();
};
```

Also call `applyTransform()` once immediately after the declarations so the initial style is set before the image is appended (add the call right after the `setZoom` definition):

```ts
applyTransform();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts`
Expected: PASS.

Also run the existing lightbox test to confirm no regression:
Run: `yarn test test/unit/tools/image-lightbox.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/image/ui.ts test/unit/tools/image-lightbox-pan.test.ts
git commit -m "refactor(image): compose translate+scale in lightbox transform"
```

---

## Task 2: Drag translates image

**Files:**
- Modify: `src/tools/image/ui.ts`
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/tools/image-lightbox-pan.test.ts`:

```ts
describe('openLightbox drag-to-pan', () => {
  it('translates image by drag delta after crossing 3px threshold', () => {
    const close = openWithCapture();
    const d = dialog();
    d.dispatchEvent(pointer('pointerdown', 100, 100));
    d.dispatchEvent(pointer('pointermove', 150, 140));
    d.dispatchEvent(pointer('pointerup', 150, 140));
    expect(image().style.transform).toBe('translate(50px, 40px) scale(1)');
    close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "translates image by drag delta"`
Expected: FAIL — transform remains `translate(0px, 0px) scale(1)`.

- [ ] **Step 3: Implement drag handlers**

In `src/tools/image/ui.ts`, immediately before `dialog.addEventListener('click', ...)` (around line 205), insert:

```ts
const DRAG_THRESHOLD = 3;
const dragState = {
  pointerDown: false,
  dragging: false,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
};

const clampPan = (p: { x: number; y: number }): { x: number; y: number } => {
  const rect = img.getBoundingClientRect();
  const maxX = rect.width / 2;
  const maxY = rect.height / 2;
  return {
    x: Math.max(-maxX, Math.min(maxX, p.x)),
    y: Math.max(-maxY, Math.min(maxY, p.y)),
  };
};

dialog.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.target instanceof Node && toolbar.contains(event.target)) return;
  dragState.pointerDown = true;
  dragState.dragging = false;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.originX = panState.x;
  dragState.originY = panState.y;
  dialog.setPointerCapture(event.pointerId);
});

dialog.addEventListener('pointermove', (event: PointerEvent) => {
  if (!dragState.pointerDown) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (!dragState.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    dragState.dragging = true;
    dialog.classList.add('is-dragging');
  }
  if (!dragState.dragging) return;
  const next = clampPan({ x: dragState.originX + dx, y: dragState.originY + dy });
  panState.x = next.x;
  panState.y = next.y;
  applyTransform();
});

const endDrag = (): void => {
  if (!dragState.pointerDown) return;
  dragState.pointerDown = false;
  dialog.classList.remove('is-dragging');
};

dialog.addEventListener('pointerup', endDrag);
dialog.addEventListener('pointercancel', endDrag);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "translates image by drag delta"`
Expected: PASS.

Also run full pan file:
Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts test/unit/tools/image-lightbox-pan.test.ts
git commit -m "feat(image): drag to pan image in fullscreen lightbox"
```

---

## Task 3: Click without drag still closes the lightbox

**Files:**
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('closes lightbox on click without drag (pointer movement ≤ 3px)', () => {
  const close = openWithCapture();
  const d = dialog();
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', 101, 101));
  d.dispatchEvent(pointer('pointerup', 101, 101));
  d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  close();
});
```

- [ ] **Step 2: Run test to verify it fails OR passes unexpectedly**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "closes lightbox on click"`

Expected: PASS (the existing click handler already closes). If it passes, the test still serves as a regression guard — confirm behavior is correct and proceed.

If it FAILS unexpectedly (e.g., a previous task accidentally suppressed all clicks), stop and fix `src/tools/image/ui.ts` so a no-drag pointer sequence does not suppress the click.

- [ ] **Step 3: Commit**

```bash
git add test/unit/tools/image-lightbox-pan.test.ts
git commit -m "test(image): click without drag still closes lightbox"
```

---

## Task 4: Drag then release does NOT close the lightbox

**Files:**
- Modify: `src/tools/image/ui.ts`
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('does not close after a drag gesture', () => {
  const close = openWithCapture();
  const d = dialog();
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', 150, 140));
  d.dispatchEvent(pointer('pointerup', 150, 140));
  d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.body.querySelector('.blok-image-lightbox')).not.toBeNull();
  close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "does not close after a drag"`
Expected: FAIL — dialog is removed because the existing click handler fires after the drag.

- [ ] **Step 3: Install one-shot click swallower when a drag ends**

In `src/tools/image/ui.ts`, modify `endDrag` to swallow the next click when a drag actually occurred:

```ts
const endDrag = (): void => {
  if (!dragState.pointerDown) return;
  dragState.pointerDown = false;
  dialog.classList.remove('is-dragging');
  if (dragState.dragging) {
    dragState.dragging = false;
    const swallow = (e: MouseEvent): void => {
      e.stopPropagation();
      dialog.removeEventListener('click', swallow, true);
    };
    dialog.addEventListener('click', swallow, true);
  }
};
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts`
Expected: all pass, including the new "does not close after a drag" and the earlier "closes lightbox on click".

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts test/unit/tools/image-lightbox-pan.test.ts
git commit -m "feat(image): suppress close-on-click after a pan drag"
```

---

## Task 5: Pan is clamped at bounds

**Files:**
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('clamps pan to half the image rect on each axis', () => {
  const close = openWithCapture(); // stubs rect to 800x600
  const d = dialog();
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', 100000, 100000));
  d.dispatchEvent(pointer('pointerup', 100000, 100000));
  // maxX = 800/2 = 400, maxY = 600/2 = 300
  expect(image().style.transform).toBe('translate(400px, 300px) scale(1)');
  close();
});

it('clamps pan in the negative direction', () => {
  const close = openWithCapture();
  const d = dialog();
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', -100000, -100000));
  d.dispatchEvent(pointer('pointerup', -100000, -100000));
  expect(image().style.transform).toBe('translate(-400px, -300px) scale(1)');
  close();
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "clamps pan"`
Expected: PASS — clamp was implemented in Task 2; these tests lock it in as regression coverage.

If they FAIL, fix the `clampPan` implementation in `src/tools/image/ui.ts` so the max-per-axis equals `rect.{width,height}/2`.

- [ ] **Step 3: Commit**

```bash
git add test/unit/tools/image-lightbox-pan.test.ts
git commit -m "test(image): lock in pan clamp bounds"
```

---

## Task 6: Zoom back to 1× snaps pan to `{0, 0}`

**Files:**
- Modify: `src/tools/image/ui.ts`
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('snaps pan to (0,0) when zoom returns to 1', () => {
  const close = openWithCapture();
  const d = dialog();
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', 200, 200));
  d.dispatchEvent(pointer('pointerup', 200, 200));
  expect(image().style.transform).toContain('translate(100px, 100px)');

  const reset = d.querySelector<HTMLButtonElement>('[data-action="zoom-reset"]')!;
  reset.click();
  expect(image().style.transform).toBe('translate(0px, 0px) scale(1)');
  close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "snaps pan"`
Expected: FAIL — after reset, transform is `translate(100px, 100px) scale(1)` (pan preserved).

- [ ] **Step 3: Reset pan inside `setZoom` when clamped value is 1**

In `src/tools/image/ui.ts`, update `setZoom`:

```ts
const setZoom = (next: number): void => {
  zoomState.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (zoomState.value === 1) {
    panState.x = 0;
    panState.y = 0;
  }
  applyTransform();
  syncResetLabel();
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts test/unit/tools/image-lightbox-pan.test.ts
git commit -m "feat(image): reset pan when lightbox zoom returns to 1×"
```

---

## Task 7: Zoom out above 1× re-clamps existing pan to new bounds

**Files:**
- Modify: `src/tools/image/ui.ts`
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

**Context:** When the user pans fully to the bound at scale 2, then zooms out to 1.25, the image shrinks. The previous pan offset may now exceed the new `rect.{width,height}/2` bound. Re-clamp so the image center stays inside the viewport.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('re-clamps pan when zooming out from a high scale', () => {
  const close = openWithCapture();
  const d = dialog();

  // Pan to the bound at the initial rect (400, 300).
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', 100000, 100000));
  d.dispatchEvent(pointer('pointerup', 100000, 100000));
  expect(image().style.transform).toContain('translate(400px, 300px)');

  // Simulate shrinking the rendered rect (as if zoom decreased).
  stubRect(image(), { width: 500, height: 400 });

  // Nudge zoom via the zoom-in button (value changes but still > 1), which triggers re-clamp.
  d.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.click();

  // New maxX = 250, maxY = 200.
  expect(image().style.transform).toContain('translate(250px, 200px)');
  close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "re-clamps pan when zooming"`
Expected: FAIL — pan still reads `translate(400px, 300px)` because `setZoom` only resets at exactly 1.

- [ ] **Step 3: Re-clamp pan in `setZoom` when staying above 1**

Update `setZoom` in `src/tools/image/ui.ts`:

```ts
const setZoom = (next: number): void => {
  zoomState.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (zoomState.value === 1) {
    panState.x = 0;
    panState.y = 0;
  } else {
    const clamped = clampPan(panState);
    panState.x = clamped.x;
    panState.y = clamped.y;
  }
  applyTransform();
  syncResetLabel();
};
```

Note: `clampPan` is declared later in the function body. Hoist its declaration above `setZoom`, or wrap it in a function declaration (`function clampPan(...)`) so it is hoisted. Use a function declaration:

```ts
function clampPan(p: { x: number; y: number }): { x: number; y: number } {
  const rect = img.getBoundingClientRect();
  const maxX = rect.width / 2;
  const maxY = rect.height / 2;
  return {
    x: Math.max(-maxX, Math.min(maxX, p.x)),
    y: Math.max(-maxY, Math.min(maxY, p.y)),
  };
}
```

Place the `function clampPan` declaration before `setZoom`, and remove the const-form `clampPan` declared inside Task 2. The rest of Task 2's pointer handlers continue to call `clampPan` the same way.

- [ ] **Step 4: Run tests to verify all pass**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/image/ui.ts test/unit/tools/image-lightbox-pan.test.ts
git commit -m "feat(image): re-clamp pan when lightbox zoom changes"
```

---

## Task 8: Toolbar clicks never start a drag

**Files:**
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('pointerdown on toolbar does not start a drag', () => {
  const close = openWithCapture();
  const d = dialog();
  const toolbar = d.querySelector<HTMLElement>('[data-role="lightbox-toolbar"]')!;
  const zoomIn = toolbar.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!;

  zoomIn.dispatchEvent(pointer('pointerdown', 500, 500));
  d.dispatchEvent(pointer('pointermove', 600, 600));
  d.dispatchEvent(pointer('pointerup', 600, 600));

  // Image was never translated.
  expect(image().style.transform).toBe('translate(0px, 0px) scale(1)');
  close();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "pointerdown on toolbar"`
Expected: PASS — Task 2 already guards `if (toolbar.contains(event.target)) return;`. This test is a regression guard.

If it FAILS, double-check that the pointerdown listener short-circuits when the target is inside the toolbar.

- [ ] **Step 3: Commit**

```bash
git add test/unit/tools/image-lightbox-pan.test.ts
git commit -m "test(image): lock in toolbar-immune lightbox drag"
```

---

## Task 9: CSS — grab cursor, touch-action, disable transition during drag

**Files:**
- Modify: `src/styles/main.css` (the `.blok-image-lightbox` + `.blok-image-lightbox__image` blocks at lines 3368-3392)
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` at the bottom of `test/unit/tools/image-lightbox-pan.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('lightbox pan CSS', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const mainCss = readFileSync(path.join(projectRoot, 'src/styles/main.css'), 'utf8');

  const ruleBody = (selectorPattern: RegExp): string => {
    const match = mainCss.match(selectorPattern);
    if (!match) throw new Error(`selector not found: ${selectorPattern}`);
    return match[1];
  };

  it('lightbox dialog declares grab cursor and disables touch scrolling', () => {
    const body = ruleBody(/\.blok-image-lightbox\s*\{([^}]+)\}/);
    expect(body).toMatch(/cursor:\s*grab/);
    expect(body).toMatch(/touch-action:\s*none/);
    expect(body).toMatch(/user-select:\s*none/);
    expect(body).not.toMatch(/cursor:\s*zoom-out/);
  });

  it('lightbox dialog has a grabbing cursor while dragging', () => {
    const body = ruleBody(/\.blok-image-lightbox\.is-dragging\s*\{([^}]+)\}/);
    expect(body).toMatch(/cursor:\s*grabbing/);
  });

  it('lightbox image ignores pointer events and disables transform transition while dragging', () => {
    const imgBody = ruleBody(/\.blok-image-lightbox__image\s*\{([^}]+)\}/);
    expect(imgBody).toMatch(/pointer-events:\s*none/);

    const dragImgBody = ruleBody(/\.blok-image-lightbox\.is-dragging\s+\.blok-image-lightbox__image\s*\{([^}]+)\}/);
    expect(dragImgBody).toMatch(/transition:\s*none/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "lightbox pan CSS"`
Expected: FAIL — current CSS uses `cursor: zoom-out`, has no `touch-action`, no `.is-dragging` rule, no `pointer-events: none` on the image.

- [ ] **Step 3: Update CSS**

In `src/styles/main.css`, replace the existing block from line 3368 to line 3392:

```css
.blok-image-lightbox {
  --blok-space-0-5: 2px;
  --blok-space-1: 4px;
  --blok-space-1-5: 6px;
  --blok-space-2: 8px;
  --blok-space-3: 12px;
  --blok-space-4: 16px;

  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(25, 25, 24, 0.92);
  z-index: 9999;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.blok-image-lightbox.is-dragging {
  cursor: grabbing;
}
.blok-image-lightbox__image {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  transform: scale(1);
  transform-origin: center center;
  transition: transform 120ms ease-out;
  pointer-events: none;
}
.blok-image-lightbox.is-dragging .blok-image-lightbox__image {
  transition: none;
}
```

- [ ] **Step 4: Run all lightbox tests to verify they pass**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts test/unit/tools/image-lightbox.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/styles/main.css test/unit/tools/image-lightbox-pan.test.ts
git commit -m "feat(image): grab/grabbing cursor + touch-action for lightbox pan"
```

---

## Task 10: Below-threshold movement still closes on click

**Files:**
- Test: `test/unit/tools/image-lightbox-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('openLightbox drag-to-pan', ...)` block:

```ts
it('tiny sub-threshold movement does not convert the gesture into a drag', () => {
  const close = openWithCapture();
  const d = dialog();
  d.dispatchEvent(pointer('pointerdown', 100, 100));
  d.dispatchEvent(pointer('pointermove', 102, 101)); // hypot = ~2.24 < 3
  d.dispatchEvent(pointer('pointerup', 102, 101));
  d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.body.querySelector('.blok-image-lightbox')).toBeNull();
  close();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `yarn test test/unit/tools/image-lightbox-pan.test.ts -t "sub-threshold"`
Expected: PASS — threshold logic in Task 2 already handles this. Regression guard.

- [ ] **Step 3: Commit**

```bash
git add test/unit/tools/image-lightbox-pan.test.ts
git commit -m "test(image): sub-threshold pointer moves still close lightbox"
```

---

## Task 11: Full regression run + landing the plane

- [ ] **Step 1: Run the full unit suite**

Run: `yarn test`
Expected: all green. If any test fails, diagnose and fix before proceeding.

- [ ] **Step 2: Run lint + type check**

Run: `yarn lint`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, if UI is reachable)**

Run: `yarn serve`, open the image tool in the playground, click the fullscreen button, then:

1. Drag — image moves, cursor shows `grabbing`.
2. Click (no drag) — lightbox closes.
3. Zoom in, drag to bounds — cannot drag past image-half.
4. Zoom back to 100% — image snaps to center.
5. Touch-drag on a mobile emulator or touch device — image pans, page does not scroll.

- [ ] **Step 4: Push**

```bash
git pull --rebase origin master
git push
```

- [ ] **Step 5: Verify remote is up to date**

Run: `git status`
Expected: `Your branch is up to date with 'origin/master'`.

---

## Self-Review Notes

- **Spec coverage:** All six user-visible behaviors, clamp math, and every test listed in the spec's Testing section map to Tasks 1-10. The spec's test #8 ("multi-touch / pointer capture: pointerup outside dialog still ends drag") is covered implicitly by pointer capture + `pointercancel` wiring in Task 2; if stricter coverage is desired, add a later task dispatching `pointercancel` and asserting `.is-dragging` is removed.
- **Placeholder scan:** No TBDs. Every code block shows full replacement snippets.
- **Type consistency:** `panState`, `applyTransform`, `clampPan`, `dragState`, `endDrag`, `DRAG_THRESHOLD` named consistently across Tasks 1-7.
- **DRY/YAGNI:** No new helper files; all logic stays inside `openLightbox`. No inertia, no keyboard pan, no pinch — per spec non-goals.
