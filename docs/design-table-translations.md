# Table Translations Design

**Date:** 2026-02-12
**Status:** Approved
**Scope:** Translate 10 untranslated table UI keys across 70 languages

## Problem Statement

Recent table feature additions introduced 10 new translation keys that were added to all 70 locale files but remain in English. These keys need proper translation following the project's translation guidelines.

**Untranslated Keys:**
- `tools.table.title`
- `tools.table.clearSelection`
- `tools.table.headerColumn`
- `tools.table.insertColumnLeft`
- `tools.table.insertColumnRight`
- `tools.table.deleteColumn`
- `tools.table.headerRow`
- `tools.table.insertRowAbove`
- `tools.table.insertRowBelow`
- `tools.table.deleteRow`

**Scope:** 10 keys × 70 languages = 700 translations

## Approach

### Architecture & Strategy

**Translation Method:** AI-assisted translation using Claude subagents

**Batching Strategy:** 7 parallel subagents, each handling 10 languages

**Language Grouping (by script/region):**
1. **Western European:** en, fr, es, de, it, pt, nl, sv, da, no
2. **Eastern European:** pl, cs, sk, hr, sr, sl, bg, ro, hu, et
3. **Cyrillic/Baltic:** ru, uk, be, mk, lt, lv, bs
4. **Middle Eastern/RTL:** ar, he, fa, ur, ps, ku, dv, sd
5. **South/Southeast Asian:** hi, bn, ta, te, kn, ml, mr, gu, pa, ne, si
6. **East Asian & More SE Asian:** zh, ja, ko, th, vi, id, ms, fil, km, lo, my
7. **Other/Less Common:** am, az, hy, ka, mn, sw, sq, tr, yi, ug

### Translation Process

**Each Subagent Workflow:**

1. **Context Analysis:**
   - Read existing translations for assigned languages
   - Identify formal vs informal register (tu/vous, du/Sie)
   - Note capitalization patterns and terminology choices
   - Understand sentence structure preferences

2. **Translation Guidelines:**
   - Keep concise (1-3 words, avoid UI overflow)
   - Use imperative mood for actions ("Delete" not "To delete")
   - Match formality level of existing translations
   - Preserve platform-specific conventions (Option/Alt-click)
   - For RTL languages: ensure natural right-to-left reading flow

3. **Table Feature Context:**
   - "Table" = spreadsheet-like data grid in the editor
   - "Header row/column" = distinguishes first row/column (bold styling)
   - "Insert/Delete" = add or remove rows/columns
   - "Clear" = removes cell selection highlight
   - All are button labels or menu items (Tier 1 critical UI)

### Quality Assurance

**Per-Language Checks:**
- All 10 keys translated (no English remaining)
- Translations are brief (1-3 words matching English)
- Grammar matches existing translations' style
- Special characters/punctuation follow language conventions
- RTL languages: verify directional appropriateness

**Post-Translation Validation:**
- Verify all 70 files updated
- Grep for remaining English strings in table keys
- Spot-check 5-10 languages (mix of common + RTL + Asian scripts)
- Verify JSON syntax validity

## Implementation Plan

### Phase 1: Preparation (2-3 minutes)
- Create translation template with 10 English keys
- Prepare language batch assignments
- Create subagent instructions

### Phase 2: Parallel Translation (5-8 minutes)
- Launch 7 subagents in parallel
- Each subagent:
  - Receives batch of 10 language codes
  - Gets translation guidelines and context
  - Reads existing translations for consistency
  - Edits 10 assigned `messages.json` files

### Phase 3: Verification (2-3 minutes)
- Check all 70 files were updated
- Grep for remaining English strings
- Spot-check sample languages
- Verify JSON syntax

### Phase 4: Git Commit
- Single commit: "feat(i18n): translate table UI strings for all locales"
- Include all 70 modified `messages.json` files

**Total Estimated Time:** 10-15 minutes

## Rollback Plan

If issues found:
```bash
git checkout -- src/components/i18n/locales/*/messages.json
```

Then fix specific languages individually.

## Success Criteria

- [ ] All 70 language files have translated table keys
- [ ] No English strings remain in table-related keys
- [ ] Translations follow guidelines (concise, imperative, appropriate formality)
- [ ] JSON syntax is valid in all files
- [ ] Spot-check confirms quality across language families
- [ ] Single git commit captures all changes

## References

- Translation Guidelines: `src/components/i18n/locales/TRANSLATION_GUIDELINES.md`
- English Source: `src/components/i18n/locales/en/messages.json`
- Recent Commits: Table feature additions (2f16ba42, cd39da01, e9e8d37b)
