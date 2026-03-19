# Marker Theme Color Migration Design

**Date:** 2026-03-19
**Status:** Approved for implementation

---

## Problem

Marker colors are stored as raw hex values in inline styles on `<mark>` elements (e.g., `style="color:#df5452"`). When the user switches between light and dark themes, these inline styles do not update — inline styles have highest CSS specificity and override all theme-driven CSS variable changes. The semantic identity of the color (e.g., "red") is lost at storage time; only the theme-specific hex survives.

---

## Solution

Use CSS custom properties (`var(--blok-color-red-text)`) as the stored value instead of hex codes. CSS variables resolve at paint time, so they adapt automatically when `data-blok-theme` changes. A migration utility converts legacy hex values to CSS vars on every editor load.

---

## Architecture

Four discrete components, each with a single responsibility:

1. **CSS variables** — 20 new vars (`--blok-color-{name}-{mode}`) in `main.css`, defined for both themes
2. **Color picker** — emits `var(--blok-color-red-text)` instead of `#d44c47` when a swatch is clicked
3. **Migration utility** — scans rendered `<mark>` elements after each render, converts hex → CSS var
4. **`mapToNearestPresetName`** — extends existing HSL-distance logic to return a color name instead of a hex

---

## Data Flow

### New color applied (post-fix)

1. User picks "red" text → picker constructs `var(--blok-color-red-text)`
2. Marker sets `mark.style.color = 'var(--blok-color-red-text)'`
3. Browser resolves the var to `#d44c47` (light) or `#df5452` (dark) based on `data-blok-theme`
4. Stored as `<mark style="color:var(--blok-color-red-text); background-color:transparent">`
5. Theme switch → CSS variable re-resolves automatically, no DOM update needed

### Legacy content on load (migration path)

1. Renderer renders `<mark style="color:#d44c47">` from stored data
2. Migration runs: `mapToNearestPresetName('#d44c47', 'text')` → `'red'`
3. Rewrites to `mark.style.color = 'var(--blok-color-red-text)'`
4. Displays correctly in both themes immediately
5. On next user save, stored data permanently contains the CSS var

### Edge cases

| Value | Behavior |
|-------|----------|
| `transparent` | Skipped — not a color to remap |
| `var(--blok-color-red-text)` | Skipped — already migrated (idempotent) |
| Unparseable hex | Left as-is — no regression |
| Near-miss hex (e.g., `#3a7bd5`) | Mapped to nearest preset by HSL distance |

---

## File Changes

### `src/styles/main.css`
Add 20 new CSS variables under existing light and dark theme selectors:

```css
/* Light (default) — inside existing [data-blok-interface] block */
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

/* Dark — inside existing dark theme selectors */
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
 * @param cssColor - CSS color string (hex or rgb)
 * @param mode - 'text' for text color presets, 'bg' for background presets
 * @returns the nearest preset name (e.g. 'red'), or null if unparseable
 */
export function mapToNearestPresetName(cssColor: string, mode: 'text' | 'bg'): string | null
```

Same HSL distance logic as `mapToNearestPresetColor`, but returns `preset.name` instead of `preset[mode]`. Returns `null` if the color string cannot be parsed.

### `src/components/shared/color-picker.ts`
In the swatch click handler, emit `colorVarName(preset.name, mode)` instead of `preset[mode]`.

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
- For each mark, check `color` and `background-color` inline style values
- Skip if empty, `transparent`, or starts with `var(`
- Call `mapToNearestPresetName(value, mode)` — if result is non-null, set `mark.style.setProperty(prop, colorVarName(name, mode))`

### `src/components/modules/renderer.ts`
Call `migrateMarkColors(this.Editor.UI.nodes.redactor)` at the end of `render()`.

---

## Sanitizer Compatibility

No sanitizer changes needed. The sanitizer whitelist checks *which CSS properties* are present (`color`, `background-color`) — not their values. `var(--blok-color-red-text)` is a valid CSS value and passes through unchanged. The existing transparent-background check (`style.getPropertyValue('color')`) returns the string `'var(--blok-color-red-text)'`, which is truthy — so that logic continues to work correctly.

---

## Migration Persistence

The migration runs in-memory on every editor load (idempotent). Migrated values are persisted naturally on the user's next save — no force-save is triggered. Until that save occurs, each load re-runs the migration (harmless, ~O(n) marks). After the first user save, stored data contains CSS vars and the migration becomes a no-op for that document.

---

## Testing

### Unit — `color-mapping.test.ts` (extend)
- `mapToNearestPresetName` returns correct name for exact preset hex
- Returns correct name for near-miss hex (HSL distance picks right color)
- Returns `null` for unparseable input

### Unit — `color-migration.test.ts` (new)
- Hex `color` value → remapped to CSS var
- Hex `background-color` value → remapped to CSS var
- `transparent` → left unchanged
- Already `var(--blok-color-red-text)` → left unchanged (idempotent)
- Unparseable hex → left unchanged (no regression)
- Mark with both properties → both remapped independently

### Unit — `color-picker.test.ts` (extend)
- Swatch click emits `var(--blok-color-red-text)` not `#d44c47`

### E2E — `marker.spec.ts` (extend)
- Apply red text in light mode → switch to dark → verify rendered color adapts
- Load a document containing legacy hex marks → verify migration remaps on render
