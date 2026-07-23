# All-Locales Translation Guideline Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify and correct all 37,122 locale messages against `TRANSLATION_GUIDELINES.md`, with executable structural contracts and documented semantic review of every locale.

**Architecture:** Extend the existing Node translation checker and Vitest i18n suite with corpus-wide integrity contracts, then audit English and every localized dictionary in disjoint locale tasks. Linguistic fixes are proposed read-only first, made test-visible, applied only after the expected red test, and independently reviewed before a locale is marked complete.

**Tech Stack:** JSON, Node.js ESM, TypeScript, Vitest, ESLint, Git

**Repository constraint:** Work directly on the existing `master` branch. Do not create or use branches, worktrees, detached checkouts, or equivalent isolated workflows. Preserve unrelated working-tree changes.

---

### Task 1: Add reusable locale-integrity checks

**Files:**
- Modify: `scripts/i18n/check-translations.mjs`
- Modify: `scripts/i18n/check-translations.test.mjs`

**Step 1: Write failing unit tests for placeholder extraction**

Import `extractPlaceholders` and add tests equivalent to:

```js
describe('extractPlaceholders', () => {
  it('returns a sorted placeholder multiset', () => {
    assert.deepEqual(
      extractPlaceholders('{total}: {position} / {total}'),
      ['position', 'total', 'total']
    );
  });

  it('returns an empty array when a value has no placeholders', () => {
    assert.deepEqual(extractPlaceholders('Delete'), []);
  });
});
```

**Step 2: Run the checker unit tests and confirm RED**

Run:

`node --test scripts/i18n/check-translations.test.mjs`

Expected: FAIL because `extractPlaceholders` is not exported.

**Step 3: Implement placeholder extraction**

Add:

```js
export function extractPlaceholders(value) {
  return [...value.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1])
    .filter((placeholder) => placeholder !== undefined)
    .sort();
}
```

**Step 4: Run the focused tests and confirm GREEN**

Run:

`node --test scripts/i18n/check-translations.test.mjs`

Expected: PASS.

**Step 5: Write failing integrity tests**

Import `findLocaleIntegrityIssues` and cover, one assertion per behavior:

```js
const source = {
  action: 'Move {count}',
  spaced: ' or ',
  clean: 'Merge',
};
```

Assert findings for:

- a non-string value;
- an empty or whitespace-only value;
- placeholder loss, addition, or duplicate-count drift;
- leading/trailing whitespace drift;
- non-NFC text;
- U+FFFD replacement characters;
- forbidden C0/DEL control characters.

Also assert that tabs, newlines, and other control characters are rejected.

**Step 6: Run the focused tests and confirm RED**

Run:

`node --test scripts/i18n/check-translations.test.mjs`

Expected: FAIL because `findLocaleIntegrityIssues` is not exported.

**Step 7: Implement the integrity checker**

Add an exported function with this result shape:

```js
export function findLocaleIntegrityIssues(sourceTranslation, translation) {
  const issues = [];
  const controls = /[\u0000-\u001F\u007F]/u;
  const edgeWhitespace = (value) => ({
    leading: value.match(/^\s*/u)?.[0] ?? '',
    trailing: value.match(/\s*$/u)?.[0] ?? '',
  });

  for (const [key, sourceValue] of Object.entries(sourceTranslation)) {
    const value = translation[key];

    if (typeof value !== 'string') {
      issues.push({ key, kind: 'non-string', value });
      continue;
    }

    if (value.trim() === '') {
      issues.push({ key, kind: 'empty', value });
    }

    if (
      JSON.stringify(extractPlaceholders(value)) !==
      JSON.stringify(extractPlaceholders(sourceValue))
    ) {
      issues.push({ key, kind: 'placeholder-mismatch', value });
    }

    if (
      JSON.stringify(edgeWhitespace(value)) !==
      JSON.stringify(edgeWhitespace(sourceValue))
    ) {
      issues.push({ key, kind: 'boundary-whitespace', value });
    }

    if (value !== value.normalize('NFC')) {
      issues.push({ key, kind: 'non-nfc', value });
    }

    if (value.includes('\uFFFD')) {
      issues.push({ key, kind: 'replacement-character', value });
    }

    if (controls.test(value)) {
      issues.push({ key, kind: 'control-character', value });
    }
  }

  return issues;
}
```

**Step 8: Add raw duplicate-key detection**

Write failing tests, then export:

```js
export function findDuplicateJsonKeys(raw) {
  const counts = new Map();
  const matcher = /^\s*"((?:\\.|[^"\\])+)"\s*:/;

  for (const line of raw.split('\n')) {
    const match = line.match(matcher);
    if (match === null) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}
```

Verify the red and green states with:

`node --test scripts/i18n/check-translations.test.mjs`

**Step 9: Integrate integrity reporting into the CLI**

For every locale, read the raw JSON before parsing, report duplicate keys as
errors, run `findLocaleIntegrityIssues`, print each issue with locale, key, and
kind, and make any finding set the process exit code to failure.

Keep existing key completeness, source coverage, double-encoding, and
identical-English diagnostics.

**Step 10: Verify the checker tests**

Run:

`node --test scripts/i18n/check-translations.test.mjs`

Expected: PASS with no warnings or unhandled rejections.

**Step 11: Commit only the checker and its tests**

Stage:

`git add scripts/i18n/check-translations.mjs scripts/i18n/check-translations.test.mjs`

Commit message:

`test(i18n): enforce locale integrity`

---

### Task 2: Enforce integrity against the real locale corpus

**Files:**
- Create: `test/unit/components/i18n/translation-guidelines.test.ts`
- Modify: `src/components/i18n/locales/kn.json`

**Step 1: Write the corpus test**

Load every locale file and the English dictionary. For each locale, assert:

```ts
expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort());
expect(findLocaleIntegrityIssues(english, messages)).toEqual([]);
```

Read each raw file and assert:

```ts
expect(findDuplicateJsonKeys(raw)).toEqual([]);
```

Do not require physical key order: the guidelines require a flat complete
dictionary, not English insertion order.

**Step 2: Run the corpus test and confirm RED**

Run:

`yarn vitest run --project=unit test/unit/components/i18n/translation-guidelines.test.ts`

Expected: FAIL only on `kn:tools.table.mergeCells` with `non-nfc`.

**Step 3: Normalize the Kannada value**

Replace the decomposed value for `tools.table.mergeCells` with its NFC-normalized
equivalent. Do not alter its wording.

**Step 4: Run corpus and checker tests**

Run:

- `yarn vitest run --project=unit test/unit/components/i18n/translation-guidelines.test.ts`
- `node --test scripts/i18n/check-translations.test.mjs`
- `node scripts/i18n/check-translations.mjs`

Expected: integrity checks pass. Identical-English warnings may remain at this
stage.

**Step 5: Commit the contract and normalization fix**

Stage only:

- `test/unit/components/i18n/translation-guidelines.test.ts`
- `src/components/i18n/locales/kn.json`

Commit message:

`fix(i18n): normalize locale messages`

---

### Task 3: Create the exhaustive audit ledger

**Files:**
- Create: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Step 1: Add completion criteria and finding states**

Define:

- `pending`
- `first-pass-complete`
- `second-pass-complete`
- `verified`
- `open`

Each locale row must contain:

- locale code and language/variant;
- script and direction;
- chosen register;
- first reviewer;
- second reviewer;
- structural result;
- semantic/style result;
- exact-English retention result;
- finding IDs;
- final status.

**Step 2: Add all 69 locale rows**

List `en` and every locale represented by:

`rg --files src/components/i18n/locales -g '*.json' | sed 's#\.json$##; s#.*/##' | sort`

Initialize every row to `pending`. Do not mark a locale reviewed based on
existing tests or historical commits.

**Step 3: Add the finding format**

Use one line per finding:

```md
| F-<locale>-NNN | <locale> | <key> | semantic/style/register/... | old | expected | evidence | status |
```

For exact-English retentions, record:

```md
| R-<locale>-NNN | <locale> | <key> | universal/brand/acronym/loanword | justification | source |
```

**Step 4: Force-add the ignored plan artifact**

Run:

`git add -f docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

Commit message:

`docs(i18n): start all-locale audit ledger`

---

### Task 4: Audit and stabilize the English source

**Files:**
- Modify if findings exist: `src/components/i18n/locales/en.json`
- Modify: `test/unit/components/i18n/translation-guidelines.test.ts`
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Step 1: Inspect every English key in UI context**

Review all 538 keys in these passes:

1. `blockSettings.*`, `toolbox.*`, `popover.*`, `notifier.*`
2. `a11y.*`
3. `toolNames.*`, `searchTerms.*`
4. `tools.link*`, `tools.marker.*`, `tools.colorPicker.*`
5. `tools.table.*`, `tools.columns.*`, `tools.database.*`
6. `tools.image.*`, `tools.file.*`, `tools.video.*`, `tools.audio.*`
7. remaining `tools.*`

For ambiguous keys, find callers with:

`rg -n "THE_KEY|THE_KEY_SUFFIX" src`

Check clarity, brevity, action orientation, placeholder grammar, technical
jargon, accessibility verbosity, and consistent terminology.

**Step 2: Record every proposed correction before editing**

Add finding rows to the ledger with the old value, proposed value, actual UI
context, and rationale.

**Step 3: Add failing exact expectations**

For each English correction, add an expectation to the corpus test:

```ts
const ENGLISH_GUIDELINE_EXPECTATIONS: Record<string, string> = {
  'key.from.audit': 'Approved replacement',
};
```

Assert the current English dictionary matches the map.

**Step 4: Run the English expectations and confirm RED**

Run:

`yarn vitest run --project=unit test/unit/components/i18n/translation-guidelines.test.ts`

Expected: FAIL once for every recorded English correction. If no correction is
needed, record that all seven namespace passes completed and do not manufacture
a failing test.

**Step 5: Apply only approved English corrections**

Update values without changing keys or placeholders. Any English correction
invalidates dependent translations for that key; add a cross-locale follow-up
finding for all 68 localized dictionaries.

**Step 6: Run the focused tests**

Run:

- `yarn vitest run --project=unit test/unit/components/i18n/translation-guidelines.test.ts`
- `node scripts/i18n/check-translations.mjs`

Expected: focused expectations pass; placeholder and structural contracts stay
green.

**Step 7: Mark English first-pass complete and commit**

Stage only the English locale, focused test, and ledger.

Commit message:

`fix(i18n): refine English source copy`

If English required no change, commit only the ledger update with:

`docs(i18n): complete English copy audit`

---

### Task 5: Expose every pending untranslated value

**Files:**
- Modify: `test/unit/components/i18n/untranslated-strings.test.ts`

**Step 1: Delete `PENDING_TRANSLATION_KEYS`**

Remove all 15 pending keys and remove:

```ts
if (PENDING_TRANSLATION_KEYS.has(key)) return false;
```

Keep universal-symbol and locale-specific cognate exceptions temporarily.

**Step 2: Run the identical-English suite and confirm RED**

Run:

`yarn vitest run --project=unit test/unit/components/i18n/untranslated-strings.test.ts`

Expected: 67 non-English locale cases fail on the 15 formerly pending keys;
`zh-TW` does not fail on those keys.

Capture the exact offender count from current output. The expected baseline is
1,005 pending values, but current files are authoritative.

**Step 3: Leave this test red during first-pass localization**

Do not weaken expectations or add the pending keys elsewhere. This is the
test-first contract for Tasks 6–12.

---

### Task 6: First-pass audit — Western and general Latin locales

**Files:**
- Modify as findings require:
  - `src/components/i18n/locales/da.json`
  - `src/components/i18n/locales/de.json`
  - `src/components/i18n/locales/es.json`
  - `src/components/i18n/locales/fi.json`
  - `src/components/i18n/locales/fil.json`
  - `src/components/i18n/locales/fr.json`
  - `src/components/i18n/locales/id.json`
  - `src/components/i18n/locales/it.json`
  - `src/components/i18n/locales/ms.json`
  - `src/components/i18n/locales/nl.json`
  - `src/components/i18n/locales/no.json`
  - `src/components/i18n/locales/pt.json`
  - `src/components/i18n/locales/ro.json`
  - `src/components/i18n/locales/sv.json`
  - `src/components/i18n/locales/tr.json`
- Modify: `test/unit/components/i18n/translation-guidelines.test.ts`
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Step 1: Dispatch read-only locale reviews**

Use one fresh agent per locale when possible. The agent must inspect all 538
values and return:

- translations for all 15 formerly pending keys;
- every additional defect with key, old value, proposed value, category, and
  rationale;
- every exact-English retention with justification;
- register and terminology notes;
- authoritative terminology links for ambiguous choices.

Agents must not edit files during this step.

**Step 2: Record findings and add failing regressions**

Add all findings to the ledger. For non-pending defects, add a known-bad
regression:

```ts
const KNOWN_BAD_TRANSLATIONS = {
  locale: {
    'key.from.audit': 'old bad value',
  },
};
```

Assert the current value is not the recorded bad value. The formerly pending
keys are already covered by Task 5.

**Step 3: Confirm RED**

Run:

`yarn vitest run --project=unit test/unit/components/i18n/translation-guidelines.test.ts test/unit/components/i18n/untranslated-strings.test.ts`

Expected: all recorded old values fail and the pending translations remain red.

**Step 4: Apply the reviewed locale patches**

Send each reviewer a follow-up task to edit only its assigned locale file.
Preserve all keys, placeholders, and required boundary spaces.

**Step 5: Review every diff centrally**

For each locale:

`git diff -- src/components/i18n/locales/<locale>.json`

Reconcile repeated concepts such as block, link, upload, preview, rendered
content, board, status, caption, alt text, loop, and cover art.

**Step 6: Run focused structural checks**

Run:

- `node scripts/i18n/check-translations.mjs`
- `yarn vitest run --project=unit test/unit/components/i18n/translation-guidelines.test.ts`
- `yarn vitest run --project=unit test/unit/components/i18n/search-terms-quality.test.ts`

Expected: structural and known-bad checks pass for the batch. The global
identical-English test remains red only for locales not yet processed.

**Step 7: Update ledger and commit the batch**

Mark each locale `first-pass-complete`, not verified.

Commit message:

`fix(i18n): audit Western locale copy`

---

### Task 7: First-pass audit — Central and Eastern Latin-script locales

Repeat Task 6 exactly for:

- `az`
- `bs`
- `cs`
- `et`
- `hr`
- `hu`
- `lt`
- `lv`
- `pl`
- `sk`
- `sl`
- `sq`
- `sw`
- `vi`

Commit message:

`fix(i18n): audit Latin locale copy`

---

### Task 8: First-pass audit — Greek, Cyrillic, Armenian, and Georgian locales

Repeat Task 6 exactly for:

- `bg`
- `el`
- `hy`
- `ka`
- `mk`
- `mn`
- `ru`
- `sr`
- `uk`

Additionally verify script consistency and that Serbian remains in its existing
script convention.

Commit message:

`fix(i18n): audit Cyrillic locale copy`

---

### Task 9: First-pass audit — RTL locales

Repeat Task 6 exactly for:

- `ar`
- `dv`
- `fa`
- `he`
- `ku`
- `ps`
- `sd`
- `ug`
- `ur`
- `yi`

Additionally verify:

- natural RTL word order around placeholders;
- native punctuation where appropriate;
- no accidental Latin-script Kurmanji in Sorani `ku`;
- shortcut, provider, and acronym tokens remain readable in RTL flow;
- formal/informal register does not drift within a locale.

Commit message:

`fix(i18n): audit RTL locale copy`

---

### Task 10: First-pass audit — Northern Indic locales

Repeat Task 6 exactly for:

- `bn`
- `gu`
- `hi`
- `mr`
- `ne`
- `pa`

Additionally verify native-script terminology, postposition agreement around
placeholders, and consistent polite imperative forms.

Commit message:

`fix(i18n): audit Northern Indic copy`

---

### Task 11: First-pass audit — Southern Indic, Sinhala, and Amharic locales

Repeat Task 6 exactly for:

- `am`
- `kn`
- `ml`
- `si`
- `ta`
- `te`

Additionally re-run NFC checks after every patch and verify no combining-mark
sequence is corrupted by editing.

Commit message:

`fix(i18n): audit Southern Indic copy`

---

### Task 12: First-pass audit — East and Southeast Asian locales

Repeat Task 6 exactly for:

- `ja`
- `km`
- `ko`
- `lo`
- `my`
- `th`
- `zh`
- `zh-TW`

For `zh-TW`, retain Taiwan conventions and rerun its dedicated test. For `zh`,
verify Simplified Chinese product terminology. Ensure the two Chinese
dictionaries are regional localizations rather than mechanical script
conversions.

Commit message:

`fix(i18n): audit Asian locale copy`

---

### Task 13: Re-audit all exact-English retentions

**Files:**
- Modify: `test/unit/components/i18n/untranslated-strings.test.ts`
- Modify as findings require: `src/components/i18n/locales/*.json`
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Step 1: Generate the current retention inventory**

Compare every non-English value with English and group exact matches by locale
and key.

**Step 2: Classify every match**

For each match, record exactly one category:

- universal notation;
- product/brand;
- acronym;
- established cognate;
- established loanword;
- defect.

Do not accept “already allowlisted” as evidence.

**Step 3: Add a failing test for every rejected retention**

Remove the key from its cognate allowlist before changing the locale.

Run:

`yarn vitest run --project=unit test/unit/components/i18n/untranslated-strings.test.ts`

Expected: FAIL on every rejected retention.

**Step 4: Correct rejected retentions**

Apply only reviewed translations and rerun the test until it passes.

**Step 5: Require comments for retained locale-specific matches**

Keep the current explicit comments or add a concise rationale next to each
allowlist entry. Universal notation remains centralized.

**Step 6: Verify no pending exemption exists**

Run:

`rg -n "PENDING_TRANSLATION|English-first|ship English" test/unit/components/i18n scripts/i18n src/components/i18n/locales`

Expected: no pending-translation exception.

**Step 7: Commit**

Commit message:

`fix(i18n): justify retained UI terms`

---

### Task 14: Perform independent second-pass reviews

**Files:**
- Modify as findings require: `src/components/i18n/locales/*.json`
- Modify: `test/unit/components/i18n/translation-guidelines.test.ts`
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Step 1: Assign a different reviewer to every locale**

Use the same locale partition as Tasks 6–12, but never assign a locale to its
first-pass reviewer.

Second-pass reviewers must inspect the complete 538-value dictionary and the
first-pass diff, not merely the ledger findings.

**Step 2: Record second-pass findings before edits**

Add new finding IDs and known-bad regression values.

**Step 3: Confirm RED**

Run the focused guideline and identical-English tests. Confirm each new
regression fails for the expected old value.

**Step 4: Apply and review second-pass corrections**

Edit only the affected locale files, rerun structural tests after each group,
and review all diffs centrally.

**Step 5: Mark locale status**

Mark a locale `second-pass-complete` only when:

- all 538 values were reviewed twice;
- every finding is closed;
- all exact-English matches are justified;
- structural checks pass.

Commit each language-family group separately with a concise `fix(i18n): ...`
message.

---

### Task 15: Run completion verification

**Files:**
- Review: `src/components/i18n/locales/*.json`
- Review: `scripts/i18n/check-translations.mjs`
- Review: `scripts/i18n/check-translations.test.mjs`
- Review: `test/unit/components/i18n/*.test.ts`
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

**Step 1: Verify the ledger**

Assert:

- exactly 69 locale rows exist;
- every locale is `second-pass-complete`;
- no finding has `open` or `pending` status;
- every exact-English retention has a category and justification.

**Step 2: Run checker unit tests**

Run:

`node --test scripts/i18n/check-translations.test.mjs`

Expected: PASS.

**Step 3: Run all focused i18n tests**

Run:

`yarn vitest run --project=unit test/unit/components/i18n`

Expected: all i18n files pass.

**Step 4: Run the translation checker**

Run:

`node scripts/i18n/check-translations.mjs`

Expected:

- all 69 locales parse;
- all 538 keys are present exactly once;
- no integrity, placeholder, encoding, or unexpected identical-English issue;
- exit code 0.

**Step 5: Run lint and type checks**

Run:

- `yarn lint:tests`
- `yarn lint:types`

Expected: PASS.

**Step 6: Run the complete unit suite**

Run:

`yarn test`

Expected: PASS. If unrelated user work causes a failure, prove that with the
pre-existing diff and a focused clean i18n run; do not alter unrelated files.

**Step 7: Inspect the final diff**

Run:

- `git diff --check`
- `git status --short`
- `git diff --stat`
- `git diff -- src/components/i18n/locales scripts/i18n test/unit/components/i18n docs/plans`

Confirm every changed file is in scope and all unrelated user edits remain
untouched.

**Step 8: Request independent code review**

Invoke `superpowers:requesting-code-review`. Give the reviewer the objective,
guidelines, design, implementation plan, ledger, changed-file list, and all
verification output. Resolve every valid finding test-first.

**Step 9: Mark every locale verified**

Only after the independent code review and all checks pass, change each ledger
row from `second-pass-complete` to `verified`.

**Step 10: Commit final evidence**

Force-add only the ignored ledger:

`git add -f docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`

Stage any remaining in-scope tests or checker changes explicitly.

Commit message:

`docs(i18n): complete all-locale audit`
