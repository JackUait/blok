# Taiwan Traditional Chinese Locale Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add complete, lazy-loaded Taiwan Traditional Chinese support as canonical locale `zh-TW`, including browser matching, editor messages, emoji search data, public types, documentation, and verification.

**Architecture:** Preserve `zh` as Simplified Chinese and add `zh-TW` as a separate locale variant. Canonicalize Taiwan and Traditional Chinese browser tags before the existing exact/base matching path, lazy-load a full Taiwan dictionary and CLDR `zh-Hant` emoji annotations, then update active locale-count claims from 68 to 69 locales.

**Tech Stack:** TypeScript, JSON locale dictionaries, i18next, Unicode CLDR annotations, Vitest, Vite, React documentation site

**Repository constraint:** Work directly on the existing `master` branch. Do not create a branch or worktree.

---

### Task 1: Lock the Taiwan locale runtime contract with failing tests

**Files:**
- Modify: `test/unit/components/i18n/index.test.ts`

**Step 1: Add the direct-loading regression**

Add a `setLocale` test that calls `setLocale('zh-TW')` and expects:

```ts
expect(i18n.getLocale()).toBe('zh-TW');
expect(i18n.t('blockSettings.dragToMove')).toBe('拖曳以移動');
expect(i18n.t('popover.search')).toBe('搜尋');
```

**Step 2: Add browser-tag matching regressions**

Add table-driven tests proving that all of these tags select `zh-TW`:

```ts
['zh-TW', 'zh-tw', 'zh-Hant', 'zh-Hant-TW']
```

Add a second table proving that all of these retain Simplified Chinese `zh`:

```ts
['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', 'zh-Hans-SG']
```

Each test must assert both `getLocale()` and a representative script-specific
translation.

**Step 3: Add catalog and direction regressions**

Require `ALL_LOCALE_CODES` to contain `zh-TW`, contain no duplicate codes, have
69 entries, and report `ltr` for `zh-TW`.

**Step 4: Run the focused test and verify RED**

Run:

```bash
yarn vitest run --project=unit test/unit/components/i18n/index.test.ts
```

Expected: FAIL because `zh-TW` is absent, Taiwan tags collapse to `zh`, and the
catalog still has 68 entries.

**Step 5: Commit only the red tests**

```bash
git add test/unit/components/i18n/index.test.ts
git commit -m "test(i18n): define Taiwan locale contract"
```

### Task 2: Add the public locale and tag canonicalization

**Files:**
- Modify: `types/configs/i18n-config.d.ts`
- Modify: `src/components/i18n/locales/index.ts`
- Modify: `src/components/modules/i18n.ts`
- Create: `src/components/i18n/locales/zh-TW/messages.json`

**Step 1: Add the canonical public locale**

Append `'zh-TW'` to `SupportedLocale`, `ALL_LOCALE_CODES`, and
`localeImporters`:

```ts
'zh-TW': () => import('./zh-TW/messages.json'),
```

Update nearby runtime and type comments to say 69 locales.

**Step 2: Canonicalize Chinese browser tags**

Add a focused helper near `matchLanguageTag`:

```ts
private matchChineseLanguageTag(normalized: string): SupportedLocale | null {
  const parts = normalized.split('-');

  if (parts[0] !== 'zh') {
    return null;
  }

  if (parts.includes('tw') || parts.includes('hant')) {
    return 'zh-TW';
  }

  return 'zh';
}
```

Call it before exact/base fallback in `matchLanguageTag`. This preserves all
existing non-Chinese behavior and keeps Simplified Chinese tags on `zh`.

**Step 3: Add the complete Taiwan dictionary**

Create `src/components/i18n/locales/zh-TW/messages.json` with exactly the same
535 keys and ordering as `en/messages.json`. Derive semantics from the existing
`zh` locale, convert every message to Traditional Chinese, then review it for
Taiwan product terminology.

Required representative values:

```json
{
  "blockSettings.dragToMove": "拖曳以移動",
  "toolbox.addBelow": "點擊以在下方新增",
  "popover.search": "搜尋",
  "blockSettings.delete": "刪除",
  "toolNames.link": "連結",
  "toolNames.file": "檔案",
  "toolNames.video": "影片",
  "blockSettings.undo": "復原"
}
```

Preserve all `{variable}` placeholders and intentional universal symbols.

**Step 4: Run the runtime test and verify GREEN**

Run:

```bash
yarn vitest run --project=unit test/unit/components/i18n/index.test.ts
```

Expected: PASS.

**Step 5: Commit the runtime implementation**

```bash
git add types/configs/i18n-config.d.ts src/components/i18n/locales/index.ts src/components/modules/i18n.ts src/components/i18n/locales/zh-TW/messages.json
git commit -m "feat(i18n): add Taiwan Traditional Chinese"
```

### Task 3: Add exhaustive Taiwan translation-quality gates

**Files:**
- Create: `test/unit/components/i18n/taiwan-traditional-chinese.test.ts`
- Modify: `test/unit/components/i18n/search-terms-quality.test.ts`

**Step 1: Test completeness and exact key parity**

Load `en`, `zh`, and `zh-TW` dictionaries. Assert that `zh-TW` exists, has
exactly the English key set, has no empty values, and is not byte-for-byte
identical to the Simplified dictionary.

**Step 2: Test placeholder parity**

For every key, extract all `{variable}` tokens, sort them, and assert the
Taiwan value has exactly the English token list.

**Step 3: Test Taiwan terminology and script**

Assert representative UI terms:

```ts
expect(messages['popover.search']).toContain('搜尋');
expect(messages['blockSettings.delete']).toContain('刪除');
expect(messages['toolNames.file']).toContain('檔案');
expect(messages['toolNames.link']).toContain('連結');
expect(messages['toolNames.video']).toContain('影片');
```

Scan all values for a curated set of Simplified-only characters and forbidden
Mainland UI terms. Report every offending key in the assertion message.

**Step 4: Include `zh-TW` in non-Latin search quality**

Add `zh-TW` to `NON_LATIN_LOCALES` so every search alias must use Chinese
characters unless it is an accepted universal loanword.

**Step 5: Run the focused quality tests**

```bash
yarn vitest run --project=unit test/unit/components/i18n/taiwan-traditional-chinese.test.ts test/unit/components/i18n/search-terms-quality.test.ts test/unit/components/i18n/duplicate-keys.test.ts test/unit/components/i18n/untranslated-strings.test.ts
```

Expected: PASS for all locale completeness, placeholder, duplicate-key,
identical-English, script, and Taiwan-terminology checks.

**Step 6: Commit the quality gates and any translation corrections**

```bash
git add test/unit/components/i18n/taiwan-traditional-chinese.test.ts test/unit/components/i18n/search-terms-quality.test.ts src/components/i18n/locales/zh-TW/messages.json
git commit -m "test(i18n): audit Taiwan translation quality"
```

### Task 4: Add Traditional Chinese emoji names and search keywords

**Files:**
- Modify: `test/unit/tools/callout/emoji-picker/emoji-locale.test.ts`
- Modify: `scripts/build-emoji-locale-data.mjs`
- Modify: `src/tools/callout/emoji-picker/emoji-locale.ts`
- Create: `src/tools/callout/emoji-picker/locales/zh-TW.json`

**Step 1: Add a failing runtime emoji test**

Require `loadEmojiLocale('zh-TW')` to return data where:

```ts
expect(data?.['😀']?.n).toBe('笑臉');
expect(data?.['🔍']?.k).toContain('搜尋');
```

**Step 2: Run the emoji test and verify RED**

```bash
yarn vitest run --project=unit test/unit/tools/callout/emoji-picker/emoji-locale.test.ts
```

Expected: FAIL because no `zh-TW` emoji importer exists.

**Step 3: Map Blok locale to CLDR data**

Add `zh-TW` to `BLOK_LOCALES` and introduce:

```js
const CLDR_LOCALE_OVERRIDES = {
  'zh-TW': 'zh-Hant',
};
```

Resolve each CLDR directory with:

```js
const cldrLocale = CLDR_LOCALE_OVERRIDES[locale] ?? locale;
```

**Step 4: Generate the complete emoji data**

Run:

```bash
node scripts/build-emoji-locale-data.mjs
```

Confirm the report contains a non-zero `zh-TW` row backed by `zh-Hant`, then
add the runtime importer:

```ts
'zh-TW': () => import('./locales/zh-TW.json'),
```

Update the importer count comment from 65 to 66 generated locales.

**Step 5: Run the emoji test and verify GREEN**

```bash
yarn vitest run --project=unit test/unit/tools/callout/emoji-picker/emoji-locale.test.ts
```

Expected: PASS.

**Step 6: Commit the emoji implementation**

```bash
git add test/unit/tools/callout/emoji-picker/emoji-locale.test.ts scripts/build-emoji-locale-data.mjs src/tools/callout/emoji-picker/emoji-locale.ts src/tools/callout/emoji-picker/locales/zh-TW.json
git commit -m "feat(emoji): add Traditional Chinese annotations"
```

### Task 5: Update active 69-locale documentation

**Files:**
- Modify: `README.md`
- Modify: `src/locales.ts`
- Modify: `types/configs/i18n-config.d.ts`
- Modify: `types/locales.d.ts`
- Modify: `src/components/i18n/locales/index.ts`
- Modify: `src/components/modules/i18n.ts`
- Modify: `test/unit/components/i18n/index.test.ts`
- Modify: `test/unit/components/i18n/quote-translations.test.ts`
- Modify: `docs/src/components/home/Features.tsx`
- Modify: `docs/src/components/home/Features.test.tsx`
- Modify: `docs/src/components/home/WhyBlok.tsx`
- Modify: `docs/src/i18n/en.json`
- Modify: `docs/src/i18n/ru.json`

**Step 1: Make docs tests expect 69 locales**

Change count assertions and visible feature-copy assertions from 68 languages
to 69 locales.

**Step 2: Run docs tests and verify RED**

```bash
yarn workspace @bloklabs/docs vitest run src/components/home/Features.test.tsx
```

Expected: FAIL until the locale visualization and docs copy are updated.

**Step 3: Add the Taiwan greeting**

Append this locale entry to `PHRASES`:

```ts
['zh-TW', '你好', '最近好嗎？']
```

Update comments to use `1/69` or the generic `1/N` form.

**Step 4: Correct active product copy**

Use “69 locales” rather than “69 languages” in README, source/type comments,
docs English and Russian translation JSON, `WhyBlok.tsx`, and related tests.
Do not rewrite historical changelog entries.

**Step 5: Run docs tests and verify GREEN**

```bash
yarn workspace @bloklabs/docs vitest run src/components/home/Features.test.tsx
```

Expected: PASS.

**Step 6: Commit documentation changes**

```bash
git add README.md src/locales.ts types/configs/i18n-config.d.ts types/locales.d.ts src/components/i18n/locales/index.ts src/components/modules/i18n.ts test/unit/components/i18n/index.test.ts test/unit/components/i18n/quote-translations.test.ts docs/src/components/home/Features.tsx docs/src/components/home/Features.test.tsx docs/src/components/home/WhyBlok.tsx docs/src/i18n/en.json docs/src/i18n/ru.json
git commit -m "docs(i18n): advertise 69 locale variants"
```

### Task 6: Verify the complete Taiwan support contract

**Files:**
- Verify all files changed by Tasks 1–5

**Step 1: Run translation validation**

```bash
yarn i18n:check
```

Expected: exit 0, with `zh-TW: All 535 keys present`.

**Step 2: Run all i18n and emoji tests**

```bash
yarn vitest run --project=unit test/unit/components/i18n test/unit/components/modules/api/i18n.test.ts test/unit/tools/callout/emoji-picker
```

Expected: all tests pass.

**Step 3: Run docs translation and component tests**

```bash
yarn i18n:check:docs
yarn workspace @bloklabs/docs test
```

Expected: both commands exit 0.

**Step 4: Run static analysis**

```bash
yarn lint
```

Expected: ESLint and TypeScript both exit 0.

**Step 5: Run the complete unit suite**

```bash
yarn test
```

Expected: all `unit` and `unit-angular` projects pass.

**Step 6: Build production artifacts**

```bash
yarn build
```

Expected: exit 0 and production locale chunks include both `zh` and `zh-TW`
message data plus the `zh-TW` emoji annotation data.

**Step 7: Audit requirements and the final diff**

Run:

```bash
git diff --check origin/master...HEAD
git status --short
```

Inspect the type union, locale catalog, runtime matcher, both Taiwan data files,
translation-quality output, docs copy, and built chunks. Confirm historical
`CHANGELOG.md` counts were intentionally left unchanged and no unrelated files
were modified.
