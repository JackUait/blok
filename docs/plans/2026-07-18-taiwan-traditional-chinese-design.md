# Taiwan Traditional Chinese Locale Design

## Problem

Blok does not currently provide a Taiwan Traditional Chinese locale. Its only
Chinese locale is `zh`, whose 535 UI messages and emoji annotations use
Simplified Chinese. Browser detection lowercases a language tag and then falls
back to its base language, so `zh-TW`, `zh-Hant`, and `zh-Hant-TW` all select
the Simplified `zh` dictionary.

“Taiwanese” can also mean Taiwanese Hokkien, whose modern language subtag is
`nan`. That is a distinct language and translation project. This design targets
the approved product meaning: Traditional Chinese as used in Taiwan.

## Locale Contract

Add `zh-TW` as a canonical `SupportedLocale` alongside the existing `zh`
locale:

- `zh` remains Simplified Chinese.
- `zh-TW` is Taiwan Traditional Chinese and uses left-to-right layout.
- Direct configuration accepts `locale: 'zh-TW'`.
- Automatic browser detection maps `zh-TW`, `zh-Hant`, and `zh-Hant-TW` to
  `zh-TW`, case-insensitively.
- Automatic browser detection keeps `zh`, `zh-CN`, `zh-SG`, `zh-Hans`,
  `zh-Hans-CN`, and `zh-Hans-SG` on the existing `zh` locale.
- Other tags retain the existing exact-match and base-language fallback.

The canonical locale string is case-sensitive in the public TypeScript type but
browser matching is case-insensitive, as BCP 47 requires.

## Translation Data

Create `src/components/i18n/locales/zh-TW/messages.json` with all 535 English
source keys. Use the existing Simplified Chinese dictionary as a semantic
starting point, convert it to Taiwan Traditional orthography, and review product
terminology rather than shipping a character-only conversion.

The locale must:

- preserve every interpolation variable exactly;
- contain no missing, extra, duplicated, or empty keys;
- use Taiwan UI vocabulary such as `搜尋`, `新增`, `刪除`, `檔案`, `連結`,
  `影片`, and `復原`;
- avoid remaining Simplified-only forms in user-facing text;
- keep intentional universal strings such as keyboard shortcuts and aspect
  ratios unchanged.

## Emoji Data

The callout emoji picker has a separate lazy-loaded CLDR annotation dataset.
Extend its generator with an explicit `zh-TW` to `zh-Hant` mapping, generate
`src/tools/callout/emoji-picker/locales/zh-TW.json`, and add the corresponding
runtime importer. This gives Taiwan users Traditional Chinese emoji names and
search keywords instead of English fallbacks or Simplified Chinese.

## Public Surface and Documentation

Add `zh-TW` to:

- the `SupportedLocale` declaration;
- `ALL_LOCALE_CODES`;
- the lazy UI-message importer map;
- the emoji data generator and importer.

The package then exposes 69 locale variants. Update active public claims and
count-sensitive tests from 68 languages/locales to 69 locales. Add a Taiwan
Traditional Chinese greeting to the documentation locale visualization. The
documentation website itself remains localized in English and Russian; that is
separate from the editor’s built-in locale catalog.

## Error Handling

Locale and emoji data retain the existing lazy-load behavior. UI locale loading
continues to warn and fall back to the configured default if an import fails.
Emoji annotation loading continues to return `null` so the picker can fall back
to its base names without breaking the editor.

## Verification

Use red-green TDD for:

1. direct `zh-TW` loading and representative Taiwan strings;
2. browser detection for Taiwan and Traditional Chinese tags;
3. non-regression for Simplified Chinese tags;
4. locale catalog membership and count;
5. Traditional Chinese emoji loading and search data;
6. translation completeness, placeholder parity, duplicate keys, script and
   Taiwan-terminology quality;
7. public documentation count and greeting coverage.

After focused tests pass, run the translation checker, all i18n unit tests,
emoji tests, docs tests, lint/type-checking, the complete unit suite, and the
production build. Inspect built locale chunks to confirm the new dictionary and
emoji data are emitted as lazy data chunks.
