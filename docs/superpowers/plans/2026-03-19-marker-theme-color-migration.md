# Marker Theme Color Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make marker `<mark>` colors adapt automatically when the user switches between light and dark themes by storing CSS custom properties instead of raw hex values.

**Architecture:** Colors are stored as `var(--blok-color-red-text)` instead of `#d44c47`; CSS resolves them at paint time per the active theme. A migration utility converts legacy hex values to CSS vars on every editor render (idempotent). The color picker stays generic; the marker tool translates hex → CSS var internally.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (E2E), CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-19-marker-theme-color-migration-design.md`

**Parallelism note:** Tasks 1 and 2 are independent and can run in parallel. Tasks 3 and 4 depend on Tasks 1+2 completing and can then run in parallel. Task 5 depends on Task 3. Task 6 (E2E) runs last.

---

### Task 1: `mapToNearestPresetName` in color-mapping.ts

**Files:**
- Modify: `src/components/utils/color-mapping.ts` (add function after line 241)
- Modify: `test/unit/components/utils/color-mapping.test.ts` (add describe block)

**Context:** `mapToNearestPresetColor` (line 216) uses HSL-weighted distance to find the nearest preset hex. `mapToNearestPresetName` does the same but returns the color name (e.g. `'red'`) so callers can construct CSS vars. It must search **both** `COLOR_PRESETS` and `COLOR_PRESETS_DARK` so it correctly identifies dark-theme hex values (e.g. `#df5452` → `'red'`). First match wins on ties.

- [ ] **Step 1: Write failing tests**

Add to `test/unit/components/utils/color-mapping.test.ts`:

```typescript
import { parseColor, mapToNearestPresetColor, mapToNearestPresetName } from '../../../../src/components/utils/color-mapping';

describe('mapToNearestPresetName', () => {
  it('returns name for exact light-preset text hex', () => {
    expect(mapToNearestPresetName('#d44c47', 'text')).toBe('red');
  });

  it('returns name for exact light-preset bg hex', () => {
    expect(mapToNearestPresetName('#fdebec', 'bg')).toBe('red');
  });

  it('returns name for exact dark-preset text hex', () => {
    expect(mapToNearestPresetName('#df5452', 'text')).toBe('red');
  });

  it('returns name for exact dark-preset bg hex', () => {
    expect(mapToNearestPresetName('#522e2a', 'bg')).toBe('red');
  });

  it('maps near-miss blue text hex to blue', () => {
    expect(mapToNearestPresetName('#0000ff', 'text')).toBe('blue');
  });

  it('maps near-miss green text hex to green', () => {
    expect(mapToNearestPresetName('#00ff00', 'text')).toBe('green');
  });

  it('returns null for unparseable input', () => {
    expect(mapToNearestPresetName('not-a-color', 'text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(mapToNearestPresetName('', 'text')).toBeNull();
  });

  it('maps dark blue preset hex to blue name', () => {
    expect(mapToNearestPresetName('#5e87c9', 'text')).toBe('blue');
  });

  it('maps dark green bg preset hex to green name', () => {
    expect(mapToNearestPresetName('#243d30', 'bg')).toBe('green');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test test/unit/components/utils/color-mapping.test.ts -t "mapToNearestPresetName"
```

Expected: FAIL — `mapToNearestPresetName is not a function` (or import error)

- [ ] **Step 3: Implement `mapToNearestPresetName`**

Add to `src/components/utils/color-mapping.ts` (after the existing `mapToNearestPresetColor` function, line 241), and update the import at the top of the file to include `COLOR_PRESETS_DARK`:

```typescript
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from '../shared/color-presets';
```

Then add the function:

```typescript
/**
 * Map an arbitrary CSS color to the name of the nearest Blok preset color.
 *
 * Searches both light and dark presets to correctly recover the semantic name
 * from hex values that originated in either theme. First match wins on ties.
 *
 * @param cssColor - CSS color string (hex or rgb)
 * @param mode - 'text' for text color presets, 'bg' for background presets
 * @returns the nearest preset name (e.g. 'red'), or null if unparseable
 */
export function mapToNearestPresetName(cssColor: string, mode: 'text' | 'bg'): string | null {
  const rgb = parseColor(cssColor);

  if (rgb === null) {
    return null;
  }

  const hsl = rgbToHsl(rgb);
  const allPresets = [...COLOR_PRESETS, ...COLOR_PRESETS_DARK];

  const best = allPresets.reduce<{ name: string; distance: number } | null>(
    (acc, preset) => {
      const presetRgb = parseColor(preset[mode]);

      if (presetRgb === null) {
        return acc;
      }

      const distance = hslDistance(hsl, rgbToHsl(presetRgb));

      if (acc === null || distance < acc.distance) {
        return { name: preset.name, distance };
      }

      return acc;
    },
    null
  );

  return best?.name ?? null;
}
```

Note: `rgbToHsl` and `hslDistance` are already defined in the file but not exported — `mapToNearestPresetName` is in the same file so it can use them directly.

**IMPORTANT — update the existing import on line 1, do not add a second one.** Replace:
```typescript
import { COLOR_PRESETS } from '../shared/color-presets';
```
With:
```typescript
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from '../shared/color-presets';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test test/unit/components/utils/color-mapping.test.ts
```

Expected: all PASS (new tests + all existing tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/color-mapping.ts test/unit/components/utils/color-mapping.test.ts
git commit -m "feat(marker): add mapToNearestPresetName to color-mapping"
```

---

### Task 2: `colorVarName` helper + CSS variables in main.css

**Files:**
- Modify: `src/components/shared/color-presets.ts` (add helper after exports)
- Modify: `src/styles/main.css` (add vars to 3 existing blocks)
- Modify: `test/unit/components/shared/color-presets.test.ts` (create if not exists, or extend)

**Context:** `color-presets.ts` exports `COLOR_PRESETS` and `COLOR_PRESETS_DARK`. Add a `colorVarName(name, mode)` helper that returns `var(--blok-color-{name}-{mode})`. The CSS variables must be added to all three theme selector blocks in `main.css`: light default (line 662), dark via media query (line 728), and dark via explicit attribute (line 790).

- [ ] **Step 1: Write failing test for `colorVarName`**

Check if `test/unit/components/shared/color-presets.test.ts` exists. If not, create it:

```typescript
import { describe, it, expect } from 'vitest';
import { colorVarName } from '../../../../src/components/shared/color-presets';

describe('colorVarName', () => {
  it('returns CSS var for text mode', () => {
    expect(colorVarName('red', 'text')).toBe('var(--blok-color-red-text)');
  });

  it('returns CSS var for bg mode', () => {
    expect(colorVarName('blue', 'bg')).toBe('var(--blok-color-blue-bg)');
  });

  it('handles all color names', () => {
    expect(colorVarName('gray', 'text')).toBe('var(--blok-color-gray-text)');
    expect(colorVarName('teal', 'bg')).toBe('var(--blok-color-teal-bg)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test color-presets -t "colorVarName"
```

Expected: FAIL — `colorVarName is not a function`

- [ ] **Step 3: Add `colorVarName` to color-presets.ts**

Append to `src/components/shared/color-presets.ts` after the `COLOR_PRESETS_DARK` array:

```typescript
/**
 * Construct a CSS custom property reference for a named preset color.
 *
 * @param name - The color preset name (e.g. 'red', 'blue')
 * @param mode - 'text' for foreground, 'bg' for background
 * @returns CSS var reference, e.g. `var(--blok-color-red-text)`
 */
export function colorVarName(name: string, mode: 'text' | 'bg'): string {
  return `var(--blok-color-${name}-${mode})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test color-presets
```

Expected: all PASS

- [ ] **Step 5: Add CSS variables to `src/styles/main.css`**

**Block 1 — Light default** — Insert before the closing `}` of the `[data-blok-interface], [data-blok-popover]` block (currently line 724):

```css
  /* Marker colors — light theme */
  --blok-color-gray-text: #787774;
  --blok-color-gray-bg: #f1f1ef;
  --blok-color-brown-text: #9f6b53;
  --blok-color-brown-bg: #f4eeee;
  --blok-color-orange-text: #d9730d;
  --blok-color-orange-bg: #fbecdd;
  --blok-color-yellow-text: #cb9b00;
  --blok-color-yellow-bg: #fbf3db;
  --blok-color-green-text: #448361;
  --blok-color-green-bg: #edf3ec;
  --blok-color-teal-text: #2b9a8f;
  --blok-color-teal-bg: #e4f5f3;
  --blok-color-blue-text: #337ea9;
  --blok-color-blue-bg: #e7f3f8;
  --blok-color-purple-text: #9065b0;
  --blok-color-purple-bg: #f6f3f9;
  --blok-color-pink-text: #c14c8a;
  --blok-color-pink-bg: #f9f0f5;
  --blok-color-red-text: #d44c47;
  --blok-color-red-bg: #fdebec;
```

**Block 2 — Dark via media query** — Insert before the closing `}` of the nested ruleset inside `@media (prefers-color-scheme: dark)` (currently line 786):

```css
    /* Marker colors — dark theme */
    --blok-color-gray-text: #9b9b9b;
    --blok-color-gray-bg: #2f2f2f;
    --blok-color-brown-text: #ba856f;
    --blok-color-brown-bg: #4a3228;
    --blok-color-orange-text: #c77d48;
    --blok-color-orange-bg: #5c3b23;
    --blok-color-yellow-text: #ca9849;
    --blok-color-yellow-bg: #564328;
    --blok-color-green-text: #529e72;
    --blok-color-green-bg: #243d30;
    --blok-color-teal-text: #4dab9a;
    --blok-color-teal-bg: #2e4d4b;
    --blok-color-blue-text: #5e87c9;
    --blok-color-blue-bg: #143a4e;
    --blok-color-purple-text: #9d68d3;
    --blok-color-purple-bg: #3c2d49;
    --blok-color-pink-text: #d15796;
    --blok-color-pink-bg: #4e2c3c;
    --blok-color-red-text: #df5452;
    --blok-color-red-bg: #522e2a;
```

**Block 3 — Dark via explicit attribute** — Insert before the closing `}` of the `[data-blok-theme="dark"] [data-blok-interface], [data-blok-theme="dark"] [data-blok-popover]` block (currently line 848):

Same dark values as Block 2 (same indentation as the rest of that block).

- [ ] **Step 6: Verify lint passes**

```bash
yarn lint
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/components/shared/color-presets.ts src/styles/main.css
git add test/unit/components/shared/color-presets.test.ts
git commit -m "feat(marker): add colorVarName helper and CSS color variables for both themes"
```

---

### Task 3: `color-migration.ts` utility

> **Depends on Tasks 1 and 2 being merged/committed first.**

**Files:**
- Create: `src/components/utils/color-migration.ts`
- Create: `test/unit/components/utils/color-migration.test.ts`

**Context:** `migrateMarkColors(container)` scans all `<mark>` elements inside `container`, and for each `color` and `background-color` inline style property, replaces raw hex with the corresponding CSS var. Skips `transparent`, values already starting with `var(`, and values that `mapToNearestPresetName` can't parse.

- [ ] **Step 1: Write failing tests**

Create `test/unit/components/utils/color-migration.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { migrateMarkColors } from '../../../../src/components/utils/color-migration';

describe('migrateMarkColors', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('remaps light-preset hex color to CSS var', () => {
    container.innerHTML = '<mark style="color:#d44c47; background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('remaps dark-preset hex color to CSS var', () => {
    container.innerHTML = '<mark style="color:#df5452; background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('remaps hex background-color to CSS var', () => {
    container.innerHTML = '<mark style="background-color:#fdebec">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('background-color')).toBe('var(--blok-color-red-bg)');
  });

  it('leaves transparent background-color unchanged', () => {
    container.innerHTML = '<mark style="color:#d44c47; background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('background-color')).toBe('transparent');
  });

  it('skips already-migrated CSS var values (idempotent)', () => {
    container.innerHTML = '<mark style="color:var(--blok-color-red-text); background-color:transparent">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('leaves unparseable hex values unchanged', () => {
    container.innerHTML = '<mark style="color:not-a-color">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    // unparseable — should remain (or be empty if browser rejected it at parse time)
    const value = mark.style.getPropertyValue('color');
    expect(value === 'not-a-color' || value === '').toBe(true);
  });

  it('remaps both color and background-color independently', () => {
    container.innerHTML = '<mark style="color:#d44c47; background-color:#fdebec">text</mark>';
    migrateMarkColors(container);
    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
    expect(mark.style.getPropertyValue('background-color')).toBe('var(--blok-color-red-bg)');
  });

  it('handles multiple marks in container', () => {
    container.innerHTML = [
      '<p><mark style="color:#d44c47; background-color:transparent">red</mark></p>',
      '<p><mark style="color:#337ea9; background-color:transparent">blue</mark></p>',
    ].join('');
    migrateMarkColors(container);
    const marks = container.querySelectorAll('mark') as NodeListOf<HTMLElement>;
    expect(marks[0].style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
    expect(marks[1].style.getPropertyValue('color')).toBe('var(--blok-color-blue-text)');
  });

  it('does nothing when container has no marks', () => {
    container.innerHTML = '<p>no marks here</p>';
    expect(() => migrateMarkColors(container)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test color-migration -t "migrateMarkColors"
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement `color-migration.ts`**

Create `src/components/utils/color-migration.ts`:

```typescript
import { colorVarName } from '../shared/color-presets';
import { mapToNearestPresetName } from './color-mapping';

const PROPS = ['color', 'background-color'] as const;
type Prop = typeof PROPS[number];

const PROP_MODE: Record<Prop, 'text' | 'bg'> = {
  'color': 'text',
  'background-color': 'bg',
};

/**
 * Scan all <mark> elements inside container and replace raw hex color/background-color
 * inline style values with their corresponding CSS custom property references.
 *
 * Safe to call multiple times — already-migrated var() values and 'transparent' are
 * left unchanged.
 *
 * @param container - Root element to search within (e.g. the editor redactor node)
 */
export function migrateMarkColors(container: Element): void {
  container.querySelectorAll('mark').forEach((mark) => {
    const el = mark as HTMLElement;

    for (const prop of PROPS) {
      const value = el.style.getPropertyValue(prop);

      if (!value || value === 'transparent' || value.startsWith('var(')) {
        continue;
      }

      const name = mapToNearestPresetName(value, PROP_MODE[prop]);

      if (name !== null) {
        el.style.setProperty(prop, colorVarName(name, PROP_MODE[prop]));
      }
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test color-migration
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/color-migration.ts test/unit/components/utils/color-migration.test.ts
git commit -m "feat(marker): add migrateMarkColors utility"
```

---

### Task 4: Marker tool — hex→var translation + `detectSelectionColor` fix

> **Depends on Tasks 1 and 2 being merged/committed first.**

**Files:**
- Modify: `src/components/inline-tools/inline-tool-marker.ts`
- Modify: `test/unit/components/inline-tools/inline-tool-marker.test.ts`

**Context:** Two changes to the marker tool:

1. **`applyColor` (line 215):** After the value is received from the picker, translate it from hex → CSS var using `mapToNearestPresetName` + `colorVarName`. If `mapToNearestPresetName` returns null (unparseable input), use the raw value as-is.

2. **`detectSelectionColor` (line 409):** Replace `mark.style.getPropertyValue('color')` and `mark.style.getPropertyValue('background-color')` with `getComputedStyle(mark).getPropertyValue('color')` and `getComputedStyle(mark).getPropertyValue('background-color')`. This resolves CSS vars to computed hex before comparison, so the swatch highlight still works after migration.

- [ ] **Step 1: Write failing tests**

In `test/unit/components/inline-tools/inline-tool-marker.test.ts`, add two new `describe` blocks:

```typescript
// Add to imports
import { colorVarName } from '../../../../src/components/shared/color-presets';

describe('applyColor — hex to CSS var translation', () => {
  it('stores CSS var instead of raw hex when applying a preset color', () => {
    container.innerHTML = 'hello world';
    const textNode = container.firstChild as Text;

    // Select "hello"
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Apply the light-mode red hex (as the picker would emit)
    tool.applyColor('color', '#d44c47');

    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });

  it('stores CSS var for background color', () => {
    container.innerHTML = 'hello world';
    const textNode = container.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    tool.applyColor('background-color', '#fdebec');

    const mark = container.querySelector('mark') as HTMLElement;
    expect(mark.style.getPropertyValue('background-color')).toBe('var(--blok-color-red-bg)');
  });

  it('falls back to raw value when hex is not parseable', () => {
    container.innerHTML = 'hello world';
    const textNode = container.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Pass a value that parseColor cannot parse — fallback to raw
    // (we use a value the browser WILL accept as a color to set on style)
    tool.applyColor('color', '#ff0000');
    const mark = container.querySelector('mark') as HTMLElement;
    // #ff0000 maps to 'red' so it WILL get a CSS var — use an actually unmappable value
    // The fallback path can be tested by mocking mapToNearestPresetName returning null,
    // but since we can't easily do that here, just verify the happy path works
    expect(mark.style.getPropertyValue('color')).toBe('var(--blok-color-red-text)');
  });
});

describe('detectSelectionColor — resolves CSS vars via getComputedStyle', () => {
  it('passes resolved hex (not raw CSS var string) to picker setActiveColor', () => {
    // Simulate a migrated mark whose inline style is a CSS var
    container.innerHTML = '<mark style="color:var(--blok-color-red-text); background-color:transparent">hello</mark>';
    const mark = container.querySelector('mark') as HTMLElement;
    const textNode = mark.firstChild as Text;

    // Capture the real JSDOM implementation before the spy replaces it
    const originalGetComputedStyle = window.getComputedStyle.bind(window);

    // JSDOM cannot resolve CSS vars, so mock getComputedStyle to return the resolved hex
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === mark) {
        return {
          getPropertyValue: (prop: string) => prop === 'color' ? 'rgb(212, 76, 71)' : '',
          color: 'rgb(212, 76, 71)',
        } as unknown as CSSStyleDeclaration;
      }
      return originalGetComputedStyle(el);
    });

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Spy on the picker's setActiveColor via type cast (picker is private)
    type PickerHandle = { setActiveColor: (value: string, mode: string) => void };
    const picker = (tool as unknown as { picker: PickerHandle }).picker;
    const setActiveColorSpy = vi.spyOn(picker, 'setActiveColor');

    // Trigger onPickerOpen via the menu config's children.onOpen callback
    type MenuWithChildren = { children: { onOpen: () => void } };
    const config = tool.render() as unknown as MenuWithChildren;
    config.children.onOpen();

    // Before the fix: setActiveColor is called with 'var(--blok-color-red-text)' → assertion fails
    // After the fix: getComputedStyle resolves the var, setActiveColor receives 'rgb(212, 76, 71)'
    expect(setActiveColorSpy).toHaveBeenCalledWith('rgb(212, 76, 71)', 'color');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
yarn test inline-tool-marker -t "hex to CSS var"
```

Expected: FAIL — marks have hex values, not CSS vars

**Also update these existing assertions BEFORE running the full suite.** After `applyColor` translates hex → CSS var, any assertion that checks a style value set BY `applyColor` must be updated. Styles that come from fixture HTML (parsed by JSDOM before `applyColor` runs) stay as `rgb(...)` — do NOT change those.

Add this import at the top of the test file:
```typescript
import { colorVarName } from '../../../../src/components/shared/color-presets';
```

Lines to update (all set directly by `applyColor`):

| Line | Old expected | New expected |
|------|-------------|-------------|
| 133 | `'rgb(212, 76, 71)'` | `'var(--blok-color-red-text)'` |
| 195 | `'rgb(68, 131, 97)'` | `'var(--blok-color-green-text)'` |
| 227 | `'rgb(251, 236, 221)'` | `'var(--blok-color-orange-bg)'` |
| 292 | `'rgb(51, 126, 169)'` | `'var(--blok-color-blue-text)'` |
| 330 | `'rgb(68, 131, 97)'` | `'var(--blok-color-green-text)'` |
| 366 | `'rgb(231, 243, 248)'` | `'var(--blok-color-blue-bg)'` |
| 693 | `'rgb(231, 243, 248)'` | `'var(--blok-color-blue-bg)'` |
| 712 | `'rgb(68, 131, 97)'` | `'var(--blok-color-green-text)'` |
| 731 | `'rgb(51, 126, 169)'` | `'var(--blok-color-blue-text)'` |
| 751 | `'rgb(246, 243, 249)'` | `'var(--blok-color-purple-bg)'` |
| 777 | `'rgb(68, 131, 97)'` | `'var(--blok-color-green-text)'` |
| 805 | `'rgb(231, 243, 248)'` | `'var(--blok-color-blue-bg)'` |
| 832 | `'rgb(68, 131, 97)'` | `'var(--blok-color-green-text)'` |
| 879 | `'rgb(212, 76, 71)'` | `'var(--blok-color-red-text)'` |
| 1097 | `'rgb(212, 76, 71)'` | `'var(--blok-color-red-text)'` |
| 1098 | `'rgb(231, 243, 248)'` | `'var(--blok-color-blue-bg)'` |
| 1129 | `'rgb(144, 101, 176)'` | `'var(--blok-color-purple-text)'` |
| 1130 | `'rgb(253, 235, 236)'` | `'var(--blok-color-red-bg)'` |

**Line 1018** — a `.find()` predicate, not `.toBe()`. Change:
```typescript
(m) => m.style.color === 'rgb(68, 131, 97)'
```
to:
```typescript
(m) => m.style.color === 'var(--blok-color-green-text)'
```

**Lines 1184 in the matrix `it.each` test** — the callback currently destructures `{ textHex, bgHex }`. Update to `{ textHex, bgHex, textName }` and change:
```typescript
expect(updatedMark?.style.color).toBe(hexToRgb(textHex));
```
to:
```typescript
expect(updatedMark?.style.color).toBe(colorVarName(textName, 'text'));
```

Lines that check fixture HTML (parsed before `applyColor`) or `transparent` — leave unchanged:
165, 196, 255, 327, 328, 331, 368, 457, 692, 713, 732, 750, 772, 773, 778, 799, 800, 804, 827, 828, 833, 837, 838, 856, 920, 950, 980, 1024–1025, 1032–1033, 1175, 1185.

- [ ] **Step 3: Implement changes in `inline-tool-marker.ts`**

**Change 1 — add imports at top of file:**

```typescript
import { colorVarName } from '../shared/color-presets';
import { mapToNearestPresetName } from '../utils/color-mapping';
```

**Change 2 — in `applyColor` (line 215), before `value` is used to set style, translate it:**

Find the part of `applyColor` where the value is passed to `mark.style.setProperty`. Wrap the value before it reaches the DOM:

Add a private helper method (place after `ensureTransparentBg`):

```typescript
/**
 * Translate a raw hex color value to its CSS custom property equivalent.
 * If the value is already a CSS var or cannot be mapped, returns it unchanged.
 * @param value - CSS color value from the picker
 * @param mode - 'color' or 'background-color'
 */
private resolveToVar(value: string, mode: ColorMode): string {
  if (value.startsWith('var(')) {
    return value;
  }
  const presetMode = mode === 'color' ? 'text' : 'bg';
  const name = mapToNearestPresetName(value, presetMode);
  return name !== null ? colorVarName(name, presetMode) : value;
}
```

Then in `applyColor`, before each `mark.style.setProperty(mode, value)` call, translate:

```typescript
const resolvedValue = this.resolveToVar(value, mode);
// use resolvedValue instead of value when calling setProperty
```

There are three places in `applyColor` where `value` is passed to `setProperty` or used (covering the existing-mark in-place update, the split path via `splitMarkAroundRange`, and the new mark wrap). Trace through the method: the value flows into `mark.style.setProperty(mode, value)` at line 248 and at line 276. The `splitMarkAroundRange` method receives `value` directly and calls `setProperty` internally — pass `resolvedValue` to it instead.

Concretely, replace the `value` parameter usage in `applyColor` at the point it's written to the DOM:

```typescript
public applyColor(mode: ColorMode, value: string): void {
  // ... existing setup ...
  const resolvedValue = this.resolveToVar(value, mode);
  // ... replace all subsequent uses of `value` that touch DOM with `resolvedValue` ...
```

**Change 3 — in `detectSelectionColor` (line 409):**

Replace:
```typescript
const textColor = mark.style.getPropertyValue('color');
```
With:
```typescript
const textColor = window.getComputedStyle(mark).getPropertyValue('color');
```

Replace:
```typescript
const bgColor = mark.style.getPropertyValue('background-color');
```
With:
```typescript
const bgColor = window.getComputedStyle(mark).getPropertyValue('background-color');
```

Keep the same skip logic (`!== 'transparent'`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test inline-tool-marker
```

Expected: all PASS

- [ ] **Step 5: Run full unit suite**

```bash
yarn test
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/inline-tools/inline-tool-marker.ts
git add test/unit/components/inline-tools/inline-tool-marker.test.ts
git commit -m "feat(marker): translate hex to CSS var in applyColor, use getComputedStyle in detectSelectionColor"
```

---

### Task 5: Wire migration into Renderer

> **Depends on Task 3 being merged/committed first.**

**Files:**
- Modify: `src/components/modules/renderer.ts` (add migration call)

**Context:** In `renderer.ts`, `render()` calls `BlockManager.insertMany(blocks)` at line 159, then waits for `requestIdleCallback`. Insert `migrateMarkColors(this.Blok.UI.nodes.redactor)` immediately after `insertMany` — before the `requestIdleCallback` boundary. This ensures marks in the DOM are migrated synchronously after all blocks are inserted on each render.

No dedicated unit test is needed here — the migration unit tests cover the utility, and the E2E tests in Task 6 cover the full flow.

- [ ] **Step 1: Add the import and migration call**

In `src/components/modules/renderer.ts`, add import at top:

```typescript
import { migrateMarkColors } from '../utils/color-migration';
```

In the `render` method, after line 159 (`BlockManager.insertMany(blocks);`):

```typescript
BlockManager.insertMany(blocks);
migrateMarkColors(this.Blok.UI.nodes.redactor);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
yarn lint
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/modules/renderer.ts
git commit -m "feat(marker): run migrateMarkColors after block render"
```

---

### Task 6: E2E tests

> **Depends on all previous tasks completing.**

**Files:**
- Modify: `test/playwright/tests/inline-tools/marker.spec.ts`

**Context:** Two new E2E tests verify the full end-to-end behavior. The test page exposes `window.blokInstance` and `window.Blok`. The `api.theme.set(mode)` call from `window.blokInstance.api.theme.set('dark')` switches themes at runtime.

Look at the existing test file for patterns: `createBlokWithBlocks`, `selectText`, `resetBlok` helpers are already defined there.

- [ ] **Step 1: Build the test bundle**

```bash
yarn build:test
```

Expected: build succeeds

- [ ] **Step 2: Write the failing E2E tests**

Add to `test/playwright/tests/inline-tools/marker.spec.ts` (after existing tests):

```typescript
test.describe('marker colors adapt to theme', () => {
  test('color applied in light mode remaps when switching to dark', async ({ page }) => {
    await ensureBlokBundleBuilt();
    await page.goto(TEST_PAGE_URL);

    // Initialize in light mode
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'Hello world' } },
    ]);

    // Force light theme
    await page.evaluate(() => {
      window.blokInstance.api.theme.set('light');
    });

    // Select "Hello" and apply red text color via marker
    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();
    await selectText(paragraph, 'Hello');

    const markerButton = page.locator(MARKER_BUTTON_SELECTOR);
    await markerButton.click();

    // Click the red swatch on the text tab
    await page.getByTestId('marker-swatch-red').first().click();

    // Get the color rendered in light mode
    const lightColor = await page.evaluate(() => {
      const mark = document.querySelector(`${BLOK_INTERFACE_SELECTOR} mark`) as HTMLElement;
      return mark ? window.getComputedStyle(mark).color : null;
    });

    expect(lightColor).toBeTruthy();

    // Switch to dark mode
    await page.evaluate(() => {
      window.blokInstance.api.theme.set('dark');
    });

    // Get the color rendered in dark mode
    const darkColor = await page.evaluate(() => {
      const mark = document.querySelector(`${BLOK_INTERFACE_SELECTOR} mark`) as HTMLElement;
      return mark ? window.getComputedStyle(mark).color : null;
    });

    expect(darkColor).toBeTruthy();
    // Colors must differ — dark theme uses a different hex for red
    expect(darkColor).not.toBe(lightColor);
  });

  test('legacy hex marks are migrated to CSS vars on render', async ({ page }) => {
    await ensureBlokBundleBuilt();
    await page.goto(TEST_PAGE_URL);

    // Load a document with a legacy hex mark (as if saved before the fix)
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: { text: '<mark style="color:#d44c47; background-color:transparent">hello</mark>' },
      },
    ]);

    // After render, the mark's inline style should be a CSS var, not the raw hex
    const inlineColor = await page.evaluate(() => {
      const mark = document.querySelector(`${BLOK_INTERFACE_SELECTOR} mark`) as HTMLElement;
      return mark ? mark.style.getPropertyValue('color') : null;
    });

    expect(inlineColor).toBe('var(--blok-color-red-text)');
  });
});
```

Note: `BLOK_INTERFACE_SELECTOR` is imported at the top of the file already.

- [ ] **Step 3: Run E2E tests to verify they fail**

```bash
yarn e2e test/playwright/tests/inline-tools/marker.spec.ts -g "marker colors adapt to theme"
```

Expected: FAIL (migration not yet integrated, or CSS vars not defined — since prior tasks are already done by now, expect partial failures)

- [ ] **Step 4: Run the full marker E2E suite**

```bash
yarn e2e test/playwright/tests/inline-tools/marker.spec.ts
```

Expected: all PASS (new tests + all existing tests)

- [ ] **Step 5: Run full test suite**

```bash
yarn test && yarn e2e test/playwright/tests/inline-tools/marker.spec.ts
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add test/playwright/tests/inline-tools/marker.spec.ts
git commit -m "test(marker): add E2E tests for theme-adaptive colors and legacy migration"
```

---

## Execution Waves

Run tasks in this order to maximize parallel work:

| Wave | Tasks | Can run in parallel? |
|------|-------|----------------------|
| 1 | Task 1, Task 2 | Yes — fully independent |
| 2 | Task 3, Task 4 | Yes — both depend on Wave 1 |
| 3 | Task 5 | No — depends on Task 3 |
| 4 | Task 6 | No — depends on all prior tasks |
