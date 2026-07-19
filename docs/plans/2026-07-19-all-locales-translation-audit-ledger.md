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
   action-oriented, user-centered wording; appropriate tool-name,
   accessibility, and error-message length; avoidance of slang,
   transliteration, and unnecessary jargon; and correct language-specific
   capitalization, grammar, register, punctuation, shortcuts, gender, number,
   and established product terminology. When an exhaustive caller search finds
   no production consumer, the entry must instead be inventoried as
   source-only or localization-bypassed and reviewed against its documented
   namespace, key, intended role, and any equivalent hardcoded UI context.
   Absence of a caller never waives the wording requirements.
2. Its flat JSON shape and key set match the English source; every value is a
   non-empty string; duplicate keys, encoding defects, and Unicode
   normalization defects are absent; and every placeholder name and occurrence
   count matches English exactly.
3. The first reviewer and a different second reviewer have each inspected the
   complete current dictionary. Reviewing only changed strings or prior
   findings is insufficient. Each completed pass is bound to the exact raw
   dictionary bytes by the SHA-256 evidence table below.
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
| `Finding IDs` | Exactly `—` when no locale-specific finding has ever been recorded, otherwise a comma-separated list of existing `F-<locale>-NNN` rows. Verified findings remain listed as history. A global `F-global-NNN` finding is recorded once in the finding table and is not duplicated into every affected locale row. |
| `Final status` | Exactly `pending`, `first-pass-complete`, `second-pass-complete`, or `verified`; transitions may not be skipped. |
| Finding-table `Status` | Exactly `open` or `verified`; a new finding starts `open`. |

The reviewed-dictionary digest table contains a row only for a locale whose
final status has advanced beyond `pending`. Its first-pass reviewer must match
the locale row, and its `sha256:<64 lowercase hex digits>` value must match the
current raw `messages.json` bytes. A `first-pass-complete` row keeps both
second-pass cells at `—`. A `second-pass-complete` or `verified` row records the
distinct second reviewer and the same current-file digest. Any dictionary
content change removes the digest evidence and resets the locale as specified
below; a stale digest can never support a completed status.

The result values mean:

- `pending`: that dimension has not been checked since initialization or its
  latest reset. It blocks every final-status transition beyond `pending`.
- `open`: that dimension has been checked enough to identify at least one
  current failure or unresolved finding. It blocks every final-status
  transition beyond `pending`.
- `pass`: all requirements for that dimension have current evidence and no
  related locale-specific finding is `open`. A result of `pass` is necessary
  but does not by itself advance final status.

A global finding does not block an individual locale's result or first- or
second-pass transition. It tracks aggregate work across locales and blocks
every terminal `verified` transition until the global finding itself is
verified.

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
  other applicable guideline rules at the completed review stage. An entry
  with no production consumer must have the explicit source-only disposition
  required by completion rule 1. Any known defect or unresolved language
  judgment makes the result `open`; incomplete or invalidated review makes it
  `pending`.
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
   every current entry, all three results at `pass`, every locale-specific
   first-pass finding `verified`, and every current exact-English retention
   recorded.
2. `first-pass-complete -> second-pass-complete` requires a different second
   reviewer identifier, that reviewer's independent inspection of every current
   entry and the first-pass diff, all three results at `pass` after that review,
   every locale-specific finding `verified`, and every retention still
   justified.
3. `second-pass-complete -> verified` requires all repository-wide completion
   gates, focused and full i18n checks, current evidence validation, and the
   independent final review to pass with all three results still at `pass` and
   every global finding `verified`.

No result of `pending` or `open`, no open locale-specific finding, no missing
reviewer identifier required by the target transition, and no identical
reviewer identifiers may coexist with a first- or second-pass final status.
No open finding of any kind may coexist with terminal `verified`.

## Evidence Reset Rules

These rules prevent a machine or reviewer from retaining stale completion:

1. **Localized dictionary content change:** any content change to a localized
   `messages.json` after review resets that locale's three results and final
   status to `pending`, clears both reviewer cells to `—`, and requires both
   complete passes again. Remove its reviewed-dictionary digest row. This
   includes keys added, removed, or renamed; value edits; structural changes;
   duplicate-key changes; raw encoding, Unicode normalization, or whitespace
   changes; and formatting changes that can affect raw-integrity evidence.
   Reopen every finding whose key, value, rationale, disposition, or evidence
   depends on the changed content.
2. **English source change:** any English wording, key, or placeholder change
   resets English and every affected localized dictionary exactly as in rule 1,
   and reopens all affected or dependent findings. If the complete affected set
   cannot be proven, reset all 69 locales.
3. **Validation or guideline change:** reset each affected result to `pending`,
   reset each affected locale's final status to `pending`, clear both reviewer
   cells to `—`, and repeat both review passes for the changed criterion.
   Structural-contract changes affect the structural result; linguistic or
   style-rule changes affect semantic/style; exact-match policy changes affect
   exact-English retention. If scope is uncertain, reset every possibly
   affected result and locale.
4. **Recurrence:** recurrence of a defect always reopens its finding. If a
   dictionary content change caused the recurrence, rule 1 or rule 2 resets all
   three results, final status, and reviewers. Otherwise set every result
   affected by the recurrence to `open`, reset final status to `pending`, clear
   the reviewer cells for the affected pass or passes, and repeat both passes
   for every affected criterion; clear both reviewer cells when the conclusion
   spans both passes or its scope cannot be isolated.
5. **Substantive ledger-evidence change:** once evidence has supported a
   `pass`, a `verified` finding, or a locale status beyond `pending`, any change
   to reviewer identity or conclusion, a result, finding status or disposition,
   retention classification, retention justification or source, cited
   evidence, or an evidence reference invalidates every conclusion that relied
   on its former content. Reset the affected result or results and final status
   to `pending`, clear the relevant reviewer cells, reopen all relevant
   findings, and repeat both passes for every affected criterion. Clear both
   reviewer cells conservatively when the changed conclusion or evidence spans
   both passes. If the affected locales or criteria cannot be proven, reset all
   three results and final status to `pending` for all 69 locales, clear all
   reviewer cells, reopen every potentially affected finding, and repeat both
   passes.
6. **Pure clerical or procedural wording change:** a ledger-only spelling,
   layout, or process-description correction needs no reset only when it
   provably changes no audit evidence, evidence reference, reviewer identity or
   conclusion, result, finding status or disposition, retention classification
   or justification, cited source, or completion claim. Recording evidence for
   the first time while the row remains `pending` is evidence collection, not a
   change to evidence previously used for completion. If either condition
   cannot be proven, rule 5 governs.

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
| `da` | Danish | Latin | ltr | neutral concise Danish; direct actions; lowercase search aliases | agent-audit-da-pass1-2026-07-19 | — | pass | pass | pass | `F-da-001`, `F-da-002`, `F-da-003`, `F-da-004`, `F-da-005`, `F-da-006`, `F-da-007`, `F-da-008`, `F-da-009`, `F-da-010`, `F-da-011`, `F-da-012`, `F-da-013`, `F-da-014`, `F-da-015`, `F-da-016`, `F-da-017`, `F-da-018`, `F-da-019`, `F-da-020`, `F-da-021`, `F-da-022`, `F-da-023`, `F-da-024`, `F-da-025`, `F-da-026`, `F-da-027`, `F-da-028`, `F-da-029`, `F-da-030`, `F-da-031`, `F-da-032`, `F-da-033`, `F-da-034`, `F-da-035`, `F-da-036`, `F-da-037`, `F-da-038`, `F-da-039`, `F-da-040`, `F-da-041`, `F-da-042`, `F-da-043`, `F-da-044`, `F-da-045`, `F-da-046`, `F-da-047`, `F-da-048`, `F-da-049`, `F-da-050`, `F-da-051`, `F-da-052`, `F-da-053`, `F-da-054`, `F-da-055`, `F-da-056`, `F-da-057`, `F-da-058`, `F-da-059`, `F-da-060`, `F-da-061`, `F-da-062`, `F-da-063`, `F-da-064`, `F-da-065`, `F-da-066`, `F-da-067`, `F-da-068` | first-pass-complete |
| `de` | German | Latin | ltr | formal `Sie` in sentences; concise infinitive actions; German noun capitalization | agent-audit-de-pass1-2026-07-19 | — | pass | pass | pass | `F-de-001`, `F-de-002`, `F-de-003`, `F-de-004`, `F-de-005`, `F-de-006`, `F-de-007`, `F-de-008`, `F-de-009`, `F-de-010`, `F-de-011`, `F-de-012`, `F-de-013`, `F-de-014`, `F-de-015`, `F-de-016`, `F-de-017`, `F-de-018`, `F-de-019`, `F-de-020`, `F-de-021`, `F-de-022`, `F-de-023`, `F-de-024`, `F-de-025`, `F-de-026`, `F-de-027`, `F-de-028`, `F-de-029`, `F-de-030`, `F-de-031`, `F-de-032`, `F-de-033`, `F-de-034`, `F-de-035`, `F-de-036`, `F-de-037`, `F-de-038`, `F-de-039`, `F-de-040`, `F-de-041`, `F-de-042`, `F-de-043`, `F-de-044`, `F-de-045`, `F-de-046`, `F-de-047`, `F-de-048`, `F-de-049`, `F-de-050`, `F-de-051`, `F-de-052`, `F-de-053`, `F-de-054`, `F-de-055`, `F-de-056`, `F-de-057`, `F-de-058`, `F-de-059`, `F-de-060`, `F-de-061`, `F-de-062`, `F-de-063`, `F-de-064`, `F-de-065`, `F-de-066`, `F-de-067`, `F-de-068`, `F-de-069`, `F-de-070`, `F-de-071`, `F-de-072` | first-pass-complete |
| `dv` | Dhivehi (Maldivian) | Thaana | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `el` | Greek | Greek | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `en` | English | Latin | ltr | concise US English; sentence-case UI | codex-en-pass1-2026-07-19 | — | pass | pass | pass | `F-en-001`, `F-en-002`, `F-en-003`, `F-en-004`, `F-en-005`, `F-en-006`, `F-en-007`, `F-en-008`, `F-en-009`, `F-en-010`, `F-en-011`, `F-en-012`, `F-en-013`, `F-en-014`, `F-en-015`, `F-en-016`, `F-en-017`, `F-en-018`, `F-en-019`, `F-en-020`, `F-en-021`, `F-en-022`, `F-en-023`, `F-en-024`, `F-en-025`, `F-en-026`, `F-en-027`, `F-en-028`, `F-en-029`, `F-en-030`, `F-en-031`, `F-en-032`, `F-en-033`, `F-en-034`, `F-en-035` | first-pass-complete |
| `es` | Spanish | Latin | ltr | informal Spain Spanish; `tú` imperatives for instructions; infinitive menu actions; Spain terminology and spelling | agent-audit-es-pass1-2026-07-19 | — | pass | pass | pass | `F-es-001`, `F-es-002`, `F-es-003`, `F-es-004`, `F-es-005`, `F-es-006`, `F-es-007`, `F-es-008`, `F-es-009`, `F-es-010`, `F-es-011`, `F-es-012`, `F-es-013`, `F-es-014`, `F-es-015`, `F-es-016`, `F-es-017`, `F-es-018`, `F-es-019`, `F-es-020`, `F-es-021`, `F-es-022`, `F-es-023`, `F-es-024`, `F-es-025`, `F-es-026`, `F-es-027`, `F-es-028`, `F-es-029`, `F-es-030`, `F-es-031`, `F-es-032`, `F-es-033`, `F-es-034`, `F-es-035`, `F-es-036`, `F-es-037`, `F-es-038`, `F-es-039`, `F-es-040`, `F-es-041`, `F-es-042`, `F-es-043`, `F-es-044`, `F-es-045`, `F-es-046`, `F-es-047`, `F-es-048`, `F-es-049`, `F-es-050`, `F-es-051`, `F-es-052`, `F-es-053`, `F-es-054`, `F-es-055`, `F-es-056`, `F-es-057`, `F-es-058`, `F-es-059`, `F-es-060`, `F-es-061`, `F-es-062`, `F-es-063`, `F-es-064`, `F-es-065`, `F-es-066`, `F-es-067`, `F-es-068`, `F-es-069`, `F-es-070`, `F-es-071`, `F-es-072`, `F-es-073`, `F-es-074`, `F-es-075`, `F-es-076`, `F-es-077`, `F-es-078`, `F-es-079`, `F-es-080`, `F-es-081`, `F-es-082`, `F-es-083`, `F-es-084`, `F-es-085`, `F-es-086` | first-pass-complete |
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

## Reviewed Dictionary Digests

These hashes bind each completed review to the exact raw dictionary that both
the reviewer and executable checks inspected. A row is removed whenever its
locale returns to `pending`.

| Locale | First-pass reviewer | First-pass dictionary SHA-256 | Second-pass reviewer | Second-pass dictionary SHA-256 |
|---|---|---|---|---|
| `en` | `codex-en-pass1-2026-07-19` | `sha256:60559b2261eb1faaf4074775ad260912a4cdae2648368672903af1870d1b08f4` | `—` | `—` |
| `da` | `agent-audit-da-pass1-2026-07-19` | `sha256:09848e71029a419fc7fda6218a88cc31442063a77a4697ef89b0053d39553cb1` | `—` | `—` |
| `de` | `agent-audit-de-pass1-2026-07-19` | `sha256:398b797856c7c49132f841b5c5ec874690a1ec48a3c0ce4127fca91a390ac5c3` | `—` | `—` |
| `es` | `agent-audit-es-pass1-2026-07-19` | `sha256:4067961b434ceb7b7ec13a96041051651e28c01fd9f46a099d111d39ff464f19` | `—` | `—` |

## English Source Audit Evidence

The first English pass inspected all 538 values in their rendered,
accessibility, or explicitly documented source-only contexts. Coverage was
disjoint and exhaustive:

- 168 values across block settings, toolbox, popover, notifier,
  accessibility, tool names, search terms, link, marker, and color-picker
  namespaces;
- 153 image, file, and video values;
- 51 audio values;
- 46 database values;
- 41 table and columns values;
- 79 remaining bookmark, callout, code, embed, equation, header, list,
  paragraph, quote, spacer, stub, and toggle values.

The selected source register is concise US English with sentence-case product
labels. This resolves an internal guideline conflict explicitly: the
Grammar & Style parenthetical says English title-cases UI labels, while Core
Principles 1–2 prioritize natural, common UI patterns and the same document's
concrete approved examples use sentence case (“Bulleted list,” “Drag to move,”
“Click to add below,” and “Insert block”). The English dictionary introduced
with that guideline in commit `c2facbd5` also used sentence case throughout.
For this audit, the core principles and concrete context examples take
precedence over the contradictory parenthetical; proper names and acronyms
retain their normal capitalization.

Every placeholder-bearing value was checked against its caller and number
range. All 44 search aliases are distinct and useful for their registered
targets. Exhaustive caller tracing classified these 29 dictionary values as
source-only or localization-bypassed rather than pretending that they render
through the locale API:

- `blockSettings.convertWithChildrenWarning`, `popover.actions`,
  `tools.columns.turnInto`, `tools.code.autoDetected`, and
  `tools.code.plainText`;
- `tools.link.keepTyping`, `tools.link.emailAddress`,
  `tools.link.jumpToSection`, and `tools.link.webLink`;
- `tools.image.size`, `tools.image.sizeSmall`, `tools.image.sizeMedium`,
  `tools.image.sizeLarge`, `tools.image.sizeFull`,
  `tools.image.captionPlaceholder`, and `tools.image.errorUnavailable`;
- `tools.file.captionPlaceholder` and `tools.file.preview`;
- `tools.video.toggleCaption` and `tools.video.moreOptions`;
- `tools.database.close`, `tools.database.defaultStatusDone`,
  `tools.database.defaultStatusInProgress`,
  `tools.database.defaultStatusNotStarted`,
  `tools.database.defaultStatusProperty`,
  `tools.database.defaultTitleProperty`, `tools.database.defaultViewBoard`,
  `tools.database.emptyColumn`, and `tools.database.titlePlaceholder`.

Each was reviewed against its key contract and the equivalent feature or
hardcoded source context. The W3C WAI
[Media Seek Slider Example](https://www.w3.org/WAI/ARIA/apg/patterns/slider/examples/slider-seek/)
uses “Seek” as the equivalent control's accessible name, so
`tools.video.seek` is intentionally retained rather than changed on stylistic
preference alone.

This evidence found and corrected the 35 source-copy defects below. The 35
exact regression cases and their machine-checked ledger synchronization pass,
as do all 69 locale corpus cases, all 77 checker tests, and the live structural
checker. English has no exact-English retention inventory by definition. Its
current first pass is complete. Hardcoded source text outside locale
dictionaries remains outside the approved scope of this translation-value
audit.

## Localized First-Pass Evidence

### German (`de`) — first pass complete

The first reviewer inspected and, after applying the reviewed corrections,
re-read 538/538 current German values in eight top-level namespace passes and
all 23 `tools.*` subnamespaces. Coverage included all 29 source-only
dispositions, 44/44 search aliases, every placeholder-bearing value, and all
35 changed-English dependencies.

All 72 reviewed corrections are applied and exact: the 15 formerly exempt
English fallbacks, 20 of the 35 changed-source dependencies, and 37 additional
caller-backed defects. The other 15 changed-source dependencies retain their
reviewed German wording. The final dictionary contains exactly 25 supported
exact-English values, all recorded as `R-de-001` through `R-de-025` below.
All 44 search aliases remain normalization-distinct.

Fresh post-edit validation found 538 German keys matching the 538 English keys,
with no missing, extra, or duplicate decoded keys and zero structural integrity
issues. Placeholder multisets match English for all 538 values; string type,
non-empty, NFC, encoding, control-character, and boundary-whitespace checks
also pass. The 72 focused `F-de` regression cases pass, the focused German
structural case passes, both German completeness and exact-retention cases
pass, and the full 129-case search-term quality suite passes.

Terminology evidence includes Duden entries for
[Link](https://www.duden.de/rechtschreibung/Link),
[Code](https://www.duden.de/rechtschreibung/Code),
[Audio](https://www.duden.de/rechtschreibung/Audio),
[Video](https://www.duden.de/rechtschreibung/Video),
[Layout](https://www.duden.de/rechtschreibung/Layout),
[Text](https://www.duden.de/rechtschreibung/Text_Schrift),
[Status](https://www.duden.de/rechtschreibung/Status),
[URL](https://www.duden.de/rechtschreibung/URL),
[Cover](https://www.duden.de/rechtschreibung/Cover), and
[Gleichung](https://www.duden.de/rechtschreibung/Gleichung);
[Microsoft Planner](https://support.microsoft.com/de-de/accessibility/planner/use-a-screen-reader-to-explore-and-navigate-microsoft-planner)
for `Board`; [YouTube](https://support.google.com/youtube/answer/6327615?hl=de)
for `Autoplay`;
[Apple](https://support.apple.com/de-de/guide/final-cut-pro/ver2bea770c/mac)
for aspect-ratio notation;
[MDN](https://developer.mozilla.org/de/docs/Web/HTML/Reference/Elements/img)
and [BFIT](https://www.bfit-bund.de/DE/Downloads/Praxistipps-und-Leitfaeden/praxistipps_artikel.html)
for concise German alternative-text terminology; and
[Apple shortcut guidance](https://support.apple.com/de-de/guide/mac-help/mchld6b9e240/mac).
These results close the German first pass; the distinct second review remains
unassigned.

### Danish (`da`) — first pass complete

The first reviewer inspected and, after applying the reviewed corrections,
re-read 538/538 current Danish values across all top-level namespaces and all
23 `tools.*` subnamespaces. Coverage included every source-only value, all
44/44 search aliases, every placeholder-bearing value, all 35 changed-English
dependencies, and the full exact-English inventory.

All 68 reviewed corrections are applied and exact: the 15 formerly exempt
English fallbacks, 20 of the 35 changed-source dependencies, and 33 additional
caller-backed defects. The other 15 changed-source dependencies retain their
reviewed Danish wording. The amended `F-da-066` contract and dictionary both
use `Kopiér video-URL ved den aktuelle afspilningsposition`. The final
dictionary contains exactly 28 supported exact-English values, all recorded as
`R-da-001` through `R-da-028` below. All 44 search aliases remain
normalization-distinct.

Fresh post-edit validation found 538 Danish keys matching the 538 English keys,
with no missing, extra, or duplicate decoded keys and zero structural integrity
issues. Placeholder multisets match English for all 538 values; string type,
non-empty, normalization, encoding, control-character, and boundary-whitespace
checks also pass. All 68 focused Danish finding cases pass, the full
translation-guideline corpus passes 334/334, the search-term quality suite
passes 129/129, and the live translation checker exits successfully.

Terminology evidence includes Den Danske Ordbog entries for
[ligning](https://ordnet.dk/ddo/ordbog?query=ligning),
[formel](https://ordnet.dk/ddo/ordbog?query=formel),
[link](https://ordnet.dk/ddo/ordbog?query=link),
[upload](https://ordnet.dk/ddo/ordbog?query=upload),
[database](https://ordnet.dk/ddo/ordbog/database),
[layout](https://ordnet.dk/ddo/ordbog/layout),
[video](https://ordnet.dk/ddo/ordbog/video),
[pause](https://ordnet.dk/ddo/ordbog/pause),
[status](https://ordnet.dk/ddo/ordbog/status), and
[URL](https://ordnet.dk/ddo/ordbog/URL);
[Microsoft equation UI](https://support.microsoft.com/da-dk/education/create-equations-in-word-for-the-web);
[Apple music metadata](https://support.apple.com/da-dk/guide/iphone/iph0138fb328/ios);
[Apple shortcut terminology](https://support.apple.com/da-dk/102650);
[Microsoft list terminology](https://support.microsoft.com/da-dk/office/definer-nye-punkttegn-tal-og-opstillinger-i-flere-niveauer-6c06ef65-27ad-4893-80c9-0b944cb81f5f);
and [Apple media terminology](https://support.apple.com/da-dk/guide/tv/atvb7944597f/26/tvos/26).
These results close the Danish first pass; the distinct second review remains
unassigned.

### Spanish (`es`) — first pass complete

The first reviewer inspected and, after applying the approved corrections,
re-read 538/538 current Spanish values across all eight top-level namespaces
and every `tools.*` subnamespace. Coverage included all 38
placeholder-bearing values, all 29 documented source-only contracts, all 44
search aliases, every exact-English match, and all 35 changed-English
dependencies.

All 86 approved corrections are applied and exact. The initial dictionary had
26 exact-English values: 11 supported retentions and 15 defects. Those 15
defects are now localized, while approved `F-es-046` changed
`toolNames.marker` from `Resaltador` to `Color`, creating one newly supported
exact match. The final exact-English inventory is therefore 12 values,
recorded as `R-es-001` through `R-es-012` below. All 44 search aliases are
reviewed and normalization-distinct.

Fresh post-edit validation found 538 Spanish keys in the reviewed order, with
no missing, extra, or duplicate decoded keys. Placeholder multisets, string
type, non-empty, NFC, encoding, control-character, and boundary-whitespace
checks are clean. The translation-guideline suite passes 334/334, the
search-term quality suite passes 129/129, all 77 checker tests pass, and the
live translation checker exits successfully.

The selected register is informal Spain Spanish: `tú` imperatives for
instructions, infinitives for menu actions, and Spain terminology and
spelling such as `vídeo` and `añadir`. Terminology evidence includes
[Notion's Spain callout guidance](https://www.notion.com/es-es/help/customize-and-style-your-content?position=1)
for `Destacado`;
[Notion's Spain media guidance](https://www.notion.com/es-es/help/images-files-and-media)
for `leyenda`, media alignment, `Crear inserción`, and `Reemplazar`;
[Notion's board guidance](https://www.notion.com/es-es/help/boards)
for `añadir`, `tablero`, and `estado`;
[Microsoft programming-language terminology](https://support.microsoft.com/es-ES/infopath/change-the-programming-language-of-a-form-template);
[Microsoft cell-alignment terminology](https://support.microsoft.com/es-es/office/alinear-texto-en-una-celda-en-excel-b2489a1f-6c89-45b7-9562-bbc287aa71ea);
[Microsoft equation and LaTeX terminology](https://support.microsoft.com/es-es/office/escribir-una-ecuaci%C3%B3n-o-una-f%C3%B3rmula-1d01cabc-ceb1-458d-bc70-7f9737722702);
[Apple shortcut notation](https://support.apple.com/es-es/102650);
[Adobe aspect-ratio notation](https://helpx.adobe.com/es/premiere/mobile/manage-clips/change-the-aspect-ratio-of-clips.html);
and RAE entries for
[color](https://dle.rae.es/color),
[error](https://dle.rae.es/error), and
[audio](https://dle.rae.es/audio).

`notifier.dismiss` itself is valid Spanish (`Descartar`), but its production
caller in `src/components/utils/notifier/draw.ts` reads the bundled English
dictionary rather than the active locale. That localization bypass is
recorded as a valid caller disposition rather than a Spanish value finding and
does not block this dictionary pass. These results close the Spanish first
pass; the distinct second review remains unassigned.

## Findings

Add one row for every structural, semantic, style, register, terminology,
punctuation, accessibility, placeholder, encoding, or other guideline defect.
Preserve line breaks inside values as escaped text so each finding occupies one
Markdown row. Create it as `open` and use `verified` only after the correction
and its evidence satisfy the closure rules above. Locale-specific IDs use
`F-<locale>-NNN`. A cross-locale source dependency uses `F-global-NNN` and
follows the global transition rule above.

| Finding ID | Locale | Key | Category | Old | Expected | Evidence | Status |
|---|---|---|---|---|---|---|---|
| `F-en-001` | `en` | `blockSettings.openMenuAction` | grammar | `" to open menu"` | `" to open the menu"` | `settings-toggler.ts` composes the fragment into “Click … to open the menu”; preserve its leading U+0020. | verified |
| `F-en-002` | `en` | `blockSettings.convertWithChildrenWarning` | terminology / number | `This block has {count} nested blocks. Converting it will promote them to the top level. Continue?` | `Nested blocks: {count}. Converting this block will move them to the top level. Continue?` | Source-only warning contract (no current production caller); removes implementation-oriented “promote” and makes the count phrase grammatical for one or many. | verified |
| `F-en-003` | `en` | `tools.marker.textColor` | terminology | `Text` | `Text color` | Shared color-picker labels and slash commands require the explicit mode name; “Red Text” is ambiguous. | verified |
| `F-en-004` | `en` | `tools.toggle.bodyPlaceholder` | hint clarity | `Empty toggle. Click or drop blocks inside.` | `Empty toggle. Click to add a block, or drag blocks here.` | The placeholder click creates a child block and its container accepts dragged blocks; the replacement names both actions. | verified |
| `F-en-005` | `en` | `tools.table.insertColumnLeft` | capitalization | `Insert Column Left` | `Insert column left` | Row/column popover actions follow the explicitly resolved sentence-case UI convention. | verified |
| `F-en-006` | `en` | `tools.table.insertColumnRight` | capitalization | `Insert Column Right` | `Insert column right` | Row/column popover actions follow the explicitly resolved sentence-case UI convention. | verified |
| `F-en-007` | `en` | `tools.table.insertRowAbove` | capitalization | `Insert Row Above` | `Insert row above` | Row/column popover actions follow the explicitly resolved sentence-case UI convention. | verified |
| `F-en-008` | `en` | `tools.table.insertRowBelow` | capitalization | `Insert Row Below` | `Insert row below` | Row/column popover actions follow the explicitly resolved sentence-case UI convention. | verified |
| `F-en-009` | `en` | `tools.table.placement` | terminology | `Placement` | `Alignment` | The picker controls horizontal and vertical alignment of content inside selected cells; “placement” exposes the model term. | verified |
| `F-en-010` | `en` | `tools.table.placementTopLeft` | capitalization | `Top Left` | `Top left` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-011` | `en` | `tools.table.placementTopCenter` | capitalization | `Top Center` | `Top center` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-012` | `en` | `tools.table.placementTopRight` | capitalization | `Top Right` | `Top right` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-013` | `en` | `tools.table.placementMiddleLeft` | capitalization | `Middle Left` | `Middle left` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-014` | `en` | `tools.table.placementMiddleRight` | capitalization | `Middle Right` | `Middle right` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-015` | `en` | `tools.table.placementBottomLeft` | capitalization | `Bottom Left` | `Bottom left` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-016` | `en` | `tools.table.placementBottomCenter` | capitalization | `Bottom Center` | `Bottom center` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-017` | `en` | `tools.table.placementBottomRight` | capitalization | `Bottom Right` | `Bottom right` | The cell-alignment picker follows the explicitly resolved sentence-case convention. | verified |
| `F-en-018` | `en` | `a11y.dropCancelled` | locale spelling | `Drag cancelled` | `Drag canceled` | US spelling matches the dictionary's “Color,” “Gray,” and “Center” choices. | verified |
| `F-en-019` | `en` | `a11y.atTop` | grammar / accessibility | `Block is at the top, cannot move up` | `Block is at the top and cannot move up` | Removes a comma splice from the keyboard boundary announcement. | verified |
| `F-en-020` | `en` | `a11y.atBottom` | grammar / accessibility | `Block is at the bottom, cannot move down` | `Block is at the bottom and cannot move down` | Removes a comma splice from the keyboard boundary announcement. | verified |
| `F-en-021` | `en` | `a11y.searchResults` | number / accessibility | `{count} results` | `Search results: {count}` | Toolbox, block-settings, and code-language-search live regions can announce a count of one. | verified |
| `F-en-022` | `en` | `a11y.allBlocksSelected` | number / accessibility | `All blocks selected, {count} blocks` | `All blocks selected. Total: {count}` | Select-all can run in a one-block document; the replacement is count-neutral and avoids repetition. | verified |
| `F-en-023` | `en` | `tools.callout.addEmoji` | terminology | `Add emoji` | `Add icon` | The callout UI consistently presents the chosen emoji as its editable/removable icon. | verified |
| `F-en-024` | `en` | `tools.callout.filterEmojis` | search clarity | `Filter…` | `Search emojis…` | The value is the visible placeholder and accessible name of an emoji searchbox. | verified |
| `F-en-025` | `en` | `tools.callout.pickRandom` | action clarity | `Random` | `Pick a random emoji` | The dice icon's tooltip and accessible name need an explicit, grammatical action. | verified |
| `F-en-026` | `en` | `tools.code.searchLanguage` | punctuation / clarity | `Search language...` | `Search languages…` | The searchable list contains many languages and the corpus uses the single ellipsis character. | verified |
| `F-en-027` | `en` | `tools.link.linkTitle` | terminology | `Link title` | `Link text` | The edit field changes the anchor's visible text, not title metadata. | verified |
| `F-en-028` | `en` | `tools.image.altDescription` | accessibility / brevity | `Add alt text to describe this image. This makes your page more accessible to people who are vision-impaired or blind.` | `Describe this image for people who can’t see it.` | The alt-text dialog already supplies its purpose; the replacement is shorter, direct, and user-centered. | verified |
| `F-en-029` | `en` | `tools.file.previewError` | punctuation | `Couldn't load preview` | `Couldn’t load preview` | Other English contractions use the typographic apostrophe; this visible error was the sole straight-apostrophe outlier. | verified |
| `F-en-030` | `en` | `tools.database.viewTypeListDescription` | terminology / clarity | `A simple linear view` | `Show items in a simple list` | The subtitle beneath the List option should describe the familiar result instead of using abstract “linear view” terminology. | verified |
| `F-en-031` | `en` | `tools.bookmark.loading` | progress punctuation | `Loading link preview` | `Loading link preview…` | The rendered in-progress placeholder should match other ongoing loading states. | verified |
| `F-en-032` | `en` | `tools.embed.empty` | context | `Paste a link to embed` | `No embed link` | This key is rendered only for an empty embed in read-only mode, where pasting is impossible. | verified |
| `F-en-033` | `en` | `tools.video.toggleTimeDisplay` | accessibility / jargon | `Toggle time display` | `Switch between elapsed and remaining time` | The accessible button name now states both actual states instead of exposing “toggle.” | verified |
| `F-en-034` | `en` | `tools.video.ctxStats` | slang / terminology | `Stats for nerds` | `Playback statistics` | The context-menu item opens technical playback data; the replacement removes prohibited slang. | verified |
| `F-en-035` | `en` | `tools.callout.emojiSearchResults` | number / accessibility | `{count} emojis found` | `Emoji matches: {count}` | The live-region template can receive one; the replacement is count-neutral. | verified |
| `F-de-001` | `de` | `blockSettings.dragToMove` | naturalness | `"Ziehen zum Verschieben"` | `"Zum Verschieben ziehen"` | First line of the settings-toggler tooltip needs natural German infinitive word order. | verified |
| `F-de-002` | `de` | `blockSettings.clickToOpenMenu` | naturalness / accessibility | `"Klicken zum Öffnen des Menüs"` | `"Zum Öffnen des Menüs klicken"` | Standalone settings-toggler accessible name is stilted in the old word order. | verified |
| `F-de-003` | `de` | `blockSettings.convertWithChildrenWarning` | number / terminology | `"Dieser Block enthält {count} verschachtelte Blöcke. Durch die Konvertierung werden sie auf die oberste Ebene verschoben. Möchten Sie fortfahren?"` | `"Verschachtelte Blöcke: {count}. Beim Umwandeln dieses Blocks werden sie auf die oberste Ebene verschoben. Fortfahren?"` | Source-only warning must work for one or many and avoid needlessly technical `Konvertierung`. | verified |
| `F-de-004` | `de` | `toolbox.addBelow` | grammar | `"Klicken zum Einfügen darunter"` | `"Klicken, um darunter einzufügen"` | Plus-button tooltip needs a grammatical action phrase. | verified |
| `F-de-005` | `de` | `toolbox.optionAddAbove` | shortcut clarity | `"⌥ — darüber einfügen"` | `"⌥-Klick: darüber einfügen"` | Tooltip omitted the click gesture required by the shortcut. | verified |
| `F-de-006` | `de` | `toolbox.ctrlAddAbove` | shortcut clarity | `"Strg — darüber einfügen"` | `"Strg-Klick: darüber einfügen"` | Windows tooltip omitted the click gesture required by the shortcut. | verified |
| `F-de-007` | `de` | `toolbox.typeToSearch` | naturalness | `"Tippen zum Suchen"` | `"Zum Suchen tippen"` | Slash-toolbox search placeholder needs natural German word order. | verified |
| `F-de-008` | `de` | `toolNames.board` | terminology | `"Pinnwand"` | `"Board"` | Database toolbox entry is a Kanban-style board; `Pinnwand` conflicts with the established German product term and existing view labels. | verified |
| `F-de-009` | `de` | `toolNames.equation` | pending translation | `"Equation"` | `"Gleichung"` | Inline equation tool retained an English fallback instead of the standard German mathematical term. | verified |
| `F-de-010` | `de` | `tools.paragraph.placeholder` | clarity | `"Schreiben Sie etwas oder drücken Sie / zur Auswahl"` | `"Schreiben Sie etwas oder drücken Sie /, um ein Werkzeug auszuwählen"` | Paragraph placeholder omitted what the slash key selects. | verified |
| `F-de-011` | `de` | `tools.toggle.placeholder` | context | `"Aufklappen"` | `"Aufklappliste"` | Empty toggle title needs the content-type noun, not the action “expand.” | verified |
| `F-de-012` | `de` | `tools.toggle.bodyPlaceholder` | action clarity | `"Leeres Aufklappelement. Klicken oder Blöcke hineinziehen."` | `"Leeres Aufklappelement. Klicken Sie, um einen Block hinzuzufügen, oder ziehen Sie Blöcke hierher."` | Click creates a child block; the old copy never stated that result. | verified |
| `F-de-013` | `de` | `tools.marker.textColor` | terminology | `"Schrift"` | `"Textfarbe"` | Shared color-picker mode needs an explicit text-color label. | verified |
| `F-de-014` | `de` | `tools.table.clearSelection` | context | `"Löschen"` | `"Inhalte löschen"` | Table menus clear cell contents and must distinguish that action from deleting rows or columns. | verified |
| `F-de-015` | `de` | `tools.table.placement` | terminology | `"Position"` | `"Ausrichtung"` | Picker controls horizontal and vertical alignment of cell content. | verified |
| `F-de-016` | `de` | `a11y.dragHandle` | grammar / accessibility | `"Ziehen zum Verschieben oder klicken für Menü"` | `"Block zum Verschieben ziehen oder klicken, um das Menü zu öffnen"` | Drag-handle accessible name lacked its object and article and was grammatically clipped. | verified |
| `F-de-017` | `de` | `a11y.atTop` | grammar / accessibility | `"Block ist ganz oben, kann nicht weiter nach oben verschoben werden"` | `"Block ist ganz oben und kann nicht weiter nach oben verschoben werden"` | Keyboard boundary announcement contained a comma splice. | verified |
| `F-de-018` | `de` | `a11y.atBottom` | grammar / accessibility | `"Block ist ganz unten, kann nicht weiter nach unten verschoben werden"` | `"Block ist ganz unten und kann nicht weiter nach unten verschoben werden"` | Keyboard boundary announcement contained a comma splice. | verified |
| `F-de-019` | `de` | `a11y.searchResults` | number / accessibility | `"{count} Ergebnisse"` | `"Suchergebnisse: {count}"` | Search live regions can receive one, making the old plural ungrammatical. | verified |
| `F-de-020` | `de` | `a11y.allBlocksSelected` | number / accessibility | `"Alle Blöcke ausgewählt, {count} Blöcke"` | `"Alle Blöcke ausgewählt. Insgesamt: {count}"` | Select-all can contain one block; replacement is count-neutral and avoids repetition. | verified |
| `F-de-021` | `de` | `a11y.navigationModeEntered` | keyboard / accessibility | `"Navigationsmodus. Verwenden Sie die Pfeiltasten, um zwischen Blöcken zu wechseln, Enter zum Bearbeiten und Escape zum Beenden."` | `"Navigationsmodus. Wechseln Sie mit den Pfeiltasten zwischen Blöcken. Drücken Sie die Eingabetaste zum Bearbeiten und Esc zum Beenden."` | Screen-reader instruction needs German key naming and clearer sentence structure. | verified |
| `F-de-022` | `de` | `a11y.navigatedToBlock` | grammar / accessibility | `"Zu Block gewechselt"` | `"Zum Block gewechselt"` | Block-navigation announcement was missing the article. | verified |
| `F-de-023` | `de` | `a11y.dropCreateColumnLeft` | context / accessibility | `"Erstellt eine Spalte links"` | `"Beim Ablegen wird links eine Spalte erstellt"` | Pre-drop announcement must describe the prospective result. | verified |
| `F-de-024` | `de` | `a11y.dropCreateColumnRight` | context / accessibility | `"Erstellt eine Spalte rechts"` | `"Beim Ablegen wird rechts eine Spalte erstellt"` | Pre-drop announcement must describe the prospective result. | verified |
| `F-de-025` | `de` | `searchTerms.columns` | capitalization | `"spalten"` | `"Spalten"` | German noun capitalization is required and the alias peers already follow it. | verified |
| `F-de-026` | `de` | `searchTerms.layout` | capitalization | `"layout"` | `"Layout"` | Duden records the established German noun with an uppercase initial. | verified |
| `F-de-027` | `de` | `searchTerms.splitter` | semantic alias | `"Teiler"` | `"Unterteilung"` | `Teiler` primarily suggests a mathematical divisor and is not a useful divider-tool query. | verified |
| `F-de-028` | `de` | `searchTerms.header` | semantic alias | `"Kopfzeile"` | `"Header"` | Alias targets the heading tool; `Kopfzeile` means a page header. | verified |
| `F-de-029` | `de` | `searchTerms.unordered` | terminology | `"Unsortiert"` | `"Ungeordnet"` | Standard term is `ungeordnete Liste`; “unsorted” changes the meaning. | verified |
| `F-de-030` | `de` | `searchTerms.ordered` | terminology | `"Sortiert"` | `"Geordnet"` | Standard term is `geordnete Liste`; ordering is not sorting. | verified |
| `F-de-031` | `de` | `searchTerms.snippet` | slang / terminology | `"Schnipsel"` | `"Codeausschnitt"` | Colloquial `Schnipsel` is unsuitable for the code-tool alias. | verified |
| `F-de-032` | `de` | `tools.callout.addEmoji` | terminology | `"Emoji hinzufügen"` | `"Symbol hinzufügen"` | Callout UI treats the emoji as its editable and removable symbol. | verified |
| `F-de-033` | `de` | `tools.callout.filterEmojis` | search / accessibility | `"Filtern…"` | `"Emojis suchen…"` | Searchbox placeholder and accessible name should state what is searched. | verified |
| `F-de-034` | `de` | `tools.callout.pickRandom` | action clarity / accessibility | `"Zufällig"` | `"Zufälliges Emoji auswählen"` | Dice-button tooltip and accessible name need an explicit action. | verified |
| `F-de-035` | `de` | `tools.callout.emojiSearchResults` | number / accessibility | `"{count} Emojis gefunden"` | `"Emoji-Treffer: {count}"` | Live region can receive one; replacement is count-neutral. | verified |
| `F-de-036` | `de` | `tools.code.searchLanguage` | clarity / punctuation | `"Sprache suchen..."` | `"Sprachen suchen…"` | Picker searches many languages and the corpus uses a typographic ellipsis. | verified |
| `F-de-037` | `de` | `tools.equation.placeholder` | pending translation | `"Enter a LaTeX formula…"` | `"LaTeX-Formel eingeben…"` | Formula input instruction retained an English fallback while preserving the LaTeX product name. | verified |
| `F-de-038` | `de` | `tools.link.linkTitle` | terminology | `"Linktitel"` | `"Linktext"` | Inline link editor changes visible anchor text, not title metadata. | verified |
| `F-de-039` | `de` | `tools.image.uploadingLabel` | status aspect | `"Hochladen"` | `"Wird hochgeladen"` | Visible upload status read like an action rather than an in-progress state. | verified |
| `F-de-040` | `de` | `tools.image.converting` | pending translation | `"Converting…"` | `"Wird konvertiert…"` | Visible image-processing status retained an English fallback. | verified |
| `F-de-041` | `de` | `tools.image.altDescription` | accessibility / brevity | `"Fügen Sie einen Alternativtext hinzu, der das Bild beschreibt. So wird Ihre Seite für sehbehinderte oder blinde Personen zugänglicher."` | `"Beschreiben Sie dieses Bild für Menschen, die es nicht sehen können."` | Alt dialog already supplies the purpose; German accessibility guidance favors concise direct descriptions. | verified |
| `F-de-042` | `de` | `tools.image.errorFileTooLarge` | pending translation | `"Image is too large. {size} exceeds the {max} limit."` | `"Das Bild ist zu groß. {size} überschreitet die Höchstgrenze von {max}."` | Image upload size error retained an English fallback; placeholders remain exact. | verified |
| `F-de-043` | `de` | `tools.image.errorDefaultMessage` | natural error copy | `"Die URL hat einen Fehler zurückgegeben. Versuchen Sie eine andere Quelle oder laden Sie die Datei erneut hoch."` | `"Beim Laden der URL ist ein Fehler aufgetreten. Versuchen Sie eine andere Quelle oder laden Sie die Datei erneut hoch."` | A URL does not itself “return” an error; replacement is clearer and less technical. | verified |
| `F-de-044` | `de` | `tools.image.emptyOrDropHere` | grammar | `"oder Bild hier ablegen"` | `"oder ein Bild hier ablegen"` | Visible image empty-state instruction lacked an article. | verified |
| `F-de-045` | `de` | `tools.file.emptyDropHint` | grammar | `"oder Datei hier ablegen"` | `"oder eine Datei hier ablegen"` | Visible file empty-state instruction lacked an article. | verified |
| `F-de-046` | `de` | `tools.file.errorFileTooLarge` | pending translation | `"File is too large. {size} exceeds the {max} limit."` | `"Die Datei ist zu groß. {size} überschreitet die Höchstgrenze von {max}."` | File upload size error retained an English fallback; placeholders remain exact. | verified |
| `F-de-047` | `de` | `tools.file.previewRaw` | context | `"Original"` | `"Quelltext"` | Markdown preview tab shows source text, not an original file. | verified |
| `F-de-048` | `de` | `tools.file.previewRender` | jargon | `"Gerendert"` | `"Formatiert"` | Markdown preview tab should avoid an unnecessary technical anglicism and pair naturally with `Quelltext`. | verified |
| `F-de-049` | `de` | `tools.database.viewTypeListDescription` | terminology / clarity | `"Eine einfache lineare Ansicht"` | `"Elemente in einer einfachen Liste anzeigen"` | View picker should describe the familiar result rather than an abstract linear view. | verified |
| `F-de-050` | `de` | `tools.bookmark.loading` | progress punctuation | `"Linkvorschau wird geladen"` | `"Linkvorschau wird geladen…"` | Rendered in-progress placeholder needs the corpus progress ellipsis. | verified |
| `F-de-051` | `de` | `tools.embed.empty` | read-only context | `"Link zum Einbetten einfügen"` | `"Kein Link zum Einbetten"` | Key renders only for an empty read-only embed where pasting is impossible. | verified |
| `F-de-052` | `de` | `tools.video.hideControls` | number / terminology | `"Steuerung ausblenden"` | `"Steuerelemente ausblenden"` | Tune hides the complete set of player controls. | verified |
| `F-de-053` | `de` | `tools.video.errorFileTooLarge` | pending translation | `"Video is too large. {size} exceeds the {max} limit."` | `"Das Video ist zu groß. {size} überschreitet die Höchstgrenze von {max}."` | Video upload size error retained an English fallback; placeholders remain exact. | verified |
| `F-de-054` | `de` | `tools.video.emptyOrDropHere` | grammar | `"oder Video hier ablegen"` | `"oder ein Video hier ablegen"` | Visible video empty-state instruction lacked an article. | verified |
| `F-de-055` | `de` | `tools.video.seek` | semantic / accessibility | `"Suchen"` | `"Wiedergabeposition"` | Accessible name belongs to a media seek slider; `Suchen` means content search. | verified |
| `F-de-056` | `de` | `tools.video.toggleTimeDisplay` | accessibility / clarity | `"Zeitanzeige umschalten"` | `"Zwischen verstrichener und verbleibender Zeit wechseln"` | Accessible button name should state both actual time-display states. | verified |
| `F-de-057` | `de` | `tools.video.speedPresets` | naturalness / accessibility | `"Geschwindigkeitsvorgaben"` | `"Voreingestellte Geschwindigkeiten"` | Accessible group label for playback-speed presets was stilted. | verified |
| `F-de-058` | `de` | `tools.video.ctxCopyUrlAtTime` | context | `"Video-URL zur aktuellen Zeit kopieren"` | `"Video-URL an der aktuellen Wiedergabeposition kopieren"` | “Aktuelle Zeit” can mean clock time; action copies the media timestamp. | verified |
| `F-de-059` | `de` | `tools.video.ctxStats` | slang / terminology | `"Statistiken für Nerds"` | `"Wiedergabestatistiken"` | Context-menu item must remove prohibited slang and name the playback data. | verified |
| `F-de-060` | `de` | `tools.audio.errorFileTooLarge` | pending translation | `"Audio is too large. {size} exceeds the {max} limit."` | `"Die Audiodatei ist zu groß. {size} überschreitet die Höchstgrenze von {max}."` | Audio upload size error retained an English fallback; placeholders remain exact. | verified |
| `F-de-061` | `de` | `tools.audio.errorGoogleDrive` | register / error clarity | `"Google-Drive-Links können nicht direkt abgespielt werden — Datei herunterladen und hier hochladen."` | `"Google-Drive-Links lassen sich nicht direkt abspielen. Laden Sie die Datei stattdessen herunter und hier hoch."` | Recovery error switched to clipped infinitive wording and omitted the “instead” relationship. | verified |
| `F-de-062` | `de` | `tools.audio.errorOneDrive` | register / error clarity | `"OneDrive-Links können nicht direkt abgespielt werden — Datei herunterladen und hier hochladen."` | `"OneDrive-Links lassen sich nicht direkt abspielen. Laden Sie die Datei stattdessen herunter und hier hoch."` | Recovery error switched to clipped infinitive wording and omitted the “instead” relationship. | verified |
| `F-de-063` | `de` | `tools.audio.titlePlaceholder` | pending translation | `"Track title"` | `"Titel"` | Audio metadata field retained an English fallback. | verified |
| `F-de-064` | `de` | `tools.audio.artistPlaceholder` | pending translation | `"Artist"` | `"Künstler"` | Audio metadata field retained an English fallback. | verified |
| `F-de-065` | `de` | `tools.audio.emptyOrDropHere` | grammar / clarity | `"oder Audio hier ablegen"` | `"oder eine Audiodatei hier ablegen"` | Empty-state instruction lacked an article and refers to an audio file. | verified |
| `F-de-066` | `de` | `tools.audio.coverChange` | pending translation | `"Change cover"` | `"Cover ändern"` | Cover action retained an English fallback; `Cover` is an established German media term. | verified |
| `F-de-067` | `de` | `tools.audio.coverSet` | pending translation | `"Set cover image"` | `"Coverbild festlegen"` | Cover button and dialog accessible name retained an English fallback. | verified |
| `F-de-068` | `de` | `tools.audio.coverRemove` | pending translation | `"Remove cover"` | `"Cover entfernen"` | Cover action retained an English fallback. | verified |
| `F-de-069` | `de` | `tools.audio.coverErrorType` | pending translation | `"Choose an image file"` | `"Wählen Sie eine Bilddatei aus."` | Wrong-file-type recovery error retained an English fallback. | verified |
| `F-de-070` | `de` | `tools.audio.coverErrorTooLarge` | pending translation | `"Image is too large"` | `"Das Bild ist zu groß"` | Cover upload error retained an English fallback. | verified |
| `F-de-071` | `de` | `tools.audio.coverAdd` | pending translation | `"Add a cover"` | `"Cover hinzufügen"` | Cover-picker action retained an English fallback. | verified |
| `F-de-072` | `de` | `tools.audio.coverOrDropHere` | grammar | `"oder Bild hier ablegen"` | `"oder ein Bild hier ablegen"` | Cover-picker instruction lacked an article. | verified |
| `F-da-001` | `da` | `toolNames.equation` | pending translation | `"Equation"` | `"Ligning"` | Inline equation tool retained English instead of the standard Danish mathematical term. | verified |
| `F-da-002` | `da` | `tools.equation.placeholder` | pending translation | `"Enter a LaTeX formula…"` | `"Indtast en LaTeX-formel…"` | Formula input instruction retained English while the LaTeX product term remains unchanged. | verified |
| `F-da-003` | `da` | `tools.image.converting` | pending translation | `"Converting…"` | `"Konverterer…"` | Visible image-processing status retained an English fallback. | verified |
| `F-da-004` | `da` | `tools.image.errorFileTooLarge` | pending translation | `"Image is too large. {size} exceeds the {max} limit."` | `"Billedet er for stort. {size} overskrider grænsen på {max}."` | Image upload size error retained English; both placeholders remain exact. | verified |
| `F-da-005` | `da` | `tools.file.errorFileTooLarge` | pending translation | `"File is too large. {size} exceeds the {max} limit."` | `"Filen er for stor. {size} overskrider grænsen på {max}."` | File upload size error retained English; both placeholders remain exact. | verified |
| `F-da-006` | `da` | `tools.video.errorFileTooLarge` | pending translation | `"Video is too large. {size} exceeds the {max} limit."` | `"Videoen er for stor. {size} overskrider grænsen på {max}."` | Video upload size error retained English; both placeholders remain exact. | verified |
| `F-da-007` | `da` | `tools.audio.errorFileTooLarge` | pending translation | `"Audio is too large. {size} exceeds the {max} limit."` | `"Lydfilen er for stor. {size} overskrider grænsen på {max}."` | Audio upload size error retained English; both placeholders remain exact. | verified |
| `F-da-008` | `da` | `tools.audio.titlePlaceholder` | pending translation | `"Track title"` | `"Titel"` | Audio metadata field retained an English fallback; audio context supplies “track.” | verified |
| `F-da-009` | `da` | `tools.audio.artistPlaceholder` | pending translation | `"Artist"` | `"Kunstner"` | Audio metadata field retained an English fallback. | verified |
| `F-da-010` | `da` | `tools.audio.coverChange` | pending translation | `"Change cover"` | `"Skift coverbillede"` | Cover action retained English instead of the established Danish media term. | verified |
| `F-da-011` | `da` | `tools.audio.coverSet` | pending translation / context | `"Set cover image"` | `"Vælg coverbillede"` | Control opens the cover picker, so the replacement names its real action. | verified |
| `F-da-012` | `da` | `tools.audio.coverRemove` | pending translation | `"Remove cover"` | `"Fjern coverbillede"` | Cover action retained an English fallback. | verified |
| `F-da-013` | `da` | `tools.audio.coverErrorType` | pending translation | `"Choose an image file"` | `"Vælg en billedfil"` | Wrong-file-type validation instruction retained an English fallback. | verified |
| `F-da-014` | `da` | `tools.audio.coverErrorTooLarge` | pending translation | `"Image is too large"` | `"Billedet er for stort"` | Cover upload error retained an English fallback. | verified |
| `F-da-015` | `da` | `tools.audio.coverAdd` | pending translation | `"Add a cover"` | `"Tilføj et coverbillede"` | Cover-picker action retained an English fallback. | verified |
| `F-da-016` | `da` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Denne blok indeholder {count} indlejrede blokke. Konvertering vil flytte dem til øverste niveau. Vil du fortsætte?"` | `"Indlejrede blokke: {count}. Hvis blokken konverteres, flyttes de til øverste niveau. Fortsæt?"` | Source-only warning must remain grammatical for one or many and match the corrected source semantics. | verified |
| `F-da-017` | `da` | `tools.marker.textColor` | terminology | `"Tekst"` | `"Tekstfarve"` | Shared color-picker mode needs an explicit text-color label. | verified |
| `F-da-018` | `da` | `tools.toggle.bodyPlaceholder` | hint clarity | `"Tom sammenklappelig blok. Klik eller træk blokke ind."` | `"Tom sammenklappelig blok. Klik for at tilføje en blok, eller træk blokke hertil."` | Placeholder must distinguish click-to-create from drag-to-drop. | verified |
| `F-da-019` | `da` | `tools.table.placement` | terminology | `"Placering"` | `"Justering"` | Picker controls cell-content alignment rather than generic placement. | verified |
| `F-da-020` | `da` | `a11y.atTop` | grammar / accessibility | `"Blokken er øverst, kan ikke flyttes op"` | `"Blokken er øverst og kan ikke flyttes op"` | Keyboard boundary announcement contained a comma splice. | verified |
| `F-da-021` | `da` | `a11y.atBottom` | grammar / accessibility | `"Blokken er nederst, kan ikke flyttes ned"` | `"Blokken er nederst og kan ikke flyttes ned"` | Keyboard boundary announcement contained a comma splice. | verified |
| `F-da-022` | `da` | `a11y.searchResults` | number / accessibility | `"{count} resultater"` | `"Søgeresultater: {count}"` | Count-neutral live-region wording works for one or many. | verified |
| `F-da-023` | `da` | `a11y.allBlocksSelected` | number / accessibility | `"Alle blokke valgt, {count} blokke"` | `"Alle blokke er valgt. I alt: {count}"` | Select-all can contain one block; replacement avoids repeating a plural noun. | verified |
| `F-da-024` | `da` | `tools.callout.addEmoji` | terminology | `"Tilføj emoji"` | `"Tilføj ikon"` | Callout UI presents the emoji as an editable and removable icon. | verified |
| `F-da-025` | `da` | `tools.callout.filterEmojis` | search / accessibility | `"Filtrér…"` | `"Søg efter emojis…"` | Searchbox placeholder and accessible name should state what is searched. | verified |
| `F-da-026` | `da` | `tools.callout.pickRandom` | action clarity / accessibility | `"Tilfældig"` | `"Vælg en tilfældig emoji"` | Dice-button tooltip and accessible name need a complete action. | verified |
| `F-da-027` | `da` | `tools.code.searchLanguage` | search / punctuation | `"Søg sprog..."` | `"Søg efter sprog…"` | Natural search instruction needs the corpus-standard ellipsis character. | verified |
| `F-da-028` | `da` | `tools.link.linkTitle` | terminology | `"Linktitel"` | `"Linktekst"` | Inline link editor changes visible anchor text, not title metadata. | verified |
| `F-da-029` | `da` | `tools.image.altDescription` | accessibility / brevity | `"Tilføj alt-tekst, der beskriver billedet. Det gør siden mere tilgængelig for personer med nedsat syn eller blindhed."` | `"Beskriv billedet for personer, der ikke kan se det."` | Alt dialog already supplies the purpose; replacement is concise and direct. | verified |
| `F-da-030` | `da` | `tools.database.viewTypeListDescription` | terminology / clarity | `"En enkel lineær visning"` | `"Vis elementer på en enkel liste"` | View picker should describe the familiar rendered result rather than an abstract linear view. | verified |
| `F-da-031` | `da` | `tools.bookmark.loading` | progress punctuation | `"Indlæser linkeksempel"` | `"Indlæser linkeksempel…"` | Rendered in-progress placeholder needs an ellipsis. | verified |
| `F-da-032` | `da` | `tools.embed.empty` | read-only context | `"Indsæt et link for at indlejre"` | `"Intet link til indlejring"` | Key renders only for an empty read-only embed where pasting is impossible. | verified |
| `F-da-033` | `da` | `tools.video.toggleTimeDisplay` | accessibility / clarity | `"Skift tidsvisning"` | `"Skift mellem forløbet tid og resterende tid"` | Accessible name should state both actual time-display states. | verified |
| `F-da-034` | `da` | `tools.video.ctxStats` | slang / terminology | `"Statistik for nørder"` | `"Afspilningsstatistik"` | Context-menu item must remove prohibited slang and name the playback data. | verified |
| `F-da-035` | `da` | `tools.callout.emojiSearchResults` | number / accessibility | `"{count} emojis fundet"` | `"Matchende emojis: {count}"` | Count-neutral live-region wording works for one or many matches. | verified |
| `F-da-036` | `da` | `toolbox.optionAddAbove` | platform terminology | `"Option-klik for at tilføje ovenfor"` | `"Alternativ-klik for at tilføje ovenfor"` | Apple’s Danish macOS terminology uses `Alternativ`, including `Alternativ-klik`. | verified |
| `F-da-037` | `da` | `tools.paragraph.placeholder` | grammar / clarity | `"Skriv noget eller tryk / for at vælge"` | `"Skriv noget, eller tryk på / for at vælge et værktøj"` | Adds required Danish grammar, punctuation, and the omitted object. | verified |
| `F-da-038` | `da` | `tools.toggle.placeholder` | grammar / clarity | `"Sammenklappelig"` | `"Sammenklappelig liste"` | Bare adjective is incomplete as a visible title placeholder. | verified |
| `F-da-039` | `da` | `tools.table.comfortableText` | terminology | `"Behagelig tekst"` | `"Luftig tekst"` | This is the roomier density option opposite compact text, not emotional comfort. | verified |
| `F-da-040` | `da` | `a11y.dragHandle` | grammar / accessibility | `"Træk for at flytte blok eller klik for menu"` | `"Træk for at flytte blokken, eller klik for at åbne menuen"` | Accessible name needs definite objects and the explicit click result. | verified |
| `F-da-041` | `da` | `a11y.navigationModeExited` | grammar / accessibility | `"Afsluttede navigationstilstand"` | `"Navigationstilstand afsluttet"` | Old past-tense verb lacked a subject; replacement is a natural status announcement. | verified |
| `F-da-042` | `da` | `toolNames.divider` | terminology | `"Adskiller"` | `"Skillelinje"` | Tool inserts a visible rule; old noun suggested an agent or thing that separates. | verified |
| `F-da-043` | `da` | `tools.columns.resizeAriaLabel` | accessibility / clarity | `"Tilpas kolonner"` | `"Tilpas kolonnebredde"` | Resizer accessible name should identify the dimension it changes. | verified |
| `F-da-044` | `da` | `searchTerms.header` | semantic alias | `"sidehoved"` | `"rubrik"` | Alias targets the heading tool; `sidehoved` means a page header. | verified |
| `F-da-045` | `da` | `searchTerms.unordered` | terminology | `"usorteret"` | `"punktopstilling"` | An unordered list is not an unsorted list; replacement is established list terminology. | verified |
| `F-da-046` | `da` | `searchTerms.ordered` | terminology | `"sorteret"` | `"nummereret"` | An ordered list is numbered, not semantically sorted. | verified |
| `F-da-047` | `da` | `tools.file.previewRender` | context / terminology | `"Vis"` | `"Formateret"` | Rendered-view tab paired with `Kildetekst` needs a state label, not an imperative. | verified |
| `F-da-048` | `da` | `tools.video.alignmentLeft` | action clarity | `"Venstre"` | `"Venstrejustér"` | Menu item performs an alignment action and has no separate accessible label. | verified |
| `F-da-049` | `da` | `tools.video.alignmentCenter` | action clarity | `"Midten"` | `"Centrér"` | Menu item performs an alignment action and has no separate accessible label. | verified |
| `F-da-050` | `da` | `tools.video.alignmentRight` | action clarity | `"Højre"` | `"Højrejustér"` | Menu item performs an alignment action and has no separate accessible label. | verified |
| `F-da-051` | `da` | `tools.audio.alignmentLeft` | action clarity | `"Venstre"` | `"Venstrejustér"` | Menu item performs an alignment action and has no separate accessible label. | verified |
| `F-da-052` | `da` | `tools.audio.alignmentCenter` | action clarity | `"Midten"` | `"Centrér"` | Menu item performs an alignment action and has no separate accessible label. | verified |
| `F-da-053` | `da` | `tools.audio.alignmentRight` | action clarity | `"Højre"` | `"Højrejustér"` | Menu item performs an alignment action and has no separate accessible label. | verified |
| `F-da-054` | `da` | `tools.video.hideControls` | terminology | `"Skjul kontroller"` | `"Skjul mediekontrolelementer"` | Danish `kontroller` suggests checks; setting hides the complete media-control set. | verified |
| `F-da-055` | `da` | `tools.audio.errorGoogleDrive` | grammar / terminology | `"Google Drive-links kan ikke afspilles direkte — download filen og upload den her."` | `"Google Drive-links kan ikke afspilles direkte — hent filen, og upload den her i stedet."` | Recovery error should use the corpus term `hent`, restore “instead,” and coordinate the actions naturally. | verified |
| `F-da-056` | `da` | `tools.audio.errorOneDrive` | grammar / terminology | `"OneDrive-links kan ikke afspilles direkte — download filen og upload den her."` | `"OneDrive-links kan ikke afspilles direkte — hent filen, og upload den her i stedet."` | Recovery error should use the corpus term `hent`, restore “instead,” and coordinate the actions naturally. | verified |
| `F-da-057` | `da` | `tools.audio.emptyAddAudio` | grammar | `"Tilføj en lyd"` | `"Tilføj lyd"` | `Lyd` is a mass noun in this UI context; the indefinite article is unnatural. | verified |
| `F-da-058` | `da` | `tools.audio.emptyOrDropHere` | clarity | `"eller slip en lyd her"` | `"eller slip en lydfil her"` | Drop target accepts a file, not an abstract sound. | verified |
| `F-da-059` | `da` | `tools.audio.coverSourceAria` | accessibility / clarity | `"Billedkilde"` | `"Kilde til coverbillede"` | Accessible group name should identify the cover-image source selector. | verified |
| `F-da-060` | `da` | `tools.database.duplicateView` | terminology / consistency | `"Dublér"` | `"Dupliker"` | Matches every other Danish duplicate action; `dublere` primarily means dubbing or standing in. | verified |
| `F-da-061` | `da` | `tools.database.viewTypeBoardDescription` | grammar | `"Vis arbejde som kolonner"` | `"Vis arbejdet i kolonner"` | Adds the definite object and natural preposition for a column view. | verified |
| `F-da-062` | `da` | `notifier.dismiss` | accessibility / context | `"Afvis"` | `"Luk"` | Caller is a toast close button; old term suggested rejecting rather than closing. | verified |
| `F-da-063` | `da` | `tools.video.speedDecrease` | grammar / action clarity | `"Reducer afspilningshastighed"` | `"Sænk afspilningshastigheden"` | Natural imperative needs the definite object. | verified |
| `F-da-064` | `da` | `tools.video.speedIncrease` | grammar | `"Øg afspilningshastighed"` | `"Øg afspilningshastigheden"` | Adds the required definite ending to the object. | verified |
| `F-da-065` | `da` | `tools.video.speedPresets` | terminology | `"Hastighedsforvalg"` | `"Forudindstillede hastigheder"` | Natural Danish label for the group of preset playback speeds. | verified |
| `F-da-066` | `da` | `tools.video.ctxCopyUrlAtTime` | context / grammar | `"Kopiér video-URL ved aktuelt tidspunkt"` | `"Kopiér video-URL ved den aktuelle afspilningsposition"` | Context-menu action copies the media position, not a wall-clock time; replacement also fixes the definite phrase. | verified |
| `F-da-067` | `da` | `tools.audio.speedDecrease` | grammar / action clarity | `"Reducer afspilningshastighed"` | `"Sænk afspilningshastigheden"` | Natural imperative needs the definite object. | verified |
| `F-da-068` | `da` | `tools.audio.speedIncrease` | grammar | `"Øg afspilningshastighed"` | `"Øg afspilningshastigheden"` | Adds the required definite ending to the object. | verified |
| `F-es-001` | `es` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"La imagen es demasiado grande. {size} supera el límite de {max}."` | Image-size error retained English; both placeholders remain exact. | verified |
| `F-es-002` | `es` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"El vídeo es demasiado grande. {size} supera el límite de {max}."` | Video-size error retained English; Spain spelling and both placeholders are preserved. | verified |
| `F-es-003` | `es` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"El archivo es demasiado grande. {size} supera el límite de {max}."` | File-size error retained English; both placeholders remain exact. | verified |
| `F-es-004` | `es` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Convirtiendo…"` | Visible ongoing conversion state retained English. | verified |
| `F-es-005` | `es` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"El audio es demasiado grande. {size} supera el límite de {max}."` | Audio-size error retained English; grammatical gender and placeholders are correct. | verified |
| `F-es-006` | `es` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Título de la pista"` | Editable track-title placeholder retained English. | verified |
| `F-es-007` | `es` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"Artista"` | Audio metadata placeholder retained English instead of the established Spanish term. | verified |
| `F-es-008` | `es` | `tools.audio.coverChange` | pending translation / action | `"Change cover"` | `"Cambiar portada"` | Cover button accessible label retained English. | verified |
| `F-es-009` | `es` | `tools.audio.coverSet` | pending translation / action | `"Set cover image"` | `"Establecer imagen de portada"` | Settings item and cover-picker dialog label retained English. | verified |
| `F-es-010` | `es` | `tools.audio.coverRemove` | pending translation / action | `"Remove cover"` | `"Quitar portada"` | Cover action retained English; `Quitar` does not imply deleting the underlying file. | verified |
| `F-es-011` | `es` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Elige un archivo de imagen"` | Wrong-file-type validation instruction retained English. | verified |
| `F-es-012` | `es` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"La imagen es demasiado grande"` | Cover-size validation error retained English. | verified |
| `F-es-013` | `es` | `tools.audio.coverAdd` | pending translation / action | `"Add a cover"` | `"Añadir una portada"` | Empty cover-picker action retained English. | verified |
| `F-es-014` | `es` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Ecuación"` | Inline equation tool retained English instead of the established Spanish mathematical term. | verified |
| `F-es-015` | `es` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Escribe una fórmula LaTeX…"` | Formula input retained English; replacement uses the informal register and preserves `LaTeX`. | verified |
| `F-es-016` | `es` | `blockSettings.convertWithChildrenWarning` | number / terminology | `"Este bloque contiene {count} bloques anidados. Al convertirlo, pasarán al nivel superior. ¿Quieres continuar?"` | `"Bloques anidados: {count}. Al convertir este bloque, se moverán al nivel superior. ¿Quieres continuar?"` | Source-only warning needs a count-neutral label and the corrected move-to-top-level semantics. | verified |
| `F-es-017` | `es` | `tools.marker.textColor` | terminology | `"Texto"` | `"Color del texto"` | Shared color-picker mode needs an explicit text-color label. | verified |
| `F-es-018` | `es` | `tools.toggle.bodyPlaceholder` | hint clarity | `"Desplegable vacío. Haz clic o arrastra bloques dentro."` | `"Desplegable vacío. Haz clic para añadir un bloque o arrastra bloques aquí."` | Placeholder must distinguish click-to-create from drag-to-place. | verified |
| `F-es-019` | `es` | `tools.table.placement` | terminology | `"Posición"` | `"Alineación"` | Picker controls horizontal and vertical cell-content alignment. | verified |
| `F-es-020` | `es` | `tools.table.placementTopLeft` | grammar / terminology | `"Superior izquierda"` | `"Arriba a la izquierda"` | Natural Spanish label for the top-left alignment. | verified |
| `F-es-021` | `es` | `tools.table.placementTopCenter` | grammar / terminology | `"Superior centro"` | `"Arriba en el centro"` | Old telegraphic label is ungrammatical. | verified |
| `F-es-022` | `es` | `tools.table.placementTopRight` | grammar / terminology | `"Superior derecha"` | `"Arriba a la derecha"` | Natural Spanish label for the top-right alignment. | verified |
| `F-es-023` | `es` | `tools.table.placementMiddleLeft` | grammar / terminology | `"Centro izquierda"` | `"En el centro a la izquierda"` | Old telegraphic label is ungrammatical. | verified |
| `F-es-024` | `es` | `tools.table.placementMiddleRight` | grammar / terminology | `"Centro derecha"` | `"En el centro a la derecha"` | Old telegraphic label is ungrammatical. | verified |
| `F-es-025` | `es` | `tools.table.placementBottomLeft` | grammar / terminology | `"Inferior izquierda"` | `"Abajo a la izquierda"` | Natural Spanish label for the bottom-left alignment. | verified |
| `F-es-026` | `es` | `tools.table.placementBottomCenter` | grammar / terminology | `"Inferior centro"` | `"Abajo en el centro"` | Old telegraphic label is ungrammatical. | verified |
| `F-es-027` | `es` | `tools.table.placementBottomRight` | grammar / terminology | `"Inferior derecha"` | `"Abajo a la derecha"` | Natural Spanish label for the bottom-right alignment. | verified |
| `F-es-028` | `es` | `a11y.searchResults` | number / accessibility | `"{count} resultados"` | `"Resultados de búsqueda: {count}"` | Search live regions can receive one; replacement is count-neutral and identifies the result type. | verified |
| `F-es-029` | `es` | `a11y.allBlocksSelected` | number / accessibility | `"Todos los bloques seleccionados, {count} bloques"` | `"Todos los bloques seleccionados. Total: {count}"` | Select-all can contain one block; replacement avoids a dynamic-count plural. | verified |
| `F-es-030` | `es` | `tools.callout.addEmoji` | terminology | `"Añadir emoji"` | `"Añadir icono"` | Callout UI presents the emoji as its editable and removable icon. | verified |
| `F-es-031` | `es` | `tools.callout.filterEmojis` | search / accessibility | `"Filtrar…"` | `"Buscar emojis…"` | Searchbox placeholder and accessible name should state what is searched. | verified |
| `F-es-032` | `es` | `tools.callout.pickRandom` | action clarity / accessibility | `"Aleatorio"` | `"Elegir un emoji al azar"` | Dice-button tooltip and accessible name need a complete action. | verified |
| `F-es-033` | `es` | `tools.code.searchLanguage` | programming terminology / punctuation | `"Buscar idioma..."` | `"Buscar lenguajes…"` | Picker searches programming languages and the corpus uses a typographic ellipsis. | verified |
| `F-es-034` | `es` | `tools.link.linkTitle` | terminology | `"Título del enlace"` | `"Texto del enlace"` | Inline link editor changes visible anchor text, not title metadata. | verified |
| `F-es-035` | `es` | `tools.image.altDescription` | accessibility / brevity | `"Añade texto alternativo para describir esta imagen. Así tu página será más accesible para personas con discapacidad visual o ceguera."` | `"Describe esta imagen para quienes no puedan verla."` | Alt dialog already supplies the purpose; replacement is concise, direct, and user-centered. | verified |
| `F-es-036` | `es` | `tools.database.viewTypeListDescription` | terminology / clarity | `"Una vista lineal sencilla"` | `"Muestra los elementos en una lista sencilla"` | View picker should describe the familiar rendered result rather than an abstract linear view. | verified |
| `F-es-037` | `es` | `tools.bookmark.loading` | progress punctuation | `"Cargando vista previa del enlace"` | `"Cargando vista previa del enlace…"` | Rendered in-progress placeholder needs the corpus progress ellipsis. | verified |
| `F-es-038` | `es` | `tools.embed.empty` | read-only context | `"Pega un enlace para insertarlo"` | `"Sin enlace insertado"` | Key renders only for an empty read-only embed where pasting is impossible. | verified |
| `F-es-039` | `es` | `tools.video.toggleTimeDisplay` | accessibility / jargon | `"Alternar visualización del tiempo"` | `"Cambiar entre el tiempo transcurrido y el restante"` | Accessible name should state both actual time-display states. | verified |
| `F-es-040` | `es` | `tools.video.ctxStats` | slang / terminology | `"Estadísticas para nerds"` | `"Estadísticas de reproducción"` | Context-menu item must remove prohibited slang and name the playback data. | verified |
| `F-es-041` | `es` | `tools.callout.emojiSearchResults` | number / accessibility | `"{count} emojis encontrados"` | `"Coincidencias de emojis: {count}"` | Count-neutral live-region wording works for one or many matches. | verified |
| `F-es-042` | `es` | `blockSettings.clickToOpenMenu` | register / action | `"Clic para abrir el menú"` | `"Haz clic para abrir el menú"` | Standalone read-only accessible instruction needs the locale's informal imperative. | verified |
| `F-es-043` | `es` | `toolbox.addBelow` | register / action | `"Clic para añadir abajo"` | `"Haz clic para añadir debajo"` | Plus-button tooltip needs a natural informal instruction. | verified |
| `F-es-044` | `es` | `toolbox.optionAddAbove` | shortcut / action clarity | `"⌥ — añadir arriba"` | `"⌥ + clic para añadir encima"` | Tooltip omitted the click gesture required by the modifier shortcut. | verified |
| `F-es-045` | `es` | `toolbox.ctrlAddAbove` | shortcut / action clarity | `"Ctrl — añadir arriba"` | `"Ctrl + clic para añadir encima"` | Windows tooltip omitted the click gesture required by the modifier shortcut. | verified |
| `F-es-046` | `es` | `toolNames.marker` | terminology | `"Resaltador"` | `"Color"` | Tool controls both text and background colors, not only highlighting. | verified |
| `F-es-047` | `es` | `tools.table.clickToAddRow` | register / meaning | `"Clic para añadir una fila"` | `"Haz clic para añadir una fila nueva"` | Tooltip needs an imperative and must preserve the source's new-row meaning. | verified |
| `F-es-048` | `es` | `tools.table.clickToAddColumn` | register / meaning | `"Clic para añadir una columna"` | `"Haz clic para añadir una columna nueva"` | Tooltip needs an imperative and must preserve the source's new-column meaning. | verified |
| `F-es-049` | `es` | `blockSettings.lastEditedBy` | grammar / placeholder context | `"Última edición de {name}"` | `"Última edición por {name}"` | Inserted name is the editing agent, not the owner of the edit. | verified |
| `F-es-050` | `es` | `a11y.dragHandle` | accessibility / clarity | `"Arrastra para mover o haz clic para el menú"` | `"Arrastra para mover el bloque o haz clic para abrir el menú"` | Accessible name must identify the object and both available actions. | verified |
| `F-es-051` | `es` | `a11y.movedUp` | grammar / accessibility | `"Bloque movido arriba, posición {position} de {total}"` | `"Bloque movido hacia arriba a la posición {position} de {total}"` | Natural movement announcement preserves both placeholders. | verified |
| `F-es-052` | `es` | `a11y.movedDown` | grammar / accessibility | `"Bloque movido abajo, posición {position} de {total}"` | `"Bloque movido hacia abajo a la posición {position} de {total}"` | Natural movement announcement preserves both placeholders. | verified |
| `F-es-053` | `es` | `toolNames.callout` | terminology | `"Llamada"` | `"Destacado"` | Notion Spain's established term for this block is `Destacado`; `Llamada` means a call. | verified |
| `F-es-054` | `es` | `searchTerms.callout` | search terminology | `"llamada"` | `"destacado"` | Alias must use the established localized callout term. | verified |
| `F-es-055` | `es` | `tools.callout.placeholder` | terminology | `"Llamada"` | `"Destacado"` | Visible callout placeholder needs the established Spain term. | verified |
| `F-es-056` | `es` | `tools.callout.calloutEmojiCategory` | terminology | `"Llamada"` | `"Destacado"` | Emoji-picker category needs the established Spain callout term. | verified |
| `F-es-057` | `es` | `tools.database.addCard` | terminology / register | `"Agregar tarjeta"` | `"Añadir tarjeta"` | Match the Spain register and recurring database action verb. | verified |
| `F-es-058` | `es` | `tools.database.addColumn` | terminology / register | `"Agregar columna"` | `"Añadir columna"` | Match the Spain register and recurring database action verb. | verified |
| `F-es-059` | `es` | `tools.table.placementMiddleCenter` | terminology / consistency | `"Centro"` | `"En el centro"` | Completes the natural 3-by-3 alignment label matrix. | verified |
| `F-es-060` | `es` | `tools.code.language` | programming terminology | `"Idioma"` | `"Lenguaje"` | Caller selects programming languages. | verified |
| `F-es-061` | `es` | `tools.image.caption` | media terminology | `"Título"` | `"Leyenda"` | Caption is distinct from a title; Notion Spain uses `leyenda` for media captions. | verified |
| `F-es-062` | `es` | `tools.image.toggleCaption` | media terminology / accessibility | `"Mostrar u ocultar título"` | `"Mostrar u ocultar la leyenda"` | Overlay action must name the caption correctly. | verified |
| `F-es-063` | `es` | `tools.image.captionPlaceholder` | media terminology | `"Escribe un título…"` | `"Escribe una leyenda…"` | Source-only caption-field contract needs the established media term. | verified |
| `F-es-064` | `es` | `tools.image.replace` | terminology / consistency | `"Sustituir imagen"` | `"Reemplazar imagen"` | Standardize media replacement on the authoritative Notion Spain term. | verified |
| `F-es-065` | `es` | `tools.image.errorReplace` | terminology / consistency | `"Sustituir"` | `"Reemplazar"` | Image error UI needs the same replacement action. | verified |
| `F-es-066` | `es` | `tools.file.errorReplace` | terminology / consistency | `"Sustituir"` | `"Reemplazar"` | Error action must match existing `tools.file.replace`. | verified |
| `F-es-067` | `es` | `tools.video.alignmentLeft` | action terminology | `"Izquierda"` | `"Alinear a la izquierda"` | Child menu performs an alignment action and has no separate accessible label. | verified |
| `F-es-068` | `es` | `tools.video.alignmentCenter` | action terminology | `"Centro"` | `"Alinear al centro"` | Child menu performs an alignment action and has no separate accessible label. | verified |
| `F-es-069` | `es` | `tools.video.alignmentRight` | action terminology | `"Derecha"` | `"Alinear a la derecha"` | Child menu performs an alignment action and has no separate accessible label. | verified |
| `F-es-070` | `es` | `tools.video.caption` | media terminology | `"Título"` | `"Leyenda"` | Video caption is distinct from its title. | verified |
| `F-es-071` | `es` | `tools.video.toggleCaption` | media terminology | `"Mostrar u ocultar título"` | `"Mostrar u ocultar la leyenda"` | Source-only toggle contract needs the established caption term. | verified |
| `F-es-072` | `es` | `tools.video.replace` | terminology / consistency | `"Sustituir vídeo"` | `"Reemplazar vídeo"` | Standardize media replacement terminology. | verified |
| `F-es-073` | `es` | `tools.video.errorReplace` | terminology / consistency | `"Sustituir"` | `"Reemplazar"` | Video error UI needs the standardized replacement action. | verified |
| `F-es-074` | `es` | `tools.audio.alignmentLeft` | action terminology | `"Izquierda"` | `"Alinear a la izquierda"` | Settings child performs an alignment action. | verified |
| `F-es-075` | `es` | `tools.audio.alignmentCenter` | action terminology | `"Centro"` | `"Alinear al centro"` | Settings child performs an alignment action. | verified |
| `F-es-076` | `es` | `tools.audio.alignmentRight` | action terminology | `"Derecha"` | `"Alinear a la derecha"` | Settings child performs an alignment action. | verified |
| `F-es-077` | `es` | `tools.audio.caption` | media terminology | `"Título"` | `"Leyenda"` | Audio tool has a separate track-title field; this setting controls its caption. | verified |
| `F-es-078` | `es` | `tools.audio.replace` | terminology / consistency | `"Sustituir audio"` | `"Reemplazar audio"` | Standardize media replacement terminology. | verified |
| `F-es-079` | `es` | `tools.audio.errorReplace` | terminology / consistency | `"Sustituir"` | `"Reemplazar"` | Audio error UI needs the standardized replacement action. | verified |
| `F-es-080` | `es` | `tools.audio.emptyAddAudio` | grammar / brevity | `"Añadir un audio"` | `"Añadir audio"` | `Audio` is a mass noun in this concise empty-state action. | verified |
| `F-es-081` | `es` | `tools.audio.emptyOrDropHere` | clarity | `"o arrastra un audio aquí"` | `"o arrastra un archivo de audio aquí"` | Drop target accepts an audio file, not an abstract audio. | verified |
| `F-es-082` | `es` | `tools.audio.coverSourceAria` | accessibility / context | `"Origen de la imagen"` | `"Origen de la portada"` | Accessible group name must identify the cover-source chooser. | verified |
| `F-es-083` | `es` | `a11y.navigationModeExited` | register / accessibility | `"Se salió del modo de navegación"` | `"Has salido del modo de navegación"` | Remove the awkward impersonal passive and match informal second person. | verified |
| `F-es-084` | `es` | `a11y.navigatedToBlock` | grammar / accessibility | `"Se navegó al bloque"` | `"Has navegado hasta el bloque"` | Use a natural block-navigation announcement. | verified |
| `F-es-085` | `es` | `tools.video.seek` | accessibility terminology | `"Buscar"` | `"Posición de reproducción"` | Caller is a playback-position slider; `Buscar` incorrectly suggests content search. | verified |
| `F-es-086` | `es` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"Copiar URL del vídeo en el momento actual"` | `"Copiar la URL del vídeo a partir del momento actual"` | Clarifies that the copied link begins at the current playback position. | verified |
| `F-global-001` | all non-English | 35 changed English source keys | source dependency | Localized values have not been re-reviewed against the corrected source. | Re-audit the corresponding value in all 68 localized dictionaries and correct it where required. | English-source changes invalidate dependent semantic evidence; Tasks 6–12 inspect every affected value during each complete locale pass. | open |

## Exact-English Retentions

Record every non-English value that is exactly identical to English. The only
allowed categories are `universal notation`, `product-brand`, `acronym`,
`established cognate`, and `established loanword`. Similar spelling alone is
not a justification; the source must support normal unchanged use in the
locale and UI context.

| Retention ID | Locale | Key | Category | Justification | Source |
|---|---|---|---|---|---|
| `R-<locale>-NNN` | `<locale>` | `<key>` | category | justification | source |
| `R-da-001` | `da` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Danish Apple guidance retains the `⌘` symbol. | [Apple — Tastaturgenveje på Mac](https://support.apple.com/da-dk/102650) |
| `R-da-002` | `da` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than English prose; Danish Microsoft guidance retains `Ctrl` in key combinations. | [Microsoft — Tastaturgenveje i Windows](https://support.microsoft.com/da-dk/windows/tastaturgenveje-i-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-da-003` | `da` | `toolNames.link` | established loanword | `Link` is the established Danish computing term and the natural concise toolbox label. | [Den Danske Ordbog — link](https://ordnet.dk/ddo/ordbog?query=link) |
| `R-da-004` | `da` | `toolNames.database` | established loanword | `Database` is the established unchanged Danish computing term and the natural toolbox label. | [Den Danske Ordbog — database](https://ordnet.dk/ddo/ordbog/database) |
| `R-da-005` | `da` | `tools.colorPicker.defaultSwatchLabel` | universal notation | `{default} {mode}` contains only invariant runtime interpolation tokens; its Danish word order is encoded by the token sequence rather than English lexical copy. | [Translation Guidelines — placeholder integrity](../../src/components/i18n/locales/TRANSLATION_GUIDELINES.md) |
| `R-da-006` | `da` | `tools.colorPicker.colorSwatchLabel` | universal notation | `{color} {mode}` contains only invariant runtime interpolation tokens; its Danish word order is encoded by the token sequence rather than English lexical copy. | [Translation Guidelines — placeholder integrity](../../src/components/i18n/locales/TRANSLATION_GUIDELINES.md) |
| `R-da-007` | `da` | `tools.colorPicker.color.orange` | established loanword | `Orange` is the established unchanged Danish color adjective. | [Den Danske Ordbog — orange](https://ordnet.dk/ddo/ordbog?query=orange) |
| `R-da-008` | `da` | `searchTerms.layout` | established loanword | `layout` is an established Danish design term; lowercase matches Danish search-alias style. | [Den Danske Ordbog — layout](https://ordnet.dk/ddo/ordbog/layout) |
| `R-da-009` | `da` | `tools.callout.colorOrange` | established loanword | `Orange` is the established unchanged Danish color adjective. | [Den Danske Ordbog — orange](https://ordnet.dk/ddo/ordbog?query=orange) |
| `R-da-010` | `da` | `toolNames.video` | established loanword | `Video` is an established Danish media term and the natural concise toolbox label. | [Den Danske Ordbog — video](https://ordnet.dk/ddo/ordbog/video) |
| `R-da-011` | `da` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form of Danish `alt-tekst`; the surrounding dialog supplies the full localized label. | [Microsoft — Tilgængelige SharePoint-websteder](https://support.microsoft.com/da-dk/office/g%C3%B8r-dit-sharepoint-websted-tilg%C3%A6ngeligt-for-personer-med-handicap-53707eb5-b7b8-4ee0-ae82-9d4d916f7fe1) |
| `R-da-012` | `da` | `tools.image.emptyUpload` | established loanword | `Upload` is the established Danish computing term for the image-source action. | [Den Danske Ordbog — upload](https://ordnet.dk/ddo/ordbog?query=upload) |
| `R-da-013` | `da` | `tools.image.emptyLink` | established loanword | `Link` is the established Danish computing term for the image-source option. | [Den Danske Ordbog — link](https://ordnet.dk/ddo/ordbog?query=link) |
| `R-da-014` | `da` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Danish media interfaces. | [Apple — Skift billedformat](https://support.apple.com/da-dk/guide/iphone/iph3dc593597/ios) |
| `R-da-015` | `da` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Danish media interfaces. | [Apple — Skift billedformat](https://support.apple.com/da-dk/guide/iphone/iph3dc593597/ios) |
| `R-da-016` | `da` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Danish media interfaces. | [Apple — Skift billedformat](https://support.apple.com/da-dk/guide/iphone/iph3dc593597/ios) |
| `R-da-017` | `da` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Danish interfaces. | [Den Danske Ordbog — URL](https://ordnet.dk/ddo/ordbog/URL) |
| `R-da-018` | `da` | `tools.database.defaultStatusProperty` | established cognate | `Status` is the normal unchanged Danish noun for this workflow property. | [Den Danske Ordbog — status](https://ordnet.dk/ddo/ordbog/status) |
| `R-da-019` | `da` | `tools.file.emptyUpload` | established loanword | `Upload` is the established Danish computing term for the file-source action. | [Den Danske Ordbog — upload](https://ordnet.dk/ddo/ordbog?query=upload) |
| `R-da-020` | `da` | `tools.file.emptyLink` | established loanword | `Link` is the established Danish computing term for the file-source option. | [Den Danske Ordbog — link](https://ordnet.dk/ddo/ordbog?query=link) |
| `R-da-021` | `da` | `tools.video.emptyUpload` | established loanword | `Upload` is the established Danish computing term for the video-source action. | [Den Danske Ordbog — upload](https://ordnet.dk/ddo/ordbog?query=upload) |
| `R-da-022` | `da` | `tools.video.emptyLink` | established loanword | `Link` is the established Danish computing term for the video-source option. | [Den Danske Ordbog — link](https://ordnet.dk/ddo/ordbog?query=link) |
| `R-da-023` | `da` | `tools.audio.emptyUpload` | established loanword | `Upload` is the established Danish computing term for the audio-source action. | [Den Danske Ordbog — upload](https://ordnet.dk/ddo/ordbog?query=upload) |
| `R-da-024` | `da` | `tools.audio.emptyLink` | established loanword | `Link` is the established Danish computing term for the audio-source option. | [Den Danske Ordbog — link](https://ordnet.dk/ddo/ordbog?query=link) |
| `R-da-025` | `da` | `tools.audio.coverUpload` | established loanword | `Upload` is the established Danish computing term for the cover-image source action. | [Den Danske Ordbog — upload](https://ordnet.dk/ddo/ordbog?query=upload) |
| `R-da-026` | `da` | `tools.audio.coverLink` | established loanword | `Link` is the established Danish computing term for the cover-image source option. | [Den Danske Ordbog — link](https://ordnet.dk/ddo/ordbog?query=link) |
| `R-da-027` | `da` | `tools.video.pause` | established cognate | `Pause` is the normal unchanged Danish media-control label. | [Den Danske Ordbog — pause](https://ordnet.dk/ddo/ordbog/pause) |
| `R-da-028` | `da` | `tools.audio.pause` | established cognate | `Pause` is the normal unchanged Danish media-control label. | [Den Danske Ordbog — pause](https://ordnet.dk/ddo/ordbog/pause) |
| `R-de-001` | `de` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; German Apple guidance retains the `⌘` symbol. | [Apple — Tastaturkurzbefehle auf dem Mac](https://support.apple.com/de-de/guide/mac-help/mchld6b9e240/mac) |
| `R-de-002` | `de` | `toolNames.link` | established loanword | `Link` is the established German computing term and the natural concise toolbox label. | [Duden — Link](https://www.duden.de/rechtschreibung/Link) |
| `R-de-003` | `de` | `tools.colorPicker.color.orange` | established loanword | `Orange` is the established unchanged German name of the color. | [Duden — Orange](https://www.duden.de/rechtschreibung/Orange_Farbe) |
| `R-de-004` | `de` | `toolNames.board` | established loanword | `Board` is established German product terminology for this column-based Planner view. | [Microsoft Planner — Navigieren mit einer Sprachausgabe](https://support.microsoft.com/de-de/accessibility/planner/use-a-screen-reader-to-explore-and-navigate-microsoft-planner) |
| `R-de-005` | `de` | `tools.callout.colorOrange` | established loanword | `Orange` is the established unchanged German name of the color. | [Duden — Orange](https://www.duden.de/rechtschreibung/Orange_Farbe) |
| `R-de-006` | `de` | `toolNames.code` | established loanword | `Code` is an established German computing term and the natural concise tool name. | [Duden — Code](https://www.duden.de/rechtschreibung/Code) |
| `R-de-007` | `de` | `tools.code.codeTab` | established loanword | `Code` is the established German label for program source in this editor tab. | [Duden — Code](https://www.duden.de/rechtschreibung/Code) |
| `R-de-008` | `de` | `toolNames.video` | established loanword | `Video` is an established German media term and the natural concise toolbox label. | [Duden — Video](https://www.duden.de/rechtschreibung/Video) |
| `R-de-009` | `de` | `toolNames.audio` | established loanword | `Audio` is an established German media term and the natural concise toolbox label. | [Duden — Audio](https://www.duden.de/rechtschreibung/Audio) |
| `R-de-010` | `de` | `tools.link.linkText` | established cognate | `Text` is the normal unchanged German noun for the visible link text. | [Duden — Text](https://www.duden.de/rechtschreibung/Text_Schrift) |
| `R-de-011` | `de` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form associated with German `Alternativtext`; the dialog supplies the full localized label. | [MDN — Das Bildeinbettungs-Element](https://developer.mozilla.org/de/docs/Web/HTML/Reference/Elements/img) |
| `R-de-012` | `de` | `tools.image.emptyLink` | established loanword | `Link` is the established German computing term for the image source option. | [Duden — Link](https://www.duden.de/rechtschreibung/Link) |
| `R-de-013` | `de` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in German media software. | [Apple Final Cut Pro — Seitenverhältnisse](https://support.apple.com/de-de/guide/final-cut-pro/ver2bea770c/mac) |
| `R-de-014` | `de` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in German media software. | [Apple Final Cut Pro — Seitenverhältnisse](https://support.apple.com/de-de/guide/final-cut-pro/ver2bea770c/mac) |
| `R-de-015` | `de` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in German media software. | [Apple Final Cut Pro — Seitenverhältnisse](https://support.apple.com/de-de/guide/final-cut-pro/ver2bea770c/mac) |
| `R-de-016` | `de` | `tools.file.emptyLink` | established loanword | `Link` is the established German computing term for the file source option. | [Duden — Link](https://www.duden.de/rechtschreibung/Link) |
| `R-de-017` | `de` | `tools.video.autoplay` | established loanword | `Autoplay` is the established unchanged setting name in German video interfaces. | [YouTube-Hilfe — Automatische Wiedergabe](https://support.google.com/youtube/answer/6327615?hl=de) |
| `R-de-018` | `de` | `tools.video.emptyLink` | established loanword | `Link` is the established German computing term for the video source option. | [Duden — Link](https://www.duden.de/rechtschreibung/Link) |
| `R-de-019` | `de` | `tools.audio.emptyLink` | established loanword | `Link` is the established German computing term for the audio source option. | [Duden — Link](https://www.duden.de/rechtschreibung/Link) |
| `R-de-020` | `de` | `tools.audio.coverLink` | established loanword | `Link` is the established German computing term for the cover-image source option. | [Duden — Link](https://www.duden.de/rechtschreibung/Link) |
| `R-de-021` | `de` | `tools.database.viewTypeBoard` | established loanword | `Board` is established German product terminology for a column-based Planner view. | [Microsoft Planner — Navigieren mit einer Sprachausgabe](https://support.microsoft.com/de-de/accessibility/planner/use-a-screen-reader-to-explore-and-navigate-microsoft-planner) |
| `R-de-022` | `de` | `tools.database.propertyTypeText` | established cognate | `Text` is the normal unchanged German noun for this database property type. | [Duden — Text](https://www.duden.de/rechtschreibung/Text_Schrift) |
| `R-de-023` | `de` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in German interfaces. | [Duden — URL](https://www.duden.de/rechtschreibung/URL) |
| `R-de-024` | `de` | `tools.database.defaultStatusProperty` | established cognate | `Status` is the normal unchanged German noun for this workflow property. | [Duden — Status](https://www.duden.de/rechtschreibung/Status) |
| `R-de-025` | `de` | `tools.database.defaultViewBoard` | established loanword | `Board` is established German product terminology for the default column-based view. | [Microsoft Planner — Navigieren mit einer Sprachausgabe](https://support.microsoft.com/de-de/accessibility/planner/use-a-screen-reader-to-explore-and-navigate-microsoft-planner) |
| `R-es-001` | `es` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is platform shortcut notation rather than English prose; Spanish macOS documentation retains the `⌘` symbol. | [Apple — Atajos de teclado del Mac](https://support.apple.com/es-es/102650) |
| `R-es-002` | `es` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is platform shortcut notation rather than translatable prose; Spanish Windows documentation retains `Ctrl`. | [Microsoft — Métodos abreviados de teclado de Windows](https://support.microsoft.com/es-es/topic/m%C3%A9todos-abreviados-de-teclado-f2302f54-02a3-a62b-36ef-74ee5a83cb87) |
| `R-es-003` | `es` | `tools.stub.error` | established cognate | `Error` is the normal unchanged Spanish noun for an error state. | [RAE — error](https://dle.rae.es/error) |
| `R-es-004` | `es` | `tools.table.cellColor` | established cognate | `Color` is the normal unchanged Spanish UI noun for a color control. | [RAE — color](https://dle.rae.es/color) |
| `R-es-005` | `es` | `tools.callout.color` | established cognate | `Color` is the normal unchanged Spanish UI noun for a color control. | [RAE — color](https://dle.rae.es/color) |
| `R-es-006` | `es` | `toolNames.audio` | established loanword | `Audio` is an established Spanish media term and the natural short toolbox label. | [RAE — audio](https://dle.rae.es/audio) |
| `R-es-007` | `es` | `tools.image.altButton` | acronym | `Alt` is the conventional compact UI abbreviation for `texto alternativo`; the button's accessible name already supplies the full localized phrase. | [Microsoft — Insertar una imagen con un lector de pantalla](https://support.microsoft.com/es-es/accessibility/word/use-a-screen-reader-to-insert-a-picture-or-image-in-word) |
| `R-es-008` | `es` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Spanish media software. | [Adobe — Cambiar la relación de aspecto](https://helpx.adobe.com/es/premiere/mobile/manage-clips/change-the-aspect-ratio-of-clips.html) |
| `R-es-009` | `es` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Spanish media software. | [Adobe — Cambiar la relación de aspecto](https://helpx.adobe.com/es/premiere/mobile/manage-clips/change-the-aspect-ratio-of-clips.html) |
| `R-es-010` | `es` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Spanish media software. | [Adobe — Cambiar la relación de aspecto](https://helpx.adobe.com/es/premiere/mobile/manage-clips/change-the-aspect-ratio-of-clips.html) |
| `R-es-011` | `es` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Spanish product interfaces. | [Microsoft — Búsqueda de Microsoft](https://support.microsoft.com/es-es/office/foundations-experiences/find-what-you-need-with-microsoft-search) |
| `R-es-012` | `es` | `toolNames.marker` | established cognate | Spanish `Color` is the standard term naming both text and background color modes exposed by the marker tool. | [RAE — color](https://dle.rae.es/color) |
