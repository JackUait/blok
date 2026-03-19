# Marker Theme Color Migration Design

**Date:** 2026-03-19
**Status:** Approved for implementation

---

## Problem

Marker colors are stored as raw hex values in inline styles on `<mark>` elements (e.g., `style="color:#df5452"`). When the user switches between light and dark themes, these inline styles do not update — inline styles have highest CSS specificity and override all theme-driven CSS variable changes. The semantic identity of the color (e.g., "red") is lost at storage time; only the theme-specific hex survives.

---

## Solution

Use CSS custom properties (`var(--blok-color-red-text)`) as the stored value instead of hex codes. CSS variables resolve at paint time, so they adapt automatically when `data-blok-theme` changes. A migration utility converts legacy hex values to CSS vars on every editor load.

The color picker remains generic — it continues emitting hex values. The marker tool translates hex → CSS var internally before applying to the `<mark>` element. The table cell color picker is unaffected.

---

## Architecture

Five discrete components, each with a single responsibility:

1. **CSS variables** — 20 new vars (`--blok-color-{name}-{mode}`) in `main.css`, defined for both themes
2. **`colorVarName` helper** — constructs a CSS var reference from a color name and mode
3. **Marker tool** — translates the picker's hex output → CSS var before applying to `<mark>`; uses `getComputedStyle` for swatch highlighting to resolve vars back to hex for comparison
4. **Migration utility** — scans rendered `<mark>` elements after each render, converts hex → CSS var
5. **`mapToNearestPresetName`** — extends existing HSL-distance logic to return a color name instead of a hex; searches both light and dark presets for correct name recovery

---

## Data Flow

### New color applied (post-fix)

1. User picks "red" text → picker emits `#d44c47` (light) or `#df5452` (dark) as before
2. Marker tool calls `mapToNearestPresetName(hex, mode)` → `'red'`, then `colorVarName('red', 'text')` → `var(--blok-color-red-text)`
3. Marker sets `mark.style.color = 'var(--blok-color-red-text)'`
4. Browser resolves the var to `#d44c47` (light) or `#df5452` (dark) based on `data-blok-theme`
5. Stored as `<mark style="color:var(--blok-color-red-text); background-color:transparent">`
6. Theme switch → CSS variable re-resolves automatically, no DOM update needed

### Active swatch highlight with a migrated mark

When the picker opens on a selection that has `var(--blok-color-red-text)` in its inline style, `mark.style.color` returns the raw var string, which `parseColor` cannot parse. To avoid a broken highlight, the marker tool must use `getComputedStyle(mark).color` (which resolves to the current computed hex) when passing the active color to the picker. The picker's `colorsEqual` then compares hex-to-hex as before.

### Legacy content on load (migration path)

1. Renderer renders `<mark style="color:#d44c47">` from stored data
2. After `BlockManager.insertMany`, migration runs on `this.Blok.UI.nodes.redactor`
3. `mapToNearestPresetName('#d44c47', 'text')` → `'red'`
4. Rewrites to `mark.style.color = 'var(--blok-color-red-text)'`
5. Displays correctly in both themes immediately
6. On next user save, stored data permanently contains the CSS var; migration is a no-op thereafter

Note: until the user saves, each load re-runs the migration (idempotent, ~O(n) marks). This is a conscious tradeoff — no force-save is triggered.

### Edge cases

| Value | Behavior |
|-------|----------|
| `transparent` | Skipped — not a color to remap |
| `var(--blok-color-red-text)` | Skipped — already migrated (idempotent) |
| Unparseable hex | Left as-is — no regression |
| Near-miss hex (e.g., `#3a7bd5`) | Mapped to nearest preset by HSL distance |
| Dark-theme hex (e.g., `#df5452`) | Correctly maps to `'red'` — searching both light and dark presets guarantees the right name |

---

## File Changes

### `src/styles/main.css`

Add 20 new CSS variables to **all three** existing theme selector blocks:

**Block 1 — light default** (`[data-blok-interface], [data-blok-popover]`):
```css
--blok-color-gray-text: #787774;    --blok-color-gray-bg: #f1f1ef;
--blok-color-brown-text: #9f6b53;   --blok-color-brown-bg: #f4eeee;
--blok-color-orange-text: #d9730d;  --blok-color-orange-bg: #fbecdd;
--blok-color-yellow-text: #cb9b00;  --blok-color-yellow-bg: #fbf3db;
--blok-color-green-text: #448361;   --blok-color-green-bg: #edf3ec;
--blok-color-teal-text: #2b9a8f;    --blok-color-teal-bg: #e4f5f3;
--blok-color-blue-text: #337ea9;    --blok-color-blue-bg: #e7f3f8;
--blok-color-purple-text: #9065b0;  --blok-color-purple-bg: #f6f3f9;
--blok-color-pink-text: #c14c8a;    --blok-color-pink-bg: #f9f0f5;
--blok-color-red-text: #d44c47;     --blok-color-red-bg: #fdebec;
```

**Block 2 — dark via media query** (`@media (prefers-color-scheme: dark) { :root:not([data-blok-theme="light"]) [data-blok-interface], :root:not([data-blok-theme="light"]) [data-blok-popover] }`):
```css
--blok-color-gray-text: #9b9b9b;    --blok-color-gray-bg: #2f2f2f;
--blok-color-brown-text: #ba856f;   --blok-color-brown-bg: #4a3228;
--blok-color-orange-text: #c77d48;  --blok-color-orange-bg: #5c3b23;
--blok-color-yellow-text: #ca9849;  --blok-color-yellow-bg: #564328;
--blok-color-green-text: #529e72;   --blok-color-green-bg: #243d30;
--blok-color-teal-text: #4dab9a;    --blok-color-teal-bg: #2e4d4b;
--blok-color-blue-text: #5e87c9;    --blok-color-blue-bg: #143a4e;
--blok-color-purple-text: #9d68d3;  --blok-color-purple-bg: #3c2d49;
--blok-color-pink-text: #d15796;    --blok-color-pink-bg: #4e2c3c;
--blok-color-red-text: #df5452;     --blok-color-red-bg: #522e2a;
```

**Block 3 — dark via explicit attribute** (`[data-blok-theme="dark"] [data-blok-interface], [data-blok-theme="dark"] [data-blok-popover]`):
Same dark values as Block 2.

### `src/components/shared/color-presets.ts`
Add one helper function:

```typescript
export function colorVarName(name: string, mode: 'text' | 'bg'): string {
  return `var(--blok-color-${name}-${mode})`;
}
```

### `src/components/utils/color-mapping.ts`
Add alongside the existing `mapToNearestPresetColor`:

```typescript
/**
 * Map an arbitrary CSS color to the name of the nearest Blok preset color.
 *
 * Searches both light and dark presets to correctly recover the semantic name
 * from hex values that originated in either theme.
 *
 * @param cssColor - CSS color string (hex or rgb)
 * @param mode - 'text' for text color presets, 'bg' for background presets
 * @returns the nearest preset name (e.g. 'red'), or null if unparseable
 */
export function mapToNearestPresetName(cssColor: string, mode: 'text' | 'bg'): string | null
```

Implementation: same HSL distance logic, but searches `[...COLOR_PRESETS, ...COLOR_PRESETS_DARK]` and returns `preset.name` instead of `preset[mode]`. Returns `null` if the color string cannot be parsed. When two entries are equidistant (possible since light and dark variants of the same name both appear in the pool), the first match wins — same tie-breaking behavior as `mapToNearestPresetColor`.

### `src/components/inline-tools/inline-tool-marker.ts`
Two changes:

**1. Translate hex → CSS var in `applyColor()`:**
After the picker returns a hex value, call `mapToNearestPresetName(hex, mode)` and apply `colorVarName(name, mode)` to the mark element instead of the raw hex. If `mapToNearestPresetName` returns null (unparseable), fall back to the raw hex.

**2. Use `getComputedStyle` for swatch highlight in `detectSelectionColor`:**
In `detectSelectionColor`, replace both `mark.style.getPropertyValue('color')` and `mark.style.getPropertyValue('background-color')` with `getComputedStyle(mark).getPropertyValue('color')` and `getComputedStyle(mark).getPropertyValue('background-color')` respectively. This resolves CSS var references to their computed hex values before they are passed to `picker.setActiveColor`, ensuring `colorsEqual` receives two hex values and can compare them correctly via the existing HSL logic. No changes are needed to `colorsEqual` itself.

### `src/components/utils/color-migration.ts` *(new file)*

```typescript
/**
 * Scan all <mark> elements inside container and replace raw hex color/background-color
 * inline style values with their corresponding CSS custom property references.
 *
 * Safe to call multiple times — already-migrated var() values and 'transparent' are
 * left unchanged.
 */
export function migrateMarkColors(container: Element): void
```

Implementation:
- `container.querySelectorAll('mark')`
- For `color` and `background-color` properties, read the inline style value
- Skip if empty, `'transparent'`, or starts with `'var('`
- Call `mapToNearestPresetName(value, mode)` — if non-null, `mark.style.setProperty(prop, colorVarName(name, mode))`

### `src/components/modules/renderer.ts`
Call `migrateMarkColors(this.Blok.UI.nodes.redactor)` immediately after the `BlockManager.insertMany(blocks)` call (before the `requestIdleCallback` boundary).

---

## Sanitizer Compatibility

No sanitizer changes needed. The sanitizer whitelist checks *which CSS properties* are present (`color`, `background-color`) — not their values. `var(--blok-color-red-text)` is a valid CSS value and passes through unchanged. The existing transparent-background check (`style.getPropertyValue('color')`) returns the string `'var(--blok-color-red-text)'`, which is truthy — so that logic continues to work correctly.

---

## Testing

### Unit — `color-mapping.test.ts` (extend)
- `mapToNearestPresetName` returns correct name for exact light-preset hex
- Returns correct name for exact dark-preset hex (e.g., `#df5452` → `'red'`)
- Returns correct name for near-miss hex (HSL distance picks right color)
- Returns `null` for unparseable input

### Unit — `color-migration.test.ts` (new)
- Hex `color` value → remapped to CSS var
- Hex `background-color` value → remapped to CSS var
- `transparent` → left unchanged
- Already `var(--blok-color-red-text)` → left unchanged (idempotent)
- Unparseable hex → left unchanged (no regression)
- Mark with both properties → both remapped independently

### Unit — `inline-tool-marker.test.ts` (extend)
- `applyColor` stores `var(--blok-color-red-text)` not the raw hex
- Opening picker on a migrated mark (`var(...)` inline style) highlights the correct swatch

### E2E — `marker.spec.ts` (extend)
- Apply red text in light mode → switch to dark → verify rendered color adapts
- Load a document containing legacy hex marks → verify migration remaps on render
