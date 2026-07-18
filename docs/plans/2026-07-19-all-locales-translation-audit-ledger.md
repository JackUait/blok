# All-Locales Translation Audit Ledger

## Purpose

This ledger is the locale-by-locale evidence record for the exhaustive audit
against
[`src/components/i18n/locales/TRANSLATION_GUIDELINES.md`](../../src/components/i18n/locales/TRANSLATION_GUIDELINES.md).
It tracks structural compliance, contextual linguistic review, style and
register consistency, exact-English retentions, corrections, and two
independent review passes for every on-disk dictionary, including English.
Passing automation is necessary evidence, but does not by itself establish
semantic accuracy or natural product wording.

No row below is credited from an earlier test run or historical commit. Every
field begins unaudited and must be advanced only from evidence gathered during
this audit.

## Completion Rules

A locale may be marked `verified` only when all of the following are true:

1. Every current entry in its `messages.json` has been inspected in its real UI
   context against the guideline's requirements for natural, concise,
   action-oriented, user-centred wording; appropriate tool-name,
   accessibility, and error-message length; avoidance of slang,
   transliteration, and unnecessary jargon; and correct language-specific
   capitalization, grammar, register, punctuation, shortcuts, gender, number,
   and established product terminology.
2. Its flat JSON shape and key set match the English source; every value is a
   non-empty string; duplicate keys, encoding defects, and Unicode
   normalization defects are absent; and every placeholder name and occurrence
   count matches English exactly.
3. The first reviewer and a different second reviewer have each inspected the
   complete current dictionary. Reviewing only changed strings or prior
   findings is insufficient.
4. Every defect or unresolved language judgment has a finding ID. All findings
   are `verified`, all corrections have evidence, and no finding remains
   `open`.
5. Every value exactly retained from English is listed in the retention table
   with one allowed category, a locale-specific justification, and a supporting
   source. No pending-translation exemption remains.
6. Structural, semantic/style, and exact-English retention results all pass;
   focused and full i18n checks pass; the repository-wide completion gates and
   independent final review pass; and the evidence reflects the current files.

The field domains, transitions, and reset rules below are part of the
completion contract. A row that violates them is not complete even if its text
says `verified`.

## Workflow and Finding States

| State | Semantics |
|---|---|
| `pending` | Initial or reset value for a result or locale final status; current evidence is absent or stale. It is never a finding status. |
| `first-pass-complete` | Locale final status after one complete current review and all first-pass transition guards pass. |
| `second-pass-complete` | Locale final status after a distinct reviewer completes the second current review and all second-pass transition guards pass. |
| `verified` | Closed finding status, or terminal locale final status after all completion gates pass against current evidence. |
| `open` | Result or finding status for a known failure, defect, disagreement, or linguistic uncertainty. It is never a locale final status. |

## Field Domains and Result Semantics

The three result columns have the exact domain
`pending | open | pass`. Finding status has the exact domain
`open | verified`. Locale final status has the strict domain and progression
`pending -> first-pass-complete -> second-pass-complete -> verified`.

| Field | Allowed values and constraints |
|---|---|
| `Locale` | Exactly one current on-disk locale code, unique in this table. |
| `Language/variant`, `Primary script` | Non-empty factual metadata for the concrete shipped dictionary. |
| `Direction` | Exactly `ltr` or `rtl`, matching runtime `getDirection`. |
| `Register` | `to-audit` until selected; before first-pass completion, replace it with a non-empty explicit register description suitable for the locale. |
| `First reviewer`, `Second reviewer` | Exactly `—` while unassigned, otherwise a stable non-empty reviewer identifier. The two identifiers must differ before second-pass completion. |
| Three result columns | Exactly `pending`, `open`, or `pass`, with the meanings and dimension-specific guards below. |
| `Finding IDs` | Exactly `—` when no finding has ever been recorded, otherwise a comma-separated list of existing `F-<locale>-NNN` rows. Verified findings remain listed as history. |
| `Final status` | Exactly `pending`, `first-pass-complete`, `second-pass-complete`, or `verified`; transitions may not be skipped. |
| Finding-table `Status` | Exactly `open` or `verified`; a new finding starts `open`. |

The result values mean:

- `pending`: that dimension has not been checked since initialization or its
  latest reset. It blocks every final-status transition beyond `pending`.
- `open`: that dimension has been checked enough to identify at least one
  current failure or unresolved finding. It blocks every final-status
  transition beyond `pending`.
- `pass`: all requirements for that dimension have current evidence and no
  related finding is `open`. A result of `pass` is necessary but does not by
  itself advance final status.

Dimension-specific guards are:

- **Structural result:** `pass` requires the current flat JSON dictionary to
  parse, match the English key set, contain only non-empty string values, have
  no duplicate keys, encoding or Unicode normalization defects, and preserve
  every placeholder name and occurrence count. Any current failure or open
  structural finding makes it `open`; an unrun or invalidated check makes it
  `pending`.
- **Semantic/style result:** `pass` requires every current entry to have been
  checked in UI context for meaning, naturalness, brevity, action wording,
  terminology, accessibility wording, grammar, register, punctuation, and all
  other applicable guideline rules at the completed review stage. Any known
  defect or unresolved language judgment makes it `open`; incomplete or
  invalidated review makes it `pending`.
- **Exact-English retention result:** `pass` requires a current exact-match
  inventory, no pending-translation exemption, and one allowed category,
  locale-specific justification, and source for every retained match. Any
  unexplained or disallowed retention makes it `open`; an absent or invalidated
  inventory makes it `pending`.

## Finding Closure and Reopening

- Create each finding as `open`. It may become `verified` only after the
  expected correction or justified disposition is present, the old defect no
  longer reproduces, its focused and structural checks pass where applicable,
  and a reviewer confirms the cited evidence.
- Never delete a verified finding to make a locale appear clean. Retain its ID
  in the locale row as audit history.
- If the same defect or invalid assumption recurs, change the finding from
  `verified` back to `open`, refresh its evidence, set the corresponding result
  to `open`, and reset locale final status to `pending`.
- Reopen a finding whenever its source value, expected value, UI context,
  rationale, cited source, or validating check changes enough that its closure
  is no longer proven.

## Locale Final-Status Transitions

Transitions are one-way and may not be skipped. Invalidation always returns the
row to `pending`; a row must then traverse the progression again.

1. `pending -> first-pass-complete` requires a selected register, a first
   reviewer identifier, `—` for the second reviewer, a complete first review of
   every current entry, all three results at `pass`, every first-pass finding
   `verified`, and every current exact-English retention recorded.
2. `first-pass-complete -> second-pass-complete` requires a different second
   reviewer identifier, that reviewer's independent inspection of every current
   entry and the first-pass diff, all three results at `pass` after that review,
   every finding `verified`, and every retention still justified.
3. `second-pass-complete -> verified` requires all repository-wide completion
   gates, focused and full i18n checks, current evidence validation, and the
   independent final review to pass with all three results still at `pass`.

No result of `pending` or `open`, no finding of `open`, no missing reviewer
identifier required by the target transition, and no identical reviewer
identifiers may coexist with an advanced final status.

## Evidence Reset Rules

These rules prevent a machine or reviewer from retaining stale completion:

1. **Localized value edit:** any edit to a locale's `messages.json` value after
   review resets that locale's three results and final status to `pending`,
   clears both reviewer cells to `—`, and requires both complete passes again.
   Reopen every finding whose key, rationale, or evidence depends on the edited
   value.
2. **English source change:** any English wording, key, or placeholder change
   resets English and every affected localized dictionary exactly as in rule 1,
   and opens all dependent findings. If the complete affected set cannot be
   proven, reset all 69 locales.
3. **Validation or guideline change:** reset each affected result to `pending`,
   reset each affected locale's final status to `pending`, clear both reviewer
   cells to `—`, and repeat both review passes for the changed criterion.
   Structural-contract changes affect the structural result; linguistic or
   style-rule changes affect semantic/style; exact-match policy changes affect
   exact-English retention. If scope is uncertain, reset every possibly
   affected result and locale.
4. **Recurrence:** recurrence of a defect reopens its finding and sets its
   corresponding result to `open`; it also resets final status and reviewers as
   required by the applicable value, source, or validation-change rule above.
5. **Ledger-only correction:** a factual correction confined to this ledger
   need not reset evidence when it changes no dictionary, guideline,
   validation, review conclusion, finding disposition, or cited evidence.
   Otherwise the applicable reset rule is mandatory.

## Evidence Sources

- Normative quality contract:
  [`src/components/i18n/locales/TRANSLATION_GUIDELINES.md`](../../src/components/i18n/locales/TRANSLATION_GUIDELINES.md)
- Audited dictionaries and authoritative on-disk corpus:
  `src/components/i18n/locales/<locale>/messages.json`
- Runtime registry, `ALL_LOCALE_CODES`, lazy importers, and the single
  `RTL_LOCALES` direction set:
  [`src/components/i18n/locales/index.ts`](../../src/components/i18n/locales/index.ts)
- Public compile-time locale union and direction-bearing configuration type:
  [`types/configs/i18n-config.d.ts`](../../types/configs/i18n-config.d.ts)
- Runtime locale support, browser-tag matching, Chinese variant mapping, and
  `getDirection` behavior:
  [`src/components/modules/i18n.ts`](../../src/components/modules/i18n.ts)

## Locale-Code Interpretation Notes

- `ku` is a bare Kurdish code, but this repository's current dictionary is
  Sorani (Central Kurdish) in the Arabic script and the runtime registry treats
  it as RTL. The row describes that concrete artifact, not every Kurdish
  variety.
- `sr` has no script subtag; the current dictionary is Serbian Cyrillic, so the
  row records Cyrillic explicitly.
- `no` is a bare Norwegian code rather than `nb`; the current wording is
  Bokmål. The row records “current Bokmål wording” without claiming that the
  code itself is a precise Bokmål locale tag.
- `pt` has no region subtag; the current dictionary uses Brazilian Portuguese
  wording. The row records the shipped wording rather than inferring a region
  from the code alone.
- `zh` is the current Simplified Chinese dictionary. Runtime browser matching
  maps Taiwan or Hant tags to `zh-TW` and other `zh` tags to `zh`; `zh-TW` is
  the Taiwan Traditional Chinese dictionary.

## Locale Audit

| Locale | Language/variant | Primary script | Direction | Register | First reviewer | Second reviewer | Structural result | Semantic/style result | Exact-English retention result | Finding IDs | Final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `am` | Amharic | Ethiopic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ar` | Arabic | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `az` | Azerbaijani | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `bg` | Bulgarian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `bn` | Bengali | Bengali | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `bs` | Bosnian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `cs` | Czech | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `da` | Danish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `de` | German | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `dv` | Dhivehi (Maldivian) | Thaana | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `el` | Greek | Greek | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `en` | English | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `es` | Spanish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `et` | Estonian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `fa` | Persian (Farsi) | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `fi` | Finnish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `fil` | Filipino | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `fr` | French | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `gu` | Gujarati | Gujarati | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `he` | Hebrew | Hebrew | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `hi` | Hindi | Devanagari | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `hr` | Croatian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `hu` | Hungarian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `hy` | Armenian | Armenian | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `id` | Indonesian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `it` | Italian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ja` | Japanese | Han, Hiragana, Katakana | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ka` | Georgian | Georgian | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `km` | Khmer | Khmer | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `kn` | Kannada | Kannada | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ko` | Korean | Hangul | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ku` | Sorani (Central Kurdish) | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `lo` | Lao | Lao | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `lt` | Lithuanian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `lv` | Latvian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `mk` | Macedonian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ml` | Malayalam | Malayalam | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `mn` | Mongolian (current Cyrillic wording) | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `mr` | Marathi | Devanagari | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ms` | Malay | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `my` | Burmese (Myanmar) | Myanmar | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ne` | Nepali | Devanagari | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `nl` | Dutch | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `no` | Norwegian (current Bokmål wording) | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `pa` | Punjabi (Gurmukhi) | Gurmukhi | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `pl` | Polish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ps` | Pashto | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `pt` | Portuguese (current Brazilian wording) | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ro` | Romanian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ru` | Russian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sd` | Sindhi | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `si` | Sinhala | Sinhala | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sk` | Slovak | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sl` | Slovenian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sq` | Albanian | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sr` | Serbian (Cyrillic) | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sv` | Swedish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `sw` | Swahili | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ta` | Tamil | Tamil | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `te` | Telugu | Telugu | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `th` | Thai | Thai | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `tr` | Turkish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ug` | Uyghur | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `uk` | Ukrainian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `ur` | Urdu | Arabic | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `vi` | Vietnamese | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `yi` | Yiddish | Hebrew | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `zh` | Chinese (Simplified) | Simplified Han | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `zh-TW` | Chinese (Taiwan, Traditional) | Traditional Han | ltr | to-audit | — | — | pending | pending | pending | — | pending |

## Findings

Add one row for every structural, semantic, style, register, terminology,
punctuation, accessibility, placeholder, encoding, or other guideline defect.
Preserve line breaks inside values as escaped text so each finding occupies one
Markdown row. Create it as `open` and use `verified` only after the correction
and its evidence satisfy the closure rules above.

| Finding ID | Locale | Key | Category | Old | Expected | Evidence | Status |
|---|---|---|---|---|---|---|---|
| `F-<locale>-NNN` | `<locale>` | `<key>` | category | old | expected | evidence | status |

## Exact-English Retentions

Record every non-English value that is exactly identical to English. The only
allowed categories are `universal notation`, `product-brand`, `acronym`,
`established cognate`, and `established loanword`. Similar spelling alone is
not a justification; the source must support normal unchanged use in the
locale and UI context.

| Retention ID | Locale | Key | Category | Justification | Source |
|---|---|---|---|---|---|
| `R-<locale>-NNN` | `<locale>` | `<key>` | category | justification | source |
