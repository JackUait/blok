# Root Popover Boundary Design

## Problem

Body-mounted Blok popovers use `document.body.getBoundingClientRect()` as their default collision boundary. That assumes the body always describes the visible viewport. Host applications can legitimately give the body a fixed viewport height while allowing document scrolling, for example `body { height: 100vh }`.

Once such a document scrolls, the body's viewport-relative rectangle moves above the viewport. Blok intersects that stale rectangle with the viewport and can produce an inverted boundary whose bottom is above its top. The block-settings menu is then clamped to the boundary floor instead of staying beside its trigger. In the reported article, a bookmark trigger near the bottom of the viewport produced a menu at `y = 50` near the top.

This affects every root `PopoverDesktop` consumer that relies on the implicit body boundary, including block settings, code-language menus, database menus, table menus, and link-paste menus. It is not specific to bookmarks.

## Confirmed Root Cause

The production host sets `body { height: 100vh }`. A Chromium reproduction using the same rule and a deeply scrolled Blok instance measured:

- `window.scrollY = 1820`
- trigger top at approximately `468px` in viewport coordinates
- body rectangle from approximately `-1799px` through `-1079px`
- popover clamped to `50px`, matching the configured viewport margin

The anchor rectangle and document-coordinate conversion were correct. The invalid input was the implicit body collision boundary.

## Design

Add one shared boundary resolver to the anchored-positioning module:

- `undefined`, `document.body`, and `document.documentElement` resolve to the live viewport rectangle `[0, 0, innerWidth, innerHeight]`.
- Explicit non-root `Element` boundaries continue to use their live `getBoundingClientRect()` values.
- Explicit `DOMRect` boundaries remain unchanged.

`PopoverDesktop` will use this shared resolver instead of calling `scopeElement.getBoundingClientRect()` directly. The existing `positionAnchored` engine will use the same resolver, preventing the root-boundary bug from reappearing in newer anchored surfaces.

The position engine remains document-coordinate based. No per-consumer offsets, article-specific CSS exceptions, or fixed-position migration are introduced.

## Safety and Edge Cases

- Explicit editor/table/dialog scopes retain their current clipping semantics.
- Root aliases are based on identity, not computed CSS, so host styles cannot alter the contract.
- The live viewport is recalculated on every positioning pass; resize and ancestor-scroll tracking continue to work.
- Both `body` and `html` are normalized so callers cannot accidentally reintroduce the same defect by switching root elements.
- The existing hidden-trigger captured-rectangle fallback remains intact and is exercised together with deep scrolling.

## Regression Coverage

1. Unit tests prove that absent, body, and document-element boundaries resolve to the viewport while explicit element and rect boundaries remain unchanged.
2. `PopoverDesktop` unit coverage proves its implicit scope delegates to the normalized boundary.
3. A Playwright regression recreates the reported host conditions: `body { height: 100vh }`, content far below the fold, non-zero document scrolling, a block-settings trigger that becomes hidden when the menu opens, and a tall menu. It asserts that the menu stays adjacent to the trigger and fully within the viewport.
4. The browser regression is categorized as cross-browser because scroll geometry and the HTML Popover top layer are browser-sensitive.

## Rejected Alternatives

- Changing the Knowledge Base body CSS would hide the defect only in one consumer.
- Adding bookmark-specific or block-settings-specific offsets would patch the symptom and leave other popovers broken.
- Converting the entire floating layer to fixed coordinates would be a larger architectural migration with unnecessary regression risk for this defect.
