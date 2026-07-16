# Root Popover Boundary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep every root Blok popover beside its anchor on scrolled host pages, even when `body` or `html` has a fixed viewport-sized box.

**Architecture:** Normalize implicit root collision boundaries at the shared anchored-positioning layer: absent, `body`, and `documentElement` boundaries represent the live viewport, while explicit non-root elements and `DOMRect`s retain their current semantics. Route `PopoverDesktop` through the same resolver and pin the production failure with a cross-browser deep-scroll regression.

**Tech Stack:** TypeScript, Vitest/jsdom, Playwright (Chromium/Firefox/WebKit), Blok `PopoverDesktop`, and the HTML Popover top layer.

---

### Task 1: Add failing shared-boundary unit regressions

**Files:**
- Modify: `test/unit/utils/anchored-position-boundary.test.ts`

**Step 1: Write the failing tests**

Use the existing public `positionAnchored` API. Add cases for `document.body` and `document.documentElement` whose mocked rectangles are scrolled completely above the viewport. Set `window.scrollY = 1800`, use a 298×368 content box and an anchor at viewport `top=468, bottom=492`, then use horizontal/centered placement (the same cross-axis behavior as block settings) to assert root boundaries behave exactly like the live 1024×720 viewport. Add a non-root element case proving its own rectangle remains the boundary.

```ts
it.each([
  ['body', () => document.body],
  ['document element', () => document.documentElement],
] as const)('treats the %s boundary as the live viewport', (_label, getBoundary) => {
  const content = document.createElement('div');

  stubSize(content, 298, 368);
  document.body.appendChild(content);
  vi.spyOn(getBoundary(), 'getBoundingClientRect').mockReturnValue(
    rect({ top: -1800, bottom: -1080, left: 0, right: 1024, width: 1024, height: 720 })
  );

  const anchor = rect({ top: 468, bottom: 492, left: 24, right: 42, width: 18, height: 24 });
  const resolved = positionAnchored(content, anchor, { side: 'left', boundary: getBoundary() });

  expect(resolved.top - window.scrollY).toBe(296);
});
```

Restore `scrollY` during teardown.

**Step 2: Run the tests and verify RED**

Run:

```bash
yarn vitest run --project=unit test/unit/utils/anchored-position-boundary.test.ts
```

Expected: the body/html cases fail with viewport-relative top `8` because their off-screen CSS boxes are used. Existing explicit-boundary cases remain green.

**Step 3: Commit the failing tests**

```bash
git add test/unit/utils/anchored-position-boundary.test.ts
git commit -m "test(popover): reproduce root boundary drift"
```

### Task 2: Add the failing `PopoverDesktop` regression

**Files:**
- Modify: `test/unit/utils/popover-desktop.test.ts`

**Step 1: Write the failing integration-level unit test**

Construct `PopoverDesktop` directly without `scopeElement`, so its actual implicit body boundary is exercised. Combine the article's deep scroll with the existing hidden-trigger fallback:

```ts
it('keeps a body-scoped menu centered on its hidden trigger after deep document scrolling', () => {
  const trigger = document.createElement('button');
  const liveRectSpy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
    createRect({ top: 468, bottom: 492, left: 24, right: 42, width: 18, height: 24 })
  );

  document.body.appendChild(trigger);
  vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(
    createRect({ top: -1800, bottom: -1080, left: 0, right: 1024, width: 1024, height: 720 })
  );

  const popover = new PopoverDesktop({
    trigger,
    items: createDefaultItems(),
    placeLeftOfAnchor: true,
    viewportMargin: 50,
  });
  const instance = popover as unknown as PopoverDesktopInternal;

  vi.spyOn(instance, 'size', 'get').mockReturnValue({ height: 368, width: 298 });
  liveRectSpy.mockReturnValue(createRect({}));
  popover.show();

  expect(parseFloat(popover.getElement().style.top) - window.scrollY).toBe(296);
});
```

Temporarily set `innerWidth=1024`, `innerHeight=720`, `scrollX=0`, and `scrollY=1800`, restoring all four properties in `finally`.

**Step 2: Run the test and verify RED**

```bash
yarn vitest run --project=unit test/unit/utils/popover-desktop.test.ts -t "body-scoped menu"
```

Expected: FAIL with actual viewport-relative top `50`, proving the implicit body scope clamps to the wrong boundary.

**Step 3: Commit the failing test**

```bash
git add test/unit/utils/popover-desktop.test.ts
git commit -m "test(popover): cover scrolled body scope"
```

### Task 3: Add the failing real-browser article-shape regression

**Files:**
- Create: `test/playwright/tests/ui/popover-root-boundary.spec.ts`
- Modify: `playwright.config.ts:75-84`

**Step 1: Write the browser test**

Create a Blok instance below the fold under the exact host invariant `body { height: 100vh }`, scroll it into the viewport, open block settings, and compare the pre-click trigger center to the menu center:

```ts
import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.describe('root popover boundary', () => {
  test.beforeAll(() => ensureBlokBundleBuilt());

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('keeps block settings beside a deep block when body is only 100vh tall', async ({ page }) => {
    await page.addStyleTag({
      content: 'html, body { margin: 0 } body { height: 100vh } #blok { padding-top: 2200px; padding-bottom: 1200px }',
    });
    await page.evaluate(async () => {
      const holder = document.createElement('div');

      holder.id = 'blok';
      document.body.appendChild(holder);
      const blok = new window.Blok({
        holder: 'blok',
        data: { blocks: [{ id: 'deep-block', type: 'paragraph', data: { text: 'Deep target' } }] },
      });

      window.blokInstance = blok;
      await blok.isReady;
    });

    const block = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`);

    await block.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await block.click();

    const trigger = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`);
    const triggerBox = await trigger.boundingBox();

    expect(triggerBox).not.toBeNull();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await trigger.click();

    const menu = page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]');

    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();

    expect(menuBox).not.toBeNull();
    expect(Math.abs(
      (menuBox?.y ?? 0) + (menuBox?.height ?? 0) / 2
      - ((triggerBox?.y ?? 0) + (triggerBox?.height ?? 0) / 2)
    )).toBeLessThanOrEqual(2);
    expect(menuBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(720);
  });
});
```

Add `**/ui/popover-root-boundary.spec.ts` to `CROSS_BROWSER_TESTS` because top-layer and scrolling geometry are browser-sensitive.

**Step 2: Verify project routing**

```bash
yarn playwright test test/playwright/tests/ui/popover-root-boundary.spec.ts --list
```

Expected: exactly three tests, one in each of `chromium`, `firefox`, and `webkit`; none in `chromium-default` or `chromium-logic`.

**Step 3: Run Chromium and verify RED**

```bash
BLOK_BUILT=true yarn playwright test test/playwright/tests/ui/popover-root-boundary.spec.ts --project=chromium --workers=1
```

Expected: FAIL because the menu center is near the viewport top while the trigger center is near the middle.

**Step 4: Commit the failing browser regression**

```bash
git add playwright.config.ts test/playwright/tests/ui/popover-root-boundary.spec.ts
git commit -m "test(popover): cover 100vh host body"
```

### Task 4: Implement the shared root-boundary normalization

**Files:**
- Modify: `src/components/utils/popover/anchored-position.ts:63-107`
- Modify: `src/components/utils/popover/popover-desktop.ts:14-16,511-521,554-590`

**Step 1: Export and harden the shared resolver**

```ts
export function resolveBoundaryRect(
  boundary: Element | DOMRect | undefined,
  viewportSize: { width: number; height: number }
): DOMRect {
  const isDocumentRoot = boundary === undefined
    || boundary === document.body
    || boundary === document.documentElement;

  if (!isDocumentRoot) {
    return toRect(boundary);
  }

  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: viewportSize.width,
    bottom: viewportSize.height,
    width: viewportSize.width,
    height: viewportSize.height,
    toJSON: () => ({}),
  };
}
```

Document why root CSS boxes cannot define the live collision viewport.

**Step 2: Route `PopoverDesktop` through the resolver**

Import `resolveBoundaryRect` beside `createPositionTracker`. In both `applyNonTriggerPosition()` and `calculatePosition()`, calculate once:

```ts
const viewportSize = { width: window.innerWidth, height: window.innerHeight };
const scopeBounds = resolveBoundaryRect(this.scopeElement, viewportSize);
```

Pass `scopeBounds` and `viewportSize` to the existing `resolvePosition()` call. Do not alter trigger capture, document-coordinate conversion, explicit-position precedence, place-left behavior, or position tracking.

**Step 3: Run focused unit tests and verify GREEN**

```bash
yarn vitest run --project=unit test/unit/utils/anchored-position-boundary.test.ts test/unit/utils/popover-desktop.test.ts
```

Expected: all focused tests pass.

**Step 4: Build and run the Chromium regression**

```bash
yarn build:test
BLOK_BUILT=true yarn playwright test test/playwright/tests/ui/popover-root-boundary.spec.ts --project=chromium --workers=1
```

Expected: PASS; trigger/menu centers differ by at most 2px and the menu remains in the viewport.

**Step 5: Commit the implementation**

```bash
git add src/components/utils/popover/anchored-position.ts src/components/utils/popover/popover-desktop.ts
git commit -m "fix(popover): normalize root boundaries"
```

### Task 5: Verify broad behavior and the reported article shape

**Files:**
- No new files expected

**Step 1: Run the complete unit suite**

```bash
yarn test
```

Expected: exit 0 with zero failed tests.

**Step 2: Run static validation**

```bash
yarn lint
```

Expected: ESLint and TypeScript both exit 0.

**Step 3: Run the cross-browser root regression**

```bash
BLOK_BUILT=true yarn playwright test test/playwright/tests/ui/popover-root-boundary.spec.ts --workers=1
```

Expected: all three browser projects pass.

**Step 4: Re-run nearby popover suites under their configured projects**

Use `--list` to confirm routing, then run `ui/block-tunes.spec.ts` and `ui/tooltip-scroll-anchoring.spec.ts` with one worker. Expected: all selected tests pass.

**Step 5: Verify the supplied article geometry**

Open the article through the requested browser extension or its local Knowledge Base consumer, scroll to “Рецепты прямоугольной пиццы кусочками,” open the bookmark menu, and capture the scroll position plus trigger/menu rectangles. The menu must remain adjacent to the trigger and fully inside the viewport, not at `y=50`. If production still serves the released package, distinguish local-source verification from deployment state.

**Step 6: Audit final state**

```bash
git diff --check HEAD~4..HEAD
git status --short --branch
git log -5 --oneline
```

Expected: no whitespace errors; only the user's pre-existing unrelated release-script work remains uncommitted.
