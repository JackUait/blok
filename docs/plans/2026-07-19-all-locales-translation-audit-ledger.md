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
| `Finding IDs` | Exactly `—` when no locale-specific finding has ever been recorded, otherwise existing `F-<locale>-NNN` rows written as comma-separated IDs and/or inclusive same-locale ranges such as `` `F-da-001`–`F-da-070` ``. The executable contract expands every range and requires an exact match with the finding table. Verified findings remain listed as history. A global `F-global-NNN` finding is recorded once in the finding table and is not duplicated into every affected locale row. |
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
| `am` | Amharic | Ethiopic | ltr | to-audit | — | — | pending | pending | pending | `F-am-001` | pending |
| `ar` | Arabic | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-ar-001` | pending |
| `az` | Azerbaijani | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-az-001` | pending |
| `bg` | Bulgarian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-bg-001` | pending |
| `bn` | Bengali | Bengali | ltr | to-audit | — | — | pending | pending | pending | `F-bn-001` | pending |
| `bs` | Bosnian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-bs-001` | pending |
| `cs` | Czech | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-cs-001` | pending |
| `da` | Danish | Latin | ltr | neutral concise Danish; direct actions; lowercase search aliases | — | — | pending | pending | pending | `F-da-001`–`F-da-070` | pending |
| `de` | German | Latin | ltr | formal `Sie` in sentences; concise infinitive actions; German noun capitalization | — | — | pending | pending | pending | `F-de-001`–`F-de-073` | pending |
| `dv` | Dhivehi (Maldivian) | Thaana | rtl | to-audit | — | — | pending | pending | pending | `F-dv-001` | pending |
| `el` | Greek | Greek | ltr | to-audit | — | — | pending | pending | pending | `F-el-001` | pending |
| `en` | English | Latin | ltr | concise US English; sentence-case UI | — | — | pending | pending | pending | `F-en-001`–`F-en-036` | pending |
| `es` | Spanish | Latin | ltr | informal Spain Spanish; `tú` imperatives for instructions; infinitive menu actions; Spain terminology and spelling | — | — | pending | pending | pending | `F-es-001`–`F-es-087` | pending |
| `et` | Estonian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-et-001` | pending |
| `fa` | Persian (Farsi) | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-fa-001` | pending |
| `fi` | Finnish | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-fi-001` | pending |
| `fil` | Filipino | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-fil-001` | pending |
| `fr` | French | Latin | ltr | formal France French (`fr-FR`) in sentences; concise infinitive actions; sentence case; lowercase search aliases | — | — | pending | pending | pending | `F-fr-001`–`F-fr-125` | pending |
| `gu` | Gujarati | Gujarati | ltr | to-audit | — | — | pending | pending | pending | `F-gu-001` | pending |
| `he` | Hebrew | Hebrew | rtl | to-audit | — | — | pending | pending | pending | `F-he-001` | pending |
| `hi` | Hindi | Devanagari | ltr | to-audit | — | — | pending | pending | pending | `F-hi-001` | pending |
| `hr` | Croatian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-hr-001` | pending |
| `hu` | Hungarian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-hu-001` | pending |
| `hy` | Armenian | Armenian | ltr | to-audit | — | — | pending | pending | pending | `F-hy-001` | pending |
| `id` | Indonesian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-id-001` | pending |
| `it` | Italian | Latin | ltr | neutral contemporary Italian; informal singular `tu` imperatives for instructions; concise imperatives for actions; sentence case | — | — | pending | pending | pending | `F-it-001`–`F-it-084` | pending |
| `ja` | Japanese | Han, Hiragana, Katakana | ltr | to-audit | — | — | pending | pending | pending | `F-ja-001` | pending |
| `ka` | Georgian | Georgian | ltr | to-audit | — | — | pending | pending | pending | `F-ka-001` | pending |
| `km` | Khmer | Khmer | ltr | to-audit | — | — | pending | pending | pending | `F-km-001` | pending |
| `kn` | Kannada | Kannada | ltr | to-audit | — | — | pending | pending | pending | `F-kn-001` | pending |
| `ko` | Korean | Hangul | ltr | to-audit | — | — | pending | pending | pending | `F-ko-001` | pending |
| `ku` | Sorani (Central Kurdish) | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-ku-001` | pending |
| `lo` | Lao | Lao | ltr | to-audit | — | — | pending | pending | pending | `F-lo-001` | pending |
| `lt` | Lithuanian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-lt-001` | pending |
| `lv` | Latvian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-lv-001` | pending |
| `mk` | Macedonian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-mk-001` | pending |
| `ml` | Malayalam | Malayalam | ltr | to-audit | — | — | pending | pending | pending | `F-ml-001` | pending |
| `mn` | Mongolian (current Cyrillic wording) | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-mn-001` | pending |
| `mr` | Marathi | Devanagari | ltr | to-audit | — | — | pending | pending | pending | `F-mr-001` | pending |
| `ms` | Malay | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-ms-001` | pending |
| `my` | Burmese (Myanmar) | Myanmar | ltr | to-audit | — | — | pending | pending | pending | `F-my-001` | pending |
| `ne` | Nepali | Devanagari | ltr | to-audit | — | — | pending | pending | pending | `F-ne-001` | pending |
| `nl` | Dutch | Latin | ltr | neutral Netherlands Dutch; informal `je` in full instructions and confirmations; concise infinitive actions and direct imperatives; sentence case; standard Dutch compounds and punctuation | — | — | pending | pending | pending | `F-nl-001`–`F-nl-067` | pending |
| `no` | Norwegian (current Bokmål wording) | Latin | ltr | neutral contemporary Bokmål; informal singular `du` in full instructions and confirmations; concise imperatives for actions; sentence case; lowercase search aliases | — | — | pending | pending | pending | `F-no-001`–`F-no-075` | pending |
| `pa` | Punjabi (Gurmukhi) | Gurmukhi | ltr | to-audit | — | — | pending | pending | pending | `F-pa-001` | pending |
| `pl` | Polish | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-pl-001` | pending |
| `ps` | Pashto | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-ps-001` | pending |
| `pt` | Portuguese (current Brazilian wording) | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-pt-001` | pending |
| `ro` | Romanian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-ro-001` | pending |
| `ru` | Russian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-ru-001` | pending |
| `sd` | Sindhi | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-sd-001` | pending |
| `si` | Sinhala | Sinhala | ltr | to-audit | — | — | pending | pending | pending | `F-si-001` | pending |
| `sk` | Slovak | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sk-001` | pending |
| `sl` | Slovenian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sl-001` | pending |
| `sq` | Albanian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sq-001` | pending |
| `sr` | Serbian (Cyrillic) | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-sr-001` | pending |
| `sv` | Swedish | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sv-001` | pending |
| `sw` | Swahili | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sw-001` | pending |
| `ta` | Tamil | Tamil | ltr | to-audit | — | — | pending | pending | pending | `F-ta-001` | pending |
| `te` | Telugu | Telugu | ltr | to-audit | — | — | pending | pending | pending | `F-te-001` | pending |
| `th` | Thai | Thai | ltr | to-audit | — | — | pending | pending | pending | `F-th-001` | pending |
| `tr` | Turkish | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-tr-001` | pending |
| `ug` | Uyghur | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-ug-001` | pending |
| `uk` | Ukrainian | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-uk-001` | pending |
| `ur` | Urdu | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-ur-001` | pending |
| `vi` | Vietnamese | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-vi-001` | pending |
| `yi` | Yiddish | Hebrew | rtl | to-audit | — | — | pending | pending | pending | `F-yi-001` | pending |
| `zh` | Chinese (Simplified) | Simplified Han | ltr | to-audit | — | — | pending | pending | pending | `F-zh-001` | pending |
| `zh-TW` | Chinese (Taiwan, Traditional) | Traditional Han | ltr | to-audit | — | — | pending | pending | pending | `F-zh-TW-001` | pending |

## Reviewed Dictionary Digests

These hashes bind each completed review to the exact raw dictionary that both
the reviewer and executable checks inspected. A row is removed whenever its
locale returns to `pending`.

| Locale | First-pass reviewer | First-pass dictionary SHA-256 | Second-pass reviewer | Second-pass dictionary SHA-256 |
|---|---|---|---|---|

## 539-Key Clear-Formatting Schema Migration

Commit `f5145276` introduced the built-in clear-format inline tool with
`titleKey = 'clearFormat'`, which the runtime resolves as
`toolNames.clearFormat`. The committed caller initially had no corresponding
English or localized dictionary key, so every locale fell back to the raw
English title. A red-first inline-tool sweep reproduces that one missing key,
and the translation checker’s static source scan now recognizes literal
`titleKey` assignments and independently reports the same source-coverage
failure.

This is an English source-key change whose affected set is all 69 dictionaries.
Evidence reset rule 2 therefore resets every locale row, clears every reviewer
cell, removes every digest, and requires both complete passes again against
the eventual 539-key files. The earlier 538-key reviews and findings remain
historical evidence, but none supports a current completion state. `F-en-036`
records the source defect before remediation. One locale-specific missing-key
finding with source-backed native wording will be recorded for every localized
dictionary before the 539th values are added.

Migration remediation is now structurally complete. Red-first checks first
reported the missing English key and then all 68 missing localized values.
Terminology research used localized Microsoft, Google, LibreOffice, CKEditor,
TinyMCE, WordPress, and official educational sources, plus each dictionary’s
own established vocabulary and register. Independent review rejected five
overlong Clear Direct Formatting calques; their revised expectations failed
five focused cases before the shorter native values were applied. The final
69/69 clear-format expectation cases, 69/69 key-completeness cases, the
inline-tool title-key sweep, the source-copy and inline-metadata cases, all 79
checker unit cases, and the live 539-key completeness, integrity, static
source-coverage, encoding, and normalization checker pass. `F-en-036` and all
68 localized migration findings are therefore verified. This evidence closes
only the missing-key defect; every locale row remains `pending` and still
requires two complete, distinct 539-entry linguistic passes.

## English Source Audit Evidence — prior 538-key pass reset by migration

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
exact regression cases and their machine-checked ledger synchronization
passed against that historical corpus, as did all 69 locale corpus cases, all
77 checker tests, and the live structural checker. English has no
exact-English retention inventory by definition. That 538-key first pass was
complete before the migration; it is not current evidence for the 539-key
corpus. Hardcoded source text outside locale dictionaries remains outside the
approved scope of this translation-value audit.

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

### Danish (`da`) — first-pass evidence reset by second review

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
The distinct second review approved the rest of this evidence but found that
`F-da-016` still used plural `de` for content whose `{count}` may equal one,
and that `tools.video.pip` did not match Apple’s unhyphenated Danish
`Billede i billede`. `F-da-016` is therefore reopened with a count-neutral
expectation and `F-da-069` records the additional terminology defect. The
Danish results, reviewer cells, digest, and final status are reset until both
corrections are applied and the complete current dictionary is reviewed again.

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

### French (`fr`) — first pass complete

The first reviewer inspected 538/538 current French values in the shipped
France-French (`fr-FR`) dictionary. This pre-correction inspection covered all
eight top-level namespaces: 16 `blockSettings`, 4 `toolbox`, 4 `popover`, 28
`toolNames`, 414 `tools`, 27 `a11y`, 44 `searchTerms`, and 1 `notifier` value.
The 414 tool values were checked across all 23 `tools.*` subnamespaces. Caller
tracing classified 508 values as localized caller-consumed, 29 as documented
source-only contracts, and `notifier.dismiss` as the one
localization-bypassed value. All 38 placeholder-bearing values, 44/44 search
aliases, 29 source-only values, and 35 changed-English dependencies were
individually reviewed.

The inspection accepted 123 corrections that were absent from the
then-current dictionary: 15 formerly pending English fallbacks, 30 of the 35
changed-English dependencies, 60 additional semantic, terminology, grammar,
register, or accessibility defects, and 18 punctuation-only defects. The
other five changed-English dependencies retain their reviewed French wording.
Four source-only values require correction and the other 25 retain their
reviewed wording. The current 37 exact-English matches partition into the 15
open pending-translation findings and 22 supported retentions recorded as
`R-fr-001` through `R-fr-022`. All 44 current aliases are
normalization-distinct, and the adjudicated alias replacements remain distinct;
central adjudication selected `séparation` for `searchTerms.splitter`.

Fresh pre-edit structural inspection found 538 French keys matching the 538
English keys, with no missing, extra, or duplicate decoded keys. String type,
non-empty value, placeholder multiset, NFC normalization, encoding,
control-character, replacement-character, and boundary-whitespace checks are
clean. All 77 translation-checker tests pass, as do the focused
duplicate/search/video/quote suites. The exact raw pre-edit dictionary digest
is
`sha256:bd3a778e33dd22abf2541d8a1a130bdf1760c873ed7e2e929c9d8484da95f1f7`.
It is recorded here only to identify the inspected defective input and is not
a reviewed-dictionary digest supporting a completed pass.

France-French product terminology is supported by
[Notion writing and editing guidance](https://www.notion.com/fr/help/writing-and-editing-basics),
[Notion customization guidance](https://www.notion.com/fr/help/customize-and-style-your-content),
[Notion media guidance](https://www.notion.com/fr/help/images-files-and-media),
[Notion search guidance](https://www.notion.com/fr/help/search), and
[Notion list-view guidance](https://www.notion.com/fr/help/lists).
Alignment, automatic wrapping, and zoom terminology are supported by
[Microsoft text-alignment guidance](https://support.microsoft.com/fr-fr/word/align-text-left-or-right-center-text-or-justify-text-on-a-page),
[Microsoft automatic-wrap guidance](https://support.microsoft.com/fr-fr/office/habillage-du-texte-dans-une-cellule-dans-excel-2a18cff5-ccc1-4bce-95e4-f0d4f3ff4e84),
and
[Microsoft zoom guidance](https://support.microsoft.com/fr-FR/Access/zoom-in-or-out-of-forms-tables-and-queries-when-in-form-view-or-datasheet-view).
Media controls, metadata, shortcut notation, and aspect-ratio notation are
supported by
[Apple Music guidance](https://support.apple.com/fr-fr/guide/iphone/iph676daac9b/ios),
[Apple keyboard guidance](https://support.apple.com/fr-fr/guide/mac-help/mchlp2262/mac),
and
[Apple Clips guidance](https://support.apple.com/fr-fr/guide/clips/dev57f9eb69d/ios).
Lexical evidence includes the Académie française entries for
[intertitre](https://www.dictionnaire-academie.fr/article/A9I1787),
[code](https://www.dictionnaire-academie.fr/article/A9C2779),
[image](https://www.dictionnaire-academie.fr/article/A9I0182),
[action](https://www.dictionnaire-academie.fr/article/A9A0471),
[date](https://www.dictionnaire-academie.fr/article/A9D0115),
[nature](https://www.dictionnaire-academie.fr/article/A9N0131),
[note](https://www.dictionnaire-academie.fr/article/A9N0694),
[orange](https://www.dictionnaire-academie.fr/article/A9O0620), and
[audio](https://www.dictionnaire-academie.fr/article/A9A3123).
Punctuation and accessibility evidence includes the
[French Ministry of Culture typography guide](https://www.culture.gouv.fr/content/download/190667/file/GUIDE%20du%20sur-titrage%20au%20theatre_2016.pdf?inLanguage=fre-FR&version=1),
[MDN alternative-text guidance](https://developer.mozilla.org/fr/docs/Web/API/HTMLImageElement/alt),
[W3C accessible-name guidance](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/),
[Unicode CLDR French annotations](https://www.unicode.org/cldr/charts/48/annotations/romance.html),
and [Adobe France on `Sarcelle`](https://www.adobe.com/fr/express/colors/teal).

The original 123 corrections were subsequently applied exactly. A distinct
review then found the additional caller-backed `F-fr-124`: the table action
labeled `Effacer` clears cell contents and must say `Effacer le contenu`.
That correction is now also applied.

The resulting raw SHA-256 is
`165c33db70470f3e52315d315f79f214f556f502b658abb99e8a14815a96fffc`.
Against those exact bytes, the first reviewer repeated a complete 538/538
value review covering all 124 findings, all 35 source dependencies, all 44
aliases, all 29 source-only contracts, the notifier bypass, every placeholder
and accessibility value, French typography, and the exact-English inventory.
No further defect emerged. All 124 finding cases, structural and retention
checks, the 130-case search suite, 77 checker tests, and the live checker pass.
The final exact-English inventory remains exactly the 22 sourced `R-fr`
entries. These results close the French first pass; the distinct second review
must now repeat against the current digest.

### Italian (`it`) — first-pass evidence reset by second review

The first reviewer inspected 538/538 current Italian values in the shipped
dictionary. This pre-correction inspection covered all eight top-level
namespaces: 16 `blockSettings`, 4 `toolbox`, 4 `popover`, 28 `toolNames`, 414
`tools`, 27 `a11y`, 44 `searchTerms`, and 1 `notifier` value. The 414 tool
values were checked across all 23 `tools.*` subnamespaces. Caller tracing
classified 508 values as localized caller-consumed, of which 70 require
correction and 438 retain their reviewed wording; 29 values are documented
source-only contracts, of which one requires correction and 28 retain their
reviewed wording; and `notifier.dismiss` is the one localization-bypassed
value. All 38 placeholder-bearing values were individually checked, and every
accepted replacement preserves the source placeholder names and occurrence
counts.

The inspection accepted 71 corrections that are now applied in the current
dictionary: all 15 pending English fallbacks, 21 of the 35 changed-English
dependencies, and 35 additional semantic, terminology, grammar, action,
accessibility, number, or punctuation defects. The changed-English
dependencies requiring Italian changes are `F-en-002`, `F-en-003`,
`F-en-004`, `F-en-009`, and `F-en-019` through `F-en-035`; the reviewed
Italian wording is retained for `F-en-001`, `F-en-005` through `F-en-008`, and
`F-en-010` through `F-en-018`. Thus every one of the 35 source changes has an
explicit Italian disposition.

The 29 source-only contracts are
`blockSettings.convertWithChildrenWarning`, `popover.actions`,
`tools.columns.turnInto`, `tools.code.autoDetected`,
`tools.code.plainText`, `tools.link.keepTyping`,
`tools.link.emailAddress`, `tools.link.jumpToSection`,
`tools.link.webLink`, `tools.image.size`, `tools.image.sizeSmall`,
`tools.image.sizeMedium`, `tools.image.sizeLarge`, `tools.image.sizeFull`,
`tools.image.captionPlaceholder`, `tools.image.errorUnavailable`,
`tools.file.captionPlaceholder`, `tools.file.preview`,
`tools.video.toggleCaption`, `tools.video.moreOptions`,
`tools.database.close`, `tools.database.defaultStatusDone`,
`tools.database.defaultStatusInProgress`,
`tools.database.defaultStatusNotStarted`,
`tools.database.defaultStatusProperty`,
`tools.database.defaultTitleProperty`, `tools.database.defaultViewBoard`,
`tools.database.emptyColumn`, and `tools.database.titlePlaceholder`. Only
`blockSettings.convertWithChildrenWarning` requires correction
(`F-it-001`); the other 28 source-only values retain their reviewed Italian
contracts.

All 44 search aliases were reviewed in their registered tool context and
retain their current wording:
`columns=colonne`, `layout=layout`, `divider=divisore`,
`separator=separatore`, `delimiter=delimitatore`,
`splitter=divisore di sezione`, `spacer=spaziatore`, `space=spazio`,
`gap=distanza`, `paragraph=paragrafo`, `plain=semplice`, `title=titolo`,
`header=intestazione`, `heading=titolo di sezione`,
`toggle=a scomparsa`, `collapsible=comprimibile`, `bullet=punto elenco`,
`unordered=non ordinato`, `list=elenco`, `ordered=ordinato`,
`number=numero`, `checkbox=casella di controllo`, `task=attività`,
`todo=da fare`, `check=spunta`, `collapse=comprimi`, `expand=espandi`,
`accordion=espansibile`, `table=tabella`, `grid=griglia`,
`spreadsheet=foglio di calcolo`, `callout=richiamo`, `note=nota`,
`info=informazione`, `warning=avviso`, `tip=suggerimento`,
`alert=allerta`, `quote=citazione`, `blockquote=blocco citazione`,
`citation=riferimento`, `code=codice`, `snippet=frammento`,
`program=programma`, and `pre=preformattato`. All 44 values are
normalization-distinct, and no duplicate or known-bad alias remains.

The original dictionary had 29 exact-English values: 15 pending-translation
defects and 14 supported retentions. Applying all accepted corrections removed
those 15 fallbacks and created seven intentional exact matches by standardizing
Italian product labels to `Link` and `Database`. The current dictionary
therefore has exactly 21 supported exact matches, all documented as
`R-it-001` through `R-it-021`.

Fresh pre-edit structural inspection found 538 Italian keys matching the 538
English keys, with no missing, extra, or duplicate decoded keys. All values
are non-empty strings. Placeholder multisets, UTF-8 decoding, NFC
normalization, control-character, U+FFFD replacement-character,
boundary-whitespace, and suspicious boundary-punctuation checks are clean.
Italian key order differs from English key order, which is not part of the
flat-dictionary runtime contract. The exact raw pre-edit hashes are
`sha256:ddb881e0372b7faea54a34d85ca7426008f19eb0ed3ee54e54396865c1a0dd24`
for Italian and
`sha256:60559b2261eb1faaf4074775ad260912a4cdae2648368672903af1870d1b08f4`
for the reviewed English source. The Italian hash identifies the inspected
defective input only; the corrected dictionary’s current reviewed digest is
recorded separately above.

The selected register is neutral contemporary Italian, with informal singular
`tu` imperatives for instructions, concise imperatives for actions, and
sentence-case UI labels. Product and media terminology is supported by
[Notion writing and editing guidance](https://www.notion.com/it/help/writing-and-editing-basics),
[Notion media guidance](https://www.notion.com/it/help/images-files-and-media),
and
[Notion database guidance](https://www.notion.com/it/help/intro-to-databases).
Shortcut, aspect-ratio, and picture-in-picture conventions are supported by
[Apple keyboard guidance](https://support.apple.com/it-it/102650),
[Microsoft Windows shortcut guidance](https://support.microsoft.com/it-it/windows/scelte-rapide-da-tastiera-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec),
[Apple aspect-ratio guidance](https://support.apple.com/it-it/guide/iphone/iph3dc593597/ios),
and
[Apple picture-in-picture guidance](https://support.apple.com/it-it/guide/tv/atvb7944597f/tvos).
Lexical evidence includes the Treccani entries for
[link](https://www.treccani.it/vocabolario/link/) and
[volume](https://www.treccani.it/vocabolario/volume/). Accessible naming and
descriptions follow the
[W3C accessible-name guidance](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
and caller behavior documented in the findings below.

The production caller for `notifier.dismiss` in
`src/components/utils/notifier/draw.ts` reads the bundled English dictionary
rather than the active locale. That runtime localization bypass is separate
from the dictionary audit, but the second reviewer also found that the stored
Italian value `Ignora` misnames the close button itself; `F-it-081` records the
required dictionary correction to `Chiudi`.

Separately, the external
`src/components/inline-tools/inline-tool-clear-format.ts` source declares the
raw title `Clear format` and `titleKey = 'clearFormat'`. That key is absent from
both the current English and Italian 538-value locale corpora, so it is not a
current Italian dictionary key, exact match, alias, source-only contract, or
`F-it` finding. Any integration of that external title into the locale schema
is separate runtime/localization work.

All 71 expected values are now applied exactly. The corrected dictionary has
raw SHA-256
`7064f4841eeba2125abf9ecebebe61c3eea4299b59bcc0fde70d85cdac925d8e`.
The first reviewer re-read all 538/538 current values in caller context and
found no additional defect. The 71 finding cases, structural and retention
checks, 130 search-quality cases, 77 checker tests, and live checker passed;
all 44 aliases remained distinct and the exact inventory was exactly the 21
sourced retentions.

The distinct second reviewer independently inspected all 538 values and
approved those 71 corrections and all 21 retentions, but found 12 residual
semantic, action-label, accessibility, agreement, or context defects:
`F-it-072` through `F-it-083`. The review traced
`tools.table.clearSelection` to both content-clearing callers, distinguished
video and audio action labels from image state labels, checked the implicit
feminine `casella di controllo` in both checkbox states, and re-evaluated the
toast close button, toggle placeholder, and raw-preview tab. The prior first
pass and digest are therefore reset; both reviewer cells are cleared, the
semantic result is `open`, and the locale remains `pending` until these
findings are corrected and the complete first pass is repeated.

All 12 second-review corrections are now applied exactly, and their focused
guideline expectations pass 12/12. The corrected 538-key dictionary has raw
SHA-256
`eba1b120b06f4f40ecc050139164ea25eec31357281f6466a63f95f989c530b5`.
Because the dictionary bytes changed, the reset rule leaves all three result
columns `pending`, both reviewer cells empty, and no digest evidence; a fresh
complete first pass is still required.

### Dutch (`nl`) — pre-correction evidence; first pass not complete

The first reviewer inspected 538/538 current Dutch values in the shipped
Netherlands-Dutch dictionary. The review covered all eight top-level
namespaces: 16 `blockSettings`, 4 `toolbox`, 4 `popover`, 28 `toolNames`, 414
`tools`, 27 `a11y`, 44 `searchTerms`, and 1 `notifier` value. All 23
`tools.*` subnamespaces, all 38 placeholder-bearing values, all 44 search
aliases, all 29 source-only contracts, the one localization-bypassed value,
and all 35 changed-English dependencies were individually inspected.

The review accepted 66 corrections that remain absent from the current
dictionary: all 15 pending English fallbacks, 21 of the 35 changed-English
dependencies, and 30 additional semantic, terminology, grammar,
accessibility, naturalness, number, punctuation, or context defects. The
changed-English corrections correspond to `F-en-001` through `F-en-004`,
`F-en-009`, `F-en-019` through `F-en-028`, and `F-en-030` through
`F-en-035`. The other 14 dependencies retain their reviewed Dutch wording:
`F-en-005` through `F-en-008`, `F-en-010` through `F-en-018`, and
`F-en-029`. Thus every one of the 35 source changes has an explicit Dutch
disposition.

The 29 source-only contracts are
`blockSettings.convertWithChildrenWarning`, `popover.actions`,
`tools.columns.turnInto`, `tools.code.autoDetected`,
`tools.code.plainText`, `tools.link.keepTyping`,
`tools.link.emailAddress`, `tools.link.jumpToSection`,
`tools.link.webLink`, `tools.image.size`, `tools.image.sizeSmall`,
`tools.image.sizeMedium`, `tools.image.sizeLarge`, `tools.image.sizeFull`,
`tools.image.captionPlaceholder`, `tools.image.errorUnavailable`,
`tools.file.captionPlaceholder`, `tools.file.preview`,
`tools.video.toggleCaption`, `tools.video.moreOptions`,
`tools.database.close`, `tools.database.defaultStatusDone`,
`tools.database.defaultStatusInProgress`,
`tools.database.defaultStatusNotStarted`,
`tools.database.defaultStatusProperty`,
`tools.database.defaultTitleProperty`, `tools.database.defaultViewBoard`,
`tools.database.emptyColumn`, and `tools.database.titlePlaceholder`.
`blockSettings.convertWithChildrenWarning` and `tools.image.sizeMedium`
require `F-nl-003` and `F-nl-031`; the other 27 retain their reviewed
source-only wording.

All 44 current search aliases were reviewed in their registered tool context
and retain their current wording:
`columns=kolommen`, `layout=indeling`, `divider=scheidslijn`,
`separator=scheiding`, `delimiter=scheidingsteken`, `splitter=verdeler`,
`spacer=afstandhouder`, `space=ruimte`, `gap=tussenruimte`,
`paragraph=alinea`, `plain=platte tekst`, `title=titel`,
`header=koptekst`, `heading=kop`, `toggle=inklapbaar`,
`collapsible=uitklapbaar`, `bullet=opsomming`, `unordered=ongeordend`,
`list=lijst`, `ordered=geordend`, `number=nummer`,
`checkbox=selectievakje`, `task=taak`, `todo=to-do`, `check=vinkje`,
`collapse=inklappen`, `expand=uitklappen`, `accordion=accordeon`,
`table=tabel`, `grid=raster`, `spreadsheet=werkblad`,
`callout=toelichting`, `note=notitie`, `info=informatie`,
`warning=waarschuwing`, `tip=hint`, `alert=melding`, `quote=citaat`,
`blockquote=blokcitaat`, `citation=verwijzing`, `code=code`,
`snippet=fragment`, `program=programma`, and
`pre=voorgeformatteerd`. All are lowercase, globally
normalization-distinct, and distinct within every registered tool group.

The current dictionary has 37 exact-English values: 15 are the pending
translation defects represented among `F-nl-027`, `F-nl-028`,
`F-nl-032`, `F-nl-034`, `F-nl-036`, `F-nl-040`, `F-nl-044`,
`F-nl-047`, `F-nl-048`, and `F-nl-050` through `F-nl-055`; the other 22
are current supported retentions recorded as `R-nl-001` through
`R-nl-022`. Applying all accepted corrections projects an exact-English
inventory of exactly those 22 supported retentions.

Fresh structural inspection found 538 Dutch keys matching the 538 English
keys, with no missing, extra, or duplicate decoded keys. Every value is a
non-empty string. UTF-8 decoding, NFC normalization, placeholder names and
occurrence counts, control-character, U+FFFD replacement-character, and
boundary-whitespace checks are clean. The two intentional boundary-space
contracts, `blockSettings.orConjunction` and
`blockSettings.openMenuAction`, are preserved. Physical property order
differs from English, which is not part of the flat-dictionary runtime
contract. The exact raw pre-edit digest is
`sha256:5a8a2056df78928155bc5510624b9231083162ca2a308e9609c0ca62c080dffa`.
It identifies the inspected defective input only and is deliberately absent
from the Reviewed Dictionary Digests table.

The selected register is neutral Netherlands Dutch, with informal `je` only
in full instructions or confirmations, concise infinitive action labels,
direct imperatives, sentence-case UI labels, and standard Dutch compounds and
punctuation. Product and editor terminology is supported by
[Notion writing and editing guidance](https://www.notion.com/nl/help/writing-and-editing-basics),
[Notion media guidance](https://www.notion.com/nl/help/images-files-and-media),
and
[Notion database-property guidance](https://www.notion.com/nl/help/database-properties).
Shortcut conventions are supported by
[Apple keyboard guidance](https://support.apple.com/nl-nl/102650) and
[Microsoft Windows shortcut guidance](https://support.microsoft.com/nl-nl/windows/sneltoetsen-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec).
Media, artwork, and playback terminology is supported by
[Apple media guidance](https://support.apple.com/nl-nl/guide/iphone/iphb71f9b54d/ios),
[Apple Music artwork guidance](https://support.apple.com/nl-nl/guide/music/mus1c6803257/mac),
and
[Apple playback guidance](https://support.apple.com/nl-nl/guide/iphone/iphaec9fc22f/ios).
Accessibility terminology follows
[Microsoft alternative-text guidance](https://support.microsoft.com/nl-nl/office/alles-wat-u-moet-weten-voor-het-schrijven-van-effectieve-alternatieve-tekst-df98f884-ca3d-456c-807b-1a1fa82f5dc2)
and the caller behavior documented in the findings.

`notifier.dismiss` itself is valid Dutch (`Sluiten`), but its production
caller in `src/components/utils/notifier/draw.ts` reads the bundled English
dictionary rather than the active locale. That localization bypass is a
caller defect outside the Dutch correction map and does not alter the
66-finding set.

Separately, the in-progress external caller
`src/components/inline-tools/inline-tool-clear-format.ts` declares
`titleKey = 'clearFormat'`, while neither the current English nor Dutch
538-value corpus defines `clearFormat` or `toolNames.clearFormat`. The
appropriate Dutch wording would be `Opmaak wissen`, but this remains a global
source-to-dictionary integration gap rather than a current Dutch key,
source-only contract, exact match, or `F-nl` finding.

This section and `F-nl-001` through `F-nl-066` record pre-correction evidence,
not a completed first pass. All 66 expected values must be applied exactly,
the corrected 538-value Dutch dictionary must then be re-read completely in
caller context by the first reviewer, the exact-English inventory must be
recomputed, all focused and structural checks must pass, and a current
reviewed-dictionary digest must be added before the Dutch row may advance
beyond `pending`. A distinct second review remains unassigned.

### Norwegian (`no`) — pre-correction evidence; first pass not complete

The first reviewer inspected 538/538 current values in the shipped Norwegian
dictionary and confirmed that its wording is contemporary Bokmål. The review
covered all eight top-level namespaces: 16 `blockSettings`, 4 `toolbox`, 4
`popover`, 28 `toolNames`, 414 `tools`, 27 `a11y`, 44 `searchTerms`, and 1
`notifier` value. The 414 tool values were checked across all 23 `tools.*`
subnamespaces. Every placeholder-bearing value, accessibility announcement,
search alias, source-only contract, exact-English value, and changed-English
dependency was individually inspected against its caller or documented
contract.

Caller tracing classified 508 values as localized caller-consumed, 29 as
documented source-only contracts, and `notifier.dismiss` as the one
localization-bypassed value. The review accepted 74 corrections that remain
absent from the current dictionary: 14 pending English fallbacks, 20 of the 35
changed-English dependencies, and 40 additional semantic, terminology,
grammar, accessibility, action, number, punctuation, or context defects.
`F-no-001` through `F-no-074` record the exact current and expected values.
Every accepted replacement preserves the English placeholder names and
occurrence counts.

The 20 changed-English dependencies requiring a Bokmål correction are
`F-en-002 -> F-no-001`, `F-en-003 -> F-no-003`,
`F-en-004 -> F-no-006`, `F-en-009 -> F-no-009`,
`F-en-019 -> F-no-011`, `F-en-020 -> F-no-012`,
`F-en-021 -> F-no-013`, `F-en-022 -> F-no-014`,
`F-en-023 -> F-no-022`, `F-en-024 -> F-no-023`,
`F-en-025 -> F-no-024`, `F-en-026 -> F-no-028`,
`F-en-027 -> F-no-029`, `F-en-028 -> F-no-032`,
`F-en-030 -> F-no-061`, `F-en-031 -> F-no-062`,
`F-en-032 -> F-no-063`, `F-en-033 -> F-no-065`,
`F-en-034 -> F-no-071`, and `F-en-035 -> F-no-074`. The other 15 source
dependencies retain their reviewed Bokmål wording: `F-en-001`,
`F-en-005` through `F-en-008`, `F-en-010` through `F-en-018`, and
`F-en-029`. Thus all 35 corrected-English source values have an explicit
Norwegian disposition.

The 29 source-only contracts are
`blockSettings.convertWithChildrenWarning`, `popover.actions`,
`tools.columns.turnInto`, `tools.code.autoDetected`,
`tools.code.plainText`, `tools.link.keepTyping`,
`tools.link.emailAddress`, `tools.link.jumpToSection`,
`tools.link.webLink`, `tools.image.size`, `tools.image.sizeSmall`,
`tools.image.sizeMedium`, `tools.image.sizeLarge`, `tools.image.sizeFull`,
`tools.image.captionPlaceholder`, `tools.image.errorUnavailable`,
`tools.file.captionPlaceholder`, `tools.file.preview`,
`tools.video.toggleCaption`, `tools.video.moreOptions`,
`tools.database.close`, `tools.database.defaultStatusDone`,
`tools.database.defaultStatusInProgress`,
`tools.database.defaultStatusNotStarted`,
`tools.database.defaultStatusProperty`,
`tools.database.defaultTitleProperty`, `tools.database.defaultViewBoard`,
`tools.database.emptyColumn`, and `tools.database.titlePlaceholder`.
Only `blockSettings.convertWithChildrenWarning` requires correction
(`F-no-001`); the other 28 retain their reviewed Bokmål contracts.

All 44 current search aliases were reviewed in their registered tool context.
Three require semantic correction:
`searchTerms.header=topptekst -> rubrikk`,
`searchTerms.unordered=usortert -> uordnet`, and
`searchTerms.ordered=sortert -> ordnet`. The other 41 retain their current
wording. The current and projected alias sets are lowercase and globally
normalization-distinct, with no duplicate inside any registered tool group.

The current dictionary has 28 exact-English values. Fourteen are defects that
the correction map localizes: `toolNames.equation`,
`tools.equation.placeholder`, `tools.image.converting`,
`tools.image.errorFileTooLarge`, `tools.file.errorFileTooLarge`,
`tools.video.errorFileTooLarge`, `tools.audio.errorFileTooLarge`,
`tools.audio.titlePlaceholder`, `tools.audio.coverChange`,
`tools.audio.coverSet`, `tools.audio.coverRemove`,
`tools.audio.coverErrorType`, `tools.audio.coverErrorTooLarge`, and
`tools.audio.coverAdd`. The other 14 are already valid current exact-English
retentions recorded as `R-no-001` through `R-no-014`, including
`tools.audio.artistPlaceholder=Artist`. Applying all accepted corrections
projects an exact inventory of exactly those 14 supported retentions.

Fresh structural inspection found 538 Norwegian keys matching the 538 English
keys, with no missing, extra, or duplicate decoded keys. Every value is a
non-empty string. Placeholder multisets, UTF-8 decoding, NFC normalization,
control-character, U+FFFD replacement-character, and boundary-whitespace
checks are clean. The only boundary-space values are the intentional
composition fragments `blockSettings.orConjunction` and
`blockSettings.openMenuAction`. The exact raw pre-correction digest is
`sha256:80c2c80a4a5f1dc6b48e3579ba8bbb09f3db346b934a865b5467f018a724575b`.
It identifies the inspected defective input only and is deliberately absent
from the Reviewed Dictionary Digests table.

The live translation checker exits successfully with all locales at 538
values, 167 static keys covered, and structural and encoding checks passing;
its informational untranslated-value report counts the same 28 current exact
matches. The duplicate-key, search-quality, video, quote, and block-menu
suites pass 483/483 tests, and the focused Norwegian key-completeness case
passes. The focused exact-English case currently fails with the expected 15
unallowlisted matches: the 14 correction-bound values above plus `Artist`.
After correction, `Artist` must be added to the locale-specific retention
allowlist; the exact-English result remains `open` until that remediation and
focused verification occur.

The table label `tools.table.clearSelection` has two caller classes:
`table-cell-selection.ts` invokes `onClearContent` before dismissing the
painted selection, and `table-row-col-popover.ts` invokes
`onClearContents` for the selected row or column while cell colors survive.
It therefore clears cell contents rather than merely clearing selection.
`F-no-007` uses `Fjern innhold`, consistent with
[Microsoft's Norwegian distinction between clearing contents and deleting cells](https://support.microsoft.com/nb-no/office/fjerne-celler-med-innhold-eller-formater-9ff6b8ff-1afd-495f-8ad8-8c1f6f82a9d6).

Shortcut and interaction terminology is supported by
[Apple keyboard guidance](https://support.apple.com/no-no/102650) and
[Microsoft Windows shortcut guidance](https://support.microsoft.com/nb-no/windows/hurtigtaster-i-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec).
Emoji terminology and search wording are supported by
[Microsoft Teams skin-tone guidance](https://support.microsoft.com/nb-NO/teams/chat/select-your-emoji-skin-tone)
and [Apple emoji guidance](https://support.apple.com/no-no/102507).
Alternative-text wording follows
[Microsoft's Norwegian accessibility guidance](https://support.microsoft.com/nb-no/office/legge-til-alternativ-tekst-i-en-figur-et-bilde-et-diagram-smartart-grafikk-eller-et-annet-objekt-44989b2a-903c-4d9a-b742-6a75b451c669).
Media-control terminology is supported by
[Apple iPhone media guidance](https://support.apple.com/no-no/guide/iphone/iphaec9fc22f/ios),
[Apple TV app guidance](https://support.apple.com/no-no/guide/tvapp-windows/atv31d6caa7/windows),
and
[Apple picture-in-picture guidance](https://support.apple.com/no-no/guide/iphone/iphcc3587b5d/ios).
Lexical evidence includes Bokmålsordboka entries for
[database](https://ordbokene.no/bm/database),
[video](https://ordbokene.no/bm/video),
[full](https://ordbokene.no/bm/full),
[artist](https://ordbokene.no/nob/bm/artist),
[status](https://ordbokene.no/bm/status), and
[pause](https://ordbokene.no/bm/pause).

Two runtime/source integration gaps are explicitly outside the Norwegian
dictionary correction set. First, `notifier.dismiss=Lukk` is valid Bokmål,
but `src/components/utils/notifier/draw.ts` imports `englishDictionary` and
therefore bypasses the active locale; this is not an `F-no` value defect.
Second,
`src/components/inline-tools/inline-tool-clear-format.ts` declares the raw
title `Clear format` and `titleKey = 'clearFormat'`, while neither the English
nor Norwegian 538-value corpus defines `clearFormat` or
`toolNames.clearFormat`.
[Microsoft's Norwegian Office UI uses `Fjern formatering`](https://support.microsoft.com/nb-no/office/fjerne-all-tekstformatering-c094c4da-7f09-4cea-9a8d-c166949c9c80),
so that is the source-backed Bokmål label if the tool is integrated into the
locale schema; the absent schema key is not a current Norwegian dictionary
key, source-only contract, exact match, or `F-no` finding.

This section records pre-correction evidence, not a completed first pass. All
74 expected values must be applied exactly, the corrected 538-value Norwegian
dictionary must then be re-read completely in caller context by the first
reviewer, the exact-English allowlist and inventory must be verified, all
focused and structural checks must pass, and a current reviewed-dictionary
digest must be added before the Norwegian row may advance beyond `pending`.
The distinct second review remains unassigned.

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
| `F-en-036` | `en` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Clear formatting"` | The red-first inline-tool sweep and source-copy case reproduced the missing runtime key. The English dictionary and raw tool fallback now both use the concise Microsoft UI term [Clear Formatting](https://support.microsoft.com/en-us/office/clear-all-text-formatting-c094c4da-7f09-4cea-9a8d-c166949c9c80); the focused source-copy, inline-metadata, title-key sweep, and static source-coverage checks pass. | verified |
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
| `F-da-016` | `da` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Denne blok indeholder {count} indlejrede blokke. Konvertering vil flytte dem til øverste niveau. Vil du fortsætte?"` | `"Indlejrede blokke: {count}. Hvis blokken konverteres, flyttes det indlejrede indhold til øverste niveau. Fortsæt?"` | The first correction retained plural `de`, which is ungrammatical when `{count}=1`; count-neutral `det indlejrede indhold` follows [Den Danske Ordbog](https://ordnet.dk/ddo/ordbog/indhold) and the corrected source contract. | open |
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
| `F-da-069` | `da` | `tools.video.pip` | established product terminology | `"Billede-i-billede"` | `"Billede i billede"` | Apple’s Danish [Apple TV](https://support.apple.com/da-dk/guide/tv/atvb7944597f/26/tvos/26) and [iPhone](https://support.apple.com/da-dk/guide/iphone/iphcc3587b5d/ios) interfaces use the unhyphenated feature name. | open |
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
| `F-fr-001` | `fr` | `toolbox.optionAddAbove` | shortcut / action clarity | `"⌥ — ajouter au-dessus"` | `"⌥ + clic pour ajouter au-dessus"` | Slash-toolbox tooltip must name the click gesture; Apple France supports the modifier-key notation. | verified |
| `F-fr-002` | `fr` | `toolbox.ctrlAddAbove` | shortcut / action clarity | `"Ctrl — ajouter au-dessus"` | `"Ctrl + clic pour ajouter au-dessus"` | Windows tooltip must name the click gesture rather than presenting an unexplained dash. | verified |
| `F-fr-003` | `fr` | `toolbox.typeToSearch` | search clarity | `"Saisissez pour rechercher"` | `"Saisissez un terme de recherche"` | Search placeholder needs a grammatical object; Notion France uses an explicit search-term prompt. | verified |
| `F-fr-004` | `fr` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Ce bloc contient {count} blocs imbriqués. La conversion les déplacera au niveau supérieur. Continuer ?"` | `"Blocs imbriqués : {count}. La conversion de ce bloc les déplacera au niveau supérieur. Continuer ?"` | Source-only warning must remain grammatical when the count is one and synchronize with the clarified English contract. | verified |
| `F-fr-005` | `fr` | `tools.marker.textColor` | terminology | `"Texte"` | `"Couleur du texte"` | Shared color picker needs an explicit text-color mode name rather than the ambiguous noun `Texte`. | verified |
| `F-fr-006` | `fr` | `toolNames.toggleList` | terminology / consistency | `"Liste réductible"` | `"Liste dépliante"` | Notion France uses `Liste dépliante` for this editor block; `réductible` is better retained only as a search alias. | verified |
| `F-fr-007` | `fr` | `tools.header.toggleHeading` | terminology / consistency | `"Titre réductible"` | `"Titre dépliant"` | Visible toggle-heading label must follow the established France-French `dépliant` terminology. | verified |
| `F-fr-008` | `fr` | `tools.header.toggleHeading1` | terminology / consistency | `"Titre réductible 1"` | `"Titre dépliant 1"` | Level-specific toggle heading must use the same established `dépliant` term. | verified |
| `F-fr-009` | `fr` | `tools.header.toggleHeading2` | terminology / consistency | `"Titre réductible 2"` | `"Titre dépliant 2"` | Level-specific toggle heading must use the same established `dépliant` term. | verified |
| `F-fr-010` | `fr` | `tools.header.toggleHeading3` | terminology / consistency | `"Titre réductible 3"` | `"Titre dépliant 3"` | Level-specific toggle heading must use the same established `dépliant` term. | verified |
| `F-fr-011` | `fr` | `tools.header.toggleHeading4` | terminology / consistency | `"Titre réductible 4"` | `"Titre dépliant 4"` | Level-specific toggle heading must use the same established `dépliant` term. | verified |
| `F-fr-012` | `fr` | `tools.header.toggleHeading5` | terminology / consistency | `"Titre réductible 5"` | `"Titre dépliant 5"` | Level-specific toggle heading must use the same established `dépliant` term. | verified |
| `F-fr-013` | `fr` | `tools.header.toggleHeading6` | terminology / consistency | `"Titre réductible 6"` | `"Titre dépliant 6"` | Level-specific toggle heading must use the same established `dépliant` term. | verified |
| `F-fr-014` | `fr` | `tools.paragraph.placeholder` | hint clarity | `"Écrivez quelque chose ou appuyez sur / pour choisir"` | `"Écrivez quelque chose ou appuyez sur / pour choisir un outil"` | Paragraph hint must state what the slash command chooses. | verified |
| `F-fr-015` | `fr` | `tools.toggle.placeholder` | context / terminology | `"Réductible"` | `"Liste dépliante"` | Empty title placeholder needs the content-type noun and the established visible-tool term. | verified |
| `F-fr-016` | `fr` | `tools.toggle.bodyPlaceholder` | grammar / action clarity | `"Bloc réductible vide. Cliquez ou déposez des blocs à l'intérieur."` | `"Liste dépliante vide. Cliquez pour ajouter un bloc ou faites glisser des blocs ici."` | Placeholder must identify the click result and drag action while matching the visible tool name. | verified |
| `F-fr-017` | `fr` | `a11y.dragHandle` | grammar / accessibility | `"Glisser pour déplacer ou cliquer pour le menu"` | `"Faire glisser le bloc pour le déplacer ou cliquer pour ouvrir le menu"` | Accessible name needs its object, a grammatical drag phrase, and the explicit menu-opening result. | verified |
| `F-fr-018` | `fr` | `a11y.dragStarted` | status aspect | `"Déplacement du bloc"` | `"Déplacement du bloc en cours"` | Live-region announcement must distinguish the start/in-progress state from a static noun phrase. | verified |
| `F-fr-019` | `fr` | `a11y.dragStartedMultiple` | status aspect | `"Déplacement de {count} blocs"` | `"Déplacement de {count} blocs en cours"` | Multiple-block live-region announcement must identify the in-progress drag state. | verified |
| `F-fr-020` | `fr` | `a11y.movedUp` | grammar / accessibility | `"Bloc déplacé vers le haut, position {position} sur {total}"` | `"Bloc déplacé vers le haut à la position {position} sur {total}"` | Movement announcement needs the preposition introducing the resulting position. | verified |
| `F-fr-021` | `fr` | `a11y.movedDown` | grammar / accessibility | `"Bloc déplacé vers le bas, position {position} sur {total}"` | `"Bloc déplacé vers le bas à la position {position} sur {total}"` | Movement announcement needs the preposition introducing the resulting position. | verified |
| `F-fr-022` | `fr` | `a11y.searchResults` | number / accessibility | `"{count} résultats"` | `"Résultats de recherche : {count}"` | Live-region template can receive one; count-neutral wording avoids incorrect plural agreement. | verified |
| `F-fr-023` | `fr` | `a11y.blockToolbar` | punctuation | `"Barre d'outils de bloc"` | `"Barre d’outils de bloc"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-024` | `fr` | `a11y.allBlocksSelected` | number / accessibility | `"Tous les blocs sélectionnés, {count} blocs"` | `"Tous les blocs sont sélectionnés. Total : {count}"` | Select-all can contain one block; the replacement is count-neutral, complete, and non-repetitive. | verified |
| `F-fr-025` | `fr` | `a11y.navigationModeEntered` | keyboard / accessibility | `"Mode navigation. Utilisez les touches fléchées pour vous déplacer entre les blocs, Entrée pour modifier, Échap pour quitter."` | `"Mode de navigation. Utilisez les touches fléchées pour passer d’un bloc à l’autre. Appuyez sur Entrée pour modifier et sur Échap pour quitter."` | Screen-reader instruction needs natural French, full action sentences, and consistent formal address. | verified |
| `F-fr-026` | `fr` | `a11y.navigationModeExited` | register / accessibility | `"Sortie du mode navigation"` | `"Vous avez quitté le mode de navigation"` | Exit announcement must address the user consistently and use the grammatical mode name. | verified |
| `F-fr-027` | `fr` | `a11y.dropCreateColumnLeft` | context / accessibility | `"Créera une colonne à gauche"` | `"Une colonne sera créée à gauche"` | Pre-drop announcement needs an explicit subject and natural prospective-result wording. | verified |
| `F-fr-028` | `fr` | `a11y.dropCreateColumnRight` | context / accessibility | `"Créera une colonne à droite"` | `"Une colonne sera créée à droite"` | Pre-drop announcement needs an explicit subject and natural prospective-result wording. | verified |
| `F-fr-029` | `fr` | `tools.table.headerColumn` | punctuation | `"Colonne d'en-tête"` | `"Colonne d’en-tête"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-030` | `fr` | `tools.table.insertColumnLeft` | grammar | `"Insérer colonne à gauche"` | `"Insérer une colonne à gauche"` | Menu action requires the indefinite article before `colonne`. | verified |
| `F-fr-031` | `fr` | `tools.table.insertColumnRight` | grammar | `"Insérer colonne à droite"` | `"Insérer une colonne à droite"` | Menu action requires the indefinite article before `colonne`. | verified |
| `F-fr-032` | `fr` | `tools.table.headerRow` | punctuation | `"Ligne d'en-tête"` | `"Ligne d’en-tête"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-033` | `fr` | `tools.table.insertRowAbove` | grammar | `"Insérer ligne au-dessus"` | `"Insérer une ligne au-dessus"` | Menu action requires the indefinite article before `ligne`. | verified |
| `F-fr-034` | `fr` | `tools.table.insertRowBelow` | grammar | `"Insérer ligne en dessous"` | `"Insérer une ligne en dessous"` | Menu action requires the indefinite article before `ligne`. | verified |
| `F-fr-035` | `fr` | `tools.table.clickToAddRow` | clarity | `"Cliquer pour ajouter une ligne"` | `"Cliquer pour ajouter une nouvelle ligne"` | Add affordance should state that it creates a new row, matching the clarified source. | verified |
| `F-fr-036` | `fr` | `tools.table.clickToAddColumn` | clarity | `"Cliquer pour ajouter une colonne"` | `"Cliquer pour ajouter une nouvelle colonne"` | Add affordance should state that it creates a new column, matching the clarified source. | verified |
| `F-fr-037` | `fr` | `tools.table.comfortableText` | naturalness | `"Texte confortable"` | `"Texte aéré"` | `Texte confortable` is an English calque; `Texte aéré` naturally describes the roomier density option. | verified |
| `F-fr-038` | `fr` | `tools.table.placement` | terminology | `"Position"` | `"Alignement"` | The picker controls horizontal and vertical alignment inside cells; Microsoft France uses `alignement`. | verified |
| `F-fr-039` | `fr` | `tools.table.placementTopLeft` | grammar | `"Haut gauche"` | `"En haut à gauche"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-040` | `fr` | `tools.table.placementTopCenter` | grammar | `"Haut centre"` | `"En haut au centre"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-041` | `fr` | `tools.table.placementTopRight` | grammar | `"Haut droite"` | `"En haut à droite"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-042` | `fr` | `tools.table.placementMiddleLeft` | grammar | `"Milieu gauche"` | `"Au milieu à gauche"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-043` | `fr` | `tools.table.placementMiddleCenter` | grammar | `"Centre"` | `"Au centre"` | Center label should complete the same prepositional 3-by-3 alignment matrix. | verified |
| `F-fr-044` | `fr` | `tools.table.placementMiddleRight` | grammar | `"Milieu droite"` | `"Au milieu à droite"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-045` | `fr` | `tools.table.placementBottomLeft` | grammar | `"Bas gauche"` | `"En bas à gauche"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-046` | `fr` | `tools.table.placementBottomCenter` | grammar | `"Bas centre"` | `"En bas au centre"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-047` | `fr` | `tools.table.placementBottomRight` | grammar | `"Bas droite"` | `"En bas à droite"` | Alignment label needs the natural paired French prepositions. | verified |
| `F-fr-048` | `fr` | `tools.spacer.resizeAriaLabel` | punctuation | `"Redimensionner l'espacement"` | `"Redimensionner l’espacement"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-049` | `fr` | `searchTerms.divider` | semantic alias | `"diviseur"` | `"ligne"` | `Diviseur` denotes a mathematical divisor; `ligne` is a useful natural alias for the visible separator tool. | verified |
| `F-fr-050` | `fr` | `searchTerms.splitter` | semantic alias | `"scission"` | `"séparation"` | Central adjudication selected the natural discoverability alias `séparation`; it remains normalization-distinct from `séparateur`. | verified |
| `F-fr-051` | `fr` | `searchTerms.header` | semantic alias | `"en-tête"` | `"intertitre"` | `En-tête` usually means a page header; the Académie française term `intertitre` targets an in-content heading. | verified |
| `F-fr-052` | `fr` | `searchTerms.toggle` | semantic alias | `"bascule"` | `"dépliant"` | `Bascule` describes a switch action; `dépliant` matches the established visible toggle-list terminology. | verified |
| `F-fr-053` | `fr` | `searchTerms.callout` | semantic alias | `"mise en avant"` | `"encadré"` | Notion France uses `Encadré`; the concise lowercase alias directly names the block. | verified |
| `F-fr-054` | `fr` | `toolNames.callout` | terminology / consistency | `"Mise en avant"` | `"Encadré"` | Notion France uses `Encadré` as the visible block name. | verified |
| `F-fr-055` | `fr` | `tools.callout.placeholder` | terminology / consistency | `"Mise en avant"` | `"Encadré"` | Empty callout placeholder must match the established visible block name. | verified |
| `F-fr-056` | `fr` | `tools.callout.addEmoji` | context / terminology | `"Ajouter un emoji"` | `"Ajouter une icône"` | Control sets the callout icon, which may be an emoji; Notion France labels the broader concept `icône`. | verified |
| `F-fr-057` | `fr` | `tools.callout.editIcon` | punctuation | `"Modifier l'icône"` | `"Modifier l’icône"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-058` | `fr` | `tools.callout.removeEmoji` | punctuation | `"Supprimer l'icône"` | `"Supprimer l’icône"` | French UI typography requires the U+2019 apostrophe while preserving the icon-level action. | verified |
| `F-fr-059` | `fr` | `tools.callout.filterEmojis` | search / punctuation | `"Filtrer…"` | `"Rechercher des emojis…"` | Emoji picker field performs text search, not a category filter, and needs an explicit object. | verified |
| `F-fr-060` | `fr` | `tools.callout.calloutEmojiCategory` | terminology / consistency | `"Mise en avant"` | `"Encadré"` | Emoji category for the callout tool must use the same established `Encadré` term. | verified |
| `F-fr-061` | `fr` | `tools.callout.pickRandom` | action clarity | `"Aléatoire"` | `"Choisir un emoji au hasard"` | Button performs an action; the replacement names both the choice and its emoji object. | verified |
| `F-fr-062` | `fr` | `tools.callout.emojiSearchResults` | number / accessibility | `"{count} emojis trouvés"` | `"Correspondances d’emojis : {count}"` | Live-region count can equal one; count-neutral wording avoids incorrect plural agreement. | verified |
| `F-fr-063` | `fr` | `tools.quote.largeSize` | grammar | `"Grand"` | `"Grande"` | Size option agrees with the omitted feminine noun `taille`. | verified |
| `F-fr-064` | `fr` | `tools.code.copied` | punctuation | `"Copié !"` | `"Copié !"` | French punctuation requires U+00A0 before the exclamation mark. | verified |
| `F-fr-065` | `fr` | `tools.code.wrapLines` | terminology | `"Retour à la ligne"` | `"Retour automatique à la ligne"` | Toggle controls automatic wrapping rather than inserting a single line break; Microsoft France uses automatic-wrap terminology. | verified |
| `F-fr-066` | `fr` | `tools.code.searchLanguage` | programming terminology / punctuation | `"Rechercher un langage..."` | `"Rechercher des langages…"` | Picker searches programming languages; plural wording and U+2026 match the field’s result set and typography. | verified |
| `F-fr-067` | `fr` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Équation"` | Tool name retained unaccented English instead of the standard French mathematical term. | verified |
| `F-fr-068` | `fr` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Saisissez une formule LaTeX…"` | Formula input hint retained English; the replacement uses formal France French and preserves `LaTeX`. | verified |
| `F-fr-069` | `fr` | `tools.image.sizeSmall` | grammar | `"Petit"` | `"Petite"` | Source-only image-size option agrees with the omitted feminine noun `taille`. | verified |
| `F-fr-070` | `fr` | `tools.image.sizeMedium` | grammar | `"Moyen"` | `"Moyenne"` | Source-only image-size option agrees with the omitted feminine noun `taille`. | verified |
| `F-fr-071` | `fr` | `tools.image.sizeLarge` | grammar | `"Grand"` | `"Grande"` | Source-only image-size option agrees with the omitted feminine noun `taille`. | verified |
| `F-fr-072` | `fr` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Conversion en cours…"` | Visible image-processing status retained an English fallback. | verified |
| `F-fr-073` | `fr` | `tools.image.altDescription` | accessibility / brevity | `"Ajoutez un texte alternatif pour décrire cette image. Votre page sera ainsi plus accessible aux personnes malvoyantes ou non-voyantes."` | `"Décrivez cette image pour les personnes qui ne peuvent pas la voir."` | MDN and W3C guidance favor a direct description purpose; replacement is shorter, inclusive, and avoids redundant `texte alternatif`. | verified |
| `F-fr-074` | `fr` | `tools.image.zoomIn` | terminology | `"Zoomer"` | `"Zoom avant"` | Microsoft France uses the established directional command `Zoom avant`. | verified |
| `F-fr-075` | `fr` | `tools.image.zoomOut` | terminology | `"Dézoomer"` | `"Zoom arrière"` | Microsoft France uses the established directional command `Zoom arrière`; `dézoomer` is informal. | verified |
| `F-fr-076` | `fr` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"L’image est trop volumineuse. Sa taille de {size} dépasse la limite de {max}."` | Image-size error retained English; replacement is natural France French and preserves both placeholders. | verified |
| `F-fr-077` | `fr` | `tools.image.errorUploadFailedTitle` | punctuation | `"Échec de l'envoi"` | `"Échec de l’envoi"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-078` | `fr` | `tools.image.errorImageFailedToLoad` | punctuation | `"Échec du chargement de l'image"` | `"Échec du chargement de l’image"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-079` | `fr` | `tools.bookmark.loading` | progress punctuation | `"Chargement de l’aperçu"` | `"Chargement de l’aperçu…"` | Rendered in-progress placeholder needs U+2026 to signal ongoing work. | verified |
| `F-fr-080` | `fr` | `tools.embed.empty` | read-only context | `"Collez un lien à intégrer"` | `"Aucun lien intégré"` | Caller renders only in an empty read-only embed where pasting is impossible. | verified |
| `F-fr-081` | `fr` | `tools.link.linkTitle` | context / terminology | `"Titre du lien"` | `"Texte du lien"` | Field edits the visible anchor text, not an HTML-style link title. | verified |
| `F-fr-082` | `fr` | `tools.linkPaste.embedAudio` | punctuation | `"Intégrer l'audio {provider}"` | `"Intégrer l’audio {provider}"` | French UI typography requires the U+2019 apostrophe; placeholder remains exact. | verified |
| `F-fr-083` | `fr` | `tools.file.emptyUrlPlaceholder` | punctuation | `"Collez l'URL du fichier…"` | `"Collez l’URL du fichier…"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-084` | `fr` | `tools.file.cancelUpload` | punctuation | `"Annuler l'envoi"` | `"Annuler l’envoi"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-085` | `fr` | `tools.file.uploadProgress` | punctuation | `"Progression de l'envoi"` | `"Progression de l’envoi"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-086` | `fr` | `tools.file.copyUrl` | punctuation | `"Copier l'URL"` | `"Copier l’URL"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-087` | `fr` | `tools.file.errorUploadFailed` | punctuation | `"Échec de l'envoi"` | `"Échec de l’envoi"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-088` | `fr` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Le fichier est trop volumineux. Sa taille de {size} dépasse la limite de {max}."` | File-size error retained English; replacement is natural France French and preserves both placeholders. | verified |
| `F-fr-089` | `fr` | `tools.video.alignmentLeft` | action terminology | `"Gauche"` | `"Aligner à gauche"` | Settings child performs an alignment action and needs an action label. | verified |
| `F-fr-090` | `fr` | `tools.video.alignmentCenter` | action terminology | `"Centre"` | `"Aligner au centre"` | Settings child performs an alignment action and needs an action label. | verified |
| `F-fr-091` | `fr` | `tools.video.alignmentRight` | action terminology | `"Droite"` | `"Aligner à droite"` | Settings child performs an alignment action and needs an action label. | verified |
| `F-fr-092` | `fr` | `tools.video.errorUploadFailed` | punctuation | `"Échec de l'envoi"` | `"Échec de l’envoi"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-093` | `fr` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"La vidéo est trop volumineuse. Sa taille de {size} dépasse la limite de {max}."` | Video-size error retained English; replacement is natural France French and preserves both placeholders. | verified |
| `F-fr-094` | `fr` | `tools.video.seek` | accessibility terminology | `"Naviguer"` | `"Position de lecture"` | Caller is a playback-position slider; `Naviguer` does not name its accessible value. | verified |
| `F-fr-095` | `fr` | `tools.video.toggleTimeDisplay` | accessibility / clarity | `"Basculer l'affichage du temps"` | `"Basculer entre le temps écoulé et le temps restant"` | Accessible name must identify both actual display states instead of exposing an abstract toggle. | verified |
| `F-fr-096` | `fr` | `tools.video.pip` | punctuation | `"Image dans l'image"` | `"Image dans l’image"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-097` | `fr` | `tools.video.ctxCopyUrl` | punctuation | `"Copier l'URL de la vidéo"` | `"Copier l’URL de la vidéo"` | French UI typography requires the U+2019 apostrophe. | verified |
| `F-fr-098` | `fr` | `tools.video.ctxCopyUrlAtTime` | accessibility / context | `"Copier l'URL de la vidéo à l'instant actuel"` | `"Copier l’URL de la vidéo à la position de lecture actuelle"` | Context-menu action copies a link at the playback head; replacement names that position precisely and fixes the apostrophes. | verified |
| `F-fr-099` | `fr` | `tools.video.ctxStats` | terminology | `"Statistiques détaillées"` | `"Statistiques de lecture"` | Menu opens playback data; `de lecture` identifies the domain instead of merely saying the data are detailed. | verified |
| `F-fr-100` | `fr` | `tools.audio.alignmentLeft` | action terminology | `"Gauche"` | `"Aligner à gauche"` | Settings child performs an alignment action and needs an action label. | verified |
| `F-fr-101` | `fr` | `tools.audio.alignmentCenter` | action terminology | `"Centre"` | `"Aligner au centre"` | Settings child performs an alignment action and needs an action label. | verified |
| `F-fr-102` | `fr` | `tools.audio.alignmentRight` | action terminology | `"Droite"` | `"Aligner à droite"` | Settings child performs an alignment action and needs an action label. | verified |
| `F-fr-103` | `fr` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Le fichier audio est trop volumineux. Sa taille de {size} dépasse la limite de {max}."` | Audio-size error retained English; replacement names the file and preserves both placeholders. | verified |
| `F-fr-104` | `fr` | `tools.audio.errorGoogleDrive` | natural error copy | `"Les liens Google Drive ne peuvent pas être lus directement — téléchargez le fichier puis importez-le ici."` | `"Les liens Google Drive ne peuvent pas être lus directement. Téléchargez plutôt le fichier, puis importez-le ici."` | Recovery error needs two clear sentences, formal imperative register, and punctuation around sequential actions. | verified |
| `F-fr-105` | `fr` | `tools.audio.errorOneDrive` | natural error copy | `"Les liens OneDrive ne peuvent pas être lus directement — téléchargez le fichier puis importez-le ici."` | `"Les liens OneDrive ne peuvent pas être lus directement. Téléchargez plutôt le fichier, puis importez-le ici."` | Recovery error needs two clear sentences, formal imperative register, and punctuation around sequential actions. | verified |
| `F-fr-106` | `fr` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Titre du morceau"` | Editable audio-title placeholder retained an English fallback. | verified |
| `F-fr-107` | `fr` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"Artiste"` | Audio metadata placeholder retained an English fallback; Apple France uses `Artiste`. | verified |
| `F-fr-108` | `fr` | `tools.audio.emptyAddAudio` | media terminology | `"Ajouter un audio"` | `"Ajouter un fichier audio"` | Empty-state action accepts a file; Notion France uses `fichier audio` rather than treating `audio` as a count noun. | verified |
| `F-fr-109` | `fr` | `tools.audio.emptyOrDropHere` | media terminology | `"ou déposez un audio ici"` | `"ou déposez un fichier audio ici"` | Drop target accepts an audio file, not an abstract audio. | verified |
| `F-fr-110` | `fr` | `tools.audio.emptyUrlPlaceholder` | media terminology | `"Collez l’URL d’un audio…"` | `"Collez l’URL d’un fichier audio…"` | URL field expects an audio file; replacement uses the established France-French media noun phrase. | verified |
| `F-fr-111` | `fr` | `tools.audio.emptyUrlAria` | accessibility / context | `"URL de l’audio"` | `"URL du fichier audio"` | Accessible field name must identify the file resource precisely. | verified |
| `F-fr-112` | `fr` | `tools.audio.emptySourceAria` | accessibility / context | `"Source de l’audio"` | `"Source du fichier audio"` | Accessible group name must identify the file-source chooser precisely. | verified |
| `F-fr-113` | `fr` | `tools.audio.coverChange` | pending translation / action | `"Change cover"` | `"Changer la pochette"` | Cover button retained English; Apple France uses `pochette` for album artwork. | verified |
| `F-fr-114` | `fr` | `tools.audio.coverSet` | pending translation / action | `"Set cover image"` | `"Définir la pochette"` | Cover-picker action retained English; replacement uses concise established media terminology. | verified |
| `F-fr-115` | `fr` | `tools.audio.coverRemove` | pending translation / action | `"Remove cover"` | `"Supprimer la pochette"` | Cover action retained an English fallback. | verified |
| `F-fr-116` | `fr` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Choisissez un fichier image"` | Wrong-file-type recovery instruction retained English; replacement uses formal register. | verified |
| `F-fr-117` | `fr` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"L’image est trop volumineuse"` | Cover-image size error retained an English fallback. | verified |
| `F-fr-118` | `fr` | `tools.audio.coverAdd` | pending translation / action | `"Add a cover"` | `"Ajouter une pochette"` | Empty cover-picker action retained English; Apple France supports `pochette`. | verified |
| `F-fr-119` | `fr` | `tools.audio.coverSourceAria` | accessibility / context | `"Source de l’image"` | `"Source de la pochette"` | Accessible group name must distinguish the cover chooser from a generic image source. | verified |
| `F-fr-120` | `fr` | `tools.database.viewTypeListDescription` | terminology / clarity | `"Une vue linéaire simple"` | `"Affichez les éléments dans une liste simple"` | View picker should describe the familiar result instead of the abstract calque `vue linéaire`; Notion France uses `Vue liste`. | verified |
| `F-fr-121` | `fr` | `tools.database.checkboxChecked` | grammar | `"Coché"` | `"Cochée"` | State label agrees with the omitted feminine noun `case`. | verified |
| `F-fr-122` | `fr` | `tools.database.checkboxUnchecked` | grammar | `"Décoché"` | `"Décochée"` | State label agrees with the omitted feminine noun `case`. | verified |
| `F-fr-123` | `fr` | `notifier.dismiss` | action terminology | `"Ignorer"` | `"Fermer"` | Control closes a notification rather than ignoring content; its caller also bypasses the active locale and requires separate runtime localization work. | verified |
| `F-fr-124` | `fr` | `tools.table.clearSelection` | context / action accuracy | `"Effacer"` | `"Effacer le contenu"` | Both table callers clear cell contents through `onClearContent` or `onClearContents`, while row and column deletion is separately labeled `Supprimer`; [Microsoft France](https://support.microsoft.com/fr-fr/excel/clear-cells-of-contents-or-formats) uses `Effacer le contenu` for this operation. | verified |
| `F-it-001` | `it` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Questo blocco contiene {count} blocchi nidificati. La conversione li sposterà al livello superiore. Continuare?"` | `"Blocchi nidificati: {count}. La conversione di questo blocco sposterà il contenuto nidificato al livello superiore. Continuare?"` | Source-only warning must remain grammatical for one or many nested blocks and follow corrected `F-en-002` without relying on a plural noun after `{count}`. | verified |
| `F-it-002` | `it` | `toolbox.optionAddAbove` | shortcut clarity | `"⌥ — aggiungi sopra"` | `"⌥-clic: aggiungi sopra"` | The shortcut requires an Option-click; an em dash omits the click operation, while Apple Italian guidance names `Opzione` and the mouse action. | verified |
| `F-it-003` | `it` | `toolbox.ctrlAddAbove` | shortcut clarity | `"Ctrl — aggiungi sopra"` | `"Ctrl-clic: aggiungi sopra"` | The shortcut requires a Ctrl-click; an em dash omits the click operation, while Microsoft Italian guidance retains `Ctrl` in key combinations. | verified |
| `F-it-004` | `it` | `toolNames.todoList` | terminology / consistency | `"Lista attività"` | `"Elenco attività"` | `Elenco` is the established product term and aligns this tool with the existing `Elenco puntato` and `Elenco numerato` names. | verified |
| `F-it-005` | `it` | `toolNames.link` | terminology / consistency | `"Collegamento"` | `"Link"` | `Link` is the established Italian computing loanword used by Treccani and Notion and keeps the toolbox name consistent with the accepted media-source labels. | verified |
| `F-it-006` | `it` | `toolNames.database` | terminology / consistency | `"Base dati"` | `"Database"` | `Database` is the established Italian product term, already used by `tools.database.titlePlaceholder` and Notion Italian guidance. | verified |
| `F-it-007` | `it` | `tools.marker.textColor` | terminology / source synchronization | `"Testo"` | `"Colore del testo"` | The color-picker mode must name the text-color property explicitly and follow corrected `F-en-003`; `Testo` alone is ambiguous in composed swatch labels. | verified |
| `F-it-008` | `it` | `tools.paragraph.placeholder` | grammar / hint clarity | `"Scrivi qualcosa o premi / per selezionare"` | `"Scrivi qualcosa o premi / per selezionare uno strumento"` | The existing infinitive lacks an object; the slash action opens tool selection, so the hint must identify what the user selects. | verified |
| `F-it-009` | `it` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Blocco a scomparsa vuoto. Clicca o trascina blocchi all’interno."` | `"Blocco a scomparsa vuoto. Clicca per aggiungere un blocco oppure trascina qui dei blocchi."` | The click creates a child block and the container accepts dragged blocks; corrected `F-en-004` requires both actions to be named separately. | verified |
| `F-it-010` | `it` | `tools.table.headerColumn` | grammar | `"Colonna intestazione"` | `"Colonna d’intestazione"` | Italian requires the prepositional phrase `d’intestazione`; the bare noun sequence is unnatural. | verified |
| `F-it-011` | `it` | `tools.table.headerRow` | grammar | `"Riga intestazione"` | `"Riga d’intestazione"` | Italian requires the prepositional phrase `d’intestazione`; the bare noun sequence is unnatural. | verified |
| `F-it-012` | `it` | `tools.table.fullWidth` | terminology | `"Larghezza intera"` | `"Larghezza massima"` | The setting expands the table to its maximum available width; `Larghezza intera` is an unnatural literal rendering, while Notion Italian uses maximum-width terminology. | verified |
| `F-it-013` | `it` | `tools.table.comfortableText` | terminology / calque | `"Testo comodo"` | `"Testo standard"` | `Testo comodo` is a calque rather than a natural density label; `Testo standard` identifies the normal text-spacing option. | verified |
| `F-it-014` | `it` | `tools.table.placement` | terminology / source synchronization | `"Posizione"` | `"Allineamento"` | The picker controls horizontal and vertical cell-content alignment, so corrected `F-en-009` requires `Allineamento` rather than generic position. | verified |
| `F-it-015` | `it` | `blockSettings.copyLink` | terminology / consistency | `"Copia collegamento al blocco"` | `"Copia link al blocco"` | `Link` is the established concise product term and must match the accepted toolbox and media-source terminology. | verified |
| `F-it-016` | `it` | `a11y.dragHandle` | accessibility clarity | `"Trascina per spostare o clicca per il menu"` | `"Trascina per spostare il blocco o clicca per aprire il menu"` | The accessible instruction must identify the moved object and the click result instead of leaving both actions implicit. | verified |
| `F-it-017` | `it` | `a11y.dragStarted` | grammar / accessibility | `"Trascinamento blocco"` | `"Trascinamento del blocco"` | The drag-start announcement requires the articulated preposition `del`; the bare noun sequence is ungrammatical Italian. | verified |
| `F-it-018` | `it` | `a11y.dropPosition` | accessibility / number | `"Verrà posizionato alla posizione {position} di {total}"` | `"Posizione di rilascio: {position} di {total}"` | The count-neutral label states the prospective drop position directly and avoids the repetitive, objectless `posizionato alla posizione`. | verified |
| `F-it-019` | `it` | `a11y.movedUp` | accessibility / direction | `"Blocco spostato in alto, posizione {position} di {total}"` | `"Blocco spostato verso l’alto in posizione {position} di {total}"` | `Verso l’alto` unambiguously announces upward movement, and `in posizione` connects the resulting ordinal naturally. | verified |
| `F-it-020` | `it` | `a11y.movedDown` | accessibility / direction | `"Blocco spostato in basso, posizione {position} di {total}"` | `"Blocco spostato verso il basso in posizione {position} di {total}"` | `Verso il basso` unambiguously announces downward movement, and `in posizione` connects the resulting ordinal naturally. | verified |
| `F-it-021` | `it` | `a11y.atTop` | accessibility / source synchronization | `"Non è possibile salire oltre"` | `"Il blocco è già in cima e non può essere spostato più in alto"` | The boundary announcement must identify the block, its current top position, and the unavailable movement, matching the corrected source contract. | verified |
| `F-it-022` | `it` | `a11y.atBottom` | accessibility / source synchronization | `"Non è possibile scendere oltre"` | `"Il blocco è già in fondo e non può essere spostato più in basso"` | The boundary announcement must identify the block, its current bottom position, and the unavailable movement, matching the corrected source contract. | verified |
| `F-it-023` | `it` | `a11y.searchResults` | accessibility / number / source synchronization | `"{count} risultati"` | `"Risultati di ricerca: {count}"` | Moving the count after a noun phrase makes the announcement grammatical for one or many and follows the corrected count-neutral source. | verified |
| `F-it-024` | `it` | `a11y.allBlocksSelected` | accessibility / number / source synchronization | `"Tutti i blocchi selezionati, {count} blocchi"` | `"Tutti i blocchi selezionati. Totale: {count}"` | `Totale: {count}` remains grammatical for any count and avoids repeating the plural noun after the placeholder. | verified |
| `F-it-025` | `it` | `a11y.navigatedToBlock` | accessibility / semantic clarity | `"Spostato sul blocco"` | `"Blocco raggiunto"` | Keyboard navigation changes focus rather than moving an object onto a block; the replacement is a concise, accurate announcement. | verified |
| `F-it-026` | `it` | `tools.callout.addEmoji` | terminology / source synchronization | `"Aggiungi emoji"` | `"Aggiungi icona"` | The control adds the callout icon, whose picker may use emoji; corrected source terminology names the UI role rather than one possible glyph type. | verified |
| `F-it-027` | `it` | `tools.callout.filterEmojis` | search clarity / source synchronization | `"Filtra…"` | `"Cerca emoji…"` | The field searches the emoji catalog; the explicit object produces a self-contained placeholder and follows the corrected source. | verified |
| `F-it-028` | `it` | `tools.callout.pickRandom` | action clarity / source synchronization | `"Casuale"` | `"Scegli un’emoji a caso"` | The button performs an action; the replacement names both the selection action and its emoji object instead of using a bare adjective. | verified |
| `F-it-029` | `it` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Equazione"` | The equation tool name is an unlocalized English fallback; Microsoft Italian equation guidance uses `Equazione`. | verified |
| `F-it-030` | `it` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Inserisci una formula LaTeX…"` | The editable equation hint is an English fallback; the replacement localizes the instruction while retaining the LaTeX product term. | verified |
| `F-it-031` | `it` | `tools.code.searchLanguage` | punctuation / clarity / source synchronization | `"Cerca linguaggio..."` | `"Cerca linguaggi…"` | The picker searches multiple programming languages, and Italian UI punctuation requires the single U+2026 ellipsis used by the corrected source. | verified |
| `F-it-032` | `it` | `tools.link.linkTitle` | terminology / source synchronization | `"Titolo del link"` | `"Testo del link"` | The field edits the visible link text rather than an HTML title; the replacement follows the corrected source meaning. | verified |
| `F-it-033` | `it` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Conversione in corso…"` | The image-conversion progress label is an unlocalized English fallback; the replacement is natural Italian ongoing-state copy. | verified |
| `F-it-034` | `it` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Aggiungi un testo alternativo per descrivere questa immagine. Rende la pagina più accessibile a chi ha problemi di vista o è non vedente."` | `"Descrivi questa immagine per chi non può vederla."` | The corrected source asks for the image’s purpose concisely without a long, condition-based explanation; the replacement preserves that direct accessibility guidance. | verified |
| `F-it-035` | `it` | `tools.image.previewControls` | accessibility / grammar | `"Controlli anteprima"` | `"Controlli dell’anteprima dell’immagine"` | The accessible group label needs the articulated preposition and must distinguish image-preview controls from generic preview controls. | verified |
| `F-it-036` | `it` | `tools.image.navigationControls` | accessibility / grammar | `"Navigazione immagini"` | `"Navigazione tra le immagini"` | The accessible group controls movement among multiple images; `tra le immagini` expresses that relationship naturally. | verified |
| `F-it-037` | `it` | `tools.image.errorFileTooLarge` | pending translation / error / placeholders | `"Image is too large. {size} exceeds the {max} limit."` | `"L’immagine è troppo grande. {size} supera il limite di {max}."` | The image-size error is an English fallback; the Italian recovery copy preserves `{size}` and `{max}` exactly. | verified |
| `F-it-038` | `it` | `tools.image.errorImageFailedToLoad` | punctuation consistency | `"Impossibile caricare l'immagine"` | `"Impossibile caricare l’immagine"` | Contemporary Italian UI typography in this dictionary uses the U+2019 apostrophe; this straight apostrophe is inconsistent. | verified |
| `F-it-039` | `it` | `tools.image.emptyLink` | terminology / consistency | `"Collegamento"` | `"Link"` | `Link` is the established Italian computing loanword and keeps all accepted media-source options consistent. | verified |
| `F-it-040` | `it` | `tools.image.cropDone` | UI convention | `"Fatto"` | `"Fine"` | Italian image-editing interfaces use `Fine` as the concise control that completes the crop operation; `Fatto` reads as a past-participle status. | verified |
| `F-it-041` | `it` | `tools.file.emptyLink` | terminology / consistency | `"Collegamento"` | `"Link"` | `Link` is the established Italian computing loanword and keeps all accepted media-source options consistent. | verified |
| `F-it-042` | `it` | `tools.file.emptyUrlPlaceholder` | punctuation consistency | `"Incolla l'URL del file…"` | `"Incolla l’URL del file…"` | Contemporary Italian UI typography in this dictionary uses the U+2019 apostrophe; this straight apostrophe is inconsistent. | verified |
| `F-it-043` | `it` | `tools.file.errorFileTooLarge` | pending translation / error / placeholders | `"File is too large. {size} exceeds the {max} limit."` | `"Il file è troppo grande. {size} supera il limite di {max}."` | The file-size error is an English fallback; the Italian recovery copy preserves `{size}` and `{max}` exactly. | verified |
| `F-it-044` | `it` | `tools.file.previewError` | punctuation / source synchronization | `"Impossibile caricare l'anteprima"` | `"Impossibile caricare l’anteprima"` | The corrected source error is semantically retained, but Italian UI typography requires the U+2019 apostrophe. | verified |
| `F-it-045` | `it` | `tools.video.errorFileTooLarge` | pending translation / error / placeholders | `"Video is too large. {size} exceeds the {max} limit."` | `"Il video è troppo grande. {size} supera il limite di {max}."` | The video-size error is an English fallback; the Italian recovery copy preserves `{size}` and `{max}` exactly. | verified |
| `F-it-046` | `it` | `tools.video.emptyLink` | terminology / consistency | `"Collegamento"` | `"Link"` | `Link` is the established Italian computing loanword and keeps all accepted media-source options consistent. | verified |
| `F-it-047` | `it` | `tools.audio.errorFileTooLarge` | pending translation / error / placeholders | `"Audio is too large. {size} exceeds the {max} limit."` | `"Il file audio è troppo grande. {size} supera il limite di {max}."` | The audio-size error is an English fallback; the Italian copy names the file naturally and preserves `{size}` and `{max}` exactly. | verified |
| `F-it-048` | `it` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Titolo del brano"` | The editable audio-title placeholder is an unlocalized English fallback; Italian media terminology uses `brano`. | verified |
| `F-it-049` | `it` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"Artista"` | The editable artist placeholder is an unlocalized English fallback. | verified |
| `F-it-050` | `it` | `tools.audio.emptyLink` | terminology / consistency | `"Collegamento"` | `"Link"` | `Link` is the established Italian computing loanword and keeps all accepted media-source options consistent. | verified |
| `F-it-051` | `it` | `tools.audio.emptyOrDropHere` | media terminology | `"oppure trascina qui un audio"` | `"oppure trascina qui un file audio"` | The drop target accepts a file; `file audio` is the natural Italian resource noun phrase instead of treating `audio` as a count noun. | verified |
| `F-it-052` | `it` | `tools.audio.emptyUrlAria` | grammar / accessibility | `"URL del audio"` | `"URL dell’audio"` | The accessible field label requires elision before the vowel sound: `dell’audio`. | verified |
| `F-it-053` | `it` | `tools.audio.emptySourceAria` | grammar / accessibility | `"Origine del audio"` | `"Origine dell’audio"` | The accessible group label requires elision before the vowel sound: `dell’audio`. | verified |
| `F-it-054` | `it` | `tools.audio.coverChange` | pending translation / action | `"Change cover"` | `"Cambia copertina"` | The cover-change action is an unlocalized English fallback; the replacement follows the selected concise imperative register. | verified |
| `F-it-055` | `it` | `tools.audio.coverSet` | pending translation / action | `"Set cover image"` | `"Imposta l’immagine di copertina"` | The cover-picker action is an unlocalized English fallback; the replacement identifies the cover image precisely. | verified |
| `F-it-056` | `it` | `tools.audio.coverRemove` | pending translation / action | `"Remove cover"` | `"Rimuovi copertina"` | The cover-removal action is an unlocalized English fallback; the replacement follows the selected concise imperative register. | verified |
| `F-it-057` | `it` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Scegli un file immagine"` | The wrong-file-type recovery instruction is an unlocalized English fallback; the replacement gives a direct Italian action. | verified |
| `F-it-058` | `it` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"L’immagine è troppo grande"` | The cover-image size error is an unlocalized English fallback. | verified |
| `F-it-059` | `it` | `tools.audio.coverAdd` | pending translation / action | `"Add a cover"` | `"Aggiungi una copertina"` | The empty cover-picker action is an unlocalized English fallback; the replacement follows the selected imperative register. | verified |
| `F-it-060` | `it` | `tools.audio.coverLink` | terminology / consistency | `"Collegamento"` | `"Link"` | `Link` is the established Italian computing loanword and keeps all accepted media-source options consistent. | verified |
| `F-it-061` | `it` | `tools.audio.coverSourceAria` | accessibility / context | `"Origine dell’immagine"` | `"Origine della copertina"` | The accessible group name must distinguish the cover chooser from a generic image-source chooser. | verified |
| `F-it-062` | `it` | `tools.database.viewTypeListDescription` | terminology / clarity | `"Una vista lineare semplice"` | `"Mostra gli elementi in un elenco semplice"` | The view picker should describe its familiar list result; `vista lineare` is an abstract calque, while Notion Italian uses list terminology. | verified |
| `F-it-063` | `it` | `tools.bookmark.loading` | grammar / progress | `"Caricamento anteprima del link"` | `"Caricamento dell’anteprima del link…"` | The ongoing-state label requires the articulated preposition and an ellipsis to signal that preview loading is in progress. | verified |
| `F-it-064` | `it` | `tools.bookmark.error` | punctuation consistency | `"Impossibile caricare l'anteprima del link"` | `"Impossibile caricare l’anteprima del link"` | Contemporary Italian UI typography in this dictionary uses the U+2019 apostrophe; this straight apostrophe is inconsistent. | verified |
| `F-it-065` | `it` | `tools.embed.empty` | semantic / source synchronization | `"Incolla un link da incorporare"` | `"Nessun link incorporato"` | The empty-state text reports that no embed link exists; the current imperative describes a different action and does not follow the corrected source. | verified |
| `F-it-066` | `it` | `tools.video.seek` | accessibility / terminology | `"Scorri"` | `"Avanzamento video"` | The accessible slider controls the video playback position, not page scrolling; the replacement names video progress directly. | verified |
| `F-it-067` | `it` | `tools.video.toggleTimeDisplay` | accessibility / clarity | `"Attiva/disattiva visualizzazione tempo"` | `"Passa dal tempo trascorso al tempo rimanente e viceversa"` | The accessible action must identify the two actual display states rather than expose an abstract toggle. | verified |
| `F-it-068` | `it` | `tools.video.fullscreenExit` | grammar | `"Esci da schermo intero"` | `"Esci dallo schermo intero"` | Italian requires the articulated preposition `dallo` before `schermo intero`. | verified |
| `F-it-069` | `it` | `tools.video.ctxCopyUrlAtTime` | accessibility / context | `"Copia URL del video al minuto attuale"` | `"Copia l’URL del video in corrispondenza del minuto corrente"` | The context action copies a URL at the current playback position; the replacement names that temporal correspondence precisely and adds the required article. | verified |
| `F-it-070` | `it` | `tools.video.ctxStats` | terminology | `"Statistiche dettagliate"` | `"Statistiche di riproduzione"` | The menu opens playback data; `di riproduzione` identifies the domain instead of merely describing the statistics as detailed. | verified |
| `F-it-071` | `it` | `tools.callout.emojiSearchResults` | accessibility / number | `"{count} emoji trovati"` | `"Corrispondenze emoji: {count}"` | The current adjective has incorrect agreement and the plural phrase fails for one; the count-after-label replacement is grammatical for any result count. | verified |
| `F-it-072` | `it` | `tools.table.clearSelection` | semantics / action | `"Cancella"` | `"Cancella contenuto"` | Both the cell-selection and row/column callers clear cell contents while preserving formatting; Microsoft Italy uses the exact Excel command [Cancella contenuto](https://support.microsoft.com/it-it/office/cancellare-celle-di-contenuto-o-formati-9ff6b8ff-1afd-495f-8ad8-8c1f6f82a9d6). | verified |
| `F-it-073` | `it` | `tools.video.alignmentLeft` | action terminology | `"Sinistra"` | `"Allinea a sinistra"` | This settings child performs an alignment action and has no separate accessible action label; it must not reuse the image tool’s state label. | verified |
| `F-it-074` | `it` | `tools.video.alignmentCenter` | action terminology | `"Centro"` | `"Allinea al centro"` | This settings child performs an alignment action and has no separate accessible action label; the imperative names the operation directly. | verified |
| `F-it-075` | `it` | `tools.video.alignmentRight` | action terminology | `"Destra"` | `"Allinea a destra"` | This settings child performs an alignment action and has no separate accessible action label; it must not reuse the image tool’s state label. | verified |
| `F-it-076` | `it` | `tools.audio.alignmentLeft` | action terminology | `"Sinistra"` | `"Allinea a sinistra"` | This settings child performs an alignment action and has no separate accessible action label; it must not reuse a direction-only state label. | verified |
| `F-it-077` | `it` | `tools.audio.alignmentCenter` | action terminology | `"Centro"` | `"Allinea al centro"` | This settings child performs an alignment action and has no separate accessible action label; the imperative names the operation directly. | verified |
| `F-it-078` | `it` | `tools.audio.alignmentRight` | action terminology | `"Destra"` | `"Allinea a destra"` | This settings child performs an alignment action and has no separate accessible action label; it must not reuse a direction-only state label. | verified |
| `F-it-079` | `it` | `tools.database.checkboxChecked` | grammar / accessibility | `"Selezionato"` | `"Selezionata"` | The hidden state agrees with the omitted feminine noun `casella di controllo`; Microsoft’s Italian screen-reader UI likewise announces `Casella di controllo … Selezionata`. | verified |
| `F-it-080` | `it` | `tools.database.checkboxUnchecked` | grammar / accessibility | `"Non selezionato"` | `"Non selezionata"` | The hidden state agrees with the omitted feminine noun `casella di controllo`; the masculine adjective is grammatically wrong in its accessible context. | verified |
| `F-it-081` | `it` | `notifier.dismiss` | semantics / action | `"Ignora"` | `"Chiudi"` | The value names the × button that closes a toast; `Ignora` describes a different operation even though the current production caller separately bypasses the active locale. | verified |
| `F-it-082` | `it` | `tools.toggle.placeholder` | context / terminology | `"A scomparsa"` | `"Elenco a scomparsa"` | The visible empty-title placeholder needs its content-type noun and must match the established `toolNames.toggleList` terminology. | verified |
| `F-it-083` | `it` | `tools.file.previewRaw` | context / terminology | `"Originale"` | `"Testo sorgente"` | The tab shows raw Markdown source opposite `Formattato`; it does not display an original file or revision. | verified |
| `F-nl-001` | `nl` | `blockSettings.clickToOpenMenu` | grammar | `"Klik om menu te openen"` | `"Klik om het menu te openen"` | The definite article is required in natural Dutch. | open |
| `F-nl-002` | `nl` | `blockSettings.openMenuAction` | grammar / source synchronization | `" om menu te openen"` | `" om het menu te openen"` | The composed fragment requires the definite article; preserve its leading space. | open |
| `F-nl-003` | `nl` | `blockSettings.convertWithChildrenWarning` | number / terminology / source synchronization | `"Dit blok bevat {count} geneste blokken. Door het te converteren worden ze naar het hoogste niveau verplaatst. Wil je doorgaan?"` | `"Geneste blokken: {count}. Door dit blok om te zetten, worden ze naar het hoogste niveau verplaatst. Doorgaan?"` | Uses a count-neutral label, avoids the needless calque converteren, and follows the corrected source-only contract. | open |
| `F-nl-004` | `nl` | `toolbox.optionAddAbove` | shortcut / action clarity | `"⌥ — erboven invoegen"` | `"⌥-klik om erboven in te voegen"` | The current tooltip omits the required click gesture. | open |
| `F-nl-005` | `nl` | `toolbox.ctrlAddAbove` | shortcut / action clarity | `"Ctrl — erboven invoegen"` | `"Ctrl-klik om erboven in te voegen"` | The current tooltip omits the required click gesture. | open |
| `F-nl-006` | `nl` | `tools.marker.textColor` | terminology | `"Tekst"` | `"Tekstkleur"` | The mode selects text color, not text generally. | open |
| `F-nl-007` | `nl` | `tools.paragraph.placeholder` | hint clarity | `"Schrijf iets of druk op / om te kiezen"` | `"Schrijf iets of druk op / om een blok te kiezen"` | The slash-command hint needs to state what is chosen. | open |
| `F-nl-008` | `nl` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Lege inklaplijst. Klik of sleep er blokken in."` | `"Lege inklaplijst. Klik om een blok toe te voegen of sleep blokken hierheen."` | Names the distinct click and drag results. | open |
| `F-nl-009` | `nl` | `tools.table.clearSelection` | context / action accuracy | `"Wissen"` | `"Inhoud wissen"` | Both table callers clear selected cell, row, or column contents rather than merely clearing selection state. | open |
| `F-nl-010` | `nl` | `tools.table.placement` | terminology / source synchronization | `"Positie"` | `"Uitlijning"` | The 3-by-3 picker controls cell-content alignment. | open |
| `F-nl-011` | `nl` | `a11y.dragHandle` | accessibility / clarity | `"Sleep om te verplaatsen of klik voor menu"` | `"Sleep om het blok te verplaatsen of klik om het menu te openen"` | Adds the missing objects and explicitly names the menu-opening result. | open |
| `F-nl-012` | `nl` | `a11y.atTop` | grammar / accessibility / source synchronization | `"Blok staat bovenaan, kan niet hoger"` | `"Blok staat bovenaan en kan niet hoger"` | Replaces a comma splice with a complete conjunction. | open |
| `F-nl-013` | `nl` | `a11y.atBottom` | grammar / accessibility / source synchronization | `"Blok staat onderaan, kan niet lager"` | `"Blok staat onderaan en kan niet lager"` | Replaces a comma splice with a complete conjunction. | open |
| `F-nl-014` | `nl` | `a11y.searchResults` | number / accessibility / source synchronization | `"{count} resultaten"` | `"Zoekresultaten: {count}"` | The live-region template can receive one; the replacement is count-neutral. | open |
| `F-nl-015` | `nl` | `a11y.allBlocksSelected` | number / accessibility / source synchronization | `"Alle blokken geselecteerd, {count} blokken"` | `"Alle blokken geselecteerd. Totaal: {count}"` | Avoids repeated plural wording and works with any count. | open |
| `F-nl-016` | `nl` | `a11y.navigationModeEntered` | accessibility / grammar | `"Navigatiemodus. Gebruik de pijltjestoetsen om tussen blokken te navigeren, Enter om te bewerken, Escape om af te sluiten."` | `"Navigatiemodus. Gebruik de pijltoetsen om tussen blokken te navigeren. Druk op Enter om te bewerken en op Escape om af te sluiten."` | Uses the standard key term and complete keyboard instructions. | open |
| `F-nl-017` | `nl` | `a11y.navigatedToBlock` | grammar / accessibility | `"Naar blok genavigeerd"` | `"Naar het blok genavigeerd"` | The definite article is required in this announcement. | open |
| `F-nl-018` | `nl` | `a11y.dropCreateColumnLeft` | context / accessibility | `"Maakt een kolom aan de linkerkant"` | `"Bij loslaten wordt links een kolom gemaakt"` | This is a prospective pre-drop announcement, not an already-running action. | open |
| `F-nl-019` | `nl` | `a11y.dropCreateColumnRight` | context / accessibility | `"Maakt een kolom aan de rechterkant"` | `"Bij loslaten wordt rechts een kolom gemaakt"` | This is a prospective pre-drop announcement, not an already-running action. | open |
| `F-nl-020` | `nl` | `tools.columns.resizeAriaLabel` | accessibility / specificity | `"Kolommen aanpassen"` | `"Kolombreedte aanpassen"` | The handle changes column width, not arbitrary column properties. | open |
| `F-nl-021` | `nl` | `toolNames.callout` | established product terminology | `"Toelichting"` | `"Markering"` | Notion Dutch uses Markering for the comparable callout block. | open |
| `F-nl-022` | `nl` | `tools.callout.placeholder` | terminology / consistency | `"Toelichting"` | `"Markering"` | Must match the reviewed visible tool name. | open |
| `F-nl-023` | `nl` | `tools.callout.calloutEmojiCategory` | terminology / consistency | `"Toelichting"` | `"Markering"` | Must match the reviewed callout terminology. | open |
| `F-nl-024` | `nl` | `tools.callout.addEmoji` | terminology / source synchronization | `"Emoji toevoegen"` | `"Pictogram toevoegen"` | The action opens icon selection and the corrected source says Add icon. | open |
| `F-nl-025` | `nl` | `tools.callout.filterEmojis` | search clarity / source synchronization | `"Filteren…"` | `"Emoji's zoeken…"` | This is a search input placeholder, not an abstract filtering action. | open |
| `F-nl-026` | `nl` | `tools.callout.pickRandom` | action clarity / source synchronization | `"Willekeurig"` | `"Willekeurige emoji kiezen"` | The button needs an explicit action and object. | open |
| `F-nl-027` | `nl` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Vergelijking"` | The standard Dutch mathematical term replaces an English fallback. | open |
| `F-nl-028` | `nl` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Voer een LaTeX-formule in…"` | Localizes the instruction while preserving the LaTeX product name. | open |
| `F-nl-029` | `nl` | `tools.code.searchLanguage` | number / punctuation / source synchronization | `"Taal zoeken..."` | `"Talen zoeken…"` | Search covers multiple languages and UI punctuation should use U+2026. | open |
| `F-nl-030` | `nl` | `tools.link.linkTitle` | context / terminology / source synchronization | `"Linktitel"` | `"Linktekst"` | The field edits visible anchor text, not an HTML-style link title. | open |
| `F-nl-031` | `nl` | `tools.image.sizeMedium` | grammar / source-only | `"Middel"` | `"Middelgroot"` | Middel is a noun with other meanings; Middelgroot is the natural size label. | open |
| `F-nl-032` | `nl` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Converteren…"` | Visible image-processing status retained an English fallback. | open |
| `F-nl-033` | `nl` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Voeg alt-tekst toe om deze afbeelding te beschrijven. Zo wordt je pagina toegankelijker voor mensen met een visuele beperking."` | `"Beschrijf de afbeelding voor mensen die deze niet kunnen zien."` | The dialog already supplies the alt-text context; the replacement is direct, concise, and inclusive. | open |
| `F-nl-034` | `nl` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"De afbeelding is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error and preserves both placeholders. | open |
| `F-nl-035` | `nl` | `tools.image.errorDefaultMessage` | natural error copy | `"De URL gaf een fout terug. Probeer een andere bron of upload het bestand opnieuw."` | `"Er is een fout opgetreden bij het laden van de URL. Probeer een andere bron of upload het bestand opnieuw."` | The current wording is an English calque; the replacement is natural Dutch. | open |
| `F-nl-036` | `nl` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Het bestand is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error and preserves both placeholders. | open |
| `F-nl-037` | `nl` | `tools.video.alignmentLeft` | action terminology | `"Links"` | `"Links uitlijnen"` | The settings child performs an alignment action. | open |
| `F-nl-038` | `nl` | `tools.video.alignmentCenter` | action terminology | `"Midden"` | `"Centreren"` | The settings child performs an alignment action. | open |
| `F-nl-039` | `nl` | `tools.video.alignmentRight` | action terminology | `"Rechts"` | `"Rechts uitlijnen"` | The settings child performs an alignment action. | open |
| `F-nl-040` | `nl` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"De video is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error and preserves both placeholders. | open |
| `F-nl-041` | `nl` | `tools.audio.alignmentLeft` | action terminology | `"Links"` | `"Links uitlijnen"` | The settings child performs an alignment action. | open |
| `F-nl-042` | `nl` | `tools.audio.alignmentCenter` | action terminology | `"Midden"` | `"Centreren"` | The settings child performs an alignment action. | open |
| `F-nl-043` | `nl` | `tools.audio.alignmentRight` | action terminology | `"Rechts"` | `"Rechts uitlijnen"` | The settings child performs an alignment action. | open |
| `F-nl-044` | `nl` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Het audiobestand is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error, names the file resource, and preserves both placeholders. | open |
| `F-nl-045` | `nl` | `tools.audio.errorGoogleDrive` | natural recovery copy | `"Google Drive-links kunnen niet rechtstreeks worden afgespeeld — download het bestand en upload het hier."` | `"Google Drive-links kunnen niet rechtstreeks worden afgespeeld. Download het bestand en upload het hier in plaats daarvan."` | Uses two clear sentences and preserves the source's instead recovery meaning. | open |
| `F-nl-046` | `nl` | `tools.audio.errorOneDrive` | natural recovery copy | `"OneDrive-links kunnen niet rechtstreeks worden afgespeeld — download het bestand en upload het hier."` | `"OneDrive-links kunnen niet rechtstreeks worden afgespeeld. Download het bestand en upload het hier in plaats daarvan."` | Uses two clear sentences and preserves the source's instead recovery meaning. | open |
| `F-nl-047` | `nl` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Titel"` | The surrounding audio context supplies track; the compact field label should be localized. | open |
| `F-nl-048` | `nl` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"Artiest"` | Uses the established Dutch media term. | open |
| `F-nl-049` | `nl` | `tools.audio.emptyOrDropHere` | media terminology / grammar | `"of sleep hier een audio"` | `"of sleep een audiobestand hierheen"` | The drop target accepts an audio file; een audio is unnatural Dutch. | open |
| `F-nl-050` | `nl` | `tools.audio.coverChange` | pending translation / media terminology | `"Change cover"` | `"Illustratie wijzigen"` | Apple Dutch uses illustratie for music artwork. | open |
| `F-nl-051` | `nl` | `tools.audio.coverSet` | pending translation / media terminology | `"Set cover image"` | `"Illustratie instellen"` | Localizes the action using established music-artwork terminology. | open |
| `F-nl-052` | `nl` | `tools.audio.coverRemove` | pending translation / media terminology | `"Remove cover"` | `"Illustratie verwijderen"` | Localizes the action using established music-artwork terminology. | open |
| `F-nl-053` | `nl` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Kies een afbeeldingsbestand"` | Localizes the wrong-file-type recovery instruction. | open |
| `F-nl-054` | `nl` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"De afbeelding is te groot"` | Localizes the cover-size validation error. | open |
| `F-nl-055` | `nl` | `tools.audio.coverAdd` | pending translation / media terminology | `"Add a cover"` | `"Illustratie toevoegen"` | Localizes the empty-cover action using established artwork terminology. | open |
| `F-nl-056` | `nl` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"Afbeeldingsbron"` | `"Bron van illustratie"` | The accessible group name should match the reviewed music-artwork terminology. | open |
| `F-nl-057` | `nl` | `tools.database.viewTypeListDescription` | terminology / clarity / source synchronization | `"Een eenvoudige lineaire weergave"` | `"Items in een eenvoudige lijst weergeven"` | Avoids the abstract linear-view calque and describes the familiar result. | open |
| `F-nl-058` | `nl` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Linkvoorbeeld laden"` | `"Linkvoorbeeld laden…"` | The in-progress state needs an ellipsis. | open |
| `F-nl-059` | `nl` | `tools.embed.empty` | read-only context / source synchronization | `"Plak een link om in te sluiten"` | `"Geen ingesloten link"` | The caller renders a read-only empty embed where pasting is not possible. | open |
| `F-nl-060` | `nl` | `tools.video.seek` | accessibility terminology | `"Zoeken"` | `"Afspeelpositie"` | The caller is a playback-position slider; Zoeken incorrectly suggests content search. | open |
| `F-nl-061` | `nl` | `tools.video.toggleTimeDisplay` | accessibility / clarity / source synchronization | `"Tijdweergave wisselen"` | `"Wisselen tussen verstreken en resterende tijd"` | The accessible name must identify both actual display states. | open |
| `F-nl-062` | `nl` | `tools.video.speedPresets` | naturalness / terminology | `"Snelheidsvoorkeuzes"` | `"Vooraf ingestelde snelheden"` | The current compound is an English calque; the replacement is established Dutch. | open |
| `F-nl-063` | `nl` | `tools.video.pip` | established product terminology | `"Beeld-in-beeld"` | `"Beeld in beeld"` | Apple Dutch uses the unhyphenated label Beeld in beeld. | open |
| `F-nl-064` | `nl` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"Video-URL op huidige tijd kopiëren"` | `"Video-URL vanaf de huidige afspeelpositie kopiëren"` | The copied URL starts at the playback head, not at an ambiguous current clock time. | open |
| `F-nl-065` | `nl` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Statistieken voor nerds"` | `"Afspeelstatistieken"` | Removes slang and identifies the playback-data domain. | open |
| `F-nl-066` | `nl` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emoji's gevonden"` | `"Emojiresultaten: {count}"` | The live region can announce one result; the replacement is count-neutral. | open |
| `F-no-001` | `no` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Denne blokken inneholder {count} nestede blokker. Konvertering vil flytte dem til øverste nivå. Vil du fortsette?"` | `"Nestede blokker: {count}. Når denne blokken konverteres, flyttes de til øverste nivå. Vil du fortsette?"` | Source-only warning must follow the corrected count-first source contract and avoid treating the placeholder as an attributive plural phrase. | open |
| `F-no-002` | `no` | `toolbox.optionAddAbove` | platform terminology | `"Option-klikk for å legge til ovenfor"` | `"Tilvalg-klikk for å legge til ovenfor"` | Apple’s Norwegian macOS terminology names the Option key `Tilvalg`, including modified-click instructions. | open |
| `F-no-003` | `no` | `tools.marker.textColor` | terminology / source synchronization | `"Tekst"` | `"Tekstfarge"` | Shared color-picker modes require an explicit text-color label; the old noun does not distinguish text from the mode itself. | open |
| `F-no-004` | `no` | `tools.paragraph.placeholder` | grammar / hint clarity | `"Skriv noe eller trykk / for å velge"` | `"Skriv noe, eller trykk på / for å velge et verktøy"` | The instruction needs the preposition after `trykk`, punctuation between alternatives, and the omitted object selected by `/`. | open |
| `F-no-005` | `no` | `tools.toggle.placeholder` | grammar / clarity | `"Sammenleggbar"` | `"Sammenleggbar liste"` | A bare adjective is incomplete as a visible placeholder; the value names the toggle-list tool. | open |
| `F-no-006` | `no` | `tools.toggle.bodyPlaceholder` | hint clarity / source synchronization | `"Tom sammenleggbar blokk. Klikk eller slipp blokker inni."` | `"Tom sammenleggbar blokk. Klikk for å legge til en blokk, eller dra blokker hit."` | The caller’s click creates a child block while its drop zone accepts dragged blocks; the replacement distinguishes both actions. | open |
| `F-no-007` | `no` | `tools.table.clearSelection` | caller context / action terminology | `"Tøm"` | `"Fjern innhold"` | Both selected-cell and row/column callers invoke content-clearing callbacks; deletion has separate actions, and colors survive row/column clearing. | open |
| `F-no-008` | `no` | `tools.table.comfortableText` | density terminology | `"Komfortabel tekst"` | `"Luftig tekst"` | This is the roomier density option opposite compact text, not a judgment about emotional comfort. | open |
| `F-no-009` | `no` | `tools.table.placement` | terminology / source synchronization | `"Plassering"` | `"Justering"` | The picker controls horizontal and vertical alignment of content inside selected cells rather than generic placement. | open |
| `F-no-010` | `no` | `a11y.dragHandle` | grammar / accessibility | `"Dra for å flytte blokk eller klikk for meny"` | `"Dra for å flytte blokken, eller klikk for å åpne menyen"` | The accessible name needs definite objects, punctuation between actions, and the explicit result of clicking. | open |
| `F-no-011` | `no` | `a11y.atTop` | grammar / accessibility / source synchronization | `"Blokken er øverst, kan ikke flyttes opp"` | `"Blokken er øverst og kan ikke flyttes opp"` | The keyboard boundary announcement contains a comma splice; the conjunction produces a complete natural sentence. | open |
| `F-no-012` | `no` | `a11y.atBottom` | grammar / accessibility / source synchronization | `"Blokken er nederst, kan ikke flyttes ned"` | `"Blokken er nederst og kan ikke flyttes ned"` | The keyboard boundary announcement contains a comma splice; the conjunction produces a complete natural sentence. | open |
| `F-no-013` | `no` | `a11y.searchResults` | number / accessibility / source synchronization | `"{count} resultater"` | `"Søkeresultater: {count}"` | Search live regions can announce one result; the label-before-count form is grammatical for every value. | open |
| `F-no-014` | `no` | `a11y.allBlocksSelected` | number / accessibility / source synchronization | `"Alle blokker valgt, {count} blokker"` | `"Alle blokker er valgt. Totalt: {count}"` | Select-all can operate on one block; the replacement is count-neutral and avoids repeating a plural noun. | open |
| `F-no-015` | `no` | `a11y.navigationModeExited` | grammar / accessibility | `"Avsluttet navigasjonsmodus"` | `"Navigasjonsmodus avsluttet"` | The old past-tense verb lacks a subject; the replacement is a natural status announcement. | open |
| `F-no-016` | `no` | `a11y.navigatedToBlock` | grammar / accessibility | `"Navigerte til blokk"` | `"Navigert til blokk"` | A completed navigation announcement requires the resultative participle rather than finite past tense without a subject. | open |
| `F-no-017` | `no` | `a11y.dropCreateColumnLeft` | drop context / accessibility | `"Oppretter en kolonne til venstre"` | `"En kolonne opprettes til venstre når du slipper"` | The announcement occurs before drop and must describe the prospective result rather than imply creation is already underway. | open |
| `F-no-018` | `no` | `a11y.dropCreateColumnRight` | drop context / accessibility | `"Oppretter en kolonne til høyre"` | `"En kolonne opprettes til høyre når du slipper"` | The announcement occurs before drop and must describe the prospective result rather than imply creation is already underway. | open |
| `F-no-019` | `no` | `searchTerms.header` | semantic alias | `"topptekst"` | `"rubrikk"` | The alias targets the heading tool; `topptekst` denotes page-header content rather than a document heading. | open |
| `F-no-020` | `no` | `searchTerms.unordered` | list terminology | `"usortert"` | `"uordnet"` | An unordered list is not an unsorted data set; `uordnet` preserves the list-model meaning. | open |
| `F-no-021` | `no` | `searchTerms.ordered` | list terminology | `"sortert"` | `"ordnet"` | An ordered list expresses sequence rather than semantic sorting; `ordnet` preserves that distinction. | open |
| `F-no-022` | `no` | `tools.callout.addEmoji` | terminology / source synchronization | `"Legg til emoji"` | `"Legg til ikon"` | The callout UI presents the chosen emoji as an editable and removable icon, matching the corrected source label. | open |
| `F-no-023` | `no` | `tools.callout.filterEmojis` | search / accessibility / source synchronization | `"Filtrer…"` | `"Søk etter emojier…"` | The value is both placeholder and accessible name for an emoji searchbox and should identify what is searched. | open |
| `F-no-024` | `no` | `tools.callout.pickRandom` | action clarity / accessibility / source synchronization | `"Tilfeldig"` | `"Velg en tilfeldig emoji"` | The dice button’s tooltip and accessible name require a complete action instead of a bare adjective. | open |
| `F-no-025` | `no` | `tools.callout.skinTone` | established product terminology | `"Hudfarge"` | `"Hudtone"` | Microsoft’s Norwegian emoji UI uses `Hudtone` for this selector; it is more precise than generic skin color. | open |
| `F-no-026` | `no` | `toolNames.equation` | pending translation | `"Equation"` | `"Ligning"` | The inline equation tool retains an English fallback instead of the standard Bokmål mathematical term. | open |
| `F-no-027` | `no` | `tools.equation.placeholder` | pending translation | `"Enter a LaTeX formula…"` | `"Skriv inn en LaTeX-formel…"` | The formula-input instruction remains English; the replacement localizes the action while retaining the LaTeX product name. | open |
| `F-no-028` | `no` | `tools.code.searchLanguage` | punctuation / source synchronization | `"Søk etter språk..."` | `"Søk etter språk…"` | The corpus uses the single ellipsis character for continuing search input rather than three full stops. | open |
| `F-no-029` | `no` | `tools.link.linkTitle` | terminology / source synchronization | `"Lenketittel"` | `"Lenketekst"` | The inline-link field changes the anchor’s visible text, not HTML title metadata; the label must name the content the user edits. | open |
| `F-no-030` | `no` | `tools.image.exitFullscreen` | action terminology | `"Lukk fullskjerm"` | `"Avslutt fullskjerm"` | The control exits fullscreen mode rather than closing a fullscreen object or dialog. | open |
| `F-no-031` | `no` | `tools.image.converting` | pending translation | `"Converting…"` | `"Konverterer…"` | The visible in-progress image-processing status retains an English fallback while every surrounding upload state is localized. | open |
| `F-no-032` | `no` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Legg til alt-tekst som beskriver bildet. Dette gjør siden mer tilgjengelig for personer med synshemming eller blindhet."` | `"Beskriv dette bildet for personer som ikke kan se det."` | The dialog already establishes alternative text; the replacement is concise, direct, and focused on the person using the description. | open |
| `F-no-033` | `no` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"Bildet er for stort. {size} overskrider grensen på {max}."` | The image-upload size error retains English; both interpolation placeholders remain exact. | open |
| `F-no-034` | `no` | `tools.image.errorDefaultMessage` | natural error copy | `"URL-en returnerte en feil. Prøv en annen kilde eller last opp filen på nytt."` | `"Det oppstod en feil ved innlasting av URL-en. Prøv en annen kilde eller last opp filen på nytt."` | A URL does not itself return an error; the replacement describes the failed loading operation clearly. | open |
| `F-no-035` | `no` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Filen er for stor. {size} overskrider grensen på {max}."` | The file-upload size error retains English; both interpolation placeholders remain exact. | open |
| `F-no-036` | `no` | `tools.file.previewRender` | context / terminology | `"Visning"` | `"Formatert"` | The tab represents formatted output paired with raw source; a generic view noun does not name that state. | open |
| `F-no-037` | `no` | `tools.video.alignmentLeft` | action terminology | `"Venstre"` | `"Venstrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | open |
| `F-no-038` | `no` | `tools.video.alignmentCenter` | action terminology | `"Midtstilt"` | `"Midtstill"` | The settings item performs an alignment action; the old adjective describes a state rather than the action. | open |
| `F-no-039` | `no` | `tools.video.alignmentRight` | action terminology | `"Høyre"` | `"Høyrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | open |
| `F-no-040` | `no` | `tools.video.hideControls` | media terminology | `"Skjul kontroller"` | `"Skjul avspillingskontroller"` | The tune hides the player’s complete playback-control set; the explicit compound avoids generic controls. | open |
| `F-no-041` | `no` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"Videoen er for stor. {size} overskrider grensen på {max}."` | The video-upload size error retains English; both interpolation placeholders remain exact. | open |
| `F-no-042` | `no` | `tools.video.emptyAddVideo` | grammar | `"Legg til et video"` | `"Legg til en video"` | Bokmål `video` takes common gender in this visible empty-state instruction, so the old neuter article is ungrammatical. | open |
| `F-no-043` | `no` | `tools.video.emptyOrDropHere` | grammar | `"eller slipp et video her"` | `"eller slipp en video her"` | Bokmål `video` takes common gender in this visible drop-target instruction, so the old neuter article is ungrammatical. | open |
| `F-no-044` | `no` | `tools.audio.alignmentLeft` | action terminology | `"Venstre"` | `"Venstrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | open |
| `F-no-045` | `no` | `tools.audio.alignmentCenter` | action terminology | `"Midtstilt"` | `"Midtstill"` | The settings item performs an alignment action; the old adjective describes a state rather than the action. | open |
| `F-no-046` | `no` | `tools.audio.alignmentRight` | action terminology | `"Høyre"` | `"Høyrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | open |
| `F-no-047` | `no` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Lydfilen er for stor. {size} overskrider grensen på {max}."` | The audio-upload size error retains English; the replacement names the file resource and preserves both placeholders. | open |
| `F-no-048` | `no` | `tools.audio.errorGoogleDrive` | natural recovery copy | `"Google Drive-lenker kan ikke spilles av direkte — last ned filen og last den opp her."` | `"Google Drive-lenker kan ikke spilles av direkte. Last ned filen og last den opp her i stedet."` | Two direct sentences improve readability and restore the source’s `instead` recovery relationship. | open |
| `F-no-049` | `no` | `tools.audio.errorOneDrive` | natural recovery copy | `"OneDrive-lenker kan ikke spilles av direkte — last ned filen og last den opp her."` | `"OneDrive-lenker kan ikke spilles av direkte. Last ned filen og last den opp her i stedet."` | Two direct sentences improve readability and restore the source’s `instead` recovery relationship. | open |
| `F-no-050` | `no` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Tittel"` | The surrounding audio context supplies track; the compact metadata-field label must be localized. | open |
| `F-no-051` | `no` | `tools.audio.emptyAddAudio` | grammar / media terminology | `"Legg til et lyd"` | `"Legg til lyd"` | `Lyd` is used as a mass noun in this media action; the neuter article is ungrammatical here. | open |
| `F-no-052` | `no` | `tools.audio.emptyOrDropHere` | media terminology / grammar | `"eller slipp et lyd her"` | `"eller slipp en lydfil her"` | The drop target accepts an audio file, while `et lyd` is ungrammatical and describes an abstract sound. | open |
| `F-no-053` | `no` | `tools.audio.coverChange` | pending translation / media terminology | `"Change cover"` | `"Endre omslagsbilde"` | The artwork action retains an English fallback; `omslagsbilde` identifies the edited image. | open |
| `F-no-054` | `no` | `tools.audio.coverSet` | pending translation / media terminology | `"Set cover image"` | `"Angi omslagsbilde"` | The cover-image control retains an English fallback and needs a concise Bokmål action. | open |
| `F-no-055` | `no` | `tools.audio.coverRemove` | pending translation / media terminology | `"Remove cover"` | `"Fjern omslagsbilde"` | The visible artwork-removal action retains an English fallback and must use the same reviewed `omslagsbilde` term as the adjacent controls. | open |
| `F-no-056` | `no` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Velg en bildefil"` | The wrong-file-type recovery instruction retains an English fallback in an otherwise localized cover-image picker. | open |
| `F-no-057` | `no` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"Bildet er for stort"` | The cover-upload size error retains an English fallback and is shown directly to Norwegian users after validation fails. | open |
| `F-no-058` | `no` | `tools.audio.coverAdd` | pending translation / media terminology | `"Add a cover"` | `"Legg til et omslagsbilde"` | The empty-cover action retains an English fallback and should identify the image resource. | open |
| `F-no-059` | `no` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"Bildekilde"` | `"Kilde til omslagsbilde"` | The accessible group name should identify the cover-image source selector rather than any generic image source. | open |
| `F-no-060` | `no` | `tools.database.viewTypeBoardDescription` | grammar | `"Vis arbeid som kolonner"` | `"Vis arbeidet i kolonner"` | The board-view description needs the definite object and the natural preposition for a column layout. | open |
| `F-no-061` | `no` | `tools.database.viewTypeListDescription` | terminology / clarity / source synchronization | `"En enkel lineær visning"` | `"Vis elementer i en enkel liste"` | The view picker should describe the familiar rendered list rather than use abstract linear-view terminology. | open |
| `F-no-062` | `no` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Laster inn forhåndsvisning av lenke"` | `"Laster inn forhåndsvisning av lenke…"` | The rendered in-progress placeholder needs the corpus-standard ellipsis. | open |
| `F-no-063` | `no` | `tools.embed.empty` | read-only context / source synchronization | `"Lim inn en lenke for å bygge inn"` | `"Ingen innebygd lenke"` | The caller renders an empty embed in read-only mode, where pasting is impossible. | open |
| `F-no-064` | `no` | `tools.video.seek` | accessibility / media terminology | `"Søk"` | `"Avspillingsposisjon"` | The accessible name belongs to a playback-position slider; `Søk` incorrectly suggests content search. | open |
| `F-no-065` | `no` | `tools.video.toggleTimeDisplay` | accessibility / clarity / source synchronization | `"Veksle tidsvisning"` | `"Veksle mellom avspilt og gjenstående tid"` | The accessible action must identify both actual time-display states instead of exposing an abstract toggle. | open |
| `F-no-066` | `no` | `tools.video.speedDecrease` | grammar / action clarity | `"Reduser avspillingshastighet"` | `"Senk avspillingshastigheten"` | The player-control action naturally uses the imperative `senk` and requires the definite object `avspillingshastigheten`. | open |
| `F-no-067` | `no` | `tools.video.speedIncrease` | grammar / action clarity | `"Øk avspillingshastighet"` | `"Øk avspillingshastigheten"` | The player-control action requires the definite object `avspillingshastigheten` in natural Bokmål. | open |
| `F-no-068` | `no` | `tools.video.speedPresets` | naturalness / accessibility | `"Hastighetsforhåndsinnstillinger"` | `"Forhåndsinnstilte hastigheter"` | The accessible group label is clearer as a normal phrase than as a dense compound. | open |
| `F-no-069` | `no` | `tools.video.pip` | established product terminology | `"Bilde-i-bilde"` | `"Bilde i bilde"` | Apple’s Norwegian platform terminology uses the unhyphenated `Bilde i bilde` feature name. | open |
| `F-no-070` | `no` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"Kopier video-URL ved gjeldende tid"` | `"Kopier video-URL ved gjeldende avspillingsposisjon"` | The copied URL targets the current playback head; `gjeldende tid` can instead be understood as wall-clock time. | open |
| `F-no-071` | `no` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Statistikk for nerder"` | `"Avspillingsstatistikk"` | The context-menu item opens playback data; the replacement removes prohibited slang and identifies the domain. | open |
| `F-no-072` | `no` | `tools.audio.speedDecrease` | grammar / action clarity | `"Reduser avspillingshastighet"` | `"Senk avspillingshastigheten"` | The player-control action naturally uses the imperative `senk` and requires the definite object `avspillingshastigheten`. | open |
| `F-no-073` | `no` | `tools.audio.speedIncrease` | grammar / action clarity | `"Øk avspillingshastighet"` | `"Øk avspillingshastigheten"` | The player-control action requires the definite object `avspillingshastigheten` in natural Bokmål. | open |
| `F-no-074` | `no` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emojier funnet"` | `"Emojitreff: {count}"` | The live region can announce one match; the label-before-count form is grammatical for every result count. | open |
| `F-am-001` | `am` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ቅርጸት አጽዳ"` | The built-in inline tool requires a localized action label. The exact WordPress Amharic [Clear formatting translation](https://translate.wordpress.org/projects/wp/dev/am/default/export-translations/?format=po), after trimming its accidental trailing space, reuses this dictionary’s established `ቅርጸት` and `አጽዳ` terms. | verified |
| `F-ar-001` | `ar` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"مسح التنسيق"` | Microsoft’s Arabic editor UI uses the exact concise command [مسح التنسيق](https://support.microsoft.com/ar-SA/Excel/format-text-in-cells). | verified |
| `F-az-001` | `az` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Formatı təmizlə"` | Azerbaijan’s State Examination Center documents Word’s Clear Formatting command as [Formatı Təmizlə](https://dim.gov.az/CkImage/Mag_III_izah_sayt_14_06_26__1781428794.pdf); sentence casing is normalized to the dictionary’s action register. | verified |
| `F-bg-001` | `bg` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Изчисти форматирането"` | Microsoft’s Bulgarian Word UI uses the exact command [Изчисти форматирането](https://support.microsoft.com/bg-BG/Word/format-your-word-document). | verified |
| `F-bn-001` | `bn` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"বিন্যাস অপসারণ"` | LibreOffice’s Bengali product UI supplies the exact Clear formatting translation [বিন্যাস অপসারণ](https://github.com/LibreOffice/translations/blob/master/source/bn/svx/messages.po#L6302-L6303). | verified |
| `F-bs-001` | `bs` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Očisti formatiranje"` | LibreOffice’s Bosnian product UI supplies the exact Clear formatting translation [Očisti formatiranje](https://github.com/LibreOffice/translations/blob/master/source/bs/svx/messages.po#L6304-L6305). | verified |
| `F-cs-001` | `cs` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Vymazat formátování"` | Microsoft’s Czech Word instructions name the concise command [Vymazat formátování](https://support.microsoft.com/cs-cz/office/form%C3%A1tov%C3%A1n%C3%AD-dokumentu-aplikace-word-fb9ef2d6-e2ad-4721-abc1-55f88864617f). | verified |
| `F-da-070` | `da` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Ryd formatering"` | Microsoft’s Danish editor UI uses the exact concise command [Ryd formatering](https://support.microsoft.com/da-dk/office/rydde-al-tekstformatering-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-de-073` | `de` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Formatierung löschen"` | Microsoft’s German editor UI uses the exact command [Formatierung löschen](https://support.microsoft.com/de-DE/PowerPoint/clear-all-text-formatting). | verified |
| `F-dv-001` | `dv` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ފޯމެޓްތައް ފޮހޭ"` | TinyMCE’s current Dhivehi rich-text-editor locale maps the exact action Clear formatting to [ފޯމެޓްތައް ފޮހޭ](https://unpkg.com/tinymce-i18n@26.2.9/langs/dv.js), a closer caller match than a composed generic-cleaning phrase. | verified |
| `F-el-001` | `el` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Απαλοιφή μορφοποίησης"` | Microsoft’s Greek editor UI uses the exact command [Απαλοιφή μορφοποίησης](https://support.microsoft.com/el-gr/office/%CE%B1%CF%80%CE%B1%CE%BB%CE%BF%CE%B9%CF%86%CE%AE-%CF%8C%CE%BB%CE%B7%CF%82-%CF%84%CE%B7%CF%82-%CE%BC%CE%BF%CF%81%CF%86%CE%BF%CF%80%CE%BF%CE%AF%CE%B7%CF%83%CE%B7%CF%82-%CE%BA%CE%B5%CE%B9%CE%BC%CE%AD%CE%BD%CE%BF%CF%85-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-es-087` | `es` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Borrar formato"` | Microsoft’s Spanish editor UI uses the exact concise command [Borrar formato](https://support.microsoft.com/es-es/office/borrar-todo-el-formato-de-texto-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-et-001` | `et` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Eemalda vorming"` | Microsoft’s Estonian Word UI uses the exact command [Eemalda vorming](https://support.microsoft.com/et-ee/word/format-your-word-document). | verified |
| `F-fa-001` | `fa` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"پاک کردن قالب‌بندی"` | LibreOffice’s Persian product UI supplies the exact Clear formatting translation [پاک کردن قالب‌بندی](https://github.com/LibreOffice/translations/blob/master/source/fa/svx/messages.po#L6368-L6369). | verified |
| `F-fi-001` | `fi` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Poista muotoilu"` | Microsoft’s Finnish OneNote UI uses the exact concise command [Poista muotoilu](https://support.microsoft.com/fi-fi/office/tekstin-korostaminen-onenoten-verkkoversio-5dadd21f-311c-42a3-8094-281f7bb7e127) for removing inline text styling. | verified |
| `F-fil-001` | `fil` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"I-clear ang pag-format"` | Google’s official Filipino Gmail UI uses the exact toolbar option [I-clear ang pag-format](https://support.google.com/mail/answer/8260?co=GENIE.Platform%3DAndroid&hl=fil), matching this dictionary’s existing clear-action register. | verified |
| `F-fr-125` | `fr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Effacer la mise en forme"` | Microsoft’s French editor UI uses the exact concise command [Effacer la mise en forme](https://support.microsoft.com/fr-fr/office/effacer-toute-la-mise-en-forme-du-texte-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-gu-001` | `gu` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ફોર્મેટિંગ સાફ કરો"` | An independent terminology pass rejected LibreOffice’s longer Clear Direct Formatting label because its technical qualifier is absent from this concise source. The replacement combines this dictionary’s established `ફોર્મેટિંગ` noun and `સાફ કરો` action; Google’s Gujarati UI independently uses the same formatting loanword. | verified |
| `F-he-001` | `he` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"נקה עיצוב"` | Microsoft’s Hebrew editor UI uses the exact concise command [נקה עיצוב](https://support.microsoft.com/he-IL/PowerPoint/clear-all-text-formatting). | verified |
| `F-hi-001` | `hi` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"टेक्स्ट की फ़ॉर्मैटिंग हटाएं"` | Google Docs’ Hindi shortcut action uses this exact wording in [official help](https://support.google.com/docs/answer/179738?hl=hi), NFC-normalized for the corpus. | verified |
| `F-hr-001` | `hr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Očisti oblikovanje"` | Microsoft’s Croatian editor UI uses the exact concise command [Očisti oblikovanje](https://support.microsoft.com/hr-HR/PowerPoint/clear-all-text-formatting). | verified |
| `F-hu-001` | `hu` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Formázás törlése"` | Microsoft’s Hungarian editor UI uses the exact command [Formázás törlése](https://support.microsoft.com/hu-HU/PowerPoint/clear-all-text-formatting). | verified |
| `F-hy-001` | `hy` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Մաքրել ուղղակի ձևաչափումը"` | LibreOffice’s Armenian Writer UI uses this exact Clear Direct Formatting label in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/hy/officecfg/registry/data/org/openoffice/Office/UI.po). | verified |
| `F-id-001` | `id` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Hapus pemformatan"` | Microsoft’s Indonesian editor UI uses Hapus Pemformatan in [official product help](https://support.microsoft.com/id-ID/PowerPoint/clear-all-text-formatting); the second word is lowercased to the dictionary’s sentence-case register. | verified |
| `F-it-084` | `it` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Cancella formattazione"` | Microsoft’s Italian editor UI uses the exact concise command [Cancella formattazione](https://support.microsoft.com/it-IT/PowerPoint/clear-all-text-formatting). | verified |
| `F-ja-001` | `ja` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"文字書式をクリア"` | Google Docs’ Japanese shortcut action uses the exact character-formatting command [文字書式をクリア](https://support.google.com/docs/answer/179738?hl=ja). | verified |
| `F-ka-001` | `ka` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"პირდაპირი დაფორმატების გასუფთავება"` | LibreOffice’s Georgian Writer UI uses this exact Clear Direct Formatting label in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/ka/officecfg/registry/data/org/openoffice/Office/UI.po). | verified |
| `F-km-001` | `km` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ជម្រះទ្រង់ទ្រាយ"` | LibreOffice’s exact short Clear formatting entry is `ជម្រះ​ទ្រង់ទ្រាយ`; the invisible separator is omitted to match this JSON corpus. An independent pass rejected the longer direct-formatting proposal as needless technical scope. | verified |
| `F-kn-001` | `kn` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ಫಾರ್ಮ್ಯಾಟಿಂಗ್ ತೆರವುಗೊಳಿಸಿ"` | The replacement combines this dictionary’s and Google’s established `ಫಾರ್ಮ್ಯಾಟಿಂಗ್` terminology with this dictionary’s polite `ತೆರವುಗೊಳಿಸಿ` clear-action register. An independent pass rejected the longer LibreOffice direct-formatting label as needlessly technical. | verified |
| `F-ko-001` | `ko` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"텍스트 서식 지우기"` | Google Docs’ Korean shortcut action uses the exact command [텍스트 서식 지우기](https://support.google.com/docs/answer/179738?hl=ko). | verified |
| `F-ku-001` | `ku` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"شێوەپێدانی ڕاستەوخۆ پاکبکەرەوە"` | LibreOffice’s Central Kurdish (`ckb`) localization supplies this exact command in its [official Sorani source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/ckb/officecfg/registry/data/org/openoffice/Office/UI.po), avoiding the Kurmanji fallback associated with generic `ku` elsewhere. | verified |
| `F-lo-001` | `lo` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ລ້າງຮູບແບບໂດຍກົງ"` | LibreOffice’s Lao UI supplies this exact Clear Direct Formatting command in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/lo/officecfg/registry/data/org/openoffice/Office/UI.po). | verified |
| `F-lt-001` | `lt` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Valyti formatavimą"` | Microsoft’s Lithuanian editor UI uses the exact concise command [Valyti formatavimą](https://support.microsoft.com/lt-LT/PowerPoint/clear-all-text-formatting). | verified |
| `F-lv-001` | `lv` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Notīrīt formatējumu"` | Microsoft’s Latvian editor UI uses the exact concise command [Notīrīt formatējumu](https://support.microsoft.com/lv-LV/PowerPoint/clear-all-text-formatting). | verified |
| `F-mk-001` | `mk` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Избриши форматирање"` | LibreOffice’s Macedonian Writer UI supplies this exact Clear Direct Formatting command in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/mk/officecfg/registry/data/org/openoffice/Office/UI.po). | verified |
| `F-ml-001` | `ml` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ഫോർമാറ്റിംഗ് മായ്ക്കുക"` | The replacement reuses this dictionary’s established `ഫോർമാറ്റിംഗ്` and `മായ്ക്കുക` terms. An independent pass rejected the longer LibreOffice direct-formatting label as unnecessary technical scope and rejected LibreOffice’s unrelated short “remove section” entry. | verified |
| `F-mn-001` | `mn` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Шууд форматыг арилгах"` | LibreOffice’s Mongolian UI supplies this exact direct-format-removal command in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/mn/officecfg/registry/data/org/openoffice/Office/UI.po). | verified |
| `F-mr-001` | `mr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"मजकूर फॉरमॅटिंग साफ करणे"` | Google Docs’ Marathi shortcut action uses the exact command [मजकूर फॉरमॅटिंग साफ करणे](https://support.google.com/docs/answer/179738?hl=mr). | verified |
| `F-ms-001` | `ms` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Kosongkan format teks"` | Google Docs’ Malay shortcut action uses the exact command [Kosongkan format teks](https://support.google.com/docs/answer/179738?hl=ms). | verified |
| `F-my-001` | `my` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ဖော်မတ်ချခြင်းကို ရှင်းလင်းရန်"` | An independent pass rejected LibreOffice’s direct-formatting proposal because `စီစဉ်ဖွဲ့စည်းမှုပုံစံ` reads as an organizational or configuration form and conflicts with this dictionary’s established `ဖော်မတ်ချခြင်း` terminology. The replacement also follows its existing `ရှင်းလင်းရန်` action register. | verified |
| `F-ne-001` | `ne` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ढाँचा खाली गर्नुहोस्"` | LibreOffice’s Nepali Writer UI supplies this exact command in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/ne/officecfg/registry/data/org/openoffice/Office/UI.po), reusing the dictionary’s established terms for format and clear. | verified |
| `F-nl-067` | `nl` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Opmaak wissen"` | Microsoft’s Dutch editor UI uses the exact concise command [Opmaak wissen](https://support.microsoft.com/nl-NL/PowerPoint/clear-all-text-formatting). | verified |
| `F-no-075` | `no` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Fjern formatering"` | Microsoft’s Norwegian Bokmål editor UI uses the exact concise command [Fjern formatering](https://support.microsoft.com/nb-NO/PowerPoint/clear-all-text-formatting). | verified |
| `F-pa-001` | `pa` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ਫਾਰਮੈਟਿੰਗ ਸਾਫ਼ ਕਰੋ"` | LibreOffice Punjabi uses `ਸਿੱਧੀ ਫਾਰਮੈਟਿੰਗ ਸਾਫ਼ ਕਰੋ` for Clear Direct Formatting in its [official product source](https://github.com/LibreOffice/translations/blob/master/source/pa-IN/officecfg/registry/data/org/openoffice/Office/UI.po#L34689-L34695); the direct qualifier and accelerator are omitted for this compact inline command. | verified |
| `F-pl-001` | `pl` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Wyczyść formatowanie"` | Microsoft’s Polish editor UI uses the exact command [Wyczyść formatowanie](https://support.microsoft.com/pl-PL/PowerPoint/clear-all-text-formatting). | verified |
| `F-ps-001` | `ps` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"بڼه پاکه کړئ"` | WordPress Pashto translates Clear formatting as `بڼه پاکه کړه` in its [official catalog](https://translate.wordpress.org/projects/wp/dev/ps/default/export-translations/?format=po); the final verb is adjusted to this dictionary’s polite imperative register. | verified |
| `F-pt-001` | `pt` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Limpar formatação"` | Microsoft’s Brazilian Portuguese editor UI uses Limpar Formatação in [official product help](https://support.microsoft.com/pt-BR/PowerPoint/clear-all-text-formatting); the second word is lowercased for the dictionary’s sentence-case register. | verified |
| `F-ro-001` | `ro` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Șterge formatarea"` | Google Docs uses `Șterge formatarea textului` in [Romanian help](https://support.google.com/docs/answer/179738?co=GENIE.Platform%3DDesktop&hl=ro), and [CKEditor independently uses the concise form](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/ro.po#L14-L16) selected for this toolbar. | verified |
| `F-ru-001` | `ru` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Очистить форматирование"` | Microsoft’s Russian editor UI uses the exact concise formatting-clear command in [official Word help](https://support.microsoft.com/ru-ru/office/%D0%B4%D0%BE%D0%B1%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-%D1%8D%D1%84%D1%84%D0%B5%D0%BA%D1%82%D0%B0-%D1%82%D0%B5%D0%BA%D1%81%D1%82%D1%83-%D0%BA%D0%BE%D0%BD%D1%82%D1%83%D1%80%D0%B0-%D1%82%D0%B5%D0%BD%D0%B8-%D0%BE%D1%82%D1%80%D0%B0%D0%B6%D0%B5%D0%BD%D0%B8%D1%8F-%D0%B8%D0%BB%D0%B8-%D1%81%D0%B2%D0%B5%D1%87%D0%B5%D0%BD%D0%B8%D1%8F-%D0%B2-word-3f3a758e-d255-4ba7-94f8-a3ee78fddfe1). | verified |
| `F-sd-001` | `sd` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"فارميٽنگ صاف ڪريو"` | WordPress Sindhi supplies the native clear action `صاف ڪريو` in its [official catalog](https://translate.wordpress.org/projects/wp/dev/snd/default/export-translations/?format=po); the object reuses this dictionary’s established `فارميٽنگ` noun. This adapted value remains flagged for a distinct full-language pass. | verified |
| `F-si-001` | `si` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"හැඩතල ගැන්වීම ඉවත් කරන්න"` | WordPress Sinhala uses `ආකෘතිකරණය ඉවත්කරන්න` for Clear formatting in its [official catalog](https://translate.wordpress.org/projects/wp/dev/si/default/export-translations/?format=po); the selected wording follows this dictionary’s existing formatting noun and spacing conventions. | verified |
| `F-sk-001` | `sk` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Vymazať formátovanie"` | Microsoft’s Slovak editor UI uses the exact command [Vymazať formátovanie](https://support.microsoft.com/sk-SK/PowerPoint/clear-all-text-formatting). | verified |
| `F-sl-001` | `sl` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Počisti oblikovanje"` | Microsoft’s Slovenian editor UI uses the exact concise command [Počisti oblikovanje](https://support.microsoft.com/sl-SI/PowerPoint/clear-all-text-formatting). | verified |
| `F-sq-001` | `sq` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Largo formatimin"` | CKEditor’s Albanian remove-format plugin uses the exact command [Largo formatimin](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/sq.po#L14-L16). | verified |
| `F-sr-001` | `sr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Уклони форматирање"` | CKEditor’s Serbian Cyrillic remove-format plugin uses the exact command [Уклони форматирање](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/sr.po#L14-L16), preserving this dictionary’s shipped script. | verified |
| `F-sv-001` | `sv` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Radera formatering"` | Microsoft’s Swedish editor UI uses the exact concise command [Radera formatering](https://support.microsoft.com/sv-SE/PowerPoint/clear-all-text-formatting). | verified |
| `F-sw-001` | `sw` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Ondoa uumbizaji"` | WordPress Swahili’s literal catalog label is `Fomati safi` in its [official catalog](https://translate.wordpress.org/projects/wp/dev/sw/default/export-translations/?format=po); `Ondoa uumbizaji` is the more natural action built from this dictionary’s vocabulary and remains explicitly flagged for independent full-language review. | verified |
| `F-ta-001` | `ta` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"வடிவமைப்பை அகற்று"` | Google Docs’ Tamil UI uses the exact command [வடிவமைப்பை அகற்று](https://support.google.com/docs/answer/4492226?hl=ta). | verified |
| `F-te-001` | `te` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ఫార్మాటింగ్‌ను తొలగించు"` | The wording combines this dictionary’s established `ఫార్మాటింగ్` with LibreOffice’s native removal verb in its [official Telugu source](https://github.com/LibreOffice/translations/blob/master/source/te/officecfg/registry/data/org/openoffice/Office/UI.po#L34966-L34972); [Google Docs](https://support.google.com/docs/answer/179738?co=GENIE.Platform%3DDesktop&hl=te) corroborates the construction. | verified |
| `F-th-001` | `th` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ล้างการจัดรูปแบบ"` | Microsoft’s Thai editor UI uses the exact command [ล้างการจัดรูปแบบ](https://support.microsoft.com/th-TH/PowerPoint/clear-all-text-formatting). | verified |
| `F-tr-001` | `tr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Biçimlendirmeyi temizle"` | Microsoft’s Turkish editor UI uses Biçimlendirmeyi Temizle in [official product help](https://support.microsoft.com/tr-TR/PowerPoint/clear-all-text-formatting); the second word is lowercased for the dictionary’s sentence-case register. | verified |
| `F-ug-001` | `ug` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"پىچىمنى چىقىرىۋەت"` | CKEditor’s Uyghur remove-format plugin uses the exact command [پىچىمنى چىقىرىۋەت](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/ug.po#L14-L16). | verified |
| `F-uk-001` | `uk` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Очистити форматування"` | Microsoft’s Ukrainian editor UI uses `Очистити все форматування` in [official product help](https://support.microsoft.com/uk-UA/PowerPoint/clear-all-text-formatting); `все` is omitted to match the concise source label and the tool’s link-preserving behavior. | verified |
| `F-ur-001` | `ur` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"فارمیٹ ہٹائیں"` | CKEditor’s Urdu remove-format plugin uses the exact concise command [فارمیٹ ہٹائیں](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/ur.po#L14-L16). | verified |
| `F-vi-001` | `vi` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Xóa định dạng"` | Microsoft’s Vietnamese help uses `Xóa định dạng khỏi văn bản` for the operation in [official product documentation](https://support.microsoft.com/vi-VN/PowerPoint/clear-all-text-formatting); the toolbar-sized label retains its established core term. | verified |
| `F-yi-001` | `yi` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"אַראָפּנעם די פֿאָרמאַטירונג"` | No authoritative localized vendor label was found. The selected wording deliberately reuses this dictionary’s `אַראָפּנעם דעם לינק` action pattern and `פֿאָרמאַטירונג` noun; it is the migration’s highest-uncertainty value and remains flagged for independent full-language review. | verified |
| `F-zh-001` | `zh` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"清除格式"` | Microsoft’s Simplified Chinese editor UI uses the exact concise command [清除格式](https://support.microsoft.com/zh-CN/PowerPoint/clear-all-text-formatting). | verified |
| `F-zh-TW-001` | `zh-TW` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"清除格式"` | Microsoft’s Taiwan Traditional Chinese editor UI uses the exact concise command [清除格式](https://support.microsoft.com/zh-TW/PowerPoint/clear-all-text-formatting). | verified |
| `F-global-001` | all non-English | 36 changed English source keys | source dependency | Localized values have not been re-reviewed against the 35 corrected source values and the new clear-formatting key. | Re-audit all 36 dependent values in all 68 localized dictionaries and correct them where required. | English-source changes invalidate dependent semantic evidence; every complete 539-key locale pass must inspect all 36 dependencies, including `toolNames.clearFormat`. | open |

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
| `R-fr-001` | `fr` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; France-French Apple guidance retains the `⌘` platform symbol. | [Apple — Raccourcis clavier sur Mac](https://support.apple.com/fr-fr/guide/mac-help/mchlp2262/mac) |
| `R-fr-002` | `fr` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than English prose; France-French Windows guidance retains `Ctrl` in key combinations. | [Microsoft — Raccourcis clavier dans Windows](https://support.microsoft.com/fr-fr/windows/raccourcis-clavier-dans-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-fr-003` | `fr` | `popover.actions` | established cognate | `Actions` is the normal French plural heading for the available operations. | [Académie française — action](https://www.dictionnaire-academie.fr/article/A9A0471) |
| `R-fr-004` | `fr` | `searchTerms.code` | established cognate | Lowercase `code` is the established French computing term and follows French search-alias casing. | [Académie française — code](https://www.dictionnaire-academie.fr/article/A9C2779) |
| `R-fr-005` | `fr` | `searchTerms.note` | established cognate | Lowercase `note` is the normal French noun and a useful unchanged search alias. | [Académie française — note](https://www.dictionnaire-academie.fr/article/A9N0694) |
| `R-fr-006` | `fr` | `toolNames.audio` | established loanword | `Audio` is the established French technical and media term and the natural concise tool name. | [Académie française — audio](https://www.dictionnaire-academie.fr/article/A9A3123) |
| `R-fr-007` | `fr` | `toolNames.code` | established cognate | `Code` is the established French computing term and the natural concise tool name. | [Académie française — code](https://www.dictionnaire-academie.fr/article/A9C2779) |
| `R-fr-008` | `fr` | `toolNames.image` | established cognate | `Image` is the normal French noun and the natural concise tool name. | [Académie française — image](https://www.dictionnaire-academie.fr/article/A9I0182) |
| `R-fr-009` | `fr` | `tools.audio.pause` | established cognate | `Pause` is the standard unchanged France-French media-control label. | [Apple — Écouter de la musique sur l’iPhone](https://support.apple.com/fr-fr/guide/iphone/iph676daac9b/ios) |
| `R-fr-010` | `fr` | `tools.audio.volume` | established cognate | `Volume` is the standard unchanged France-French media-control label. | [Apple — Écouter de la musique sur l’iPhone](https://support.apple.com/fr-fr/guide/iphone/iph676daac9b/ios) |
| `R-fr-011` | `fr` | `tools.callout.colorOrange` | established cognate | `Orange` is the established unchanged French color name. | [Académie française — orange](https://www.dictionnaire-academie.fr/article/A9O0620) |
| `R-fr-012` | `fr` | `tools.callout.emojiCategoryNature` | established cognate | `Nature` is the normal French category name and needs no localization change. | [Académie française — nature](https://www.dictionnaire-academie.fr/article/A9N0131) |
| `R-fr-013` | `fr` | `tools.code.codeTab` | established cognate | `Code` is the established French term for program source and the natural editor-tab label. | [Académie française — code](https://www.dictionnaire-academie.fr/article/A9C2779) |
| `R-fr-014` | `fr` | `tools.colorPicker.color.orange` | established cognate | `Orange` is the established unchanged French color name. | [Académie française — orange](https://www.dictionnaire-academie.fr/article/A9O0620) |
| `R-fr-015` | `fr` | `tools.database.propertyTypeDate` | established cognate | `Date` is the normal unchanged French noun for this database property type. | [Académie française — date](https://www.dictionnaire-academie.fr/article/A9D0115) |
| `R-fr-016` | `fr` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in France-French product interfaces. | [Notion — Images, fichiers et médias](https://www.notion.com/fr/help/images-files-and-media) |
| `R-fr-017` | `fr` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form for French `texte alternatif`; the surrounding dialog supplies the full description. | [MDN — HTMLImageElement.alt](https://developer.mozilla.org/fr/docs/Web/API/HTMLImageElement/alt) |
| `R-fr-018` | `fr` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in France-French media interfaces. | [Apple Clips — Modifier les proportions](https://support.apple.com/fr-fr/guide/clips/dev57f9eb69d/ios) |
| `R-fr-019` | `fr` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in France-French media interfaces. | [Apple Clips — Modifier les proportions](https://support.apple.com/fr-fr/guide/clips/dev57f9eb69d/ios) |
| `R-fr-020` | `fr` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in France-French media interfaces. | [Apple Clips — Modifier les proportions](https://support.apple.com/fr-fr/guide/clips/dev57f9eb69d/ios) |
| `R-fr-021` | `fr` | `tools.video.pause` | established cognate | `Pause` is the standard unchanged France-French media-control label. | [Apple — Écouter de la musique sur l’iPhone](https://support.apple.com/fr-fr/guide/iphone/iph676daac9b/ios) |
| `R-fr-022` | `fr` | `tools.video.volume` | established cognate | `Volume` is the standard unchanged France-French media-control label. | [Apple — Écouter de la musique sur l’iPhone](https://support.apple.com/fr-fr/guide/iphone/iph676daac9b/ios) |
| `R-it-001` | `it` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Italian Apple guidance retains the `⌘` platform symbol. | [Apple — Abbreviazioni da tastiera del Mac](https://support.apple.com/it-it/102650) |
| `R-it-002` | `it` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Italian Microsoft guidance retains `Ctrl` in key combinations. | [Microsoft — Scelte rapide da tastiera in Windows](https://support.microsoft.com/it-it/windows/scelte-rapide-da-tastiera-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-it-003` | `it` | `toolNames.link` | established loanword | `Link` is the established Italian computing term and the natural concise toolbox label. | [Treccani — link](https://www.treccani.it/vocabolario/link/) |
| `R-it-004` | `it` | `toolNames.database` | established loanword | `Database` is established Italian product terminology and the natural concise toolbox label. | [Notion — Introduzione ai database](https://www.notion.com/it/help/intro-to-databases) |
| `R-it-005` | `it` | `searchTerms.layout` | established loanword | Lowercase `layout` is an established Italian design term and follows the locale’s lowercase search-alias convention. | [Treccani — layout](https://www.treccani.it/vocabolario/layout/) |
| `R-it-006` | `it` | `toolNames.video` | established loanword | `Video` is an established Italian media term and the natural concise toolbox label. | [Treccani — video](https://www.treccani.it/vocabolario/video/) |
| `R-it-007` | `it` | `toolNames.audio` | established loanword | `Audio` is an established Italian media term and the natural concise toolbox label. | [Treccani — audio](https://www.treccani.it/vocabolario/audio/) |
| `R-it-008` | `it` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form associated with Italian `testo alternativo`; the surrounding dialog supplies the full localized label. | [Notion — Immagini e file multimediali](https://www.notion.com/it/help/images-files-and-media) |
| `R-it-009` | `it` | `tools.image.emptyLink` | established loanword | `Link` is the established Italian computing term for the image-source option. | [Treccani — link](https://www.treccani.it/vocabolario/link/) |
| `R-it-010` | `it` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Italian media interfaces. | [Apple — Ritagliare, ruotare o capovolgere una foto o un video](https://support.apple.com/it-it/guide/iphone/iph3dc593597/ios) |
| `R-it-011` | `it` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Italian media interfaces. | [Apple — Ritagliare, ruotare o capovolgere una foto o un video](https://support.apple.com/it-it/guide/iphone/iph3dc593597/ios) |
| `R-it-012` | `it` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Italian media interfaces. | [Apple — Ritagliare, ruotare o capovolgere una foto o un video](https://support.apple.com/it-it/guide/iphone/iph3dc593597/ios) |
| `R-it-013` | `it` | `toolNames.file` | established loanword | `File` is the established Italian computing term and the natural concise toolbox label. | [Treccani — file](https://www.treccani.it/vocabolario/file/) |
| `R-it-014` | `it` | `tools.file.emptyLink` | established loanword | `Link` is the established Italian computing term for the file-source option. | [Treccani — link](https://www.treccani.it/vocabolario/link/) |
| `R-it-015` | `it` | `tools.video.emptyLink` | established loanword | `Link` is the established Italian computing term for the video-source option. | [Treccani — link](https://www.treccani.it/vocabolario/link/) |
| `R-it-016` | `it` | `tools.audio.emptyLink` | established loanword | `Link` is the established Italian computing term for the audio-source option. | [Treccani — link](https://www.treccani.it/vocabolario/link/) |
| `R-it-017` | `it` | `tools.audio.coverLink` | established loanword | `Link` is the established Italian computing term for the cover-image source option. | [Treccani — link](https://www.treccani.it/vocabolario/link/) |
| `R-it-018` | `it` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Italian product interfaces. | [Notion — Immagini e file multimediali](https://www.notion.com/it/help/images-files-and-media) |
| `R-it-019` | `it` | `tools.video.volume` | established cognate | `Volume` is the standard unchanged Italian media-control label. | [Treccani — volume](https://www.treccani.it/vocabolario/volume/) |
| `R-it-020` | `it` | `tools.video.pip` | established loanword | `Picture-in-Picture` is the established unchanged platform feature name in this Italian product context. | [Apple — Guardare due eventi contemporaneamente](https://support.apple.com/it-it/guide/tv/atvb7944597f/tvos) |
| `R-it-021` | `it` | `tools.audio.volume` | established cognate | `Volume` is the standard unchanged Italian media-control label. | [Treccani — volume](https://www.treccani.it/vocabolario/volume/) |
| `R-nl-001` | `nl` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Dutch Apple guidance retains the `⌘` platform symbol. | [Apple — Mac-toetscombinaties](https://support.apple.com/nl-nl/102650) |
| `R-nl-002` | `nl` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than English prose; Dutch Microsoft guidance retains `Ctrl` in key combinations. | [Microsoft — Sneltoetsen in Windows](https://support.microsoft.com/nl-nl/windows/sneltoetsen-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-nl-003` | `nl` | `toolNames.link` | established loanword | `Link` is the standard concise Dutch web term and the natural toolbox label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media) |
| `R-nl-004` | `nl` | `toolNames.database` | established loanword | `Database` is the standard Dutch product term and the natural toolbox label. | [Notion — Schrijven en bewerken](https://www.notion.com/nl/help/writing-and-editing-basics); [Notion — Database-eigenschappen](https://www.notion.com/nl/help/database-properties) |
| `R-nl-005` | `nl` | `toolNames.code` | established loanword | `Code` is the standard Dutch computing term and the natural concise tool name. | [Notion — Schrijven en bewerken](https://www.notion.com/nl/help/writing-and-editing-basics) |
| `R-nl-006` | `nl` | `tools.code.codeTab` | established loanword | `Code` is the natural Dutch editor-tab label for program source. | [Notion — Schrijven en bewerken](https://www.notion.com/nl/help/writing-and-editing-basics) |
| `R-nl-007` | `nl` | `searchTerms.code` | established loanword | Lowercase `code` is the standard Dutch computing term and a useful search alias. | [Notion — Schrijven en bewerken](https://www.notion.com/nl/help/writing-and-editing-basics) |
| `R-nl-008` | `nl` | `toolNames.video` | established loanword | `Video` is the standard Dutch media term and the natural concise toolbox label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media); [Apple — Media afspelen](https://support.apple.com/nl-nl/guide/iphone/iphb71f9b54d/ios) |
| `R-nl-009` | `nl` | `toolNames.audio` | established loanword | `Audio` is the standard Dutch media term and the natural concise toolbox label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media); [Apple — Media afspelen](https://support.apple.com/nl-nl/guide/iphone/iphb71f9b54d/ios) |
| `R-nl-010` | `nl` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form of Dutch `alternatieve tekst`; the surrounding dialog supplies the full localized label. | [Microsoft — Toegankelijke afbeeldingen en media](https://support.microsoft.com/nl-NL/accessibility/sharepoint/add-accessible-pictures-and-media-to-a-sharepoint-online-site) |
| `R-nl-011` | `nl` | `tools.image.emptyLink` | established loanword | `Link` is the standard Dutch source-option label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media) |
| `R-nl-012` | `nl` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Dutch media interfaces. | [Apple — Een foto of video bijsnijden](https://support.apple.com/nl-nl/guide/iphone/iph3dc593597/26/ios/26) |
| `R-nl-013` | `nl` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Dutch media interfaces. | [Apple — Een foto of video bijsnijden](https://support.apple.com/nl-nl/guide/iphone/iph3dc593597/26/ios/26) |
| `R-nl-014` | `nl` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Dutch media interfaces. | [Apple — Een foto of video bijsnijden](https://support.apple.com/nl-nl/guide/iphone/iph3dc593597/26/ios/26) |
| `R-nl-015` | `nl` | `tools.file.emptyLink` | established loanword | `Link` is the standard Dutch source-option label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media) |
| `R-nl-016` | `nl` | `tools.video.emptyLink` | established loanword | `Link` is the standard Dutch source-option label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media) |
| `R-nl-017` | `nl` | `tools.audio.emptyLink` | established loanword | `Link` is the standard Dutch source-option label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media) |
| `R-nl-018` | `nl` | `tools.audio.coverLink` | established loanword | `Link` is the standard Dutch source-option label. | [Notion — Afbeeldingen, bestanden en media](https://www.notion.com/nl/help/images-files-and-media) |
| `R-nl-019` | `nl` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym in Dutch product interfaces. | [Notion — Database-eigenschappen](https://www.notion.com/nl/help/database-properties) |
| `R-nl-020` | `nl` | `tools.database.defaultStatusProperty` | established cognate | `Status` is the normal Dutch database-property term. | [Notion — Database-eigenschappen](https://www.notion.com/nl/help/database-properties) |
| `R-nl-021` | `nl` | `tools.video.volume` | established cognate | `Volume` is the standard unchanged Dutch media-control label. | [Apple — Het volume aanpassen](https://support.apple.com/nl-nl/guide/iphone/iph3a22707a5/ios) |
| `R-nl-022` | `nl` | `tools.audio.volume` | established cognate | `Volume` is the standard unchanged Dutch media-control label. | [Apple — Het volume aanpassen](https://support.apple.com/nl-nl/guide/iphone/iph3a22707a5/ios) |
| `R-no-001` | `no` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Norwegian Apple guidance retains the `⌘` platform symbol. | [Apple — Tastatursnarveier på Mac](https://support.apple.com/no-no/102650) |
| `R-no-002` | `no` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than English prose; Norwegian Microsoft guidance retains `Ctrl` in key combinations. | [Microsoft — Hurtigtaster i Windows](https://support.microsoft.com/nb-no/windows/hurtigtaster-i-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-no-003` | `no` | `toolNames.database` | established loanword | `Database` is an established unchanged Bokmål computing term and the natural concise toolbox label. | [Bokmålsordboka — database](https://ordbokene.no/bm/database) |
| `R-no-004` | `no` | `toolNames.video` | established loanword | `Video` is an established unchanged Bokmål media term and the natural concise toolbox label. | [Bokmålsordboka — video](https://ordbokene.no/bm/video) |
| `R-no-005` | `no` | `tools.image.sizeFull` | established cognate | `Full` is the normal unchanged Bokmål adjective for the complete-size image option. | [Bokmålsordboka — full](https://ordbokene.no/bm/full) |
| `R-no-006` | `no` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form associated with Bokmål `alternativ tekst`; the surrounding dialog supplies the full localized description. | [Microsoft — Legge til alternativ tekst](https://support.microsoft.com/nb-no/office/legge-til-alternativ-tekst-i-en-figur-et-bilde-et-diagram-smartart-grafikk-eller-et-annet-objekt-44989b2a-903c-4d9a-b742-6a75b451c669) |
| `R-no-007` | `no` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Norwegian media interfaces. | [Apple — Endre størrelsen og retningen på et bilde](https://support.apple.com/no-no/guide/iphone/iph3dc593597/ios) |
| `R-no-008` | `no` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Norwegian media interfaces. | [Apple — Endre størrelsen og retningen på et bilde](https://support.apple.com/no-no/guide/iphone/iph3dc593597/ios) |
| `R-no-009` | `no` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Norwegian media interfaces. | [Apple — Endre størrelsen og retningen på et bilde](https://support.apple.com/no-no/guide/iphone/iph3dc593597/ios) |
| `R-no-010` | `no` | `tools.audio.artistPlaceholder` | established loanword | `Artist` is an established unchanged Bokmål media noun and Apple’s Norwegian music metadata uses the same field label. | [Bokmålsordboka — artist](https://ordbokene.no/nob/bm/artist); [Apple Music — Endre sang- og CD-informasjon](https://support.apple.com/no-no/guide/music/mus2561f46f8/mac) |
| `R-no-011` | `no` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Norwegian product interfaces. | [Apple — Angi en URL-adresse](https://support.apple.com/no-no/guide/mac-help/mchl70368996/mac) |
| `R-no-012` | `no` | `tools.database.defaultStatusProperty` | established cognate | `Status` is the normal unchanged Bokmål noun for this workflow property. | [Bokmålsordboka — status](https://ordbokene.no/bm/status) |
| `R-no-013` | `no` | `tools.video.pause` | established cognate | `Pause` is the established unchanged Bokmål noun and the standard concise video-player control label in Norwegian media interfaces. | [Bokmålsordboka — pause](https://ordbokene.no/bm/pause); [Apple — Bruk avspillingskontrollene](https://support.apple.com/no-no/guide/iphone/iphaec9fc22f/ios) |
| `R-no-014` | `no` | `tools.audio.pause` | established cognate | `Pause` is the established unchanged Bokmål noun and the standard concise audio-player control label in Norwegian media interfaces. | [Bokmålsordboka — pause](https://ordbokene.no/bm/pause); [Apple — Bruk avspillingskontrollene](https://support.apple.com/no-no/guide/iphone/iphaec9fc22f/ios) |
