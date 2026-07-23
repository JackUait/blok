# zh-TW Translation Guideline Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Make the Traditional Chinese (Taiwan) locale comply with `TRANSLATION_GUIDELINES.md` and add regression coverage for the audited wording.

**Architecture:** Keep the locale as a flat JSON dictionary with the exact English key set and placeholder contract. Extend the locale-specific Vitest suite with explicit quality invariants, then update only the affected `zh-TW` values. Work directly on the repository's existing branch as required by `AGENTS.md`; do not create a branch or worktree.

**Tech Stack:** JSON, TypeScript, Vitest, Node.js translation checker

---

### Task 1: Define the audited translation contract

**Files:**
- Modify: `test/unit/components/i18n/taiwan-traditional-chinese.test.ts`

**Step 1: Add a failing exact-English invariant**

Add an allowlist containing only universal notation that legitimately matches English:

- `blockSettings.menuShortcutMac`
- `blockSettings.menuShortcutWin`
- `tools.image.cropRatio1to1`
- `tools.image.cropRatio4to3`
- `tools.image.cropRatio16to9`
- `tools.database.propertyTypeUrl`

Compare it with every `zh-TW` value that exactly matches the corresponding English value.

**Step 2: Add a failing tool-name invariant**

Assert that all `toolNames.*` values are localized and no longer than six Unicode characters, which is a practical upper bound for the guideline's one-to-two-word requirement.

**Step 3: Add failing contextual wording expectations**

Add exact expectations for the audited equation, conversion, file-size, audio-cover, click-action, table, search, preview, offline-source, database-description, loop, and current-time URL strings. These examples encode concise wording, native Taiwan terminology, and the strings' actual UI contexts.

**Step 4: Run the focused test and confirm RED**

Run:

`yarn vitest run --project=unit test/unit/components/i18n/taiwan-traditional-chinese.test.ts`

Expected: failures identify the 15 untranslated values and the contextual wording mismatches.

### Task 2: Correct the Traditional Chinese (Taiwan) locale

**Files:**
- Modify: `src/components/i18n/locales/zh-TW.json`

**Step 1: Localize all remaining English UI values**

Translate the equation tool, equation placeholder, image conversion status, four file-size errors, and the audio metadata and cover controls.

**Step 2: Apply native interaction wording**

Use `按一下` for actual mouse/tap click instructions and retain existing keyboard shortcut tokens exactly.

**Step 3: Correct context-specific terminology**

Use concise Taiwan wording for fitting a table, last-editor attribution, list search terms, rendered preview, offline sources, audio-cover accessibility, database placeholders/descriptions, repeated playback, and a video's current-time URL.

**Step 4: Preserve structural contracts**

Keep the current key order, flat JSON structure, placeholders, shortcut tokens, and punctuation conventions unchanged except where an audited value explicitly requires different wording.

### Task 3: Prove the focused translation contract

**Files:**
- Test: `test/unit/components/i18n/taiwan-traditional-chinese.test.ts`
- Test: `test/unit/components/i18n/untranslated-strings.test.ts`
- Test: `test/unit/components/i18n/search-terms-quality.test.ts`

**Step 1: Run the focused i18n tests**

Run:

`yarn vitest run --project=unit test/unit/components/i18n/taiwan-traditional-chinese.test.ts test/unit/components/i18n/untranslated-strings.test.ts test/unit/components/i18n/search-terms-quality.test.ts`

Expected: all focused tests pass.

**Step 2: Run the translation checker**

Run:

`node scripts/i18n/check-translations.mjs`

Expected: all locale keys, source coverage, and encoding checks pass. Any `zh-TW` exact-English warning must consist solely of the six universal notation values covered by the locale-specific test.

**Step 3: Run diagnostic quality audits**

Check `zh-TW` for unexpected ASCII-only values, placeholder drift, non-native punctuation, and OpenCC normalization suggestions. Review OpenCC output manually because conversions such as `項目` to `專案` can be false positives in UI context.

### Task 4: Run repository verification and review the diff

**Files:**
- Review: `src/components/i18n/locales/zh-TW.json`
- Review: `test/unit/components/i18n/taiwan-traditional-chinese.test.ts`

**Step 1: Run project checks**

Run:

- `yarn i18n:check`
- `yarn lint`
- `yarn build`
- `yarn test`

**Step 2: Inspect the final diff**

Confirm that only the plan, the `zh-TW` locale, and its focused test changed; verify there are no accidental key, placeholder, or unrelated formatting edits.

**Step 3: Commit the verified changes**

Create concise Conventional Commits directly on the existing branch, without branches or worktrees.
