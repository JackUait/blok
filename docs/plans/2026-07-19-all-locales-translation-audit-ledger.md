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
| `Finding IDs` | Exactly `—` when no locale-specific finding has ever been recorded, otherwise a comma-separated list of existing `F-<locale>-NNN` rows. Verified findings remain listed as history. A global `F-global-NNN` finding is recorded once in the finding table and is not duplicated into every affected locale row. |
| `Final status` | Exactly `pending`, `first-pass-complete`, `second-pass-complete`, or `verified`; transitions may not be skipped. |
| Finding-table `Status` | Exactly `open` or `verified`; a new finding starts `open`. |

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
   complete passes again. This includes keys added, removed, or renamed; value
   edits; structural changes; duplicate-key changes; raw encoding, Unicode
   normalization, or whitespace changes; and formatting changes that can affect
   raw-integrity evidence. Reopen every finding whose key, value, rationale,
   disposition, or evidence depends on the changed content.
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
| `da` | Danish | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `de` | German | Latin | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `dv` | Dhivehi (Maldivian) | Thaana | rtl | to-audit | — | — | pending | pending | pending | — | pending |
| `el` | Greek | Greek | ltr | to-audit | — | — | pending | pending | pending | — | pending |
| `en` | English | Latin | ltr | concise US English; sentence-case UI | codex-en-pass1-2026-07-19 | — | pass | pass | pass | `F-en-001`, `F-en-002`, `F-en-003`, `F-en-004`, `F-en-005`, `F-en-006`, `F-en-007`, `F-en-008`, `F-en-009`, `F-en-010`, `F-en-011`, `F-en-012`, `F-en-013`, `F-en-014`, `F-en-015`, `F-en-016`, `F-en-017`, `F-en-018`, `F-en-019`, `F-en-020`, `F-en-021`, `F-en-022`, `F-en-023`, `F-en-024`, `F-en-025`, `F-en-026`, `F-en-027`, `F-en-028`, `F-en-029`, `F-en-030`, `F-en-031`, `F-en-032`, `F-en-033`, `F-en-034`, `F-en-035` | first-pass-complete |
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
