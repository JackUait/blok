# Editor Loading Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While Blok waits for `persistence.load()` or the first collaboration sync, show a neutral skeleton with one sweeping sheen, then FLIP each bar onto the real block it stands in for.

**Architecture:** Four pure units:
- a config resolver
- a skeleton DOM builder
- a FLIP handoff
- a loading controller that owns the timers and ARIA

`UI` owns one controller per editor. `Core.render()` drives it for the persistence path. `Collaboration` drives it for the sync path. Styles live in a new `loading.css` imported by `main.css`.

**Tech Stack:** TypeScript, Vitest (jsdom), Playwright, plain CSS with `data-blok-*` selectors, WAAPI (`Element.animate`).

**Spec:** `docs/superpowers/specs/2026-10-02-editor-loading-skeleton-design.md`

## Global Constraints

- The config key is `loader?: boolean | { skeleton?: Array<'heading' | 'paragraph' | 'list'>; delay?: number }`. The default is `true`.
- Default skeleton: `['heading', 'paragraph', 'paragraph', 'paragraph', 'list', 'list']`.
- Show delay defaults to 150 ms. Minimum visible time is 400 ms. Handoff stagger is 40 ms per bar. Handoff duration is 320 ms per bar.
- Under reduced motion: no sweep, no breathing, no FLIP. Use a plain 150 ms crossfade.
- No blue anywhere. Tokens are gray (channel spread ≤ 10).
- Data attributes: `data-blok-loading` on the wrapper and `data-blok-testid="loading-skeleton"` on the overlay.
- i18n key: `a11y.loadingContent` = "Loading content…".
- The overlay is `aria-hidden="true"` and `inert`. The wrapper gets `aria-busy="true"` while loading.
- This change is additive. Nothing here shipped in v1.15.2, so there is no BREAKING label.
- Never mutate the redactor's block DOM from the loader. Fade the redactor as a whole, and FLIP only overlay bars. The modifications observer watches the redactor, so the overlay must be a wrapper child, not a redactor child.
- TDD on every task. Run only the tests named in the task. Lint only the changed files.

## Review Focus

1. `destroy()` while the skeleton is still delayed or visible. Expected: no timer fires afterwards, and nothing is left in the holder (Task 7 test).
2. `load()` resolves 160 ms in, just after the skeleton appeared. Expected: it stays until 400 ms of visibility, then hands off. It must not vanish after 10 ms (Task 7 test).
3. `load()` resolves `null` (nothing saved yet). Expected: the skeleton hands off to the single default block, and extra bars fade (Task 7 test).
4. Two editors on one page, one loading. Expected: only that editor's wrapper is busy, because the controller is per UI instance (Task 7 test).
5. `readOnly: true` with persistence. Expected: the same skeleton and handoff, and the content is not editable afterwards (Task 9 e2e).

---

## File map

| File | Responsibility |
|---|---|
| `src/components/utils/loader-config.ts` (new) | Turns `config.loader` into `{ enabled, skeleton, delay }` |
| `src/components/utils/loading-skeleton.ts` (new) | Builds the overlay DOM from a skeleton spec |
| `src/components/utils/skeleton-handoff.ts` (new) | FLIP bars → target rects, crossfade the redactor |
| `src/components/utils/loading-controller.ts` (new) | Delay and minimum-visible timers, ARIA, mount/unmount, cancel |
| `src/styles/loading.css` (new) | Overlay layout, bars, sheen, breathing, reduced motion |
| `src/styles/colors.css` | `--blok-skeleton-*` tokens (light, media-dark, attr-dark) |
| `src/styles/keyframes.css` | `blok-skeleton-sweep`, `blok-skeleton-breathe` |
| `src/styles/main.css` | `@import './loading.css';` |
| `src/components/constants/data-attributes.ts` | `loading`, `loadingSkeleton`, `skeletonBar` |
| `types/configs/blok-config.d.ts` | `loader` key + docs |
| `src/components/modules/ui.ts` | Owns the controller: `showLoading()`, `hideLoading()`, destroy cleanup |
| `src/components/core.ts` | Persistence path: show before `load()`, hide after render |
| `src/components/modules/collaboration/index.ts` | Show in `load()`, hide on first content/degrade |
| `src/components/i18n/locales/*.json` (71) + ledger + `types/message-keys.d.ts` | `a11y.loadingContent` |
| `index.html` | `?slowLoad=<ms>` playground toggle |

---

### Task 1: Config resolver + public type

**Files:**
- Create: `src/components/utils/loader-config.ts`
- Modify: `types/configs/blok-config.d.ts` (add after `minHeight?: number;`, around line 880)
- Test: `test/unit/components/utils/loader-config.test.ts`

**Interfaces:**
- Produces: `type SkeletonRow = 'heading' | 'paragraph' | 'list'`, `interface ResolvedLoaderConfig { enabled: boolean; skeleton: SkeletonRow[]; delay: number }`, `resolveLoaderConfig(input: BlokConfig['loader']): ResolvedLoaderConfig`, `DEFAULT_SKELETON`, `DEFAULT_LOADER_DELAY = 150`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SKELETON, resolveLoaderConfig } from '../../../../src/components/utils/loader-config';

describe('resolveLoaderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is on with the default skeleton and 150ms delay when omitted', () => {
    expect(resolveLoaderConfig(undefined)).toEqual({ enabled: true, skeleton: DEFAULT_SKELETON, delay: 150 });
    expect(DEFAULT_SKELETON).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'list', 'list']);
  });

  it('is off for false', () => {
    expect(resolveLoaderConfig(false).enabled).toBe(false);
  });

  it('takes a custom skeleton and delay', () => {
    expect(resolveLoaderConfig({ skeleton: ['paragraph'], delay: 0 })).toEqual({ enabled: true, skeleton: ['paragraph'], delay: 0 });
  });

  it('falls back to defaults for an empty skeleton, unknown rows and bad delays', () => {
    const resolved = resolveLoaderConfig({ skeleton: [], delay: -5 });

    expect(resolved.skeleton).toEqual(DEFAULT_SKELETON);
    expect(resolved.delay).toBe(150);
    // A JS host can pass anything; unknown rows are dropped, not rendered as blanks.
    expect(resolveLoaderConfig({ skeleton: ['list', 'video' as 'list'] }).skeleton).toEqual(['list']);
    expect(resolveLoaderConfig({ delay: Number.NaN }).delay).toBe(150);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn test test/unit/components/utils/loader-config.test.ts`
Expected: FAIL, because it cannot resolve `loader-config`.

- [ ] **Step 3: Implement**

```ts
import type { BlokConfig } from '../../../types';

export type SkeletonRow = 'heading' | 'paragraph' | 'list';

export interface ResolvedLoaderConfig {
  enabled: boolean;
  skeleton: SkeletonRow[];
  delay: number;
}

export const DEFAULT_SKELETON: SkeletonRow[] = ['heading', 'paragraph', 'paragraph', 'paragraph', 'list', 'list'];
export const DEFAULT_LOADER_DELAY = 150;

const ROWS = new Set<string>(['heading', 'paragraph', 'list']);

export const resolveLoaderConfig = (input: BlokConfig['loader']): ResolvedLoaderConfig => {
  if (input === false) {
    return { enabled: false, skeleton: DEFAULT_SKELETON, delay: DEFAULT_LOADER_DELAY };
  }

  const options = typeof input === 'object' && input !== null ? input : {};
  const rows = (options.skeleton ?? []).filter((row): row is SkeletonRow => ROWS.has(row));
  const delay = options.delay;

  return {
    enabled: true,
    skeleton: rows.length > 0 ? rows : DEFAULT_SKELETON,
    delay: typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_LOADER_DELAY,
  };
};
```

In `types/configs/blok-config.d.ts`, inside `BlokConfig` after `minHeight`:

```ts
  /**
   * Skeleton shown while the editor waits for `persistence.load()` or the
   * first collaboration sync. It never shows when `data` is passed directly.
   * `false` turns it off.
   * @default true
   * @example
   * loader: { skeleton: ['heading', 'paragraph', 'list'], delay: 200 }
   */
  loader?: boolean | {
    /** Rows top to bottom. Default: heading, 3 paragraphs, 2 list rows. */
    skeleton?: Array<'heading' | 'paragraph' | 'list'>;
    /** Ms to wait before showing, so fast loads never flash. Default 150. */
    delay?: number;
  };
```

- [ ] **Step 4: Run and pass**

Run: `yarn test test/unit/components/utils/loader-config.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/loader-config.ts types/configs/blok-config.d.ts test/unit/components/utils/loader-config.test.ts
git commit -m "feat(loader): loader config key and resolver"
```

---

### Task 2: Data attributes + skeleton DOM builder

**Files:**
- Modify: `src/components/constants/data-attributes.ts`. Add next to `rendered` (around line 35).
- Regenerate: `types/data-attributes.d.ts` via `node scripts/generate-data-attributes-dts.mjs`
- Create: `src/components/utils/loading-skeleton.ts`
- Test: `test/unit/components/utils/loading-skeleton.test.ts`

**Interfaces:**
- Consumes: `SkeletonRow` (Task 1).
- Produces: `DATA_ATTR.loading = 'data-blok-loading'`, `DATA_ATTR.loadingSkeleton = 'data-blok-loading-skeleton'`, `DATA_ATTR.skeletonBar = 'data-blok-skeleton-bar'`. Also `buildLoadingSkeleton(rows: SkeletonRow[]): { root: HTMLElement; bars: HTMLElement[] }`. `bars[i]` is the bar for row `i`, the one the handoff pairs with block `i`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { buildLoadingSkeleton } from '../../../../src/components/utils/loading-skeleton';

describe('buildLoadingSkeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds one bar per row, in order, tagged with its kind', () => {
    const { root, bars } = buildLoadingSkeleton(['heading', 'paragraph', 'list']);

    expect(bars).toHaveLength(3);
    expect(bars.map(bar => bar.getAttribute(DATA_ATTR.skeletonBar))).toEqual(['heading', 'paragraph', 'list']);
    expect(root.querySelectorAll(`[${DATA_ATTR.skeletonBar}]`)).toHaveLength(3);
  });

  it('is invisible to assistive tech and to input', () => {
    const { root } = buildLoadingSkeleton(['paragraph']);

    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.hasAttribute('inert')).toBe(true);
    expect(root.getAttribute('data-blok-testid')).toBe('loading-skeleton');
    expect(root.hasAttribute(DATA_ATTR.loadingSkeleton)).toBe(true);
  });

  it('gives paragraph bars uneven widths and a per-bar phase index', () => {
    const { bars } = buildLoadingSkeleton(['paragraph', 'paragraph', 'paragraph']);
    const widths = bars.map(bar => bar.style.getPropertyValue('--blok-skeleton-width'));

    expect(new Set(widths).size).toBe(3);
    expect(bars.map(bar => bar.style.getPropertyValue('--blok-skeleton-index'))).toEqual(['0', '1', '2']);
  });

  it('gives a list row a bullet before its bar', () => {
    const { bars } = buildLoadingSkeleton(['list']);

    expect(bars[0].querySelector('[data-blok-skeleton-bullet]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run and fail.** Run: `yarn test test/unit/components/utils/loading-skeleton.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Data attributes:

```ts
  /** Present on the editor wrapper while the loading skeleton owns it.
   *  Public styling hook. */
  loading: 'data-blok-loading',
  /** The loading skeleton overlay (a wrapper child, never inside the redactor). */
  loadingSkeleton: 'data-blok-loading-skeleton',
  /** One skeleton row; the value is its kind: heading | paragraph | list. */
  skeletonBar: 'data-blok-skeleton-bar',
```

Then run `node scripts/generate-data-attributes-dts.mjs`.

`loading-skeleton.ts`:

```ts
import { DATA_ATTR } from '../constants/data-attributes';
import type { SkeletonRow } from './loader-config';

/** Uneven on purpose: equal bars read as a progress meter, not as text. */
const PARAGRAPH_WIDTHS = ['94%', '88%', '62%', '97%', '76%'];
const LIST_WIDTHS = ['46%', '58%', '38%'];

export const buildLoadingSkeleton = (rows: SkeletonRow[]): { root: HTMLElement; bars: HTMLElement[] } => {
  const root = document.createElement('div');

  root.setAttribute(DATA_ATTR.loadingSkeleton, '');
  root.setAttribute('data-blok-testid', 'loading-skeleton');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('inert', '');

  const counts = { heading: 0, paragraph: 0, list: 0 };

  const bars = rows.map((row, index) => {
    const bar = document.createElement('div');
    const n = counts[row]++;
    const width = row === 'heading' ? '42%' : row === 'list' ? LIST_WIDTHS[n % LIST_WIDTHS.length] : PARAGRAPH_WIDTHS[n % PARAGRAPH_WIDTHS.length];

    bar.setAttribute(DATA_ATTR.skeletonBar, row);
    bar.style.setProperty('--blok-skeleton-width', width);
    bar.style.setProperty('--blok-skeleton-index', String(index));

    if (row === 'list') {
      const bullet = document.createElement('span');

      bullet.setAttribute('data-blok-skeleton-bullet', '');
      bar.appendChild(bullet);
    }

    root.appendChild(bar);

    return bar;
  });

  return { root, bars };
};
```

- [ ] **Step 4: Run and pass.** Run the same test file, plus `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/constants/data-attributes.ts types/data-attributes.d.ts src/components/utils/loading-skeleton.ts test/unit/components/utils/loading-skeleton.test.ts
git commit -m "feat(loader): skeleton overlay DOM and data attributes"
```

---

### Task 3: Styles: tokens, overlay, sheen, reduced motion

**Files:**
- Create: `src/styles/loading.css`
- Modify: `src/styles/colors.css`. Add the tokens in the three theme blocks, next to `--blok-item-hover-bg` at lines ~125 (light), ~581 (`@media (prefers-color-scheme: dark)`), ~779 (`[data-blok-theme="dark"]`).
- Modify: `src/styles/keyframes.css`, `src/styles/main.css` (add `@import './loading.css';` after `@import './spotlight.css';`, line ~727)
- Test: `test/unit/styles/loading-skeleton-css.test.ts`
- Update intentionally: `test/unit/styles/__snapshots__/main-css-keyframes.snap.txt`, `main-css-rules.snap.txt`

**Interfaces:**
- Consumes: attribute names from Task 2.
- Produces: tokens `--blok-skeleton-bar`, `--blok-skeleton-sheen`, `--blok-skeleton-radius`. Keyframes `blok-skeleton-sweep` and `blok-skeleton-breathe`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();
const declarations = (token: string): string[] =>
  [...css.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map(match => match[1].trim());

describe('loading skeleton styles', () => {
  it.each(['--blok-skeleton-bar', '--blok-skeleton-sheen'])('%s is gray in light, media-dark and attr-dark', (token) => {
    const values = declarations(token);

    expect(values.length).toBeGreaterThanOrEqual(3);
    values.forEach((value) => {
      const channels = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

      expect(channels, `${token}: ${value}`).not.toBeNull();
      const [r, g, b] = (channels ?? []).slice(1).map(Number);

      expect(Math.max(r, g, b) - Math.min(r, g, b), `${token}: ${value}`).toBeLessThanOrEqual(10);
    });
  });

  it('defines the sweep and breathe keyframes', () => {
    expect(css).toMatch(/@keyframes blok-skeleton-sweep\b/);
    expect(css).toMatch(/@keyframes blok-skeleton-breathe\b/);
  });

  it('stops all skeleton motion under reduced motion', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\[data-blok-skeleton-bar\][^}]*animation:\s*none/);

    expect(reduced).not.toBeNull();
  });

  it('keeps the overlay out of pointer input', () => {
    expect(css).toMatch(/\[data-blok-loading-skeleton\]\s*\{[^}]*pointer-events:\s*none/);
  });
});
```

- [ ] **Step 2: Run and fail.** Run: `yarn test test/unit/styles/loading-skeleton-css.test.ts`. Expected: FAIL (no tokens).

- [ ] **Step 3: Implement**

`colors.css`. Light block:
```css
  --blok-skeleton-bar: rgba(55, 53, 47, 0.07);
  --blok-skeleton-sheen: rgba(255, 255, 255, 0.65);
```
Both dark blocks:
```css
  --blok-skeleton-bar: rgba(255, 255, 255, 0.06);
  --blok-skeleton-sheen: rgba(255, 255, 255, 0.09);
```

`keyframes.css`:
```css
@keyframes blok-skeleton-sweep {
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
}

@keyframes blok-skeleton-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.72; }
}
```

`loading.css`:
```css
/* The overlay is a WRAPPER child: the redactor is under the modifications
   observer, so nothing here may live inside it. */

[data-blok-interface] {
  --blok-skeleton-radius: var(--blok-radius-inner, 4px);
}

/* Hidden, not removed: the handoff measures real blocks under it. */
[data-blok-loading] [data-blok-redactor] {
  opacity: 0;
}

[data-blok-loading-skeleton] {
  position: absolute;
  inset: 0 0 auto 0;
  pointer-events: none;
  padding-block: 6px;
}

[data-blok-skeleton-bar] {
  position: relative;
  width: var(--blok-skeleton-width);
  height: 0.9em;
  margin-block: 0.55em;
  border-radius: var(--blok-skeleton-radius);
  /* background-attachment: fixed would break inside transforms, so every bar
     uses the same 300%-wide gradient and the same timing. Equal widths in
     percentages of the overlay keep the band lined up across bars. */
  background:
    linear-gradient(100deg, transparent 40%, var(--blok-skeleton-sheen) 50%, transparent 60%) 0 0 / 300% 100% no-repeat,
    var(--blok-skeleton-bar);
  animation:
    blok-skeleton-sweep 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite,
    blok-skeleton-breathe 2.4s ease-in-out calc(var(--blok-skeleton-index) * -0.35s) infinite;
}

[data-blok-skeleton-bar="heading"] {
  height: 1.5em;
  margin-block: 0.4em 0.9em;
}

[data-blok-skeleton-bar="list"] {
  margin-inline-start: 1.5em;
}

[data-blok-skeleton-bullet] {
  position: absolute;
  inset-inline-start: -1.1em;
  top: 50%;
  width: 0.35em;
  height: 0.35em;
  border-radius: 50%;
  background: var(--blok-skeleton-bar);
  transform: translateY(-50%);
}

@media (prefers-reduced-motion: reduce) {
  [data-blok-skeleton-bar] {
    animation: none;
  }
}
```

Note: in Step 4, check that the sheen reads as **one** band across the bars. If the bars' different widths desync it, switch to driving `background-position` from a single overlay-level custom property. Check this in the browser in Task 10. Do not assume it.

- [ ] **Step 4: Run and pass.** Run the new test file. Then update the snapshots on purpose: `yarn test test/unit/styles/main-css -u`. Read the snapshot diff and confirm it only adds skeleton rules and keyframes. Also run `yarn test test/unit/styles/selected-state-neutral.test.ts test/unit/styles/css-split-equivalence.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/styles/loading.css src/styles/colors.css src/styles/keyframes.css src/styles/main.css test/unit/styles/loading-skeleton-css.test.ts test/unit/styles/__snapshots__/main-css-keyframes.snap.txt test/unit/styles/__snapshots__/main-css-rules.snap.txt
git commit -m "feat(loader): neutral skeleton styles with one sweeping sheen"
```

Caution: the working tree already has uncommitted edits by someone else in these two snapshot files (video work). Do NOT `git add` those snapshot files if they still contain foreign hunks. Use `git add -p` and stage only the skeleton hunks.

---

### Task 4: FLIP handoff

**Files:**
- Create: `src/components/utils/skeleton-handoff.ts`
- Test: `test/unit/components/utils/skeleton-handoff.test.ts`

**Interfaces:**
- Consumes: `prefersReducedMotion` from `src/components/utils/reduced-motion.ts`.
- Produces: `runSkeletonHandoff(args: { bars: HTMLElement[]; targets: HTMLElement[]; content: HTMLElement }): Promise<void>`.
  - `targets[i]` is block holder `i`. `content` is the redactor, which the caller has already revealed for measuring.
  - Resolves when every animation finishes. If `Element.prototype.animate` is missing (jsdom), it resolves at once.
  - Constants: `HANDOFF_STAGGER = 40`, `HANDOFF_DURATION = 320`, `REDUCED_FADE = 150`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSkeletonHandoff } from '../../../../src/components/utils/skeleton-handoff';
import * as motion from '../../../../src/components/utils/reduced-motion';

type AnimateCall = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

const rect = (top: number, height: number, width = 600): DOMRect =>
  ({ top, left: 0, width, height, right: width, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

describe('runSkeletonHandoff', () => {
  const calls: AnimateCall[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ el: this, keyframes, options });

      return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation;
    }) as unknown as Element['animate'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, 'animate');
  });

  const make = (n: number, tops: number[]): HTMLElement[] => Array.from({ length: n }, (_, i) => {
    const el = document.createElement('div');

    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(tops[i] ?? 0, 20));

    return el;
  });

  it('moves bar i onto block i, staggered top to bottom', async () => {
    const bars = make(2, [0, 30]);
    const targets = make(2, [100, 160]);
    const content = document.createElement('div');

    await runSkeletonHandoff({ bars, targets, content });

    const barCalls = calls.filter(call => bars.includes(call.el as HTMLElement));

    expect(barCalls).toHaveLength(2);
    expect(String(barCalls[0].keyframes[1].transform)).toContain('translate(0px, 100px)');
    expect(String(barCalls[1].keyframes[1].transform)).toContain('translate(0px, 130px)');
    expect(barCalls[1].options.delay).toBeGreaterThan(Number(barCalls[0].options.delay ?? 0));
  });

  it('fades extra bars in place and fades the content in', async () => {
    const bars = make(3, [0, 30, 60]);
    const targets = make(1, [0]);
    const content = document.createElement('div');

    await runSkeletonHandoff({ bars, targets, content });

    const extra = calls.filter(call => call.el === bars[2]);

    expect(extra).toHaveLength(1);
    expect(extra[0].keyframes.some(frame => frame.transform !== undefined)).toBe(false);
    expect(calls.some(call => call.el === content)).toBe(true);
  });

  it('under reduced motion only crossfades: no transforms, no blur', async () => {
    vi.spyOn(motion, 'prefersReducedMotion').mockReturnValue(true);
    const bars = make(1, [0]);
    const targets = make(1, [100]);

    await runSkeletonHandoff({ bars, targets, content: document.createElement('div') });

    calls.forEach((call) => {
      call.keyframes.forEach(frame => {
        expect(frame.transform).toBeUndefined();
        expect(frame.filter).toBeUndefined();
      });
    });
  });

  it('resolves at once when animate is unavailable', async () => {
    Reflect.deleteProperty(Element.prototype, 'animate');

    await expect(runSkeletonHandoff({ bars: make(1, [0]), targets: make(1, [0]), content: document.createElement('div') })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and fail.** Run: `yarn test test/unit/components/utils/skeleton-handoff.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { prefersReducedMotion } from './reduced-motion';

export const HANDOFF_STAGGER = 40;
export const HANDOFF_DURATION = 320;
export const REDUCED_FADE = 150;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const runSkeletonHandoff = async ({ bars, targets, content }: {
  bars: HTMLElement[];
  targets: HTMLElement[];
  content: HTMLElement;
}): Promise<void> => {
  if (typeof content.animate !== 'function') {
    return;
  }

  if (prefersReducedMotion()) {
    await Promise.all([
      ...bars.map(bar => bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE, fill: 'forwards' }).finished),
      content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE, fill: 'forwards' }).finished,
    ]);

    return;
  }

  // Read every rect before any animation starts, so one layout pass serves all bars.
  const pairs = bars.map((bar, i) => ({ bar, from: bar.getBoundingClientRect(), to: targets[i]?.getBoundingClientRect() }));
  const delayOf = (i: number): number => i * HANDOFF_STAGGER;

  const barAnimations = pairs.map(({ bar, from, to }, i) => {
    if (to === undefined) {
      return bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: HANDOFF_DURATION, delay: delayOf(i), easing: EASE, fill: 'forwards' }).finished;
    }

    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const sx = from.width === 0 ? 1 : Math.min(to.width / from.width, 1.15);

    bar.style.transformOrigin = '0 0';

    return bar.animate([
      { transform: 'translate(0px, 0px) scaleX(1)', opacity: 1, filter: 'blur(0px)' },
      { transform: `translate(${dx}px, ${dy}px) scaleX(${sx})`, opacity: 0, filter: 'blur(4px)' },
    ], { duration: HANDOFF_DURATION, delay: delayOf(i), easing: EASE, fill: 'forwards' }).finished;
  });

  // The content arrives as one sheet; the per-bar stagger carries the top-to-bottom feel.
  const contentAnimation = content.animate([
    { opacity: 0, filter: 'blur(6px)' },
    { opacity: 1, filter: 'blur(0px)' },
  ], { duration: HANDOFF_DURATION + delayOf(Math.max(bars.length - 1, 0)), easing: EASE, fill: 'forwards' }).finished;

  await Promise.all([...barAnimations, contentAnimation]);
};
```

Why content fades as one sheet: the spec mentions per-block fades, but animating block holders inside the redactor writes `style`/animations at block level. Keeping it to the redactor plus overlay bars stays inside the "never write below a child's tool root" rule and away from the modifications observer. If the user wants true per-block reveal, that is a follow-up. Flag it in the final report.

- [ ] **Step 4: Run and pass.** Run the same test file. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/skeleton-handoff.ts test/unit/components/utils/skeleton-handoff.test.ts
git commit -m "feat(loader): FLIP handoff from skeleton bars to real blocks"
```

---

### Task 5: Loading controller (timers, ARIA, teardown)

**Files:**
- Create: `src/components/utils/loading-controller.ts`
- Test: `test/unit/components/utils/loading-controller.test.ts`

**Interfaces:**
- Consumes: `ResolvedLoaderConfig` (T1), `buildLoadingSkeleton` (T2), `runSkeletonHandoff` (T4), `DATA_ATTR`.
- Produces:
  ```ts
  export const MIN_VISIBLE = 400;
  export class LoadingController {
    constructor(args: { wrapper: HTMLElement; content: HTMLElement; config: ResolvedLoaderConfig; label: string });
    /** Start the delay timer. No-op if disabled or already started. */
    public show(): void;
    /** Resolve when the skeleton is gone. Targets are block holders, top to bottom. */
    public hide(targets: HTMLElement[]): Promise<void>;
    /** Remove everything now and cancel timers. Safe to call any time, any number of times. */
    public destroy(): void;
    public get isVisible(): boolean;
  }
  ```

Behaviour:
- `show()` sets `aria-busy="true"` on the wrapper right away. It also appends a visually hidden `role="status"` / `aria-live="polite"` element with `label`, using the same inline sr-only style object pattern as `src/components/utils/announcer.ts`, because utility classes are scoped away. It then arms a timer for `config.delay`. When the timer fires, it sets `DATA_ATTR.loading` on the wrapper, which hides the content through CSS, appends the skeleton root to the wrapper, and records `shownAt = performance.now()`.
- `hide()` before the timer fired: clear the timer, remove `aria-busy` and the status, and resolve. No skeleton, no animation.
- `hide()` after the skeleton showed: wait until `MIN_VISIBLE` ms have passed since `shownAt`. Then remove `DATA_ATTR.loading`. The content is now laid out with CSS opacity 0 gone, so set `content.style.opacity = '0'` first and let the handoff animate it to 1. Then await `runSkeletonHandoff`, remove the skeleton root, clear `content.style.opacity`, `cancel()` any `getAnimations()` on content so `fill: forwards` does not pin styles, and drop `aria-busy` and the status.
- `destroy()` clears the timers, removes the root and status, and removes the attributes. A pending `hide()` resolves.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingController, MIN_VISIBLE } from '../../../../src/components/utils/loading-controller';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';

const setup = (delay = 150): { wrapper: HTMLElement; content: HTMLElement; controller: LoadingController } => {
  const wrapper = document.createElement('div');
  const content = document.createElement('div');

  wrapper.appendChild(content);
  document.body.appendChild(wrapper);

  const controller = new LoadingController({
    wrapper,
    content,
    config: { enabled: true, skeleton: ['heading', 'paragraph'], delay },
    label: 'Loading content…',
  });

  return { wrapper, content, controller };
};

const skeleton = (wrapper: HTMLElement): Element | null => wrapper.querySelector(`[${DATA_ATTR.loadingSkeleton}]`);

describe('LoadingController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows nothing when hidden before the delay', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    expect(wrapper.getAttribute('aria-busy')).toBe('true');
    vi.advanceTimersByTime(149);
    await controller.hide([]);

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(false);
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(skeleton(wrapper)).toBeNull();
  });

  it('shows the skeleton and a polite status after the delay', () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(150);

    expect(skeleton(wrapper)).not.toBeNull();
    expect(wrapper.hasAttribute(DATA_ATTR.loading)).toBe(true);
    expect(wrapper.querySelector('[role="status"]')?.textContent).toBe('Loading content…');
  });

  it('stays at least MIN_VISIBLE once shown, even if data lands right after', async () => {
    const { wrapper, controller } = setup();

    controller.show();
    vi.advanceTimersByTime(160);
    const done = controller.hide([]);

    vi.advanceTimersByTime(MIN_VISIBLE - 20);
    expect(skeleton(wrapper)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(20);
    await done;
    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(wrapper.querySelector('[role="status"]')).toBeNull();
  });

  it('destroy() mid-load cancels the delay and leaves nothing behind', () => {
    const { wrapper, controller } = setup();

    controller.show();
    controller.destroy();
    vi.advanceTimersByTime(1000);

    expect(skeleton(wrapper)).toBeNull();
    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(wrapper.querySelector('[role="status"]')).toBeNull();
  });

  it('does nothing when disabled', () => {
    const wrapper = document.createElement('div');
    const controller = new LoadingController({
      wrapper,
      content: document.createElement('div'),
      config: { enabled: false, skeleton: ['paragraph'], delay: 0 },
      label: 'x',
    });

    controller.show();
    vi.advanceTimersByTime(10);

    expect(wrapper.hasAttribute('aria-busy')).toBe(false);
    expect(skeleton(wrapper)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and fail.** Run: `yarn test test/unit/components/utils/loading-controller.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { DATA_ATTR } from '../constants/data-attributes';
import type { ResolvedLoaderConfig } from './loader-config';
import { buildLoadingSkeleton } from './loading-skeleton';
import { runSkeletonHandoff } from './skeleton-handoff';

/** Once shown, shorter than this reads as a flicker. */
export const MIN_VISIBLE = 400;

/** Inline, not a class: scoped utility classes do not reach here (see announcer.ts). */
const SR_ONLY: Partial<CSSStyleDeclaration> = {
  position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px',
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: '0',
};

export class LoadingController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private skeleton: { root: HTMLElement; bars: HTMLElement[] } | null = null;
  private status: HTMLElement | null = null;
  private shownAt = 0;
  private started = false;
  private destroyed = false;

  constructor(private readonly args: { wrapper: HTMLElement; content: HTMLElement; config: ResolvedLoaderConfig; label: string }) {}

  public get isVisible(): boolean {
    return this.skeleton !== null;
  }

  public show(): void {
    if (!this.args.config.enabled || this.started || this.destroyed) {
      return;
    }

    this.started = true;
    this.args.wrapper.setAttribute('aria-busy', 'true');
    this.status = document.createElement('div');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    Object.assign(this.status.style, SR_ONLY);
    this.status.textContent = this.args.label;
    this.args.wrapper.appendChild(this.status);

    this.timer = setTimeout(() => {
      this.timer = null;
      this.skeleton = buildLoadingSkeleton(this.args.config.skeleton);
      this.args.wrapper.setAttribute(DATA_ATTR.loading, '');
      this.args.wrapper.appendChild(this.skeleton.root);
      this.shownAt = performance.now();
    }, this.args.config.delay);
  }

  public async hide(targets: HTMLElement[]): Promise<void> {
    if (!this.started || this.destroyed) {
      return;
    }

    this.started = false;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const skeleton = this.skeleton;

    if (skeleton !== null) {
      const remaining = MIN_VISIBLE - (performance.now() - this.shownAt);

      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }

      if (this.destroyed) {
        return;
      }

      const { content, wrapper } = this.args;

      content.style.opacity = '0';
      wrapper.removeAttribute(DATA_ATTR.loading);
      await runSkeletonHandoff({ bars: skeleton.bars, targets, content });
      content.getAnimations?.().forEach(animation => animation.cancel());
      content.style.removeProperty('opacity');
    }

    this.teardown();
  }

  public destroy(): void {
    this.destroyed = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.teardown();
  }

  private teardown(): void {
    this.skeleton?.root.remove();
    this.skeleton = null;
    this.status?.remove();
    this.status = null;
    this.args.wrapper.removeAttribute(DATA_ATTR.loading);
    this.args.wrapper.removeAttribute('aria-busy');
  }
}
```

Note: `performance.now()` is faked by `vi.useFakeTimers()` in Vitest's default `toFake` list. Verify this when Step 4 runs. If the MIN_VISIBLE test fails because of it, inject `now: () => number` instead of guessing.

- [ ] **Step 4: Run and pass.** Run the same test file. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/loading-controller.ts test/unit/components/utils/loading-controller.test.ts
git commit -m "feat(loader): controller with show delay, minimum visibility and teardown"
```

---

### Task 6: i18n key `a11y.loadingContent`

**Files:** all 71 `src/components/i18n/locales/*.json`, the ledger `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md` (digests and any retention rows), `test/unit/components/i18n/untranslated-strings.test.ts` (`COGNATE_RETENTIONS` only if a value equals English), `lifecycle-coverage.test.ts` (counts), and `types/message-keys.d.ts` (regenerate).

**Interfaces:**
- Produces: `I18n.t('a11y.loadingContent')`. English value is `"Loading content…"` (U+2026 ellipsis).

- [ ] **Step 1: Write the failing test.** Add the key to `en.json` only, at the end of the `a11y.*` run. Then run `yarn test test/unit/components/i18n/`. Expected: FAIL in the completeness, lifecycle-count and message-keys parity checks. This is the failing state.
- [ ] **Step 2: Draft translations.** Load the `blok-translations` skill. Follow memory `i18n-new-key-checklist`: these are flat `locales/<code>.json` files, not `messages.json`. Use 5 parallel subagents by locale group that write only scratch JSON (`{ "<code>": "<value>" }`), then apply with one node script that inserts after the same anchor key as in `en`. Reuse each locale's existing loading wording if one exists: grep the locale files for keys containing "load" first.
- [ ] **Step 3: Update the pins.** Rewrite both ledger digest columns per locale. Add retention rows plus `COGNATE_RETENTIONS` entries for any value identical to English. Bump the `lifecycle-coverage.test.ts` counts. The key is referenced as a string literal in src (Task 7), so it classifies as executable-literal. Run `node scripts/generate-message-keys-dts.mjs`.
- [ ] **Step 4: Run and pass.** Run `yarn test test/unit/components/i18n/` and `yarn i18n:check`. Expected: PASS. If `lifecycle-coverage` was already red on origin (see memory), confirm with `git stash`-free evidence (run it on a clean `git worktree` of HEAD) before claiming it is pre-existing.
- [ ] **Step 5: Commit** with `git add src/components/i18n/locales docs/plans/2026-07-19-all-locales-translation-audit-ledger.md test/unit/components/i18n types/message-keys.d.ts` and `git commit -m "feat(i18n): a11y.loadingContent in every locale"`.

---

### Task 7: UI owns the controller; persistence path in `Core.render()`

The UI methods have no caller until `Core.render()` uses them, so both land together and are tested through a real boot. Tests never reach into module internals.

**Files:**
- Modify: `src/components/modules/ui.ts`. Add a field, two public methods, and a line in `destroy()` (~566).
- Modify: `src/components/core.ts`, the `load()` branch of `render()` (~478)
- Test: `test/unit/blok-boot-loader.test.ts` (new; same harness as `test/unit/blok-boot-persistence.test.ts`)

**Interfaces:**
- Consumes: `LoadingController` (T5), `resolveLoaderConfig` (T1), `I18n.t('a11y.loadingContent')` (T6).
- Produces: `UI.showLoading(): void` and `UI.hideLoading(): Promise<void>`. `hideLoading` collects targets itself. `UI.destroy()` destroys the controller. Task 8 calls these.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Paragraph } from '../../src/tools/paragraph';
import type { OutputData } from '../../types';

const SKELETON = '[data-blok-loading-skeleton]';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void }

/** Records whether a skeleton was EVER mounted, so a fast path cannot hide a flash. */
const watchForSkeleton = (root: HTMLElement): { seen: () => boolean; stop: () => void } => {
  let seen = false;
  const observer = new MutationObserver((records) => {
    seen ||= records.some(record => [...record.addedNodes].some(node => node instanceof Element && (node.matches(SKELETON) || node.querySelector(SKELETON) !== null)));
  });

  observer.observe(root, { childList: true, subtree: true });

  return { seen: () => seen, stop: () => observer.disconnect() };
};

const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

  return { promise, resolve, reject };
};

describe('boot skeleton (persistence)', () => {
  let holder: HTMLDivElement;
  const editors: TestEditor[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const boot = async (config: Record<string, unknown>, target: HTMLElement = holder): Promise<TestEditor> => {
    const { Blok } = await import('../../src/blok');
    const editor = new Blok({ holder: target, tools: { paragraph: Paragraph }, ...config }) as unknown as TestEditor;

    editors.push(editor);

    return editor;
  };

  const wrapperOf = (root: HTMLElement): Element | null => root.querySelector('[data-blok-editor]');

  it('shows the skeleton while load() is slow; isReady waits for the handoff', async () => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    expect(wrapperOf(holder)?.getAttribute('aria-busy')).toBe('true');

    load.resolve({ blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] });
    await editor.isReady;

    expect(holder.querySelector(SKELETON)).toBeNull();
    expect(wrapperOf(holder)?.hasAttribute('aria-busy')).toBe(false);
    expect(holder.textContent).toContain('Hi');
  }, 120_000);

  it('never mounts a skeleton when data is passed directly', async () => {
    const watch = watchForSkeleton(holder);
    const editor = await boot({ loader: { delay: 0 }, data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hi' } }] } });

    await editor.isReady;
    watch.stop();

    expect(watch.seen()).toBe(false);
  }, 120_000);

  it('never mounts a skeleton with loader: false', async () => {
    const watch = watchForSkeleton(holder);
    const load = deferred<OutputData>();
    const editor = await boot({ loader: false, persistence: { load: () => load.promise, save: async () => {} } });

    await new Promise(resolve => setTimeout(resolve, 20));
    load.resolve({ blocks: [] });
    await editor.isReady;
    watch.stop();

    expect(watch.seen()).toBe(false);
    expect(wrapperOf(holder)?.hasAttribute('aria-busy')).toBe(false);
  }, 120_000);

  it('load() resolving null hands off to the default block', async () => {
    const load = deferred<OutputData | null>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    load.resolve(null);
    await editor.isReady;

    expect(holder.querySelector(SKELETON)).toBeNull();
    expect(holder.querySelectorAll('[data-blok-element]').length).toBe(1);
  }, 120_000);

  it('a rejected load removes the skeleton and isReady still rejects', async () => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());
    load.reject(new Error('endpoint down'));

    await expect(editor.isReady).rejects.toThrow('endpoint down');
    expect(holder.querySelector(SKELETON)).toBeNull();
    expect(wrapperOf(holder)?.hasAttribute('aria-busy')).toBe(false);
  }, 120_000);

  it('marks only the loading editor busy when two share a page', async () => {
    const other = document.createElement('div');

    document.body.appendChild(other);
    const load = deferred<OutputData>();
    const loading = await boot({ loader: { delay: 0 }, persistence: { load: () => load.promise, save: async () => {} } });
    const ready = await boot({ data: { blocks: [] } }, other);

    await ready.isReady;
    await vi.waitFor(() => expect(holder.querySelector(SKELETON)).not.toBeNull());

    expect(wrapperOf(other)?.hasAttribute('aria-busy')).toBe(false);
    expect(other.querySelector(SKELETON)).toBeNull();

    load.resolve({ blocks: [] });
    await loading.isReady;
  }, 120_000);

  it('destroy() mid-load leaves an empty holder and no late skeleton', async () => {
    const load = deferred<OutputData>();
    const editor = await boot({ loader: { delay: 50 }, persistence: { load: () => load.promise, save: async () => {} } });

    await vi.waitFor(() => expect(wrapperOf(holder)).not.toBeNull());
    editor.destroy();
    editors.splice(editors.indexOf(editor), 1);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(holder.childElementCount).toBe(0);
    expect(holder.querySelector(SKELETON)).toBeNull();
  }, 120_000);
});
```

The `destroy()`-mid-load test leaves an unresolved `isReady`. If Vitest reports it as an unhandled rejection (see memory `stryker-crash-means-unhandled-test-error`), resolve `load` after destroy and `await editor.isReady.catch(() => {})`. Do not suppress the error globally.

- [ ] **Step 2: Run and fail.** Run: `yarn test test/unit/blok-boot-loader.test.ts`. Expected: tests 1, 4, 5's skeleton assertion, and 6 FAIL because no skeleton is ever mounted. Tests 2 and 3 pass. They are guards, and that is fine.

- [ ] **Step 3: Implement**

`ui.ts`:

```ts
  private loading: LoadingController | null = null;

  /** Starts the boot skeleton; it appears only if the wait outlasts `loader.delay`. */
  public showLoading(): void {
    this.loading ??= new LoadingController({
      wrapper: this.nodes.wrapper,
      content: this.nodes.redactor,
      config: resolveLoaderConfig(this.config.loader),
      label: this.Blok.I18n.t('a11y.loadingContent'),
    });
    this.loading.show();
  }

  /** Hands the skeleton off to the blocks now in the redactor. */
  public async hideLoading(): Promise<void> {
    await this.loading?.hide(this.Blok.BlockManager.blocks.map(block => block.holder));
  }
```

In `ui.ts` `destroy()`, before `this.nodes.holder.innerHTML = ''`, add `this.loading?.destroy();` and `this.loading = null;`.

`core.ts` `render()`. Wrap only the `load()` branch. The existing body of the first `then` is unchanged:

```ts
    const { UI } = this.moduleInstances;

    UI.showLoading();

    return load().then((result) => {
      // ...existing body unchanged...
    }).then(
      () => UI.hideLoading(),
      async (error: unknown) => {
        await UI.hideLoading();
        throw error;
      }
    );
```

- [ ] **Step 4: Run and pass.** Run the new file and `yarn test test/unit/blok-boot-persistence.test.ts test/unit/components/core-persistence-data-gate.test.ts test/unit/components/core.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/ui.ts src/components/core.ts test/unit/blok-boot-loader.test.ts
git commit -m "feat(loader): skeleton while persistence.load() is pending"
```

---

### Task 8: Collaboration path

**Files:**
- Modify: `src/components/modules/collaboration/index.ts`. `load()` (~708), `handleStatus()` (~1221, the `isFirstSync` branch ~1278 and the offline/error branch ~1284), and `destroy`.
- Test: add to the existing collaboration unit suite. Find it with `ls test/unit/components/modules/collaboration/` and use its fake-provider harness. Do not build a new one.

**Interfaces:**
- Consumes: `UI.showLoading()` and `UI.hideLoading()` (T7).

Rules:
- In `load()`, call `this.Blok.UI.showLoading()` after `adoptCache` **only if** `!this.cacheAdopted`. An adopted cache has already rendered a document. Check this in the code: read `adoptCache` to confirm it renders blocks before `load()` returns. If it does not, call `hideLoading()` where it does render.
- `isFirstSync` branch: after `this.seedEmptyDocument()`, call `void this.Blok.UI.hideLoading()`.
- Offline/error branch: after `await this.renderLastKnown()`, call `void this.Blok.UI.hideLoading()`. An editor that degrades to last-known (or stays empty and read-only on error) must not spin forever.
- `isReady` must NOT wait on any of this. That is the existing "readiness must not wait on the network" law in `load()`'s doc comment.

- [ ] **Step 1: Write the failing tests.** Use the suite's fake provider:
  1. Before `connected` (delay 0), the skeleton is present and `isReady` has already resolved.
  2. After `connected` with remote blocks, the skeleton is gone and the blocks are visible.
  3. `error` with no last-known: the skeleton is gone.
  4. A cache-adopted boot never shows the skeleton.
- [ ] **Step 2: Run and fail.** Run the scoped collab test file. Expected: 1, 2 and 3 FAIL.
- [ ] **Step 3: Implement** the four call sites above.
- [ ] **Step 4: Run and pass.** Run that file and every other file under `test/unit/components/modules/collaboration/` that the grep shows imports `collaboration/index`.
- [ ] **Step 5: Commit** with the message `feat(loader): skeleton until the first collaboration sync`.

---

### Task 9: E2E + playground toggle

**Files:**
- Create: `test/playwright/tests/ui/loading-skeleton.spec.ts`. Copy the `resetBlok`/`createBlok` page-evaluate pattern from `test/playwright/tests/ui/ui-module.spec.ts:40-100`.
- Modify: `index.html`, `buildConfig()` (~1476–1590)

- [ ] **Step 1: Write the failing e2e**

```ts
const bootSlow = async (page: Page, extra: Record<string, unknown> = {}): Promise<void> => {
  await gotoTestPage(page);
  await resetBlok(page); // copied from ui-module.spec.ts:40
  await page.evaluate(({ holder, extraConfig }) => {
    let release: (v: unknown) => void = () => {};

    window.releaseLoad = (): void => release({ blocks: [{ id: 'x', type: 'paragraph', data: { text: 'Loaded text' } }] });
    window.blokInstance = new window.Blok({
      holder,
      loader: { delay: 0 },
      ...extraConfig,
      persistence: { load: () => new Promise((r) => { release = r; }), save: async () => {} },
    });
  }, { holder: HOLDER_ID, extraConfig: extra });
};

test('skeleton shows during a slow load, then hands off to editable content', async ({ page }) => {
  await bootSlow(page);

  await expect(page.getByTestId('loading-skeleton')).toBeVisible();
  await page.evaluate(() => window.releaseLoad());
  await expect(page.getByTestId('loading-skeleton')).toHaveCount(0);
  await expect(page.getByText('Loaded text')).toBeVisible();
  await page.getByText('Loaded text').click();
  await page.keyboard.type('!');
  await expect(page.getByText('Loaded text!')).toBeVisible();
});

test('reduced motion: bars do not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootSlow(page);
  const name = await page.locator('[data-blok-skeleton-bar]').first().evaluate(el => getComputedStyle(el).animationName);
  expect(name).toBe('none');
});

test('read-only boot also hands off and stays read-only', async ({ page }) => {
  await bootSlow(page, { readOnly: true });
  await expect(page.getByTestId('loading-skeleton')).toBeVisible();
  await page.evaluate(() => window.releaseLoad());
  await expect(page.getByTestId('loading-skeleton')).toHaveCount(0);
  await expect(page.getByText('Loaded text')).toBeVisible();
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
});
```

Declare `releaseLoad` on `window` the way the other specs declare `blokInstance`.

- [ ] **Step 2: Run and fail.** Run: `yarn e2e test/playwright/tests/ui/loading-skeleton.spec.ts`. Expected: FAIL if run against a pre-Task-7 build. Since Tasks 7 and 8 are done, record that it passes, and also confirm it FAILS with `loader: false` patched in temporarily. That proves the spec checks the skeleton.
- [ ] **Step 3: Playground.** In `index.html` `buildConfig()`, when `new URLSearchParams(location.search).get('slowLoad')` is a positive number and `collaboration === null`, replace `{ data: ... }` with:

```js
{ persistence: { load: () => new Promise(r => setTimeout(() => r({ blocks: blocksFor(pageId) }), slowLoadMs)), save: async () => {} } }
```

- [ ] **Step 4: Look at it.** Use the `verify` skill (playwright-cli, reusing an open session per CLAUDE.md). Open `/?slowLoad=2500` in light and dark, at DPR 1 and 2, and with reduced motion. Take screenshots during the wait and record a frame sequence of the handoff. Check:
  - the sheen reads as one band
  - no blue
  - bars land on the real lines
  - no layout jump after the overlay is removed
  - RTL (`state.rtl`) mirrors the bars

  Fix anything found in Task 3's CSS with a test first.
- [ ] **Step 5: Commit** the spec and `index.html` with the message `test(loader): e2e for the boot skeleton; playground ?slowLoad`.

---

### Task 10: Final gates and landing

- [ ] Run the related unit tests: every test file created or modified above, plus `test/unit/styles/`, `test/unit/architecture/published-types-no-src-refs.test.ts`, and `test/unit/components/i18n/`. Per memory `run-only-related-tests`, do not run the full suite unless the user asks. Note the CLAUDE.md final-gate conflict in the report.
- [ ] Run `yarn lint` scoped to the changed files (`npx eslint <files>`) and `tsc` (memory: needs an 8 GB heap).
- [ ] Run the `refactor:refactor` and `verification:final-verification` skills.
- [ ] Run `git pull --rebase` and then `git push`. Check that `git status` says "up to date with origin".
- [ ] The final report names the new public surface. It is additive, not breaking: the `loader` config key, 3 CSS tokens, 3 data attributes, and 1 i18n key. A release note is owed. Also report the per-block reveal follow-up from Task 4.
