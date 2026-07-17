# Floating Positioning Recurrence Proof Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every virtual popover anchor declare a live lifecycle, repair link-paste nested-scroll tracking, replace evadable regex enforcement with syntax-aware analysis, and prove the complete coordinate-space invariant across all supported browsers.

**Architecture:** Keep the shared anchored-position engine and add two defenses around it. A discriminated public type plus runtime fail-closed behavior makes every virtual anchor explicitly tracked or intentionally dismissible; a TypeScript-AST evidence analyzer makes new root mounts and manual coordinate paths enter an exact CI inventory even through common alias and computed-property forms.

**Tech Stack:** TypeScript 5.9 compiler API, Vitest/jsdom, Playwright Chromium/Firefox/WebKit, package declaration fixtures.

**Repository constraint:** Execute directly on the existing `master` branch. Do not create a branch, worktree, detached checkout, or sub-agent.

---

### Task 1: Reproduce and close the virtual-anchor lifecycle gap

**Files:**
- Create: `test/unit/tools/link/paste-menu-controller.test.ts`
- Create: `test/unit/types/popover-virtual-position-typecheck.ts`
- Modify: `types/utils/popover/popover.d.ts`
- Modify: `src/components/utils/popover/popover-desktop.ts`
- Modify: `src/components/modules/toolbar/blockSettings.ts`
- Modify: `src/components/ui/toolbox.ts`
- Modify: `src/tools/link/paste-menu/controller.ts`
- Modify: `test/unit/utils/popover-desktop.test.ts`
- Modify: `test/unit/utils/popover-desktop-tracker.test.ts`
- Modify any additional call site reported by `tsc`

**Step 1: Write the failing link-paste lifecycle test**

Create a real `PasteMenuController`, put its trigger inside a nested scroller,
mock the trigger rectangle, and open it with a virtual position. Move the
trigger rectangle by 40 pixels, dispatch `scroll` on the nested scroller, and
assert that the open popover still exists and its `top` moves by 40 pixels.

The key assertion shape is:

```ts
expect(openPopover?.style.top).toBe('134px');
triggerRectSpy.mockReturnValue(createRect({ top: 50, bottom: 250, left: 40, right: 440 }));
scroller.dispatchEvent(new Event('scroll'));
expect(document.querySelector<HTMLElement>('[data-blok-popover-opened]')?.style.top).toBe('94px');
```

Use the real controller and popover; mock only geometry unavailable in jsdom.

**Step 2: Write the failing public type fixture**

Declare accepted `PopoverParams` values for ordinary trigger placement,
`position + positionContext`, and
`position + positionLifecycle: 'dismiss-on-nested-scroll'`. Add
`@ts-expect-error` cases for:

```ts
const missingLifecycle: PopoverParams = { items, position };
const orphanContext: PopoverParams = { items, positionContext };
const conflictingLifecycle: PopoverParams = {
  items,
  position,
  positionContext,
  positionLifecycle: 'dismiss-on-nested-scroll',
};
```

**Step 3: Run both tests and record RED**

Run:

```bash
npx vitest run --project=unit test/unit/tools/link/paste-menu-controller.test.ts
yarn lint:types
```

Expected:

- controller test fails because nested scrolling closes/destroys the
  position-only popover;
- `tsc` reports unused `@ts-expect-error` directives because position-only
  parameters are still accepted.

**Step 4: Implement the discriminated public contract**

Keep the existing fields in a `PopoverParamsBase` interface and export:

```ts
export type PopoverPositionLifecycle = 'dismiss-on-nested-scroll';

type PopoverWithoutVirtualPosition = {
  position?: never;
  positionContext?: never;
  positionLifecycle?: never;
};

type PopoverTrackedVirtualPosition = {
  position: DOMRect;
  positionContext: HTMLElement;
  positionLifecycle?: never;
};

type PopoverDismissibleVirtualPosition = {
  position: DOMRect;
  positionContext?: never;
  positionLifecycle: PopoverPositionLifecycle;
};

export type PopoverParams = PopoverParamsBase & (
  | PopoverWithoutVirtualPosition
  | PopoverTrackedVirtualPosition
  | PopoverDismissibleVirtualPosition
);
```

Export an update choice with the same invariant:

```ts
export type PopoverPositionUpdate =
  | { positionContext: HTMLElement; positionLifecycle?: never }
  | { positionContext?: never; positionLifecycle: PopoverPositionLifecycle };
```

**Step 5: Apply the same contract at runtime**

Change `updatePosition(position, choice)` so a tracked choice installs the new
context and a dismissible choice clears any previous context. Do not retain the
old optional second argument because it permits accidental lifecycle omission.
Keep constructor behavior fail-closed when untyped JavaScript supplies
`position` without either discriminator.

**Step 6: Migrate all typed callers**

- `blockSettings`: conditionally spread `{ position, positionContext:
  block.holder }` only when its anchor rect exists.
- `toolbox`: call
  `updatePosition(anchorRect, { positionContext: currentBlock.holder })`; handle
  a missing current block by explicitly choosing dismissal or by not updating,
  according to the existing control flow.
- `PasteMenuController`: when `params.position` and `params.trigger` both
  exist, pass both as `position` and `positionContext`. If a virtual position
  can exist without a trigger, declare
  `positionLifecycle: 'dismiss-on-nested-scroll'`.
- Position-only tests: explicitly declare dismissal.
- Contextual tracker tests: remove obsolete casts and use the tracked shape.

**Step 7: Run GREEN**

Run:

```bash
npx vitest run --project=unit \
  test/unit/tools/link/paste-menu-controller.test.ts \
  test/unit/utils/popover-desktop-tracker.test.ts \
  test/unit/utils/popover-desktop.test.ts \
  test/unit/components/modules/toolbar/blockSettings.test.ts \
  test/unit/components/modules/paste/pattern-handler-link-menu.test.ts
yarn lint:types
```

Expected: all focused tests pass and `tsc` emits no diagnostics.

**Step 8: Commit**

```bash
git add types/utils/popover/popover.d.ts \
  src/components/utils/popover/popover-desktop.ts \
  src/components/modules/toolbar/blockSettings.ts \
  src/components/ui/toolbox.ts \
  src/tools/link/paste-menu/controller.ts \
  test/unit/tools/link/paste-menu-controller.test.ts \
  test/unit/types/popover-virtual-position-typecheck.ts \
  test/unit/utils/popover-desktop.test.ts \
  test/unit/utils/popover-desktop-tracker.test.ts
git commit -m "fix(popover): require virtual anchor lifecycle"
```

### Task 2: Build the syntax-aware evidence analyzer test-first

**Files:**
- Create: `test/unit/architecture/floating-positioning-analyzer.ts`
- Create: `test/unit/architecture/floating-positioning-analyzer.test.ts`

**Step 1: Define the evidence API with a deliberately empty implementation**

```ts
export type FloatingEvidenceKind =
  | 'root-mount'
  | 'root-geometry-read'
  | 'geometry-read'
  | 'coordinate-write'
  | 'fixed-position-signal'
  | 'top-layer-signal'
  | 'shared-position-call'
  | 'position-tracker-call'
  | 'popover-desktop-construction'
  | 'tracked-virtual-position'
  | 'dismissible-virtual-position'
  | 'unclassified-virtual-position'
  | 'dynamic-root-style-access';

export interface FloatingEvidence {
  kind: FloatingEvidenceKind;
  line: number;
  column: number;
  detail: string;
}

export const analyzeFloatingSource = (
  source: string,
  fileName = 'fixture.ts'
): FloatingEvidence[] => [];
```

**Step 2: Add adversarial table tests**

Each fixture asserts its expected evidence kind and includes a nearby safe
negative. Cover at least:

1. direct `document.body.appendChild(menu)`;
2. `const root = document.body; root.append(menu)`;
3. optional/computed `root?.['appendChild'](menu)`;
4. a local `mount(target, node)` helper called with a root alias;
5. direct and aliased root `getBoundingClientRect()`;
6. direct `.style.top` and `.style.left`;
7. `const style = menu.style; style['top'] = value`;
8. `style.setProperty('left', value)`;
9. `Object.assign(style, { top, left })`;
10. `style.cssText = 'top: 1px; left: 2px'`;
11. `menu.setAttribute('style', 'top: 1px')`;
12. dynamic computed access on a known root/style alias;
13. fixed-position and `promoteToTopLayer()` signals;
14. shared helper/tracker calls;
15. `new PopoverDesktop` with tracked, dismissible, and unclassified object
    literals;
16. TSX parsing;
17. comments and strings that mention unsafe syntax but execute nothing.

**Step 3: Run and record RED**

Run:

```bash
npx vitest run --project=unit \
  test/unit/architecture/floating-positioning-analyzer.test.ts
```

Expected: every positive fixture fails because the stub returns no evidence;
safe negative fixtures remain empty.

**Step 4: Implement conservative AST analysis**

Parse with `typescript.createSourceFile`, using `ScriptKind.TS` or
`ScriptKind.TSX`. Perform fixpoint collection for lexical aliases of roots and
style declarations. Summarize local functions/methods whose parameter receives
a mount call, then recognize calls that pass a root alias to that parameter.

Use AST node kinds and literal property names rather than source regexes.
Computed non-literal access on a known root or style alias emits
`dynamic-root-style-access`; it is never silently ignored. Record line/column
from `sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))`.
Deduplicate identical evidence by kind and source position.

**Step 5: Run GREEN and lint the analyzer**

Run:

```bash
npx vitest run --project=unit \
  test/unit/architecture/floating-positioning-analyzer.test.ts
npx eslint \
  test/unit/architecture/floating-positioning-analyzer.ts \
  test/unit/architecture/floating-positioning-analyzer.test.ts
```

Expected: all fixtures pass with no lint diagnostics.

**Step 6: Commit**

```bash
git add test/unit/architecture/floating-positioning-analyzer.ts \
  test/unit/architecture/floating-positioning-analyzer.test.ts
git commit -m "test(positioning): analyze AST bypasses"
```

### Task 3: Replace the regex architecture law

**Files:**
- Modify: `test/unit/architecture/floating-positioning-law.test.ts`

**Step 1: Write failing law assertions against AST evidence**

Replace regex discovery with `analyzeFloatingSource()` and add assertions that:

- every physical root mount is exactly classified;
- every file containing both geometry reads and coordinate writes is exactly
  classified, including locally-contained and pointer-following cases;
- root geometry reads are empty, including aliases;
- dynamic root/style access is empty;
- shared engine and tracker callers remain exact;
- every `new PopoverDesktop` consumer remains exact;
- every object-literal virtual position is tracked or explicitly dismissible;
- every reasoned classification is non-stale and meaningful.

Keep registries exact in both directions; do not use a permissive substring
allowlist.

**Step 2: Run and record RED**

Run:

```bash
npx vitest run --project=unit \
  test/unit/architecture/floating-positioning-law.test.ts
```

Expected: mismatches expose the real AST-derived inventory until every
classification is reconciled.

**Step 3: Reconcile classifications from source evidence**

Inspect every reported file. Add a classification only after checking its
mount point, coordinate space, and movement lifecycle. Repair production code
instead if a path is not independently safe.

Update the virtual-anchor law to include link paste, block settings, and
toolbox. Remove regex helpers and comment stripping completely.

**Step 4: Run GREEN**

Run:

```bash
npx vitest run --project=unit \
  test/unit/architecture/floating-positioning-analyzer.test.ts \
  test/unit/architecture/floating-positioning-law.test.ts
```

Expected: both suites pass and all exact inventories are non-vacuous.

**Step 5: Commit**

```bash
git add test/unit/architecture/floating-positioning-law.test.ts
git commit -m "test(positioning): enforce AST architecture law"
```

### Task 4: Add missing real-browser geometry evidence

**Files:**
- Modify: `test/playwright/tests/ui/popover-root-boundary.spec.ts`
- Modify: `test/playwright/tests/tools/link-paste.spec.ts`

**Step 1: Add the failing link-paste nested-scroll test before the repair if Task 1 has not run**

Place the editor inside a 360–520px tall overflow host with
`transform: translateZ(0)`, add enough vertical padding to scroll deeply, paste
a URL, and capture the link and paste-menu boxes. Scroll the host 60–80px and
poll until:

```ts
Math.abs((movedMenu.y - menu.y) - (movedLink.y - link.y)) <= 2
```

Also assert the menu remains visible and inside the viewport. On the old
controller, the menu is destroyed after the nested scroll.

**Step 2: Add horizontal root scrolling**

Extend the bookmark fixture with wide content and left padding so
`window.scrollX > 1000`. Assert the settings menu is beside the trigger and
contained on both axes. After opening, scroll horizontally by 80px and assert
the menu and bookmark have matching x deltas within two pixels.

**Step 3: Add a transformed nested host variant**

Run the existing nested live-anchor and virtual-anchor movement cases with an
overflow host using `transform: translate3d(0, 0, 0)`. Assert matching deltas
and containment after scrolling.

**Step 4: Build once and run Chromium**

Run:

```bash
yarn build:test
npx playwright test \
  test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts \
  --project=chromium --workers=1
```

Expected: all root and link-paste cases pass in Chromium.

**Step 5: Run Firefox and WebKit independently**

Run:

```bash
npx playwright test \
  test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts \
  --project=firefox --workers=1
npx playwright test \
  test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts \
  --project=webkit --workers=1
```

Expected: all cases pass in both engines without retries.

**Step 6: Commit**

```bash
git add test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts
git commit -m "test(popover): cover adversarial scroll hosts"
```

### Task 5: Reconcile the authoritative inventory

**Files:**
- Modify: `docs/plans/2026-07-17-floating-positioning-inventory.md`

**Step 1: Re-run discovery**

Use the AST law output plus direct searches for `PopoverDesktop`,
`positionAnchored`, `positionFixedAnchored`, `createPositionTracker`,
`promoteToTopLayer`, root mounts, and authored fixed/absolute positioning.

**Step 2: Update every stale row**

Record current contracts and direct evidence for:

- block settings, toolbox, and link-paste virtual contexts;
- tooltip nested-scroll dismissal;
- link-hover and emoji tracking;
- database property-type and tab-overflow shared fixed positioning;
- horizontal/root/transformed browser cases;
- every remaining local or pointer-following exemption.

Remove every “unsafe” or “unproven” label only when a source path and focused
test directly prove it.

**Step 3: Verify and commit**

Run:

```bash
git diff --check
```

Inspect the complete inventory diff, force-add the ignored document, and commit:

```bash
git add -f docs/plans/2026-07-17-floating-positioning-inventory.md
git commit -m "docs(positioning): reconcile surface inventory"
```

### Task 6: Prove the guards fail under deliberate mutations

**Files:**
- Temporarily modify and restore files from Tasks 1–4

**Step 1: Root-boundary mutation**

Temporarily make `resolveBoundaryRect()` use
`document.body.getBoundingClientRect()` for a root boundary. Run:

```bash
npx vitest run --project=unit \
  test/unit/utils/anchored-position-boundary.test.ts \
  test/unit/utils/popover-desktop.test.ts
```

Expected: root matrix failures on both axes. Restore and rerun to green.

**Step 2: Link-paste lifecycle mutation**

Temporarily replace link-paste `positionContext` with
`positionLifecycle: 'dismiss-on-nested-scroll'`. Run the controller unit test.
Expected: the nested-scroll regression fails because the menu disappears.
Restore and rerun to green.

**Step 3: Analyzer family mutations**

For each detection family—root aliases, helper mounts, root geometry, style
aliases, computed writes, `Object.assign`, `cssText`/`setAttribute`, and dynamic
access—temporarily disable its analyzer branch and run the matching adversarial
test. Expected: that fixture fails. Restore each branch before moving on.

**Step 4: Repository-law mutation**

Temporarily add an unclassified `src/__floating_position_mutation__.ts` that
aliases `document.body`, mounts an element, reads an anchor rect, aliases its
style, and writes `top`/`left`. Run the architecture law. Expected: exact
inventory mismatch naming the new file. Delete the fixture and rerun green.

**Step 5: Confirm restoration**

Run:

```bash
git diff --check
git status --short
```

Expected: only intended committed work and no mutation residue.

### Task 7: Run the complete fresh verification matrix

**Files:**
- Inspect all changes and plan requirements

**Step 1: Focused unit and artifact gates**

Run:

```bash
npx vitest run --project=unit \
  test/unit/architecture/floating-positioning-analyzer.test.ts \
  test/unit/architecture/floating-positioning-law.test.ts \
  test/unit/utils/anchored-position-boundary.test.ts \
  test/unit/utils/anchored-position.test.ts \
  test/unit/utils/popover-position.test.ts \
  test/unit/utils/popover-desktop.test.ts \
  test/unit/utils/popover-desktop-tracker.test.ts \
  test/unit/tools/link/paste-menu-controller.test.ts \
  test/unit/components/modules/paste/pattern-handler-link-menu.test.ts \
  test/unit/build/published-types-selfconsistent.test.ts \
  test/unit/build/bundle-outputs.test.ts
```

Expected: zero failures.

**Step 2: Full static and unit gates**

Run independently and capture each exit code:

```bash
yarn test
yarn lint
yarn build:test
```

Expected: all exit zero; warnings must be identified as pre-existing and
non-fatal rather than ignored.

**Step 3: Cross-browser root and link-paste suites**

Run each engine with one worker:

```bash
npx playwright test \
  test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts \
  --project=chromium --workers=1
npx playwright test \
  test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts \
  --project=firefox --workers=1
npx playwright test \
  test/playwright/tests/ui/popover-root-boundary.spec.ts \
  test/playwright/tests/tools/link-paste.spec.ts \
  --project=webkit --workers=1
```

**Step 4: Nearby floating-surface suites**

Run:

```bash
npx playwright test \
  test/playwright/tests/ui/tooltip-scroll-anchoring.spec.ts \
  test/playwright/tests/tools/image.spec.ts \
  test/playwright/tests/tools/audio.spec.ts \
  test/playwright/tests/ui/database-single-view-tab-bar.spec.ts \
  test/playwright/tests/tools/table/table-grip-menu.spec.ts \
  --project=chromium-default --workers=1
```

If project routing excludes a named file, select its configured Chromium
project and rerun rather than treating zero selected tests as evidence.

**Step 5: Final repository and requirement audit**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -12
```

Inspect every commit diff since `7a4c6331`. Map each design finding, plan task,
inventory row, mutation, command, and browser to its direct current evidence.
Do not mark the persistent goal complete while any row is stale, any command is
unrun, any suite selected zero tests, or any result is indirect.
