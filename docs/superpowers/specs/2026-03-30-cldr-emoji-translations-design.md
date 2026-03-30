# CLDR Emoji Name Translations

**Date:** 2026-03-30
**Status:** Draft
**Branch:** feature/callout-block

## Problem

The emoji picker shows English names for all emojis regardless of the user's locale. Tooltips display "Grinning Face" even when the editor UI is fully translated to French, Japanese, etc. Search also only works with English terms.

**Root cause:** `@emoji-mart/data` provides emoji names and keywords in English only. There is no translation layer between emoji-mart's data and the picker's display.

## Solution

Use Unicode CLDR emoji annotations to translate emoji names and keywords. A build script extracts CLDR data, filters it to the ~1,870 emojis emoji-mart uses, and writes per-locale JSON files. These are lazy-loaded at runtime when the emoji picker opens.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search behavior | Dual-language (translated + English) | Users know English terms from other apps |
| Locale coverage | All 68, best-effort | Lazy-loading means unused locales cost nothing |
| Data delivery | Standalone emoji locale module | Zero cost when picker isn't used, decoupled from core i18n |
| Data source | Build script from `cldr-annotations-full` npm package | Reproducible, updatable with `yarn upgrade` |
| Loading UX | English names immediately, swap when ready | No perceived delay, flash unlikely in practice |

## Design

### 1. Data Pipeline

**Build script:** `scripts/build-emoji-locale-data.mjs`

1. Reads `cldr-annotations-full` (devDependency) JSON files at `node_modules/cldr-annotations-full/annotations/{locale}/annotations.json`
2. Reads `@emoji-mart/data` to get the set of ~1,870 emoji native characters the picker uses
3. For each of the 68 supported Blok locales:
   - Finds the matching CLDR locale (with mapping for mismatches, e.g., `no` -> `nb`)
   - Extracts only the emojis present in emoji-mart, discarding the rest
   - Writes a trimmed JSON file: `src/tools/callout/emoji-picker/locales/{locale}.json`
4. Locales without CLDR coverage get no file (English fallback at runtime)
5. English file is omitted since emoji-mart already provides English names/keywords

**Output format per locale** (e.g., `fr.json`):

```json
{
  "😀": { "n": "visage souriant", "k": ["joyeux", "rire", "sourire"] },
  "😃": { "n": "visage souriant avec grands yeux", "k": ["heureux", "joie"] }
}
```

Short keys (`n` for name, `k` for keywords) to minimize file size.

**CLDR-to-Blok locale mapping** for mismatches:

| Blok locale | CLDR locale | Notes |
|---|---|---|
| `no` | `nb` | Norwegian Bokmal |

Most locales match exactly. The build script tries exact match first, falls back to the mapping table, and skips with a warning if no CLDR data is found.

**Coverage estimate:** ~50-55 of 68 Blok locales will have full CLDR annotations. The remaining 10-15 smaller languages fall back to English.

The build script logs a coverage report showing emoji count per locale.

### 2. Locale Loading Architecture

**New module:** `src/tools/callout/emoji-picker/emoji-locale.ts`

Responsibilities:
- Lazy-loads per-locale JSON when the emoji picker opens
- Caches loaded data in a module-level `Map<string, EmojiLocaleData>`
- Provides lookup: `getTranslatedName(native, locale)` and `getTranslatedKeywords(native, locale)`
- Falls back to English when locale data is missing or a specific emoji has no translation

**Dynamic imports** via a map (same pattern as main locale system):

```typescript
const emojiLocaleImporters: Record<string, () => Promise<{ default: EmojiLocaleData }>> = {
  fr: () => import('./locales/fr.json'),
  de: () => import('./locales/de.json'),
  // ... one entry per locale with CLDR coverage
};
```

Vite code-splits each into its own chunk.

**Loading flow:**

1. Emoji picker opens -> `loadEmojiData()` fires (existing)
2. In parallel, `loadEmojiLocale(locale)` fires for the current locale
3. Both resolve -> picker renders with translated names
4. If locale data resolves after emoji data, tooltips update in-place via `updateTooltips()`

### 3. Emoji Picker Integration

**Search (dual-language):**

`searchEmojis()` gains an optional locale data parameter. It matches against:
- Translated name and translated keywords (from CLDR)
- English name and English keywords (from emoji-mart, always available)
- Union of both result sets, deduplicated

**Tooltips/hover:**

```typescript
const displayName = getTranslatedName(emoji.native, locale) ?? emoji.name;
btn.title = displayName;
onHover(btn, displayName, { placement: 'bottom' });
```

**Late-swap for async loading:**

If emoji locale data arrives after the grid is already rendered, `updateTooltips()` iterates existing buttons by `data-emoji-native` attribute, swaps their `title` attributes, and re-registers `onHover` tooltips with the translated name. Same traversal pattern as the existing `setSkinTone()` method.

**No changes to:** emoji selection, saved data format, skin tone logic, category navigation, grid layout.

### 4. API Surface Changes

**One addition to public I18n API** (`types/api/i18n.d.ts`):

```typescript
export interface I18n {
  t(dictKey: string): string;
  has(dictKey: string): boolean;
  getEnglishTranslation(key: string): string;
  getLocale(): string;  // NEW
}
```

The internal `I18n` module already has this method. `I18nAPI` wires it through.

**EmojiPickerOptions gains `locale: string`**, passed from CalloutTool via `this.api.i18n.getLocale()`.

No other public API changes. The emoji locale system is entirely internal to the callout tool.

### 5. File Structure & Bundle Impact

**New files:**

```
scripts/build-emoji-locale-data.mjs             # Build script
src/tools/callout/emoji-picker/emoji-locale.ts   # Loader + cache + lookup
src/tools/callout/emoji-picker/locales/          # Generated JSON (~50-55 files)
```

**Modified files:**

```
package.json                                     # Add cldr-annotations-full devDep
types/api/i18n.d.ts                             # Add getLocale()
src/components/modules/api/i18n.ts              # Wire getLocale()
src/tools/callout/emoji-picker/index.ts         # Translated names, dual search
src/tools/callout/emoji-picker/emoji-data.ts    # Accept optional locale data in search
src/tools/callout/index.ts                      # Pass locale to EmojiPicker
```

**Bundle impact:**

- English users: Zero additional cost
- Non-English users: ~40-60KB per locale (gzipped ~8-15KB), loaded only when emoji picker opens
- Each locale JSON becomes its own Vite chunk
- devDependency: `cldr-annotations-full` ~57MB, build-only, not shipped

No changes to main bundle size, editor initialization time, or the core i18n system.
