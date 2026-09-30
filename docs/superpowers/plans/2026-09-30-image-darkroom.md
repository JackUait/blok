# Image Darkroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the image crop modal with an always-dark, spring-driven "Darkroom". The photo moves under a steady frame, and it flies out of its block and back in.

**Architecture:**
- A new `src/tools/image/darkroom/` module built from the DOM: one `<img>` moved by a CSS transform under a fixed frame.
- Internal state is a camera `{ s, tx, ty }` plus a frame box. It converts to the saved percent rect only at the edges.
- Pure modules (camera, history, spring) carry the math. `index.ts` wires them to `openModalDialog`.

**Tech stack:** TypeScript, vitest (jsdom 29), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-image-darkroom-design.md`

## Global Constraints

- Saved data unchanged: `ImageCrop = { x, y, w, h, shape? }`, in percent of the intrinsic image. Done semantics: circle/ellipse → `{ ...rect, shape }`, full rect → `null`, else `rect`.
- Not BREAKING. No `BREAKING` label. The six `--blok-crop-*` tokens in `src/styles/colors.css` shipped in v1.15.2 and MUST stay defined, even though nothing reads them any more.
- The Darkroom is always dark, in every theme. Done is a white fill with black ink. Nothing selected is ever blue. The selected chip uses `--blok-icon-active-bg` / `--blok-icon-active-text`.
- Radius Law (`test/unit/architecture/radius-law.test.ts`): every `border-radius` is `0`, `50%`, or `var(--blok-radius-…)` with **no** literal fallback. TS never sets a literal `borderRadius`. The frame's morphing radius goes through the custom property `--blok-radius-darkroom-frame`, set with `style.setProperty`.
- Modal: `openModalDialog` with `outside: false`. The Darkroom never registers its own Escape listener. The surface carries `data-blok-keyboard-owner` (`DATA_ATTR.keyboardOwner`).
- Kept e2e contract: `role="dialog"` named "Crop image", `data-action="done|cancel|reset"`, `data-blok-testid="image-crop-backdrop"` on the mounted content element, `role="radiogroup"` with `data-ratio` chips, initial focus on Done.
- Zoom ceiling: a crop can't be narrower than `MIN` (5%) from `crop-math.ts`.
- Constants: hold-to-peek 350 ms; pan slop 4 px; wheel-burst idle 250 ms; chrome fades out in 120 ms and back 400 ms after the gesture; keyboard nudge 1% of the frame (Shift 10%).
- Comments: short, only for what silently breaks if changed. Test rules: `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`, no `any` / `!` / `@ts-ignore`.
- Work in a worktree under `~/Packages/.blok-undo/` (other sessions edit this checkout; never `git add -A` or `commit -a`). Run only the tests named in each step. The final gates are in Task 12.

## Review Focus

1. **Ratio chips on non-square images.** Today `applyRatio(rect, 1)` on a full rect returns 100×100 percent, which on an 800×534 photo is an 800×534 crop, not a square. The Darkroom must convert pixel ratios with `percentRatio()` so 1:1 and Circle are truly square. Pinned in Task 2 and Task 7.
2. **Image not loaded yet, or an SVG with no intrinsic size.** Opening before `load`, or `naturalWidth === 0`, must not produce NaN transforms. Pinned in Task 6.
3. **Cmd+Z while the Darkroom is open must not undo the document.** Pinned in Task 6 (attribute) and Task 11 (e2e).
4. **A drag released over the dark surround must not cancel.** Pinned in Task 6 (unit) and Task 11 (e2e, replacing today's "backdrop click cancels").
5. **Float noise on Done.** A camera round trip can yield `99.99999`. Done rounds to 3 decimals before `isFullRect`, so an untouched full image saves `null`. Pinned in Task 6.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/components/utils/spring.ts` (new) | Multi-value spring engine, injectable clock, reduced-motion jump |
| `src/tools/image/crop-math.ts` (modify) | Export `MIN` |
| `src/tools/image/darkroom/camera.ts` (new) | Pure camera ↔ rect math, limits, zoom, rubber-band |
| `src/tools/image/darkroom/history.ts` (new) | Pure snapshot stack |
| `src/tools/image/darkroom/gestures.ts` (new) | Pointer/wheel state machine → semantic callbacks |
| `src/tools/image/darkroom/motion.ts` (new) | Chrome dissolve + fly-out clone |
| `src/tools/image/darkroom/index.ts` (new) | `openDarkroom()`: DOM, dialog, wiring |
| `src/tools/image/darkroom/darkroom.css` (new) | All styles |
| `src/tools/image/index.ts` (modify) | `enterCrop` calls `openDarkroom` |
| `src/styles/main.css` (modify) | Swap the crop CSS imports for `darkroom.css` |
| delete | `crop-editor.ts`, `crop-editor.css`, `crop-modal.ts`, `crop-modal.css` |
| `test/unit/helpers/fake-frame-clock.ts` (new) | Deterministic clock for spring-driven tests |

---

### Task 1: Spring engine

**Files:**
- Create: `src/components/utils/spring.ts`
- Create: `test/unit/helpers/fake-frame-clock.ts`
- Test: `test/unit/components/utils/spring.test.ts`

**Interfaces:**
- Produces:
  - `SpringClock { now(): number; request(cb: () => void): number; cancel(id: number): void }`
  - `SpringConfig { stiffness: number; damping: number }`, `SPRING_SNAPPY`, `SPRING_SOFT`
  - `createSpring<K extends string>(opts: SpringOptions<K>): Spring<K>`
  - `Spring<K> { to(t: Partial<Record<K, number>>): void; jump(v: Partial<Record<K, number>>): void; values(): Readonly<Record<K, number>>; isSettled(): boolean; stop(): void }`
  - `prefersReducedMotion(): boolean`
  - The test helper `fakeFrameClock(): { clock: SpringClock; advance(ms: number, frameMs?: number): void }`

- [ ] **Step 1: Write the test helper**

```ts
// test/unit/helpers/fake-frame-clock.ts
import type { SpringClock } from '../../../src/components/utils/spring';

export interface FakeFrameClock {
  clock: SpringClock;
  advance(ms: number, frameMs?: number): void;
}

export const fakeFrameClock = (): FakeFrameClock => {
  const state = { now: 0, id: 0 };
  const queue = new Map<number, () => void>();

  return {
    clock: {
      now: () => state.now,
      request: (cb) => {
        state.id += 1;
        queue.set(state.id, cb);

        return state.id;
      },
      cancel: (id) => {
        queue.delete(id);
      },
    },
    advance(ms, frameMs = 16) {
      for (let t = 0; t < ms; t += frameMs) {
        state.now += frameMs;
        const due = [...queue.values()];

        queue.clear();
        due.forEach((cb) => cb());
      }
    },
  };
};
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/unit/components/utils/spring.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpring, SPRING_SNAPPY } from '../../../../src/components/utils/spring';
import { fakeFrameClock } from '../../helpers/fake-frame-clock';

describe('createSpring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles every value on its target and reports it once', () => {
    const { clock, advance } = fakeFrameClock();
    const onSettle = vi.fn();
    const seen: number[] = [];
    const spring = createSpring({
      from: { x: 0, y: 10 },
      clock,
      reducedMotion: () => false,
      onUpdate: (v) => seen.push(v.x),
      onSettle,
    });

    spring.to({ x: 100, y: -10 });
    advance(3000);

    expect(spring.values()).toEqual({ x: 100, y: -10 });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(spring.isSettled()).toBe(true);
    expect(seen.length).toBeGreaterThan(5);
  });

  it('keeps its velocity when retargeted mid-flight', () => {
    const { clock, advance } = fakeFrameClock();
    const spring = createSpring({ from: { x: 0 }, clock, reducedMotion: () => false, onUpdate: () => {} });

    spring.to({ x: 100 });
    advance(64);
    const before = spring.values().x;

    // The new target is behind the value; a spring that dropped its velocity would move back at once.
    spring.to({ x: before - 1 });
    advance(16);

    expect(spring.values().x).toBeGreaterThan(before);
  });

  it('gives the same result at any frame rate', () => {
    const run = (frameMs: number): number => {
      const { clock, advance } = fakeFrameClock();
      const spring = createSpring({ from: { x: 0 }, clock, reducedMotion: () => false, onUpdate: () => {} });

      spring.to({ x: 100 });
      advance(96, frameMs);

      return spring.values().x;
    };

    expect(run(8)).toBeCloseTo(run(32), 6);
  });

  it('jumps straight to the target when motion is reduced', () => {
    const { clock } = fakeFrameClock();
    const onUpdate = vi.fn();
    const onSettle = vi.fn();
    const spring = createSpring({ from: { x: 0 }, clock, reducedMotion: () => true, onUpdate, onSettle });

    spring.to({ x: 42 });

    expect(spring.values().x).toBe(42);
    expect(onUpdate).toHaveBeenLastCalledWith({ x: 42 });
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it('jump() moves without animating and drops velocity', () => {
    const { clock, advance } = fakeFrameClock();
    const spring = createSpring({ from: { x: 0 }, config: SPRING_SNAPPY, clock, reducedMotion: () => false, onUpdate: () => {} });

    spring.to({ x: 100 });
    advance(32);
    spring.stop();
    spring.jump({ x: 5 });
    advance(200);

    expect(spring.values().x).toBe(5);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `yarn test test/unit/components/utils/spring.test.ts`
Expected: FAIL, "Failed to resolve import …/spring".

- [ ] **Step 4: Implement**

```ts
// src/components/utils/spring.ts
export interface SpringClock {
  now(): number;
  request(cb: () => void): number;
  cancel(id: number): void;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Critically damped: 2·√380 ≈ 39. */
export const SPRING_SNAPPY: SpringConfig = { stiffness: 380, damping: 39 };

/** Damping ratio ≈ 0.88, a hint of overshoot for flights. */
export const SPRING_SOFT: SpringConfig = { stiffness: 220, damping: 26 };

export interface SpringOptions<K extends string> {
  from: Record<K, number>;
  config?: SpringConfig;
  onUpdate(values: Readonly<Record<K, number>>): void;
  onSettle?(): void;
  clock?: SpringClock;
  reducedMotion?: () => boolean;
}

export interface Spring<K extends string> {
  to(target: Partial<Record<K, number>>): void;
  jump(values: Partial<Record<K, number>>): void;
  values(): Readonly<Record<K, number>>;
  isSettled(): boolean;
  stop(): void;
}

// Fixed 4 ms substeps keep the result identical at any frame rate.
const STEP_MS = 4;
// A stalled tab must not fling values on its first frame back.
const MAX_FRAME_MS = 64;
const EPSILON = 1e-3;

const rafClock: SpringClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (id) => cancelAnimationFrame(id),
};

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createSpring<K extends string>(opts: SpringOptions<K>): Spring<K> {
  const clock = opts.clock ?? rafClock;
  const config = opts.config ?? SPRING_SNAPPY;
  const reduced = opts.reducedMotion ?? prefersReducedMotion;
  const keys = Object.keys(opts.from) as K[];
  const pos: Record<K, number> = { ...opts.from };
  const target: Record<K, number> = { ...opts.from };
  const vel = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const run = { frame: 0, last: 0, active: false };

  const assign = (into: Record<K, number>, from: Partial<Record<K, number>>): void => {
    for (const k of keys) {
      const v = from[k];

      if (v !== undefined) into[k] = v;
    }
  };

  const atRest = (): boolean => keys.every((k) => {
    const tol = EPSILON * Math.max(1, Math.abs(target[k]));

    return Math.abs(pos[k] - target[k]) < tol && Math.abs(vel[k]) < tol;
  });

  const finish = (): void => {
    for (const k of keys) {
      pos[k] = target[k];
      vel[k] = 0;
    }
    run.active = false;
    opts.onUpdate(pos);
    opts.onSettle?.();
  };

  const tick = (): void => {
    const now = clock.now();
    const elapsed = Math.min(MAX_FRAME_MS, now - run.last);

    run.last = now;
    for (let t = 0; t < elapsed; t += STEP_MS) {
      const dt = Math.min(STEP_MS, elapsed - t) / 1000;

      for (const k of keys) {
        const force = -config.stiffness * (pos[k] - target[k]) - config.damping * vel[k];

        vel[k] += force * dt;
        pos[k] += vel[k] * dt;
      }
    }
    if (atRest()) {
      finish();

      return;
    }
    opts.onUpdate(pos);
    run.frame = clock.request(tick);
  };

  return {
    to(next) {
      assign(target, next);
      if (reduced()) {
        clock.cancel(run.frame);
        finish();

        return;
      }
      if (run.active) return;
      run.active = true;
      run.last = clock.now();
      run.frame = clock.request(tick);
    },
    jump(next) {
      assign(pos, next);
      assign(target, next);
      for (const k of keys) {
        if (next[k] !== undefined) vel[k] = 0;
      }
      opts.onUpdate(pos);
    },
    values: () => pos,
    isSettled: () => !run.active,
    stop() {
      clock.cancel(run.frame);
      run.active = false;
    },
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `yarn test test/unit/components/utils/spring.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Lint the changed files and commit**

```bash
npx eslint src/components/utils/spring.ts test/unit/components/utils/spring.test.ts test/unit/helpers/fake-frame-clock.ts
git add src/components/utils/spring.ts test/unit/components/utils/spring.test.ts test/unit/helpers/fake-frame-clock.ts
git commit -m "feat(utils): spring engine with fixed substeps and an injectable clock"
```

---

### Task 2: Camera math

**Files:**
- Modify: `src/tools/image/crop-math.ts:6` (`const MIN = 5;` → `export const MIN = 5;`)
- Create: `src/tools/image/darkroom/camera.ts`
- Test: `test/unit/tools/image/darkroom/camera.test.ts`

**Interfaces:**
- Consumes: `MIN`, `applyRatio`, `FULL_RECT` from `crop-math.ts`; `rubberBand` from `src/tools/image/spring.ts`.
- Produces:
  - Types: `Size { w; h }`, `Box { x; y; w; h }`, `Camera { s; tx; ty }`, `Insets { top; right; bottom; left }`, `Point { x; y }`
  - `rectAspect(r, n): number`
  - `percentRatio(pixelRatio, n): number`
  - `fitFrame(aspect, stage: Size, pad: Insets): Box`
  - `rectToCamera(r, n, frame): Camera`, `cameraToRect(c, n, frame): ImageCrop`
  - `rectToFrame(r, n, c): Box`
  - `scaleLimits(n, frame): { min; max }`
  - `clampCamera(c, n, frame): Camera`, `rubberCamera(c, n, frame): Camera`
  - `zoomAt(c, factor, p: Point, n, frame): Camera`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/darkroom/camera.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRatio, FULL_RECT } from '../../../../../src/tools/image/crop-math';
import {
  cameraToRect, clampCamera, fitFrame, percentRatio, rectAspect, rectToCamera,
  rectToFrame, rubberCamera, scaleLimits, zoomAt,
} from '../../../../../src/tools/image/darkroom/camera';

const N = { w: 800, h: 534 };
const STAGE = { w: 1200, h: 800 };
const PAD = { top: 72, right: 32, bottom: 96, left: 32 };

describe('darkroom camera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1:1 on a non-square photo is a square in pixels', () => {
    const square = applyRatio(FULL_RECT, percentRatio(1, N));

    expect(rectAspect(square, N)).toBeCloseTo(1, 6);
    expect(square.h).toBe(100);
  });

  it('fits the frame to the stage at the crop aspect, centred inside the insets', () => {
    const f = fitFrame(16 / 9, STAGE, PAD);

    expect(f.w / f.h).toBeCloseTo(16 / 9, 6);
    expect(f.x + f.w / 2).toBeCloseTo(PAD.left + (STAGE.w - PAD.left - PAD.right) / 2, 6);
    expect(f.w <= STAGE.w - PAD.left - PAD.right + 1e-9).toBe(true);
    expect(f.h <= STAGE.h - PAD.top - PAD.bottom + 1e-9).toBe(true);
  });

  it.each([
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 10, y: 20, w: 50, h: 30 },
    { x: 94, y: 94, w: 6, h: 6 },
  ])('rect → camera → rect round-trips %o', (r) => {
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const back = cameraToRect(rectToCamera(r, N, frame), N, frame);

    expect(back.x).toBeCloseTo(r.x, 6);
    expect(back.y).toBeCloseTo(r.y, 6);
    expect(back.w).toBeCloseTo(r.w, 6);
    expect(back.h).toBeCloseTo(r.h, 6);
  });

  it('rectToFrame places the rect where the camera shows it', () => {
    const r = { x: 10, y: 20, w: 50, h: 30 };
    const frame = fitFrame(rectAspect(r, N), STAGE, PAD);
    const placed = rectToFrame(r, N, rectToCamera(r, N, frame));

    expect(placed.x).toBeCloseTo(frame.x, 6);
    expect(placed.w).toBeCloseTo(frame.w, 6);
  });

  it('zoom-out stops where the photo still covers the frame; zoom-in stops at a 5% crop', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const { min, max } = scaleLimits(N, frame);
    const cam = rectToCamera(FULL_RECT, N, frame);

    expect(min).toBeCloseTo(cam.s, 6);
    expect(cameraToRect({ ...cam, s: max }, N, frame).w).toBeCloseTo(5, 6);
  });

  it('zoomAt keeps the image point under the pointer fixed', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);
    const p = { x: frame.x + frame.w * 0.25, y: frame.y + frame.h * 0.5 };
    const z = zoomAt(cam, 2, p, N, frame);
    const imageU = (p.x - cam.tx) / cam.s;

    expect((p.x - z.tx) / z.s).toBeCloseTo(imageU, 6);
    expect(z.s).toBeCloseTo(cam.s * 2, 6);
  });

  it('clampCamera never leaves an empty edge inside the frame', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);
    const c = clampCamera({ ...cam, tx: cam.tx + 500 }, N, frame);

    expect(c.tx).toBeCloseTo(frame.x, 6);
  });

  it('rubberCamera stretches past the edge by less than the push', () => {
    const frame = fitFrame(rectAspect(FULL_RECT, N), STAGE, PAD);
    const cam = rectToCamera(FULL_RECT, N, frame);
    const r = rubberCamera({ ...cam, tx: frame.x + 200 }, N, frame);

    expect(r.tx).toBeGreaterThan(frame.x);
    expect(r.tx).toBeLessThan(frame.x + 200);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `yarn test test/unit/tools/image/darkroom/camera.test.ts`
Expected: FAIL, the import can't be resolved.

- [ ] **Step 3: Export `MIN` and implement `camera.ts`**

In `src/tools/image/crop-math.ts`, change `const MIN = 5;` to `export const MIN = 5;`.

```ts
// src/tools/image/darkroom/camera.ts
import type { ImageCrop } from '../../../../types/tools/image';
import { MIN } from '../crop-math';
import { rubberBand } from '../spring';

export interface Size { w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

/** Photo point (u, v) in natural px sits at stage (tx + s·u, ty + s·v). */
export interface Camera { s: number; tx: number; ty: number }

type Range = [number, number];

export function rectAspect(r: ImageCrop, n: Size): number {
  return (r.w * n.w) / (r.h * n.h);
}

/** crop-math's applyRatio works in percent space; 16:9 in pixels is 16/9 · h/w there. */
export function percentRatio(pixelRatio: number, n: Size): number {
  return (pixelRatio * n.h) / n.w;
}

export function fitFrame(aspect: number, stage: Size, pad: Insets): Box {
  const availW = Math.max(1, stage.w - pad.left - pad.right);
  const availH = Math.max(1, stage.h - pad.top - pad.bottom);
  const w = Math.min(availW, availH * aspect);
  const h = w / aspect;

  return { x: pad.left + (availW - w) / 2, y: pad.top + (availH - h) / 2, w, h };
}

export function rectToCamera(r: ImageCrop, n: Size, frame: Box): Camera {
  const s = frame.w / ((r.w / 100) * n.w);

  return { s, tx: frame.x - (r.x / 100) * n.w * s, ty: frame.y - (r.y / 100) * n.h * s };
}

export function cameraToRect(c: Camera, n: Size, frame: Box): ImageCrop {
  return {
    x: ((frame.x - c.tx) / c.s / n.w) * 100,
    y: ((frame.y - c.ty) / c.s / n.h) * 100,
    w: (frame.w / c.s / n.w) * 100,
    h: (frame.h / c.s / n.h) * 100,
  };
}

export function rectToFrame(r: ImageCrop, n: Size, c: Camera): Box {
  return {
    x: c.tx + (r.x / 100) * n.w * c.s,
    y: c.ty + (r.y / 100) * n.h * c.s,
    w: (r.w / 100) * n.w * c.s,
    h: (r.h / 100) * n.h * c.s,
  };
}

export function scaleLimits(n: Size, frame: Box): { min: number; max: number } {
  const min = Math.max(frame.w / n.w, frame.h / n.h);
  const max = Math.min(frame.w / ((MIN / 100) * n.w), frame.h / ((MIN / 100) * n.h));

  return { min, max: Math.max(min, max) };
}

const panRange = (c: Camera, n: Size, frame: Box): { tx: Range; ty: Range } => ({
  tx: [frame.x + frame.w - c.s * n.w, frame.x],
  ty: [frame.y + frame.h - c.s * n.h, frame.y],
});

const clamp = (v: number, [lo, hi]: Range): number => Math.min(hi, Math.max(lo, v));

const stretch = (v: number, [lo, hi]: Range, dimension: number): number => {
  if (v < lo) return lo - rubberBand(lo - v, dimension);
  if (v > hi) return hi + rubberBand(v - hi, dimension);

  return v;
};

export function clampCamera(c: Camera, n: Size, frame: Box): Camera {
  const { min, max } = scaleLimits(n, frame);
  const s = Math.min(max, Math.max(min, c.s));
  const range = panRange({ ...c, s }, n, frame);

  return { s, tx: clamp(c.tx, range.tx), ty: clamp(c.ty, range.ty) };
}

export function rubberCamera(c: Camera, n: Size, frame: Box): Camera {
  const range = panRange(c, n, frame);

  return { s: c.s, tx: stretch(c.tx, range.tx, frame.w), ty: stretch(c.ty, range.ty, frame.h) };
}

export function zoomAt(c: Camera, factor: number, p: Point, n: Size, frame: Box): Camera {
  const { min, max } = scaleLimits(n, frame);
  const s = Math.min(max, Math.max(min, c.s * factor));
  const k = s / c.s;

  return clampCamera({ s, tx: p.x - (p.x - c.tx) * k, ty: p.y - (p.y - c.ty) * k }, n, frame);
}
```

- [ ] **Step 4: Run the tests, plus the crop-math suites the export touches**

Run: `yarn test test/unit/tools/image/darkroom/camera.test.ts`, then `yarn test test/unit/tools/image/crop-math.test.ts`
Expected: both PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/crop-math.ts src/tools/image/darkroom/camera.ts test/unit/tools/image/darkroom/camera.test.ts
git add src/tools/image/crop-math.ts src/tools/image/darkroom/camera.ts test/unit/tools/image/darkroom/camera.test.ts
git commit -m "feat(image): darkroom camera math for a photo under a steady frame"
```

---

### Task 3: History

**Files:**
- Create: `src/tools/image/darkroom/history.ts`
- Test: `test/unit/tools/image/darkroom/history.test.ts`

**Interfaces:**
- Produces:
  - `Snapshot { rect: ImageCrop; ratioKey: string }`
  - `createHistory(initial: Snapshot): CropHistory`
  - `CropHistory { push(s: Snapshot): void; undo(): Snapshot | null; redo(): Snapshot | null; current(): Snapshot }`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/darkroom/history.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory } from '../../../../../src/tools/image/darkroom/history';

const snap = (x: number, ratioKey = 'free') => ({ rect: { x, y: 0, w: 50, h: 50 }, ratioKey });

describe('darkroom history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('undo and redo walk the pushed snapshots', () => {
    const h = createHistory(snap(0));

    h.push(snap(10));
    h.push(snap(20));

    expect(h.undo()).toEqual(snap(10));
    expect(h.undo()).toEqual(snap(0));
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual(snap(10));
    expect(h.current()).toEqual(snap(10));
  });

  it('a push after an undo drops the redo tail', () => {
    const h = createHistory(snap(0));

    h.push(snap(10));
    h.undo();
    h.push(snap(30));

    expect(h.redo()).toBeNull();
    expect(h.undo()).toEqual(snap(0));
  });

  it('ignores a push equal to the current snapshot', () => {
    const h = createHistory(snap(0));

    h.push(snap(0));

    expect(h.undo()).toBeNull();
  });

  it('a ratio change alone is a new entry', () => {
    const h = createHistory(snap(0));

    h.push(snap(0, 'circle'));

    expect(h.undo()).toEqual(snap(0));
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `yarn test test/unit/tools/image/darkroom/history.test.ts`
Expected: FAIL, the import can't be resolved.

- [ ] **Step 3: Implement**

```ts
// src/tools/image/darkroom/history.ts
import type { ImageCrop } from '../../../../types/tools/image';

export interface Snapshot {
  rect: ImageCrop;
  ratioKey: string;
}

export interface CropHistory {
  push(s: Snapshot): void;
  undo(): Snapshot | null;
  redo(): Snapshot | null;
  current(): Snapshot;
}

// Camera round trips leave float noise; smaller changes are not a new step.
const SAME = 1e-6;

const same = (a: Snapshot, b: Snapshot): boolean => a.ratioKey === b.ratioKey
  && Math.abs(a.rect.x - b.rect.x) < SAME && Math.abs(a.rect.y - b.rect.y) < SAME
  && Math.abs(a.rect.w - b.rect.w) < SAME && Math.abs(a.rect.h - b.rect.h) < SAME;

export function createHistory(initial: Snapshot): CropHistory {
  const entries: Snapshot[] = [initial];
  const at = { i: 0 };

  return {
    push(s) {
      if (same(s, entries[at.i])) return;
      entries.splice(at.i + 1);
      entries.push(s);
      at.i = entries.length - 1;
    },
    undo() {
      if (at.i === 0) return null;
      at.i -= 1;

      return entries[at.i];
    },
    redo() {
      if (at.i === entries.length - 1) return null;
      at.i += 1;

      return entries[at.i];
    },
    current: () => entries[at.i],
  };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `yarn test test/unit/tools/image/darkroom/history.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/darkroom/history.ts test/unit/tools/image/darkroom/history.test.ts
git add src/tools/image/darkroom/history.ts test/unit/tools/image/darkroom/history.test.ts
git commit -m "feat(image): darkroom undo stack"
```

---

### Task 4: Gestures

**Files:**
- Create: `src/tools/image/darkroom/gestures.ts`
- Test: `test/unit/tools/image/darkroom/gestures.test.ts`

**Interfaces:**
- Consumes: `Handle` from `crop-math.ts`; `Point` from `camera.ts`.
- Produces:
  - `GestureKind = 'pan' | 'handle' | 'zoom'`
  - `GestureHandlers { onStart(kind); onPan(dx, dy); onHandle(h, dx, dy); onZoom(factor, center: Point, dx, dy); onEnd(kind); onPeek(active) }`
  - `attachGestures(stage: HTMLElement, h: GestureHandlers): () => void`
  - `HOLD_MS = 350`, `SLOP_PX = 4`, `WHEEL_IDLE_MS = 250`
- Semantics:
  - `onPan` and `onHandle` get the **total** delta since the gesture started.
  - `onZoom` gets an **incremental** factor and midpoint delta since its last call.
  - Points are in stage coordinates, meaning client minus `stage.getBoundingClientRect()`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/darkroom/gestures.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachGestures, HOLD_MS, WHEEL_IDLE_MS, type GestureHandlers } from '../../../../../src/tools/image/darkroom/gestures';

const handlers = (): GestureHandlers => ({
  onStart: vi.fn(), onPan: vi.fn(), onHandle: vi.fn(), onZoom: vi.fn(), onEnd: vi.fn(), onPeek: vi.fn(),
});

const fire = (el: Element, type: string, init: PointerEventInit): void => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
};

describe('darkroom gestures', () => {
  let stage: HTMLElement;
  let detach: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stage = document.createElement('div');
    document.body.appendChild(stage);
  });

  afterEach(() => {
    detach();
    stage.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a drag past the slop pans with the total delta', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { clientX: 100, clientY: 100 });
    fire(stage, 'pointermove', { clientX: 102, clientY: 100 });
    expect(h.onStart).not.toHaveBeenCalled();
    fire(stage, 'pointermove', { clientX: 130, clientY: 90 });
    fire(stage, 'pointerup', { clientX: 130, clientY: 90 });

    expect(h.onStart).toHaveBeenCalledWith('pan');
    expect(h.onPan).toHaveBeenLastCalledWith(30, -10);
    expect(h.onEnd).toHaveBeenCalledWith('pan');
  });

  it('holding still peeks, and release ends the peek without a pan', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(HOLD_MS);
    expect(h.onPeek).toHaveBeenLastCalledWith(true);
    fire(stage, 'pointerup', { clientX: 100, clientY: 100 });

    expect(h.onPeek).toHaveBeenLastCalledWith(false);
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('moving before the hold fires cancels the peek', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { clientX: 100, clientY: 100 });
    fire(stage, 'pointermove', { clientX: 120, clientY: 100 });
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(h.onPeek).not.toHaveBeenCalled();
  });

  it('a press on a handle resizes with that handle', () => {
    const h = handlers();
    const handle = document.createElement('span');

    handle.setAttribute('data-handle', 'se');
    stage.appendChild(handle);
    detach = attachGestures(stage, h);
    fire(handle, 'pointerdown', { clientX: 10, clientY: 10 });
    fire(handle, 'pointermove', { clientX: 5, clientY: 0 });
    fire(handle, 'pointerup', { clientX: 5, clientY: 0 });

    expect(h.onStart).toHaveBeenCalledWith('handle');
    expect(h.onHandle).toHaveBeenLastCalledWith('se', -5, -10);
    expect(h.onEnd).toHaveBeenCalledWith('handle');
  });

  it('two pointers pinch-zoom around their midpoint', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    fire(stage, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    fire(stage, 'pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    fire(stage, 'pointermove', { pointerId: 2, clientX: 300, clientY: 100 });

    expect(h.onStart).toHaveBeenCalledWith('zoom');
    const [factor, center] = vi.mocked(h.onZoom).mock.calls[0];

    expect(factor).toBeCloseTo(2, 6);
    expect(center).toEqual({ x: 200, y: 100 });
  });

  it('a ctrl+wheel burst is one zoom gesture that ends after idle', () => {
    const h = handlers();

    detach = attachGestures(stage, h);
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 50, clientY: 60, cancelable: true }));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 50, clientY: 60, cancelable: true }));
    vi.advanceTimersByTime(WHEEL_IDLE_MS);

    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onZoom).toHaveBeenCalledTimes(2);
    expect(vi.mocked(h.onZoom).mock.calls[0][0]).toBeGreaterThan(1);
    expect(h.onEnd).toHaveBeenCalledWith('zoom');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `yarn test test/unit/tools/image/darkroom/gestures.test.ts`
Expected: FAIL, the import can't be resolved.

- [ ] **Step 3: Implement**

```ts
// src/tools/image/darkroom/gestures.ts
import type { Handle } from '../crop-math';
import type { Point } from './camera';

export type GestureKind = 'pan' | 'handle' | 'zoom';

export interface GestureHandlers {
  onStart(kind: GestureKind): void;
  onPan(dx: number, dy: number): void;
  onHandle(handle: Handle, dx: number, dy: number): void;
  onZoom(factor: number, center: Point, dx: number, dy: number): void;
  onEnd(kind: GestureKind): void;
  onPeek(active: boolean): void;
}

export const HOLD_MS = 350;
export const SLOP_PX = 4;
export const WHEEL_IDLE_MS = 250;

// macOS trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel needs a gentler rate.
const PINCH_RATE = 0.01;
const WHEEL_RATE = 0.002;

type Mode = 'idle' | 'pending' | 'pan' | 'handle' | 'pinch' | 'peek';

const isHandle = (v: string | null): v is Handle =>
  v !== null && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(v);

export function attachGestures(stage: HTMLElement, h: GestureHandlers): () => void {
  const pointers = new Map<number, Point>();
  const st = {
    mode: 'idle' as Mode,
    origin: { x: 0, y: 0 },
    handle: 'se' as Handle,
    hold: 0,
    wheelIdle: 0,
    pinchDist: 0,
    pinchMid: { x: 0, y: 0 },
  };

  const local = (e: MouseEvent): Point => {
    const r = stage.getBoundingClientRect();

    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pinchGeometry = (): { dist: number; mid: Point } => {
    const [a, b] = [...pointers.values()];

    return { dist: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const endActive = (): void => {
    window.clearTimeout(st.hold);
    if (st.mode === 'pan' || st.mode === 'handle') h.onEnd(st.mode);
    if (st.mode === 'pinch') h.onEnd('zoom');
    if (st.mode === 'peek') h.onPeek(false);
    st.mode = 'idle';
  };

  const onDown = (e: PointerEvent): void => {
    const p = local(e);

    pointers.set(e.pointerId, p);
    stage.setPointerCapture?.(e.pointerId);
    e.preventDefault();

    if (pointers.size === 2) {
      endActive();
      const g = pinchGeometry();

      st.mode = 'pinch';
      st.pinchDist = g.dist;
      st.pinchMid = g.mid;
      h.onStart('zoom');

      return;
    }
    if (pointers.size > 2) return;

    const handle = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') ?? null : null;

    st.origin = p;
    if (isHandle(handle)) {
      st.mode = 'handle';
      st.handle = handle;
      h.onStart('handle');

      return;
    }
    st.mode = 'pending';
    st.hold = window.setTimeout(() => {
      if (st.mode !== 'pending') return;
      st.mode = 'peek';
      h.onPeek(true);
    }, HOLD_MS);
  };

  const onMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);

    pointers.set(e.pointerId, p);
    const dx = p.x - st.origin.x;
    const dy = p.y - st.origin.y;

    if (st.mode === 'pending' && Math.hypot(dx, dy) > SLOP_PX) {
      window.clearTimeout(st.hold);
      st.mode = 'pan';
      h.onStart('pan');
    }
    if (st.mode === 'pan') h.onPan(dx, dy);
    if (st.mode === 'handle') h.onHandle(st.handle, dx, dy);
    if (st.mode === 'pinch' && pointers.size === 2) {
      const g = pinchGeometry();

      h.onZoom(g.dist / st.pinchDist, g.mid, g.mid.x - st.pinchMid.x, g.mid.y - st.pinchMid.y);
      st.pinchDist = g.dist;
      st.pinchMid = g.mid;
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (st.mode === 'pinch' && pointers.size === 1) {
      h.onEnd('zoom');
      // The finger left on the glass does nothing until it lifts too.
      st.mode = 'idle';

      return;
    }
    if (pointers.size === 0) endActive();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rate = e.ctrlKey ? PINCH_RATE : WHEEL_RATE;

    if (st.wheelIdle === 0) h.onStart('zoom');
    window.clearTimeout(st.wheelIdle);
    h.onZoom(Math.exp(-e.deltaY * rate), local(e), 0, 0);
    st.wheelIdle = window.setTimeout(() => {
      st.wheelIdle = 0;
      h.onEnd('zoom');
    }, WHEEL_IDLE_MS);
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });

  return (): void => {
    window.clearTimeout(st.hold);
    window.clearTimeout(st.wheelIdle);
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    stage.removeEventListener('wheel', onWheel);
  };
}
```

Pointer capture sends every move and up event to `stage`, even when the press began on a handle. The "handle" test dispatches on the handle, and the event bubbles to `stage`.

- [ ] **Step 4: Run and confirm it passes**

Run: `yarn test test/unit/tools/image/darkroom/gestures.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/darkroom/gestures.ts test/unit/tools/image/darkroom/gestures.test.ts
git add src/tools/image/darkroom/gestures.ts test/unit/tools/image/darkroom/gestures.test.ts
git commit -m "feat(image): darkroom pointer, pinch, wheel and hold gestures"
```

---

### Task 5: Motion helpers (chrome dissolve and fly-out)

**Files:**
- Create: `src/tools/image/darkroom/motion.ts`
- Test: `test/unit/tools/image/darkroom/motion.test.ts`

**Interfaces:**
- Consumes: `createSpring`, `SPRING_SOFT`, `SpringClock` (Task 1); `Box`, `Size`, `rectToCamera` (Task 2).
- Produces:
  - `createDissolve(targets: HTMLElement[], grid: HTMLElement): { begin(): void; end(): void; destroy(): void }`
  - `FlyOutOptions { url: string; natural: Size; rect: ImageCrop; from: Box; fromRound: number; target: HTMLElement | null; targetRound: number; clock?: SpringClock; reducedMotion?: () => boolean; onDone?(): void }`
  - `flyOut(opts: FlyOutOptions): void` (boxes in viewport px; `round` runs 0…1, where 1 = 50%)
  - `CHROME_OUT_MS = 120`, `CHROME_BACK_DELAY_MS = 400`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/darkroom/motion.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHROME_BACK_DELAY_MS, createDissolve, flyOut } from '../../../../../src/tools/image/darkroom/motion';
import { fakeFrameClock } from '../../../helpers/fake-frame-clock';

describe('darkroom motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dissolve fades the chrome by opacity only and brings it back after the gesture', () => {
    const bar = document.createElement('div');
    const grid = document.createElement('div');
    const d = createDissolve([bar], grid);

    d.begin();
    expect(bar.style.opacity).toBe('0');
    expect(grid.style.opacity).toBe('1');
    expect(bar.hidden).toBe(false);
    expect(bar.hasAttribute('aria-hidden')).toBe(false);

    d.end();
    vi.advanceTimersByTime(CHROME_BACK_DELAY_MS);
    expect(bar.style.opacity).toBe('');
    expect(grid.style.opacity).toBe('');
  });

  it('fly-out lands the clone on the target box, then reveals the target', () => {
    const { clock, advance } = fakeFrameClock();
    const target = document.createElement('div');

    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 200, 100));
    const onDone = vi.fn();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 100, y: 100, w: 800, h: 400 }, fromRound: 0, target, targetRound: 0,
      clock, reducedMotion: () => false, onDone,
    });

    const flight = document.querySelector<HTMLElement>('[data-role="darkroom-flight"]');

    expect(flight).not.toBeNull();
    expect(target.style.visibility).toBe('hidden');
    advance(3000);

    expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
    expect(target.style.visibility).toBe('');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('fly-out without a target fades away and still finishes', () => {
    const { clock, advance } = fakeFrameClock();
    const onDone = vi.fn();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 0, y: 0, w: 800, h: 400 }, fromRound: 0, target: null, targetRound: 0,
      clock, reducedMotion: () => false, onDone,
    });
    advance(3000);

    expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `yarn test test/unit/tools/image/darkroom/motion.test.ts`
Expected: FAIL, the import can't be resolved.

- [ ] **Step 3: Implement**

```ts
// src/tools/image/darkroom/motion.ts
import type { ImageCrop } from '../../../../types/tools/image';
import { createSpring, SPRING_SOFT, type SpringClock } from '../../../components/utils/spring';
import { rectToCamera, type Box, type Size } from './camera';

export const CHROME_OUT_MS = 120;
export const CHROME_BACK_DELAY_MS = 400;

export interface Dissolve {
  begin(): void;
  end(): void;
  destroy(): void;
}

/** Opacity only: hiding the chrome would drop keyboard focus and break the focus trap. */
export function createDissolve(targets: HTMLElement[], grid: HTMLElement): Dissolve {
  const st = { back: 0 };

  return {
    begin() {
      window.clearTimeout(st.back);
      targets.forEach((el) => { el.style.opacity = '0'; });
      grid.style.opacity = '1';
    },
    end() {
      window.clearTimeout(st.back);
      st.back = window.setTimeout(() => {
        targets.forEach((el) => { el.style.opacity = ''; });
        grid.style.opacity = '';
      }, CHROME_BACK_DELAY_MS);
    },
    destroy() {
      window.clearTimeout(st.back);
    },
  };
}

export interface FlyOutOptions {
  url: string;
  natural: Size;
  rect: ImageCrop;
  from: Box;
  fromRound: number;
  target: HTMLElement | null;
  targetRound: number;
  clock?: SpringClock;
  reducedMotion?: () => boolean;
  onDone?(): void;
}

const isOnScreen = (r: DOMRect): boolean => r.width > 0 && r.height > 0
  && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;

export function flyOut(opts: FlyOutOptions): void {
  const shell = document.createElement('div');

  shell.className = 'blok-darkroom-flight';
  shell.setAttribute('data-role', 'darkroom-flight');
  shell.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');

  img.src = opts.url;
  img.alt = '';
  img.style.width = `${opts.natural.w}px`;
  img.style.height = `${opts.natural.h}px`;
  shell.appendChild(img);
  document.body.appendChild(shell);

  const box = opts.target?.getBoundingClientRect() ?? null;
  const land = box !== null && isOnScreen(box) ? box : null;

  if (opts.target) opts.target.style.visibility = 'hidden';

  const paint = (v: Readonly<Record<'x' | 'y' | 'w' | 'h' | 'round' | 'o', number>>): void => {
    shell.style.transform = `translate(${v.x}px, ${v.y}px)`;
    shell.style.width = `${v.w}px`;
    shell.style.height = `${v.h}px`;
    shell.style.opacity = String(v.o);
    shell.style.setProperty('--blok-radius-darkroom-frame', `${v.round * 50}%`);
    const cam = rectToCamera(opts.rect, opts.natural, { x: 0, y: 0, w: v.w, h: v.h });

    img.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`;
  };

  const spring = createSpring({
    from: { ...opts.from, round: opts.fromRound, o: 1 },
    config: SPRING_SOFT,
    clock: opts.clock,
    reducedMotion: opts.reducedMotion,
    onUpdate: paint,
    onSettle: () => {
      shell.remove();
      if (opts.target) opts.target.style.visibility = '';
      opts.onDone?.();
    },
  });

  paint(spring.values());
  spring.to(land
    ? { x: land.left, y: land.top, w: land.width, h: land.height, round: opts.targetRound }
    : { o: 0 });
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `yarn test test/unit/tools/image/darkroom/motion.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/darkroom/motion.ts test/unit/tools/image/darkroom/motion.test.ts
git add src/tools/image/darkroom/motion.ts test/unit/tools/image/darkroom/motion.test.ts
git commit -m "feat(image): darkroom chrome dissolve and fly-out clone"
```

---

### Task 6: Darkroom shell (DOM, dialog, Done semantics, keyboard, undo)

**Files:**
- Create: `src/tools/image/darkroom/index.ts`
- Test: `test/unit/tools/image/darkroom/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `openModalDialog` (`src/components/utils/modal-dialog.ts`); `rovingRadioGroup`; `renderErrorState`; `tr`; `DATA_ATTR.keyboardOwner`; `FULL_RECT`, `clampRect`, `isFullRect`, `resizeRect`, `applyRatio`, `Handle`.
- Produces:
  - `OpenDarkroomOptions { url; alt?; initial?: ImageCrop; onApply(rect: ImageCrop | null): void; onCancel(): void; i18n?: I18nInstance; sourceEl?: HTMLElement | null; getTargetEl?: () => HTMLElement | null; clock?: SpringClock }`
  - `openDarkroom(opts): () => void` (the teardown is instant and has no fly-out)
  - DOM hooks:
    - `[data-role="darkroom-stage"]`, `[data-role="darkroom-photo"]`, `[data-role="darkroom-frame"]`, `[data-role="darkroom-readout"]`, `[data-role="darkroom-live"]`
    - `[data-darkroom-chrome]` on the bar and the pill
    - `data-peek` on the surface

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/darkroom/index.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDarkroom, type OpenDarkroomOptions } from '../../../../../src/tools/image/darkroom';
import { fakeFrameClock } from '../../../helpers/fake-frame-clock';

// jsdom lacks the Popover API that promoteToTopLayer calls.
const stubPopover = (): void => {
  if (!('popover' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      get(this: HTMLElement) { return this.getAttribute('popover'); },
      set(this: HTMLElement, v: string) { this.setAttribute('popover', v); },
    });
  }
  const proto = HTMLElement.prototype as unknown as { showPopover?: () => void; hidePopover?: () => void };

  if (typeof proto.showPopover !== 'function') {
    proto.showPopover = function showPopover() {};
    proto.hidePopover = function hidePopover() {};
  }
};

const setNatural = (img: HTMLImageElement, w: number, h: number): void => {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => h });
};

const open = (over: Partial<OpenDarkroomOptions> = {}) => {
  const { clock, advance } = fakeFrameClock();
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const close = openDarkroom({ url: 'x.png', onApply, onCancel, clock, ...over });
  const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

  if (!photo) throw new Error('no photo');
  setNatural(photo, 800, 534);
  photo.dispatchEvent(new Event('load'));
  advance(3000);

  return { close, onApply, onCancel, advance };
};

const dialog = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');

  if (!el) throw new Error('no dialog');

  return el;
};

const button = (action: string): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);

  if (!el) throw new Error(`no ${action}`);

  return el;
};

describe('openDarkroom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPopover();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('owns the keyboard so Cmd+Z never reaches the document', () => {
    open();

    expect(dialog().hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(dialog().getAttribute('aria-label')).toBe('Crop image');
  });

  it('a press on the dark surround does not cancel', () => {
    const { onCancel } = open();
    const backdrop = document.querySelector<HTMLElement>('[data-blok-testid="image-crop-backdrop"]');

    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('one Escape cancels exactly once', () => {
    const { onCancel } = open();

    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Done on an untouched full image saves no crop', () => {
    const { onApply } = open();

    button('done').click();

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Done keeps an existing crop, rounded to 3 decimals', () => {
    const { onApply } = open({ initial: { x: 10, y: 10, w: 60, h: 60 } });

    button('done').click();

    expect(onApply).toHaveBeenCalledWith({ x: 10, y: 10, w: 60, h: 60 });
  });

  it('Circle saves the shape and a crop that is square in pixels', () => {
    const { onApply, advance } = open();

    document.querySelector<HTMLButtonElement>('[data-ratio="circle"]')?.click();
    advance(3000);
    button('done').click();

    const saved = onApply.mock.calls[0][0];

    expect(saved.shape).toBe('circle');
    expect((saved.w * 800) / (saved.h * 534)).toBeCloseTo(1, 2);
  });

  it('Enter on the stage applies', () => {
    const { onApply } = open();

    document.querySelector('[data-role="darkroom-stage"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Z undoes a shape change inside the Darkroom', () => {
    const { advance } = open();
    const circle = document.querySelector<HTMLButtonElement>('[data-ratio="circle"]');

    circle?.click();
    advance(3000);
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    advance(3000);

    expect(circle?.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-ratio="free"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the size readout from the natural size', () => {
    open({ initial: { x: 0, y: 0, w: 50, h: 50 } });

    expect(document.querySelector('[data-role="darkroom-readout"]')?.textContent).toBe('400 × 267 px');
  });

  it('a photo that fails to load shows the error state and keeps Cancel', () => {
    const onCancel = vi.fn();

    openDarkroom({ url: 'x.png', onApply: vi.fn(), onCancel, clock: fakeFrameClock().clock });
    document.querySelector('[data-role="darkroom-photo"]')?.dispatchEvent(new Event('error'));

    expect(document.querySelector('[data-role="error-state"]')).not.toBeNull();
    expect(button('done').disabled).toBe(true);
    button('cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('an SVG with no intrinsic size still opens with finite transforms and no readout', () => {
    const { clock, advance } = fakeFrameClock();

    openDarkroom({ url: 'x.svg', onApply: vi.fn(), onCancel: vi.fn(), clock });
    const photo = document.querySelector<HTMLImageElement>('[data-role="darkroom-photo"]');

    photo?.dispatchEvent(new Event('load'));
    advance(3000);

    expect(photo?.style.transform).not.toContain('NaN');
    expect(photo?.style.transform).not.toContain('Infinity');
    expect(document.querySelector<HTMLElement>('[data-role="darkroom-readout"]')?.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `yarn test test/unit/tools/image/darkroom/index.test.ts`
Expected: FAIL, the import can't be resolved.

- [ ] **Step 3: Implement `src/tools/image/darkroom/index.ts`**

```ts
import type { ImageCrop, ImageCropShape } from '../../../../types/tools/image';
import { DATA_ATTR } from '../../../components/constants/data-attributes';
import { openModalDialog } from '../../../components/utils/modal-dialog';
import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';
import { createSpring, type SpringClock } from '../../../components/utils/spring';
import type { I18nInstance } from '../../../components/utils/tools';
import { applyRatio, clampRect, FULL_RECT, isFullRect, resizeRect, type Handle } from '../crop-math';
import { renderErrorState } from '../error-state';
import { tr } from '../i18n';
import {
  cameraToRect, clampCamera, fitFrame, percentRatio, rectAspect, rectToCamera, rectToFrame,
  rubberCamera, zoomAt, type Box, type Camera, type Insets, type Size,
} from './camera';
import { attachGestures } from './gestures';
import { createHistory, type Snapshot } from './history';
import { createDissolve, flyOut } from './motion';

export interface OpenDarkroomOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  onApply(rect: ImageCrop | null): void;
  onCancel(): void;
  i18n?: I18nInstance;
  /** The block's visible image box; the photo flies out of it. */
  sourceEl?: HTMLElement | null;
  /** Read after onApply/onCancel has re-rendered the block; the photo flies into it. */
  getTargetEl?: () => HTMLElement | null;
  clock?: SpringClock;
}

type RatioShape = 'rect' | ImageCropShape;

interface RatioDef { key: string; i18nKey: string; value: number | null; shape: RatioShape }

const RATIOS: RatioDef[] = [
  { key: 'free', i18nKey: 'tools.image.cropRatioFree', value: null, shape: 'rect' },
  { key: '1', i18nKey: 'tools.image.cropRatio1to1', value: 1, shape: 'rect' },
  { key: String(4 / 3), i18nKey: 'tools.image.cropRatio4to3', value: 4 / 3, shape: 'rect' },
  { key: String(16 / 9), i18nKey: 'tools.image.cropRatio16to9', value: 16 / 9, shape: 'rect' },
  { key: 'circle', i18nKey: 'tools.image.cropRatioCircle', value: 1, shape: 'circle' },
  { key: 'ellipse', i18nKey: 'tools.image.cropRatioOval', value: null, shape: 'ellipse' },
];

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS = new Set<Handle>(['nw', 'ne', 'se', 'sw']);
// Room for the top bar and the bottom pill around the frame.
const PAD: Insets = { top: 72, right: 32, bottom: 104, left: 32 };
// Stand-in size for an SVG without intrinsic dimensions.
const FALLBACK_NATURAL = 1000;
const NUDGE = 0.01;
const NUDGE_BIG = 0.1;
const ZOOM_STEP = 1.1;
const KEY_IDLE_MS = 250;

type ViewKey = 's' | 'tx' | 'ty' | 'x' | 'y' | 'w' | 'h' | 'round';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const roundRect = (r: ImageCrop): ImageCrop => ({ x: round3(r.x), y: round3(r.y), w: round3(r.w), h: round3(r.h) });
const ratioByKey = (key: string): RatioDef => RATIOS.find((r) => r.key === key) ?? RATIOS[0];
const roundOf = (shape: RatioShape): number => (shape === 'rect' ? 0 : 1);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, role?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;
  if (role) node.setAttribute('data-role', role);

  return node;
}

export function openDarkroom(opts: OpenDarkroomOptions): () => void {
  const initialDef = RATIOS.find((r) => r.shape === (opts.initial?.shape ?? 'rect') && r.shape !== 'rect') ?? RATIOS[0];
  const st = {
    natural: { w: FALLBACK_NATURAL, h: FALLBACK_NATURAL } as Size,
    measured: false,
    ready: false,
    stage: { w: 0, h: 0 } as Size,
    rect: opts.initial ? clampRect(opts.initial) : { ...FULL_RECT },
    def: initialDef,
    panFrom: { s: 1, tx: 0, ty: 0 } as Camera,
    rectFrom: { ...FULL_RECT } as ImageCrop,
    keyIdle: 0,
  };
  const startRect = { ...st.rect };
  const history = createHistory({ rect: { ...st.rect }, ratioKey: st.def.key });

  const backdrop = el('div', 'blok-darkroom');

  backdrop.setAttribute('data-blok-testid', 'image-crop-backdrop');
  backdrop.setAttribute('role', 'presentation');
  const surface = el('div', 'blok-darkroom__surface');

  surface.tabIndex = -1;
  surface.setAttribute(DATA_ATTR.keyboardOwner, '');

  const bar = el('div', 'blok-darkroom__bar');

  bar.setAttribute('data-darkroom-chrome', '');
  const makeBtn = (action: string, key: string, variant: string): HTMLButtonElement => {
    const b = el('button', `blok-darkroom__btn blok-darkroom__btn--${variant}`);

    b.type = 'button';
    b.setAttribute('data-action', action);
    b.textContent = tr(opts.i18n, key);

    return b;
  };
  const cancelBtn = makeBtn('cancel', 'tools.image.cropCancel', 'ghost');
  const resetBtn = makeBtn('reset', 'tools.image.cropReset', 'ghost');
  const doneBtn = makeBtn('done', 'tools.image.cropDone', 'primary');
  const readout = el('span', 'blok-darkroom__readout', 'darkroom-readout');

  readout.setAttribute('aria-hidden', 'true');
  const lead = el('div', 'blok-darkroom__bar-lead');

  lead.append(cancelBtn, resetBtn);
  bar.append(lead, readout, doneBtn);

  const stage = el('div', 'blok-darkroom__stage', 'darkroom-stage');

  stage.tabIndex = 0;
  stage.setAttribute('role', 'application');
  stage.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropStageLabel'));
  const photo = el('img', 'blok-darkroom__photo', 'darkroom-photo');

  photo.alt = opts.alt ?? '';
  photo.draggable = false;
  const frame = el('div', 'blok-darkroom__frame', 'darkroom-frame');
  const grid = el('div', 'blok-darkroom__grid');

  grid.setAttribute('aria-hidden', 'true');
  frame.appendChild(grid);
  const handleEls = new Map<Handle, HTMLElement>();

  for (const h of HANDLES) {
    const handle = el('span', `blok-darkroom__handle blok-darkroom__handle--${CORNERS.has(h) ? 'corner' : 'edge'} blok-darkroom__handle--${h}`);

    handle.setAttribute('data-handle', h);
    frame.appendChild(handle);
    handleEls.set(h, handle);
  }
  stage.append(photo, frame);

  const pill = el('div', 'blok-darkroom__pill');

  pill.setAttribute('data-darkroom-chrome', '');
  pill.setAttribute('role', 'radiogroup');
  pill.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropAspectRatio'));
  const chips = RATIOS.map((r) => {
    const chip = el('button', 'blok-darkroom__chip');

    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('data-ratio', r.key);
    chip.textContent = tr(opts.i18n, r.i18nKey);
    chip.addEventListener('click', () => { setRatio(r); commit(); });
    pill.appendChild(chip);

    return chip;
  });

  const live = el('div', 'blok-darkroom__live', 'darkroom-live');

  live.setAttribute('aria-live', 'polite');
  surface.append(bar, stage, pill, live);
  backdrop.appendChild(surface);

  const pctRatio = (): number | null => (st.def.value === null ? null : percentRatio(st.def.value, st.natural));
  const frameOf = (v: Readonly<Record<ViewKey, number>>): Box => ({ x: v.x, y: v.y, w: v.w, h: v.h });
  const camOf = (v: Readonly<Record<ViewKey, number>>): Camera => ({ s: v.s, tx: v.tx, ty: v.ty });

  const sizeText = (r: ImageCrop): string =>
    `${Math.round((r.w / 100) * st.natural.w)} × ${Math.round((r.h / 100) * st.natural.h)} px`;

  const paint = (v: Readonly<Record<ViewKey, number>>): void => {
    photo.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
    frame.style.transform = `translate(${v.x}px, ${v.y}px)`;
    frame.style.width = `${v.w}px`;
    frame.style.height = `${v.h}px`;
    frame.style.setProperty('--blok-radius-darkroom-frame', `${v.round * 50}%`);
    readout.textContent = sizeText(cameraToRect(camOf(v), st.natural, frameOf(v)));
  };

  const view = createSpring<ViewKey>({
    from: { s: 1, tx: 0, ty: 0, x: 0, y: 0, w: 0, h: 0, round: roundOf(st.def.shape) },
    clock: opts.clock,
    onUpdate: paint,
  });

  /** Target layout for the current rect: frame fitted and centred, camera showing the rect in it. */
  const fitted = (): Record<ViewKey, number> => {
    const f = fitFrame(rectAspect(st.rect, st.natural), st.stage, PAD);

    return { ...rectToCamera(st.rect, st.natural, f), ...f, round: roundOf(st.def.shape) };
  };

  const syncChips = (): void => {
    chips.forEach((chip, i) => {
      const on = RATIOS[i].key === st.def.key;

      chip.setAttribute('data-active', String(on));
      chip.setAttribute('aria-checked', String(on));
    });
    roving.refresh();
    const freeform = st.def.value === null;

    handleEls.forEach((h, name) => { if (!CORNERS.has(name)) h.hidden = !freeform; });
    frame.setAttribute('data-shape', st.def.shape);
  };

  const announce = (): void => {
    if (st.measured) live.textContent = sizeText(st.rect);
  };

  const commit = (): void => {
    history.push({ rect: { ...st.rect }, ratioKey: st.def.key });
    announce();
  };

  const setRatio = (def: RatioDef): void => {
    st.def = def;
    const r = pctRatio();

    st.rect = r === null ? st.rect : applyRatio(st.rect, r);
    syncChips();
    if (st.ready) view.to(fitted());
  };

  const restore = (s: Snapshot | null): void => {
    if (!s) return;
    st.def = ratioByKey(s.ratioKey);
    st.rect = { ...s.rect };
    syncChips();
    view.to(fitted());
    announce();
  };

  const roving = rovingRadioGroup({
    radios: chips,
    getSelectedIndex: () => RATIOS.findIndex((r) => r.key === st.def.key),
    onSelect: (i) => { setRatio(RATIOS[i]); commit(); },
  });

  syncChips();

  const dissolve = createDissolve([bar, pill], grid);

  const detachGestures = attachGestures(stage, {
    onStart: (kind) => {
      if (!st.ready) return;
      dissolve.begin();
      view.stop();
      st.panFrom = camOf(view.values());
      if (kind === 'handle') st.rectFrom = { ...st.rect };
    },
    onPan: (dx, dy) => {
      if (!st.ready) return;
      const f = frameOf(view.values());

      view.jump(rubberCamera({ ...st.panFrom, tx: st.panFrom.tx + dx, ty: st.panFrom.ty + dy }, st.natural, f));
    },
    onZoom: (factor, center, dx, dy) => {
      if (!st.ready) return;
      const v = view.values();
      const f = frameOf(v);

      view.jump(zoomAt({ s: v.s, tx: v.tx + dx, ty: v.ty + dy }, factor, center, st.natural, f));
    },
    onHandle: (h, dx, dy) => {
      if (!st.ready) return;
      const cam = camOf(view.values());
      const dxPct = (dx / (cam.s * st.natural.w)) * 100;
      const dyPct = (dy / (cam.s * st.natural.h)) * 100;
      const r = pctRatio();
      const next = clampRect(resizeRect(st.rectFrom, h, dxPct, dyPct));

      st.rect = r === null ? next : applyRatio(next, r, h);
      view.jump(rectToFrame(st.rect, st.natural, cam));
    },
    onEnd: (kind) => {
      if (!st.ready) return;
      dissolve.end();
      if (kind !== 'handle') {
        const v = view.values();
        const f = frameOf(v);
        const settled = clampCamera(camOf(v), st.natural, f);

        st.rect = cameraToRect(settled, st.natural, f);
        view.to(settled);
      } else {
        // The frame springs back to centre and the photo scales with it.
        view.to(fitted());
      }
      commit();
    },
    onPeek: (active) => { surface.toggleAttribute('data-peek', active); },
  });

  const layout = (animate: boolean): void => {
    const r = stage.getBoundingClientRect();

    st.stage = { w: r.width, h: r.height };
    if (animate) view.to(fitted()); else view.jump(fitted());
  };

  const flyIn = (): void => {
    const src = opts.sourceEl?.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();

    layout(false);
    if (!src || src.width === 0 || src.height === 0) {
      surface.setAttribute('data-entering', 'fade');

      return;
    }
    const from: Box = { x: src.left - stageBox.left, y: src.top - stageBox.top, w: src.width, h: src.height };

    if (opts.sourceEl) opts.sourceEl.style.visibility = 'hidden';
    view.jump({ ...rectToCamera(st.rect, st.natural, from), ...from });
    view.to(fitted());
  };

  const start = (): void => {
    if (st.ready) return;
    st.measured = photo.naturalWidth > 0 && photo.naturalHeight > 0;
    if (st.measured) {
      st.natural = { w: photo.naturalWidth, h: photo.naturalHeight };
    } else {
      const src = opts.sourceEl?.getBoundingClientRect();
      const aspect = src && src.width > 0 && src.height > 0
        ? (src.width / src.height) * (st.rect.h / st.rect.w)
        : 1;

      st.natural = { w: FALLBACK_NATURAL, h: FALLBACK_NATURAL / aspect };
    }
    readout.hidden = !st.measured;
    photo.style.width = `${st.natural.w}px`;
    photo.style.height = `${st.natural.h}px`;
    st.ready = true;
    flyIn();
    announce();
  };

  const fail = (): void => {
    stage.replaceChildren(renderErrorState({ variant: 'broken', i18n: opts.i18n }));
    doneBtn.disabled = true;
    resetBtn.disabled = true;
  };

  photo.addEventListener('load', start);
  photo.addEventListener('error', fail);
  photo.src = opts.url;
  if (photo.complete && photo.naturalWidth > 0) start();

  const resize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { if (st.ready) layout(false); })
    : null;

  resize?.observe(stage);

  const finish = (): ImageCrop | null => {
    const rect = roundRect(st.rect);

    if (st.def.shape === 'circle' || st.def.shape === 'ellipse') return { ...rect, shape: st.def.shape };

    return isFullRect(rect) ? null : rect;
  };

  const leave = (rect: ImageCrop, round: number, after: () => void): void => {
    const v = view.values();
    const stageBox = stage.getBoundingClientRect();
    const from: Box = { x: v.x + stageBox.left, y: v.y + stageBox.top, w: v.w, h: v.h };
    const source = opts.sourceEl ?? null;

    dialogHandle.close();
    after();
    if (source) source.style.visibility = '';
    if (!st.ready) return;
    requestAnimationFrame(() => {
      const target = opts.getTargetEl?.() ?? null;

      flyOut({
        url: opts.url, natural: st.natural, rect, from, fromRound: v.round,
        target, targetRound: rect.shape && rect.shape !== 'rect' ? 1 : 0,
        clock: opts.clock,
      });
    });
  };

  const apply = (): void => {
    if (doneBtn.disabled) return;
    const result = finish();

    leave(result ?? FULL_RECT, view.values().round, () => opts.onApply(result));
  };

  const cancel = (): void => {
    const f = fitFrame(rectAspect(startRect, st.natural), st.stage, PAD);

    view.jump({ ...rectToCamera(startRect, st.natural, f), ...f });
    leave({ ...startRect }, roundOf(initialDef.shape), () => opts.onCancel());
  };

  doneBtn.addEventListener('click', apply);
  cancelBtn.addEventListener('click', cancel);
  resetBtn.addEventListener('click', () => {
    const r = pctRatio();

    st.rect = r === null ? { ...FULL_RECT } : applyRatio({ ...FULL_RECT }, r);
    view.to(fitted());
    commit();
  });

  const nudge = (e: KeyboardEvent): boolean => {
    const v = view.values();
    const f = frameOf(v);
    const step = (e.shiftKey ? NUDGE_BIG : NUDGE) * f.w;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    const move = moves[e.key];

    if (!move && e.key !== '+' && e.key !== '=' && e.key !== '-') return false;
    const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const cam = camOf(v);
    const next = move
      ? clampCamera({ ...cam, tx: cam.tx + move[0], ty: cam.ty + move[1] }, st.natural, f)
      : zoomAt(cam, e.key === '-' ? 1 / ZOOM_STEP : ZOOM_STEP, centre, st.natural, f);
    view.to(next);
    st.rect = cameraToRect(next, st.natural, f);
    window.clearTimeout(st.keyIdle);
    st.keyIdle = window.setTimeout(commit, KEY_IDLE_MS);

    return true;
  };

  stage.addEventListener('keydown', (e) => {
    if (!st.ready) return;
    if (e.key === '\\' && !e.repeat) { surface.setAttribute('data-peek', ''); e.preventDefault(); return; }
    if (nudge(e)) e.preventDefault();
  });
  stage.addEventListener('keyup', (e) => {
    if (e.key === '\\') surface.removeAttribute('data-peek');
  });

  surface.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      restore(e.shiftKey ? history.redo() : history.undo());

      return;
    }
    // Enter on a button is that button's click.
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      apply();
    }
  });

  const dialogHandle = openModalDialog({
    content: backdrop,
    surface,
    role: 'dialog',
    label: tr(opts.i18n, 'tools.image.cropDialogLabel'),
    initialFocus: () => doneBtn,
    // The whole viewport is the surface: a drag released on the dark surround must not cancel.
    outside: false,
    onDismiss: () => cancel(),
    onClose: () => {
      view.stop();
      dissolve.destroy();
      detachGestures();
      resize?.disconnect();
      roving.destroy();
      window.clearTimeout(st.keyIdle);
      if (opts.sourceEl) opts.sourceEl.style.visibility = '';
    },
  });

  return dialogHandle.close;
}
```

`tools.image.cropStageLabel` doesn't exist until Task 10. `tr()` returns the key itself until then, which is harmless in tests.

- [ ] **Step 4: Run and confirm it passes**

Run: `yarn test test/unit/tools/image/darkroom/index.test.ts`
Expected: PASS (11 tests). If "one Escape cancels exactly once" sees 0 calls, read `src/components/utils/dismissable-layer.ts` to see which element it listens on (document vs the surface), and dispatch the event there. Don't add a second Escape listener.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/tools/image/darkroom/index.ts test/unit/tools/image/darkroom/index.test.ts
git add src/tools/image/darkroom/index.ts test/unit/tools/image/darkroom/index.test.ts
git commit -m "feat(image): darkroom shell with camera, gestures, undo and fly-in/out"
```

---

### Task 7: Darkroom styles

**Files:**
- Create: `src/tools/image/darkroom/darkroom.css`
- Modify: `src/styles/main.css:5-6` (replace the two crop imports with `@import '../tools/image/darkroom/darkroom.css';`)
- Test: `test/unit/tools/image/darkroom/darkroom-css.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/tools/image/darkroom/darkroom-css.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../../../src/tools/image/darkroom/darkroom.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);

  if (at === -1) throw new Error(`missing ${selector}`);

  return css.slice(at, css.indexOf('}', at));
};
const BLUE = /#(?:3b82f6|2563eb|1d4ed8|0a84ff|007aff|4a90e2)|\bblue\b|--blok-(?:link|focus)/i;

describe('darkroom.css', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the selected shape chip is neutral: active tokens, never blue', () => {
    const selected = rule('.blok-darkroom__chip[data-active="true"]');

    expect(selected).toContain('var(--blok-icon-active-bg)');
    expect(selected).not.toMatch(BLUE);
  });

  it('Done is white on black, not blue', () => {
    const done = rule('.blok-darkroom__btn--primary');

    expect(done).not.toMatch(BLUE);
    expect(done).toMatch(/background:\s*#fff/);
  });

  it('the frame radius comes from the morph channel', () => {
    expect(rule('.blok-darkroom__frame')).toMatch(/border-radius:\s*var\(--blok-radius-darkroom-frame\)/);
  });

  it('is imported by main.css instead of the old crop styles', () => {
    const main = readFileSync(resolve(__dirname, '../../../../../src/styles/main.css'), 'utf8');

    expect(main).toContain("@import '../tools/image/darkroom/darkroom.css';");
    expect(main).not.toContain('crop-editor.css');
    expect(main).not.toContain('crop-modal.css');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `yarn test test/unit/tools/image/darkroom/darkroom-css.test.ts`
Expected: FAIL, ENOENT for `darkroom.css`.

- [ ] **Step 3: Write `darkroom.css` and swap the import in `main.css`**

```css
/*
  Always dark, in every theme: a neutral black lets colours read true.
  The double selector outranks the top-layer reset in main.css (0,2,0).
*/
.blok-darkroom,
.blok-darkroom[data-blok-top-layer][popover] {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  margin: 0;
  padding: 0;
  border: 0;
  background: radial-gradient(120% 90% at 50% 40%, #17171b 0%, #070708 70%);
  color: #fff;
  z-index: 9998;
  animation: blok-darkroom-in 200ms ease;
}

@keyframes blok-darkroom-in {
  from { background-color: transparent; opacity: 0; }
  to { opacity: 1; }
}

.blok-darkroom__surface {
  position: absolute;
  inset: 0;
  outline: none;
  font-family: var(--blok-font-family, system-ui, sans-serif);
}

.blok-darkroom__surface[data-entering="fade"] .blok-darkroom__stage {
  animation: blok-darkroom-stage-in 260ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes blok-darkroom-stage-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: none; }
}

.blok-darkroom__bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  transition: opacity 120ms ease;
}

.blok-darkroom__bar-lead {
  display: flex;
  gap: 4px;
}

.blok-darkroom__readout {
  font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.55);
}

.blok-darkroom__btn {
  appearance: none;
  border: 0;
  border-radius: var(--blok-radius-pill);
  padding: 8px 14px;
  font: 500 13px/1 inherit;
  cursor: pointer;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
}

.blok-darkroom__btn--ghost:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
.blok-darkroom__btn:disabled { opacity: 0.4; cursor: default; }

.blok-darkroom__btn--primary {
  background: #fff;
  color: #000;
  font-weight: 600;
}

.blok-darkroom__btn:focus-visible,
.blok-darkroom__chip:focus-visible,
.blok-darkroom__stage:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.9);
  outline-offset: 2px;
}

.blok-darkroom__stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.blok-darkroom__stage:active { cursor: grabbing; }

.blok-darkroom__photo {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  transform-origin: 0 0;
  will-change: transform;
  pointer-events: none;
}

.blok-darkroom__frame {
  --blok-radius-darkroom-frame: 0;
  position: absolute;
  left: 0;
  top: 0;
  border-radius: var(--blok-radius-darkroom-frame);
  box-shadow: 0 0 0 1.5px #fff, 0 0 0 9999px rgba(7, 7, 8, 0.72);
  pointer-events: none;
  transition: box-shadow 200ms ease;
}

.blok-darkroom__surface[data-peek] .blok-darkroom__frame {
  box-shadow: 0 0 0 0 transparent, 0 0 0 9999px rgba(7, 7, 8, 0);
}

.blok-darkroom__grid {
  position: absolute;
  inset: 0;
  border-radius: var(--blok-radius-darkroom-frame);
  opacity: 0;
  transition: opacity 120ms ease;
  background:
    linear-gradient(to right, transparent calc(33.333% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.333% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.666% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px)),
    linear-gradient(to bottom, transparent calc(33.333% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.333% - 0.5px), rgba(255, 255, 255, 0.35) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.666% - 0.5px), rgba(255, 255, 255, 0.35) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px));
}

.blok-darkroom__handle {
  position: absolute;
  width: 28px;
  height: 28px;
  pointer-events: auto;
  touch-action: none;
}

.blok-darkroom__handle--corner::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border: 0 solid #fff;
}

.blok-darkroom__handle--nw { left: -14px; top: -14px; cursor: nwse-resize; }
.blok-darkroom__handle--ne { right: -14px; top: -14px; cursor: nesw-resize; }
.blok-darkroom__handle--se { right: -14px; bottom: -14px; cursor: nwse-resize; }
.blok-darkroom__handle--sw { left: -14px; bottom: -14px; cursor: nesw-resize; }
.blok-darkroom__handle--nw::before { left: 11px; top: 11px; border-left-width: 3px; border-top-width: 3px; }
.blok-darkroom__handle--ne::before { right: 11px; top: 11px; border-right-width: 3px; border-top-width: 3px; }
.blok-darkroom__handle--se::before { right: 11px; bottom: 11px; border-right-width: 3px; border-bottom-width: 3px; }
.blok-darkroom__handle--sw::before { left: 11px; bottom: 11px; border-left-width: 3px; border-bottom-width: 3px; }

.blok-darkroom__handle--edge::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  background: #fff;
  border-radius: var(--blok-radius-pill);
  transform: translate(-50%, -50%);
}

.blok-darkroom__handle--n,
.blok-darkroom__handle--s { left: calc(50% - 14px); cursor: ns-resize; }
.blok-darkroom__handle--e,
.blok-darkroom__handle--w { top: calc(50% - 14px); cursor: ew-resize; }
.blok-darkroom__handle--n { top: -14px; }
.blok-darkroom__handle--s { bottom: -14px; }
.blok-darkroom__handle--e { right: -14px; }
.blok-darkroom__handle--w { left: -14px; }
.blok-darkroom__handle--n::before,
.blok-darkroom__handle--s::before { width: 22px; height: 3px; }
.blok-darkroom__handle--e::before,
.blok-darkroom__handle--w::before { width: 3px; height: 22px; }

.blok-darkroom__pill {
  position: absolute;
  left: 50%;
  bottom: 28px;
  z-index: 2;
  display: flex;
  gap: 2px;
  padding: 4px;
  transform: translateX(-50%);
  border-radius: var(--blok-radius-pill);
  background: rgba(38, 38, 44, 0.62);
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(1.6);
  transition: opacity 120ms ease;
}

.blok-darkroom__chip {
  appearance: none;
  border: 0;
  border-radius: var(--blok-radius-pill);
  padding: 7px 12px;
  font: 500 12px/1 inherit;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
}

.blok-darkroom__chip:hover { color: #fff; }

.blok-darkroom__chip[data-active="true"] {
  background: var(--blok-icon-active-bg);
  color: var(--blok-icon-active-text);
}

.blok-darkroom__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.blok-darkroom-flight {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 9999;
  overflow: hidden;
  border-radius: var(--blok-radius-darkroom-frame);
  pointer-events: none;
}

.blok-darkroom-flight img {
  position: absolute;
  left: 0;
  top: 0;
  max-width: none;
  transform-origin: 0 0;
}

@media (prefers-reduced-motion: reduce) {
  .blok-darkroom,
  .blok-darkroom[data-blok-top-layer][popover],
  .blok-darkroom__surface[data-entering="fade"] .blok-darkroom__stage { animation: none; }
  .blok-darkroom__bar,
  .blok-darkroom__pill,
  .blok-darkroom__grid,
  .blok-darkroom__frame { transition: none; }
}
```

In `src/styles/main.css`, replace lines 5–6:

```css
@import '../tools/image/crop-editor.css';
@import '../tools/image/crop-modal.css';
```

with:

```css
@import '../tools/image/darkroom/darkroom.css';
```

Note: `--blok-icon-active-bg` / `-text` are theme tokens. In light mode they're a light gray fill with dark ink, which reads as a bright pill on the dark glass. Open the page in Task 11 and look at it. If the chip ink disappears in the light theme, scope a dark value locally: `.blok-darkroom { --blok-icon-active-bg: rgba(255,255,255,.14); --blok-icon-active-text: #fff; }`. That's still neutral, and the test still passes.

- [ ] **Step 4: Run the new test, the Radius Law, and the CSS snapshot suite**

Run: `yarn test test/unit/tools/image/darkroom/darkroom-css.test.ts test/unit/architecture/radius-law.test.ts`
Expected: PASS. If the Radius Law file doesn't exist in your worktree yet, note that and move on.

Run: `yarn test test/unit/styles/css-split-equivalence.test.ts`
Expected: FAIL on the snapshot and byte-budget checks, because the rules changed. Read the diff. It must show only crop-editor/crop-modal rules removed and darkroom rules added. Then update the snapshots: `yarn test test/unit/styles/css-split-equivalence.test.ts -u`. If the byte-budget test still fails, the darkroom CSS is larger than the old crop CSS. Add "image darkroom" to that test's budget comment list and raise the budget constant by the measured delta.

- [ ] **Step 5: Lint and commit**

```bash
npx stylelint src/tools/image/darkroom/darkroom.css 2>/dev/null || true
npx eslint test/unit/tools/image/darkroom/darkroom-css.test.ts
git add src/tools/image/darkroom/darkroom.css src/styles/main.css test/unit/tools/image/darkroom/darkroom-css.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt test/unit/styles/__snapshots__/main-css-keyframes.snap.txt test/unit/styles/css-split-equivalence.test.ts
git commit -m "feat(image): darkroom styles, always dark with a neutral selected chip"
```

---

### Task 8: Wire the image tool and delete the old editor

**Files:**
- Modify: `src/tools/image/index.ts:57` (import) and `:817-827` (`enterCrop`)
- Delete: `src/tools/image/crop-editor.ts`, `crop-editor.css`, `crop-modal.ts`, `crop-modal.css`
- Delete: `test/unit/tools/image/crop-editor.test.ts`, `test/unit/tools/image/crop-editor.mutants.test.ts`, `test/unit/tools/image-crop-editor.test.ts`, `test/unit/tools/image-crop-modal.test.ts`
- Modify (references to the deleted files), each listed in the steps below:
  - `test/unit/tools/image/index.mutants.test.ts`
  - `test/unit/tools/image/index.test.ts`
  - `test/unit/tools/image-crop.test.ts`
  - `test/unit/tools/image-lightbox.test.ts`
  - `test/unit/styles/focus-within-modality-law.test.ts`
  - `test/unit/architecture/floating-positioning-law.test.ts`
  - `test/unit/architecture/url-sink-law.test.ts`
  - `test/unit/components/i18n/untranslated-strings.test.ts`

**Interfaces:**
- Consumes: `openDarkroom`, `OpenDarkroomOptions` (Task 6).

- [ ] **Step 1: Write the failing test** in `test/unit/tools/image/index.mutants.test.ts`

Change the mock at line 31 and the import at line 46 to the darkroom:

```ts
vi.mock('../../../../src/tools/image/darkroom', () => ({ openDarkroom: vi.fn() }));
// …
import { openDarkroom } from '../../../../src/tools/image/darkroom';
// …
const mockCropModal = vi.mocked(openDarkroom);
// line 1514:
type CropModalOptions = Parameters<typeof openDarkroom>[0];
```

Add these tests inside `describe('ImageTool — cropping', …)`, which already has `openCrop(tool)` and `cropModalOptions()`:

```ts
  it('flies out of the crop box the reader sees', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png', crop: { x: 5, y: 5, w: 40, h: 40 } }));
    const root = tool.render();

    openCrop(tool);

    expect(cropModalOptions().sourceEl).toBe(root.querySelector('[data-role="image-crop"]'));
  });

  it('flies back into the re-rendered image after Done', () => {
    const tool = new ImageTool(createOptions({ url: 'https://x/y.png' }));
    const root = tool.render();

    openCrop(tool);
    const opts = cropModalOptions();

    opts.onApply({ x: 10, y: 10, w: 50, h: 50 });

    expect(opts.getTargetEl?.()).toBe(root.querySelector('[data-role="image-crop"]'));
  });
```

- [ ] **Step 2: Run and confirm it fails**

Run: `yarn test test/unit/tools/image/index.mutants.test.ts -t "flies"`
Expected: FAIL. `sourceEl` is undefined and `getTargetEl` is missing, because `enterCrop` still calls the old modal.

- [ ] **Step 3: Change `enterCrop`**

```ts
// src/tools/image/index.ts — import (replaces the crop-modal import)
import { openDarkroom } from './darkroom';

// enterCrop
  private enterCrop(): void {
    if (this.cropDetach) return;
    this.closeAlignmentPopover();
    this.cropDetach = openDarkroom({
      url: this.data.url,
      alt: this.data.alt,
      initial: this.data.crop,
      onApply: (rect) => this.applyCrop(rect),
      onCancel: () => this.cancelCrop(),
      i18n: this.api.i18n,
      sourceEl: this.cropVisual(),
      getTargetEl: () => this.cropVisual(),
    });
  }

  /** The box the reader sees: the crop wrapper when cropped, else the image. */
  private cropVisual(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>('[data-role="image-crop"]')
      ?? this.root?.querySelector<HTMLElement>('[data-role="image-figure"] img')
      ?? null;
  }
```

- [ ] **Step 4: Delete the old files, then fix every reference**

```bash
git rm src/tools/image/crop-editor.ts src/tools/image/crop-editor.css src/tools/image/crop-modal.ts src/tools/image/crop-modal.css \
  test/unit/tools/image/crop-editor.test.ts test/unit/tools/image/crop-editor.mutants.test.ts \
  test/unit/tools/image-crop-editor.test.ts test/unit/tools/image-crop-modal.test.ts
grep -rn "crop-editor\|crop-modal\|openCropModal\|mountCropEditor\|blok-image-crop-editor\|blok-image-crop-modal" src test
```

Fix each hit:
- `test/unit/tools/image-crop.test.ts:149,154,203`: `.blok-image-crop-editor` → `.blok-darkroom`; `.blok-image-crop-modal-dialog` → `[role="dialog"]`.
- `test/unit/tools/image/index.test.ts:548`: the selector already accepts `[role="dialog"][aria-label="Crop image"]`. Leave it.
- `test/unit/tools/image-lightbox.test.ts:197-198`: delete the two `readFileSync` lines. Then delete or retarget any `it` in that `describe` that reads `cropModalCss` / `cropEditorCss`, pointing it at `src/tools/image/darkroom/darkroom.css`. The darkroom pill uses `backdrop-filter` on purpose, so drop any "crop has no backdrop-filter" assertion and note why in the commit body.
- `test/unit/styles/focus-within-modality-law.test.ts:190`: replace the selector with `.blok-darkroom__frame:focus-within`.
- `test/unit/architecture/floating-positioning-law.test.ts:134`: replace the entry with
  - `'tools/image/darkroom/index.ts': 'Frame and photo are placed in stage-local px from the measured stage; the fly-in reads the source box once.'`
  - `'tools/image/darkroom/motion.ts': 'Fixed fly-out clone springs once from the frame to the measured block box, then is removed.'`
- `test/unit/architecture/url-sink-law.test.ts:56`: replace the entry with
  - `'tools/image/darkroom/index.ts » opts.url': 'HTMLImageElement src (darkroom photo) — <img> is not a script-execution sink'`
  - `'tools/image/darkroom/motion.ts » opts.url': 'HTMLImageElement src (fly-out clone) — <img> is not a script-execution sink'`
- `test/unit/components/i18n/untranslated-strings.test.ts:593`: change the file to `src/tools/image/darkroom/index.ts`, keeping the needle `'Crop image'`.

- [ ] **Step 5: Run the affected suites**

Run each one separately. Several paths in one vitest call can skip files.

```bash
yarn test test/unit/tools/image/index.mutants.test.ts
yarn test test/unit/tools/image/index.test.ts
yarn test test/unit/tools/image-crop.test.ts
yarn test test/unit/tools/image-lightbox.test.ts
yarn test test/unit/styles/focus-within-modality-law.test.ts
yarn test test/unit/architecture/floating-positioning-law.test.ts
yarn test test/unit/architecture/url-sink-law.test.ts
yarn test test/unit/components/i18n/untranslated-strings.test.ts
```

Expected: all PASS. The positioning and URL-sink laws may report the exact key format they want. If so, match it.

- [ ] **Step 6: Lint, typecheck the touched files, and commit**

```bash
npx eslint src/tools/image/index.ts test/unit/tools/image/index.mutants.test.ts test/unit/tools/image-crop.test.ts test/unit/tools/image-lightbox.test.ts test/unit/styles/focus-within-modality-law.test.ts test/unit/architecture/floating-positioning-law.test.ts test/unit/architecture/url-sink-law.test.ts test/unit/components/i18n/untranslated-strings.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
git add -u src/tools/image test/unit
git add src/tools/image/index.ts
git commit -m "feat(image): open the darkroom from the image block; retire the crop modal"
```

(`git add -u` stages the deletions and edits under those two paths only. Check `git status` first so no peer's files come along.)

---

### Task 9: Check the existing undo-audit e2e still passes

**Files:**
- Verify: `test/playwright/tests/undo-audit/w4-tools.spec.ts:268` (W4T-8 drives `[data-ratio="circle"]`, `[data-action="done"]` and `image-crop-backdrop`, which the Darkroom keeps).

- [ ] **Step 1: Run it**

Run: `yarn e2e test/playwright/tests/undo-audit/w4-tools.spec.ts -g "W4T-8"`
Expected: PASS. If it fails because the backdrop outlives the dialog, the fly-out clone is being mistaken for the backdrop. The clone must never carry `image-crop-backdrop`. Fix it in `motion.ts`, not in the spec.

- [ ] **Step 2: Commit only if something changed.**

---

### Task 10: i18n key `tools.image.cropStageLabel`

**Files:**
- Modify: `src/components/i18n/locales/en.json` (after `tools.image.cropDialogLabel`) and all other flat locale files `src/components/i18n/locales/<code>.json`
- Modify: `types/message-keys.d.ts` (regenerate)
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md` (digests)
- Modify: `test/unit/components/i18n/lifecycle-coverage.test.ts` (key counts)

English value: `"tools.image.cropStageLabel": "Photo. Drag to move, pinch or scroll to zoom, hold to see the original"`

- [ ] **Step 1:** Load the `blok-translations` skill, and read the memory note `i18n-new-key-checklist.md`. It has 7 layers.
- [ ] **Step 2: Failing check.** Add the key to `en.json` only. Run `yarn test test/unit/components/i18n/`. Expected: completeness and lifecycle failures that name the new key.
- [ ] **Step 3:** Draft translations for every locale into a scratch JSON (one subagent per locale group). Insert them with one script at the same position as `en`. Regenerate the types with `node scripts/generate-message-keys-dts.mjs`. Rewrite the ledger digests. Bump the lifecycle counts.
- [ ] **Step 4:** Run `yarn test test/unit/components/i18n/` and `yarn i18n:check`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/i18n/locales types/message-keys.d.ts docs/plans/2026-07-19-all-locales-translation-audit-ledger.md test/unit/components/i18n
git commit -m "feat(i18n): darkroom stage label in every locale"
```

---

### Task 11: E2E

**Files:**
- Rewrite: `test/playwright/tests/tools/image-crop.spec.ts`

Keep the file's header, `saveBlok` and `seedImage` helpers exactly as they are today (lines 1–48). `SAMPLE_IMAGE_URL` is 600×400. Replace the four tests with:

```ts
const openDarkroom = async (page: Page, crop?: { x: number; y: number; w: number; h: number }) => {
  await seedImage(page, crop);
  const image = page.locator(IMAGE_BLOCK_SELECTOR);

  await image.hover();
  await image.locator('[data-action="crop"]').click();
  const dialog = page.getByRole('dialog', { name: 'Crop image' });

  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-role="darkroom-readout"]')).toHaveText(/× \d+ px/);
  // Wait until the fly-in has settled.
  await expect(page.locator('[data-role="darkroom-flight"]')).toHaveCount(0);

  return { dialog, stage: page.locator('[data-role="darkroom-stage"]') };
};

const cropOf = async (page: Page) =>
  (await saveBlok(page)).blocks[0].data as { crop?: { x: number; y: number; w: number; h: number; shape?: string } };

test('Done on an untouched image saves no crop', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await dialog.locator('[data-action="done"]').click();
  await expect(dialog).toHaveCount(0);
  expect((await cropOf(page)).crop).toBeUndefined();
});

test('Reset clears an existing crop', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await dialog.locator('[data-action="reset"]').click();
  await dialog.locator('[data-action="done"]').click();
  expect((await cropOf(page)).crop).toBeUndefined();
});

test('Cancel keeps the existing crop', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await dialog.locator('[data-action="cancel"]').click();
  expect((await cropOf(page)).crop).toStrictEqual({ x: 10, y: 10, w: 60, h: 60 });
});

test('a press on the dark surround does not cancel', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await page.mouse.click(8, 400);
  await expect(dialog).toBeVisible();
});

test('one Escape cancels', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await cropOf(page)).crop).toBeUndefined();
});

test('wheel zoom narrows the crop', async ({ page }) => {
  const { dialog, stage } = await openDarkroom(page);
  const box = await stage.boundingBox();

  expect(box).not.toBeNull();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(400);
  await dialog.locator('[data-action="done"]').click();
  const { crop } = await cropOf(page);

  expect(crop?.w ?? 100).toBeLessThan(100);
});

test('dragging the zoomed photo moves the crop', async ({ page }) => {
  const { dialog, stage } = await openDarkroom(page, { x: 25, y: 25, w: 50, h: 50 });
  const box = await stage.boundingBox();
  const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await dialog.locator('[data-action="done"]').click();
  const { crop } = await cropOf(page);

  expect(crop?.x ?? 25).toBeGreaterThan(25);
});

test('releasing a handle springs the frame back to the centre', async ({ page }) => {
  const { stage } = await openDarkroom(page);
  const handle = page.locator('[data-handle="se"]');
  const hb = await handle.boundingBox();
  const sb = await stage.boundingBox();

  await page.mouse.move((hb?.x ?? 0) + 14, (hb?.y ?? 0) + 14);
  await page.mouse.down();
  await page.mouse.move((hb?.x ?? 0) - 120, (hb?.y ?? 0) - 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const f = await page.locator('[data-role="darkroom-frame"]').boundingBox();

    return Math.abs(((f?.x ?? 0) + (f?.width ?? 0) / 2) - ((sb?.x ?? 0) + (sb?.width ?? 0) / 2));
  }).toBeLessThan(2);
});

test('Circle saves a crop that is square in pixels', async ({ page }) => {
  const { dialog } = await openDarkroom(page);

  await page.locator('[data-ratio="circle"]').click();
  await dialog.locator('[data-action="done"]').click();
  const { crop } = await cropOf(page);

  expect(crop?.shape).toBe('circle');
  expect(((crop?.w ?? 0) * 600) / ((crop?.h ?? 1) * 400)).toBeCloseTo(1, 1);
});

test('Cmd+Z inside the darkroom undoes the crop edit, not the document', async ({ page }) => {
  const { dialog } = await openDarkroom(page);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  await page.locator('[data-ratio="1"]').click();
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('[data-ratio="free"]')).toHaveAttribute('aria-checked', 'true');
  await expect(dialog).toBeVisible();
  await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveCount(1);
});

test('the photo flies back into the block after Done', async ({ page }) => {
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await dialog.locator('[data-action="done"]').click();
  await expect(page.locator('[data-role="darkroom-flight"]')).toHaveCount(1);
  await expect(page.locator('[data-role="darkroom-flight"]')).toHaveCount(0);
  await expect(page.locator(`${IMAGE_BLOCK_SELECTOR} [data-role="image-crop"]`)).toBeVisible();
});

test('reduced motion applies with no flight', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { dialog } = await openDarkroom(page, { x: 10, y: 10, w: 60, h: 60 });

  await dialog.locator('[data-action="done"]').click();
  await expect(page.locator('[data-role="darkroom-flight"]')).toHaveCount(0);
  expect((await cropOf(page)).crop).toStrictEqual({ x: 10, y: 10, w: 60, h: 60 });
});
```

- [ ] **Step 1: Write the spec above.** Run: `yarn e2e test/playwright/tests/tools/image-crop.spec.ts`. The new behaviours were built in Tasks 6–8, so failures now point at real defects. Read each failure before changing either side. The test encodes the spec; change the code, not the assertion, unless the test itself is wrong about the DOM.
- [ ] **Step 2: Look at it.** Use the `verify` skill (playwright-cli against a served build) to screenshot the Darkroom mid-flight, at rest and mid-drag, in both the light and dark host themes. Check the chip readability note from Task 7.
- [ ] **Step 3: Commit**

```bash
npx eslint test/playwright/tests/tools/image-crop.spec.ts
git add test/playwright/tests/tools/image-crop.spec.ts
git commit -m "test(image): e2e for the darkroom crop editor"
```

---

### Task 12: Final gates and push

- [ ] **Step 1:** Grep for leftovers: `grep -rn "openCropModal\|crop-editor\|crop-modal" src test docs/superpowers/specs`. Expected: no hits in `src` or `test`.
- [ ] **Step 2: Related tests only** (per the user rule). Run everything under `test/unit/tools/image/`, `test/unit/components/utils/spring.test.ts`, `test/unit/architecture/`, `test/unit/styles/` and `test/unit/components/i18n/`, one directory per command. Then run both e2e files: `image-crop.spec.ts` and `undo-audit/w4-tools.spec.ts`.
- [ ] **Step 3:** `yarn lint` scoped to the changed files (`git diff --name-only origin/main -- '*.ts'`), plus the 8 GB `tsc`.
- [ ] **Step 4:** `git pull --rebase`, then `git push`, then `git status` must show "up to date with origin".
- [ ] **Step 5:** Tell the user:
  - there's no BREAKING change;
  - the dark surround no longer cancels (Escape and Cancel do);
  - 1:1 and Circle are now truly square on non-square photos, which the old editor got wrong.
