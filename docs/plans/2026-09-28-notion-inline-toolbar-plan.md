# Notion-style Inline Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-row inline toolbar into Notion's card: convert row, 5×2 grid of 32×28 cells, Notion's shadow, an entrance/exit motion, "Turn into" beside the card, and an untabbed color panel.

**Architecture:** Layout lives in Tailwind class constants (`cssInline` in `popover.const.ts` and the item/separator const files) applied by `PopoverInline`. Order comes from `INLINE_TOOL_ORDER`. Motion is plain CSS keyed off the existing `data-blok-popover-inline` / `data-blok-popover-opened` attributes, with the transform origin passed in through an internal CSS variable the positioner sets. The color panel is the shared `createColorPicker`, restructured in place; its interface and its four callers keep their shape.

**Tech Stack:** TypeScript, Tailwind v4 (house `twMerge` in `src/components/utils/tw.ts`), Vitest + jsdom, Playwright.

**Spec:** `docs/plans/2026-09-28-notion-inline-toolbar-design.md`

## Global Constraints

- Card: 8px padding (`p-2`), 14px radius (`rounded-[14px]`), shadow `var(--blok-inline-toolbar-shadow)`.
- Light shadow: `0 20px 24px rgba(25,25,25,.05), 0 5px 8px rgba(25,25,25,.027), 0 0 0 1px rgba(42,28,0,.07)`.
- Dark shadow: `0 20px 24px rgba(0,0,0,.35), 0 5px 8px rgba(0,0,0,.25), 0 0 0 1px rgba(255,255,255,.1)`.
- Grid: 5 columns of 32px (`grid-cols-[repeat(5,2rem)]`), 4px gaps (`gap-1`), cells 32×28 (`h-7`), 6px radius (`rounded-md`).
- Mobile (touch): tracks and cells are 40×40 (`mobile:grid-cols-[repeat(5,2.5rem)]`, `mobile:h-10`). This is a deliberate deviation from "same card on mobile": 28px-tall targets are too small for fingers. Flag it to the user at handoff.
- Hover: `transition-[background-color] duration-[20ms] ease-in`.
- Cell order: `marker, bold, italic, underline, clearFormat, link, strikethrough, inlineCode, equation, supSub`.
- Entrance: 140ms, opacity 0→1, translateY 4px→0, scale .98→1. Origin `left top` below the selection, `left bottom` above. None under `prefers-reduced-motion`.
- Exit: the existing toolbar ghost (`mountToolbarGhost`, 160ms fade + scale .97).
- No new data attributes (a new one forces `node scripts/generate-data-attributes-dts.mjs` and a published-type change). Use the internal CSS variable `--_blok-inline-toolbar-origin`.
- No public TS type changes. New public CSS variable `--blok-inline-toolbar-shadow` is additive (not BREAKING).
- Picker test ids that go away: `<prefix>-tab-*`, `<prefix>-reset-*`, `<prefix>-preview-*`. They are not in `types/` or `docs/` (checked in Task 5 Step 1).
- Run only related tests while iterating (user rule). Lint only changed files. `yarn e2e <file>` builds automatically.
- Commit after every task. Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A consumer with custom inline tools** (11+ items) — extra cells must go on new rows of five, the card must not widen. Pinned in Task 2 (unit) and Task 7 (e2e).
2. **Selection at the bottom of the viewport** — the card flips above, and the entrance must then grow from the bottom edge, not drop from the top. Pinned in Task 4 (unit) and Task 7 (e2e).
3. **Keyboard user opening the color panel** — with tabs gone, focus must land on a swatch (the active one) only in keyboard modality, never paint a ring for a mouse open. Pinned in Task 5.
4. **Selection already colored** — the panel must ring the current text and background swatches and the A cell must show them. Pinned in Task 5 (unit) and Task 7 (e2e).
5. **"Turn into" near the right viewport edge** — the beside submenu must flip left and stay on screen. Pinned in Task 7 (e2e at 390px and with the selection at the right edge).

---

### Task 1: Notion cell order

**Files:**
- Modify: `src/components/constants/inline-tool-order.ts:16-28`
- Modify: `src/tools/index.ts:101-112`
- Test: `test/unit/tools/inline-tools-order.test.ts`

**Interfaces:**
- Produces: `INLINE_TOOL_ORDER = ['convertTo','marker','bold','italic','underline','clearFormat','link','strikethrough','inlineCode','equation','supSub']`.

- [ ] **Step 1: Write the failing test** — add to `test/unit/tools/inline-tools-order.test.ts`:

```ts
describe('INLINE_TOOL_ORDER', () => {
  it('lays the cells out in Notion order: color and emphasis first, then link and technical marks', () => {
    expect(INLINE_TOOL_ORDER).toEqual([
      'convertTo',
      'marker', 'bold', 'italic', 'underline', 'clearFormat',
      'link', 'strikethrough', 'inlineCode', 'equation', 'supSub',
    ]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `yarn test test/unit/tools/inline-tools-order.test.ts`
Expected: FAIL, array order differs.

- [ ] **Step 3: Implement** — replace the array in `inline-tool-order.ts` with the order above. Update its doc comment's grouping line to: `Laid out as Notion's grid: color and emphasis on the first row, link and technical marks on the second.` Reorder `defaultInlineTools` in `src/tools/index.ts` to the same order (minus `convertTo`).

- [ ] **Step 4: Run it, expect PASS; run the other order pins**

Run: `yarn test test/unit/tools/inline-tools-order.test.ts` then `yarn test test/unit/components/modules/tools.test.ts`
Expected: PASS. If `tools.test.ts` pins the old order literally, update the literal to the new order (it pins the order, not the reasoning).

- [ ] **Step 5: Commit**

```bash
git add src/components/constants/inline-tool-order.ts src/tools/index.ts test/unit/tools/inline-tools-order.test.ts test/unit/components/modules/tools.test.ts
git commit -m "feat(inline-toolbar): order the cells the way Notion does"
```

---

### Task 2: Grid card layout and chrome

**Files:**
- Modify: `src/components/utils/popover/popover.const.ts:59-71` (`cssInline`)
- Modify: `src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts` (`cssInline.item`)
- Modify: `src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator.const.ts` (`cssInline`)
- Modify: `src/components/utils/popover/popover-inline.ts` (constructor, `styleConvertControl`, drop `INLINE_HEIGHT*`)
- Modify: `src/styles/colors.css` (light block near line 111, dark media block near 534, dark theme block near 719)
- Test: `test/unit/utils/popover-inline.test.ts` (rewrite the `compact bar layout` describe, drop `should set inline height CSS variables`)
- Test: `test/unit/components/utils/popover/popover-inline.mutants.test.ts:199`
- Test: `test/unit/styles/__snapshots__/main-css-rules.snap.txt` (regenerate)

**Interfaces:**
- Produces: CSS variable `--blok-inline-toolbar-shadow`; convert item carries `col-span-full`; separator `aria-orientation="horizontal"`.

- [ ] **Step 1: Write the failing tests** — replace `describe('compact bar layout', …)` in `test/unit/utils/popover-inline.test.ts` with `describe('grid card layout', …)`. Keep `createGridPopover` and the tests `preserves every configured tool…`, `styles the convert row as a card header…`, `restores the fixed icon box…`, `sets the header row rhythm…`, `marks the convert row as expanded…`, `lines the convert dropdown up…`, `does not pin the container…` as they are. Replace the others with:

```ts
    it('lays the cells in a five-column grid of 32px tracks', () => {
      const popover = createGridPopover();

      popover.show();

      const items = popover.getElement().querySelector(`[${DATA_ATTR.popoverItems}]`);

      expect(items?.className).toContain('grid');
      expect(items?.className).toContain('grid-cols-[repeat(5,2rem)]');
      expect(items?.className).toContain('gap-1');
    });

    it('stretches the convert row across all five columns', () => {
      const popover = createGridPopover();

      popover.show();

      const convert = popover.getElement().querySelector('[data-blok-item-name="convert-to"]');

      expect(convert?.className).toContain('col-span-full');
    });

    it('rules the convert row off with a horizontal separator spanning the grid', () => {
      const popover = createGridPopover();

      popover.show();

      const element = popover.getElement();
      const convert = element.querySelector('[data-blok-item-name="convert-to"]');
      const separator = element.querySelector('[data-blok-testid="popover-item-separator"]');

      expect(convert?.nextElementSibling).toBe(separator);
      expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
      expect(separator?.className).toContain('col-span-full');
    });

    it('sizes formatting cells 32x28 with a 6px radius', () => {
      const popover = createGridPopover();

      popover.show();

      const bold = popover.getElement().querySelector('[data-blok-item-name="bold"]');

      expect(bold?.className).toContain('h-7');
      expect(bold?.className).toContain('rounded-md');
      expect(bold?.className).not.toContain('min-w-10');
    });

    it('points the convert chevron sideways, toward the submenu beside the card', () => {
      const popover = createGridPopover();

      popover.show();

      const chevron = popover
        .getElement()
        .querySelector('[data-blok-item-name="convert-to"] [data-blok-testid="popover-item-chevron-right"]');

      expect(chevron?.className).not.toContain('rotate-90');
      expect(chevron?.className).toContain('can-hover:group-hover/convert:translate-x-0.5');
      expect(chevron?.className).toContain('group-data-[blok-popover-item-children-open]/convert:translate-x-0.5');
    });

    it('wraps extra tools onto new rows instead of widening the card', () => {
      const popover = new PopoverInline({
        items: Array.from({ length: 12 }, (_, index) => ({
          icon: String(index), name: `tool-${index}`, onActivate: vi.fn(),
        })),
      });

      popover.show();

      const items = popover.getElement().querySelector(`[${DATA_ATTR.popoverItems}]`);

      // Fixed tracks, not auto-fill: the 6th cell starts row 2.
      expect(items?.className).toContain('grid-cols-[repeat(5,2rem)]');
      expect(items?.className).not.toContain('flex-wrap');
    });

    it('draws the card with the inline toolbar shadow, 14px radius and 8px padding', () => {
      const popover = createGridPopover();

      popover.show();

      const container = popover.getElement().querySelector<HTMLElement>(`[${DATA_ATTR.popoverContainer}]`);

      expect(container?.style.boxShadow).toBe('var(--blok-inline-toolbar-shadow)');
      expect(container?.className).toContain('rounded-[14px]');
      expect(container?.className).toContain('p-2');
    });
```

Delete the `should set inline height CSS variables` test (the variables go away). In `popover-inline.mutants.test.ts:199` change `'vertical'` to `'horizontal'`.

- [ ] **Step 2: Run them, expect FAIL**

Run: `yarn test test/unit/utils/popover-inline.test.ts`
Expected: the new `grid card layout` tests FAIL (items are `flex flex-wrap`, separator is vertical, chevron has `rotate-90`, no box-shadow var).

- [ ] **Step 3: Implement**

`popover.const.ts` `cssInline`:

```ts
export const cssInline = {
  popover: 'relative',

  // Notion card: 8px padding, 14px radius. Width comes from the five fixed tracks.
  popoverContainer: 'flex-col top-0 min-w-0 w-max max-w-[calc(100vw-16px)] p-2 rounded-[14px] mobile:absolute',

  // Fixed tracks, so extra tools start a new row of five instead of widening the card.
  items: 'grid grid-cols-[repeat(5,2rem)] mobile:grid-cols-[repeat(5,2.5rem)] gap-1 pt-0 pb-0',

  // p-2 already pads the card evenly; the shared opened state would add pt/pb again.
  popoverContainerOpened: 'p-2',
};
```

`popover-item-default.const.ts` `cssInline`:

```ts
export const cssInline = {
  item: 'rounded-md h-7 max-h-none min-w-0 p-0 mb-0 shrink-0 mobile:h-10 transition-[background-color,scale] duration-[20ms] ease-in active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100',
  itemIconOnly: 'justify-center',
  itemWithTitle: 'px-2',
};
```

`popover-item-separator.const.ts` `cssInline`:

```ts
export const cssInline = {
  container: 'col-span-full px-0 py-1 h-auto max-h-none',
  line: 'h-px w-full bg-popover-border/60',
  nestedContainer: 'py-1 px-[3px]',
  nestedLine: 'w-full h-px',
};
```

`popover-inline.ts`:
- Delete `INLINE_HEIGHT`, `INLINE_HEIGHT_MOBILE` and the two `style.setProperty('--height…')` lines.
- After the `popoverContainer` class assignment in the constructor add:

```ts
      // Own token so the other menus keep --blok-popover-box-shadow.
      this.nodes.popoverContainer.style.boxShadow = 'var(--blok-inline-toolbar-shadow)';
```

  and repeat that line in `show()` after the container className is set (the base `show` path in `popover-abstract.ts:1091` writes the shared shadow).
- In `styleConvertControl`: add `col-span-full` to the convert classes and drop `mobile:basis-full`. On the chevron replace `'rotate-90'`, `'can-hover:group-hover/convert:translate-y-0.5'`, `'group-data-[blok-popover-item-children-open]/convert:translate-y-0.5'` with `'can-hover:group-hover/convert:translate-x-0.5'`, `'group-data-[blok-popover-item-children-open]/convert:translate-x-0.5'`. Set separators to `aria-orientation="horizontal"` and add `col-span-full` to each separator element's className.

`colors.css`: add `--blok-inline-toolbar-shadow` next to `--blok-popover-box-shadow` in all three blocks, values from Global Constraints (light once, dark in both the media block and the `data-blok-theme="dark"` block).

- [ ] **Step 4: Run, expect PASS**

Run: `yarn test test/unit/utils/popover-inline.test.ts` then `yarn test test/unit/components/utils/popover/popover-inline.mutants.test.ts` then `yarn test test/unit/styles -u` (only regenerates the CSS snapshot; read the diff and confirm it only adds the shadow token and changed utility rules).
Expected: PASS.

- [ ] **Step 5: Lint changed files, commit**

```bash
npx eslint src/components/utils/popover/popover.const.ts src/components/utils/popover/popover-inline.ts src/components/utils/popover/components/popover-item/popover-item-default/popover-item-default.const.ts src/components/utils/popover/components/popover-item/popover-item-separator/popover-item-separator.const.ts test/unit/utils/popover-inline.test.ts
git add -u src/components/utils/popover src/styles/colors.css test/unit/utils/popover-inline.test.ts test/unit/components/utils/popover/popover-inline.mutants.test.ts test/unit/styles/__snapshots__
git commit -m "feat(inline-toolbar): lay the toolbar out as Notion's grid card"
```

---

### Task 3: "Turn into" opens beside the card

**Files:**
- Modify: `src/components/inline-tools/inline-tool-convert.ts:148` (`children`)
- Test: `test/unit/components/inline-tools/inline-tool-convert-picker.test.ts`

**Interfaces:**
- Consumes: public `placement?: 'beside' | 'below'` (`types/utils/popover/popover-item.d.ts:55`). `PopoverInline` only defaults `placement` when it is undefined.

- [ ] **Step 1: Write the failing test** — in `inline-tool-convert-picker.test.ts`, using the file's existing setup that obtains the convert tool's `render()` result (reuse its helper; do not add a new mock), add:

```ts
  it('opens Turn into beside the toolbar card, matching its sideways chevron', async () => {
    const config = await renderConvert();

    expect(config.children?.placement).toBe('beside');
  });
```

(`renderConvert` = the file's existing helper that returns the tool's `MenuConfig`; use its real name.)

- [ ] **Step 2: Run, expect FAIL**

Run: `yarn test test/unit/components/inline-tools/inline-tool-convert-picker.test.ts`
Expected: FAIL, `placement` is undefined.

- [ ] **Step 3: Implement** — add `placement: 'beside',` to the `children` object in `inline-tool-convert.ts`, above `items`.

- [ ] **Step 4: Run, expect PASS**

Same command. Expected: PASS. Real on-screen placement is proven in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/components/inline-tools/inline-tool-convert.ts test/unit/components/inline-tools/inline-tool-convert-picker.test.ts
git commit -m "feat(inline-toolbar): open Turn into beside the card"
```

---

### Task 4: Entrance and exit motion

**Files:**
- Modify: `src/components/modules/toolbar/inline/positioner.ts` (`apply` returns the side)
- Modify: `src/components/modules/toolbar/inline/index.ts` (`applyPosition` sets the origin variable; `close()` leaves a ghost)
- Modify: `src/styles/popover-animation.css:36-42` and the reduced-motion block near line 450
- Modify: `src/styles/keyframes.css` (new keyframe)
- Test: `test/unit/components/modules/toolbar/inline/positioner.test.ts` (create if absent; check `ls test/unit/components/modules/toolbar/inline/`)
- Test: `test/unit/components/modules/toolbar/inline/index.test.ts`
- Test: `test/unit/styles/__snapshots__/*` (regenerate)

**Interfaces:**
- Produces: `InlinePositioner.apply(options): 'below' | 'above'`; wrapper style `--_blok-inline-toolbar-origin: left top | left bottom`.

- [ ] **Step 1: Write the failing tests**

Positioner:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InlinePositioner } from '../../../../../../src/components/modules/toolbar/inline/positioner';

describe('InlinePositioner side', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
  });

  const apply = (selectionTop: number): 'below' | 'above' => new InlinePositioner(false).apply({
    wrapper: document.createElement('div'),
    selectionRect: new DOMRect(100, selectionTop, 60, 20),
    wrapperOffset: new DOMRect(0, 0, 0, 0),
    contentRect: new DOMRect(0, 0, 1200, 800),
    popoverWidth: 192,
    popoverHeight: 110,
  });

  it('opens below a selection with room under it', () => {
    expect(apply(200)).toBe('below');
  });

  it('reports above when it flips over a selection near the viewport bottom', () => {
    expect(apply(740)).toBe('above');
  });
});
```

Index (`index.test.ts`, inside the existing positioning describe, using its existing module mocks and fixture for an opened toolbar):

```ts
  it('grows the card from the edge nearest the text', async () => {
    // Arrange with the file's existing "opened toolbar" fixture, then:
    const wrapper = getWrapper(); // existing accessor for nodes.wrapper
    vi.spyOn(InlinePositioner.prototype, 'apply').mockReturnValueOnce('above');

    await openToolbar(); // existing helper

    expect(wrapper.style.getPropertyValue('--_blok-inline-toolbar-origin')).toBe('left bottom');
  });

  it('leaves a fading copy of the card when it closes', async () => {
    await openToolbar();
    const ghostModule = await import('../../../../../../src/components/modules/toolbar/inline/toolbar-ghost');
    const mount = vi.spyOn(ghostModule, 'mountToolbarGhost');

    inlineToolbar.close();

    expect(mount).toHaveBeenCalledTimes(1);
  });
```

Use the file's real helper names for "open the toolbar" and "get the wrapper"; if `toolbar-ghost` is not spy-able as an ES export in this file's setup, add `vi.mock('…/toolbar-ghost', …)` with `vi.hoisted()` as the file already does for other modules.

- [ ] **Step 2: Run, expect FAIL**

Run: `yarn test test/unit/components/modules/toolbar/inline/positioner.test.ts` then `yarn test test/unit/components/modules/toolbar/inline/index.test.ts`
Expected: FAIL (apply returns undefined; no origin variable; no ghost on close).

- [ ] **Step 3: Implement**

`positioner.ts`: change the signature to `public apply(options: InlinePositioningOptions): 'below' | 'above'`, track `let side: 'below' | 'above' = 'below';`, set `side = 'above'` in the branch that picks `selectionRect.top - popoverHeight - …`, and `return side;` at the end.

`index.ts` `applyPosition`:

```ts
    const side = this.positioner.apply({ … });

    // The entrance grows out of the edge nearest the selection.
    this.nodes.wrapper.style.setProperty('--_blok-inline-toolbar-origin', side === 'above' ? 'left bottom' : 'left top');
```

`index.ts` `close()`: before `this.popover.hide?.()`:

```ts
    const shownRoot = this.popover?.getElement?.();

    if (shownRoot && this.nodes.wrapper) {
      // Fade the card out instead of cutting it.
      mountToolbarGhost(shownRoot, this.nodes.wrapper, null);
    }
```

`keyframes.css`:

```css
@keyframes blok-inline-toolbar-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

`popover-animation.css`: keep the existing "no transition" rule, and add under it:

```css
/* Opened only: the ghost copy strips data-blok-popover-opened, so it never
   replays the entrance while it fades out. Direct menus keep their own. */
[data-blok-popover-inline][data-blok-popover-opened='true']:not([data-blok-inline-direct-menu]) > [data-blok-popover-container] {
  transform-origin: var(--_blok-inline-toolbar-origin, left top);
  animation: blok-inline-toolbar-in 140ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
```

Add that selector to the `prefers-reduced-motion` block's `animation: none` list. The ghost is created from the opened popover but strips `data-blok-popover-opened` (see `IDENTITY_ATTRS`), so check that list still contains it; if a later edit dropped it, the ghost would replay the entrance.

- [ ] **Step 4: Run, expect PASS; regenerate CSS snapshots**

Run the two test files, then `yarn test test/unit/styles -u` and read the snapshot diff (only the new keyframe and rule).
Also run `yarn test test/unit/components/modules/toolbar/inline` (whole folder: ghost + index + positioner).
Expected: PASS.

- [ ] **Step 5: Lint changed files, commit**

```bash
npx eslint src/components/modules/toolbar/inline/positioner.ts src/components/modules/toolbar/inline/index.ts test/unit/components/modules/toolbar/inline/positioner.test.ts test/unit/components/modules/toolbar/inline/index.test.ts
git add src/components/modules/toolbar/inline src/styles/popover-animation.css src/styles/keyframes.css test/unit/components/modules/toolbar/inline test/unit/styles/__snapshots__
git commit -m "feat(inline-toolbar): grow the card out of the selection and fade it out"
```

---

### Task 5: Untabbed color panel (picker DOM)

**Files:**
- Modify: `src/components/shared/color-picker.ts`
- Modify: `src/components/inline-tools/inline-tool-marker.ts:249-254`, `src/components/shared/block-color.ts:223`, `src/tools/table/table-cell-selection.ts:1424`, `src/tools/table/table-row-col-popover.ts:91` (focus call)
- Test: `test/unit/components/shared/color-picker.test.ts`, `color-picker-redesign.test.ts`, `color-picker-keyboard.test.ts`, `color-picker-polish.test.ts`, `color-picker-focus-modality.test.ts`, `color-picker.mutants.test.ts`, `test/unit/tools/table/table-cell-color-picker.test.ts`, `test/unit/components/inline-tools/inline-tool-marker*.test.ts`

**Interfaces:**
- Consumes: `ColorPickerOptions` unchanged (`modes: [ColorPickerMode, ColorPickerMode]` become two stacked sections).
- Produces: `ColorPickerHandle.focusActiveSwatch(): void` — focuses the active swatch of the first section (default swatch if none), keyboard modality only.

- [ ] **Step 1: Confirm the removed test ids are not published**

Run: `grep -rnE "(tab|reset|preview)-(color|textColor|backgroundColor|background-color)" types docs/src | head`
Expected: no output. If anything matches, STOP and tell the user it is BREAKING before going on.

- [ ] **Step 2: Write the failing tests** — rewrite `color-picker-redesign.test.ts` to pin the new design (delete its tab tests):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createColorPicker } from '../../../../src/components/shared/color-picker';
import type { I18n } from '../../../../types/api';

const i18n = { t: (key: string) => key, has: () => false } as unknown as I18n;
const modes: Parameters<typeof createColorPicker>[0]['modes'] = [
  { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
  { key: 'background-color', labelKey: 'tools.marker.background', presetField: 'bg' },
];
const make = (initialActiveColors?: Record<string, string | null>) =>
  createColorPicker({ i18n, modes, testIdPrefix: 'marker', onColorSelect: vi.fn(), initialActiveColors });

describe('color picker, one untabbed panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('blok-recent-colors');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('blok-recent-colors');
  });

  it('shows the text and background sections at once, with no tabs', () => {
    const { element } = make();

    expect(element.querySelector('[role="tablist"]')).toBeNull();
    expect(element.querySelector('[data-blok-testid="marker-section-color"]')?.hidden).toBe(false);
    expect(element.querySelector('[data-blok-testid="marker-section-background-color"]')?.hidden).toBe(false);
  });

  it('titles each section and labels it as a group', () => {
    const { element } = make();
    const section = element.querySelector('[data-blok-testid="marker-section-color"]');
    const titleId = section?.getAttribute('aria-labelledby') ?? '';

    expect(section).toHaveAttribute('role', 'group');
    expect(element.querySelector(`[id="${titleId}"]`)?.textContent).toBe('tools.marker.textColor');
  });

  it('keeps ten swatches per section: default plus nine colors', () => {
    const { element } = make();

    expect(element.querySelectorAll('[data-blok-testid^="marker-swatch-color-"]')).toHaveLength(10);
    expect(element.querySelectorAll('[data-blok-testid^="marker-swatch-background-color-"]')).toHaveLength(10);
  });

  it('has no selected-color row and no reset button; the default swatch resets', () => {
    const { element } = make();

    expect(element.querySelector('[data-blok-testid^="marker-reset-"]')).toBeNull();
    expect(element.querySelector('[data-blok-testid^="marker-preview-"]')).toBeNull();
  });

  it('rings the swatches of the colors already applied', () => {
    const { element } = make({ color: '#d44c47', 'background-color': null });

    expect(element.querySelector('[data-blok-testid="marker-swatch-color-red"]')).toHaveAttribute('aria-pressed', 'true');
    expect(element.querySelector('[data-blok-testid="marker-swatch-background-color-default"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts recently used colors above the sections', () => {
    localStorage.setItem('blok-recent-colors', JSON.stringify([{ name: 'red', field: 'text' }]));
    const { element } = make();
    const recent = element.querySelector('[data-blok-testid="marker-section-recent"]');
    const text = element.querySelector('[data-blok-testid="marker-section-color"]');

    expect(recent).not.toBeNull();
    expect(recent?.compareDocumentPosition(text as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
```

(`#d44c47` is the light `red` preset's `text`, `src/components/shared/color-presets.ts:23`.)

Add the focus test to `color-picker-focus-modality.test.ts`, using that file's existing way of setting keyboard vs pointer modality:

```ts
  it('focuses the active swatch for a keyboard open and nothing for a mouse open', () => {
    const picker = make({ color: '#d44c47' });

    document.body.append(picker.element);
    setKeyboardModality(); // the file's existing helper
    picker.focusActiveSwatch();
    expect(document.activeElement?.getAttribute('data-blok-testid')).toBe('marker-swatch-color-red');

    (document.activeElement as HTMLElement).blur();
    setPointerModality();
    picker.focusActiveSwatch();
    expect(document.activeElement).toBe(document.body);
  });
```

- [ ] **Step 3: Run, expect FAIL**

Run: `yarn test test/unit/components/shared/color-picker-redesign.test.ts` then `yarn test test/unit/components/shared/color-picker-focus-modality.test.ts`
Expected: FAIL (tablist exists, background section hidden, reset/preview exist, recents below, `focusActiveSwatch` missing).

- [ ] **Step 4: Implement in `color-picker.ts`**
- Delete `modeTabs`, `tabList`, `previews`, `colorNames`, `activateMode`, the tab/selected-row/reset/preview construction, and every `activateMode(...)` call (including in the recent swatch click handler).
- Append `recentSectionHost` to `wrapper` BEFORE the modes loop. Its section keeps `border-t`? No: it is now first, so move the divider: recent section classes become `'flex flex-col gap-2'`, and each mode section after the first gets `border-t border-popover-border pt-3` only when it follows a visible block — simplest: give every mode section `'flex flex-col gap-2'` and rely on `wrapper`'s `gap-3`.
- Each mode section:

```ts
    const section = document.createElement('div');
    const title = document.createElement('div');

    title.id = `${pickerId}-title-${modeIndex}`;
    title.className = 'text-xs font-medium text-text-secondary px-0.5';
    title.textContent = i18n.t(mode.labelKey);
    section.setAttribute('data-blok-testid', `${testIdPrefix}-section-${mode.key}`);
    section.setAttribute('role', 'group');
    section.setAttribute('aria-labelledby', title.id);
    section.className = 'flex flex-col gap-2';
```

- In `renderSection`, drop the preview/colorName writes; keep swatch rendering as is.
- Add to the returned handle:

```ts
    focusActiveSwatch: () => {
      // A mouse open must not paint a focus ring (focus-ring law).
      if (!isKeyboardModality()) {
        return;
      }
      sectionGrids[0]?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    },
```

  and add `focusActiveSwatch: () => void;` with a one-line doc to `ColorPickerHandle`.
- In the four callers, replace `….querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })` with `<handle>.focusActiveSwatch()` (in `inline-tool-marker.ts` the handle is `this.picker`; follow each file's variable).

- [ ] **Step 5: Run the picker unit suites, fix tab-pinned tests**

Run each: `yarn test test/unit/components/shared/color-picker.test.ts`, `…/color-picker-redesign.test.ts`, `…/color-picker-keyboard.test.ts`, `…/color-picker-polish.test.ts`, `…/color-picker-focus-modality.test.ts`, `…/color-picker.mutants.test.ts`, `yarn test test/unit/tools/table/table-cell-color-picker.test.ts`, `yarn test test/unit/components/inline-tools/inline-tool-marker`, `yarn test test/unit/components/shared/block-color`.
For each failure: if it pins tabs, the reset row, or the preview (design that no longer exists), delete that case or rewrite it to the untabbed equivalent. Rename any `describe`/`it` that names tabs. Never change a count of 10 swatches to 11. Any other failure is a real bug: fix the source.

- [ ] **Step 6: Lint changed files, commit**

```bash
npx eslint src/components/shared/color-picker.ts src/components/inline-tools/inline-tool-marker.ts src/components/shared/block-color.ts src/tools/table/table-cell-selection.ts src/tools/table/table-row-col-popover.ts
git add src/components/shared src/components/inline-tools/inline-tool-marker.ts src/tools/table/table-cell-selection.ts src/tools/table/table-row-col-popover.ts test/unit
git commit -m "feat(color-picker): show text and background colors in one panel, like Notion"
```

---

### Task 6: Picker e2e and story rot

**Files:**
- Delete: `test/playwright/tests/helpers/color-picker.ts` (`activateColorTab` has nothing left to do)
- Delete: `test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts`
- Rewrite: `test/playwright/tests/inline-tools/color-picker-redesign.spec.ts` (pin the untabbed panel)
- Modify (remove `activateColorTab` calls/imports, replace `-tab-`/`-reset-`/`-preview-` usage): `test/playwright/tests/tools/callout.spec.ts`, `tools/table/table-cell-color-hover.spec.ts`, `table-cell-color-initial-render.spec.ts`, `table-cell-color-multi.spec.ts`, `table-cell-color.spec.ts`, `table-cell-selection-pill-reopen.spec.ts`, `table-grip-menu.spec.ts`, `table-undo-redo.spec.ts`, `undo-audit/capture.spec.ts`, `undo-audit/w4-menu.spec.ts`, `undo-audit/w4-table.spec.ts`, `src/stories/MarkerColors.stories.ts`, `test/playwright/tests/tools/table/table-cell-color-edge-cases.plan.md` (text only)

- [ ] **Step 1: Rewrite `color-picker-redesign.spec.ts` first (it is the design pin)** — keep its page setup; replace its tests with: both sections visible on open (`getByTestId('marker-section-color')` and `…-background-color` `toBeVisible()`), no `getByRole('tab')` (`toHaveCount(0)`), clicking `marker-swatch-background-color-yellow` applies a background and then `marker-swatch-background-color-default` removes it (assert on the paragraph's `innerHTML`), and the panel's top edge is at or below the A cell's bottom edge (`boundingBox`).

- [ ] **Step 2: Run it, expect PASS** (Task 5 built the panel)

Run: `yarn e2e test/playwright/tests/inline-tools/color-picker-redesign.spec.ts`

- [ ] **Step 3: Remove the helper and its call sites**

```bash
grep -rln "activateColorTab" test/playwright | xargs sed -i '' -E '/activateColorTab/d'
git rm test/playwright/tests/helpers/color-picker.ts test/playwright/tests/tools/table/table-cell-color-tabs.spec.ts
grep -rnE "(marker|cell-color|callout-color|block-color)-(tab|reset|preview)-|getByRole\('tab'" test/playwright src/stories
```

The `sed` deletes the import lines and the `await activateColorTab(…)` lines; open each touched file and confirm no multi-line call was split. For each remaining grep hit: a `-reset-<mode>` click becomes a click on `<prefix>-swatch-<mode>-default`; a `-preview-` read becomes a read of the `aria-pressed="true"` swatch; a tab click is deleted.

- [ ] **Step 4: Run every touched spec, one at a time**

Run `yarn e2e <file>` for each file listed above. A failure that pins the old layout gets rewritten to the new one; any other failure is a real bug — stop and fix the source.

- [ ] **Step 5: Commit**

```bash
git add -u test/playwright src/stories
git commit -m "test(color-picker): follow the untabbed panel in e2e specs and stories"
```

---

### Task 7: Toolbar e2e pins

**Files:**
- Create: `test/playwright/tests/inline-tools/notion-toolbar.spec.ts`
- Delete: `test/playwright/tests/inline-tools/control-redesign.spec.ts` (its three tests pin the one-row bar; the canonical-order test moves into the new spec)
- Check: `test/playwright/tests/inline-tools/menu-grid-redesign.spec.ts` (block menus; only the convert test touches the toolbar — run it)

- [ ] **Step 1: Write the spec** — same page setup as `control-redesign.spec.ts` (holder, `window.Blok`, one paragraph), parametrized over `[1280, 390]`:

```ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

const TEXT = 'Make these words yours.';

const mount = async (page: Page, width: number, height = 844, marginTop = 120): Promise<void> => {
  await page.setViewportSize({ width, height });
  await gotoTestPage(page);
  await page.evaluate(async ({ text, top }) => {
    const holder = document.createElement('div');

    holder.style.cssText = `max-width:650px;margin:${top}px auto 0;padding:0 8px`;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: [{ type: 'paragraph', data: { text } }] } });
    await window.blokInstance.isReady;
  }, { text: TEXT, top: marginTop });
};

const selectParagraph = async (page: Page) => {
  const paragraph = page.getByTestId('block-wrapper').filter({ hasText: TEXT }).locator('[contenteditable="true"]');

  await selectAllInEditable(paragraph);

  return paragraph;
};

const toolbar = (page: Page) => page.locator('[data-blok-interface="inline-toolbar"]');
const settle = (page: Page) => toolbar(page).evaluate(async (el) => {
  await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => undefined)));
});

test('cells sit in Notion order, five per row', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const cells = toolbar(page).locator('[data-blok-popover-item]:not([data-blok-item-name="convert-to"])');
  const names = await cells.evaluateAll(els => els.map(el => el.getAttribute('data-blok-item-name')));

  expect(names).toEqual(['marker', 'bold', 'italic', 'underline', 'clearFormat', 'link', 'strikethrough', 'inlineCode', 'equation', 'supSub']);
  const rects = await cells.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON() as DOMRect));

  expect(new Set(rects.slice(0, 5).map(r => Math.round(r.y))).size).toBe(1);
  expect(new Set(rects.slice(5).map(r => Math.round(r.y))).size).toBe(1);
  expect(rects[5].y).toBeGreaterThan(rects[0].y);
});

test('desktop cells are 32x28 with 4px gaps inside an 8px-padded, 14px-round card', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const bold = await toolbar(page).locator('[data-blok-item-name="bold"]').boundingBox();
  const italic = await toolbar(page).locator('[data-blok-item-name="italic"]').boundingBox();
  const card = toolbar(page).getByTestId('popover-container').first();

  expect(bold?.width).toBeCloseTo(32, 0);
  expect(bold?.height).toBeCloseTo(28, 0);
  expect((italic?.x ?? 0) - ((bold?.x ?? 0) + (bold?.width ?? 0))).toBeCloseTo(4, 0);
  await expect(card).toHaveCSS('border-radius', '14px');
  await expect(card).toHaveCSS('padding-top', '8px');
  await expect(card).toHaveCSS('box-shadow', /rgba\(42, 28, 0, 0\.07\)/);
});

test('touch cells are at least 40px on a phone', async ({ page }) => {
  await mount(page, 390);
  await selectParagraph(page);
  await settle(page);
  const bold = await toolbar(page).locator('[data-blok-item-name="bold"]').boundingBox();

  expect(bold?.height).toBeGreaterThanOrEqual(40);
});

test('an active format shows in the accent color', async ({ page }) => {
  await mount(page, 1280);
  const paragraph = await selectParagraph(page);

  await toolbar(page).getByRole('menuitemcheckbox', { name: 'Bold', exact: true }).click();
  await expect.poll(() => paragraph.innerHTML()).toMatch(/^<(b|strong)>/);
  await selectParagraph(page);
  const bold = toolbar(page).locator('[data-blok-item-name="bold"]');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--blok-icon-active-text').trim());

  await expect(bold).toHaveAttribute('data-blok-popover-item-active', /.*/);
  // #155fa8 is the light --blok-icon-active-text.
  expect(accent).toBe('#155fa8');
  await expect(bold).toHaveCSS('color', 'rgb(21, 95, 168)');
});

test('the A cell shows the colors already applied to the selection', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await toolbar(page).locator('[data-blok-item-name="marker"]').click();
  await page.getByTestId('marker-swatch-color-red').click();
  await page.keyboard.press('Escape');
  await selectParagraph(page);
  const marker = toolbar(page).locator('[data-blok-item-name="marker"]');

  // #d44c47 is the light 'red' preset's text color (color-presets.ts).
  await expect(marker).toHaveCSS('color', 'rgb(212, 76, 71)');
});

test('it opens below the selection and grows from the top-left', async ({ page }) => {
  await mount(page, 1280);
  const paragraph = await selectParagraph(page);
  await settle(page);
  const text = await paragraph.boundingBox();
  const card = await toolbar(page).getByTestId('popover-container').first().boundingBox();

  expect(card?.y ?? 0).toBeGreaterThan((text?.y ?? 0) + (text?.height ?? 0) - 1);
  await expect(toolbar(page)).toHaveCSS('--_blok-inline-toolbar-origin', 'left top');
});

test('near the viewport bottom it flips above and grows from the bottom-left', async ({ page }) => {
  await mount(page, 1280, 400, 340);
  const paragraph = await selectParagraph(page);
  await settle(page);
  const text = await paragraph.boundingBox();
  const card = await toolbar(page).getByTestId('popover-container').first().boundingBox();

  expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThanOrEqual((text?.y ?? 0) + 1);
  await expect(toolbar(page)).toHaveCSS('--_blok-inline-toolbar-origin', 'left bottom');
});

test('the card animates in, and not at all under reduced motion', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await expect(toolbar(page).getByTestId('popover-container').first()).toHaveCSS('animation-name', 'blok-inline-toolbar-in');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await selectParagraph(page);
  await expect(toolbar(page).getByTestId('popover-container').first()).toHaveCSS('animation-name', 'none');
});

for (const width of [1280, 390]) {
  test(`Turn into opens beside the card and stays on screen at ${width}px`, async ({ page }) => {
    await mount(page, width);
    await selectParagraph(page);
    await settle(page);
    await toolbar(page).locator('[data-blok-item-name="convert-to"]').click();
    const menu = page.getByTestId('popover-container').filter({ has: page.getByRole('combobox') });

    await expect(menu).toBeVisible();
    const card = await toolbar(page).getByTestId('popover-container').first().boundingBox();
    const box = await menu.boundingBox();

    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    if (width >= 1024) {
      // Beside, not below: the menu's left edge is at or past the card's right edge.
      expect(box?.x ?? 0).toBeGreaterThanOrEqual((card?.x ?? 0) + (card?.width ?? 0) - 1);
    }
  });
}

test('the color panel opens under the A cell', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const aCell = await toolbar(page).locator('[data-blok-item-name="marker"]').boundingBox();

  await toolbar(page).locator('[data-blok-item-name="marker"]').click();
  const panel = await page.getByTestId('marker-picker').boundingBox();

  expect(panel?.y ?? 0).toBeGreaterThanOrEqual((aCell?.y ?? 0) + (aCell?.height ?? 0) - 1);
});
```

Move the `configured formatting set renders in canonical order` test from `control-redesign.spec.ts` into this file with its expected order updated to Task 1's order, then `git rm test/playwright/tests/inline-tools/control-redesign.spec.ts`.

- [ ] **Step 2: Run the spec**

Run: `yarn e2e test/playwright/tests/inline-tools/notion-toolbar.spec.ts`
Expected: PASS (Tasks 1–5 built everything). Any failure is a real defect in those tasks: fix the source, not the assertion. If `Turn into` lands below the card at 1280px, `PopoverInline.setTriggerItemPosition` (written for the strip) is the first suspect.

- [ ] **Step 3: Run the neighbours**

Run each: `yarn e2e test/playwright/tests/inline-tools/menu-grid-redesign.spec.ts`, `yarn e2e test/playwright/tests/inline-tools/inline-toolbar.spec.ts` (its "reflects inline tool state changes" case is a known pre-existing flake; judge it only by re-running), `yarn e2e test/playwright/tests/inline-tools/link.spec.ts` (link field still opens under the card).

- [ ] **Step 4: Commit**

```bash
git add test/playwright/tests/inline-tools
git commit -m "test(inline-toolbar): pin the Notion card: order, geometry, placement, motion"
```

---

### Task 8: Side-by-side check, gates, push

- [ ] **Step 1: Build and compare with Notion**

Run `yarn build`, serve the playground, open it with playwright-cli under its own `-s=<name>`, select text, and take an element screenshot of the toolbar. Take the same in the `notion-tb` session. Compare card width, cell size, radius, and shadow numerically with `getBoundingClientRect` / `getComputedStyle`. Report any gap to the user with numbers.

- [ ] **Step 2: Related gates only** (user rule: never the full suite)

Run: `yarn test test/unit/utils/popover-inline.test.ts test/unit/components/utils/popover test/unit/components/modules/toolbar/inline test/unit/components/shared test/unit/tools/inline-tools-order.test.ts test/unit/architecture` one path per run, plus `npx eslint` on every changed file (`git diff --name-only origin/main -- '*.ts'`), plus `npx tsc --noEmit -p tsconfig.json` with `NODE_OPTIONS=--max-old-space-size=8192`.

- [ ] **Step 3: Push**

```bash
git pull --rebase && git push && git status
```

Expected: "up to date with origin".
