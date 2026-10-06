# Find bar Bloom + Word hop — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The find bar blooms out of its corner on two springs, and Cmd/Ctrl+F on a selected word flies that word into the find field.

**Architecture:** The bar's paint (background, shadow) moves to a `::before` "skin" on the dock. A new pure-ish module `find-motion.ts` samples two springs into WAAPI keyframes. Those keyframes grow the skin (`pseudoElement: '::before'`) and clip the bar's content (`clip-path: inset()`) from a 40px dot. The layout box never animates. The hop is a temporary `aria-hidden` chip in the dock that flies on an arc to the input.

**Tech Stack:** TypeScript, Web Animations API, CSS `linear()` easing, Vitest (jsdom), Playwright.

**Spec:** `docs/plans/2026-10-05-find-bar-bloom-hop-design.md`. Read it first. The GIFs the user approved are in https://claude.ai/code/artifact/a8c9340a-5bc1-4fdf-acce-deb91fa7aec9.

## Global Constraints

- Work in a worktree: `git worktree add ~/Packages/.blok-undo/wt/find-bloom origin/main -b find-bloom`, then symlink `node_modules`. The main checkout holds other sessions' uncommitted edits (`embed.css`, `image.css`, `css-split-equivalence.test.ts`…), so never commit from there.
- **Paint only.** The dock and bar layout boxes are at their final size and spot on the first frame. Never animate `width`, `height`, `top` or `left` of the bar or the dock. Only the `::before` skin may have them animated.
- **No editor DOM writes.** The hop never touches editor DOM, so there is no Yjs write and no undo step. The word on the page does not dim.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, run no WAAPI animation and create no chip.
- **`aria-live`:** the counter's text updates at once. Only its paint may be delayed.
- **Close:** keeps today's fade inside the 120ms discrete `display`/`overlay` window (`--blok-duration-base`).
- **Highlights:** leave the match highlights and the 1.5px lens ring untouched.
- **Code style:**
  - Comments are short and say only what breaks if changed.
  - No `any`, no `!`, no `@ts-ignore`.
  - Unit tests call `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`.
- **E2E locators:** use roles or `data-blok-testid`, never CSS classes.
- **Tests:** run only the test files this plan names, plus the referencing gates in Task 5. Never run the full `yarn test` or the full e2e suite (USER RULE).
- **Not BREAKING:** no public type, config key, exported symbol or saved data changes. `data-blok-find-hop-chip` and `data-blok-find-hopping` are internal attributes. Do not add them to `DATA_ATTR`.

## Review Focus

1. **Reopen during the exit fade.** If Cmd/Ctrl+F is pressed within 120ms of closing, the bar must bloom cleanly. No half-faded dock, no stacked animations. Task 3 cancels running motion on open and on close, and pins it in a test.
2. **Typing during the flight.** The chip must vanish and the typed text must be visible at once. Task 4 pins it with a test.
3. **A selection scrolled off screen**, or a range with no client rects (e.g. a collapsed `<br>` line). There is no hop, the bar just blooms, and nothing throws. Task 4 tests `hopSourceFromRange` returning `null`.
4. **RTL and bottom placements.** The bloom grows from the right corner. The hop lands at the input's start edge (its right edge in RTL). Task 1 unit-tests every corner, and Task 5's e2e covers bottom-start and RTL.
5. **The replace row opened by Cmd+Alt+F / Ctrl+H on a closed bar.** One bloom covers both rows, with no second stretch on top. Task 3 tests it.

---

### Task 1: Spring math and grow keyframes

**Files:**
- Create: `src/components/modules/find/find-motion.ts`
- Test: `test/unit/components/modules/find/find-motion.test.ts`

**Interfaces:**
- Produces:
  - `interface Spring { stiffness: number; damping: number }`
  - `SPRINGS: { wide; tall; soft; bouncy }`
  - `springAt(spring: Spring, seconds: number): number`
  - `settleMs(spring: Spring): number`
  - `springEasing(spring: Spring): { easing: string; duration: number }`
  - `interface Size { width: number; height: number }`
  - `interface Corner { block: 'top' | 'bottom'; inline: 'left' | 'center' | 'right' }`
  - `cornerOf(placement: string, rtl: boolean): Corner`
  - `interface GrowFrames { skin: Keyframe[]; clip: Keyframe[]; duration: number }`
  - `growFrames(full: Size, from: Size, corner: Corner, options: { springs: { width: Spring; height: Spring }; radius: { from: number; to: number }; pinch?: number; steps?: number }): GrowFrames`
  - `DOT = 40`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  cornerOf,
  growFrames,
  settleMs,
  springAt,
  springEasing,
  SPRINGS,
} from '../../../../../src/components/modules/find/find-motion';

const insetOf = (frame: Keyframe): number[] => {
  const match = String(frame.clipPath).match(/^inset\((\S+)px (\S+)px (\S+)px (\S+)px round (\S+)px\)$/);

  if (match === null) {
    throw new Error(`not an inset: ${String(frame.clipPath)}`);
  }

  return match.slice(1).map(Number);
};

describe('find-motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('springs', () => {
    it('start at rest, overshoot when underdamped, and settle at 1', () => {
      const spring = SPRINGS.bouncy;
      const samples = Array.from({ length: 200 }, (_, i) => springAt(spring, (settleMs(spring) / 1000) * (i / 199)));

      expect(springAt(spring, 0)).toBe(0);
      expect(Math.max(...samples)).toBeGreaterThan(1.02);
      expect(Math.abs(1 - samples[samples.length - 1])).toBeLessThan(0.002);
    });

    it('never overshoot when critically damped or more', () => {
      const spring = { stiffness: 100, damping: 40 };
      const samples = Array.from({ length: 100 }, (_, i) => springAt(spring, i / 50));

      expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    });

    it('turn into a CSS linear() easing that ends exactly at 1', () => {
      const { easing, duration } = springEasing(SPRINGS.soft);

      expect(easing.startsWith('linear(0,')).toBe(true);
      expect(easing.endsWith(', 1)')).toBe(true);
      expect(duration).toBe(settleMs(SPRINGS.soft));
      expect(duration).toBeGreaterThan(300);
      expect(duration).toBeLessThan(1500);
    });
  });

  describe('cornerOf', () => {
    it.each([
      ['top-end', false, { block: 'top', inline: 'right' }],
      ['top-end', true, { block: 'top', inline: 'left' }],
      ['top-start', false, { block: 'top', inline: 'left' }],
      ['top-start', true, { block: 'top', inline: 'right' }],
      ['bottom-start', false, { block: 'bottom', inline: 'left' }],
      ['bottom-end', true, { block: 'bottom', inline: 'left' }],
      ['top-center', false, { block: 'top', inline: 'center' }],
      ['bottom-center', true, { block: 'bottom', inline: 'center' }],
    ] as const)('%s (rtl %s) grows from %o', (placement, rtl, corner) => {
      expect(cornerOf(placement, rtl)).toEqual(corner);
    });
  });

  describe('growFrames', () => {
    const full = { width: 470, height: 44 };
    const dot = { width: 40, height: 40 };
    const options = { springs: { width: SPRINGS.wide, height: SPRINGS.tall }, radius: { from: 20, to: 14 } };

    it('starts as the dot in the top-right corner and ends as the full box', () => {
      const { skin, clip } = growFrames(full, dot, { block: 'top', inline: 'right' }, options);

      expect(skin[0]).toMatchObject({ left: '430px', top: '0px', width: '40px', height: '40px', borderRadius: '20px' });
      expect(insetOf(clip[0])).toEqual([0, 0, 4, 430, 20]);
      expect(skin[skin.length - 1]).toMatchObject({ left: '0px', top: '0px', width: '470px', height: '44px', borderRadius: '14px' });
      expect(insetOf(clip[clip.length - 1])).toEqual([0, 0, 0, 0, 14]);
    });

    it('anchors the dot at the bottom-left for a bottom-start bar', () => {
      const { skin, clip } = growFrames(full, dot, { block: 'bottom', inline: 'left' }, options);

      expect(skin[0]).toMatchObject({ left: '0px', top: '4px' });
      expect(insetOf(clip[0])).toEqual([4, 430, 0, 0, 20]);
    });

    it('centres the dot for a centred bar', () => {
      const { skin } = growFrames(full, dot, { block: 'top', inline: 'center' }, options);

      expect(skin[0]).toMatchObject({ left: '215px' });
    });

    it('overshoots the full width on the way, the skin and clip in step', () => {
      const { skin, clip } = growFrames(full, dot, { block: 'top', inline: 'right' }, options);
      const widest = Math.max(...skin.map((frame) => parseFloat(String(frame.width))));
      const widestIndex = skin.findIndex((frame) => parseFloat(String(frame.width)) === widest);

      expect(widest).toBeGreaterThan(full.width);
      // A wider skin than the box means a negative left inset on the clip.
      expect(insetOf(clip[widestIndex])[3]).toBeLessThan(0);
    });

    it('pinches the width in early when asked, and ends at full width', () => {
      const from = { width: 470, height: 44 };
      const to = { width: 470, height: 84 };
      const { skin } = growFrames(to, from, { block: 'top', inline: 'right' }, { ...options, pinch: 14 });
      const narrowest = Math.min(...skin.map((frame) => parseFloat(String(frame.width))));

      expect(narrowest).toBeLessThan(470 - 10);
      expect(skin[skin.length - 1]).toMatchObject({ width: '470px', height: '84px' });
    });
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `yarn test test/unit/components/modules/find/find-motion.test.ts`
Expected: FAIL. The module `find-motion` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
/**
 * Spring motion for the find bar. Paint only: the bar's layout box never
 * moves, so the host's placement stays exact from the first frame.
 */

export interface Spring {
  stiffness: number;
  damping: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Corner {
  block: 'top' | 'bottom';
  inline: 'left' | 'center' | 'right';
}

export interface GrowFrames {
  skin: Keyframe[];
  clip: Keyframe[];
  duration: number;
}

/** Tuned against the GIFs the user approved; see the design doc. */
export const SPRINGS = {
  wide: { stiffness: 200, damping: 17 },
  tall: { stiffness: 320, damping: 19 },
  soft: { stiffness: 260, damping: 20 },
  bouncy: { stiffness: 380, damping: 16 },
} as const satisfies Record<string, Spring>;

/** The dot the bar blooms from, in px. */
export const DOT = 40;

const SETTLE = 0.001;
const MAX_SECONDS = 4;
const STEP_SECONDS = 0.01;

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/** Progress of a unit-mass spring let go at 0 toward 1, `seconds` in. */
export const springAt = ({ stiffness, damping }: Spring, seconds: number): number => {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);

  if (zeta >= 1) {
    return 1 - Math.exp(-w0 * seconds) * (1 + w0 * seconds);
  }

  const wd = w0 * Math.sqrt(1 - zeta * zeta);

  return 1 - Math.exp(-zeta * w0 * seconds) * (Math.cos(wd * seconds) + ((zeta * w0) / wd) * Math.sin(wd * seconds));
};

/** Milliseconds until the spring stays within 0.1% of rest. */
export const settleMs = (spring: Spring): number => {
  let seconds = 0;

  while (seconds < MAX_SECONDS && !(Math.abs(1 - springAt(spring, seconds)) < SETTLE && Math.abs(1 - springAt(spring, seconds + 0.05)) < SETTLE)) {
    seconds += STEP_SECONDS;
  }

  return Math.round(seconds * 1000);
};

/** A CSS linear() easing that traces the spring, ending exactly at 1. */
export const springEasing = (spring: Spring): { easing: string; duration: number } => {
  const duration = settleMs(spring);
  const samples = 40;
  const points = Array.from({ length: samples + 1 }, (_, i) =>
    i === samples ? 1 : Math.round(springAt(spring, (duration / 1000) * (i / samples)) * 10000) / 10000);

  return { easing: `linear(${points.join(', ')})`, duration };
};

/** The corner the bar grows from: its anchored corner, mirrored in RTL. */
export const cornerOf = (placement: string, rtl: boolean): Corner => {
  const block = placement.startsWith('bottom') ? 'bottom' : 'top';

  if (placement.endsWith('center')) {
    return { block, inline: 'center' };
  }

  return { block, inline: placement.endsWith('end') !== rtl ? 'right' : 'left' };
};

/**
 * Keyframes that grow a box from `from` to `full`, width and height on their
 * own springs. clip-path is one property and cannot take two easings, so both
 * springs are sampled into linear keyframes; play them with `easing: 'linear'`.
 */
export const growFrames = (
  full: Size,
  from: Size,
  corner: Corner,
  options: { springs: { width: Spring; height: Spring }; radius: { from: number; to: number }; pinch?: number; steps?: number }
): GrowFrames => {
  const { springs, radius, pinch = 0, steps = 30 } = options;
  const duration = Math.max(settleMs(springs.width), settleMs(springs.height));
  const skin: Keyframe[] = [];
  const clip: Keyframe[] = [];

  for (let i = 0; i <= steps; i++) {
    const last = i === steps;
    const seconds = (duration / 1000) * (i / steps);
    const pw = last ? 1 : springAt(springs.width, seconds);
    const ph = last ? 1 : springAt(springs.height, seconds);
    // A quick inward squeeze that peaks at 18% and is gone by 36%.
    const squeeze = last ? 0 : pinch * Math.max(0, Math.sin(Math.PI * Math.min(1, i / steps / 0.36)));
    const width = from.width + (full.width - from.width) * pw - squeeze;
    const height = from.height + (full.height - from.height) * ph;
    const left = corner.inline === 'left' ? 0 : corner.inline === 'right' ? full.width - width : (full.width - width) / 2;
    const top = corner.block === 'top' ? 0 : full.height - height;
    const round = radius.from + (radius.to - radius.from) * Math.min(1, ph);

    skin.push({ left: px(left), top: px(top), width: px(width), height: px(height), borderRadius: px(round) });
    clip.push({ clipPath: `inset(${px(top)} ${px(full.width - left - width)} ${px(full.height - top - height)} ${px(left)} round ${px(round)})` });
  }

  return { skin, clip, duration };
};
```

Note: `px()` rounds to 0.01px, so the test's `insetOf` reads exact numbers at the first and last frames. `-0` prints as `0px`, because `` `${-0}` `` is `"0"`.

- [ ] **Step 4: Run the test and see it pass**

Run: `yarn test test/unit/components/modules/find/find-motion.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/find/find-motion.ts test/unit/components/modules/find/find-motion.test.ts
git add src/components/modules/find/find-motion.ts test/unit/components/modules/find/find-motion.test.ts
git commit -m "feat(find): spring keyframes for growing the find bar from a dot"
```

---

### Task 2: Move the bar's paint to a skin layer on the dock

**Files:**
- Modify: `src/styles/find.css`. These are the `[data-blok-find]` block (lines 40-53), the `[data-blok-find-bar]` block (82-107), the transform-origin rules (109-121), the `[hidden]` and `@starting-style` bar rules (123-136), the replace row rules (349-373), and the reduced-motion block (475-496).
- Modify: `test/unit/styles/overlay-radius-roles.test.ts`, inside `describe('find')`.
- Regenerate: `test/unit/styles/__snapshots__/main-css-rules.snap.txt`, if its test fails.

**Interfaces:**
- Produces, for Task 3:
  - CSS paints the bar's background and shadow from `[data-blok-find]::before`, which sits at rest at `inset: 0` of the dock.
  - The dock is `position: fixed`, so it is the containing block for the skin and for the hop chip.
  - The replace row SNAPS open: no transition when it is shown, only when it hides.

- [ ] **Step 1: Write the failing test**

Add to `describe('find')` in `test/unit/styles/overlay-radius-roles.test.ts`. It uses that file's existing `read`, `radius` and `prop` helpers.

```ts
  it('paints the bar from a skin on the dock, so the bloom can grow it without moving layout', () => {
    const skin = '[data-blok-find]::before';

    expect(radius(css, skin)).toBe('var(--blok-radius-surface)');
    expect(prop(css, skin, 'background')).toBe('var(--blok-popover-bg)');
    expect(prop(css, skin, 'box-shadow')).toBe('var(--blok-popover-box-shadow)');
    expect(prop(css, bar, 'background')).toBeUndefined();
    expect(prop(css, bar, 'box-shadow')).toBeUndefined();
  });
```

Before running it, check how `prop` reports a missing declaration (read its definition near the top of the file). If it returns `null` or `''` rather than `undefined`, match that.

- [ ] **Step 2: Run the test and see it fail**

Run: `yarn test test/unit/styles/overlay-radius-roles.test.ts`
Expected: FAIL on the new test, because `[data-blok-find]::before` has no rule.

- [ ] **Step 3: Implement the CSS**

1. In the `[data-blok-find], [data-blok-find][data-blok-top-layer][popover]` block, replace the `transition` with:

```css
  transform-origin: top right;
  transition:
    opacity var(--blok-duration-base) var(--blok-ease-exit),
    transform var(--blok-duration-base) var(--blok-ease-exit),
    display var(--blok-duration-base) allow-discrete,
    overlay var(--blok-duration-base) allow-discrete;
```

2. Add right after that block:

```css
/*
  The bar's paint. find-motion.ts grows this layer from a dot while the bar's
  layout box stays put, so the host's placement holds on every frame.
*/
[data-blok-find]::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--blok-radius-surface);
  background: var(--blok-popover-bg);
  box-shadow: var(--blok-popover-box-shadow);
  pointer-events: none;
}

/* Fades out; showing is find-motion.ts's bloom. From display:none no transition runs on show. */
[data-blok-find][hidden] {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
```

3. In `[data-blok-find-bar]`, delete these lines:
   - `background: var(--blok-popover-bg);`
   - `box-shadow: var(--blok-popover-box-shadow);`
   - `transform-origin: top right;`
   - the whole `transition: opacity … transform …;` declaration

   Keep `border-radius` and `--blok-radius-inner`.

4. Change the four transform-origin rules (lines 109-121) to target the dock, not the bar:

```css
[data-blok-find][data-blok-find-placement^="bottom"] {
  transform-origin: bottom right;
}

/* The dock carries `dir` (syncPortalDirection). The dir pseudo-class would be lowered to
   page-`lang` rules by the build, so select the attribute instead. */
[data-blok-find][dir="rtl"] {
  transform-origin: top left;
}

[data-blok-find][dir="rtl"][data-blok-find-placement^="bottom"] {
  transform-origin: bottom left;
}
```

5. Delete the `[data-blok-find][hidden] [data-blok-find-bar] { … }` rule and the `@starting-style { [data-blok-find]:not([hidden]) [data-blok-find-bar] { … } }` block.

6. In the replace row, the open state snaps and only the close animates. Replace the `[data-blok-find-replace-row]` transition block, the `[hidden]` rule and its `@starting-style` (lines 349-373) with:

```css
/* Opening snaps: find-motion.ts springs the skin and clip over it. Closing still eases. */
[data-blok-find-replace-row] {
  display: grid;
  grid-template-rows: 1fr;
  margin-top: var(--blok-space-1);
  opacity: 1;
}

[data-blok-find-replace-row][hidden] {
  grid-template-rows: 0fr;
  margin-top: 0;
  opacity: 0;
  transition:
    grid-template-rows var(--blok-duration-slow) var(--blok-ease-popover),
    margin-top var(--blok-duration-slow) var(--blok-ease-popover),
    opacity var(--blok-duration-slow) var(--blok-ease-popover),
    display var(--blok-duration-slow) allow-discrete;
}
```

7. In the reduced-motion block, replace `[data-blok-find-bar], [data-blok-find][hidden] [data-blok-find-bar],` with `[data-blok-find][hidden],`. Keep `[data-blok-find-replace-row]` in the list, so it reads `[data-blok-find-replace-row][hidden]`.

- [ ] **Step 4: Run the CSS gates and see them pass**

Run each command separately. Several vitest paths in one run skip files (see memory `blok-agent-gate-traps`).

```bash
yarn test test/unit/styles/overlay-radius-roles.test.ts
yarn test test/unit/styles/selected-state-neutral.test.ts
yarn test test/unit/styles/css-split-equivalence.test.ts
yarn test test/unit/styles/main-css-rules
```

Expected: PASS. If the main-css-rules snapshot test fails, the diff must show only `find.css` selectors from this task. Then run it again with `-u` and read the snapshot diff with `git diff -- test/unit/styles/__snapshots/`. Every changed line must be a find rule.

- [ ] **Step 5: Look at it**

Run `yarn build` in the worktree. Open the playground with the `playwright-cli` skill (`-s=find-bloom`) and screenshot an open find bar in light and dark.

Expected: the bar looks exactly like before. It has the same rounded white or dark surface and the same shadow. Opening with no motion yet is acceptable.

- [ ] **Step 6: Commit**

```bash
git add src/styles/find.css test/unit/styles/overlay-radius-roles.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "refactor(find): paint the bar from a skin layer on the dock"
```

---

### Task 3: Bloom on open and a spring stretch for the replace row

**Files:**
- Modify: `src/components/modules/find/find-motion.ts` (append)
- Modify: `src/components/modules/find/find-bar.ts`:
  - imports;
  - fields near line 120-147;
  - the constructor's replace field (line 229);
  - `open()` (300-334);
  - `close()` (336-348);
  - `destroy()` (365-374);
  - `setReplaceOpen()` (571-583).
- Test: `test/unit/components/modules/find/find-motion.test.ts`, `test/unit/components/modules/find/find-bar.test.ts`

**Interfaces:**
- Consumes (Task 1): `growFrames`, `springEasing`, `cornerOf`, `SPRINGS`, `DOT`, `Corner`, `Size`.
- Produces:
  - `prefersReducedMotion(): boolean`
  - `canAnimate(element: Element): boolean`
  - `interface BloomParts { dock: HTMLElement; bar: HTMLElement; field: HTMLElement; query: HTMLElement; counter: HTMLElement | null; controls: HTMLElement[] }`
  - `bloom(parts: BloomParts, corner: Corner): Animation[]`
  - `stretch(parts: { dock: HTMLElement; bar: HTMLElement; field: HTMLElement; buttons: HTMLElement[] }, from: Size, corner: Corner): Animation[]`
  - private `FindBar.corner(): Corner`
  - private `FindBar.stopMotion(): void`

- [ ] **Step 1: Write the failing tests**

Append to `find-motion.test.ts`:

```ts
import { bloom, prefersReducedMotion } from '../../../../../src/components/modules/find/find-motion';

/** jsdom has no Web Animations; a stub records every call. */
const stubAnimate = (): ReturnType<typeof vi.fn> => {
  const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => undefined) }));

  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });

  return animate;
};

const stubReducedMotion = (reduce: boolean): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })));
};

describe('bloom', () => {
  const parts = (): Parameters<typeof bloom>[0] => {
    const dock = document.createElement('div');
    const bar = document.createElement('div');

    dock.append(bar);
    document.body.append(dock);
    Object.defineProperty(bar, 'offsetWidth', { value: 470 });
    Object.defineProperty(bar, 'offsetHeight', { value: 44 });

    return {
      dock,
      bar,
      field: document.createElement('div'),
      query: document.createElement('input'),
      counter: document.createElement('span'),
      controls: [document.createElement('button'), document.createElement('button')],
    };
  };

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('grows the skin on the dock and clips the bar, from the dot to the full box', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();

    bloom(p, { block: 'top', inline: 'right' });

    const skinCall = animate.mock.calls.find((call) => call[1]?.pseudoElement === '::before');
    const clipCall = animate.mock.calls.find((call) => Array.isArray(call[0]) && 'clipPath' in call[0][0]);

    expect(skinCall?.[0][0]).toMatchObject({ width: '40px', left: '430px' });
    expect(skinCall?.[1]).toMatchObject({ easing: 'linear' });
    expect(clipCall).toBeDefined();
    expect(animate.mock.contexts).toContain(p.dock);
  });

  it('lands the parts in reading order: field, then controls one after another', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();

    bloom(p, { block: 'top', inline: 'right' });

    const delayOf = (element: Element): number => {
      const index = animate.mock.contexts.indexOf(element);

      return Number(animate.mock.calls[index]?.[1]?.delay ?? -1);
    };

    expect(delayOf(p.field)).toBeLessThan(delayOf(p.controls[0]));
    expect(delayOf(p.controls[0])).toBeLessThan(delayOf(p.controls[1]));
  });

  it('does nothing under reduced motion', () => {
    const animate = stubAnimate();

    stubReducedMotion(true);

    expect(prefersReducedMotion()).toBe(true);
    expect(bloom(parts(), { block: 'top', inline: 'right' })).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('does nothing where Web Animations are missing', () => {
    stubReducedMotion(false);

    expect(bloom(parts(), { block: 'top', inline: 'right' })).toEqual([]);
  });
});
```

Append to `find-bar.test.ts`, inside `describe('FindBar')`:

```ts
  describe('motion', () => {
    let animate: ReturnType<typeof vi.fn>;
    let cancels: Array<ReturnType<typeof vi.fn>>;

    beforeEach(() => {
      cancels = [];
      animate = vi.fn(() => {
        const cancel = vi.fn();

        cancels.push(cancel);

        return { cancel, finished: new Promise<void>(() => undefined) };
      });
      Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
      vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query })));
    });

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'animate');
      vi.unstubAllGlobals();
    });

    const skinCalls = (): unknown[][] => animate.mock.calls.filter((call) => call[1]?.pseudoElement === '::before');

    it('blooms when it opens', () => {
      bar.open({ readOnly: false });

      expect(skinCalls()).toHaveLength(1);
    });

    it('does not bloom again when a second Mod+F lands on an open bar', () => {
      bar.open({ readOnly: false });
      bar.open({ readOnly: false });

      expect(skinCalls()).toHaveLength(1);
    });

    it('stops the bloom when it closes, so a quick reopen starts clean', () => {
      bar.open({ readOnly: false });
      const opened = cancels.length;

      bar.close();

      expect(cancels.slice(0, opened).every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
    });

    it('stretches the skin when the replace row opens on an open bar', () => {
      bar.open({ readOnly: false });
      button(bar.element, 'find.toggleReplace').click();

      expect(skinCalls()).toHaveLength(2);
    });

    it('covers both rows with one bloom when it opens with replace', () => {
      bar.open({ readOnly: false, replace: true });

      expect(skinCalls()).toHaveLength(1);
    });

    it('does not stretch when the replace row closes', () => {
      bar.open({ readOnly: false, replace: true });
      button(bar.element, 'find.toggleReplace').click();

      expect(skinCalls()).toHaveLength(1);
    });
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run each separately:

```bash
yarn test test/unit/components/modules/find/find-motion.test.ts
yarn test test/unit/components/modules/find/find-bar.test.ts
```

Expected: FAIL. `bloom` is not exported, and the bar makes no `animate` calls.

- [ ] **Step 3: Implement `bloom` and `stretch`**

Append to `find-motion.ts`:

```ts
export interface BloomParts {
  dock: HTMLElement;
  bar: HTMLElement;
  field: HTMLElement;
  query: HTMLElement;
  /** null while a word hops in: the hop lands the counter. */
  counter: HTMLElement | null;
  /** In reading order. */
  controls: HTMLElement[];
}

export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const canAnimate = (element: Element): boolean => typeof element.animate === 'function';

const sizeOf = (element: HTMLElement): Size => ({ width: element.offsetWidth, height: element.offsetHeight });

const radiusOf = (element: HTMLElement): number => parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;

const startEdge = (element: HTMLElement): 'left' | 'right' => getComputedStyle(element).direction === 'rtl' ? 'right' : 'left';

/**
 * Grow the bar out of a dot in its corner, then land its parts in reading
 * order. Part animations fill backwards only, so nothing stays inline after.
 */
export const bloom = (parts: BloomParts, corner: Corner): Animation[] => {
  const { dock, bar } = parts;

  if (prefersReducedMotion() || !canAnimate(bar)) {
    return [];
  }

  const frames = growFrames(sizeOf(bar), { width: DOT, height: DOT }, corner, {
    springs: { width: SPRINGS.wide, height: SPRINGS.tall },
    radius: { from: DOT / 2, to: radiusOf(bar) },
  });
  const sampled = { duration: frames.duration, easing: 'linear' };
  const soft = springEasing(SPRINGS.soft);
  const pop = springEasing(SPRINGS.bouncy);
  const edge = startEdge(dock);
  const animations = [
    dock.animate(frames.skin, { ...sampled, pseudoElement: '::before' }),
    bar.animate(frames.clip, sampled),
    bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: frames.duration * 0.25, easing: 'ease-out' }),
    parts.field.animate(
      [{ transform: 'scaleX(0.2)', transformOrigin: `${edge} center`, opacity: 0 }, { transform: 'none', transformOrigin: `${edge} center`, opacity: 1 }],
      { ...soft, delay: 60, fill: 'backwards' }
    ),
    parts.query.animate(
      [{ translate: `${edge === 'left' ? -8 : 8}px 0`, opacity: 0 }, { translate: '0 0', opacity: 1 }],
      { ...soft, delay: 160, fill: 'backwards' }
    ),
    ...parts.controls.map((control, index) => control.animate(
      [{ transform: 'scale(0.3) rotate(-30deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { ...pop, delay: 120 + 45 * index, fill: 'backwards' }
    )),
  ];

  // `translate`, not `transform`: the counter's bump keyframes own transform.
  if (parts.counter !== null) {
    animations.push(parts.counter.animate(
      [{ translate: '0 10px', opacity: 0 }, { translate: '0 0', opacity: 1 }],
      { ...pop, delay: 240, fill: 'backwards' }
    ));
  }

  return animations;
};

/**
 * The bar just grew taller (the replace row snapped open): spring the skin
 * and clip from the old size, pinching in a little as it stretches.
 */
export const stretch = (
  parts: { dock: HTMLElement; bar: HTMLElement; field: HTMLElement; buttons: HTMLElement[] },
  from: Size,
  corner: Corner
): Animation[] => {
  const { dock, bar } = parts;

  if (prefersReducedMotion() || !canAnimate(bar)) {
    return [];
  }

  const round = radiusOf(bar);
  const frames = growFrames(sizeOf(bar), from, corner, {
    springs: { width: SPRINGS.soft, height: SPRINGS.tall },
    radius: { from: round, to: round },
    pinch: 14,
  });
  const sampled = { duration: frames.duration, easing: 'linear' };
  const soft = springEasing(SPRINGS.soft);
  const pop = springEasing(SPRINGS.bouncy);

  return [
    dock.animate(frames.skin, { ...sampled, pseudoElement: '::before' }),
    bar.animate(frames.clip, sampled),
    parts.field.animate(
      [{ transform: 'translateY(-36px) scaleY(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { ...soft, delay: 40, fill: 'backwards' }
    ),
    ...parts.buttons.map((button, index) => button.animate(
      [{ transform: 'translateY(-24px) scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { ...pop, delay: 110 + 60 * index, fill: 'backwards' }
    )),
  ];
};
```

- [ ] **Step 4: Wire it into `FindBar`**

In `find-bar.ts`:

```ts
import { bloom, cornerOf, stretch, type Corner } from './find-motion';
```

Add the fields next to `private optionsMenu`:

```ts
  private readonly replaceField: HTMLElement;
  private motion: Animation[] = [];
```

In the constructor, change `const replaceField = build(...)` to `this.replaceField = build(...)`, and use `this.replaceField` where `replaceField` was used.

Add these private methods:

```ts
  private corner(): Corner {
    return cornerOf(this.element.getAttribute(ATTR.placement) ?? 'top-end', this.element.getAttribute('dir') === 'rtl');
  }

  private stopMotion(): void {
    this.motion.forEach((animation) => animation.cancel());
    this.motion = [];
  }
```

In `open()`, in the not-yet-open path, right after `promoteToTopLayer(this.element);`, add:

```ts
    this.stopMotion();
    this.motion = bloom({
      dock: this.element,
      bar: this.bar,
      field: this.field,
      query: this.input,
      counter: this.counter,
      controls: [this.replaceToggle, this.optionsButton, this.previousButton, this.nextButton, this.closeButton].filter((control) => !control.hidden),
    }, this.corner());
```

In `close()` and `destroy()`, call `this.stopMotion();` first.

Replace the body of `setReplaceOpen()`:

```ts
  private setReplaceOpen(open: boolean): void {
    const next = open && !this.readOnly;
    const changed = next !== this.replaceOpen;
    // Before the row shows: the stretch springs from this size.
    const from = { width: this.bar.offsetWidth, height: this.bar.offsetHeight };

    this.replaceOpen = next;
    this.replaceRow.hidden = !next;
    this.replaceToggle.setAttribute('aria-expanded', String(next));
    this.bar.toggleAttribute(ATTR.open, next);

    // On a closed bar, the bloom that follows covers both rows.
    if (changed && next && this.opened) {
      this.stopMotion();
      this.motion = stretch({
        dock: this.element,
        bar: this.bar,
        field: this.replaceField,
        buttons: [this.replaceButton, this.replaceAllButton],
      }, from, this.corner());
    }

    if (changed) {
      this.callbacks.onReplaceChange();
    }
  }
```

- [ ] **Step 5: Run the tests and see them pass**

Run each separately:

```bash
yarn test test/unit/components/modules/find/find-motion.test.ts
yarn test test/unit/components/modules/find/find-bar.test.ts
yarn test test/unit/components/modules/find/find.test.ts
```

Expected: PASS, including every existing test.

- [ ] **Step 6: Look at it in a real browser**

Run `yarn build`. Open the playground with `playwright-cli -s=find-bloom`, press Cmd/Ctrl+F, and take screenshots at about 60ms, 150ms, 300ms and 1s. One way is to pause `document.getAnimations()` and set `currentTime`, the way the prototype harness `scratchpad/find-proto/cap.js` did.

Expected: the bar grows from a top-right dot with a slight overshoot, and it ends identical to Task 2's still. Repeat for the replace toggle: the bar stretches down.

- [ ] **Step 7: Lint and commit**

```bash
yarn eslint src/components/modules/find/find-motion.ts src/components/modules/find/find-bar.ts test/unit/components/modules/find/find-motion.test.ts test/unit/components/modules/find/find-bar.test.ts
git add src/components/modules/find/find-motion.ts src/components/modules/find/find-bar.ts test/unit/components/modules/find/find-motion.test.ts test/unit/components/modules/find/find-bar.test.ts
git commit -m "feat(find): the find bar blooms from its corner on two springs"
```

---

### Task 4: Word hop

**Files:**
- Modify: `src/components/modules/find/find-motion.ts` (append)
- Modify: `src/components/modules/find/find-bar.ts`:
  - `ATTR`;
  - `open()` signature and body;
  - `handleInput()`;
  - `close()`;
  - `destroy()`.
- Modify: `src/components/modules/find/index.ts`: `open()` (134-163) and a new private `hopSource()`.
- Modify: `src/styles/find.css`: add the hop rules.
- Modify, only if it fails: `test/unit/architecture/floating-positioning-law.test.ts`.
- Test: `find-motion.test.ts`, `find-bar.test.ts`, `find.test.ts`.

**Interfaces:**
- Consumes (Task 3): `prefersReducedMotion`, `canAnimate`, `springEasing`, `SPRINGS`, `bloom` with `counter: null`.
- Produces:
  - `interface HopSource { rect: { left: number; top: number; width: number; height: number }; text: string; font: { family: string; size: string; weight: string; style: string; color: string } }`
  - `hopSourceFromRange(range: Range, text: string): HopSource | null`
  - `interface Hop { end(): void }`
  - `HOP_MS = 560`, `HOP_DELAY = 120`
  - `hop(dock: HTMLElement, source: HopSource, target: HTMLElement, delay: number, onEnd: (landed: boolean) => void): Hop | null`
  - `FindBar.open(init: { query?: string; replace?: boolean; readOnly: boolean; hop?: HopSource | null })`

- [ ] **Step 1: Write the failing tests**

Append to `find-motion.test.ts`. It reuses `stubAnimate` and `stubReducedMotion` from Task 3. Move them to the top of the file if they're scoped inside `describe('bloom')`.

```ts
import { HOP_DELAY, HOP_MS, hop, hopSourceFromRange } from '../../../../../src/components/modules/find/find-motion';

describe('hopSourceFromRange', () => {
  const rangeWithRects = (rects: Array<Partial<DOMRect>>): Range => {
    const p = document.createElement('p');

    p.textContent = 'pick this word';
    p.style.fontSize = '16px';
    document.body.append(p);
    const range = document.createRange();
    const text = p.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    range.setStart(text, 5);
    range.setEnd(text, 9);
    Object.defineProperty(range, 'getClientRects', {
      value: () => rects.map((rect) => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, ...rect })),
    });

    return range;
  };

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('takes the first visible line box and the text style', () => {
    const source = hopSourceFromRange(rangeWithRects([{ left: 50, top: 100, width: 30, height: 20, right: 80, bottom: 120 }]), 'this');

    expect(source?.rect).toEqual({ left: 50, top: 100, width: 30, height: 20 });
    expect(source?.text).toBe('this');
    expect(source?.font.size).toBe('16px');
  });

  it('gives no hop for a selection scrolled out of view', () => {
    expect(hopSourceFromRange(rangeWithRects([{ left: 50, top: -400, width: 30, height: 20, right: 80, bottom: -380 }]), 'this')).toBeNull();
  });

  it('gives no hop for a range with no boxes', () => {
    expect(hopSourceFromRange(rangeWithRects([]), 'this')).toBeNull();
  });

  it('gives no hop where ranges cannot measure (jsdom)', () => {
    const range = document.createRange();

    Object.defineProperty(range, 'getClientRects', { value: undefined });

    expect(hopSourceFromRange(range, 'this')).toBeNull();
  });
});

describe('hop', () => {
  const source = {
    rect: { left: 50, top: 100, width: 30, height: 20 },
    text: 'this',
    font: { family: 'serif', size: '16px', weight: '400', style: 'normal', color: 'rgb(0, 0, 0)' },
  };

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('flies a hidden copy of the word, then removes it and reports a landing', async () => {
    let land: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      land = resolve;
    });

    Object.defineProperty(Element.prototype, 'animate', {
      value: vi.fn(() => ({ cancel: vi.fn(), finished })),
      configurable: true,
      writable: true,
    });
    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    dock.append(input);
    document.body.append(dock);
    const onEnd = vi.fn();

    hop(dock, source, input, HOP_DELAY, onEnd);

    const chip = dock.querySelector('[data-blok-find-hop-chip]');

    expect(chip?.textContent).toBe('this');
    expect(chip?.getAttribute('aria-hidden')).toBe('true');

    land();
    await finished;
    await Promise.resolve();

    expect(dock.querySelector('[data-blok-find-hop-chip]')).toBeNull();
    expect(onEnd).toHaveBeenCalledWith(true);
  });

  it('ends at once when stopped, without a landing', () => {
    stubAnimate();
    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    dock.append(input);
    document.body.append(dock);
    const onEnd = vi.fn();

    hop(dock, source, input, 0, onEnd)?.end();

    expect(dock.querySelector('[data-blok-find-hop-chip]')).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('does not fly under reduced motion', () => {
    stubAnimate();
    stubReducedMotion(true);
    const dock = document.createElement('div');

    document.body.append(dock);

    expect(hop(dock, source, document.createElement('input'), 0, vi.fn())).toBeNull();
    expect(dock.childElementCount).toBe(0);
  });

  it('lasts long enough to read as a hop', () => {
    expect(HOP_MS).toBeGreaterThanOrEqual(400);
  });
});
```

Append to the `describe('motion')` block in `find-bar.test.ts`:

```ts
    const source = {
      rect: { left: 50, top: 100, width: 30, height: 20 },
      text: 'this',
      font: { family: 'serif', size: '16px', weight: '400', style: 'normal', color: 'rgb(0, 0, 0)' },
    };
    const chip = (): Element | null => bar.element.querySelector('[data-blok-find-hop-chip]');
    const field = (): HTMLElement => byTestId(bar.element, 'find-field');

    it('flies the selected word in and hides the field text until it lands', () => {
      bar.open({ readOnly: false, query: 'this', hop: source });

      expect(chip()).not.toBeNull();
      expect(field().hasAttribute('data-blok-find-hopping')).toBe(true);
      expect(findInput().value).toBe('this');
      expect(findInput()).toBe(document.activeElement);
    });

    it('hops with no bloom when the bar is already open', () => {
      bar.open({ readOnly: false });
      const blooms = animate.mock.calls.filter((call) => call[1]?.pseudoElement === '::before').length;

      bar.open({ readOnly: false, query: 'this', hop: source });

      expect(chip()).not.toBeNull();
      expect(animate.mock.calls.filter((call) => call[1]?.pseudoElement === '::before')).toHaveLength(blooms);
    });

    it('ends the hop at once when the reader types', () => {
      bar.open({ readOnly: false, query: 'this', hop: source });
      type(findInput(), 'thi');

      expect(chip()).toBeNull();
      expect(field().hasAttribute('data-blok-find-hopping')).toBe(false);
    });

    it('ends the hop when the bar closes', () => {
      bar.open({ readOnly: false, query: 'this', hop: source });
      bar.close();

      expect(chip()).toBeNull();
      expect(field().hasAttribute('data-blok-find-hopping')).toBe(false);
    });

    it('keeps the counter text live during the flight', () => {
      bar.open({ readOnly: false, query: 'this', hop: source });
      bar.setResults({ current: 0, total: 3 });

      expect(byTestId(bar.element, 'find-counter').textContent).toBe('find.count{"current":1,"total":3}');
    });
```

Append to `find.test.ts`, next to the prefill tests. Copy the `editor`, `press` and `searchInput` helpers already used there.

```ts
  it('gives the bar no hop for a host input selection, which has no rect', () => {
    const { wrapper } = editor([{ id: 'a', text: 'hello' }]);
    const hostInput = document.createElement('input');
    const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => undefined) }));

    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query })));
    hostInput.value = 'search words';
    document.body.appendChild(hostInput);
    hostInput.focus();
    hostInput.setSelectionRange(7, 12);
    press(hostInput, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(searchInput(wrapper).value).toBe('words');
    expect(document.querySelector('[data-blok-find-hop-chip]')).toBeNull();
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.unstubAllGlobals();
  });

  it('measures the selected word before the bar opens and takes focus', () => {
    const { redactor, blocks } = editor([{ id: 'a', text: 'pick this word' }]);
    const text = blocks[0].holder.querySelector('[contenteditable]')?.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    const measured = vi.fn(() => [{ left: 10, top: 10, width: 30, height: 18, right: 40, bottom: 28 }]);

    Object.defineProperty(Range.prototype, 'getClientRects', { value: measured, configurable: true, writable: true });
    window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
    const focusAtMeasure: Array<Element | null> = [];

    measured.mockImplementation(() => {
      focusAtMeasure.push(document.activeElement);

      return [{ left: 10, top: 10, width: 30, height: 18, right: 40, bottom: 28 }];
    });
    press(redactor, { key: 'f', code: 'KeyF', ctrlKey: true });

    expect(focusAtMeasure.length).toBeGreaterThan(0);
    expect(focusAtMeasure[0]?.closest('[data-blok-find]')).toBeNull();
    Reflect.deleteProperty(Range.prototype, 'getClientRects');
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run each separately: `find-motion.test.ts`, `find-bar.test.ts`, `find.test.ts`.
Expected: FAIL. `hop` and `hopSourceFromRange` are not exported, and `open()` ignores `hop`.

- [ ] **Step 3: Implement the hop**

Append to `find-motion.ts`:

```ts
export interface HopSource {
  rect: { left: number; top: number; width: number; height: number };
  text: string;
  font: { family: string; size: string; weight: string; style: string; color: string };
}

export interface Hop {
  /** Stop now: the chip goes, and `onEnd(false)` runs once. */
  end(): void;
}

export const HOP_MS = 560;
/** The bar starts blooming first, so there is a field to land in. */
export const HOP_DELAY = 120;

const ARC_LIFT = 70;
const ARC_SPIN = -14;
const ARC_GROW = 0.18;
const ARC_STEPS = 20;

/** The selected word's first visible line box and text style, or null when it has none on screen. */
export const hopSourceFromRange = (range: Range, text: string): HopSource | null => {
  if (typeof range.getClientRects !== 'function') {
    return null;
  }

  const rect = [...range.getClientRects()].find((box) => box.width > 0 && box.height > 0);
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;

  if (rect === undefined || element === null) {
    return null;
  }

  const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

  if (!onScreen) {
    return null;
  }

  const style = getComputedStyle(element);

  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    text,
    font: { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, style: style.fontStyle, color: style.color },
  };
};

/**
 * Fly a copy of the selected word from the page into `target` on an arc.
 * The copy is aria-hidden paint in the dock; the editor's DOM is never touched.
 */
export const hop = (
  dock: HTMLElement,
  source: HopSource,
  target: HTMLElement,
  delay: number,
  onEnd: (landed: boolean) => void
): Hop | null => {
  if (prefersReducedMotion() || !canAnimate(dock)) {
    return null;
  }

  // Measure before any bloom transform scales the field.
  const dockRect = dock.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const chip = document.createElement('span');

  chip.setAttribute('data-blok-find-hop-chip', '');
  chip.setAttribute('data-blok-testid', 'find-hop-chip');
  chip.setAttribute('aria-hidden', 'true');
  chip.textContent = source.text;
  Object.assign(chip.style, {
    left: `${source.rect.left - dockRect.left}px`,
    top: `${source.rect.top - dockRect.top}px`,
    fontFamily: source.font.family,
    fontSize: source.font.size,
    fontWeight: source.font.weight,
    fontStyle: source.font.style,
    color: source.font.color,
  });
  dock.append(chip);

  const rtl = getComputedStyle(target).direction === 'rtl';
  const dx = (rtl ? targetRect.right - chip.offsetWidth : targetRect.left) - source.rect.left;
  const dy = targetRect.top + (targetRect.height - chip.offsetHeight) / 2 - source.rect.top;
  const arc: Keyframe[] = Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const progress = i / ARC_STEPS;
    const travel = 1 - Math.pow(1 - progress, 2.2);
    const lift = Math.sin(progress * Math.PI);

    return {
      offset: progress,
      transform: `translate(${dx * travel}px, ${dy * travel - lift * ARC_LIFT}px) rotate(${lift * ARC_SPIN}deg) scale(${1 + lift * ARC_GROW})`,
    };
  });
  const flight = [
    chip.animate(arc, { duration: HOP_MS, delay, easing: 'linear', fill: 'backwards' }),
    chip.animate([{}, { backgroundColor: 'transparent' }], { duration: HOP_MS, delay, easing: 'ease-in', fill: 'both' }),
  ];
  let ended = false;
  const finish = (landed: boolean): void => {
    if (ended) {
      return;
    }
    ended = true;
    flight.forEach((animation) => animation.cancel());
    chip.remove();
    onEnd(landed);
  };

  // cancel() rejects `finished`; that path already ran finish(false).
  flight[0].finished.then(() => finish(true), () => undefined);

  return { end: () => finish(false) };
};
```

`chip.animate([{}, …])` uses an implicit start keyframe. That's valid WAAPI: it starts from the chip's computed tint.

- [ ] **Step 4: Wire the hop into `FindBar`**

1. Add `hopping: 'data-blok-find-hopping',` to `ATTR`.
2. Imports: `import { bloom, cornerOf, hop, HOP_DELAY, HOP_MS, springEasing, SPRINGS, stretch, type Corner, type Hop, type HopSource } from './find-motion';`
3. Add a field: `private flight: Hop | null = null;`
4. Change the `open` signature to `public open(init: { query?: string; replace?: boolean; readOnly: boolean; hop?: HopSource | null }): void`.
5. In the already-open path, right after `this.focusQuery();`, before `return;`, add `this.playHop(init.hop ?? null, 0);`.
6. In the not-yet-open path, replace the Task 3 bloom block with the version below. The hop measures before the bloom transforms the field.

```ts
    this.stopMotion();
    const hopping = this.playHop(init.hop ?? null, HOP_DELAY);

    this.motion.push(...bloom({
      dock: this.element,
      bar: this.bar,
      field: this.field,
      query: this.input,
      counter: hopping ? null : this.counter,
      controls: [this.replaceToggle, this.optionsButton, this.previousButton, this.nextButton, this.closeButton].filter((control) => !control.hidden),
    }, this.corner()));
```

   The hop needs the query in the input to measure against. So in this path, move the `if (init.query !== undefined) { this.input.value = init.query; }` block ABOVE the motion block.

7. Add:

```ts
  /** @returns true when a word is in flight */
  private playHop(source: HopSource | null, delay: number): boolean {
    this.flight?.end();

    if (source === null) {
      return false;
    }

    this.field.setAttribute(ATTR.hopping, '');
    this.flight = hop(this.element, source, this.input, delay, (landed) => {
      this.flight = null;
      this.field.removeAttribute(ATTR.hopping);

      if (landed) {
        const pop = springEasing(SPRINGS.bouncy);

        this.motion.push(
          this.field.animate([{ scale: '1' }, { scale: '1.04 0.9', offset: 0.25 }, { scale: '1' }], pop),
          this.input.animate([{ translate: '0 -4px' }, { translate: '0 0' }], pop)
        );
      }
    });

    if (this.flight === null) {
      this.field.removeAttribute(ATTR.hopping);

      return false;
    }

    // Paint only: the counter's text, and what it announces, is already current.
    this.motion.push(this.counter.animate([{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], {
      ...springEasing(SPRINGS.bouncy),
      delay: delay + HOP_MS + 80,
      fill: 'backwards',
    }));

    return true;
  }
```

   The field squash uses `scale`, not `transform`, because the field's shake keyframes own `transform`.

8. In `handleInput()`, as its first line, add `this.flight?.end();`.
9. In `close()` and `destroy()`, before `this.stopMotion();`, add `this.flight?.end();`.

- [ ] **Step 5: Capture the source in `Find.open()`**

In `index.ts`:

```ts
import { hopSourceFromRange, type HopSource } from './find-motion';
```

In `open()`, right after `const prefill = this.selectedTextForPrefill();`, add:

```ts
    // Before bar.open() takes focus and the search reveal scrolls.
    const hop = prefill === null ? null : this.hopSource(prefill);
```

Then pass `hop` in `bar.open({ … , hop })`. Add:

```ts
  /** Where the prefilled word sits on screen. A host input's selection has no range to measure. */
  private hopSource(text: string): HopSource | null {
    const field = document.activeElement;
    const selection = window.getSelection();

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || selection === null || selection.rangeCount === 0) {
      return null;
    }

    return hopSourceFromRange(selection.getRangeAt(0), text);
  }
```

- [ ] **Step 6: Add the hop CSS**

Add to `find.css` before `/* ─── Active match lens ─── */`:

```css
/* ─── Word hop ─── */

/* The word flies in on a copy; its text in the field shows when it lands. */
[data-blok-find-field][data-blok-find-hopping] > input {
  color: transparent;
  caret-color: transparent;
}

[data-blok-find-field][data-blok-find-hopping] > input::selection {
  background: transparent;
}

/* JS sets the place and the copied type; the tint fades out on the way. */
[data-blok-find-hop-chip] {
  position: absolute;
  z-index: 1;
  padding-inline: 1px;
  border-radius: var(--blok-radius-notch);
  background: var(--blok-selection-inline);
  line-height: var(--blok-line-height-body);
  white-space: pre;
  pointer-events: none;
}
```

Also add `[data-blok-find-hop-chip] { display: none; }` inside the reduced-motion block, as a belt to the JS gate.

- [ ] **Step 7: Run the tests and see them pass**

Run each separately:

```bash
yarn test test/unit/components/modules/find/find-motion.test.ts
yarn test test/unit/components/modules/find/find-bar.test.ts
yarn test test/unit/components/modules/find/find.test.ts
yarn test test/unit/architecture/floating-positioning-law.test.ts
yarn test test/unit/styles/overlay-radius-roles.test.ts
yarn test test/unit/styles/main-css-rules
```

Expected: PASS. If `floating-positioning-law` flags `components/modules/find/find-motion.ts`, add the entry to the registry it names: `MANUAL_POSITION_CLASSIFICATIONS` and/or `DYNAMIC_STYLE_ACCESS_CLASSIFICATIONS`. Use this reason:

`'Hop chip: a transient aria-hidden copy of the selected word. It turns the selection rect into dock-local px once, at open, and is removed when it lands or is interrupted; the bar itself is still placed by find.css.'`

If the snapshot fails, regenerate it as in Task 2 Step 4, and check that only find rules changed.

- [ ] **Step 8: Lint and commit**

```bash
yarn eslint src/components/modules/find/find-motion.ts src/components/modules/find/find-bar.ts src/components/modules/find/index.ts test/unit/components/modules/find/find-motion.test.ts test/unit/components/modules/find/find-bar.test.ts test/unit/components/modules/find/find.test.ts test/unit/architecture/floating-positioning-law.test.ts
git add src/components/modules/find/ src/styles/find.css test/unit/components/modules/find/ test/unit/architecture/floating-positioning-law.test.ts test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "feat(find): Mod+F on a selected word flies it into the find field"
```

---

### Task 5: End-to-end proof, a real-build GIF, and landing

**Files:**
- Modify: `test/playwright/tests/modules/find-in-page.spec.ts`. Add a `test.describe('motion', …)` block after `test.describe('placement')`.
- Modify: `docs/plans/2026-10-05-find-bar-bloom-hop-design.md`. The replace row now SNAPS open, with the skin and clip carrying the spring. Say so in "Replace row", and drop "keeps its real 0fr→1fr transition".

**Interfaces:**
- Consumes: everything above. E2E helpers already in the spec are `createEditor`, `paragraphs`, `focusParagraph`, `savedTexts`, `waitPastOnChangeBatch`, `FIND_KEY` and `REPLACE_KEY`.

- [ ] **Step 1: Write the e2e tests**

```ts
  test.describe('motion', () => {
    const settle = (page: Page): Promise<void> => page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'));

    const selectWord = async (page: Page, text: string, start: number, end: number): Promise<void> => {
      await page.getByText(text, { exact: true }).evaluate((element, range) => {
        const node = element.firstChild;

        if (node !== null) {
          window.getSelection()?.setBaseAndExtent(node, range.start, node, range.end);
        }
      }, { start, end });
    };

    for (const { placement, dir } of [
      { placement: 'top-end', dir: 'ltr' },
      { placement: 'bottom-start', dir: 'ltr' },
      { placement: 'top-center', dir: 'ltr' },
      { placement: 'top-end', dir: 'rtl' },
    ] as const) {
      test(`the bloom ends with the skin exactly on the bar (${placement}, ${dir})`, async ({ page }) => {
        await page.evaluate((direction) => document.documentElement.setAttribute('dir', direction), dir);
        await createEditor(page, paragraphs('hello there'), { config: { find: { placement } } });
        await focusParagraph(page, 'hello there');
        await page.keyboard.press(FIND_KEY);
        await settle(page);

        const fit = await page.evaluate(() => {
          const dock = document.querySelector<HTMLElement>('[data-blok-find]');
          const bar = document.querySelector<HTMLElement>('[data-blok-find-bar]');

          if (dock === null || bar === null) {
            return null;
          }
          const skin = getComputedStyle(dock, '::before');

          return {
            skin: [skin.width, skin.height],
            bar: [`${bar.offsetWidth}px`, `${bar.offsetHeight}px`],
            clip: getComputedStyle(bar).clipPath,
            opacity: getComputedStyle(bar).opacity,
          };
        });

        expect(fit?.skin).toEqual(fit?.bar);
        expect(fit?.clip).toBe('none');
        expect(fit?.opacity).toBe('1');
      });
    }

    test('Mod+F on a selected word flies it into the field, and writes nothing', async ({ page }) => {
      await createEditor(page, paragraphs('pick this word'));
      await page.evaluate(async () => {
        const counter = window as Window & { __findChanges?: number };

        counter.__findChanges = 0;
        window.blokInstance?.destroy();
        const blok = new window.Blok({
          holder: 'blok',
          data: { blocks: [{ id: 'find-p0', type: 'paragraph', data: { text: 'pick this word' } }] },
          onChange: () => {
            counter.__findChanges = (counter.__findChanges ?? 0) + 1;
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      });
      await focusParagraph(page, 'pick this word');
      await waitPastOnChangeBatch(page);
      await selectWord(page, 'pick this word', 5, 9);
      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-hop-chip')).toHaveText('this');
      await expect(page.getByTestId('find-hop-chip')).toHaveCount(0);
      await expect(page.getByTestId('find-input')).toHaveValue('this');
      await expect(page.getByTestId('find-input')).toBeFocused();
      await expect(page.getByTestId('find-field')).not.toHaveAttribute('data-blok-find-hopping', '');
      await waitPastOnChangeBatch(page);

      expect(await page.evaluate(() => (window as Window & { __findChanges?: number }).__findChanges)).toBe(0);
      expect(await savedTexts(page)).toEqual(['pick this word']);
    });

    test('typing during the flight shows the typed text at once', async ({ page }) => {
      await createEditor(page, paragraphs('pick this word'));
      await focusParagraph(page, 'pick this word');
      await selectWord(page, 'pick this word', 5, 9);
      await page.keyboard.press(FIND_KEY);
      await page.keyboard.type('w');

      await expect(page.getByTestId('find-hop-chip')).toHaveCount(0);
      await expect(page.getByTestId('find-input')).toHaveValue('w');
      await expect(page.getByTestId('find-field')).not.toHaveAttribute('data-blok-find-hopping', '');
    });

    test('with reduced motion the bar is whole on the first frame and nothing flies', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await createEditor(page, paragraphs('pick this word'));
      await focusParagraph(page, 'pick this word');
      await selectWord(page, 'pick this word', 5, 9);
      await page.keyboard.press(FIND_KEY);

      const state = await page.evaluate(() => ({
        running: document.querySelector('[data-blok-find]')?.getAnimations({ subtree: true }).length ?? -1,
        chips: document.querySelectorAll('[data-blok-find-hop-chip]').length,
      }));

      expect(state).toEqual({ running: 0, chips: 0 });
      await expect(page.getByTestId('find-input')).toHaveValue('this');
    });
  });
```

Note: in the second test the chip appears and leaves within about 700ms. `toHaveText` polls, so it catches the chip. If it proves flaky under CI CPU throttle (memory `ci-only-e2e-repro-cpu-throttle`), assert with a `MutationObserver`. Install one in the page before the keypress that records chips added to the dock, rather than racing the poll.

The `getAnimations({ subtree: true })` check is meant to include the `::before` animations; this is unverified. Confirm it once in Chromium. If it doesn't, use `document.getAnimations()`.

- [ ] **Step 2: Run them and see them pass**

There is no failing-first step for these. They pin behaviour that Tasks 1-4 already built under unit TDD. Mutation-check them instead:

1. Temporarily make `hop()` return `null` at its top. The hop test must FAIL.
2. Temporarily drop the `pseudoElement` option from the bloom's skin animation. The "skin exactly on the bar" tests must still PASS, because they check the resting state. That is expected; the unit test in Task 3 owns the skin call.
3. Revert both.

Run: `yarn e2e test/playwright/tests/modules/find-in-page.spec.ts -g "motion"`, then `yarn e2e test/playwright/tests/modules/find-in-page.spec.ts -g "placement|replace row lines up|opening"`.
Expected: all PASS, including the existing geometry specs.

- [ ] **Step 3: Record a GIF from the real build and show the user**

1. Rebuild.
2. Reuse the prototype capture approach (`scratchpad/find-proto/cap.js`) against the playground: pause `document.getAnimations()` and scrub at 30fps.
3. Capture three runs: open, open on a selection, and the replace toggle.
4. Encode with ffmpeg (palettegen/paletteuse).
5. Upload to the Claude Doc https://claude.ai/code/artifact/a8c9340a-5bc1-4fdf-acce-deb91fa7aec9 under a new "Built" section, next to the mockups.

Compare it frame by frame with the approved GIFs. A mismatch means fix the motion before landing.

- [ ] **Step 4: Final gates**

Run each separately in the worktree:

```bash
yarn test test/unit/components/modules/find/
yarn test test/unit/styles/
yarn test test/unit/architecture/floating-positioning-law.test.ts
yarn test test/unit/architecture/
yarn eslint src/components/modules/find/ src/styles/find.css test/unit/components/modules/find/ test/playwright/tests/modules/find-in-page.spec.ts
yarn tsc --noEmit -p tsconfig.json
```

Run `tsc` with an 8GB heap if needed (memory `blok-local-tsc-needs-8gb-heap`). Expected: all green.

- [ ] **Step 5: Land**

From the worktree:

```bash
git fetch origin && git rebase origin/main
git push origin HEAD:main
```

Then:
- run `git log origin/main -5` and check each subject matches its content;
- in the main checkout, fast-forward `main` only if its working tree has no edits to these files;
- remove the worktree per the global Worktrees rule.

There's no release note entry: this change isn't BREAKING.
