# Floating Positioning Invariant Audit Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove every Blok floating surface remains anchored under root and nested scrolling, and make future bypasses of the safe positioning contract fail in CI.

**Architecture:** Treat floating positioning as a coordinate-space contract, not a bookmark-specific behavior. Inventory every root-mounted, top-layer, fixed, absolute, and locally-contained surface; route document-coordinate anchored surfaces through the shared engine; preserve viewport-coordinate fixed surfaces; and add an architecture law that detects new ad-hoc document positioning before it ships.

**Tech Stack:** TypeScript, Vitest/jsdom, Playwright Chromium/Firefox/WebKit, HTML Popover top layer, CSS fixed/absolute positioning.

**Repository constraint:** Execute directly on the existing `master` branch. Do not create a branch or worktree.

---

### Task 1: Build an authoritative floating-surface inventory

**Files:**
- Inspect: `src/components/utils/popover/**`
- Inspect: `src/components/utils/tooltip.ts`
- Inspect: `src/components/utils/link-hover-card.ts`
- Inspect: `src/tools/**`
- Create: `docs/plans/2026-07-17-floating-positioning-inventory.md`

**Steps:**

1. Search every call to `getBoundingClientRect`, `positionAnchored`, `resolvePosition`, `style.top`, and `style.left`.
2. For each floating surface, record its mount point, CSS positioning mode, coordinate space, boundary source, scroll/resize tracking, and whether it is root-scoped.
3. Classify each path as shared-engine safe, independently viewport-safe, locally-contained, or unsafe/unproven.
4. Confirm the inventory is non-vacuous with source paths for every `PopoverDesktop` consumer and every ad-hoc root-mounted surface.

### Task 2: Trace and test the complete root-boundary matrix

**Files:**
- Modify: `test/unit/utils/anchored-position-boundary.test.ts`
- Modify: `test/unit/utils/popover-desktop.test.ts`

**Steps:**

1. Add table-driven coverage for omitted boundary, `body`, `documentElement`, explicit `DOMRect`, and explicit non-root `Element`.
2. Exercise vertical (`top`/`bottom`) and horizontal (`left`/`right`) placement, both axes of window scroll, roots above/left of the viewport, and boundaries smaller than the viewport.
3. Cover trigger and non-trigger `PopoverDesktop` paths, including the collapsed-trigger fallback.
4. Run the focused tests against the current implementation.
5. Mutation-check the tests by temporarily restoring direct root rect behavior; verify the root cases fail, restore the implementation, and verify green.

### Task 3: Prevent future engine bypasses

**Files:**
- Create: `test/unit/architecture/floating-positioning-law.test.ts`

**Steps:**

1. Scan production TypeScript for root-mounted floating UI and direct document-coordinate `top`/`left` writes.
2. Require document-coordinate anchored surfaces to call `positionAnchored` or `resolveBoundaryRect`/`resolvePosition` through the approved popover module.
3. Maintain explicit, reasoned registrations for independently safe viewport-fixed or locally-contained surfaces.
4. Add non-vacuous assertions for all known floating implementations so renames or new files cannot silently escape the scan.
5. Verify the law fails when a synthetic unsafe fixture is supplied to its classifier, then verify the repository scan passes.

### Task 4: Add browser matrix coverage for host-page variants

**Files:**
- Modify: `test/playwright/tests/ui/popover-root-boundary.spec.ts`
- Modify: `playwright.config.ts` only if routing changes are required

**Steps:**

1. Parameterize the published-bookmark regression across `body`, `html`, and both-root fixed-height host CSS.
2. Cover vertical and horizontal document scrolling and a transformed/overflowing host ancestor where applicable.
3. Cover a nested scroll container to prove capture-phase tracking keeps the menu attached after it opens.
4. Assert menu/trigger alignment after opening and after subsequent scroll, plus viewport containment.
5. Run all matrix cases in Chromium, Firefox, and WebKit.

### Task 5: Repair any unsafe paths found by the audit

**Files:**
- Determined by Tasks 1–4

**Steps for each finding:**

1. Write the smallest failing unit or browser regression.
2. Run it and capture the wrong coordinate.
3. Fix the earliest shared source of the invalid coordinate-space assumption.
4. Run the new test and neighboring surface tests.
5. Commit the isolated repair.

### Task 6: Final proof and completion audit

**Steps:**

1. Run focused geometry and architecture tests.
2. Run `yarn test`.
3. Run `yarn lint`.
4. Run `yarn build:test`.
5. Run the cross-browser host/root matrix and nearby popover, tooltip, image-alt, audio-cover, database, table, and link-paste browser suites.
6. Mutation-check the central root normalization and the architecture classifier.
7. Run `git diff --check`, inspect the complete diff, and confirm the working tree contains no unintended changes.
8. Map every inventory row and audit requirement to direct test or source evidence; keep the goal active for any unsafe or unproven row.
