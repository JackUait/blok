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
| `cs` | Czech | Latin | ltr | neutral contemporary Czech; polite plural imperatives in full instructions; concise infinitive actions; sentence case; established Czech product and accessibility terminology; count-neutral variable templates | — | — | pending | pending | pending | `F-cs-001`–`F-cs-122` | pending |
| `da` | Danish | Latin | ltr | neutral concise Danish; direct actions; lowercase search aliases | — | — | pending | pending | pending | `F-da-001`–`F-da-076` | pending |
| `de` | German | Latin | ltr | formal `Sie` in sentences; concise infinitive actions; German noun capitalization | — | — | pending | pending | pending | `F-de-001`–`F-de-088` | pending |
| `dv` | Dhivehi (Maldivian) | Thaana | rtl | to-audit | — | — | pending | pending | pending | `F-dv-001` | pending |
| `el` | Greek | Greek | ltr | to-audit | — | — | pending | pending | pending | `F-el-001` | pending |
| `en` | English | Latin | ltr | concise US English; sentence-case UI | — | — | pending | pending | pending | `F-en-001`–`F-en-046` | pending |
| `es` | Spanish | Latin | ltr | informal Spain Spanish; `tú` imperatives for instructions; infinitive menu actions; Spain terminology and spelling | — | — | pending | pending | pending | `F-es-001`–`F-es-099` | pending |
| `et` | Estonian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-et-001` | pending |
| `fa` | Persian (Farsi) | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-fa-001` | pending |
| `fi` | Finnish | Latin | ltr | neutral contemporary Finnish; concise imperatives for actions; implicit singular addressee in instructions; sentence-case UI; lowercase search aliases | — | — | pending | pending | pending | `F-fi-001`–`F-fi-098` | pending |
| `fil` | Filipino | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-fil-001` | pending |
| `fr` | French | Latin | ltr | formal France French (`fr-FR`) in sentences; concise infinitive actions; sentence case; lowercase search aliases | — | — | pending | pending | pending | `F-fr-001`–`F-fr-131` | pending |
| `gu` | Gujarati | Gujarati | ltr | to-audit | — | — | pending | pending | pending | `F-gu-001` | pending |
| `he` | Hebrew | Hebrew | rtl | to-audit | — | — | pending | pending | pending | `F-he-001` | pending |
| `hi` | Hindi | Devanagari | ltr | to-audit | — | — | pending | pending | pending | `F-hi-001` | pending |
| `hr` | Croatian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-hr-001` | pending |
| `hu` | Hungarian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-hu-001` | pending |
| `hy` | Armenian | Armenian | ltr | to-audit | — | — | pending | pending | pending | `F-hy-001` | pending |
| `id` | Indonesian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-id-001` | pending |
| `it` | Italian | Latin | ltr | neutral contemporary Italian; informal singular `tu` imperatives for instructions; concise imperatives for actions; sentence case | — | — | pending | pending | pending | `F-it-001`–`F-it-089` | pending |
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
| `nl` | Dutch | Latin | ltr | neutral Netherlands Dutch; informal `je` in full instructions and confirmations; concise infinitive actions and direct imperatives; sentence case; standard Dutch compounds and punctuation | — | — | pending | pending | pending | `F-nl-001`–`F-nl-085` | pending |
| `no` | Norwegian (current Bokmål wording) | Latin | ltr | neutral contemporary Bokmål; informal singular `du` in full instructions and confirmations; concise imperatives for actions; sentence case; lowercase search aliases | — | — | pending | pending | pending | `F-no-001`–`F-no-081` | pending |
| `pa` | Punjabi (Gurmukhi) | Gurmukhi | ltr | to-audit | — | — | pending | pending | pending | `F-pa-001` | pending |
| `pl` | Polish | Latin | ltr | neutral contemporary Polish; concise imperatives for actions; implicit singular addressee in instructions; sentence-case UI; established Polish product and accessibility terminology; count-neutral variable templates | — | — | pending | pending | pending | `F-pl-001`–`F-pl-126` | pending |
| `ps` | Pashto | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-ps-001` | pending |
| `pt` | Portuguese (current Brazilian wording) | Latin | ltr | neutral contemporary Brazilian Portuguese; implicit `você` in direct imperatives and full instructions; concise infinitive action labels; sentence case; established Brazilian product and accessibility terminology | — | — | pending | pending | pending | `F-pt-001`–`F-pt-085` | pending |
| `ro` | Romanian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-ro-001` | pending |
| `ru` | Russian | Cyrillic | ltr | neutral-polite standard Russian; sentence-case labels; infinitive menu commands; polite plural imperatives for hints; normative `ё`; established Russian product and accessibility terms; no slang or needless transliteration | — | — | pending | pending | pending | `F-ru-001`–`F-ru-126` | pending |
| `sd` | Sindhi | Arabic | rtl | to-audit | — | — | pending | pending | pending | `F-sd-001` | pending |
| `si` | Sinhala | Sinhala | ltr | to-audit | — | — | pending | pending | pending | `F-si-001` | pending |
| `sk` | Slovak | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sk-001` | pending |
| `sl` | Slovenian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sl-001` | pending |
| `sq` | Albanian | Latin | ltr | to-audit | — | — | pending | pending | pending | `F-sq-001` | pending |
| `sr` | Serbian (Cyrillic) | Cyrillic | ltr | to-audit | — | — | pending | pending | pending | `F-sr-001` | pending |
| `sv` | Swedish | Latin | ltr | neutral contemporary Sweden Swedish; informal singular `du` only in full instructions; concise imperatives for actions; sentence case; lowercase search aliases; standard Swedish compounds | — | — | pending | pending | pending | `F-sv-001`–`F-sv-094` | pending |
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
| `zh` | Chinese (Simplified) | Simplified Han | ltr | neutral contemporary Mainland Simplified Chinese; concise verb-object actions; established Chinese product and accessibility terminology; Chinese sentence punctuation | — | — | pending | pending | pending | `F-zh-001`–`F-zh-058` | pending |
| `zh-TW` | Chinese (Taiwan, Traditional) | Traditional Han | ltr | neutral contemporary Taiwan Traditional Chinese; concise verb-object actions; established Taiwan product and accessibility terminology; Traditional Chinese sentence punctuation | — | — | pending | pending | pending | `F-zh-TW-001`–`F-zh-TW-032` | pending |

| `R-sv-001` | `sv` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Swedish Apple guidance retains the `⌘` platform symbol. | [Apple — Kortkommandon på Mac](https://support.apple.com/sv-se/102650) |
| `R-sv-002` | `sv` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than English prose; Swedish Microsoft guidance retains `Ctrl` in key combinations. | [Microsoft — Kortkommandon i Windows](https://support.microsoft.com/sv-se/windows/kortkommandon-i-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-sv-003` | `sv` | `toolNames.text` | established cognate | `Text` is the normal unchanged Swedish noun and the natural concise toolbox label. | [Svenska Akademiens ordlista — text](https://svenska.se/saol/?sok=text) |
| `R-sv-004` | `sv` | `tools.colorPicker.color.orange` | established cognate | `Orange` is the established unchanged Swedish color name. | [Svenska Akademiens ordlista — orange](https://svenska.se/saol/?sok=orange) |
| `R-sv-005` | `sv` | `searchTerms.layout` | established loanword | Lowercase `layout` is an established Swedish design and interface term and follows the locale's search-alias casing. | [Microsoft — Hantera tangentbordslayout](https://support.microsoft.com/sv-SE/Windows/Hardware/Input-Devices/manage-the-language-and-keyboard-input-layout-settings-in-windows) |
| `R-sv-006` | `sv` | `tools.callout.colorOrange` | established cognate | `Orange` is the established unchanged Swedish color name. | [Svenska Akademiens ordlista — orange](https://svenska.se/saol/?sok=orange) |
| `R-sv-007` | `sv` | `toolNames.video` | established loanword | `Video` is the established unchanged Swedish media noun and the natural concise toolbox label. | [Apple — Spela upp videor på iPhone](https://support.apple.com/sv-se/guide/iphone/iphb71f9b54d/ios) |
| `R-sv-008` | `sv` | `tools.link.linkText` | established cognate | `Text` is the normal unchanged Swedish noun for the visible link text. | [Svenska Akademiens ordlista — text](https://svenska.se/saol/?sok=text) |
| `R-sv-009` | `sv` | `tools.image.sizeFull` | established cognate | `Full` is the ordinary Swedish adjective for a complete or 100-percent extent and is a concise size option in this context. | [Svenska Akademiens ordlista — full](https://svenska.se/saol/?sok=full) |
| `R-sv-010` | `sv` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form associated with Swedish `alternativtext`; the surrounding dialog supplies the full localized label. | [Microsoft — Effektiv alternativtext](https://support.microsoft.com/sv-se/accessibility/office-accessibility/everything-you-need-to-know-to-write-effective-alt-text) |
| `R-sv-011` | `sv` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Swedish media interfaces. | [Apple — Beskär en bild eller video](https://support.apple.com/sv-se/guide/iphone/iph3dc593597/ios) |
| `R-sv-012` | `sv` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Swedish media interfaces. | [Apple — Beskär en bild eller video](https://support.apple.com/sv-se/guide/iphone/iph3dc593597/ios) |
| `R-sv-013` | `sv` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Swedish media interfaces. | [Apple — Beskär en bild eller video](https://support.apple.com/sv-se/guide/iphone/iph3dc593597/ios) |
| `R-sv-014` | `sv` | `tools.audio.artistPlaceholder` | established loanword | `Artist` is the established unchanged Swedish media noun and Apple Music uses the exact field label for track metadata. | [Apple Music — Ändra låtinformation](https://support.apple.com/sv-se/guide/music-windows/mus2561f46f8/windows) |
| `R-sv-015` | `sv` | `tools.database.propertyTypeText` | established cognate | `Text` is the normal unchanged Swedish noun for this database property type. | [Svenska Akademiens ordlista — text](https://svenska.se/saol/?sok=text) |
| `R-sv-016` | `sv` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Swedish product interfaces. | [Svenska Akademiens ordlista — URL](https://svenska.se/saol/?sok=url) |
| `R-sv-017` | `sv` | `tools.database.defaultStatusProperty` | established cognate | `Status` is the normal unchanged Swedish noun for this workflow property. | [Svenska Akademiens ordlista — status](https://svenska.se/saol/?sok=status) |
| `R-zh-001` | `zh` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Apple’s Simplified Chinese guidance retains the `⌘` platform symbol. | [Apple — Mac 键盘快捷键](https://support.apple.com/zh-cn/102650) |
| `R-zh-002` | `zh` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Microsoft’s Simplified Chinese shortcut guidance retains `Ctrl` in key combinations. | [Microsoft — Windows 的键盘快捷方式](https://support.microsoft.com/zh-cn/windows/windows-%E7%9A%84%E9%94%AE%E7%9B%98%E5%BF%AB%E6%8D%B7%E6%96%B9%E5%BC%8F-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-zh-003` | `zh` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Simplified Chinese media interfaces. | [Apple — 使用 iPhone 相机工具设置照片](https://support.apple.com/zh-cn/guide/iphone/iph3dc593597/ios) |
| `R-zh-004` | `zh` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Simplified Chinese media interfaces. | [Apple — 使用 iPhone 相机工具设置照片](https://support.apple.com/zh-cn/guide/iphone/iph3dc593597/ios) |
| `R-zh-005` | `zh` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Simplified Chinese media interfaces. | [Apple — 使用 iPhone 相机工具设置照片](https://support.apple.com/zh-cn/guide/iphone/iph3dc593597/ios) |
| `R-zh-006` | `zh` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Simplified Chinese web and product terminology. | [MDN — 什么是 URL？](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_URL) |
| `R-zh-TW-001` | `zh-TW` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Apple’s Taiwan guidance retains the `⌘` platform symbol. | [Apple — Mac 鍵盤快速鍵](https://support.apple.com/zh-tw/102650) |
| `R-zh-TW-002` | `zh-TW` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Microsoft’s Taiwan guidance retains `Ctrl` in key combinations. | [Microsoft — Windows 鍵盤提示與訣竅](https://support.microsoft.com/zh-TW/Windows/Hardware/Input-Devices/windows-keyboard-tips-and-tricks) |
| `R-zh-TW-003` | `zh-TW` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Taiwan Traditional Chinese media interfaces. | [Apple — 在 iPhone 上使用相機工具設定快照](https://support.apple.com/zh-tw/guide/iphone/iph3dc593597/ios) |
| `R-zh-TW-004` | `zh-TW` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Taiwan Traditional Chinese media interfaces. | [Apple — 在 iPhone 上使用相機工具設定快照](https://support.apple.com/zh-tw/guide/iphone/iph3dc593597/ios) |
| `R-zh-TW-005` | `zh-TW` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Taiwan Traditional Chinese media interfaces. | [Apple — 在 iPhone 上使用相機工具設定快照](https://support.apple.com/zh-tw/guide/iphone/iph3dc593597/ios) |
| `R-zh-TW-006` | `zh-TW` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Taiwan Traditional Chinese product terminology. | [Apple — 在 iPhone 或 iPad 上的「捷徑」中加入網頁 API](https://support.apple.com/zh-tw/guide/shortcuts/apda283236d7/ios) |

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

## English Source Audit Evidence — pending after source-level residuals

The current-byte dependency review found four material scope omissions in the
emoji picker’s visible category headings and navigation `title`/`aria-label`
values. Runtime category data places smileys in `people`, animals in `nature`,
drinks in `foods`, and geographic places in `places`; the bundled
`@emoji-mart/data` English localization names the same categories “Smileys &
People,” “Animals & Nature,” “Food & Drink,” and “Travel & Places.”
`F-en-043` through `F-en-046` record sentence-case source corrections. Because
all 68 localized dictionaries depend on these source meanings, evidence reset
rule 2 clears every reviewer, result, final status, and reviewed digest. The
following completed-pass evidence is historical until both full reviews are
repeated on the corrected final bytes.

The current first reviewer inspected all 539/539 English values against the
guidelines and their rendered, accessibility, or explicitly documented
source-only contexts. The numbered coverage partitions were 1–140, 141–280,
281–420, and 421–539: disjoint coverage totaling 539. This replay included
the migrated `toolNames.clearFormat` value and revalidated every historical
source-copy decision.

The current replay found six residual defects: the ambiguous table action,
the `Plain Text` capitalization outlier, the awkward full-screen command, the
calqued image-load error, and the two technical Markdown-preview labels.
`F-en-037` through `F-en-042` recorded all six as open before the dictionary
or fallbacks changed. Their six exact expectations then failed red, the
reviewed replacements were applied, and the affected table, code, image, and
file-preview surfaces were rechecked. The 764-case guideline suite, 152
code-tool cases under an explicit 20-second per-test ceiling, 190 affected
table/image/file cases, and the live 539-key structural, placeholder,
encoding, normalization, and 195-static-reference checker pass. The current
raw dictionary SHA-256 is
`3b04f0c6a90626b9e5baad6b73e4df875a78a65a40a7c8a27753dc1bb410fd65`.
English has no exact-English retention inventory by definition.

The distinct second reviewer independently reread all 539 current values in
source order, rechecked the 509 caller-consumed or built contracts, 29
source-only contracts, the localization-bypassed notifier contract, all 42
recorded source findings, all 38 placeholder-bearing values, and all 44 search
aliases. No additional source defect was found. The focused English search
alias and duplicate-key cases pass, the complete 946-case guideline contract
passes against these bytes, and the live checker again reports 539/539 keys
with intact placeholders, encoding, normalization, and static source coverage.
This second pass is bound to the same raw SHA-256 shown above.

The prior English pass inspected all 538 values in their rendered,
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
targets. Exhaustive caller tracing classified these 28 dictionary values as
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
- `tools.database.defaultStatusDone`,
  `tools.database.defaultStatusInProgress`,
  `tools.database.defaultStatusNotStarted`,
  `tools.database.defaultStatusProperty`,
  `tools.database.defaultTitleProperty`, `tools.database.defaultViewBoard`,
  `tools.database.emptyColumn`, and `tools.database.titlePlaceholder`.

Each was reviewed against its key contract and the equivalent feature or
hardcoded source context. During the locale audit, a red-first caller
regression exposed the database drawer’s literal English `Close` label.
The drawer now resolves `tools.database.close` through its live `I18n`
instance, with the English dictionary only as the no-instance fallback. This
moves that contract from source-only to caller-consumed without changing any
dictionary bytes or source semantics. The current exhaustive partition is
therefore 510 caller-consumed or retained built-compatibility contracts, 28
documented source-only contracts, and the one unused
`notifier.dismiss` contract whose dead dismiss-button helper still reads the
bundled English dictionary. Earlier 508/509 + 29 + 1 counts below are retained
as historical evidence for reviews performed before this wiring correction;
every current completion replay uses 510+28+1.

The W3C WAI
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

After the 539-key migration and all later residual corrections, the current
first reviewer repeated the complete 539-value review in English source order.
The current pass rechecked every `F-de-001` through `F-de-088` expectation,
all 42 changed-English dependencies, the 509 caller-consumed or built
contracts, 29 source-only contracts, the notifier bypass, all 38
placeholder-bearing values, all 44 aliases, and exactly the 25 supported
retentions `R-de-001` through `R-de-025`. The final residual changed the emoji
category heading from singular `Aktivität` to Microsoft’s established plural
`Aktivitäten`.

The live checker, its 79-case unit suite, the complete guideline,
search-quality, duplicate-key, and focused exact-retention suites pass.
Structural inspection found no key, type, placeholder, encoding,
normalization, control-character, or boundary-whitespace defect. This current
first pass binds to raw SHA-256
`ca1608fe3c635886bea5f3381d8918d34ab7d175e3b4a59c7830d0d155c6855c`.
A distinct second reviewer independently reread all 539 English/German pairs
on the same bytes and revalidated all 88 findings, all 25 retentions, all 42
changed-English dependencies, all 38 placeholder contracts, all 44 aliases
in 14 groups, all 29 source-only contracts, the 509+29+1 caller partition,
and the complete structural manifest without finding a residual. German is
therefore `second-pass-complete` on these exact bytes.

### Czech (`cs`) — pending after second-pass residuals

The current-byte reviewer read all 539 English/Czech pairs in source order,
including all 450 retained values, after the 89-value correction set recorded
as `F-cs-002` through `F-cs-090`. Together with the verified schema-migration
finding `F-cs-001`, all 90 Czech expectations match the current dictionary.
The review reconciled all 42 changed-English dependencies, all 38
placeholder-bearing contracts, all nine variable-count templates at 0, 1, 2,
5, and 21, all 44 unique search aliases across 14 groups, and all 117
registered provider compositions.

The exact-English inventory is exactly the 11 supported values recorded as
`R-cs-001` through `R-cs-011`: two shortcut notations, established `Video`,
`Audio`, and `Text` terms, the compact `Alt` label, three aspect ratios, and
the `URL` acronym. Caller reconciliation accounts for every contract: 510
caller-consumed or retained built-compatible values, 28 documented
source-only values, and the single unused `notifier.dismiss` value whose dead
helper still resolves bundled English. The newly live database-drawer close
button consumes `tools.database.close`; Czech `Zavřít` is correct in that
context.

The live checker reports 539 keys and exactly the 11 documented retentions.
The checker’s 81 cases, 1,923 focused guideline and caller cases, placeholder,
search, retention, integrity, and duplicate-key checks, and
`git diff --check` pass. The final-byte replay found no residual and binds the first
pass to raw SHA-256
`6ed35a87c7a9a99c00a0c533c798df5d4578cd95ba2e8cf695162520c1e10e83`.
Czech is therefore `first-pass-complete`; a distinct complete second review
remains required on these exact bytes.

That first-pass conclusion is now historical. The distinct second reviewer
reread all 539 bound pairs and found ten residuals, recorded as `F-cs-091`
through `F-cs-100`: two modifier tooltips omit the required click gesture,
two image-preview ARIA groups lose their controlled object or navigation
relationship, and six actionable audio/video alignment items expose only
states instead of commands. Reviewer and digest evidence is removed, all
three results are reset to `pending`, and both complete passes must be
repeated after remediation.

A subsequent clean source-order replay found 22 additional defects, recorded
as `F-cs-101` through `F-cs-122`, and reopened `F-cs-019` for the standard
Czech physical-key label `Esc`. The new set replaces literal English
click/drag/release constructions with natural Czech instrumental phrasing,
repairs two elliptical screen-reader boundary announcements, restores the
block object in failed copy-link feedback, and gives the four emoji categories
their complete runtime scope. The source-level emoji correction independently
resets all Czech pass evidence under rule 2; no reviewer or digest may be
recorded until both exhaustive passes repeat on the corrected final bytes.

### Danish (`da`) — current 539-key second pass complete

The current-byte first reviewer inspected and, after applying the closed
correction set, independently re-read 539/539 Danish values in source order
across all top-level namespaces and all 23 `tools.*` subnamespaces. The review
is bound to
`sha256:5e69377e6b7f3a4e1bfe316f4cc2dbc71add435ad5f080eac8597163d77876d2`.
Coverage included all 38 placeholder-bearing values, all 29 documented
source-only contracts, all 44 search aliases in their 14 duplicate-intent
groups, every exact-English match, and all 42 changed-English dependencies.
The current caller disposition is complete: 509 caller-consumed or retained
built-compatibility contracts, 29 documented source-only contracts, and the
single `notifier.dismiss` localization bypass.

All findings `F-da-001` through `F-da-076` are applied and exact, including
the count-neutral nested-content warning, Apple’s unhyphenated `Billede i
billede`, Microsoft’s `Ryd indhold` and plural `Aktiviteter`, and the
source-synchronized `Forhåndsvisning` tab. The dictionary contains exactly 28
supported exact-English values, all recorded as `R-da-001` through
`R-da-028` below. All 44 search aliases remain normalization-distinct.

Fresh post-edit validation found 539 Danish keys matching the 539 English
keys, with no missing, extra, or duplicate decoded keys and zero structural
integrity issues. Placeholder multisets match English for all 539 values;
string type, non-empty, normalization, encoding, control-character, and
boundary-whitespace checks also pass. The translation-guideline corpus passes
975/975; the focused exact-English retention test passes 1/1; all 79 checker
tests pass; and the live translation checker exits successfully.

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
[Microsoft's `Ryd indhold` command](https://support.microsoft.com/da-dk/office/arbejd-med-links-i-excel-7fc80d8d-68f9-482f-ab01-584c44d72b3e);
[Microsoft's plural `Aktiviteter` emoji category](https://support.microsoft.com/da-dk/teams/chat/send-an-emoji-gif-or-sticker-in-microsoft-teams);
and [Apple media terminology](https://support.apple.com/da-dk/guide/tv/atvb7944597f/26/tvos/26).
A distinct second reviewer independently reread all 539 English/Danish pairs
on the same bound bytes and revalidated all 76 findings, all 28 retentions,
all 38 placeholder contracts, all 44 aliases in 14 groups, all 42
changed-English dependencies, all 29 source-only contracts, the 509+29+1
caller partition, and the complete structural manifest without finding a
residual. Danish is therefore `second-pass-complete` on the bound 539-key
digest.

### Spanish (`es`) — current 539-key second pass complete

The current-byte first reviewer inspected and, after applying the closed
correction set, independently re-read 539/539 Spanish values in source order
across all eight top-level namespaces and every `tools.*` subnamespace. The
review is bound to
`sha256:435016766dd78f39b086cb3dd6dd33a929084557206ce8a8952f9221f22affc6`.
Coverage included all 38 placeholder-bearing values, all 29 documented
source-only contracts, all 44 search aliases in their 14 duplicate-intent
groups, every exact-English match, and all 42 changed-English dependencies.
The current caller disposition is complete: 509 caller-consumed or retained
built-compatibility contracts, 29 documented source-only contracts, and the
single `notifier.dismiss` localization bypass.

All findings `F-es-001` through `F-es-099` are applied and exact. A
second-review challenge exposed two residuals in the earlier bytes: the
screen-reader instruction now uses Spain Spanish `Intro` and `Esc`, and the
file-caption action retains its required definite article. The current-byte
review rechecked both corrections together with every unchanged value. The initial
dictionary had 26 exact-English values: 11 supported retentions and 15
defects. Those 15 defects are now localized, while approved `F-es-046`
changed `toolNames.marker` from `Resaltador` to `Color`, creating one newly
supported exact match. The final exact-English inventory is therefore exactly
12 values, recorded as `R-es-001` through `R-es-012` below. All 44 search
aliases are reviewed and normalization-distinct.

Fresh post-edit validation found 539 Spanish keys in the reviewed order, with
no missing, extra, or duplicate decoded keys. Placeholder multisets, string
type, non-empty, NFC, encoding, control-character, and boundary-whitespace
checks are clean. The translation-guideline suite passes 969/969; the
search-term-quality and duplicate-key suites pass 199/199; the focused
exact-English retention test passes 1/1; all 79 checker tests pass; and the
live translation checker exits successfully.

The selected register is informal Spain Spanish: `tú` imperatives for
instructions, infinitives for menu actions, and Spain terminology and
spelling such as `vídeo` and `añadir`. Terminology evidence includes
[Notion's Spain callout guidance](https://www.notion.com/es-es/help/customize-and-style-your-content?position=1)
for `Destacado`;
[Notion's Spain media guidance](https://www.notion.com/es-es/help/images-files-and-media)
for `leyenda`, media alignment, and `Reemplazar`;
[Notion's board guidance](https://www.notion.com/es-es/help/boards)
for `añadir`, `tablero`, and `estado`;
[Microsoft programming-language terminology](https://support.microsoft.com/es-ES/infopath/change-the-programming-language-of-a-form-template);
[Microsoft cell-alignment terminology](https://support.microsoft.com/es-es/office/alinear-texto-en-una-celda-en-excel-b2489a1f-6c89-45b7-9562-bbc287aa71ea);
[Microsoft's `Borrar contenido` command](https://support.microsoft.com/es-es/excel/clear-cells-of-contents-or-formats);
[Microsoft's plural `Actividades` emoji category](https://support.microsoft.com/es-es/office/enviar-un-emoji-o-un-gif-en-microsoft-teams-gratis-cfbfc796-de50-4c59-b116-9117e0b25b6b);
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
does not block this dictionary pass. A distinct second reviewer independently
reread all 539 current English/Spanish pairs on the same bound bytes. That
review revalidated `F-es-001` through `F-es-099`, the exact 12-value
`R-es-001` through `R-es-012` inventory, all 42 changed-English dependencies,
all 38 placeholder contracts, all 44 aliases in 14 groups, all 29 source-only
contracts, and the 509+29+1 caller partition without finding a residual. The
live checker, 1,712 locale-contract cases, the focused Spanish retention
case, 386 caller cases, and the checker’s 81-case suite pass. Spanish is
therefore `second-pass-complete` on the bound 539-key digest.

### French (`fr`) — current 539-key first pass complete

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

After the 539-key migration, the current-byte reviewer repeated the complete
539-value review in four disjoint source-order ranges. A later challenge
amended the count-unsafe nested-content warning and bookmark loading state and
closed six additional residuals: both color-swatch compositions, completed
hash navigation, the emoji activity category, the image-centered default
error, and the bookmark error resource. The reviewer then reread all 539
current English/French pairs and reconciled `F-fr-001` through `F-fr-131`,
all 42 changed-English dependencies, all 38 placeholder contracts, all 44
aliases in 14 groups, all 29 source-only contracts, and the 509+29+1 caller
partition. Multiple-block count templates were traced to guards that require
counts greater than one.

Before the emoji-category source reset, the exact-English inventory was the 23
supported retentions `R-fr-001` through `R-fr-023`. Structural inspection found 539 keys and no
missing, extra, duplicate, non-string, empty, placeholder, NFC, encoding,
control-character, replacement-character, or boundary-whitespace defect.
Finding, ledger-integrity, exact-retention, search-quality, duplicate-key, and
live-checker gates pass. The current first pass binds to raw SHA-256
`527c5314abd2dde23467557cb2afc91127d824eeed07ba67b44e2613534f6f12`.
A distinct second reviewer independently reread all 539 English/French pairs
on the same bytes and revalidated all 131 findings, all 23 retentions, all 42
dependencies, all 38 placeholder contracts and their count guards, all 44
aliases in 14 groups, all 29 source-only contracts, the 509+29+1 caller
partition, and the complete structural manifest without finding a residual.
French is therefore `second-pass-complete` on these exact bytes.

### Finnish (`fi`) — pending after second-pass residuals

The earlier current-byte reviewer inspected 539/539 Finnish values in source
order and then repeated the complete semantic inventory after its correction
set. That earlier review was bound to
`sha256:0ca6b959eedb97fe8ca1bed8ce75549cae9a5f299fb7f9f18463574443eebe71`.
It reconciled findings `F-fi-001` through `F-fi-077`, all 42
changed-English dependencies, all 38 placeholder-bearing templates, all 44
search aliases in their 14 duplicate-intent groups, all 29 documented
source-only contracts, and exactly the eight supported exact-English
retentions `R-fi-001` through `R-fi-008`. The caller disposition is complete:
509 caller-consumed or retained built-compatibility contracts, 29 source-only
contracts, and the single `notifier.dismiss` localization bypass.

The placeholder review found one cross-locale runtime defect rather than a
Finnish wording defect: the single-block duplication path passed `{position}`
to `a11y.blockDuplicated` but omitted required `{total}`, rendering a literal
`{total}` in every locale. A red-first four-block regression now requires
`{ position: 4, total: 4 }`, and the caller supplies the block count. The
independent post-fix matrix covers all 38 templates and 41 runtime contracts
with no remaining caller issue; the Finnish reproduction is
`Lohko kopioitu kohtaan 4/4`.

Structural inspection found 539 keys, exact placeholder multisets, and no key,
type, empty-string, duplicate-key, normalization, encoding,
control-character, or boundary-whitespace defect. The complete guideline
corpus passes 975/975; the combined `F-fi`/`F-en` cases pass 119/119; search
and duplicate-key suites pass 199/199; the focused Finnish retention case
passes; checker tests pass 79/79; DragA11y passes 21/21; relevant component
and tool caller suites pass 268 and 457 cases; and the independent 18-file
caller sweep passes 1,026 tests. Targeted lint and `git diff --check` are
clean, and independent code review found no Critical, Important, or Minor
issue. A distinct reviewer subsequently reread all 539 bound English/Finnish
pairs and found the 14 residual defects recorded as `F-fi-078` through
`F-fi-091`. Their 14 focused expectations failed red before the corrections
were applied. A new first reviewer then reread all 539 final pairs in four
disjoint source-order ranges and revalidated all 91 findings, all 42
dependencies, all 38 placeholder contracts, all 44 aliases in 14 groups, all
29 source-only contracts, the 509+29+1 partition, Finnish count grammar, and
the exact eight-value retention inventory without finding another residual.
The current first pass binds to raw SHA-256
`2691149c29ffd1fcff28d894a26b4766cc95c285d4d89937d501eb6aa8de1409`.
That first-pass conclusion is now historical. A distinct second reviewer read
all 539 bound pairs and found the six residuals `F-fi-092` through
`F-fi-097`: two grammatically incomplete boundary announcements, a search
alias that loses the plain-text concept, a card action menu mislabeled as
settings, an image-preview toolbar label that omits its object, and a seek
slider labeled as an imperative command. The stale reviewer and digest
evidence has been removed, all three results are reset to `pending`, and both
complete passes must be repeated after the open expectations are remediated.
A fresh current-byte replay after those six corrections then found
`F-fi-098`: the visible empty-toggle title is a bare adjective rather than
the registered Finnish tool name. The locale remains `pending`, with no
reviewer or digest evidence, until that correction is followed by two new
complete passes.

### Italian (`it`) — current 539-key first pass complete

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

After the 539-key migration, the current-byte reviewer reread all 539 values
in English source order and reconciled every caller and contract. The review
amended the video seek control to the precise `Posizione di riproduzione` and
closed five additional residuals: both color-swatch compositions, the
image-centered default error, the rendered `Anteprima` tab, and the
imperative paste-menu action `Menziona`. All `F-it-001` through `F-it-089`
expectations are now exact.

The current pass covers all 42 changed-English dependencies, all 38
placeholder-bearing values, all 44 aliases in 14 groups, all 29 source-only
contracts, the 509+29+1 caller partition, and exactly the 21 supported
retentions `R-it-001` through `R-it-021`. Structural inspection found 539
keys and no missing, extra, duplicate, type, empty-value, placeholder, NFC,
encoding, control-character, replacement-character, or boundary-whitespace
defect. Finding, ledger-integrity, exact-retention, search-quality,
duplicate-key, caller, and live-checker gates pass. The current first pass
binds to raw SHA-256
`8bdfda0775d97740d4810572718bae8ad69008f4df12b95553b5c19edd66b668`.
The distinct second reviewer independently reread all 539 English/Italian
pairs on those exact bytes and reconciled every `F-it-001` through
`F-it-089` correction, all 21 retentions, 42 changed-English dependencies,
38 placeholder contracts, 44 aliases in 14 groups, 29 source-only values,
and the complete 509+29+1 caller partition. The reviewer also checked every
count-bearing template against its reachable plural guard: plural forms are
used only above one, and singular-reachable forms remain count-neutral.
Structure is clean across all 539 keys and 23 tool namespaces, with no
duplicate, placeholder, NFC, encoding, control-character,
replacement-character, or boundary-whitespace defect. The locale/ledger,
search, quote, video, caller, retention, and live-checker gates pass with no
residual finding. Both reviews bind to raw SHA-256
`8bdfda0775d97740d4810572718bae8ad69008f4df12b95553b5c19edd66b668`;
Italian is therefore `second-pass-complete`.

### Dutch (`nl`) — current 539-key second pass complete

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

The preceding paragraphs preserve the historical 538-key defect evidence.
After the 539-key migration, the first reviewer applied and rechecked
`F-nl-001` through `F-nl-085`, then reread all 539 current values without a
residual finding. Coverage is 509 caller-consumed or built contracts, 29
documented source-only contracts, and the one localized value whose notifier
caller still bypasses the active dictionary. All 38 placeholder-bearing
values, all 44 search aliases, and all 42 changed-English dependencies pass.
The exact-English inventory is exactly the 22 supported retentions
`R-nl-001` through `R-nl-022`.

A distinct second reviewer independently repeated the complete 539-value
review, rechecked every finding and source dependency, and approved the same
22 retentions with no residual. Structural, finding, ledger-integrity,
search-quality, duplicate-key, consumer, and live 539-key checker suites all
pass. Both passes bind to raw SHA-256
`9eda880443a99fb3162cb98edcb99d8993c73864e85f0e754827af6e4c263223`;
the Dutch row is therefore `second-pass-complete`.

### Norwegian (`no`) — pending after second-pass residual

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

The preceding paragraphs preserve the historical 538-key defect evidence.
After the 539-key migration and the later residual corrections, the fresh
first reviewer reread all 539 current values and approved
`F-no-001` through `F-no-080`. A second-review challenge exposed and closed
three residuals: the count-unsafe pronoun in the nested-content warning, the
indefinite focused-block announcement, and the singular emoji category
heading. The current-byte pass rechecked those corrections together with
every unchanged value. Coverage is 509 caller-consumed or built
contracts, 29 documented source-only contracts, and the one localized value
whose notifier caller still bypasses the active dictionary. All 38
placeholder-bearing values, all 44 search aliases, and all 42 changed-English
dependencies pass. The exact-English inventory is exactly the 16 supported
retentions `R-no-001` through `R-no-016`.

Finding, structural, ledger-integrity, exact-retention, search-quality,
duplicate-key, paste-menu caller, and live 539-key checker suites pass. The
first pass binds to raw SHA-256
`d08881a82c9e3fd0bf81e38a92add5cdf667c3ec2edc424453dca86a3a6a3033`.
Norwegian is therefore `first-pass-complete`; a distinct complete second
review was performed on those exact bytes, but found `F-no-081`: the image
preview toolbar’s accessible name omits the image object. The prior conclusion
is historical; reviewer and digest evidence is removed, all three results are
reset to `pending`, and both complete passes must be repeated after
remediation. Historical `509+29+1` counts above predate the live localized
database close button; the current partition is `510+28+1`.

### Polish (`pl`) — pending after second-pass residuals

The first reviewer read all 539 English/Polish pairs in source order, traced
ambiguous values to their rendered, accessibility, built-compatibility, or
documented source-only contracts, and recorded 114 current defects in
addition to the verified schema-migration finding. `F-pl-002` through
`F-pl-115` cover count-unsafe templates, incomplete shortcut and drag
instructions, literal table-alignment calques, untranslated equation and
media strings, inaccurate toggle and read-only labels, inaccessible media
controls, provider-template grammar, stale database terminology, and other
semantic, grammatical, punctuation, or register defects. The focused
red-first run failed exactly those 114 expectations before the dictionary
changed and now passes all 115 Polish finding cases including
`F-pl-001`.

After applying the correction set, the reviewer independently reread all 539
current pairs in four disjoint source-order ranges (1–140, 141–280, 281–420,
and 421–539). That replay revalidated every corrected and unchanged value,
all 42 changed-English dependencies, all 38 placeholder-bearing contracts
and Polish count behavior, and all 44 search aliases across their 14
duplicate-intent groups. Caller reconciliation accounts for all 539
contracts: 510 caller-consumed or retained built-compatibility values, 28
documented source-only values, and the single unused `notifier.dismiss`
value whose current caller bypasses the active dictionary.

The exact-English inventory is exactly the 15 supported retentions
`R-pl-001` through `R-pl-015`: two platform shortcuts, the compact `Alt`
control, three aspect-ratio notations, the `URL` acronym, and established
Polish `Link`, `Audio`, and `Status` product terms. Structural inspection
found 539 keys and no missing, extra, duplicate, non-string, empty,
placeholder, NFC, encoding, control-character, replacement-character, or
boundary-whitespace defect. Finding, exact-retention, structural, and live
checker gates pass. The first pass binds to raw SHA-256
`8033f23c03f2a0f0ebe6d355aac0cecdc641a00018aa6d4d42c74bd67c6d7956`.
That first-pass conclusion is now historical. A distinct second reviewer read
all 539 bound pairs and found eight residuals: the reopened `F-pl-033` plus
`F-pl-116` through `F-pl-122`. They cover one misleading divider alias, an
incomplete emoji category, an inconsistent upload heading, two imperative
loop-state labels, two unnatural cloud-storage error constructions, and an
elliptical screen-reader instruction. The stale reviewer and digest evidence
has been removed, all three results are reset to `pending`, and both complete
passes must be repeated after remediation.

The subsequent final-byte replay found one remaining count-dependent pronoun
in `F-pl-002`, one shared single/multiple-drag announcement, and three
source-expanded emoji categories. They are recorded as the amended
`F-pl-002` and `F-pl-123` through `F-pl-126`. The English category-source
change independently keeps every Polish result and reviewer pending.

### Brazilian Portuguese (`pt`) — current 539-key first pass complete

The current-byte reviewer reread all 539 English/Brazilian-Portuguese pairs
in four explicit disjoint source-order ranges (1–140, 141–280, 281–420, and
421–539). The pass covered every visible, accessibility,
built-compatibility, and documented source-only contract. It closed 78
current semantic, grammar, terminology, accessibility, punctuation, or
pending-English defects in addition to the verified schema-migration finding.
`F-pt-001` through `F-pt-079` now match the dictionary exactly. The focused
red-first run failed exactly the 78 new expectations before their values
changed, then the complete guideline corpus passed.

Caller reconciliation rederived the complete 539-contract partition: 510
caller-consumed or retained built-compatible values, all 28 documented
source-only values, and the one unused `notifier.dismiss` value whose
caller still bypasses the active dictionary. All 42 changed-English
dependencies were reconciled: 33 required Portuguese corrections and nine
retain reviewed wording. All 38 placeholder-bearing values preserve their
names and multiplicities. The nine count-bearing contracts were checked at
their actual one-versus-many branches; every variable-count value uses
count-neutral grammar. All 44 aliases remain useful, lowercase, present, and
normalization-distinct in their 14 caller groups.

The final exact-English inventory is exactly 18 supported values, recorded as
`R-pt-001` through `R-pt-018`: two platform shortcuts, three aspect ratios,
the `Alt` and `URL` abbreviations, established `Link`, `layout`, `Oval`,
`Status`, and `Volume` uses. Supporting terminology comes from
[Apple’s Brazilian shortcut guidance](https://support.apple.com/pt-br/102650),
[Microsoft’s Windows shortcuts](https://support.microsoft.com/pt-br/windows/atalhos-de-teclado-no-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec),
[Notion’s media guidance](https://www.notion.com/pt/help/images-files-and-media),
[Notion’s database-property guidance](https://www.notion.com/pt/help/database-properties),
[Adobe’s layout terminology](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html),
and [Google’s media accessibility guidance](https://support.google.com/drive/answer/12169158?hl=pt-BR).

The selected register is neutral contemporary Brazilian Portuguese: implicit
`você` in direct imperatives and complete instructions, concise infinitive
action labels, sentence case, and established Brazilian product and
accessibility terms. The final-byte replay found zero residuals. The live
checker, all 79 original Portuguese finding cases, the exact-retention guard, the
130-case search-quality suite, placeholder and integrity gates, and
`git diff --check` pass. The first pass binds to raw SHA-256
`99a2bb5f2d7a7d95f0104cdeeecbd29c8f4eef29162ca57792493a29873c32d6`.
A distinct second reviewer reread all 539 values on those bytes and exposed
the six residual semantic and context defects recorded as `F-pt-080` through
`F-pt-085`. Their focused expectations failed red before all six corrections
were applied and passed afterward. The stale digest and reviewer evidence
were removed and both reviews were reset.

Following that strict reset, a fresh first reviewer reread all 539 corrected
English/Brazilian-Portuguese pairs in four disjoint source-order ranges
(1–140, 141–280, 281–420, and 421–539). The replay revalidated all 85
findings, every unchanged value, all 42 changed-English dependencies, all 38
placeholder contracts and their count behavior, all 44 aliases across 14
groups, all 28 source-only contracts, the 510+28+1 caller partition, and
exactly the 18 documented retentions `R-pt-001` through `R-pt-018`. It found
no further semantic, grammatical, terminology, register, punctuation,
accessibility, or context defect. The current first pass binds to raw
SHA-256
`21e40fd19ff448456d40d3f0eb26bb93d780f085c08dd5b34168c5a4a838f8e1`.
The distinct second reviewer independently reread all 539 values on the same
bytes and revalidated all 85 findings, 42 dependencies, 38 placeholder
contracts and reachable count branches, 44 aliases in 14 groups, 18 exact
retentions, 117 provider registrations, and the `510+28+1` caller partition.
It found no dictionary residual. The review did expose a cross-locale caller
defect: `a11y.navigationPosition` interpolated raw `block.name`, producing
`paragraph, 1 de 3` instead of `Texto, 1 de 3`. A red-first BlockSelection
regression now requires the localized active toolbox title, and the caller
resolves it through `getActiveToolboxEntry()` and `translateToolTitle()`.
Brazilian Portuguese is therefore `second-pass-complete` on these exact
dictionary bytes.

### Swedish (`sv`) — pending after second-pass residual

The first reviewer reread all 539 current Swedish values in six disjoint
source-order ranges after the final correction batch. A second-review
challenge then exposed the subjectless finite verb in
`a11y.navigatedToBlock`; the corrected resultative announcement and every
unchanged value were rechecked on the current bytes. The review reconciled
all `F-sv-001` through `F-sv-083` expectations, all 42 changed-English
dependencies, all 38 placeholder-bearing values, all 44 search aliases across
14 registered groups, and the exact 17 supported English retentions
`R-sv-001` through `R-sv-017`.

Caller tracing accounts for all 539 contracts: 509 are caller-consumed or
built, 29 are documented source-only values, and `notifier.dismiss` is the
single localized value whose current notifier caller bypasses the active
dictionary. A separate caller/dependency cross-check independently reconciled
that partition, every finding, every dependency, every placeholder, every
alias, and every retention without finding a residual.

The live checker, its 79-case unit suite, the guideline, duplicate-key, search,
exact-retention, and caller-focused suites all pass. Structural inspection
found no missing, extra, duplicate, empty, non-string, non-NFC, replacement,
control-character, or boundary-whitespace defect. The first pass binds to raw
SHA-256
`5ad6c69ea09192087498df91d9d26b1fb13915ede46622076970875226cf16af`.
Swedish was therefore marked `first-pass-complete`; a distinct complete
second review on those exact bytes found `F-sv-084`: the shortcut tooltip
composition omitted the verb required before the raw key combination. During
the required current-byte replay, the reviewer then found `F-sv-085` through
`F-sv-087`: a literal density-label calque, an image-preview toolbar name that
omits its image object, and an emoji category that omits places. The prior
conclusion is historical; reviewer and digest evidence remains removed, all
three results remain `pending`, and both complete passes must be repeated
after remediation. The current caller partition is 510 caller-consumed or
built contracts, 28 documented source-only contracts, and the one
`notifier.dismiss` bypass.

After correcting those four residuals, a fresh reviewer restarted from entry
1 and reread all 539 current English/Swedish pairs in three disjoint
source-order ranges (1–180, 181–360, and 361–539). The replay revalidated all
87 findings, all 42 changed-English dependencies, all 38 placeholder
contracts and their reachable count behavior, all 44 distinct aliases in 14
registered groups, all 28 source-only contracts, all 117 provider
compositions, the complete `510+28+1` caller partition, and exactly the 17
documented exact-English retentions `R-sv-001` through `R-sv-017`. No further
semantic, grammatical, terminology, register, punctuation, accessibility, or
context defect remained. The 1516-case guideline suite, 130-case
search-quality suite, exact-retention checks, 81-case checker suite, and live
539-key checker pass. The fresh first pass binds to raw SHA-256
`a3566610fc0beb4f30bd8401ba06b42503dffe33f09c2490d4ab37097f22e468`;
Swedish is `first-pass-complete` and still requires a distinct second pass on
these exact bytes.

That conclusion is now historical. The halted second review found four
additional Swedish residuals (`F-sv-088` through `F-sv-091`) in full
alternative-text labels, the free-form crop option, and provider-composed
video embedding. The expanded English category source adds three more
required Swedish corrections as `F-sv-092` through `F-sv-094`; the
travel-and-places value was already complete. All reviewer and digest evidence
remains reset.

### Russian (`ru`) — current 539-key first pass complete

The first reviewer inspected all 539 Russian values against the current
English source, their rendered, accessibility, built-compatibility, or
documented source-only contracts. After the correction batch, the reviewer
independently reread all 539 current EN/RU pairs in four source-order
partitions (1–140, 141–280, 281–420, and 421–539), including every unchanged
value. No residual semantic, grammar, terminology, register, punctuation, or
accessibility defect remained.

`F-ru-002` through `F-ru-120` recorded 119 corrections in addition to the
previously verified 539-key migration finding `F-ru-001`. The red-first
guideline run failed exactly those 119 expectations and no other case before
the dictionary changed. The final dictionary differs from its pre-audit bytes
at exactly 119 keys. All 42 changed-English dependencies have an explicit
current disposition: 25 required correction and 17 retained their reviewed
Russian wording. All 38 placeholder-bearing templates preserve their exact
placeholder multisets.

All 44 search aliases were reread in the 14 registered `searchTermKeys`
groups. Their normalized Russian values are lowercase, the 44-key union is
complete, and no group contains a duplicate alias. The exact-English inventory
is exactly seven values, documented as `R-ru-001` through `R-ru-007`: two
platform shortcuts, the compact `Alt` control, three aspect-ratio notations,
and the `URL` acronym.

Caller reconciliation accounts for all 539 contracts: 509 are caller-consumed
or retained built-compatibility values, 29 are documented source-only values,
and `notifier.dismiss` is the single localized value whose built-in notifier
still reads the bundled English dictionary instead of the active locale. The
29 source-only values were individually reread; the nested-content warning,
plain-text label, and video-caption toggle required corrections, while the
other 26 retain their reviewed current wording.

The Russian tooltip composition exposed one legitimate structural edge case:
`blockSettings.openMenuAction` must begin with `, чтобы…` so both
`Нажмите, чтобы…` and `Нажмите или используйте Ctrl+/, чтобы…` are
grammatical. The integrity checker now admits a localized Unicode
punctuation-plus-space prefix only when the English source fragment begins
with whitespace and all other boundary whitespace remains aligned. A
red-first positive case and a punctuation-without-space negative case lock
that narrow rule while the pre-existing accidental-whitespace case remains
red.

Guideline, structural, ledger-integrity, exact-retention, search-quality,
duplicate-key, live 539-key checker, and the checker’s 81-case unit suites
pass. The first pass binds to raw SHA-256
`85346859ecb32511fdd877786f50e2fc0e462880cdb044f9dfa98001d5cd0eb8`.
That first-pass conclusion is now historical. The second reviewer reread all
539 bound pairs and reopened `F-ru-112`: the navigation-mode announcement
spelled out `Escape` where current Russian platform interfaces label the
physical key `Esc`. A fresh replay after that correction then reopened
`F-ru-118` for its ungrammatical time-display action and added `F-ru-121` for
the incomplete travel-and-places emoji category. The stale reviewer and
digest evidence remains removed, all three results remain `pending`, and both
complete passes must be repeated after remediation.

A fresh reviewer then restarted on the corrected bytes and independently
reread all 539 English/Russian pairs twice in source order. The replay found
no residual and revalidated all 121 findings, all 42 changed-English
dependencies with the current 26-corrected/16-retained disposition, all 38
placeholder contracts and count branches, all 44 distinct aliases in 14
groups, all 28 source-only contracts, all 117 provider compositions, the
complete `510+28+1` caller partition, and exactly the seven approved
retentions `R-ru-001` through `R-ru-007`. The live checker, 81 checker tests,
121 focused finding cases, exact-retention checks, search suite, and full
guideline suite pass. This fresh first pass binds to raw SHA-256
`752a2470228fc4841c76a54137d52fbe36d023dc4ff8b07dedd47e06993b349e`;
Russian is `first-pass-complete` and still requires a distinct second pass on
these exact bytes.

That conclusion is now historical. Before the source reset, the halted second
review found two metadata-label residuals (`F-ru-122` and `F-ru-123`).
The expanded English category source adds the three incomplete Russian
category labels as `F-ru-124` through `F-ru-126`; the existing
travel-and-places label remains complete. All results, reviewers, and digest
evidence remain reset.

### Simplified Chinese (`zh`) — current 539-key second pass complete

After the composed-tooltip comparison invalidated the initial evidence, the
first reviewer performed a strict reset and reread all 539 current
English/Simplified-Chinese pairs in four disjoint source-order ranges (1–135,
136–270, 271–405, and 406–539). The replay covered every visible,
accessibility, built-compatibility, and documented source-only contract,
including all 42 changed-English dependencies. Across the replay rounds it
found and closed 57 current
defects in addition to the verified schema-migration finding: shortcut hints
that omitted the click gesture; two fragments whose caller composition was
ungrammatical; incomplete action, alignment, and accessible labels; a
prospective drop announcement that incorrectly described completed movement;
implementation-flavored nested-block wording; unnatural attribution and
spoken-time wording; source-sync defects; punctuation outliers; and the
remaining English fallbacks in equation, image, file, video, audio-metadata,
and cover-art surfaces. `F-zh-001` through `F-zh-058` now match the current
dictionary exactly.

Caller reconciliation uses the established 539-contract partition: 509
caller-consumed or built-compatible values, 29 documented source-only values,
and the one localized notifier value whose caller still bypasses the active
dictionary. The pass separately reread all 38 placeholder-bearing values and
preserves every placeholder name and occurrence count. All 44 search aliases
were reviewed in their 14 registered tool groups; their Simplified Chinese
wording remains useful in the target tool context and no group contains a
normalized duplicate.

The final exact-English inventory is exactly six supported values:
two platform shortcuts, three aspect-ratio notations, and the `URL` acronym,
recorded as `R-zh-001` through `R-zh-006`. Apple’s
[Simplified Chinese shortcut guidance](https://support.apple.com/zh-cn/102650),
[camera aspect-ratio guidance](https://support.apple.com/zh-cn/guide/iphone/iph3dc593597/ios),
Microsoft’s
[Windows shortcut guidance](https://support.microsoft.com/zh-cn/windows/windows-%E7%9A%84%E9%94%AE%E7%9B%98%E5%BF%AB%E6%8D%B7%E6%96%B9%E5%BC%8F-dcc61a57-8ff0-cffe-9796-cb9706c75eec),
and MDN’s [Simplified Chinese URL reference](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_URL)
support those retentions.

The initial red-first run failed exactly 46 expectations. The comparison
round then failed exactly two newly recorded composed-fragment expectations,
and the strict-reset replay failed exactly two residual expectations before
each corresponding dictionary change. A distinct review later exposed seven
residuals in the earlier bytes; their seven expectations failed red before
`F-zh-052` through `F-zh-058` were applied. The first reviewer then reread all
539 final English/Simplified-Chinese pairs in the four documented source-order
ranges without finding another defect. The current guideline, live checker,
placeholder, UTF-8, NFC, source-coverage, boundary-whitespace,
exact-retention, duplicate-key, and search-quality gates pass. The current
first pass binds to raw SHA-256
`55af042f145b5a8130cd90a645b4667434807a7eaa008f2ed296f8634ffc45c8`.
A distinct second reviewer then independently reread all 539 final-byte
English/Simplified-Chinese pairs in source order, revalidated every finding,
retention, placeholder, alias, source-only contract, and caller disposition,
and found no residual semantic, grammar, register, accessibility, punctuation,
or structural defect. Simplified Chinese is therefore
`second-pass-complete` on these exact bytes.

### Taiwan Traditional Chinese (`zh-TW`) — current 539-key second pass complete

The first reviewer inspected all 539 current English/Taiwan-Traditional-
Chinese pairs in four disjoint source-order ranges (1–135, 136–270, 271–405,
and 406–539). The review covered every visible, accessibility,
built-compatibility, and documented source-only contract, including all 42
changed-English dependencies. Across the replay rounds it found and closed 31
current defects in
addition to the verified schema-migration finding: two ungrammatical composed
tooltip fragments; incomplete action, table, icon, search, and accessible
labels; ambiguous image and media errors; stale source meanings; handle-role
and swatch-template terminology; a read-only
embed instruction that could not be performed; and playback controls whose
wording did not identify their actual state or target. `F-zh-TW-001` through
`F-zh-TW-032` now match the current dictionary exactly.

Caller reconciliation uses the established 539-contract partition: 509
caller-consumed or built-compatible values, 29 documented source-only values,
and the one localized notifier value whose caller still bypasses the active
dictionary. The pass separately reread all 38 placeholder-bearing values and
preserves every placeholder name and occurrence count. All 44 search aliases
were reviewed in their 14 registered tool groups; their Taiwan wording remains
useful in the target tool context and no group contains a normalized
duplicate. The Taiwan-specific regression suite also passes all eight
structure, placeholder, terminology, script, and distinct-localization cases.

The final exact-English inventory is exactly six supported values: two
platform shortcuts, three aspect-ratio notations, and the `URL` acronym,
recorded as `R-zh-TW-001` through `R-zh-TW-006`. Apple’s Taiwan
[shortcut guidance](https://support.apple.com/zh-tw/102650),
[camera aspect-ratio guidance](https://support.apple.com/zh-tw/guide/iphone/iph3dc593597/ios),
and [Shortcuts URL guidance](https://support.apple.com/zh-tw/guide/shortcuts/apda283236d7/ios),
plus Microsoft’s Taiwan
[keyboard guidance](https://support.microsoft.com/zh-TW/Windows/Hardware/Input-Devices/windows-keyboard-tips-and-tricks),
support those retentions.

The focused red-first guideline run failed exactly the initial 28 newly
recorded expectations before the dictionary changed. A distinct review later
exposed three residuals in the earlier bytes; their three expectations failed
red before `F-zh-TW-030` through `F-zh-TW-032` were applied. The first
reviewer then reread all 539 final English/Taiwan-Traditional-Chinese pairs in
the four documented source-order ranges without finding another defect. The
current guideline, live checker, placeholder, UTF-8, NFC, source-coverage,
boundary-whitespace, exact-retention, duplicate-key, search-quality, and
Taiwan-specific gates pass. The current first pass binds to raw SHA-256
`324a7c1224b322cc685ecf531c718b7f702088d31a0209caece734b755139d77`.
A distinct second reviewer then independently reread all 539 final-byte
English/Taiwan-Traditional-Chinese pairs in source order, separately from the
Simplified Chinese pass, and revalidated every finding, retention,
Taiwan-script choice, placeholder, alias, source-only contract, and caller
disposition without finding a residual. Taiwan Traditional Chinese is
therefore `second-pass-complete` on these exact bytes.

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
| `F-en-037` | `en` | `tools.table.clearSelection` | context / action accuracy | `"Clear"` | `"Clear contents"` | Both callers clear selected cell, row, or column contents while preserving the cells and their formatting; deletion is a separate action. Microsoft Excel uses the exact [Clear Contents](https://support.microsoft.com/en-US/Excel/clear-cells-of-contents-or-formats) command for that operation. | verified |
| `F-en-038` | `en` | `tools.code.plainText` | capitalization | `"Plain Text"` | `"Plain text"` | The generic format name is not a proper noun and must follow the audit’s resolved sentence-case register; Microsoft’s English UI uses [Plain text](https://support.microsoft.com/en-us/edge/improved-copy-and-paste-of-urls-in-microsoft-edge). The source-only dictionary contract and hardcoded language-list label must remain aligned. | verified |
| `F-en-039` | `en` | `tools.image.viewFullscreen` | grammar / UI terminology | `"View fullscreen"` | `"View full screen"` | The visible menu item and overlay accessible name open a full-viewport image lightbox. “Full screen” is the natural noun phrase after “View” and matches Apple’s English [View full screen](https://support.apple.com/en-bh/guide/dvd-player/dvdp7a064d1e/mac) command. | verified |
| `F-en-040` | `en` | `tools.image.errorDefaultMessage` | natural error copy | `"The URL returned an error. Try a different source or re-upload the file."` | `"The image couldn’t be loaded from this URL. Try a different source or upload the file again."` | A URL does not itself “return” an error. The replacement describes the failed image load directly and replaces the awkward “re-upload” construction with a natural recovery instruction. | verified |
| `F-en-041` | `en` | `tools.file.previewRaw` | jargon / context | `"Raw"` | `"Source"` | This Markdown-preview tab shows the file’s source text. “Raw” is unnecessary technical jargon and does not name the content as clearly as “Source.” | verified |
| `F-en-042` | `en` | `tools.file.previewRender` | jargon / context | `"Rendered"` | `"Preview"` | This Markdown-preview tab shows the formatted visual preview. “Rendered” exposes an implementation term; “Preview” is the familiar user-facing state and pairs clearly with “Source.” | verified |
| `F-en-043` | `en` | `tools.callout.emojiCategoryPeople` | category scope / accessibility | `"People"` | `"Smileys & people"` | The label is rendered as a visible heading and navigation accessible name for 529 entries that begin with facial-expression emoji and also contain people; the bundled picker localization names both halves. | verified |
| `F-en-044` | `en` | `tools.callout.emojiCategoryNature` | category scope / accessibility | `"Nature"` | `"Animals & nature"` | The label is rendered as a visible heading and navigation accessible name for 152 entries that begin with animals and also contain plants; the old label omits the dominant animal scope. | verified |
| `F-en-045` | `en` | `tools.callout.emojiCategoryFood` | category scope / accessibility | `"Food"` | `"Food & drink"` | The category contains both food and beverage emoji, and the label is exposed visually and to assistive technology; the bundled picker localization names both scopes. | verified |
| `F-en-046` | `en` | `tools.callout.emojiCategoryTravel` | category scope / accessibility | `"Travel"` | `"Travel & places"` | The category contains geography and buildings as well as transport and travel emoji, and its visible and accessible label must name both scopes. | verified |
| `F-de-001` | `de` | `blockSettings.dragToMove` | naturalness | `"Ziehen zum Verschieben"` | `"Zum Verschieben ziehen"` | First line of the settings-toggler tooltip needs natural German infinitive word order. | verified |
| `F-de-002` | `de` | `blockSettings.clickToOpenMenu` | naturalness / accessibility | `"Klicken zum Öffnen des Menüs"` | `"Zum Öffnen des Menüs klicken"` | Standalone settings-toggler accessible name is stilted in the old word order. | verified |
| `F-de-003` | `de` | `blockSettings.convertWithChildrenWarning` | number / terminology / source synchronization | `"Dieser Block enthält {count} verschachtelte Blöcke. Durch die Konvertierung werden sie auf die oberste Ebene verschoben. Möchten Sie fortfahren?"` | `"Verschachtelte Blöcke: {count}. Beim Umwandeln dieses Blocks wird jeder verschachtelte Block auf die oberste Ebene verschoben. Fortfahren?"` | Source-only warning must work for one or many and avoid needlessly technical `Konvertierung`; the first correction retained plural `sie werden`, which is unsuitable when `{count}=1`. | verified |
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
| `F-de-043` | `de` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"Die URL hat einen Fehler zurückgegeben. Versuchen Sie eine andere Quelle oder laden Sie die Datei erneut hoch."` | `"Das Bild konnte über diese URL nicht geladen werden. Versuchen Sie es mit einer anderen Quelle oder laden Sie die Datei erneut hoch."` | The image error body must identify the failed image load rather than an abstract URL-loading error, while retaining both recovery actions from the corrected source. | verified |
| `F-de-044` | `de` | `tools.image.emptyOrDropHere` | grammar | `"oder Bild hier ablegen"` | `"oder ein Bild hier ablegen"` | Visible image empty-state instruction lacked an article. | verified |
| `F-de-045` | `de` | `tools.file.emptyDropHint` | grammar | `"oder Datei hier ablegen"` | `"oder eine Datei hier ablegen"` | Visible file empty-state instruction lacked an article. | verified |
| `F-de-046` | `de` | `tools.file.errorFileTooLarge` | pending translation | `"File is too large. {size} exceeds the {max} limit."` | `"Die Datei ist zu groß. {size} überschreitet die Höchstgrenze von {max}."` | File upload size error retained an English fallback; placeholders remain exact. | verified |
| `F-de-047` | `de` | `tools.file.previewRaw` | context | `"Original"` | `"Quelltext"` | Markdown preview tab shows source text, not an original file. | verified |
| `F-de-048` | `de` | `tools.file.previewRender` | terminology / source synchronization | `"Gerendert"` | `"Vorschau"` | The corrected source names the rendered Preview tab; Microsoft’s German product UI uses the familiar label [Vorschau](https://support.microsoft.com/de-de/office/f%C3%BCr-die-vorschau-von-dateien-in-onedrive-sharepoint-und-teams-unterst%C3%BCtzte-dateitypen-e054cd0f-8ef2-4ccb-937e-26e37419c5e4). | verified |
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
| `F-da-016` | `da` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Denne blok indeholder {count} indlejrede blokke. Konvertering vil flytte dem til øverste niveau. Vil du fortsætte?"` | `"Indlejrede blokke: {count}. Hvis blokken konverteres, flyttes det indlejrede indhold til øverste niveau. Fortsæt?"` | The first correction retained plural `de`, which is ungrammatical when `{count}=1`; count-neutral `det indlejrede indhold` follows [Den Danske Ordbog](https://ordnet.dk/ddo/ordbog/indhold) and the corrected source contract. | verified |
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
| `F-da-047` | `da` | `tools.file.previewRender` | context / source synchronization | `"Formateret"` | `"Forhåndsvisning"` | The tab shows the rendered visual preview; `Formateret` describes a property rather than the familiar preview state now named by the source. | verified |
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
| `F-da-069` | `da` | `tools.video.pip` | established product terminology | `"Billede-i-billede"` | `"Billede i billede"` | Apple’s Danish [Apple TV](https://support.apple.com/da-dk/guide/tv/atvb7944597f/26/tvos/26) and [iPhone](https://support.apple.com/da-dk/guide/iphone/iphcc3587b5d/ios) interfaces use the unhyphenated feature name. | verified |
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
| `F-es-016` | `es` | `blockSettings.convertWithChildrenWarning` | number / terminology / source synchronization | `"Bloques anidados: {count}. Al convertir este bloque, se moverán al nivel superior. ¿Quieres continuar?"` | `"Bloques anidados: {count}. Al convertir este bloque, el contenido anidado se moverá al nivel superior. ¿Quieres continuar?"` | The first correction retained a plural implicit subject that is awkward when `{count}=1`; `el contenido anidado` preserves the move-to-top-level semantics without number-dependent agreement. | verified |
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
| `F-fr-004` | `fr` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Ce bloc contient {count} blocs imbriqués. La conversion les déplacera au niveau supérieur. Continuer ?"` | `"Blocs imbriqués : {count}. La conversion de ce bloc déplacera le contenu imbriqué au niveau supérieur. Continuer ?"` | Source-only warning must remain grammatical for both one and many nested blocks; count-neutral `le contenu imbriqué` avoids the plural pronoun `les` when `{count}` is one. | verified |
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
| `F-fr-079` | `fr` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Chargement de l’aperçu"` | `"Chargement de l’aperçu du lien…"` | The rendered in-progress state needs U+2026 and must preserve the corrected source’s link-preview resource context. | verified |
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
| `F-it-066` | `it` | `tools.video.seek` | accessibility / terminology | `"Scorri"` | `"Posizione di riproduzione"` | The accessible range input controls the current playback position, not page scrolling or a generic progress indicator; Google Drive’s Italian screen-reader guidance uses `posizione di riproduzione`. | verified |
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
| `F-nl-001` | `nl` | `blockSettings.clickToOpenMenu` | grammar | `"Klik om menu te openen"` | `"Klik om het menu te openen"` | The definite article is required in natural Dutch. | verified |
| `F-nl-002` | `nl` | `blockSettings.openMenuAction` | grammar / source synchronization | `" om menu te openen"` | `" om het menu te openen"` | The composed fragment requires the definite article; preserve its leading space. | verified |
| `F-nl-003` | `nl` | `blockSettings.convertWithChildrenWarning` | number / terminology / source synchronization | `"Dit blok bevat {count} geneste blokken. Door het te converteren worden ze naar het hoogste niveau verplaatst. Wil je doorgaan?"` | `"Geneste blokken: {count}. Door dit blok om te zetten, worden ze naar het hoogste niveau verplaatst. Doorgaan?"` | Uses a count-neutral label, avoids the needless calque converteren, and follows the corrected source-only contract. | verified |
| `F-nl-004` | `nl` | `toolbox.optionAddAbove` | shortcut / action clarity | `"⌥ — erboven invoegen"` | `"⌥-klik om erboven in te voegen"` | The current tooltip omits the required click gesture. | verified |
| `F-nl-005` | `nl` | `toolbox.ctrlAddAbove` | shortcut / action clarity | `"Ctrl — erboven invoegen"` | `"Ctrl-klik om erboven in te voegen"` | The current tooltip omits the required click gesture. | verified |
| `F-nl-006` | `nl` | `tools.marker.textColor` | terminology | `"Tekst"` | `"Tekstkleur"` | The mode selects text color, not text generally. | verified |
| `F-nl-007` | `nl` | `tools.paragraph.placeholder` | hint clarity | `"Schrijf iets of druk op / om te kiezen"` | `"Schrijf iets of druk op / om een blok te kiezen"` | The slash-command hint needs to state what is chosen. | verified |
| `F-nl-008` | `nl` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Lege inklaplijst. Klik of sleep er blokken in."` | `"Lege inklaplijst. Klik om een blok toe te voegen of sleep blokken hierheen."` | Names the distinct click and drag results. | verified |
| `F-nl-009` | `nl` | `tools.table.clearSelection` | context / action accuracy | `"Wissen"` | `"Inhoud wissen"` | Both table callers clear selected cell, row, or column contents rather than merely clearing selection state. | verified |
| `F-nl-010` | `nl` | `tools.table.placement` | terminology / source synchronization | `"Positie"` | `"Uitlijning"` | The 3-by-3 picker controls cell-content alignment. | verified |
| `F-nl-011` | `nl` | `a11y.dragHandle` | accessibility / clarity | `"Sleep om te verplaatsen of klik voor menu"` | `"Sleep om het blok te verplaatsen of klik om het menu te openen"` | Adds the missing objects and explicitly names the menu-opening result. | verified |
| `F-nl-012` | `nl` | `a11y.atTop` | grammar / accessibility / source synchronization | `"Blok staat bovenaan, kan niet hoger"` | `"Blok staat bovenaan en kan niet hoger"` | Replaces a comma splice with a complete conjunction. | verified |
| `F-nl-013` | `nl` | `a11y.atBottom` | grammar / accessibility / source synchronization | `"Blok staat onderaan, kan niet lager"` | `"Blok staat onderaan en kan niet lager"` | Replaces a comma splice with a complete conjunction. | verified |
| `F-nl-014` | `nl` | `a11y.searchResults` | number / accessibility / source synchronization | `"{count} resultaten"` | `"Zoekresultaten: {count}"` | The live-region template can receive one; the replacement is count-neutral. | verified |
| `F-nl-015` | `nl` | `a11y.allBlocksSelected` | number / accessibility / source synchronization | `"Alle blokken geselecteerd, {count} blokken"` | `"Alle blokken geselecteerd. Totaal: {count}"` | Avoids repeated plural wording and works with any count. | verified |
| `F-nl-016` | `nl` | `a11y.navigationModeEntered` | accessibility / grammar | `"Navigatiemodus. Gebruik de pijltjestoetsen om tussen blokken te navigeren, Enter om te bewerken, Escape om af te sluiten."` | `"Navigatiemodus. Gebruik de pijltoetsen om tussen blokken te navigeren. Druk op Enter om te bewerken en op Escape om af te sluiten."` | Uses the standard key term and complete keyboard instructions. | verified |
| `F-nl-017` | `nl` | `a11y.navigatedToBlock` | grammar / accessibility | `"Naar blok genavigeerd"` | `"Naar het blok genavigeerd"` | The definite article is required in this announcement. | verified |
| `F-nl-018` | `nl` | `a11y.dropCreateColumnLeft` | context / accessibility | `"Maakt een kolom aan de linkerkant"` | `"Bij loslaten wordt links een kolom gemaakt"` | This is a prospective pre-drop announcement, not an already-running action. | verified |
| `F-nl-019` | `nl` | `a11y.dropCreateColumnRight` | context / accessibility | `"Maakt een kolom aan de rechterkant"` | `"Bij loslaten wordt rechts een kolom gemaakt"` | This is a prospective pre-drop announcement, not an already-running action. | verified |
| `F-nl-020` | `nl` | `tools.columns.resizeAriaLabel` | accessibility / specificity | `"Kolommen aanpassen"` | `"Kolombreedte aanpassen"` | The handle changes column width, not arbitrary column properties. | verified |
| `F-nl-021` | `nl` | `toolNames.callout` | established product terminology | `"Toelichting"` | `"Markering"` | Notion Dutch uses Markering for the comparable callout block. | verified |
| `F-nl-022` | `nl` | `tools.callout.placeholder` | terminology / consistency | `"Toelichting"` | `"Markering"` | Must match the reviewed visible tool name. | verified |
| `F-nl-023` | `nl` | `tools.callout.calloutEmojiCategory` | terminology / consistency | `"Toelichting"` | `"Markering"` | Must match the reviewed callout terminology. | verified |
| `F-nl-024` | `nl` | `tools.callout.addEmoji` | terminology / source synchronization | `"Emoji toevoegen"` | `"Pictogram toevoegen"` | The action opens icon selection and the corrected source says Add icon. | verified |
| `F-nl-025` | `nl` | `tools.callout.filterEmojis` | search clarity / source synchronization | `"Filteren…"` | `"Emoji's zoeken…"` | This is a search input placeholder, not an abstract filtering action. | verified |
| `F-nl-026` | `nl` | `tools.callout.pickRandom` | action clarity / source synchronization | `"Willekeurig"` | `"Willekeurige emoji kiezen"` | The button needs an explicit action and object. | verified |
| `F-nl-027` | `nl` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Vergelijking"` | The standard Dutch mathematical term replaces an English fallback. | verified |
| `F-nl-028` | `nl` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Voer een LaTeX-formule in…"` | Localizes the instruction while preserving the LaTeX product name. | verified |
| `F-nl-029` | `nl` | `tools.code.searchLanguage` | number / punctuation / source synchronization | `"Taal zoeken..."` | `"Talen zoeken…"` | Search covers multiple languages and UI punctuation should use U+2026. | verified |
| `F-nl-030` | `nl` | `tools.link.linkTitle` | context / terminology / source synchronization | `"Linktitel"` | `"Linktekst"` | The field edits visible anchor text, not an HTML-style link title. | verified |
| `F-nl-031` | `nl` | `tools.image.sizeMedium` | grammar / source-only | `"Middel"` | `"Middelgroot"` | Middel is a noun with other meanings; Middelgroot is the natural size label. | verified |
| `F-nl-032` | `nl` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Converteren…"` | Visible image-processing status retained an English fallback. | verified |
| `F-nl-033` | `nl` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Voeg alt-tekst toe om deze afbeelding te beschrijven. Zo wordt je pagina toegankelijker voor mensen met een visuele beperking."` | `"Beschrijf de afbeelding voor mensen die deze niet kunnen zien."` | The dialog already supplies the alt-text context; the replacement is direct, concise, and inclusive. | verified |
| `F-nl-034` | `nl` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"De afbeelding is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error and preserves both placeholders. | verified |
| `F-nl-035` | `nl` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"De URL gaf een fout terug. Probeer een andere bron of upload het bestand opnieuw."` | `"De afbeelding kon niet via deze URL worden geladen. Probeer een andere bron of upload het bestand opnieuw."` | The original wording was an English calque, and the intermediate correction still treated URL loading as the failed operation. The current English source identifies the image and its URL source directly. | verified |
| `F-nl-036` | `nl` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Het bestand is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error and preserves both placeholders. | verified |
| `F-nl-037` | `nl` | `tools.video.alignmentLeft` | action terminology | `"Links"` | `"Links uitlijnen"` | The settings child performs an alignment action. | verified |
| `F-nl-038` | `nl` | `tools.video.alignmentCenter` | action terminology | `"Midden"` | `"Centreren"` | The settings child performs an alignment action. | verified |
| `F-nl-039` | `nl` | `tools.video.alignmentRight` | action terminology | `"Rechts"` | `"Rechts uitlijnen"` | The settings child performs an alignment action. | verified |
| `F-nl-040` | `nl` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"De video is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error and preserves both placeholders. | verified |
| `F-nl-041` | `nl` | `tools.audio.alignmentLeft` | action terminology | `"Links"` | `"Links uitlijnen"` | The settings child performs an alignment action. | verified |
| `F-nl-042` | `nl` | `tools.audio.alignmentCenter` | action terminology | `"Midden"` | `"Centreren"` | The settings child performs an alignment action. | verified |
| `F-nl-043` | `nl` | `tools.audio.alignmentRight` | action terminology | `"Rechts"` | `"Rechts uitlijnen"` | The settings child performs an alignment action. | verified |
| `F-nl-044` | `nl` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Het audiobestand is te groot. {size} overschrijdt de limiet van {max}."` | Localizes the upload error, names the file resource, and preserves both placeholders. | verified |
| `F-nl-045` | `nl` | `tools.audio.errorGoogleDrive` | natural recovery copy | `"Google Drive-links kunnen niet rechtstreeks worden afgespeeld — download het bestand en upload het hier."` | `"Google Drive-links kunnen niet rechtstreeks worden afgespeeld. Download het bestand en upload het hier in plaats daarvan."` | Uses two clear sentences and preserves the source's instead recovery meaning. | verified |
| `F-nl-046` | `nl` | `tools.audio.errorOneDrive` | natural recovery copy | `"OneDrive-links kunnen niet rechtstreeks worden afgespeeld — download het bestand en upload het hier."` | `"OneDrive-links kunnen niet rechtstreeks worden afgespeeld. Download het bestand en upload het hier in plaats daarvan."` | Uses two clear sentences and preserves the source's instead recovery meaning. | verified |
| `F-nl-047` | `nl` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Titel"` | The surrounding audio context supplies track; the compact field label should be localized. | verified |
| `F-nl-048` | `nl` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"Artiest"` | Uses the established Dutch media term. | verified |
| `F-nl-049` | `nl` | `tools.audio.emptyOrDropHere` | media terminology / grammar | `"of sleep hier een audio"` | `"of sleep een audiobestand hierheen"` | The drop target accepts an audio file; een audio is unnatural Dutch. | verified |
| `F-nl-050` | `nl` | `tools.audio.coverChange` | pending translation / media terminology | `"Change cover"` | `"Illustratie wijzigen"` | Apple Dutch uses illustratie for music artwork. | verified |
| `F-nl-051` | `nl` | `tools.audio.coverSet` | pending translation / media terminology | `"Set cover image"` | `"Illustratie instellen"` | Localizes the action using established music-artwork terminology. | verified |
| `F-nl-052` | `nl` | `tools.audio.coverRemove` | pending translation / media terminology | `"Remove cover"` | `"Illustratie verwijderen"` | Localizes the action using established music-artwork terminology. | verified |
| `F-nl-053` | `nl` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Kies een afbeeldingsbestand"` | Localizes the wrong-file-type recovery instruction. | verified |
| `F-nl-054` | `nl` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"De afbeelding is te groot"` | Localizes the cover-size validation error. | verified |
| `F-nl-055` | `nl` | `tools.audio.coverAdd` | pending translation / media terminology | `"Add a cover"` | `"Illustratie toevoegen"` | Localizes the empty-cover action using established artwork terminology. | verified |
| `F-nl-056` | `nl` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"Afbeeldingsbron"` | `"Bron van illustratie"` | The accessible group name should match the reviewed music-artwork terminology. | verified |
| `F-nl-057` | `nl` | `tools.database.viewTypeListDescription` | terminology / clarity / source synchronization | `"Een eenvoudige lineaire weergave"` | `"Items in een eenvoudige lijst weergeven"` | Avoids the abstract linear-view calque and describes the familiar result. | verified |
| `F-nl-058` | `nl` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Linkvoorbeeld laden"` | `"Linkvoorbeeld laden…"` | The in-progress state needs an ellipsis. | verified |
| `F-nl-059` | `nl` | `tools.embed.empty` | read-only context / source synchronization | `"Plak een link om in te sluiten"` | `"Geen ingesloten link"` | The caller renders a read-only empty embed where pasting is not possible. | verified |
| `F-nl-060` | `nl` | `tools.video.seek` | accessibility terminology | `"Zoeken"` | `"Afspeelpositie"` | The caller is a playback-position slider; Zoeken incorrectly suggests content search. | verified |
| `F-nl-061` | `nl` | `tools.video.toggleTimeDisplay` | accessibility / clarity / source synchronization | `"Tijdweergave wisselen"` | `"Wisselen tussen verstreken en resterende tijd"` | The accessible name must identify both actual display states. | verified |
| `F-nl-062` | `nl` | `tools.video.speedPresets` | naturalness / terminology | `"Snelheidsvoorkeuzes"` | `"Vooraf ingestelde snelheden"` | The current compound is an English calque; the replacement is established Dutch. | verified |
| `F-nl-063` | `nl` | `tools.video.pip` | established product terminology | `"Beeld-in-beeld"` | `"Beeld in beeld"` | Apple Dutch uses the unhyphenated label Beeld in beeld. | verified |
| `F-nl-064` | `nl` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"Video-URL op huidige tijd kopiëren"` | `"Video-URL vanaf de huidige afspeelpositie kopiëren"` | The copied URL starts at the playback head, not at an ambiguous current clock time. | verified |
| `F-nl-065` | `nl` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Statistieken voor nerds"` | `"Afspeelstatistieken"` | Removes slang and identifies the playback-data domain. | verified |
| `F-nl-066` | `nl` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emoji's gevonden"` | `"Emojiresultaten: {count}"` | The live region can announce one result; the replacement is count-neutral. | verified |
| `F-no-001` | `no` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Denne blokken inneholder {count} nestede blokker. Konvertering vil flytte dem til øverste nivå. Vil du fortsette?"` | `"Nestede blokker: {count}. Når denne blokken konverteres, flyttes det nestede innholdet til øverste nivå. Vil du fortsette?"` | Source-only warning must follow the corrected count-first source contract and remain grammatical for both one and many nested blocks; count-neutral `det nestede innholdet` avoids the plural pronoun `de` when `{count}` is one. | verified |
| `F-no-002` | `no` | `toolbox.optionAddAbove` | platform terminology | `"Option-klikk for å legge til ovenfor"` | `"Tilvalg-klikk for å legge til ovenfor"` | Apple’s Norwegian macOS terminology names the Option key `Tilvalg`, including modified-click instructions. | verified |
| `F-no-003` | `no` | `tools.marker.textColor` | terminology / source synchronization | `"Tekst"` | `"Tekstfarge"` | Shared color-picker modes require an explicit text-color label; the old noun does not distinguish text from the mode itself. | verified |
| `F-no-004` | `no` | `tools.paragraph.placeholder` | grammar / hint clarity | `"Skriv noe eller trykk / for å velge"` | `"Skriv noe, eller trykk på / for å velge et verktøy"` | The instruction needs the preposition after `trykk`, punctuation between alternatives, and the omitted object selected by `/`. | verified |
| `F-no-005` | `no` | `tools.toggle.placeholder` | grammar / clarity | `"Sammenleggbar"` | `"Sammenleggbar liste"` | A bare adjective is incomplete as a visible placeholder; the value names the toggle-list tool. | verified |
| `F-no-006` | `no` | `tools.toggle.bodyPlaceholder` | hint clarity / source synchronization | `"Tom sammenleggbar blokk. Klikk eller slipp blokker inni."` | `"Tom sammenleggbar blokk. Klikk for å legge til en blokk, eller dra blokker hit."` | The caller’s click creates a child block while its drop zone accepts dragged blocks; the replacement distinguishes both actions. | verified |
| `F-no-007` | `no` | `tools.table.clearSelection` | caller context / action terminology | `"Tøm"` | `"Fjern innhold"` | Both selected-cell and row/column callers invoke content-clearing callbacks; deletion has separate actions, and colors survive row/column clearing. | verified |
| `F-no-008` | `no` | `tools.table.comfortableText` | density terminology | `"Komfortabel tekst"` | `"Luftig tekst"` | This is the roomier density option opposite compact text, not a judgment about emotional comfort. | verified |
| `F-no-009` | `no` | `tools.table.placement` | terminology / source synchronization | `"Plassering"` | `"Justering"` | The picker controls horizontal and vertical alignment of content inside selected cells rather than generic placement. | verified |
| `F-no-010` | `no` | `a11y.dragHandle` | grammar / accessibility | `"Dra for å flytte blokk eller klikk for meny"` | `"Dra for å flytte blokken, eller klikk for å åpne menyen"` | The accessible name needs definite objects, punctuation between actions, and the explicit result of clicking. | verified |
| `F-no-011` | `no` | `a11y.atTop` | grammar / accessibility / source synchronization | `"Blokken er øverst, kan ikke flyttes opp"` | `"Blokken er øverst og kan ikke flyttes opp"` | The keyboard boundary announcement contains a comma splice; the conjunction produces a complete natural sentence. | verified |
| `F-no-012` | `no` | `a11y.atBottom` | grammar / accessibility / source synchronization | `"Blokken er nederst, kan ikke flyttes ned"` | `"Blokken er nederst og kan ikke flyttes ned"` | The keyboard boundary announcement contains a comma splice; the conjunction produces a complete natural sentence. | verified |
| `F-no-013` | `no` | `a11y.searchResults` | number / accessibility / source synchronization | `"{count} resultater"` | `"Søkeresultater: {count}"` | Search live regions can announce one result; the label-before-count form is grammatical for every value. | verified |
| `F-no-014` | `no` | `a11y.allBlocksSelected` | number / accessibility / source synchronization | `"Alle blokker valgt, {count} blokker"` | `"Alle blokker er valgt. Totalt: {count}"` | Select-all can operate on one block; the replacement is count-neutral and avoids repeating a plural noun. | verified |
| `F-no-015` | `no` | `a11y.navigationModeExited` | grammar / accessibility | `"Avsluttet navigasjonsmodus"` | `"Navigasjonsmodus avsluttet"` | The old past-tense verb lacks a subject; the replacement is a natural status announcement. | verified |
| `F-no-016` | `no` | `a11y.navigatedToBlock` | grammar / accessibility | `"Navigerte til blokk"` | `"Navigert til blokken"` | A completed navigation announcement requires the resultative participle rather than finite past tense without a subject, and the definite noun identifies the specific block that received focus. | verified |
| `F-no-017` | `no` | `a11y.dropCreateColumnLeft` | drop context / accessibility | `"Oppretter en kolonne til venstre"` | `"En kolonne opprettes til venstre når du slipper"` | The announcement occurs before drop and must describe the prospective result rather than imply creation is already underway. | verified |
| `F-no-018` | `no` | `a11y.dropCreateColumnRight` | drop context / accessibility | `"Oppretter en kolonne til høyre"` | `"En kolonne opprettes til høyre når du slipper"` | The announcement occurs before drop and must describe the prospective result rather than imply creation is already underway. | verified |
| `F-no-019` | `no` | `searchTerms.header` | semantic alias | `"topptekst"` | `"rubrikk"` | The alias targets the heading tool; `topptekst` denotes page-header content rather than a document heading. | verified |
| `F-no-020` | `no` | `searchTerms.unordered` | list terminology | `"usortert"` | `"uordnet"` | An unordered list is not an unsorted data set; `uordnet` preserves the list-model meaning. | verified |
| `F-no-021` | `no` | `searchTerms.ordered` | list terminology | `"sortert"` | `"ordnet"` | An ordered list expresses sequence rather than semantic sorting; `ordnet` preserves that distinction. | verified |
| `F-no-022` | `no` | `tools.callout.addEmoji` | terminology / source synchronization | `"Legg til emoji"` | `"Legg til ikon"` | The callout UI presents the chosen emoji as an editable and removable icon, matching the corrected source label. | verified |
| `F-no-023` | `no` | `tools.callout.filterEmojis` | search / accessibility / source synchronization | `"Filtrer…"` | `"Søk etter emojier…"` | The value is both placeholder and accessible name for an emoji searchbox and should identify what is searched. | verified |
| `F-no-024` | `no` | `tools.callout.pickRandom` | action clarity / accessibility / source synchronization | `"Tilfeldig"` | `"Velg en tilfeldig emoji"` | The dice button’s tooltip and accessible name require a complete action instead of a bare adjective. | verified |
| `F-no-025` | `no` | `tools.callout.skinTone` | established product terminology | `"Hudfarge"` | `"Hudtone"` | Microsoft’s Norwegian emoji UI uses `Hudtone` for this selector; it is more precise than generic skin color. | verified |
| `F-no-026` | `no` | `toolNames.equation` | pending translation | `"Equation"` | `"Ligning"` | The inline equation tool retains an English fallback instead of the standard Bokmål mathematical term. | verified |
| `F-no-027` | `no` | `tools.equation.placeholder` | pending translation | `"Enter a LaTeX formula…"` | `"Skriv inn en LaTeX-formel…"` | The formula-input instruction remains English; the replacement localizes the action while retaining the LaTeX product name. | verified |
| `F-no-028` | `no` | `tools.code.searchLanguage` | punctuation / source synchronization | `"Søk etter språk..."` | `"Søk etter språk…"` | The corpus uses the single ellipsis character for continuing search input rather than three full stops. | verified |
| `F-no-029` | `no` | `tools.link.linkTitle` | terminology / source synchronization | `"Lenketittel"` | `"Lenketekst"` | The inline-link field changes the anchor’s visible text, not HTML title metadata; the label must name the content the user edits. | verified |
| `F-no-030` | `no` | `tools.image.exitFullscreen` | action terminology | `"Lukk fullskjerm"` | `"Avslutt fullskjerm"` | The control exits fullscreen mode rather than closing a fullscreen object or dialog. | verified |
| `F-no-031` | `no` | `tools.image.converting` | pending translation | `"Converting…"` | `"Konverterer…"` | The visible in-progress image-processing status retains an English fallback while every surrounding upload state is localized. | verified |
| `F-no-032` | `no` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Legg til alt-tekst som beskriver bildet. Dette gjør siden mer tilgjengelig for personer med synshemming eller blindhet."` | `"Beskriv dette bildet for personer som ikke kan se det."` | The dialog already establishes alternative text; the replacement is concise, direct, and focused on the person using the description. | verified |
| `F-no-033` | `no` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"Bildet er for stort. {size} overskrider grensen på {max}."` | The image-upload size error retains English; both interpolation placeholders remain exact. | verified |
| `F-no-034` | `no` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"URL-en returnerte en feil. Prøv en annen kilde eller last opp filen på nytt."` | `"Bildet kunne ikke lastes inn fra denne URL-en. Prøv en annen kilde eller last opp filen på nytt."` | The original wording made a URL return an error, and the intermediate correction still described abstract URL loading. The current source identifies the failed image and its URL source directly. | verified |
| `F-no-035` | `no` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Filen er for stor. {size} overskrider grensen på {max}."` | The file-upload size error retains English; both interpolation placeholders remain exact. | verified |
| `F-no-036` | `no` | `tools.file.previewRender` | context / terminology / source synchronization | `"Visning"` | `"Forhåndsvisning"` | The corrected English tab concept is a user-facing preview, not a rendered-state adjective. `Forhåndsvisning` pairs naturally with the source tab. | verified |
| `F-no-037` | `no` | `tools.video.alignmentLeft` | action terminology | `"Venstre"` | `"Venstrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-no-038` | `no` | `tools.video.alignmentCenter` | action terminology | `"Midtstilt"` | `"Midtstill"` | The settings item performs an alignment action; the old adjective describes a state rather than the action. | verified |
| `F-no-039` | `no` | `tools.video.alignmentRight` | action terminology | `"Høyre"` | `"Høyrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-no-040` | `no` | `tools.video.hideControls` | media terminology | `"Skjul kontroller"` | `"Skjul avspillingskontroller"` | The tune hides the player’s complete playback-control set; the explicit compound avoids generic controls. | verified |
| `F-no-041` | `no` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"Videoen er for stor. {size} overskrider grensen på {max}."` | The video-upload size error retains English; both interpolation placeholders remain exact. | verified |
| `F-no-042` | `no` | `tools.video.emptyAddVideo` | grammar | `"Legg til et video"` | `"Legg til en video"` | Bokmål `video` takes common gender in this visible empty-state instruction, so the old neuter article is ungrammatical. | verified |
| `F-no-043` | `no` | `tools.video.emptyOrDropHere` | grammar | `"eller slipp et video her"` | `"eller slipp en video her"` | Bokmål `video` takes common gender in this visible drop-target instruction, so the old neuter article is ungrammatical. | verified |
| `F-no-044` | `no` | `tools.audio.alignmentLeft` | action terminology | `"Venstre"` | `"Venstrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-no-045` | `no` | `tools.audio.alignmentCenter` | action terminology | `"Midtstilt"` | `"Midtstill"` | The settings item performs an alignment action; the old adjective describes a state rather than the action. | verified |
| `F-no-046` | `no` | `tools.audio.alignmentRight` | action terminology | `"Høyre"` | `"Høyrejuster"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-no-047` | `no` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Lydfilen er for stor. {size} overskrider grensen på {max}."` | The audio-upload size error retains English; the replacement names the file resource and preserves both placeholders. | verified |
| `F-no-048` | `no` | `tools.audio.errorGoogleDrive` | natural recovery copy | `"Google Drive-lenker kan ikke spilles av direkte — last ned filen og last den opp her."` | `"Google Drive-lenker kan ikke spilles av direkte. Last ned filen og last den opp her i stedet."` | Two direct sentences improve readability and restore the source’s `instead` recovery relationship. | verified |
| `F-no-049` | `no` | `tools.audio.errorOneDrive` | natural recovery copy | `"OneDrive-lenker kan ikke spilles av direkte — last ned filen og last den opp her."` | `"OneDrive-lenker kan ikke spilles av direkte. Last ned filen og last den opp her i stedet."` | Two direct sentences improve readability and restore the source’s `instead` recovery relationship. | verified |
| `F-no-050` | `no` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Tittel"` | The surrounding audio context supplies track; the compact metadata-field label must be localized. | verified |
| `F-no-051` | `no` | `tools.audio.emptyAddAudio` | grammar / media terminology | `"Legg til et lyd"` | `"Legg til lyd"` | `Lyd` is used as a mass noun in this media action; the neuter article is ungrammatical here. | verified |
| `F-no-052` | `no` | `tools.audio.emptyOrDropHere` | media terminology / grammar | `"eller slipp et lyd her"` | `"eller slipp en lydfil her"` | The drop target accepts an audio file, while `et lyd` is ungrammatical and describes an abstract sound. | verified |
| `F-no-053` | `no` | `tools.audio.coverChange` | pending translation / media terminology | `"Change cover"` | `"Endre omslagsbilde"` | The artwork action retains an English fallback; `omslagsbilde` identifies the edited image. | verified |
| `F-no-054` | `no` | `tools.audio.coverSet` | pending translation / media terminology | `"Set cover image"` | `"Angi omslagsbilde"` | The cover-image control retains an English fallback and needs a concise Bokmål action. | verified |
| `F-no-055` | `no` | `tools.audio.coverRemove` | pending translation / media terminology | `"Remove cover"` | `"Fjern omslagsbilde"` | The visible artwork-removal action retains an English fallback and must use the same reviewed `omslagsbilde` term as the adjacent controls. | verified |
| `F-no-056` | `no` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Velg en bildefil"` | The wrong-file-type recovery instruction retains an English fallback in an otherwise localized cover-image picker. | verified |
| `F-no-057` | `no` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"Bildet er for stort"` | The cover-upload size error retains an English fallback and is shown directly to Norwegian users after validation fails. | verified |
| `F-no-058` | `no` | `tools.audio.coverAdd` | pending translation / media terminology | `"Add a cover"` | `"Legg til et omslagsbilde"` | The empty-cover action retains an English fallback and should identify the image resource. | verified |
| `F-no-059` | `no` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"Bildekilde"` | `"Kilde til omslagsbilde"` | The accessible group name should identify the cover-image source selector rather than any generic image source. | verified |
| `F-no-060` | `no` | `tools.database.viewTypeBoardDescription` | grammar | `"Vis arbeid som kolonner"` | `"Vis arbeidet i kolonner"` | The board-view description needs the definite object and the natural preposition for a column layout. | verified |
| `F-no-061` | `no` | `tools.database.viewTypeListDescription` | terminology / clarity / source synchronization | `"En enkel lineær visning"` | `"Vis elementer i en enkel liste"` | The view picker should describe the familiar rendered list rather than use abstract linear-view terminology. | verified |
| `F-no-062` | `no` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Laster inn forhåndsvisning av lenke"` | `"Laster inn forhåndsvisning av lenke…"` | The rendered in-progress placeholder needs the corpus-standard ellipsis. | verified |
| `F-no-063` | `no` | `tools.embed.empty` | read-only context / source synchronization | `"Lim inn en lenke for å bygge inn"` | `"Ingen innebygd lenke"` | The caller renders an empty embed in read-only mode, where pasting is impossible. | verified |
| `F-no-064` | `no` | `tools.video.seek` | accessibility / media terminology | `"Søk"` | `"Avspillingsposisjon"` | The accessible name belongs to a playback-position slider; `Søk` incorrectly suggests content search. | verified |
| `F-no-065` | `no` | `tools.video.toggleTimeDisplay` | accessibility / clarity / source synchronization | `"Veksle tidsvisning"` | `"Veksle mellom avspilt og gjenstående tid"` | The accessible action must identify both actual time-display states instead of exposing an abstract toggle. | verified |
| `F-no-066` | `no` | `tools.video.speedDecrease` | grammar / action clarity | `"Reduser avspillingshastighet"` | `"Senk avspillingshastigheten"` | The player-control action naturally uses the imperative `senk` and requires the definite object `avspillingshastigheten`. | verified |
| `F-no-067` | `no` | `tools.video.speedIncrease` | grammar / action clarity | `"Øk avspillingshastighet"` | `"Øk avspillingshastigheten"` | The player-control action requires the definite object `avspillingshastigheten` in natural Bokmål. | verified |
| `F-no-068` | `no` | `tools.video.speedPresets` | naturalness / accessibility | `"Hastighetsforhåndsinnstillinger"` | `"Forhåndsinnstilte hastigheter"` | The accessible group label is clearer as a normal phrase than as a dense compound. | verified |
| `F-no-069` | `no` | `tools.video.pip` | established product terminology | `"Bilde-i-bilde"` | `"Bilde i bilde"` | Apple’s Norwegian platform terminology uses the unhyphenated `Bilde i bilde` feature name. | verified |
| `F-no-070` | `no` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"Kopier video-URL ved gjeldende tid"` | `"Kopier video-URL ved gjeldende avspillingsposisjon"` | The copied URL targets the current playback head; `gjeldende tid` can instead be understood as wall-clock time. | verified |
| `F-no-071` | `no` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Statistikk for nerder"` | `"Avspillingsstatistikk"` | The context-menu item opens playback data; the replacement removes prohibited slang and identifies the domain. | verified |
| `F-no-072` | `no` | `tools.audio.speedDecrease` | grammar / action clarity | `"Reduser avspillingshastighet"` | `"Senk avspillingshastigheten"` | The player-control action naturally uses the imperative `senk` and requires the definite object `avspillingshastigheten`. | verified |
| `F-no-073` | `no` | `tools.audio.speedIncrease` | grammar / action clarity | `"Øk avspillingshastighet"` | `"Øk avspillingshastigheten"` | The player-control action requires the definite object `avspillingshastigheten` in natural Bokmål. | verified |
| `F-no-074` | `no` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emojier funnet"` | `"Emojitreff: {count}"` | The live region can announce one match; the label-before-count form is grammatical for every result count. | verified |
| `F-am-001` | `am` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ቅርጸት አጽዳ"` | The built-in inline tool requires a localized action label. The exact WordPress Amharic [Clear formatting translation](https://translate.wordpress.org/projects/wp/dev/am/default/export-translations/?format=po), after trimming its accidental trailing space, reuses this dictionary’s established `ቅርጸት` and `አጽዳ` terms. | verified |
| `F-ar-001` | `ar` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"مسح التنسيق"` | Microsoft’s Arabic editor UI uses the exact concise command [مسح التنسيق](https://support.microsoft.com/ar-SA/Excel/format-text-in-cells). | verified |
| `F-az-001` | `az` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Formatı təmizlə"` | Azerbaijan’s State Examination Center documents Word’s Clear Formatting command as [Formatı Təmizlə](https://dim.gov.az/CkImage/Mag_III_izah_sayt_14_06_26__1781428794.pdf); sentence casing is normalized to the dictionary’s action register. | verified |
| `F-bg-001` | `bg` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Изчисти форматирането"` | Microsoft’s Bulgarian Word UI uses the exact command [Изчисти форматирането](https://support.microsoft.com/bg-BG/Word/format-your-word-document). | verified |
| `F-bn-001` | `bn` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"বিন্যাস অপসারণ"` | LibreOffice’s Bengali product UI supplies the exact Clear formatting translation [বিন্যাস অপসারণ](https://github.com/LibreOffice/translations/blob/master/source/bn/svx/messages.po#L6302-L6303). | verified |
| `F-bs-001` | `bs` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Očisti formatiranje"` | LibreOffice’s Bosnian product UI supplies the exact Clear formatting translation [Očisti formatiranje](https://github.com/LibreOffice/translations/blob/master/source/bs/svx/messages.po#L6304-L6305). | verified |
| `F-cs-001` | `cs` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Vymazat formátování"` | Microsoft’s Czech Word instructions name the concise command [Vymazat formátování](https://support.microsoft.com/cs-cz/office/form%C3%A1tov%C3%A1n%C3%AD-dokumentu-aplikace-word-fb9ef2d6-e2ad-4721-abc1-55f88864617f). | verified |
| `F-cs-002` | `cs` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Tento blok obsahuje {count} vnořených bloků. Po převodu budou přesunuty na nejvyšší úroveň. Pokračovat?"` | `"Počet vnořených bloků: {count}. Při převodu tohoto bloku se vnořený obsah přesune na nejvyšší úroveň. Pokračovat?"` | The source count can be singular or plural; label-before-count wording avoids Czech numeral agreement and names the moved content. | verified |
| `F-cs-003` | `cs` | `tools.marker.textColor` | terminology / source synchronization | `"Písmo"` | `"Barva písma"` | The shared color picker must distinguish font color from the adjacent background mode. | verified |
| `F-cs-004` | `cs` | `tools.colorPicker.defaultSwatchLabel` | punctuation / placeholder composition | `"{mode} {default}"` | `"{mode}: {default}"` | A colon separates the substituted mode from its default value in the accessible swatch label. | verified |
| `F-cs-005` | `cs` | `tools.colorPicker.colorSwatchLabel` | punctuation / placeholder composition | `"{mode} {color}"` | `"{mode}: {color}"` | A colon prevents the substituted mode and color from becoming an ambiguous noun string. | verified |
| `F-cs-006` | `cs` | `tools.paragraph.placeholder` | instruction completeness | `"Napište něco nebo stiskněte / pro výběr"` | `"Napište něco nebo stiskněte / a vyberte nástroj"` | The slash hint must identify the tool selected by the resulting picker. | verified |
| `F-cs-007` | `cs` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Prázdný rozbalovací blok. Klikněte nebo sem přetáhněte bloky."` | `"Prázdný rozbalovací blok. Kliknutím přidejte blok nebo sem přetáhněte bloky."` | Clicking creates a child block while dragging moves existing blocks; both results must be explicit. | verified |
| `F-cs-008` | `cs` | `tools.table.clearSelection` | action accuracy / source synchronization | `"Vymazat"` | `"Vymazat obsah"` | The table command clears selected contents without deleting the cells or their formatting. | verified |
| `F-cs-009` | `cs` | `tools.table.placement` | terminology / source synchronization | `"Umístění"` | `"Zarovnání"` | The 3×3 control changes cell-content alignment, not object placement. | verified |
| `F-cs-010` | `cs` | `blockSettings.lastEditedBy` | inclusive grammar / placeholder | `"Naposledy upravil/a {name}"` | `"Naposledy upraveno uživatelem {name}"` | The neutral passive construction avoids a slash-gender form while preserving the editor name. | verified |
| `F-cs-011` | `cs` | `a11y.dragHandle` | accessibility / instruction completeness | `"Přetáhněte pro přesunutí nebo klikněte pro nabídku"` | `"Přetažením přesuňte blok nebo kliknutím otevřete nabídku"` | The drag-handle name must identify the block and the menu opened by clicking. | verified |
| `F-cs-012` | `cs` | `a11y.dragStartedMultiple` | number / accessibility | `"Přetahování {count} bloků"` | `"Počet přetahovaných bloků: {count}"` | Label-before-count wording is grammatical for all Czech numeral classes. | verified |
| `F-cs-013` | `cs` | `a11y.blocksMoved` | number / accessibility | `"{count} bloků přesunuto na pozici {position}"` | `"Počet přesunutých bloků: {count}. Nová pozice: {position}"` | Separate labels avoid count-dependent noun and participle agreement. | verified |
| `F-cs-014` | `cs` | `a11y.blockDuplicated` | terminology consistency | `"Blok zduplikován na pozici {position} z {total}"` | `"Blok duplikován na pozici {position} z {total}"` | The result announcement should use the same established duplicate stem as the catalog’s actions. | verified |
| `F-cs-015` | `cs` | `a11y.blocksDuplicated` | number / accessibility | `"{count} bloků zduplikováno od pozice {position}"` | `"Počet duplikovaných bloků: {count}. Počáteční pozice: {position}"` | Separate labels avoid Czech numeral agreement and clarify that the position is the start. | verified |
| `F-cs-016` | `cs` | `a11y.searchResults` | number / accessibility / source synchronization | `"{count} výsledků"` | `"Výsledky hledání: {count}"` | Label-before-count wording remains grammatical for one, few, and many results. | verified |
| `F-cs-017` | `cs` | `a11y.allBlocksSelected` | number / accessibility / source synchronization | `"Vybrány všechny bloky, {count} bloků"` | `"Vybrány všechny bloky. Celkem: {count}"` | The separate total avoids count-dependent repetition and matches the corrected source structure. | verified |
| `F-cs-018` | `cs` | `a11y.blocksSelected` | number / accessibility | `"Vybráno {count} bloků"` | `"Počet vybraných bloků: {count}"` | Label-before-count wording avoids Czech one/few/many agreement. | verified |
| `F-cs-019` | `cs` | `a11y.navigationModeEntered` | grammar / keyboard / accessibility | `"Režim navigace. Pomocí šipek se pohybujte mezi bloky, klávesou Enter upravujte a klávesou Escape režim ukončíte."` | `"Režim navigace. Mezi bloky se pohybujte pomocí kláves se šipkami, klávesou Enter zahajte úpravy a klávesou Esc režim ukončete."` | The old sentence mixed imperative and indicative forms and described continuous editing rather than entering edit mode; Apple and Microsoft’s Czech shortcut guidance use the physical-key label `Esc`. | verified |
| `F-cs-020` | `cs` | `a11y.navigatedToBlock` | event accuracy / accessibility | `"Přesunuto na blok"` | `"Přešli jste na blok"` | Focus navigation occurred; the old passive wording falsely suggested that an object was moved. | verified |
| `F-cs-021` | `cs` | `toolNames.board` | product terminology / consistency | `"Nástěnka"` | `"Tabule"` | The tool name must agree with the existing Czech board-view terminology. | verified |
| `F-cs-022` | `cs` | `toolNames.quote` | terminology | `"Citace"` | `"Citát"` | The tool inserts a quotation, while `citace` refers to a citation or reference. | verified |
| `F-cs-023` | `cs` | `searchTerms.header` | search semantics | `"záhlaví"` | `"mezititulek"` | The alias targets a content heading, not a page header. | verified |
| `F-cs-024` | `cs` | `searchTerms.quote` | search semantics | `"citace"` | `"citát"` | The quote alias should name the quotation itself. | verified |
| `F-cs-025` | `cs` | `searchTerms.citation` | search semantics | `"citát"` | `"citace"` | The citation alias should use the established Czech citation term. | verified |
| `F-cs-026` | `cs` | `tools.quote.placeholder` | placeholder clarity | `"Citace"` | `"Zadejte citát"` | The editable empty quote needs a direct instruction and the correct quotation noun. | verified |
| `F-cs-027` | `cs` | `tools.callout.addEmoji` | action accuracy / source synchronization | `"Přidat emoji"` | `"Přidat ikonu"` | The control adds the callout’s editable icon, which may then be changed or removed. | verified |
| `F-cs-028` | `cs` | `tools.callout.filterEmojis` | search clarity / punctuation | `"Filtr…"` | `"Hledat emoji…"` | This is the emoji searchbox placeholder and accessible name, not a generic filter command. | verified |
| `F-cs-029` | `cs` | `tools.callout.pickRandom` | action completeness | `"Náhodně"` | `"Vybrat náhodné emoji"` | The dice control requires a complete action and object. | verified |
| `F-cs-030` | `cs` | `tools.callout.emojiSearchResults` | number / accessibility | `"Nalezeno {count} emodži"` | `"Počet odpovídajících emoji: {count}"` | The count-neutral label avoids agreement and uses the catalog’s established `emoji` spelling. | verified |
| `F-cs-031` | `cs` | `toolNames.equation` | untranslated source text | `"Equation"` | `"Rovnice"` | The visible equation-tool name was left in English. | verified |
| `F-cs-032` | `cs` | `tools.equation.placeholder` | untranslated source text / terminology | `"Enter a LaTeX formula…"` | `"Zadejte vzorec ve formátu LaTeX…"` | The equation editor placeholder was left in English; `LaTeX` remains the product name. | verified |
| `F-cs-033` | `cs` | `tools.code.searchLanguage` | number / punctuation / source synchronization | `"Hledat jazyk..."` | `"Hledat jazyky…"` | The picker searches multiple languages and the corpus requires a single U+2026 ellipsis. | verified |
| `F-cs-034` | `cs` | `blockSettings.copyLinkSuccess` | feedback completeness | `"Odkaz byl zkopírován"` | `"Odkaz byl zkopírován do schránky"` | The success toast must state the clipboard destination. | verified |
| `F-cs-035` | `cs` | `tools.link.linkTitle` | terminology / source synchronization | `"Název odkazu"` | `"Text odkazu"` | The field edits visible anchor text, not title metadata; Microsoft Czech uses [text hypertextového odkazu](https://support.microsoft.com/cs-cz/office/p%C5%99izp%C5%AFsoben%C3%AD-textu-hypertextov%C3%A9ho-odkazu-v-outlooku-63d4fdcc-bce2-41ea-9649-d8aaa900fe2f). | verified |
| `F-cs-036` | `cs` | `tools.image.toggleCaption` | action accuracy | `"Zobrazit popisek"` | `"Zobrazit nebo skrýt popisek"` | The toggle can both show and hide the caption. | verified |
| `F-cs-037` | `cs` | `tools.image.exitFullscreen` | established UI terminology | `"Ukončit celou obrazovku"` | `"Ukončit režim celé obrazovky"` | The action exits a display mode rather than ending the screen itself. | verified |
| `F-cs-038` | `cs` | `tools.image.moreOptions` | control clarity | `"Více"` | `"Další možnosti"` | The accessible menu button must identify what “more” opens. | verified |
| `F-cs-039` | `cs` | `tools.image.converting` | untranslated source text / progress | `"Converting…"` | `"Probíhá převod…"` | The rendered image-processing progress state was left in English. | verified |
| `F-cs-040` | `cs` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Přidejte popis obrázku. Tím stránku zpřístupníte lidem se zrakovým postižením."` | `"Popište tento obrázek lidem, kteří ho nevidí."` | The replacement is direct, concise, and inclusive without medicalizing users. | verified |
| `F-cs-041` | `cs` | `tools.image.errorFileTooLarge` | untranslated source text / placeholders | `"Image is too large. {size} exceeds the {max} limit."` | `"Obrázek je příliš velký. Jeho velikost {size} překračuje limit {max}."` | The visible error was left in English; both size placeholders remain explicit. | verified |
| `F-cs-042` | `cs` | `tools.image.errorDefaultMessage` | error accuracy / source synchronization | `"Server vrátil chybu. Zkuste jiný zdroj nebo soubor nahrajte znovu."` | `"Obrázek se z této adresy URL nepodařilo načíst. Zkuste jiný zdroj nebo soubor nahrajte znovu."` | The caller knows only that URL image loading failed; blaming a server invents a cause. | verified |
| `F-cs-043` | `cs` | `tools.file.toggleCaption` | action accuracy | `"Zobrazit popisek"` | `"Zobrazit nebo skrýt popisek"` | The toggle can both show and hide the file caption. | verified |
| `F-cs-044` | `cs` | `tools.file.errorFileTooLarge` | untranslated source text / placeholders | `"File is too large. {size} exceeds the {max} limit."` | `"Soubor je příliš velký. Jeho velikost {size} překračuje limit {max}."` | The visible error was left in English; both placeholders remain intact. | verified |
| `F-cs-045` | `cs` | `tools.video.toggleCaption` | action accuracy / source-only contract | `"Zobrazit popisek"` | `"Zobrazit nebo skrýt popisek"` | This contract controls the block’s editable caption row, not timed subtitles, and must name both toggle states. | verified |
| `F-cs-046` | `cs` | `tools.video.moreOptions` | control clarity / source-only contract | `"Více"` | `"Další možnosti"` | The accessible menu contract must identify the options opened by the control. | verified |
| `F-cs-047` | `cs` | `tools.video.errorFileTooLarge` | untranslated source text / placeholders | `"Video is too large. {size} exceeds the {max} limit."` | `"Video je příliš velké. Jeho velikost {size} překračuje limit {max}."` | The visible upload error was left in English and must preserve both placeholders. | verified |
| `F-cs-048` | `cs` | `tools.video.seek` | accessibility / media terminology | `"Přetáčení"` | `"Pozice přehrávání"` | The value labels a range slider’s playback position, not a rewind or fast-seek action. | verified |
| `F-cs-049` | `cs` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"Přepnout zobrazení času"` | `"Přepnout mezi uplynulým a zbývajícím časem"` | The accessible action must identify the two actual time-display states. | verified |
| `F-cs-050` | `cs` | `tools.video.fullscreenExit` | established UI terminology | `"Ukončit celou obrazovku"` | `"Ukončit režim celé obrazovky"` | The control exits full-screen mode rather than ending the screen. | verified |
| `F-cs-051` | `cs` | `tools.video.ctxStats` | slang / source synchronization | `"Statistiky pro znalce"` | `"Statistiky přehrávání"` | The corrected source removes the “nerd” framing and names the playback-data context. | verified |
| `F-cs-052` | `cs` | `tools.video.ctxCopyUrlAtTime` | media context | `"Kopírovat URL videa v aktuálním čase"` | `"Kopírovat URL videa od aktuální pozice přehrávání"` | The copied link starts at the playback head, not at a wall-clock time. | verified |
| `F-cs-053` | `cs` | `tools.audio.errorFileTooLarge` | untranslated source text / placeholders | `"Audio is too large. {size} exceeds the {max} limit."` | `"Zvukový soubor je příliš velký. Jeho velikost {size} překračuje limit {max}."` | The visible error was left in English; the replacement names the file and preserves both placeholders. | verified |
| `F-cs-054` | `cs` | `tools.audio.errorGoogleDrive` | error accuracy / vendor terminology | `"Odkazy Google Drive nelze přehrát přímo — stáhněte soubor a nahrajte jej sem."` | `"Zvukový soubor z Disku Google nelze přehrát přímo. Místo toho jej stáhněte a nahrajte sem."` | The playable resource is the audio file; the recovery also restores “instead” and Google’s Czech `Disk Google` name. | verified |
| `F-cs-055` | `cs` | `tools.audio.errorOneDrive` | error accuracy / vendor grammar | `"Odkazy OneDrive nelze přehrát přímo — stáhněte soubor a nahrajte jej sem."` | `"Zvukový soubor z OneDrivu nelze přehrát přímo. Místo toho jej stáhněte a nahrajte sem."` | The playable resource is the audio file; the recovery restores “instead” and correctly declines OneDrive. | verified |
| `F-cs-056` | `cs` | `tools.audio.titlePlaceholder` | untranslated source text / media terminology | `"Track title"` | `"Název skladby"` | The audio metadata field was left in English. | verified |
| `F-cs-057` | `cs` | `tools.audio.artistPlaceholder` | untranslated source text / media terminology | `"Artist"` | `"Interpret"` | The audio metadata field was left in English; `interpret` is the established performer label. | verified |
| `F-cs-058` | `cs` | `tools.audio.emptyOrDropHere` | resource clarity | `"nebo sem přetáhněte audio"` | `"nebo sem přetáhněte zvukový soubor"` | The drop zone accepts a file rather than abstract audio. | verified |
| `F-cs-059` | `cs` | `tools.audio.emptyUrlPlaceholder` | wrong media type / terminology | `"Vložte URL videa…"` | `"Vložte adresu URL zvukového souboru…"` | The audio input incorrectly instructed users to paste a video URL. | verified |
| `F-cs-060` | `cs` | `tools.audio.emptyUrlAria` | wrong media type / accessibility | `"URL videa"` | `"Adresa URL zvukového souboru"` | The audio URL input’s accessible name incorrectly identified a video. | verified |
| `F-cs-061` | `cs` | `tools.audio.emptySourceAria` | wrong media type / accessibility | `"Zdroj videa"` | `"Zdroj zvukového souboru"` | The audio source selector’s accessible name incorrectly identified a video. | verified |
| `F-cs-062` | `cs` | `tools.audio.coverChange` | untranslated source text | `"Change cover"` | `"Změnit obal"` | The rendered cover-art action was left in English. | verified |
| `F-cs-063` | `cs` | `tools.audio.coverSet` | untranslated source text | `"Set cover image"` | `"Nastavit obrázek obalu"` | The cover-image settings action was left in English. | verified |
| `F-cs-064` | `cs` | `tools.audio.coverRemove` | untranslated source text | `"Remove cover"` | `"Odebrat obal"` | The cover-removal action was left in English. | verified |
| `F-cs-065` | `cs` | `tools.audio.coverErrorType` | untranslated source text / naturalness | `"Choose an image file"` | `"Vyberte soubor s obrázkem"` | The wrong-file-type recovery instruction was left in English; the replacement uses natural Czech wording. | verified |
| `F-cs-066` | `cs` | `tools.audio.coverErrorTooLarge` | untranslated source text | `"Image is too large"` | `"Obrázek je příliš velký"` | The cover-image size error was left in English. | verified |
| `F-cs-067` | `cs` | `tools.audio.coverAdd` | untranslated source text | `"Add a cover"` | `"Přidat obal"` | The empty-cover action was left in English. | verified |
| `F-cs-068` | `cs` | `tools.audio.coverSourceAria` | accessibility / context | `"Zdroj obrázku"` | `"Zdroj obalu"` | The accessible group name must identify the cover selector rather than a generic image source. | verified |
| `F-cs-069` | `cs` | `tools.database.viewTypeBoardDescription` | source synchronization / context | `"Uspořádejte úkoly do sloupců"` | `"Zobrazit položky ve sloupcích"` | The view can contain arbitrary items, not only tasks, and the option needs a concise description. | verified |
| `F-cs-070` | `cs` | `tools.database.viewTypeListDescription` | source synchronization / terminology | `"Jednoduché lineární zobrazení"` | `"Zobrazit položky v jednoduchém seznamu"` | The corrected source names familiar list behavior rather than an abstract linear view. | verified |
| `F-cs-071` | `cs` | `tools.database.propertyTypeMultiSelect` | established terminology | `"Více výběrů"` | `"Vícenásobný výběr"` | Microsoft’s Czech product terminology uses [vícenásobný výběr](https://support.microsoft.com/cs-cz/access/create-or-delete-a-multivalued-field). | verified |
| `F-cs-072` | `cs` | `tools.database.listView` | label completeness | `"Seznam"` | `"Zobrazení seznamu"` | The accessible label names the complete list-view surface rather than the list object alone. | verified |
| `F-cs-073` | `cs` | `tools.database.kanbanBoard` | established product terminology | `"Kanban tabule"` | `"Tabule Kanban"` | Microsoft’s Czech Azure DevOps guidance uses [Tabule Kanban](https://learn.microsoft.com/cs-cz/azure/devops/boards/boards/kanban-overview). | verified |
| `F-cs-074` | `cs` | `tools.database.cardDetails` | context / label completeness | `"Karta"` | `"Podrobnosti karty"` | The heading labels the card-details panel, not the card object alone. | verified |
| `F-cs-075` | `cs` | `tools.bookmark.loading` | progress clarity / source synchronization | `"Načítání náhledu odkazu"` | `"Načítání náhledu…"` | The rendered in-progress state requires the corpus-standard ellipsis; the view context already identifies the link. | verified |
| `F-cs-076` | `cs` | `tools.embed.empty` | read-only context / source synchronization | `"Vložte odkaz pro vložený obsah"` | `"Chybí odkaz na vložený obsah"` | The caller renders this only in read-only mode, where a paste instruction cannot be performed. | verified |
| `F-cs-077` | `cs` | `tools.linkPaste.embed` | natural action terminology / source-only contract | `"Vytvořit vložení"` | `"Vložit obsah"` | The paste-menu action needs a direct embed command rather than an awkward nominal calque. | verified |
| `F-cs-078` | `cs` | `tools.linkPaste.embedVideo` | provider-template grammar | `"Vložit video z {provider}"` | `"Vložit video ze služby {provider}"` | `ze služby` keeps literal provider names grammatical without declining them. | verified |
| `F-cs-079` | `cs` | `tools.linkPaste.embedAudio` | provider-template grammar / terminology | `"Vložit audio z {provider}"` | `"Vložit zvuk ze služby {provider}"` | The replacement uses natural Czech media wording and keeps provider names uninflected. | verified |
| `F-cs-080` | `cs` | `tools.linkPaste.embedImage` | provider-template grammar | `"Vložit obrázek z {provider}"` | `"Vložit obrázek ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-081` | `cs` | `tools.linkPaste.embedSocial` | provider-template grammar | `"Vložit příspěvek z {provider}"` | `"Vložit příspěvek ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-082` | `cs` | `tools.linkPaste.embedDocument` | provider-template grammar | `"Vložit dokument z {provider}"` | `"Vložit dokument ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-083` | `cs` | `tools.linkPaste.embedTable` | provider-template grammar | `"Vložit tabulku z {provider}"` | `"Vložit tabulku ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-084` | `cs` | `tools.linkPaste.embedForm` | provider-template grammar | `"Vložit formulář z {provider}"` | `"Vložit formulář ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-085` | `cs` | `tools.linkPaste.embedCode` | provider-template grammar | `"Vložit kód z {provider}"` | `"Vložit kód ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-086` | `cs` | `tools.linkPaste.embedDesign` | provider-template grammar | `"Vložit návrh z {provider}"` | `"Vložit návrh ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-087` | `cs` | `tools.linkPaste.embedChart` | provider-template grammar | `"Vložit graf z {provider}"` | `"Vložit graf ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-088` | `cs` | `tools.linkPaste.embedMap` | provider-template grammar | `"Vložit mapu z {provider}"` | `"Vložit mapu ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-089` | `cs` | `tools.linkPaste.embedCalendar` | provider-template grammar | `"Vložit kalendář z {provider}"` | `"Vložit kalendář ze služby {provider}"` | `ze služby` keeps every registered provider name grammatical. | verified |
| `F-cs-090` | `cs` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Zmínka"` | `"Zmínit"` | The paste-menu item requires an action alongside the other commands, not an object noun. | verified |
| `F-cs-091` | `cs` | `toolbox.optionAddAbove` | shortcut / action completeness | `"⌥ — přidat nad"` | `"⌥ + kliknutí – přidat nad"` | The plus-button caller requires a modified click, but the old tooltip presents only a modifier and an unrelated action fragment; Apple’s Czech guidance describes [Option with clicking](https://support.apple.com/cs-cz/102650) as a combined gesture. | verified |
| `F-cs-092` | `cs` | `toolbox.ctrlAddAbove` | shortcut / action completeness | `"Ctrl — přidat nad"` | `"Ctrl + kliknutí – přidat nad"` | The plus-button caller requires Ctrl-click, so the tooltip must name the click gesture as well as the modifier; Czech interface guidance conventionally joins keys and gestures with `+`. | verified |
| `F-cs-093` | `cs` | `tools.image.previewControls` | accessibility / object context | `"Ovládání náhledu"` | `"Ovládací prvky náhledu obrázku"` | This accessible group name labels the live image-preview toolbar; the old abstract wording neither names concrete controls nor identifies the image object. | verified |
| `F-cs-094` | `cs` | `tools.image.navigationControls` | accessibility / navigation relationship | `"Navigace obrázků"` | `"Navigace mezi obrázky"` | The landmark contains previous/next controls for moving between gallery images; the old genitive phrase can instead mean image-based navigation. | verified |
| `F-cs-095` | `cs` | `tools.video.alignmentLeft` | action terminology | `"Vlevo"` | `"Zarovnat vlevo"` | This settings child performs an alignment action and has no separate accessible label; Google’s Czech editor UI uses [`Zarovnat vlevo`](https://support.google.com/docs/answer/4492226?hl=cs). | verified |
| `F-cs-096` | `cs` | `tools.video.alignmentCenter` | action terminology | `"Na střed"` | `"Zarovnat na střed"` | This settings child performs an alignment action rather than merely naming a position; Google’s Czech editor UI uses `Zarovnat na střed`. | verified |
| `F-cs-097` | `cs` | `tools.video.alignmentRight` | action terminology | `"Vpravo"` | `"Zarovnat vpravo"` | This settings child performs an alignment action and has no separate accessible label; Google’s Czech editor UI uses `Zarovnat vpravo`. | verified |
| `F-cs-098` | `cs` | `tools.audio.alignmentLeft` | action terminology | `"Vlevo"` | `"Zarovnat vlevo"` | The audio settings item performs the same alignment action as its video counterpart and needs the same explicit Czech command. | verified |
| `F-cs-099` | `cs` | `tools.audio.alignmentCenter` | action terminology | `"Na střed"` | `"Zarovnat na střed"` | The audio settings item performs the same alignment action as its video counterpart and needs the same explicit Czech command. | verified |
| `F-cs-100` | `cs` | `tools.audio.alignmentRight` | action terminology | `"Vpravo"` | `"Zarovnat vpravo"` | The audio settings item performs the same alignment action as its video counterpart and needs the same explicit Czech command. | verified |
| `F-cs-101` | `cs` | `blockSettings.dragToMove` | natural tooltip grammar | `"Přetáhněte pro přesunutí"` | `"Přetažením přesunete"` | Czech product instructions express the means with the instrumental form; the old infinitive-after-`pro` construction is a literal English calque. | verified |
| `F-cs-102` | `cs` | `blockSettings.clickToOpenMenu` | natural tooltip grammar / accessibility | `"Klikněte pro otevření nabídky"` | `"Kliknutím otevřete nabídku"` | The standalone accessible name needs the natural Czech instrumental construction rather than a literal “click for opening” calque. | verified |
| `F-cs-103` | `cs` | `toolbox.addBelow` | natural tooltip grammar / object clarity | `"Klikněte pro přidání pod"` | `"Kliknutím přidáte blok níže"` | The plus-button tooltip’s old calque ends with a dangling preposition; the replacement names the added block and reads naturally. | verified |
| `F-cs-104` | `cs` | `tools.table.clickToAddRow` | natural instruction grammar | `"Klikněte pro přidání nového řádku"` | `"Kliknutím přidáte nový řádek"` | The table resize helper needs the conventional instrumental action construction instead of an English syntactic calque. | verified |
| `F-cs-105` | `cs` | `tools.table.dragToAddRemoveRows` | natural instruction grammar | `"Přetáhněte pro přidání nebo odebrání řádků"` | `"Přetažením přidáte nebo odeberete řádky"` | The resize helper describes the result of dragging; instrumental phrasing is concise and idiomatic Czech. | verified |
| `F-cs-106` | `cs` | `tools.table.clickToAddColumn` | natural instruction grammar | `"Klikněte pro přidání nového sloupce"` | `"Kliknutím přidáte nový sloupec"` | The table resize helper needs the conventional instrumental action construction instead of an English syntactic calque. | verified |
| `F-cs-107` | `cs` | `tools.table.dragToAddRemoveColumns` | natural instruction grammar | `"Přetáhněte pro přidání nebo odebrání sloupců"` | `"Přetažením přidáte nebo odeberete sloupce"` | The resize helper describes the result of dragging; instrumental phrasing is concise and idiomatic Czech. | verified |
| `F-cs-108` | `cs` | `a11y.atTop` | grammar / accessibility | `"Blok je na začátku, nelze přesunout výše"` | `"Blok je na začátku a nelze jej přesunout výše"` | The keyboard boundary announcement needs a conjunction and explicit object; the old comma joins an elliptical clause. | verified |
| `F-cs-109` | `cs` | `a11y.atBottom` | grammar / accessibility | `"Blok je na konci, nelze přesunout níže"` | `"Blok je na konci a nelze jej přesunout níže"` | The keyboard boundary announcement needs a conjunction and explicit object; the old comma joins an elliptical clause. | verified |
| `F-cs-110` | `cs` | `blockSettings.copyLinkError` | feedback object clarity | `"Odkaz se nepodařilo zkopírovat"` | `"Odkaz na blok se nepodařilo zkopírovat"` | The toast must identify the block link whose copy action failed, matching the initiating command and success feedback context. | verified |
| `F-cs-111` | `cs` | `tools.callout.emojiCategoryPeople` | category scope / accessibility | `"Lidé"` | `"Smajlíci a lidé"` | The visible heading and navigation accessible name cover smileys as well as people; the bundled Czech emoji-picker localization names both scopes. | verified |
| `F-cs-112` | `cs` | `tools.callout.emojiCategoryNature` | category scope / accessibility | `"Příroda"` | `"Zvířata a příroda"` | The category begins with and contains animals as well as plants; the bundled Czech emoji-picker localization names both scopes. | verified |
| `F-cs-113` | `cs` | `tools.callout.emojiCategoryFood` | category scope / accessibility | `"Jídlo"` | `"Jídlo a pití"` | The category contains food and beverages, and the bundled Czech emoji-picker localization names both scopes. | verified |
| `F-cs-114` | `cs` | `tools.callout.emojiCategoryTravel` | category scope / accessibility | `"Cestování"` | `"Cestování a místa"` | The category contains geography and buildings as well as travel; Microsoft Czech and the bundled picker localization name both scopes. | verified |
| `F-cs-115` | `cs` | `tools.image.emptyDropToUpload` | natural drop-overlay instruction | `"Pusťte pro nahrání"` | `"Uvolněním nahrajete soubor"` | The drag overlay appears while a file is held over the image target; Czech interfaces describe the release result with instrumental wording rather than the literal `pro` calque. | verified |
| `F-cs-116` | `cs` | `tools.file.emptyDropToUpload` | natural drop-overlay instruction | `"Pusťte pro nahrání"` | `"Uvolněním nahrajete soubor"` | The file drop overlay needs the same idiomatic release instruction as the other upload targets. | verified |
| `F-cs-117` | `cs` | `tools.video.emptyDropToUpload` | natural drop-overlay instruction | `"Pusťte pro nahrání"` | `"Uvolněním nahrajete soubor"` | The video drop overlay needs the same idiomatic release instruction as the other upload targets. | verified |
| `F-cs-118` | `cs` | `tools.audio.emptyDropToUpload` | natural drop-overlay instruction | `"Pusťte pro nahrání"` | `"Uvolněním nahrajete soubor"` | The audio drop overlay needs the same idiomatic release instruction as the other upload targets. | verified |
| `F-cs-119` | `cs` | `tools.audio.coverDropToUpload` | natural drop-overlay instruction | `"Pusťte pro nahrání"` | `"Uvolněním nahrajete soubor"` | The cover-image drop overlay needs the same idiomatic release instruction as the other upload targets. | verified |
| `F-cs-120` | `cs` | `blockSettings.clickAction` | fragment composition / grammar | `"Klikněte"` | `"Kliknutím"` | In read-only mode this fragment composes with `openMenuAction`; in editable mode it precedes the alternative shortcut. The instrumental form makes both complete Czech sentences. | verified |
| `F-cs-121` | `cs` | `blockSettings.orConjunction` | fragment composition / grammar | `" nebo "` | `" nebo stisknutím "` | The settings-tooltip fragment must introduce a keyboard shortcut as an alternative means, yielding “Kliknutím nebo stisknutím Ctrl+/ …” while preserving both boundary spaces. | verified |
| `F-cs-122` | `cs` | `blockSettings.openMenuAction` | fragment composition / grammar | `" pro otevření nabídky"` | `" otevřete nabídku"` | Combined with `clickAction` and the optional shortcut fragment, the predicate produces natural Czech in both read-only and editable tooltip variants while preserving its leading space. | verified |
| `F-da-070` | `da` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Ryd formatering"` | Microsoft’s Danish editor UI uses the exact concise command [Ryd formatering](https://support.microsoft.com/da-dk/office/rydde-al-tekstformatering-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-da-071` | `da` | `tools.table.clearSelection` | context / action accuracy | `"Ryd"` | `"Ryd indhold"` | Both table callers clear selected cell, row, or column contents while preserving the cells and formatting; Microsoft Excel uses the exact Danish command [Ryd indhold](https://support.microsoft.com/da-dk/office/arbejd-med-links-i-excel-7fc80d8d-68f9-482f-ab01-584c44d72b3e). | verified |
| `F-da-072` | `da` | `a11y.navigatedToBlock` | grammar / accessibility | `"Navigeret til blok"` | `"Navigeret til blokken"` | The announcement refers to the definite block that just received navigation focus, so the bare indefinite noun is unnatural. | verified |
| `F-da-073` | `da` | `a11y.dropCreateColumnLeft` | event timing / accessibility | `"Opretter en kolonne til venstre"` | `"Der oprettes en kolonne til venstre"` | The live-region message describes the prospective drop result, not an action already in progress; the passive future-result wording preserves that timing without an omitted subject. | verified |
| `F-da-074` | `da` | `a11y.dropCreateColumnRight` | event timing / accessibility | `"Opretter en kolonne til højre"` | `"Der oprettes en kolonne til højre"` | The live-region message describes the prospective drop result, not an action already in progress; the passive future-result wording preserves that timing without an omitted subject. | verified |
| `F-da-075` | `da` | `tools.callout.emojiCategoryActivity` | established emoji-category terminology / number | `"Aktivitet"` | `"Aktiviteter"` | The emoji picker renders a category heading and navigation label; Microsoft Teams’ Danish emoji gallery uses the plural category name [Aktiviteter](https://support.microsoft.com/da-dk/teams/chat/send-an-emoji-gif-or-sticker-in-microsoft-teams). | verified |
| `F-da-076` | `da` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"URL’en returnerede en fejl. Prøv en anden kilde, eller upload filen igen."` | `"Billedet kunne ikke indlæses fra denne URL. Prøv en anden kilde, eller upload filen igen."` | A URL does not itself return an error; the replacement directly identifies the failed image load while preserving the concise recovery instruction. | verified |
| `F-de-073` | `de` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Formatierung löschen"` | Microsoft’s German editor UI uses the exact command [Formatierung löschen](https://support.microsoft.com/de-DE/PowerPoint/clear-all-text-formatting). | verified |
| `F-de-074` | `de` | `blockSettings.clickAction` | caller composition / naturalness | `"Klicken"` | `"Mit einem Klick"` | The fragment is composed by the settings toggler with `openMenuAction`; the replacement produces the natural instruction `Mit einem Klick [oder ⌘/] das Menü öffnen`. | verified |
| `F-de-075` | `de` | `blockSettings.openMenuAction` | caller composition / naturalness | `" zum Öffnen des Menüs"` | `" das Menü öffnen"` | The leading-space fragment must compose with `clickAction` and an optional shortcut; the current pair recreates the stilted wording already rejected by `F-de-002`. | verified |
| `F-de-076` | `de` | `tools.colorPicker.defaultSwatchLabel` | accessibility / caller composition | `"{mode} {default}"` | `"{mode}: {default}"` | The template is a swatch accessible name; punctuation separates label and value so callers produce natural output such as `Textfarbe: Standard`. | verified |
| `F-de-077` | `de` | `tools.colorPicker.colorSwatchLabel` | accessibility / caller composition | `"{mode} {color}"` | `"{mode}: {color}"` | The template is a swatch accessible name; punctuation separates label and value so callers produce natural output such as `Textfarbe: Rot`. | verified |
| `F-de-078` | `de` | `tools.table.comfortableText` | naturalness / density terminology | `"Komfortabler Text"` | `"Luftiger Text"` | The current label is an English calque; Microsoft describes the roomier density using [großzügigere Abstände](https://support.microsoft.com/de-de/office/sie-bevorzugen-geringere-abst%C3%A4nde-7aedcfaf-03de-49ad-9bf8-8730134f1f3b), and `Luftiger Text` forms a concise contrast with compact text. | verified |
| `F-de-079` | `de` | `tools.callout.skinTone` | established product terminology | `"Hautfarbe"` | `"Hautton"` | Microsoft’s German emoji interface uses the exact selector term [Hautton](https://support.microsoft.com/de-DE/teams/chat/select-your-emoji-skin-tone). | verified |
| `F-de-080` | `de` | `tools.link.jumpToSection` | grammar / established product terminology | `"Zu Abschnitt springen"` | `"Zum Abschnitt springen"` | The source-only link action needs the contracted article; Microsoft uses the exact German label [Zum Abschnitt springen](https://support.microsoft.com/de-de/office/formatieren-einer-edition-e4c524cf-cf06-40b5-9ebe-d6d8efd18d27). | verified |
| `F-de-081` | `de` | `tools.video.alignmentLeft` | action terminology | `"Links"` | `"Linksbündig ausrichten"` | The settings item performs an alignment action and has no separate accessible action label; Microsoft German uses `Linksbündig ausrichten`. | verified |
| `F-de-082` | `de` | `tools.video.alignmentCenter` | action terminology | `"Mitte"` | `"Zentriert ausrichten"` | The settings item performs an alignment action; the current noun only names a position rather than the command. | verified |
| `F-de-083` | `de` | `tools.video.alignmentRight` | action terminology | `"Rechts"` | `"Rechtsbündig ausrichten"` | The settings item performs an alignment action and has no separate accessible action label; Microsoft German uses `Rechtsbündig ausrichten`. | verified |
| `F-de-084` | `de` | `tools.audio.alignmentLeft` | action terminology | `"Links"` | `"Linksbündig ausrichten"` | The audio settings item performs the same alignment action as its video counterpart and needs the same explicit command. | verified |
| `F-de-085` | `de` | `tools.audio.alignmentCenter` | action terminology | `"Mitte"` | `"Zentriert ausrichten"` | The audio settings item performs the same alignment action as its video counterpart and needs the same explicit command. | verified |
| `F-de-086` | `de` | `tools.audio.alignmentRight` | action terminology | `"Rechts"` | `"Rechtsbündig ausrichten"` | The audio settings item performs the same alignment action as its video counterpart and needs the same explicit command. | verified |
| `F-de-087` | `de` | `tools.audio.coverSourceAria` | accessibility / context | `"Bildquelle"` | `"Quelle des Coverbilds"` | The accessible tab-group label belongs to the cover-image dialog; generic `Bildquelle` loses the required cover context. | verified |
| `F-de-088` | `de` | `tools.callout.emojiCategoryActivity` | established emoji-category terminology / number | `"Aktivität"` | `"Aktivitäten"` | The emoji picker renders this value as a category heading and category-navigation accessible name; Microsoft Teams’ German emoji catalog uses the plural category label `Aktivitäten`. | verified |
| `F-dv-001` | `dv` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ފޯމެޓްތައް ފޮހޭ"` | TinyMCE’s current Dhivehi rich-text-editor locale maps the exact action Clear formatting to [ފޯމެޓްތައް ފޮހޭ](https://unpkg.com/tinymce-i18n@26.2.9/langs/dv.js), a closer caller match than a composed generic-cleaning phrase. | verified |
| `F-el-001` | `el` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Απαλοιφή μορφοποίησης"` | Microsoft’s Greek editor UI uses the exact command [Απαλοιφή μορφοποίησης](https://support.microsoft.com/el-gr/office/%CE%B1%CF%80%CE%B1%CE%BB%CE%BF%CE%B9%CF%86%CE%AE-%CF%8C%CE%BB%CE%B7%CF%82-%CF%84%CE%B7%CF%82-%CE%BC%CE%BF%CF%81%CF%86%CE%BF%CF%80%CE%BF%CE%AF%CE%B7%CF%83%CE%B7%CF%82-%CE%BA%CE%B5%CE%B9%CE%BC%CE%AD%CE%BD%CE%BF%CF%85-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-es-087` | `es` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Borrar formato"` | Microsoft’s Spanish editor UI uses the exact concise command [Borrar formato](https://support.microsoft.com/es-es/office/borrar-todo-el-formato-de-texto-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-es-088` | `es` | `blockSettings.clickAction` | caller composition / naturalness | `"Clic"` | `"Haz clic"` | The fragment is composed with an optional shortcut and `para abrir el menú`; the imperative produces the natural instruction `Haz clic o ⌘/ para abrir el menú` instead of a bare noun. | verified |
| `F-es-089` | `es` | `tools.colorPicker.defaultSwatchLabel` | accessibility / spoken-label clarity | `"{mode} {default}"` | `"{mode}: {default}"` | The template is a swatch accessible name; the colon separates the mode from its value in output such as `Color del texto: Predeterminado`. | verified |
| `F-es-090` | `es` | `tools.colorPicker.colorSwatchLabel` | accessibility / spoken-label clarity | `"{mode} {color}"` | `"{mode}: {color}"` | The template is a swatch accessible name; the colon makes output such as `Color del texto: Rojo` an unambiguous label-value pair. | verified |
| `F-es-091` | `es` | `tools.table.clearSelection` | context / action accuracy | `"Borrar"` | `"Borrar contenido"` | Both table callers clear selected cell, row, or column contents while preserving the cells and formatting; Microsoft Excel uses the exact Spanish command `Borrar contenido`. | verified |
| `F-es-092` | `es` | `tools.table.comfortableText` | naturalness / density terminology | `"Texto cómodo"` | `"Texto espacioso"` | The current label is an English calque; the option describes the roomier density opposite `Texto compacto`, not emotional comfort. | verified |
| `F-es-093` | `es` | `tools.callout.emojiCategoryActivity` | established emoji-category terminology / number | `"Actividad"` | `"Actividades"` | The emoji picker renders a category heading and navigation label; Microsoft Teams’ Spanish emoji gallery uses the plural category name `Actividades`. | verified |
| `F-es-094` | `es` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"La URL devolvió un error. Prueba con otra fuente o vuelve a subir el archivo."` | `"No se pudo cargar la imagen desde esta URL. Prueba con otra fuente o vuelve a subir el archivo."` | A URL does not itself return an error; the replacement directly identifies the failed image load while retaining the concise informal recovery instruction. | verified |
| `F-es-095` | `es` | `tools.file.previewRaw` | context / source synchronization | `"Sin formato"` | `"Fuente"` | The Markdown tab shows the file’s source text; `Sin formato` describes styling rather than the content and no longer matches the corrected source contract. | verified |
| `F-es-096` | `es` | `tools.file.previewRender` | context / source synchronization | `"Con formato"` | `"Vista previa"` | The tab shows the formatted visual preview; `Con formato` describes a property instead of the familiar preview state. | verified |
| `F-es-097` | `es` | `tools.linkPaste.embed` | action grammar / source-only contract | `"Crear inserción"` | `"Insertar contenido"` | The paste-menu item must name a natural action; `Crear inserción` is an awkward nominal calque, while `Insertar contenido` matches the locale’s established embed terminology. | verified |
| `F-es-098` | `es` | `a11y.navigationModeEntered` | platform terminology / accessibility | `"Modo de navegación. Usa las teclas de flecha para moverte entre bloques, Enter para editar y Escape para salir."` | `"Modo de navegación. Usa las teclas de flecha para moverte entre bloques, Intro para editar y Esc para salir."` | The assertive screen-reader instruction must use Spain Spanish key names; [Notion Spain](https://www.notion.com/es-es/help/keyboard-shortcuts) consistently labels these keys `Intro` and `Esc`. | verified |
| `F-es-099` | `es` | `tools.file.toggleCaption` | grammar / terminology consistency | `"Mostrar u ocultar leyenda"` | `"Mostrar u ocultar la leyenda"` | The live file-settings action refers to the file’s specific caption and must retain the definite article used by the image and video sibling actions. | verified |
| `F-et-001` | `et` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Eemalda vorming"` | Microsoft’s Estonian Word UI uses the exact command [Eemalda vorming](https://support.microsoft.com/et-ee/word/format-your-word-document). | verified |
| `F-fa-001` | `fa` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"پاک کردن قالب‌بندی"` | LibreOffice’s Persian product UI supplies the exact Clear formatting translation [پاک کردن قالب‌بندی](https://github.com/LibreOffice/translations/blob/master/source/fa/svx/messages.po#L6368-L6369). | verified |
| `F-fi-001` | `fi` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Poista muotoilu"` | Microsoft’s Finnish OneNote UI uses the exact concise command [Poista muotoilu](https://support.microsoft.com/fi-fi/office/tekstin-korostaminen-onenoten-verkkoversio-5dadd21f-311c-42a3-8094-281f7bb7e127) for removing inline text styling. | verified |
| `F-fi-002` | `fi` | `toolNames.bold` | terminology / tool name | `"Lihavoitu"` | `"Lihavointi"` | The current state adjective means “bolded”; the toolbox needs the established Finnish formatting-command noun. | verified |
| `F-fi-003` | `fi` | `toolNames.italic` | terminology / tool name | `"Kursiivi"` | `"Kursivointi"` | Use the established Finnish formatting-command term parallel to `Lihavointi`. | verified |
| `F-fi-004` | `fi` | `tools.marker.textColor` | terminology / source synchronization | `"Teksti"` | `"Tekstin väri"` | The current value drops the color concept and collides with plain Text; Microsoft Finnish uses `tekstin väri`. | verified |
| `F-fi-005` | `fi` | `tools.paragraph.placeholder` | grammar / hint clarity | `"Kirjoita jotain tai paina / valitaksesi"` | `"Kirjoita jotain tai paina / valitaksesi työkalun"` | The current instruction is grammatically incomplete because it omits what the slash command selects. | verified |
| `F-fi-006` | `fi` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Tyhjä avattava lohko. Napsauta tai pudota lohkoja sisään."` | `"Tyhjä avattava lohko. Napsauta lisätäksesi lohkon tai vedä lohkoja tähän."` | The caller’s click adds a child block while drag accepts existing blocks; the replacement names both distinct actions. | verified |
| `F-fi-007` | `fi` | `tools.toggle.ariaLabelCollapse` | established UI terminology | `"Pienennä"` | `"Kutista"` | `Pienennä` means reduce or minimize; Microsoft Finnish uses `Kutista` as the counterpart to expand. | verified |
| `F-fi-008` | `fi` | `tools.table.clearSelection` | context / action accuracy | `"Tyhjennä"` | `"Tyhjennä sisältö"` | Both table callers clear cell contents; the corrected source distinguishes this from clearing selection or deleting cells. | verified |
| `F-fi-009` | `fi` | `tools.table.placement` | terminology / source synchronization | `"Sijainti"` | `"Tasaus"` | The picker changes cell-content alignment rather than location; Microsoft Finnish uses `Tasaus`. | verified |
| `F-fi-010` | `fi` | `blockSettings.copyLink` | grammar / semantics | `"Kopioi linkki lohkoon"` | `"Kopioi lohkon linkki"` | The current phrase reads as “copy a link into the block”; the action copies this block’s link. | verified |
| `F-fi-011` | `fi` | `a11y.dropCancelled` | drag terminology / accessibility | `"Veto peruutettu"` | `"Vetäminen peruutettu"` | `Veto` means a pull, bet, or draw; `vetäminen` names the UI drag operation naturally. | verified |
| `F-fi-012` | `fi` | `searchTerms.collapse` | terminology consistency | `"pienennä"` | `"kutista"` | The search alias must use the same established expand/collapse term as the corrected action. | verified |
| `F-fi-013` | `fi` | `tools.callout.addEmoji` | terminology / source synchronization | `"Lisää emoji"` | `"Lisää kuvake"` | The corrected source says Add icon; the callout UI treats the chosen emoji as its icon. | verified |
| `F-fi-014` | `fi` | `tools.callout.filterEmojis` | search clarity / accessibility | `"Suodata…"` | `"Hae emojeja…"` | This is a searchbox placeholder and accessible name; the current generic Filter omits what is searched. | verified |
| `F-fi-015` | `fi` | `tools.callout.pickRandom` | action clarity / accessibility | `"Satunnainen"` | `"Valitse satunnainen emoji"` | The button needs a complete action and object rather than a bare adjective. | verified |
| `F-fi-016` | `fi` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Yhtälö"` | The English fallback must be replaced by the established Finnish mathematical term. | verified |
| `F-fi-017` | `fi` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Syötä LaTeX-kaava…"` | Localizes the full instruction while preserving the LaTeX product name. | verified |
| `F-fi-018` | `fi` | `tools.link.linkTitle` | context / terminology | `"Linkin otsikko"` | `"Linkin teksti"` | The field changes the visible link text, not title metadata. | verified |
| `F-fi-019` | `fi` | `tools.image.sizeFull` | grammar / size label | `"Täysi"` | `"Täysi koko"` | Bare `Täysi` is an incomplete adjective for a size option; the replacement explicitly means full size. | verified |
| `F-fi-020` | `fi` | `tools.image.moreOptions` | terminology / accessibility | `"Lisää asetuksia"` | `"Lisää vaihtoehtoja"` | “Options” are not necessarily settings; Microsoft Finnish uses `Lisää vaihtoehtoja` for overflow actions. | verified |
| `F-fi-021` | `fi` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Muunnetaan…"` | The visible image-processing state retained an English fallback. | verified |
| `F-fi-022` | `fi` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"Kuva on liian suuri. Koko {size} ylittää rajan {max}."` | Localizes the upload error and preserves both placeholders exactly. | verified |
| `F-fi-023` | `fi` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"URL palautti virheen. Kokeile toista lähdettä tai lataa tiedosto uudelleen."` | `"Kuvaa ei voitu ladata tästä URL-osoitteesta. Kokeile toista lähdettä tai lähetä tiedosto uudelleen."` | The corrected source identifies the failed image load; the current value personifies the URL and uses upload/download-ambiguous `lataa`. | verified |
| `F-fi-024` | `fi` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Tiedosto on liian suuri. Koko {size} ylittää rajan {max}."` | Localizes the file-preview error and preserves both placeholders exactly. | verified |
| `F-fi-025` | `fi` | `tools.file.previewRaw` | source synchronization / tab terminology | `"Koodi"` | `"Lähde"` | The corrected source concept is Source; the Markdown text is not necessarily program code. | verified |
| `F-fi-026` | `fi` | `tools.file.previewRender` | source synchronization / tab terminology | `"Näkymä"` | `"Esikatselu"` | The corrected source concept is Preview; `Näkymä` only means a generic view. | verified |
| `F-fi-027` | `fi` | `tools.video.moreOptions` | terminology / accessibility | `"Lisää asetuksia"` | `"Lisää vaihtoehtoja"` | Same options-versus-settings distinction as the image overflow control. | verified |
| `F-fi-028` | `fi` | `tools.video.loop` | media terminology / state label | `"Toista"` | `"Jatkuva toisto"` | `Toista` also means Play or Repeat and does not clearly name loop mode; YouTube Finnish uses continuous-play terminology. | verified |
| `F-fi-029` | `fi` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"Video on liian suuri. Koko {size} ylittää rajan {max}."` | Localizes the upload error and preserves both placeholders exactly. | verified |
| `F-fi-030` | `fi` | `tools.audio.loop` | media terminology / state label | `"Toista"` | `"Jatkuva toisto"` | Same loop-versus-play ambiguity as the video control. | verified |
| `F-fi-031` | `fi` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Äänitiedosto on liian suuri. Koko {size} ylittää rajan {max}."` | Localizes the error, names the audio file precisely, and preserves both placeholders. | verified |
| `F-fi-032` | `fi` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Kappaleen nimi"` | Apple’s Finnish music metadata uses the natural track-name term. | verified |
| `F-fi-033` | `fi` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"Artisti"` | English `Artist` is not the Finnish noun `Artisti`. | verified |
| `F-fi-034` | `fi` | `tools.audio.emptyOrDropHere` | media terminology / grammar | `"tai pudota ääni tähän"` | `"tai pudota äänitiedosto tähän"` | The drop target accepts an audio file, not abstract sound. | verified |
| `F-fi-035` | `fi` | `tools.audio.emptyUrlPlaceholder` | grammar | `"Liitä äänin URL…"` | `"Liitä äänen URL…"` | `äänin` is not the required singular genitive; use `äänen`. | verified |
| `F-fi-036` | `fi` | `tools.audio.emptyUrlAria` | grammar / accessibility | `"Äänin URL"` | `"Äänen URL"` | Corrects the same singular-genitive error in the accessible label. | verified |
| `F-fi-037` | `fi` | `tools.audio.emptySourceAria` | grammar / accessibility | `"Äänin lähde"` | `"Äänen lähde"` | Corrects the same singular-genitive error in the source-group label. | verified |
| `F-fi-038` | `fi` | `tools.audio.coverChange` | pending translation / media terminology | `"Change cover"` | `"Vaihda kansikuva"` | Localizes the action with Spotify Finnish’s established `kansikuva` term. | verified |
| `F-fi-039` | `fi` | `tools.audio.coverSet` | pending translation / media terminology | `"Set cover image"` | `"Aseta kansikuva"` | Localizes the action with the established music-cover term. | verified |
| `F-fi-040` | `fi` | `tools.audio.coverRemove` | pending translation / media terminology | `"Remove cover"` | `"Poista kansikuva"` | Localizes the action with the established music-cover term. | verified |
| `F-fi-041` | `fi` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Valitse kuvatiedosto"` | Localizes the wrong-file-type recovery instruction. | verified |
| `F-fi-042` | `fi` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"Kuva on liian suuri"` | Localizes the cover-image size error. | verified |
| `F-fi-043` | `fi` | `tools.audio.coverAdd` | pending translation / media terminology | `"Add a cover"` | `"Lisää kansikuva"` | Localizes the empty-cover action with the established music-cover term. | verified |
| `F-fi-044` | `fi` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"Kuvan lähde"` | `"Kansikuvan lähde"` | The generic image-source label loses the cover-specific accessible context. | verified |
| `F-fi-045` | `fi` | `tools.database.viewTypeListDescription` | terminology / source synchronization | `"Yksinkertainen lineaarinen näkymä"` | `"Näytä kohteet yksinkertaisena luettelona"` | The current value changes list to abstract linear view and omits the user-facing action. | verified |
| `F-fi-046` | `fi` | `tools.embed.empty` | read-only context / source synchronization | `"Upota liittämällä linkki"` | `"Ei upotuslinkkiä"` | The caller renders a read-only empty state, where a paste instruction is impossible. | verified |
| `F-fi-047` | `fi` | `notifier.dismiss` | semantics / action | `"Hylkää"` | `"Sulje"` | `Hylkää` means reject; the × button closes the notification. | verified |
| `F-fi-048` | `fi` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"Vaihda aikanäyttö"` | `"Vaihda kuluneen ja jäljellä olevan ajan välillä"` | The accessible name must identify the two states the control switches between. | verified |
| `F-fi-049` | `fi` | `tools.video.speedDecrease` | grammar / action terminology | `"Hidasta toistonopeutta"` | `"Pienennä toistonopeutta"` | The current phrase awkwardly means “slow the speed”; the paired quantitative action is decrease. | verified |
| `F-fi-050` | `fi` | `tools.video.speedIncrease` | grammar / action terminology | `"Nopeuta toistonopeutta"` | `"Suurenna toistonopeutta"` | The current phrase redundantly means “speed up the speed”; use the paired quantitative action. | verified |
| `F-fi-051` | `fi` | `tools.video.ctxStats` | slang / source synchronization | `"Tilastot nörteille"` | `"Toistotilastot"` | The current value retains prohibited “Stats for nerds” slang; the corrected source is neutral Playback statistics. | verified |
| `F-fi-052` | `fi` | `tools.audio.speedDecrease` | grammar / action terminology | `"Hidasta toistonopeutta"` | `"Pienennä toistonopeutta"` | Same decrease terminology issue as the video control. | verified |
| `F-fi-053` | `fi` | `tools.audio.speedIncrease` | grammar / action terminology | `"Nopeuta toistonopeutta"` | `"Suurenna toistonopeutta"` | Same increase terminology issue as the video control. | verified |
| `F-fi-054` | `fi` | `tools.colorPicker.defaultSwatchLabel` | accessibility / spoken-label clarity | `"{mode} {default}"` | `"{mode}: {default}"` | The template is the swatch’s accessible name; punctuation separates the mode from the value so assistive technology reads `Tekstin väri: Oletus` as a label-value pair. | verified |
| `F-fi-055` | `fi` | `tools.colorPicker.colorSwatchLabel` | accessibility / spoken-label clarity | `"{mode} {color}"` | `"{mode}: {color}"` | The template is the swatch’s accessible name; punctuation separates the mode from color values such as `Tekstin väri: Harmaa`. | verified |
| `F-fi-056` | `fi` | `tools.code.searchLanguage` | number / punctuation / source synchronization | `"Hae kieltä..."` | `"Hae kieliä…"` | The search covers a list of languages, so the object must be plural; continuing input uses the corpus-standard U+2026 ellipsis. | verified |
| `F-fi-057` | `fi` | `tools.image.exitFullscreen` | grammar / action terminology | `"Poistu koko näytöltä"` | `"Poistu koko näytön tilasta"` | The action exits full-screen mode rather than leaving a physical screen; the replacement names the mode idiomatically. | verified |
| `F-fi-058` | `fi` | `tools.bookmark.loading` | progress context / source synchronization | `"Ladataan esikatselua"` | `"Ladataan linkin esikatselua…"` | The rendered loading state must identify the link preview and use an ellipsis to signal continuing work. | verified |
| `F-fi-059` | `fi` | `tools.video.fullscreenExit` | grammar / action terminology | `"Poistu koko näytöstä"` | `"Poistu koko näytön tilasta"` | The control exits full-screen mode; the current phrase incorrectly describes leaving the screen itself. | verified |
| `F-fi-060` | `fi` | `tools.video.speedPresets` | accessibility / control-group context | `"Nopeusasetukset"` | `"Esiasetetut nopeudet"` | This accessible label names the preset-speed chip group, not playback-speed settings generally. | verified |
| `F-fi-061` | `fi` | `blockSettings.convertWithChildrenWarning` | number / source synchronization | `"Tässä lohkossa on {count} sisäkkäistä lohkoa. Muuntaminen siirtää ne ylimmälle tasolle. Jatketaanko?"` | `"Sisäkkäisiä lohkoja: {count}. Tämän lohkon muuntaminen siirtää sisäkkäisen sisällön ylimmälle tasolle. Jatketaanko?"` | The source-only count can be one or many; the current partitive-plural noun and plural pronoun fail at `{count}=1`, while `sisäkkäinen sisältö` remains count-neutral. | verified |
| `F-fi-062` | `fi` | `a11y.searchResults` | number / accessibility | `"{count} tulosta"` | `"Hakutuloksia: {count}"` | The search live region can announce one result; moving the invariant count after a descriptive partitive-plural label avoids the Finnish one-versus-many case change. | verified |
| `F-fi-063` | `fi` | `a11y.allBlocksSelected` | number / accessibility | `"Kaikki lohkot valittu, {count} lohkoa"` | `"Kaikki lohkot valittu. Lohkoja yhteensä: {count}"` | Select-all can contain one block; the count-neutral label avoids an ungrammatical partitive noun at `{count}=1` and separates the completed state from its total. | verified |
| `F-fi-064` | `fi` | `tools.audio.errorOneDrive` | compound spelling | `"OneDrive -linkkejä ei voi toistaa suoraan — lataa tiedosto ja lähetä se tähän."` | `"OneDrive-linkkejä ei voi toistaa suoraan — lataa tiedosto ja lähetä se tähän."` | A one-word proper name attaches directly to the Finnish common-noun compound with a hyphen; Microsoft likewise writes [OneDrive-linkki](https://support.microsoft.com/fi-FI/onedrive/share-files-and-folders-in-microsoft-onedrive). | verified |
| `F-fi-065` | `fi` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emojia löytyi"` | `"Emojihaun tuloksia: {count}"` | The emoji-search live region can announce one or many matches; a label-before-count construction avoids Finnish numeral-governed case changes. | verified |
| `F-fi-066` | `fi` | `toolbox.optionAddAbove` | platform shortcut / action clarity | `"Option-napsautus lisää yläpuolelle"` | `"Optio-klikkaa lisätäksesi yläpuolelle"` | The tooltip must name the modifier-click action in natural Finnish; Apple’s Finnish Mac guidance uses the exact `Optio-klikkaa` idiom. | verified |
| `F-fi-067` | `fi` | `toolbox.ctrlAddAbove` | shortcut / action clarity | `"Ctrl-napsautus lisää yläpuolelle"` | `"Ctrl+napsauta lisätäksesi yläpuolelle"` | The tooltip must tell the user to Ctrl-click rather than exposing an awkward action noun; Microsoft Finnish uses `Ctrl+napsauta` for this gesture. | verified |
| `F-fi-068` | `fi` | `searchTerms.header` | semantic alias / search coverage | `"ylätunniste"` | `"otsake"` | This alias targets the heading tool, while `ylätunniste` means a page header; `otsake` is a distinct heading synonym and does not duplicate `searchTerms.title=otsikko`. | verified |
| `F-fi-069` | `fi` | `tools.callout.skinTone` | established product terminology | `"Ihonväri"` | `"Ihon sävy"` | Microsoft’s Finnish emoji selector uses the exact term `Ihon sävy`. | verified |
| `F-fi-070` | `fi` | `tools.video.alignmentLeft` | action terminology | `"Vasen"` | `"Tasaa vasemmalle"` | The video settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-fi-071` | `fi` | `tools.video.alignmentCenter` | action terminology | `"Keskellä"` | `"Tasaa keskelle"` | The video settings item performs an alignment action; the current adverb only describes a state. | verified |
| `F-fi-072` | `fi` | `tools.video.alignmentRight` | action terminology | `"Oikea"` | `"Tasaa oikealle"` | The video settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-fi-073` | `fi` | `tools.audio.alignmentLeft` | action terminology | `"Vasen"` | `"Tasaa vasemmalle"` | The audio settings item performs the same alignment action as its video counterpart. | verified |
| `F-fi-074` | `fi` | `tools.audio.alignmentCenter` | action terminology | `"Keskellä"` | `"Tasaa keskelle"` | The audio settings item performs the same alignment action as its video counterpart. | verified |
| `F-fi-075` | `fi` | `tools.audio.alignmentRight` | action terminology | `"Oikea"` | `"Tasaa oikealle"` | The audio settings item performs the same alignment action as its video counterpart. | verified |
| `F-fi-076` | `fi` | `tools.bookmark.error` | context / source synchronization | `"Esikatselua ei voitu ladata"` | `"Linkin esikatselua ei voitu ladata"` | The rendered error must identify the failed link preview rather than an unspecified preview. | verified |
| `F-fi-077` | `fi` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Maininta"` | `"Mainitse"` | The paste-menu contract names an action alongside imperatives; the current noun means “a mention” rather than “mention.” | verified |
| `F-fi-078` | `fi` | `searchTerms.bullet` | semantic alias / search coverage | `"luettelo"` | `"luettelomerkki"` | This alias targets the bullet concept inside the bulleted-list group; `luettelo` only repeats the broader list concept, while Microsoft uses [luettelomerkki](https://support.microsoft.com/fi-fi/office/luettelon-luettelomerkkien-riviv%C3%A4lin-muuttaminen-word-2c83b66f-3ac3-45cf-976a-ba3639ae4f06). | verified |
| `F-fi-079` | `fi` | `searchTerms.info` | semantic alias / search coverage | `"tiedote"` | `"tieto"` | `Tiedote` means an announcement or bulletin; the callout alias must express information, for which Finnish language guidance uses `tieto`. | verified |
| `F-fi-080` | `fi` | `tools.image.altDescription` | accessibility / source synchronization | `"Lisää vaihtoehtoinen teksti, joka kuvaa tämän kuvan. Näin sivu on saavutettavampi heikkonäköisille ja sokeille."` | `"Kuvaile tätä kuvaa käyttäjille, jotka eivät näe sitä."` | The dialog already supplies the alternative-text context; the corrected source is concise and user-centered, matching Microsoft’s Finnish accessibility framing for [users who cannot see an image](https://support.microsoft.com/fi-FI/accessibility/office-accessibility/add-alternative-text-to-a-shape-picture-chart-smartart-graphic-or-other-object). | verified |
| `F-fi-081` | `fi` | `a11y.dropCreateColumnLeft` | prospective drag context / accessibility | `"Luo sarakkeen vasemmalle"` | `"Kun pudotat, vasemmalle luodaan sarake"` | The live region announces a prospective result while the pointer hovers before drop; the current phrase is neither a clear future result nor a grammatical imperative. | verified |
| `F-fi-082` | `fi` | `a11y.dropCreateColumnRight` | prospective drag context / accessibility | `"Luo sarakkeen oikealle"` | `"Kun pudotat, oikealle luodaan sarake"` | The live region announces a prospective result while the pointer hovers before drop; the current phrase is neither a clear future result nor a grammatical imperative. | verified |
| `F-fi-083` | `fi` | `tools.linkPaste.embedVideo` | provider composition / grammar | `"Upota {provider}-video"` | `"Upota video palvelusta {provider}"` | The caller substitutes multiword providers such as `VK Video` and `Tencent Video`; provider-final grammar avoids malformed compounds while preserving `{provider}`. | verified |
| `F-fi-084` | `fi` | `tools.linkPaste.embedAudio` | provider composition / grammar | `"Upota {provider}-äänite"` | `"Upota äänite palvelusta {provider}"` | The caller substitutes multiword providers such as `Apple Music` and `Pocket Casts`; provider-final grammar avoids malformed compounds while preserving `{provider}`. | verified |
| `F-fi-085` | `fi` | `tools.linkPaste.embedSocial` | provider composition / grammar | `"Upota {provider}-julkaisu"` | `"Upota julkaisu palvelusta {provider}"` | The provider registry includes multiword social-service names; provider-final grammar remains correct for every literal substitution and preserves `{provider}`. | verified |
| `F-fi-086` | `fi` | `tools.linkPaste.embedDocument` | provider composition / grammar | `"Upota {provider}-dokumentti"` | `"Upota dokumentti palvelusta {provider}"` | Literal substitution currently produces malformed multiword compounds such as `Google Drive-dokumentti`; provider-final grammar preserves `{provider}` and works for every registry entry. | verified |
| `F-fi-087` | `fi` | `tools.linkPaste.embedTable` | provider composition / grammar | `"Upota {provider}-taulukko"` | `"Upota taulukko palvelusta {provider}"` | Literal substitution currently produces malformed multiword compounds such as `Google Sheets-taulukko`; provider-final grammar preserves `{provider}` and works for every registry entry. | verified |
| `F-fi-088` | `fi` | `tools.linkPaste.embedForm` | provider composition / grammar | `"Upota {provider}-lomake"` | `"Upota lomake palvelusta {provider}"` | Literal substitution currently produces malformed multiword compounds such as `Google Forms-lomake`; provider-final grammar preserves `{provider}` and works for every registry entry. | verified |
| `F-fi-089` | `fi` | `tools.linkPaste.embedCode` | provider composition / grammar | `"Upota {provider}-koodi"` | `"Upota koodi palvelusta {provider}"` | The provider registry includes multiword code-service names; provider-final grammar remains correct for every literal substitution and preserves `{provider}`. | verified |
| `F-fi-090` | `fi` | `tools.linkPaste.embedChart` | provider composition / grammar | `"Upota {provider}-kaavio"` | `"Upota kaavio palvelusta {provider}"` | Literal substitution includes multiword providers such as `Our World in Data`; provider-final grammar remains correct and preserves `{provider}`. | verified |
| `F-fi-091` | `fi` | `tools.linkPaste.embedMap` | provider composition / grammar | `"Upota {provider}-kartta"` | `"Upota kartta palvelusta {provider}"` | Literal substitution includes multiword providers such as `ArcGIS StoryMaps`; provider-final grammar remains correct and preserves `{provider}`. | verified |
| `F-fi-092` | `fi` | `a11y.atTop` | grammar / accessibility | `"Lohko on ylimpänä, ei voi siirtää ylös"` | `"Lohko on ylimpänä eikä sitä voi siirtää ylemmäs"` | The boundary announcement must retain the block as the object of transitive `siirtää`; the old omitted-object construction can make the block sound like the mover. | verified |
| `F-fi-093` | `fi` | `a11y.atBottom` | grammar / accessibility | `"Lohko on alimpana, ei voi siirtää alas"` | `"Lohko on alimpana eikä sitä voi siirtää alemmas"` | The boundary announcement must retain the block as the object of transitive `siirtää`; the old omitted-object construction can make the block sound like the mover. | verified |
| `F-fi-094` | `fi` | `searchTerms.plain` | search semantics / terminology | `"teksti"` | `"pelkkä teksti"` | Bare `teksti` loses the registered “plain” concept and merely repeats the visible Text tool; [Microsoft’s Finnish OneNote guidance](https://support.microsoft.com/fi-fi/office/onenoten-perustoimintojen-k%C3%A4ytt%C3%B6-n%C3%A4yt%C3%B6nlukuohjelman-avulla-32cd532b-d5d4-442b-bc13-1d0ad2016377) uses `pelkkä teksti`, matching this dictionary’s plain-text label. | verified |
| `F-fi-095` | `fi` | `tools.database.cardMenuLabel` | caller context / terminology | `"Kortin asetukset"` | `"Kortin vaihtoehdot"` | The three-dot button opens a card options menu whose current action is Delete, not a settings surface; [Microsoft’s Finnish UI guidance](https://support.microsoft.com/fi-fi/windows/experience/personalization/stay-up-to-date-with-widgets-in-windows) corroborates `vaihtoehdot` for options. | verified |
| `F-fi-096` | `fi` | `tools.image.previewControls` | accessibility / object context | `"Esikatselun hallinta"` | `"Kuvan esikatselun säätimet"` | This is the accessible name of a concrete image-preview toolbar; the old abstract “preview management” wording omits the image object and does not name controls. | verified |
| `F-fi-097` | `fi` | `tools.video.seek` | accessibility / media terminology | `"Kelaa"` | `"Toistokohta"` | The caller is a range slider, so its accessible label must name the controlled playback position rather than issue a seek command; [Apple’s Finnish player guidance](https://support.apple.com/fi-fi/guide/iphone/iphebbd067ce/ios) uses `toistokohta` for the timeline position. | verified |
| `F-fi-098` | `fi` | `tools.toggle.placeholder` | grammar / caller context / terminology | `"Avattava"` | `"Avattava lista"` | The caller renders this as the visible title of an empty toggle block, so the bare adjective is incomplete; the replacement matches this dictionary’s registered tool name and [Notion’s Finnish toggle-list terminology](https://www.notion.com/fi/help/writing-and-editing-basics). | verified |
| `F-fil-001` | `fil` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"I-clear ang pag-format"` | Google’s official Filipino Gmail UI uses the exact toolbar option [I-clear ang pag-format](https://support.google.com/mail/answer/8260?co=GENIE.Platform%3DAndroid&hl=fil), matching this dictionary’s existing clear-action register. | verified |
| `F-fr-125` | `fr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Effacer la mise en forme"` | Microsoft’s French editor UI uses the exact concise command [Effacer la mise en forme](https://support.microsoft.com/fr-fr/office/effacer-toute-la-mise-en-forme-du-texte-c094c4da-7f09-4cea-9a8d-c166949c9c80). | verified |
| `F-fr-126` | `fr` | `tools.colorPicker.defaultSwatchLabel` | punctuation / caller composition | `"{mode} {default}"` | `"{mode} : {default}"` | The caller otherwise produces an ungrammatical adjacency such as `Couleur du texte Par défaut`; the French non-breaking-space colon creates a clear label/value relationship. | verified |
| `F-fr-127` | `fr` | `tools.colorPicker.colorSwatchLabel` | punctuation / caller composition | `"{mode} {color}"` | `"{mode} : {color}"` | The caller otherwise produces an ungrammatical adjacency such as `Couleur du texte Rouge`; the French non-breaking-space colon creates a clear label/value relationship. | verified |
| `F-fr-128` | `fr` | `a11y.navigatedToBlock` | accessibility / event completion | `"Accès au bloc"` | `"Vous avez accédé au bloc"` | Both callers announce completed hash navigation; the full sentence expresses that completed event and follows the locale’s formal-address accessibility register. | verified |
| `F-fr-129` | `fr` | `tools.callout.emojiCategoryActivity` | established emoji-category terminology / number | `"Activité"` | `"Activités"` | The emoji picker renders a category heading rather than one activity; [Microsoft Teams France](https://support.microsoft.com/fr-fr/teams/free/chat-calling/send-an-emoji-or-gif-in-microsoft-teams-free) uses the plural category label `Activités`. | verified |
| `F-fr-130` | `fr` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"L’URL a renvoyé une erreur. Essayez une autre source ou importez de nouveau le fichier."` | `"Impossible de charger l’image depuis cette URL. Essayez une autre source ou importez de nouveau le fichier."` | The corrected source identifies the failed image load; the current text instead personifies the URL and obscures what failed. | verified |
| `F-fr-131` | `fr` | `tools.bookmark.error` | context / source synchronization | `"Impossible de charger l’aperçu"` | `"Impossible de charger l’aperçu du lien"` | The rendered error must identify the failed link preview rather than a generic preview; [Microsoft France](https://support.microsoft.com/fr-fr/office/aper%C3%A7u-du-lien-par-bing-1bcfa7f8-a42b-4d59-bc68-2052868c79ab) uses `aperçu du lien`. | verified |
| `F-gu-001` | `gu` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ફોર્મેટિંગ સાફ કરો"` | An independent terminology pass rejected LibreOffice’s longer Clear Direct Formatting label because its technical qualifier is absent from this concise source. The replacement combines this dictionary’s established `ફોર્મેટિંગ` noun and `સાફ કરો` action; Google’s Gujarati UI independently uses the same formatting loanword. | verified |
| `F-he-001` | `he` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"נקה עיצוב"` | Microsoft’s Hebrew editor UI uses the exact concise command [נקה עיצוב](https://support.microsoft.com/he-IL/PowerPoint/clear-all-text-formatting). | verified |
| `F-hi-001` | `hi` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"टेक्स्ट की फ़ॉर्मैटिंग हटाएं"` | Google Docs’ Hindi shortcut action uses this exact wording in [official help](https://support.google.com/docs/answer/179738?hl=hi), NFC-normalized for the corpus. | verified |
| `F-hr-001` | `hr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Očisti oblikovanje"` | Microsoft’s Croatian editor UI uses the exact concise command [Očisti oblikovanje](https://support.microsoft.com/hr-HR/PowerPoint/clear-all-text-formatting). | verified |
| `F-hu-001` | `hu` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Formázás törlése"` | Microsoft’s Hungarian editor UI uses the exact command [Formázás törlése](https://support.microsoft.com/hu-HU/PowerPoint/clear-all-text-formatting). | verified |
| `F-hy-001` | `hy` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Մաքրել ուղղակի ձևաչափումը"` | LibreOffice’s Armenian Writer UI uses this exact Clear Direct Formatting label in its [official localization source](https://raw.githubusercontent.com/LibreOffice/translations/master/source/hy/officecfg/registry/data/org/openoffice/Office/UI.po). | verified |
| `F-id-001` | `id` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Hapus pemformatan"` | Microsoft’s Indonesian editor UI uses Hapus Pemformatan in [official product help](https://support.microsoft.com/id-ID/PowerPoint/clear-all-text-formatting); the second word is lowercased to the dictionary’s sentence-case register. | verified |
| `F-it-084` | `it` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Cancella formattazione"` | Microsoft’s Italian editor UI uses the exact concise command [Cancella formattazione](https://support.microsoft.com/it-IT/PowerPoint/clear-all-text-formatting). | verified |
| `F-it-085` | `it` | `tools.colorPicker.defaultSwatchLabel` | punctuation / caller composition | `"{mode} {default}"` | `"{mode}: {default}"` | The caller otherwise produces an ambiguous adjacency such as `Colore del testo Predefinito`; the colon creates a natural property/value tooltip while preserving both placeholders. | verified |
| `F-it-086` | `it` | `tools.colorPicker.colorSwatchLabel` | punctuation / caller composition | `"{mode} {color}"` | `"{mode}: {color}"` | The caller otherwise produces an ambiguous adjacency such as `Colore del testo Rosso`; the colon creates a natural property/value tooltip while preserving both placeholders. | verified |
| `F-it-087` | `it` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"L’URL ha restituito un errore. Prova con un’altra fonte o ricarica il file."` | `"Impossibile caricare l’immagine da questo URL. Prova con un’altra fonte o ricarica il file."` | The corrected source identifies the failed image load; the current text instead personifies the URL and obscures what failed. | verified |
| `F-it-088` | `it` | `tools.file.previewRender` | context / source synchronization | `"Formattato"` | `"Anteprima"` | The rendered Markdown tab must name the familiar preview view rather than expose a bare adjective; [Microsoft Italian](https://support.microsoft.com/it-it/office/video-visualizzare-in-anteprima-e-stampare-i-file-bd6cee81-895f-41ca-b940-5e4ad85f18e1) uses `Anteprima`. | verified |
| `F-it-089` | `it` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Menzione"` | `"Menziona"` | The paste-menu item is a clickable action alongside imperatives such as `Mantieni`, `Crea`, and `Incorpora`; the current noun names a mention rather than the action. | verified |
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
| `F-nl-068` | `nl` | `tools.table.headerColumn` | context / terminology | `"Kolomkop"` | `"Koptekstkolom"` | The toggle makes the first column a header column; `Kolomkop` instead denotes a column heading and points toward a header row. Microsoft’s Dutch table guidance uses `koptekstkolom`. | verified |
| `F-nl-069` | `nl` | `tools.table.headerRow` | context / terminology | `"Rijkop"` | `"Koptekstrij"` | The toggle makes the first row a header row; `Rijkop` instead denotes a row heading and points toward a header column. Microsoft’s Dutch table UI uses `Koptekstrij`. | verified |
| `F-nl-070` | `nl` | `tools.table.placementTopLeft` | naturalness / UI terminology | `"Boven links"` | `"Linksboven"` | The current value follows literal English axis order; Adobe’s Dutch 3-by-3 alignment set uses the exact label [Linksboven](https://helpx.adobe.com/nl/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-nl-071` | `nl` | `tools.table.placementTopCenter` | naturalness / UI terminology | `"Boven midden"` | `"Midden boven"` | Adobe’s Dutch 3-by-3 alignment set uses the exact corresponding label [Midden boven](https://helpx.adobe.com/nl/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-nl-072` | `nl` | `tools.table.placementTopRight` | naturalness / UI terminology | `"Boven rechts"` | `"Rechtsboven"` | `Rechtsboven` is the standard Dutch compound and Adobe’s exact corresponding alignment label. | verified |
| `F-nl-073` | `nl` | `tools.table.placementMiddleLeft` | naturalness / UI terminology | `"Midden links"` | `"Linksmidden"` | Adobe’s Dutch 3-by-3 alignment set uses the exact corresponding label `Linksmidden`. | verified |
| `F-nl-074` | `nl` | `tools.table.placementMiddleRight` | naturalness / UI terminology | `"Midden rechts"` | `"Rechtsmidden"` | Adobe’s Dutch 3-by-3 alignment set uses the exact corresponding label `Rechtsmidden`. | verified |
| `F-nl-075` | `nl` | `tools.table.placementBottomLeft` | naturalness / UI terminology | `"Onder links"` | `"Linksonder"` | `Linksonder` is the standard Dutch compound and Adobe’s exact corresponding alignment label. | verified |
| `F-nl-076` | `nl` | `tools.table.placementBottomCenter` | naturalness / UI terminology | `"Onder midden"` | `"Middenonder"` | Adobe’s Dutch 3-by-3 alignment set uses the exact corresponding label `Middenonder`. | verified |
| `F-nl-077` | `nl` | `tools.table.placementBottomRight` | naturalness / UI terminology | `"Onder rechts"` | `"Rechtsonder"` | `Rechtsonder` is the standard Dutch compound and Adobe’s exact corresponding alignment label. | verified |
| `F-nl-078` | `nl` | `toolNames.inlineCode` | orthography / tool name | `"Inline code"` | `"Inlinecode"` | Dutch compounds are not written with the current space. Microsoft’s Dutch Teams UI uses `inlinecode`, while Notion’s hyphenated form independently rejects the spaced spelling. | verified |
| `F-nl-079` | `nl` | `tools.image.errorRetry` | action clarity | `"Opnieuw"` | `"Opnieuw proberen"` | This is a retry button in an error panel; Microsoft Dutch uses the explicit action [Opnieuw proberen](https://support.microsoft.com/nl-nl/topic/-er-is-iets-misgegaan-maar-je-kunt-het-nog-eens-proberen-msa-b211f0a3-d7a9-e12e-1580-dfbe9b9c820e). | verified |
| `F-nl-080` | `nl` | `tools.database.propertyTypeSelect` | established product terminology | `"Keuze"` | `"Selecteren"` | Notion Dutch uses the exact database-property label [Selecteren](https://www.notion.com/nl/help/database-properties). | verified |
| `F-nl-081` | `nl` | `tools.database.propertyTypeMultiSelect` | established product terminology | `"Meervoudige keuze"` | `"Meerdere selecteren"` | Notion Dutch uses `Meerdere selecteren`; the current phrase reads like a multiple-choice question type. | verified |
| `F-nl-082` | `nl` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Vermelding"` | `"Vermelden"` | `buildPasteMenuItems` defines an action title even though the live controller currently filters it out. Notion Dutch uses action wording such as `Een persoon vermelden`. | verified |
| `F-nl-083` | `nl` | `tools.file.previewRender` | terminology / source synchronization | `"Weergave"` | `"Voorbeeld"` | The corrected source says Preview, and all surrounding Dutch file-preview labels plus `tools.code.previewTab` already use `Voorbeeld`. | verified |
| `F-nl-084` | `nl` | `tools.video.theater` | established product terminology | `"Bioscoopmodus"` | `"Theatermodus"` | The control implements the familiar expanded in-page player mode; official YouTube Dutch uses [Theatermodus](https://support.google.com/youtube/answer/6052392?hl=nl). | verified |
| `F-nl-085` | `nl` | `tools.video.theaterExit` | terminology consistency | `"Bioscoopmodus sluiten"` | `"Theatermodus sluiten"` | The exit action must match the corrected mode name and the established `… sluiten` pattern. | verified |
| `F-no-075` | `no` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Fjern formatering"` | Microsoft’s Norwegian Bokmål editor UI uses the exact concise command [Fjern formatering](https://support.microsoft.com/nb-NO/PowerPoint/clear-all-text-formatting). | verified |
| `F-no-076` | `no` | `tools.colorPicker.defaultSwatchLabel` | grammar / placeholder order | `"{mode} {default}"` | `"{default} {mode}"` | The caller currently produces unnatural `Tekstfarge Standard`; the replacement produces `Standard tekstfarge`, matching Microsoft’s established Norwegian phrase [standard tekstfarge](https://support.microsoft.com/nb-no/office/endre-standard-tekstfarge-skriftfarge-i-word-59f83009-12c2-4feb-b548-93621dfe6f2f). | verified |
| `F-no-077` | `no` | `tools.colorPicker.colorSwatchLabel` | grammar / placeholder order | `"{mode} {color}"` | `"{color} {mode}"` | The caller substitutes labels such as `Tekstfarge Rød` and `Bakgrunn Rød`; idiomatic Bokmål is `Rød tekstfarge` and `Rød bakgrunn`. | verified |
| `F-no-078` | `no` | `tools.file.previewRaw` | source synchronization / tab terminology | `"Råtekst"` | `"Kilde"` | The corrected source concept is the Markdown source view paired with Preview. `Kilde` is the concise user-facing tab label. | verified |
| `F-no-079` | `no` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Omtale"` | `"Omtal"` | `buildPasteMenuItems` defines an action title alongside imperatives such as `Behold`, `Opprett`, and `Bygg inn`. Notion Bokmål uses the imperative phrases [Omtal en person and Omtal en side](https://www.notion.com/nb/help/writing-and-editing-basics). | verified |
| `F-no-080` | `no` | `tools.callout.emojiCategoryActivity` | established emoji-category terminology / number | `"Aktivitet"` | `"Aktiviteter"` | The emoji picker renders a category heading rather than a single activity; [Microsoft Teams Bokmål](https://support.microsoft.com/nb-no/teams/chat/send-an-emoji-gif-or-sticker-in-microsoft-teams) uses the plural category label `Aktiviteter`. | verified |
| `F-no-081` | `no` | `tools.image.previewControls` | accessibility / object context | `"Kontroller for forhåndsvisning"` | `"Kontroller for forhåndsvisning av bilde"` | The value labels the live image-preview toolbar, so the accessible name must retain the controlled image object; [Apple’s Bokmål guidance](https://support.apple.com/no-no/guide/pages-iphone/tana6bcd99e0/ios) corroborates the `Kontroller for … av …` construction. | verified |
| `F-pa-001` | `pa` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"ਫਾਰਮੈਟਿੰਗ ਸਾਫ਼ ਕਰੋ"` | LibreOffice Punjabi uses `ਸਿੱਧੀ ਫਾਰਮੈਟਿੰਗ ਸਾਫ਼ ਕਰੋ` for Clear Direct Formatting in its [official product source](https://github.com/LibreOffice/translations/blob/master/source/pa-IN/officecfg/registry/data/org/openoffice/Office/UI.po#L34689-L34695); the direct qualifier and accelerator are omitted for this compact inline command. | verified |
| `F-pl-001` | `pl` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Wyczyść formatowanie"` | Microsoft’s Polish editor UI uses the exact command [Wyczyść formatowanie](https://support.microsoft.com/pl-PL/PowerPoint/clear-all-text-formatting). | verified |
| `F-pl-002` | `pl` | `blockSettings.convertWithChildrenWarning` | number / terminology / source synchronization | `"Ten blok zawiera {count} zagnieżdżonych bloków. Po konwersji zostaną one przeniesione na poziom główny. Kontynuować?"` | `"Liczba zagnieżdżonych bloków: {count}. Przekształcenie tego bloku przeniesie zagnieżdżoną zawartość na poziom główny. Kontynuować?"` | The source-only count can be one or many; label-before-count wording avoids numeral inflection, and count-neutral `zagnieżdżoną zawartość` remains grammatical when `{count}=1`, unlike plural `je`. | verified |
| `F-pl-003` | `pl` | `toolbox.optionAddAbove` | shortcut clarity | `"⌥ — dodaj powyżej"` | `"Kliknij z naciśniętym klawiszem ⌥, aby dodać powyżej"` | The toolbox hint requires an Option-click gesture; Apple’s Polish shortcut guidance identifies Option with `⌥`. | verified |
| `F-pl-004` | `pl` | `toolbox.ctrlAddAbove` | shortcut clarity | `"Ctrl — dodaj powyżej"` | `"Kliknij z naciśniętym klawiszem Ctrl, aby dodać powyżej"` | The Windows hint omitted the click gesture and therefore did not describe the actual action. | verified |
| `F-pl-005` | `pl` | `tools.marker.textColor` | terminology / source synchronization | `"Tekst"` | `"Kolor tekstu"` | The shared color-mode control must distinguish text color from background color. | verified |
| `F-pl-006` | `pl` | `tools.marker.default` | grammar / composed label | `"Domyślny"` | `"Domyślnie"` | The preset applies to both masculine `kolor tekstu` and neuter `tło`; the adverb is natural and gender-neutral in both composed labels. | verified |
| `F-pl-007` | `pl` | `tools.colorPicker.defaultSwatchLabel` | punctuation / placeholder composition | `"{mode} {default}"` | `"{mode}: {default}"` | Literal placeholder concatenation produces an ungrammatical label; a colon separates the mode from its default state. | verified |
| `F-pl-008` | `pl` | `tools.colorPicker.colorSwatchLabel` | punctuation / placeholder composition | `"{mode} {color}"` | `"{mode}: {color}"` | Literal placeholder concatenation produces an ungrammatical color-swatch accessible name. | verified |
| `F-pl-009` | `pl` | `tools.paragraph.placeholder` | instruction completeness / punctuation | `"Napisz coś lub naciśnij / aby wybrać"` | `"Napisz coś lub naciśnij /, aby wybrać narzędzie"` | The placeholder omitted the object selected by `/` and the comma required before the purpose clause. | verified |
| `F-pl-010` | `pl` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Pusty blok zwijany. Kliknij lub upuść bloki wewnątrz."` | `"Pusty blok zwijany. Kliknij, aby dodać blok, lub przeciągnij tutaj bloki."` | The caller’s click creates a child block while drag moves existing blocks; both actions must be explicit. | verified |
| `F-pl-011` | `pl` | `tools.table.clearSelection` | action accuracy / source synchronization | `"Wyczyść"` | `"Wyczyść zawartość"` | The table action clears selected contents without deleting cells or formatting; the generic verb is ambiguous. | verified |
| `F-pl-012` | `pl` | `tools.table.headerColumn` | natural terminology | `"Kolumna nagłówka"` | `"Kolumna nagłówkowa"` | The old genitive phrase suggests a column belonging to a header; `kolumna nagłówkowa` is the natural table term. | verified |
| `F-pl-013` | `pl` | `tools.table.headerRow` | natural terminology | `"Wiersz nagłówka"` | `"Wiersz nagłówkowy"` | `Wiersz nagłówkowy` is the natural Polish term for a table header row. | verified |
| `F-pl-014` | `pl` | `tools.table.comfortableText` | naturalness / caller context | `"Tekst komfortowy"` | `"Tekst standardowy"` | The option restores regular editor-sized table text; `komfortowy tekst` is an unnatural literal calque. | verified |
| `F-pl-015` | `pl` | `tools.table.placement` | terminology / source synchronization | `"Pozycja"` | `"Wyrównanie"` | The picker controls horizontal and vertical cell-content alignment, not object position. | verified |
| `F-pl-016` | `pl` | `tools.table.placementTopLeft` | grammar / alignment terminology | `"Góra lewo"` | `"Lewy górny róg"` | The old juxtaposition is ungrammatical; the replacement names the alignment corner naturally. | verified |
| `F-pl-017` | `pl` | `tools.table.placementTopCenter` | grammar / alignment terminology | `"Góra środek"` | `"Środek u góry"` | The old juxtaposition is ungrammatical; the replacement names the centered top alignment. | verified |
| `F-pl-018` | `pl` | `tools.table.placementTopRight` | grammar / alignment terminology | `"Góra prawo"` | `"Prawy górny róg"` | The old juxtaposition is ungrammatical; the replacement names the alignment corner naturally. | verified |
| `F-pl-019` | `pl` | `tools.table.placementMiddleLeft` | grammar / alignment terminology | `"Środek lewo"` | `"Środek po lewej"` | The old juxtaposition is ungrammatical; the replacement names the alignment position naturally. | verified |
| `F-pl-020` | `pl` | `tools.table.placementMiddleRight` | grammar / alignment terminology | `"Środek prawo"` | `"Środek po prawej"` | The old juxtaposition is ungrammatical; the replacement names the alignment position naturally. | verified |
| `F-pl-021` | `pl` | `tools.table.placementBottomLeft` | grammar / alignment terminology | `"Dół lewo"` | `"Lewy dolny róg"` | The old juxtaposition is ungrammatical; the replacement names the alignment corner naturally. | verified |
| `F-pl-022` | `pl` | `tools.table.placementBottomCenter` | grammar / alignment terminology | `"Dół środek"` | `"Środek u dołu"` | The old juxtaposition is ungrammatical; the replacement names the centered bottom alignment. | verified |
| `F-pl-023` | `pl` | `tools.table.placementBottomRight` | grammar / alignment terminology | `"Dół prawo"` | `"Prawy dolny róg"` | The old juxtaposition is ungrammatical; the replacement names the alignment corner naturally. | verified |
| `F-pl-024` | `pl` | `a11y.dragHandle` | accessibility / object clarity | `"Przeciągnij, aby przenieść lub kliknij, aby otworzyć menu"` | `"Przeciągnij, aby przenieść blok, lub kliknij, aby otworzyć menu"` | The accessible instruction must identify the block moved by dragging. | verified |
| `F-pl-025` | `pl` | `a11y.dragHandleRole` | natural accessibility terminology | `"uchwyt przeciągania"` | `"uchwyt do przeciągania"` | The old noun compound is an unnatural calque; the replacement is the normal Polish role description. | verified |
| `F-pl-026` | `pl` | `a11y.dragStartedMultiple` | number / accessibility | `"Przeciąganie {count} bloków"` | `"Liczba przeciąganych bloków: {count}"` | The caller can announce different counts; label-before-count wording avoids Polish one/few/many inflection. | verified |
| `F-pl-027` | `pl` | `a11y.blocksMoved` | number / accessibility | `"{count} bloków przeniesionych na pozycję {position}"` | `"Przeniesione bloki: {count}. Pozycja: {position}"` | The original requires different noun forms for one, two through four, and larger counts; the replacement is count-neutral. | verified |
| `F-pl-028` | `pl` | `a11y.blocksDuplicated` | number / accessibility | `"{count} bloków zduplikowanych od pozycji {position}"` | `"Powielone bloki: {count}. Pozycja początkowa: {position}"` | The original requires numeral-dependent inflection and uses a technical borrowing; the replacement is count-neutral and natural. | verified |
| `F-pl-029` | `pl` | `a11y.atTop` | grammar / accessibility / source synchronization | `"Blok jest na górze, nie można przenieść wyżej"` | `"Blok jest na górze i nie można go przenieść wyżej"` | The conjunction and object pronoun remove the comma splice and complete the boundary announcement. | verified |
| `F-pl-030` | `pl` | `a11y.atBottom` | grammar / accessibility / source synchronization | `"Blok jest na dole, nie można przenieść niżej"` | `"Blok jest na dole i nie można go przenieść niżej"` | The conjunction and object pronoun remove the comma splice and complete the boundary announcement. | verified |
| `F-pl-031` | `pl` | `a11y.searchResults` | number / accessibility / source synchronization | `"{count} wyników"` | `"Wyniki wyszukiwania: {count}"` | Search can return one or several results; label-before-count wording remains grammatical for all counts. | verified |
| `F-pl-032` | `pl` | `a11y.allBlocksSelected` | number / accessibility / source synchronization | `"Zaznaczono wszystkie bloki: {count}"` | `"Zaznaczono wszystkie bloki. Łącznie: {count}"` | The select-all path can run for one block; the separate total avoids count-dependent noun agreement. | verified |
| `F-pl-033` | `pl` | `a11y.navigationModeEntered` | platform terminology / accessibility / instruction grammar | `"Tryb nawigacji. Użyj strzałek, aby przechodzić między blokami, Enter, aby edytować, Escape, aby wyjść."` | `"Tryb nawigacji. Użyj klawiszy strzałek, aby przechodzić między blokami. Naciśnij Enter, aby edytować. Naciśnij Esc, aby wyjść."` | The first correction established the recognizable `Esc` key name; the fresh second review also found the old elliptical comma coordination awkwardly dependent on `Użyj strzałek`. Complete sentences now expose all three actions unambiguously to screen-reader users. | verified |
| `F-pl-034` | `pl` | `a11y.navigationModeExited` | accessibility / event wording | `"Wyjście z trybu nawigacji"` | `"Tryb nawigacji wyłączony"` | The replacement is a clear resultative state announcement rather than an abstract action noun. | verified |
| `F-pl-035` | `pl` | `a11y.dropCreateColumnLeft` | accessibility / event timing | `"Utworzy kolumnę po lewej stronie"` | `"Po upuszczeniu zostanie utworzona kolumna po lewej stronie"` | This drag-over live-region message predicts what will happen after drop; the replacement makes the prospective timing explicit. | verified |
| `F-pl-036` | `pl` | `a11y.dropCreateColumnRight` | accessibility / event timing | `"Utworzy kolumnę po prawej stronie"` | `"Po upuszczeniu zostanie utworzona kolumna po prawej stronie"` | This drag-over live-region message predicts what will happen after drop; the replacement makes the prospective timing explicit. | verified |
| `F-pl-037` | `pl` | `tools.columns.turnInto` | natural action terminology | `"Konwertuj na kolumny"` | `"Przekształć w kolumny"` | `Przekształć` is the natural user-facing action and avoids the unnecessary technical borrowing. | verified |
| `F-pl-038` | `pl` | `searchTerms.blockquote` | search terminology | `"blok cytatu"` | `"cytat blokowy"` | The replacement is the established Polish name for the blockquote concept and a more useful alias. | verified |
| `F-pl-039` | `pl` | `searchTerms.citation` | search terminology | `"odniesienie"` | `"cytowanie"` | `Odniesienie` means a reference and does not directly identify the quote/citation tool; `cytowanie` does. | verified |
| `F-pl-040` | `pl` | `tools.callout.addEmoji` | action accuracy / source synchronization | `"Dodaj emoji"` | `"Dodaj ikonę"` | The control adds the callout’s editable icon, which can then be changed or removed as an icon. | verified |
| `F-pl-041` | `pl` | `tools.callout.filterEmojis` | search clarity / source synchronization | `"Filtruj…"` | `"Szukaj emoji…"` | The value is the visible placeholder and accessible name of an emoji search box, not a generic filter command. | verified |
| `F-pl-042` | `pl` | `tools.callout.pickRandom` | action clarity / source synchronization | `"Losowo"` | `"Wybierz losowe emoji"` | The dice button needs an explicit grammatical action and object. | verified |
| `F-pl-043` | `pl` | `tools.callout.skinTone` | established terminology | `"Kolor skóry"` | `"Odcień skóry"` | Emoji variants change skin tone; `odcień skóry` is the natural Polish UI term. | verified |
| `F-pl-044` | `pl` | `tools.callout.emojiCategoryObjects` | established emoji terminology | `"Obiekty"` | `"Przedmioty"` | The category contains everyday objects; `przedmioty` is the natural Polish category label, while `obiekty` is overly abstract. | verified |
| `F-pl-045` | `pl` | `toolNames.inlineCode` | tool-name clarity | `"Kod"` | `"Kod w tekście"` | The inline-formatting tool must be distinguishable from the separate code-block tool. | verified |
| `F-pl-046` | `pl` | `toolNames.equation` | untranslated source text | `"Equation"` | `"Równanie"` | The visible toolbox tool name was left in English. | verified |
| `F-pl-047` | `pl` | `tools.equation.placeholder` | untranslated source text | `"Enter a LaTeX formula…"` | `"Wpisz formułę LaTeX…"` | The visible equation-editor placeholder was left in English; `LaTeX` remains the product name. | verified |
| `F-pl-048` | `pl` | `tools.code.searchLanguage` | number / punctuation / source synchronization | `"Szukaj języka..."` | `"Szukaj języków…"` | The picker searches many languages and the corpus uses the single U+2026 ellipsis. | verified |
| `F-pl-049` | `pl` | `blockSettings.copyLinkSuccess` | feedback completeness | `"Link skopiowany"` | `"Link skopiowano do schowka"` | The success toast must state the destination of the copied link, matching the completed clipboard action. | verified |
| `F-pl-050` | `pl` | `blockSettings.copyLinkError` | error context | `"Nie udało się skopiować linku"` | `"Nie udało się skopiować linku do bloku"` | The failure belongs specifically to the block-link action; the generic wording loses the object context. | verified |
| `F-pl-051` | `pl` | `tools.link.linkTitle` | terminology / source synchronization | `"Tytuł linku"` | `"Tekst linku"` | The field edits the visible anchor text, not HTML title metadata. | verified |
| `F-pl-052` | `pl` | `tools.image.toggleCaption` | action accuracy | `"Pokaż podpis"` | `"Pokaż lub ukryj podpis"` | The toggle can both show and hide the caption; the one-way label is false in one state. | verified |
| `F-pl-053` | `pl` | `tools.image.viewFullscreen` | action grammar / source synchronization | `"Pełny ekran"` | `"Wyświetl na pełnym ekranie"` | The image menu item is an action that opens the lightbox, not a static mode label. | verified |
| `F-pl-054` | `pl` | `tools.image.exitFullscreen` | established UI terminology | `"Wyjdź z pełnego ekranu"` | `"Wyjdź z trybu pełnoekranowego"` | The replacement is the natural Polish command for leaving full-screen mode. | verified |
| `F-pl-055` | `pl` | `tools.image.moreOptions` | control clarity | `"Więcej"` | `"Więcej opcji"` | The accessible menu button needs to identify what “more” opens. | verified |
| `F-pl-056` | `pl` | `tools.image.converting` | untranslated source text | `"Converting…"` | `"Konwertowanie…"` | The rendered image-processing progress state was left in English. | verified |
| `F-pl-057` | `pl` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Dodaj opis obrazu. Dzięki temu strona jest bardziej dostępna dla osób z wadami wzroku."` | `"Opisz ten obraz osobom, które go nie widzą."` | The dialog already supplies its purpose; the replacement is concise, direct, and inclusive without medicalizing users. | verified |
| `F-pl-058` | `pl` | `tools.image.previewControls` | accessibility / object clarity | `"Sterowanie podglądem"` | `"Elementy sterujące podglądem obrazu"` | This landmark groups image-preview controls; the old label omits the controlled object. | verified |
| `F-pl-059` | `pl` | `tools.image.errorFileTooLarge` | untranslated source text / placeholder context | `"Image is too large. {size} exceeds the {max} limit."` | `"Obraz jest za duży. Rozmiar {size} przekracza limit {max}."` | The visible upload error was left in English; both size placeholders remain explicit and unchanged. | verified |
| `F-pl-060` | `pl` | `tools.image.errorDefaultMessage` | error accuracy / source synchronization | `"Serwer zwrócił błąd. Spróbuj innego źródła lub prześlij plik ponownie."` | `"Nie udało się wczytać obrazu z tego adresu URL. Spróbuj użyć innego źródła lub ponownie prześlij plik."` | The caller knows only that the image failed to load from a URL; blaming a server invents an unproven cause. | verified |
| `F-pl-061` | `pl` | `tools.image.emptyUrlPlaceholder` | terminology consistency | `"Wklej URL obrazu…"` | `"Wklej adres URL obrazu…"` | Polish product wording uses `adres URL`; the complete phrase is natural and matches the file picker. | verified |
| `F-pl-062` | `pl` | `tools.file.toggleCaption` | action accuracy | `"Pokaż podpis"` | `"Pokaż lub ukryj podpis"` | The toggle can both show and hide the file caption; the one-way label is false in one state. | verified |
| `F-pl-063` | `pl` | `tools.file.errorFileTooLarge` | untranslated source text / placeholder context | `"File is too large. {size} exceeds the {max} limit."` | `"Plik jest za duży. Rozmiar {size} przekracza limit {max}."` | The visible upload error was left in English; both size placeholders remain explicit and unchanged. | verified |
| `F-pl-064` | `pl` | `tools.file.previewRaw` | jargon / source synchronization | `"Kod"` | `"Źródło"` | The Markdown tab displays source text, not necessarily executable code; `Źródło` pairs naturally with `Podgląd`. | verified |
| `F-pl-065` | `pl` | `tools.video.alignmentLeft` | action grammar / accessibility | `"Do lewej"` | `"Wyrównaj do lewej"` | The menu button requires a complete alignment command. | verified |
| `F-pl-066` | `pl` | `tools.video.alignmentCenter` | action grammar / accessibility | `"Do środka"` | `"Wyśrodkuj"` | The menu button requires a complete, natural alignment command. | verified |
| `F-pl-067` | `pl` | `tools.video.alignmentRight` | action grammar / accessibility | `"Do prawej"` | `"Wyrównaj do prawej"` | The menu button requires a complete alignment command. | verified |
| `F-pl-068` | `pl` | `tools.video.toggleCaption` | action accuracy / source-only contract | `"Pokaż podpis"` | `"Pokaż lub ukryj podpis"` | The contract names a two-state caption toggle, so a one-way show action is inaccurate. | verified |
| `F-pl-069` | `pl` | `tools.video.moreOptions` | control clarity / source-only contract | `"Więcej"` | `"Więcej opcji"` | The accessible menu control must identify what “more” opens. | verified |
| `F-pl-070` | `pl` | `tools.video.errorFileTooLarge` | untranslated source text / placeholder context | `"Video is too large. {size} exceeds the {max} limit."` | `"Wideo jest za duże. Rozmiar {size} przekracza limit {max}."` | The visible upload error was left in English; both size placeholders remain explicit and unchanged. | verified |
| `F-pl-071` | `pl` | `tools.audio.alignmentLeft` | action grammar / accessibility | `"Do lewej"` | `"Wyrównaj do lewej"` | The menu button requires a complete alignment command. | verified |
| `F-pl-072` | `pl` | `tools.audio.alignmentCenter` | action grammar / accessibility | `"Do środka"` | `"Wyśrodkuj"` | The menu button requires a complete, natural alignment command. | verified |
| `F-pl-073` | `pl` | `tools.audio.alignmentRight` | action grammar / accessibility | `"Do prawej"` | `"Wyrównaj do prawej"` | The menu button requires a complete alignment command. | verified |
| `F-pl-074` | `pl` | `tools.audio.errorFileTooLarge` | untranslated source text / placeholder context | `"Audio is too large. {size} exceeds the {max} limit."` | `"Plik audio jest za duży. Rozmiar {size} przekracza limit {max}."` | The visible upload error was left in English; naming the audio file is natural Polish and preserves both placeholders. | verified |
| `F-pl-075` | `pl` | `tools.audio.titlePlaceholder` | untranslated source text / established media terminology | `"Track title"` | `"Tytuł utworu"` | The metadata input was left in English; Apple’s Polish media guidance uses `tytuł utworu`. | verified |
| `F-pl-076` | `pl` | `tools.audio.artistPlaceholder` | untranslated source text / established media terminology | `"Artist"` | `"Wykonawca"` | The metadata input was left in English; Apple’s Polish media guidance uses `wykonawca` for this field. | verified |
| `F-pl-077` | `pl` | `tools.audio.emptyOrDropHere` | object clarity | `"lub upuść audio tutaj"` | `"lub upuść tutaj plik audio"` | The drop zone accepts a file; the original treats abstract `audio` as the draggable object. | verified |
| `F-pl-078` | `pl` | `tools.audio.emptyUrlPlaceholder` | object clarity / terminology | `"Wklej URL audio…"` | `"Wklej adres URL pliku audio…"` | The input accepts the URL of an audio file; the replacement is complete and natural Polish. | verified |
| `F-pl-079` | `pl` | `tools.audio.emptyUrlAria` | accessibility / object clarity | `"URL audio"` | `"Adres URL pliku audio"` | The accessible input label must name both the address and its audio-file target. | verified |
| `F-pl-080` | `pl` | `tools.audio.emptySourceAria` | accessibility / object clarity | `"Źródło audio"` | `"Źródło pliku audio"` | The accessible source-group label must identify the audio file selected by its controls. | verified |
| `F-pl-081` | `pl` | `tools.audio.coverChange` | untranslated source text | `"Change cover"` | `"Zmień okładkę"` | The visible audio-cover action was left in English. | verified |
| `F-pl-082` | `pl` | `tools.audio.coverSet` | untranslated source text | `"Set cover image"` | `"Ustaw obraz okładki"` | The visible audio-cover action was left in English. | verified |
| `F-pl-083` | `pl` | `tools.audio.coverRemove` | untranslated source text | `"Remove cover"` | `"Usuń okładkę"` | The visible audio-cover action was left in English. | verified |
| `F-pl-084` | `pl` | `tools.audio.coverErrorType` | untranslated source text | `"Choose an image file"` | `"Wybierz plik obrazu"` | The cover-file type error was left in English. | verified |
| `F-pl-085` | `pl` | `tools.audio.coverErrorTooLarge` | untranslated source text | `"Image is too large"` | `"Obraz jest za duży"` | The oversized-cover error was left in English. | verified |
| `F-pl-086` | `pl` | `tools.audio.coverAdd` | untranslated source text | `"Add a cover"` | `"Dodaj okładkę"` | The empty cover control exposed an English action. | verified |
| `F-pl-087` | `pl` | `tools.audio.coverUrlPlaceholder` | terminology consistency | `"Wklej URL obrazu…"` | `"Wklej adres URL obrazu…"` | Polish product wording uses the complete `adres URL` phrase. | verified |
| `F-pl-088` | `pl` | `tools.audio.coverUrlAria` | accessibility / terminology consistency | `"URL obrazu"` | `"Adres URL obrazu"` | The accessible image-URL input label needs the natural complete Polish phrase. | verified |
| `F-pl-089` | `pl` | `tools.audio.coverSourceAria` | accessibility / object clarity | `"Źródło obrazu"` | `"Źródło okładki"` | This source group belongs specifically to the audio cover, not an arbitrary image. | verified |
| `F-pl-090` | `pl` | `tools.database.viewTypeListDescription` | terminology / action clarity / source synchronization | `"Prosty widok liniowy"` | `"Pokaż elementy na prostej liście"` | The picker subtitle should describe the familiar list result rather than expose abstract “linear view” terminology. | verified |
| `F-pl-091` | `pl` | `tools.database.listView` | context / label completeness | `"Lista"` | `"Widok listy"` | A separate sibling already names the List type; this caller labels the complete list-view surface. | verified |
| `F-pl-092` | `pl` | `tools.database.cardDetails` | context / label completeness | `"Karta"` | `"Szczegóły karty"` | The heading labels the card-details panel, not the card itself. | verified |
| `F-pl-093` | `pl` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Ładowanie podglądu linku"` | `"Ładowanie podglądu linku…"` | The rendered in-progress state needs the corpus-standard ellipsis. | verified |
| `F-pl-094` | `pl` | `tools.embed.empty` | read-only context / source synchronization | `"Wklej link, aby go osadzić"` | `"Brak linku do osadzenia"` | The caller renders this only in read-only mode, where a paste instruction cannot be performed. | verified |
| `F-pl-095` | `pl` | `tools.linkPaste.embed` | action terminology / source-only contract | `"Utwórz osadzenie"` | `"Osadź zawartość"` | The old nominal calque is awkward; the paste-menu item needs a direct embed action. | verified |
| `F-pl-096` | `pl` | `tools.linkPaste.embedVideo` | embed action / provider composition | `"Wstaw wideo z {provider}"` | `"Osadź wideo z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal multiword provider names grammatical. | verified |
| `F-pl-097` | `pl` | `tools.linkPaste.embedAudio` | embed action / provider composition | `"Wstaw audio z {provider}"` | `"Osadź plik audio z serwisu {provider}"` | The action creates an audio-file embed, and `z serwisu` avoids inflecting provider names. | verified |
| `F-pl-098` | `pl` | `tools.linkPaste.embedImage` | embed action / provider composition | `"Wstaw obraz z {provider}"` | `"Osadź obraz z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-099` | `pl` | `tools.linkPaste.embedSocial` | embed action / terminology / provider composition | `"Wstaw post z {provider}"` | `"Osadź wpis z serwisu {provider}"` | `Wpis` is neutral Polish product wording, and the provider-final construction works for every registered service. | verified |
| `F-pl-100` | `pl` | `tools.linkPaste.embedDocument` | embed action / provider composition | `"Wstaw dokument z {provider}"` | `"Osadź dokument z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-101` | `pl` | `tools.linkPaste.embedTable` | embed action / provider composition | `"Wstaw tabelę z {provider}"` | `"Osadź tabelę z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-102` | `pl` | `tools.linkPaste.embedForm` | embed action / provider composition | `"Wstaw formularz z {provider}"` | `"Osadź formularz z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-103` | `pl` | `tools.linkPaste.embedCode` | embed action / provider composition | `"Wstaw kod z {provider}"` | `"Osadź kod z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-104` | `pl` | `tools.linkPaste.embedDesign` | embed action / provider composition | `"Wstaw projekt z {provider}"` | `"Osadź projekt z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-105` | `pl` | `tools.linkPaste.embedChart` | embed action / provider composition | `"Wstaw wykres z {provider}"` | `"Osadź wykres z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-106` | `pl` | `tools.linkPaste.embedMap` | embed action / provider composition | `"Wstaw mapę z {provider}"` | `"Osadź mapę z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-107` | `pl` | `tools.linkPaste.embedCalendar` | embed action / provider composition | `"Wstaw kalendarz z {provider}"` | `"Osadź kalendarz z serwisu {provider}"` | The action creates an embed, and `z serwisu` keeps literal provider names grammatical. | verified |
| `F-pl-108` | `pl` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Wzmianka"` | `"Dodaj wzmiankę"` | The paste-menu contract requires an action label alongside other commands; the old noun names an object. | verified |
| `F-pl-109` | `pl` | `notifier.dismiss` | control semantics / accessibility | `"Odrzuć"` | `"Zamknij"` | The × button closes a notification rather than rejecting content, even though its current caller bypasses locale injection. | verified |
| `F-pl-110` | `pl` | `tools.video.seek` | accessibility / media terminology | `"Przewiń"` | `"Pozycja odtwarzania"` | This value labels a seek slider rather than a one-shot command; the replacement identifies the controlled value. | verified |
| `F-pl-111` | `pl` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"Przełącz wyświetlanie czasu"` | `"Przełącz między czasem, który upłynął, a pozostałym czasem"` | The accessible button name must state the two actual display states. | verified |
| `F-pl-112` | `pl` | `tools.video.fullscreenExit` | established UI terminology | `"Zamknij pełny ekran"` | `"Wyjdź z trybu pełnoekranowego"` | Full-screen mode is exited, not closed as an object; the replacement is the natural Polish command. | verified |
| `F-pl-113` | `pl` | `tools.video.speedPresets` | terminology | `"Ustawienia szybkości"` | `"Wstępnie ustawione prędkości"` | The menu lists preset playback rates, not general speed settings. | verified |
| `F-pl-114` | `pl` | `tools.video.theaterExit` | established media terminology / action grammar | `"Zamknij tryb kinowy"` | `"Wyjdź z trybu kinowego"` | Google’s Polish YouTube help uses `tryb kinowy`; the paired exit control needs the natural command for leaving that mode. | verified |
| `F-pl-115` | `pl` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Statystyki dla nerdów"` | `"Statystyki odtwarzania"` | The context-menu item opens playback data; the replacement removes prohibited slang and identifies the data’s domain. | verified |
| `F-pl-116` | `pl` | `searchTerms.divider` | search semantics / natural terminology | `"dzielnik"` | `"linia pozioma"` | `Dzielnik` primarily denotes a mathematical divisor and is a misleading query for the horizontal divider tool; [Microsoft’s Polish interface guidance](https://support.microsoft.com/pl-pl/outlook/customize-your-email-message) uses `linia pozioma`. | verified |
| `F-pl-117` | `pl` | `tools.callout.emojiCategoryTravel` | category scope / established terminology | `"Podróże"` | `"Podróże i miejsca"` | The caller maps the emoji picker’s `places` category to this label, so travel alone omits part of its contents; Unicode CLDR’s Polish category is `Podróże i miejsca`. | verified |
| `F-pl-118` | `pl` | `tools.image.errorUploadFailedTitle` | terminology consistency / error context | `"Przesyłanie nie powiodło się"` | `"Wysyłanie nie powiodło się"` | The adjacent image error message translates the identical source as `Wysyłanie nie powiodło się` in the same failure state; the heading must use the same upload terminology. | verified |
| `F-pl-119` | `pl` | `tools.video.loop` | media state terminology / caller context | `"Zapętl"` | `"Odtwarzanie w pętli"` | The value labels a persistent checked state and is also displayed beside `Wł.` or `Wył.`; the imperative `Zapętl` is awkward there, while [Apple’s Polish media guidance](https://support.apple.com/pl-pl/guide/quicktime-player/qtp6cee0761b/mac) uses `odtwarzanie w pętli`. | verified |
| `F-pl-120` | `pl` | `tools.audio.loop` | media state terminology / consistency | `"Zapętl"` | `"Odtwarzanie w pętli"` | The audio toggle represents the same persistent loop state as video and needs the same natural noun phrase rather than an imperative command. | verified |
| `F-pl-121` | `pl` | `tools.audio.errorGoogleDrive` | grammar / established product terminology | `"Linków Google Drive nie można odtwarzać bezpośrednio — pobierz plik i prześlij go tutaj."` | `"Linków do plików na Dysku Google nie można odtwarzać bezpośrednio — pobierz plik i prześlij go tutaj."` | The old bare noun chain is unnatural and treats links as the playable resource; [Google’s Polish documentation](https://support.google.com/drive/answer/2423485?hl=pl) uses the localized product name `Dysk Google`. | verified |
| `F-pl-122` | `pl` | `tools.audio.errorOneDrive` | grammar / established product terminology | `"Linków OneDrive nie można odtwarzać bezpośrednio — pobierz plik i prześlij go tutaj."` | `"Linków do plików w usłudze OneDrive nie można odtwarzać bezpośrednio — pobierz plik i prześlij go tutaj."` | The old English-style noun chain is unnatural; [Microsoft’s Polish documentation](https://support.microsoft.com/pl-pl/office/linki-786eb268-2e5d-4184-bc18-cad0bda6175e) uses the construction `link do pliku w usłudze OneDrive`. | verified |
| `F-pl-123` | `pl` | `a11y.dropPosition` | number / accessibility / prospective drag context | `"Zostanie upuszczony na pozycji {position} z {total}"` | `"Pozycja docelowa: {position} z {total}"` | The same pre-drop announcement handles one or multiple selected blocks, but masculine singular `upuszczony` assumes one; a neutral destination label works for both caller branches. | verified |
| `F-pl-124` | `pl` | `tools.callout.emojiCategoryPeople` | category scope / accessibility | `"Ludzie"` | `"Buźki i osoby"` | The visible heading and navigation accessible name cover smileys as well as people; Emoji Mart and Apple’s Polish picker terminology name both scopes. | verified |
| `F-pl-125` | `pl` | `tools.callout.emojiCategoryNature` | category scope / accessibility | `"Natura"` | `"Zwierzęta i natura"` | The runtime category begins with and contains animals as well as plants; the official picker localization names both scopes. | verified |
| `F-pl-126` | `pl` | `tools.callout.emojiCategoryFood` | category scope / accessibility | `"Jedzenie"` | `"Jedzenie i napoje"` | The category contains both food and beverages, so its visible and accessible Polish label must name both scopes. | verified |
| `F-ps-001` | `ps` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"بڼه پاکه کړئ"` | WordPress Pashto translates Clear formatting as `بڼه پاکه کړه` in its [official catalog](https://translate.wordpress.org/projects/wp/dev/ps/default/export-translations/?format=po); the final verb is adjusted to this dictionary’s polite imperative register. | verified |
| `F-pt-001` | `pt` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Limpar formatação"` | Microsoft’s Brazilian Portuguese editor UI uses Limpar Formatação in [official product help](https://support.microsoft.com/pt-BR/PowerPoint/clear-all-text-formatting); the second word is lowercased for the dictionary’s sentence-case register. | verified |
| `F-pt-002` | `pt` | `blockSettings.convertWithChildrenWarning` | count neutrality / source synchronization | `"Este bloco contém {count} blocos aninhados. Ao convertê-lo, eles passarão para o nível superior. Deseja continuar?"` | `"Blocos aninhados: {count}. Ao converter este bloco, cada bloco aninhado será movido para o nível superior. Deseja continuar?"` | The confirmation can receive one nested block; the replacement remains grammatical for every `{count}` and states the move performed by conversion. | verified |
| `F-pt-003` | `pt` | `toolbox.optionAddAbove` | shortcut clarity | `"⌥ — adicionar acima"` | `"⌥ + clique para adicionar acima"` | The plus-button tooltip requires a modified click, not the Option key alone; [Apple’s Brazilian Portuguese guidance](https://support.apple.com/pt-br/guide/mac-help/-mh35859/mac) names Option-click as `Opção + clique`. | verified |
| `F-pt-004` | `pt` | `toolbox.ctrlAddAbove` | shortcut clarity | `"Ctrl — adicionar acima"` | `"Ctrl + clique para adicionar acima"` | The Windows plus-button tooltip omitted the click gesture required by the shortcut. | verified |
| `F-pt-005` | `pt` | `tools.marker.textColor` | context / terminology | `"Texto"` | `"Cor do texto"` | This color-picker mode sits beside the background mode and must explicitly identify text color. | verified |
| `F-pt-006` | `pt` | `tools.colorPicker.defaultSwatchLabel` | accessibility / composed-label clarity | `"{mode} {default}"` | `"{mode}: {default}"` | The swatch accessible name combines a color mode with the default label; the colon exposes that relationship instead of running the two labels together. | verified |
| `F-pt-007` | `pt` | `tools.colorPicker.colorSwatchLabel` | accessibility / composed-label clarity | `"{mode} {color}"` | `"{mode}: {color}"` | Each swatch accessible name combines its mode and color; the colon makes the two substituted labels unambiguous. | verified |
| `F-pt-008` | `pt` | `tools.paragraph.placeholder` | action clarity | `"Escreva algo ou pressione / para selecionar"` | `"Escreva algo ou pressione / para selecionar uma ferramenta"` | Pressing slash opens the tool selector, so the empty-paragraph hint needs the object of `selecionar`. | verified |
| `F-pt-009` | `pt` | `tools.toggle.placeholder` | tool terminology | `"Recolhível"` | `"Lista recolhível"` | The value labels the empty toggle tool; naming it as a collapsible list is clearer than the standalone adjective. | verified |
| `F-pt-010` | `pt` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Bloco recolhível vazio. Clique ou arraste blocos para dentro."` | `"Bloco recolhível vazio. Clique para adicionar um bloco ou arraste blocos para cá."` | Clicking creates a child block, while dragging moves existing blocks into the toggle; the hint must distinguish those two caller actions. | verified |
| `F-pt-011` | `pt` | `tools.table.clearSelection` | context / action accuracy | `"Limpar"` | `"Limpar conteúdo"` | The table command clears selected cells’ contents while preserving cells and formatting; deletion is a separate action. | verified |
| `F-pt-012` | `pt` | `tools.table.placement` | table-control terminology | `"Posicionamento"` | `"Alinhamento"` | This label heads the 3×3 cell-content alignment control, matching Adobe’s Brazilian Portuguese [Alinhamento](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html) terminology. | verified |
| `F-pt-013` | `pt` | `tools.table.placementTopLeft` | established alignment terminology | `"Superior esquerdo"` | `"Canto superior esquerdo"` | The 3×3 alignment option denotes the corner position; Adobe’s Brazilian Portuguese UI uses [Canto superior esquerdo](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-pt-014` | `pt` | `tools.table.placementTopCenter` | established alignment terminology | `"Superior centro"` | `"Centro superior"` | The 3×3 alignment option uses the established Brazilian Portuguese order [Centro superior](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-pt-015` | `pt` | `tools.table.placementTopRight` | established alignment terminology | `"Superior direito"` | `"Canto superior direito"` | The 3×3 alignment option denotes the corner position; Adobe’s Brazilian Portuguese UI uses [Canto superior direito](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-pt-016` | `pt` | `tools.table.placementMiddleLeft` | established alignment terminology | `"Meio esquerdo"` | `"Centro esquerdo"` | The 3×3 alignment option uses Adobe’s Brazilian Portuguese [Centro esquerdo](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html) label. | verified |
| `F-pt-017` | `pt` | `tools.table.placementMiddleRight` | established alignment terminology | `"Meio direito"` | `"Centro direito"` | The 3×3 alignment option uses Adobe’s Brazilian Portuguese [Centro direito](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html) label. | verified |
| `F-pt-018` | `pt` | `tools.table.placementBottomLeft` | established alignment terminology | `"Inferior esquerdo"` | `"Canto inferior esquerdo"` | The 3×3 alignment option denotes the corner position; Adobe’s Brazilian Portuguese UI uses [Canto inferior esquerdo](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-pt-019` | `pt` | `tools.table.placementBottomCenter` | established alignment terminology | `"Inferior centro"` | `"Centro inferior"` | The 3×3 alignment option uses the established Brazilian Portuguese order [Centro inferior](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-pt-020` | `pt` | `tools.table.placementBottomRight` | established alignment terminology | `"Inferior direito"` | `"Canto inferior direito"` | The 3×3 alignment option denotes the corner position; Adobe’s Brazilian Portuguese UI uses [Canto inferior direito](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html). | verified |
| `F-pt-021` | `pt` | `a11y.dragHandle` | accessibility / object clarity | `"Arraste para mover ou clique para abrir o menu"` | `"Arraste para mover o bloco ou clique para abrir o menu"` | This is the block drag handle’s accessible instruction; naming the block makes the movement action complete. | verified |
| `F-pt-022` | `pt` | `a11y.dragHandleRole` | accessibility terminology | `"controle de arrastar"` | `"alça de arrasto"` | The value is the drag handle’s role description; MDN’s Brazilian Portuguese reference uses [alça de arrasto](https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/textarea). | verified |
| `F-pt-023` | `pt` | `a11y.dropPosition` | prospective drag context / accessibility | `"Será solto na posição {position} de {total}"` | `"Posição de destino: {position} de {total}"` | The live region announces the prospective drop target during dragging; the replacement labels the destination without an unnatural passive construction. | verified |
| `F-pt-024` | `pt` | `a11y.movedUp` | grammar / accessibility | `"Bloco movido para cima, posição {position} de {total}"` | `"Bloco movido para cima até a posição {position} de {total}"` | This live-region message reports completed keyboard movement; `até` states the resulting position naturally. | verified |
| `F-pt-025` | `pt` | `a11y.movedDown` | grammar / accessibility | `"Bloco movido para baixo, posição {position} de {total}"` | `"Bloco movido para baixo até a posição {position} de {total}"` | This live-region message reports completed keyboard movement; `até` states the resulting position naturally. | verified |
| `F-pt-026` | `pt` | `a11y.atTop` | accessibility / boundary context | `"Não é possível subir mais"` | `"O bloco já está no topo e não pode ser movido mais para cima"` | The failed move announcement must identify the block, its current boundary, and the unavailable direction. | verified |
| `F-pt-027` | `pt` | `a11y.atBottom` | accessibility / boundary context | `"Não é possível descer mais"` | `"O bloco já está no fim e não pode ser movido mais para baixo"` | The failed move announcement must identify the block, its current boundary, and the unavailable direction. | verified |
| `F-pt-028` | `pt` | `a11y.searchResults` | accessibility / number neutrality | `"{count} resultados"` | `"Resultados da pesquisa: {count}"` | The live-region template can receive one result; putting the count after a fixed label avoids singular/plural disagreement and identifies the search context. | verified |
| `F-pt-029` | `pt` | `a11y.allBlocksSelected` | accessibility / number neutrality | `"Todos os blocos selecionados, {count} blocos"` | `"Todos os blocos selecionados. Total: {count}"` | The select-all live-region template can receive one; the fixed total label remains grammatical for every `{count}`. | verified |
| `F-pt-030` | `pt` | `a11y.navigationModeEntered` | keyboard terminology / instruction clarity | `"Modo de navegação. Use as teclas de seta para mover entre blocos, Enter para editar, Escape para sair."` | `"Modo de navegação. Use as teclas de seta para navegar entre os blocos. Pressione Enter para editar e Esc para sair."` | This live instruction describes keyboard navigation; complete sentences and the visible key label `Esc` make all three actions explicit. | verified |
| `F-pt-031` | `pt` | `a11y.navigatedToBlock` | event accuracy / accessibility | `"Movido para o bloco"` | `"Navegou até o bloco"` | The live region reports focus navigation, not movement of the block itself. | verified |
| `F-pt-032` | `pt` | `tools.callout.addEmoji` | context / terminology | `"Adicionar emoji"` | `"Adicionar ícone"` | In the callout UI, the chosen emoji functions as the callout’s editable and removable icon. | verified |
| `F-pt-033` | `pt` | `tools.callout.filterEmojis` | search clarity / accessibility | `"Pesquisar…"` | `"Pesquisar emojis…"` | The value is both the emoji searchbox placeholder and accessible name, so it must state what is searched. | verified |
| `F-pt-034` | `pt` | `tools.callout.pickRandom` | action clarity / accessibility | `"Aleatório"` | `"Escolher um emoji aleatório"` | The dice button’s accessible label must name both the action and its emoji object. | verified |
| `F-pt-035` | `pt` | `tools.callout.emojiCategoryActivity` | emoji-category terminology / number | `"Atividade"` | `"Atividades"` | The emoji picker renders a category containing multiple activities, so its heading requires the plural. | verified |
| `F-pt-036` | `pt` | `toolNames.equation` | untranslated source text | `"Equation"` | `"Equação"` | The toolbox title is visible Portuguese UI, but the current value leaks the English tool name. | verified |
| `F-pt-037` | `pt` | `tools.equation.placeholder` | untranslated source text | `"Enter a LaTeX formula…"` | `"Insira uma fórmula LaTeX…"` | The empty equation editor displays this instruction; Notion’s Brazilian Portuguese math help uses [fórmulas LaTeX](https://www.notion.com/pt/help/math-equations). | verified |
| `F-pt-038` | `pt` | `tools.code.searchLanguage` | number / ellipsis typography | `"Pesquisar linguagem..."` | `"Pesquisar linguagens…"` | The code-language picker searches across multiple languages, and its input uses the corpus-standard ellipsis character. | verified |
| `F-pt-039` | `pt` | `tools.link.linkTitle` | context / terminology | `"Título do link"` | `"Texto do link"` | This field edits the anchor’s visible text, not title metadata. | verified |
| `F-pt-040` | `pt` | `tools.image.converting` | untranslated source text | `"Converting…"` | `"Convertendo…"` | The rendered image-conversion progress state currently leaks English into the Portuguese UI. | verified |
| `F-pt-041` | `pt` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Adicione um texto alternativo para descrever esta imagem. Isso torna a página mais acessível para pessoas com deficiência visual."` | `"Descreva esta imagem para quem não consegue vê-la."` | The alternative-text dialog already establishes the feature; the replacement is direct, concise, and centered on the person who needs the description. | verified |
| `F-pt-042` | `pt` | `tools.image.previewControls` | accessibility / object clarity | `"Controles da pré-visualização"` | `"Controles da pré-visualização da imagem"` | This value labels the image preview toolbar for assistive technology and must identify which preview it controls. | verified |
| `F-pt-043` | `pt` | `tools.image.errorFileTooLarge` | untranslated source text / error clarity | `"Image is too large. {size} exceeds the {max} limit."` | `"A imagem é muito grande. {size} excede o limite de {max}."` | The image-upload error is rendered to Portuguese users and must preserve both size placeholders while translating the leaked English text. | verified |
| `F-pt-044` | `pt` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"A URL retornou um erro. Tente outra fonte ou reenvie o arquivo."` | `"Não foi possível carregar a imagem a partir desta URL. Tente outra origem ou envie o arquivo novamente."` | The image loader failed, not the URL itself; the replacement describes that failure directly and gives natural recovery actions. | verified |
| `F-pt-045` | `pt` | `tools.file.errorFileTooLarge` | untranslated source text / error clarity | `"File is too large. {size} exceeds the {max} limit."` | `"O arquivo é muito grande. {size} excede o limite de {max}."` | The file-upload error is rendered to Portuguese users and must preserve both size placeholders while translating the leaked English text. | verified |
| `F-pt-046` | `pt` | `tools.file.previewRaw` | tab terminology / source synchronization | `"Código"` | `"Código-fonte"` | This Markdown preview tab shows the file’s source text; `Código-fonte` identifies that content more precisely than generic `Código`. | verified |
| `F-pt-047` | `pt` | `tools.file.previewRender` | tab terminology / source synchronization | `"Visualização"` | `"Pré-visualização"` | This tab shows the rendered Markdown preview and should match the dictionary’s established `pré-visualização` terminology. | verified |
| `F-pt-048` | `pt` | `tools.video.alignmentLeft` | action-label grammar | `"Esquerda"` | `"Alinhar à esquerda"` | This value is a video alignment menu command, not a passive alignment-state label. | verified |
| `F-pt-049` | `pt` | `tools.video.alignmentCenter` | action-label grammar | `"Centro"` | `"Alinhar ao centro"` | This value is a video alignment menu command, not a passive alignment-state label. | verified |
| `F-pt-050` | `pt` | `tools.video.alignmentRight` | action-label grammar | `"Direita"` | `"Alinhar à direita"` | This value is a video alignment menu command, not a passive alignment-state label. | verified |
| `F-pt-051` | `pt` | `tools.video.errorFileTooLarge` | untranslated source text / error clarity | `"Video is too large. {size} exceeds the {max} limit."` | `"O vídeo é muito grande. {size} excede o limite de {max}."` | The video-upload error is rendered to Portuguese users and must preserve both size placeholders while translating the leaked English text. | verified |
| `F-pt-052` | `pt` | `tools.audio.alignmentLeft` | action-label grammar | `"Esquerda"` | `"Alinhar à esquerda"` | This value is an audio alignment menu command, not a passive alignment-state label. | verified |
| `F-pt-053` | `pt` | `tools.audio.alignmentCenter` | action-label grammar | `"Centro"` | `"Alinhar ao centro"` | This value is an audio alignment menu command, not a passive alignment-state label. | verified |
| `F-pt-054` | `pt` | `tools.audio.alignmentRight` | action-label grammar | `"Direita"` | `"Alinhar à direita"` | This value is an audio alignment menu command, not a passive alignment-state label. | verified |
| `F-pt-055` | `pt` | `tools.audio.errorFileTooLarge` | untranslated source text / error clarity | `"Audio is too large. {size} exceeds the {max} limit."` | `"O arquivo de áudio é muito grande. {size} excede o limite de {max}."` | The audio-upload error is rendered to Portuguese users and must preserve both size placeholders while translating the leaked English text. | verified |
| `F-pt-056` | `pt` | `tools.audio.titlePlaceholder` | untranslated source text | `"Track title"` | `"Título da faixa"` | The audio metadata title input currently displays an English placeholder in the Portuguese UI. | verified |
| `F-pt-057` | `pt` | `tools.audio.artistPlaceholder` | untranslated source text | `"Artist"` | `"Artista"` | The audio metadata artist input currently displays an English placeholder in the Portuguese UI. | verified |
| `F-pt-058` | `pt` | `tools.audio.emptyOrDropHere` | object clarity | `"ou solte um áudio aqui"` | `"ou solte um arquivo de áudio aqui"` | This drop-zone instruction accepts an audio file; naming the file is the natural and precise Portuguese construction. | verified |
| `F-pt-059` | `pt` | `tools.audio.coverChange` | untranslated source text | `"Change cover"` | `"Alterar capa"` | The audio cover action currently leaks English into the Portuguese menu. | verified |
| `F-pt-060` | `pt` | `tools.audio.coverSet` | untranslated source text | `"Set cover image"` | `"Definir imagem de capa"` | The action that selects an audio cover image currently leaks English into the Portuguese UI. | verified |
| `F-pt-061` | `pt` | `tools.audio.coverRemove` | untranslated source text | `"Remove cover"` | `"Remover capa"` | The audio cover removal action currently leaks English into the Portuguese menu. | verified |
| `F-pt-062` | `pt` | `tools.audio.coverErrorType` | untranslated source text | `"Choose an image file"` | `"Escolha um arquivo de imagem"` | The cover-file type error is rendered to Portuguese users but currently remains in English. | verified |
| `F-pt-063` | `pt` | `tools.audio.coverErrorTooLarge` | untranslated source text | `"Image is too large"` | `"A imagem é muito grande"` | The oversized-cover error is rendered to Portuguese users but currently remains in English. | verified |
| `F-pt-064` | `pt` | `tools.audio.coverAdd` | untranslated source text | `"Add a cover"` | `"Adicionar uma capa"` | The empty audio-cover control currently exposes an English action label. | verified |
| `F-pt-065` | `pt` | `tools.audio.coverSourceAria` | accessibility / object clarity | `"Origem da imagem"` | `"Origem da capa"` | This accessible label belongs specifically to the audio cover-source control, not to a generic image-source picker. | verified |
| `F-pt-066` | `pt` | `tools.database.viewTypeListDescription` | context / source synchronization | `"Uma visão linear simples"` | `"Exibir itens em uma lista simples"` | The database view picker needs an action-oriented description that preserves the familiar list concept; Notion’s Brazilian Portuguese database guidance uses [itens and lista](https://www.notion.com/pt/help/database-properties). | verified |
| `F-pt-067` | `pt` | `tools.database.propertyTypeSelect` | property-type terminology | `"Seleção"` | `"Selecionar"` | This value names the Select property type in the database property menu; Notion’s Brazilian Portuguese UI uses [Selecionar](https://www.notion.com/pt/help/database-properties). | verified |
| `F-pt-068` | `pt` | `tools.database.defaultStatusProperty` | established product terminology | `"Estado"` | `"Status"` | This is the default database status-property name; Notion’s Brazilian Portuguese documentation uses [Status](https://www.notion.com/pt/help/database-properties). | verified |
| `F-pt-069` | `pt` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"Carregando pré-visualização do link"` | `"Carregando pré-visualização do link…"` | The rendered in-progress bookmark state needs the corpus-standard ellipsis. | verified |
| `F-pt-070` | `pt` | `tools.embed.empty` | read-only context / source synchronization | `"Cole um link para incorporar"` | `"Nenhum link incorporado"` | The caller renders this only for an empty embed in read-only mode, where a paste instruction is impossible. | verified |
| `F-pt-071` | `pt` | `tools.linkPaste.embed` | established action terminology / source-only contract | `"Criar incorporação"` | `"Criar integração"` | This paste-menu action creates an embed; Notion’s Brazilian Portuguese media help uses the exact command [Criar integração](https://www.notion.com/pt/help/images-files-and-media). | verified |
| `F-pt-072` | `pt` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Menção"` | `"Mencionar"` | `buildPasteMenuItems` requires an action label; Notion’s Brazilian Portuguese editing help uses [Mencionar](https://www.notion.com/pt/help/writing-and-editing-basics). | verified |
| `F-pt-073` | `pt` | `notifier.dismiss` | control semantics / accessibility | `"Dispensar"` | `"Fechar"` | The caller applies this label to the notification’s × close button, so the value must name the close action even though that notifier currently bypasses locale injection. | verified |
| `F-pt-074` | `pt` | `tools.video.seek` | accessibility / media terminology | `"Buscar"` | `"Posição da reprodução"` | This value labels the video seek slider rather than a search or one-shot seek command; Google’s Portuguese media help describes the control as the [posição da reprodução](https://support.google.com/drive/answer/12169158?hl=pt-BR_ALL). | verified |
| `F-pt-075` | `pt` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"Alternar exibição de tempo"` | `"Alternar entre o tempo decorrido e o tempo restante"` | The time-display button’s accessible name must identify both actual states; Apple’s Brazilian Portuguese player guidance uses [tempo decorrido and tempo restante](https://support.apple.com/pt-br/guide/tvapp/atvbfbcc3987/web). | verified |
| `F-pt-076` | `pt` | `tools.video.pip` | established media terminology | `"Imagem em imagem"` | `"Picture-in-picture"` | The player button invokes the standard mode that Google’s Brazilian Portuguese media help calls [Picture-in-picture](https://support.google.com/drive/answer/12169158?hl=pt-BR_ALL). | verified |
| `F-pt-077` | `pt` | `tools.video.ctxCopyUrlAtTime` | context / media terminology | `"Copiar URL do vídeo no tempo atual"` | `"Copiar URL do vídeo na posição de reprodução atual"` | The context-menu action copies a URL for the current playback head; `tempo atual` can instead mean wall-clock time. | verified |
| `F-pt-078` | `pt` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Estatísticas para nerds"` | `"Estatísticas de reprodução"` | The context-menu item opens playback data; the replacement removes prohibited slang and identifies the data’s domain. | verified |
| `F-pt-079` | `pt` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emojis encontrados"` | `"Resultados da pesquisa de emojis: {count}"` | The emoji-search live-region template can receive one; the label-before-count form remains grammatical for every result count. | verified |
| `F-pt-080` | `pt` | `tools.callout.emojiCategoryTravel` | category scope / terminology | `"Viagem"` | `"Viagens e lugares"` | The emoji picker category contains both travel and place emoji; Microsoft Teams’ Brazilian Portuguese emoji guidance uses [Viagens e lugares](https://support.microsoft.com/pt-BR/teams/chat/send-an-emoji-gif-or-sticker-in-microsoft-teams). | verified |
| `F-pt-081` | `pt` | `tools.database.viewTypeBoardDescription` | register / sibling consistency | `"Visualize o trabalho em colunas"` | `"Visualizar o trabalho em colunas"` | The board description is an option subtitle beside the infinitive `Exibir itens em uma lista simples`; the locale’s selected concise action-label register requires the parallel infinitive. | verified |
| `F-pt-082` | `pt` | `tools.video.theater` | established media terminology | `"Modo cinema"` | `"Modo teatro"` | This player control invokes theater mode; YouTube’s Brazilian Portuguese help uses [Modo Teatro](https://support.google.com/youtube/answer/189278?hl=pt-BR). | verified |
| `F-pt-083` | `pt` | `tools.video.theaterExit` | established media terminology | `"Sair do modo cinema"` | `"Sair do modo teatro"` | The paired exit control must use the same established `Modo teatro` terminology as the mode it closes. | verified |
| `F-pt-084` | `pt` | `tools.database.checkboxChecked` | gender / accessibility | `"Marcado"` | `"Marcada"` | The hidden accessible state describes feminine `caixa de seleção`; Microsoft’s Brazilian Portuguese accessibility guidance uses the feminine checked-state wording [marcada](https://support.microsoft.com/pt-br/office/usar-um-leitor-de-tela-para-explorar-as-listas-de-sites-seguindo-e-recentes-no-sharepoint-online-7fd563cb-279f-4b01-b109-ababbb4498f5). | verified |
| `F-pt-085` | `pt` | `tools.database.checkboxUnchecked` | gender / accessibility | `"Desmarcado"` | `"Desmarcada"` | The hidden accessible state describes feminine `caixa de seleção`; its unchecked form must preserve the same grammatical gender. | verified |
| `F-ro-001` | `ro` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Șterge formatarea"` | Google Docs uses `Șterge formatarea textului` in [Romanian help](https://support.google.com/docs/answer/179738?co=GENIE.Platform%3DDesktop&hl=ro), and [CKEditor independently uses the concise form](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/ro.po#L14-L16) selected for this toolbar. | verified |
| `F-ru-001` | `ru` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Очистить форматирование"` | Microsoft’s Russian editor UI uses the exact concise formatting-clear command in [official Word help](https://support.microsoft.com/ru-ru/office/%D0%B4%D0%BE%D0%B1%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5-%D1%8D%D1%84%D1%84%D0%B5%D0%BA%D1%82%D0%B0-%D1%82%D0%B5%D0%BA%D1%81%D1%82%D1%83-%D0%BA%D0%BE%D0%BD%D1%82%D1%83%D1%80%D0%B0-%D1%82%D0%B5%D0%BD%D0%B8-%D0%BE%D1%82%D1%80%D0%B0%D0%B6%D0%B5%D0%BD%D0%B8%D1%8F-%D0%B8%D0%BB%D0%B8-%D1%81%D0%B2%D0%B5%D1%87%D0%B5%D0%BD%D0%B8%D1%8F-%D0%B2-word-3f3a758e-d255-4ba7-94f8-a3ee78fddfe1). | verified |
| `F-ru-002` | `ru` | `blockSettings.dragToMove` | gesture terminology | `"Тяните, чтобы переместить"` | `"Перетащите, чтобы переместить"` | The standard Russian UI verb for a drag gesture is `Перетащите`. | verified |
| `F-ru-003` | `ru` | `blockSettings.clickToOpenMenu` | accessibility / action result | `"Нажмите для меню"` | `"Нажмите, чтобы открыть меню"` | This standalone read-only instruction must name the result of the click. | verified |
| `F-ru-004` | `ru` | `toolbox.optionAddAbove` | shortcut instruction | `"⌥ — добавить выше"` | `"⌥ + щелчок — добавить выше"` | The current hint omits the required click gesture. | verified |
| `F-ru-005` | `ru` | `toolbox.ctrlAddAbove` | shortcut instruction | `"Ctrl — добавить выше"` | `"Ctrl + щелчок — добавить выше"` | The current hint omits the required click gesture. | verified |
| `F-ru-006` | `ru` | `toolbox.typeToSearch` | grammar / clarity | `"Введите для поиска"` | `"Введите запрос для поиска"` | The current instruction is grammatically incomplete without an object. | verified |
| `F-ru-007` | `ru` | `toolNames.bold` | established typography terminology | `"Жирный"` | `"Полужирный"` | [Apple’s Russian keyboard-shortcut guidance](https://support.apple.com/ru-ru/102650) uses the established typography term `полужирным`. | verified |
| `F-ru-008` | `ru` | `tools.marker.textColor` | context / terminology | `"Текст"` | `"Цвет текста"` | The shared color-mode control must explicitly distinguish text color from background color. | verified |
| `F-ru-009` | `ru` | `tools.marker.default` | capitalization | `"по умолчанию"` | `"По умолчанию"` | This is a standalone visible option and follows the locale’s sentence-case register. | verified |
| `F-ru-010` | `ru` | `tools.colorPicker.defaultSwatchLabel` | placeholder grammar | `"{mode} {default}"` | `"{mode}: {default}"` | A colon makes every runtime mode/default combination grammatical without changing either placeholder. | verified |
| `F-ru-011` | `ru` | `tools.colorPicker.colorSwatchLabel` | placeholder grammar | `"{mode} {color}"` | `"{mode}: {color}"` | A colon avoids invalid Russian adjective order and agreement while preserving both placeholders. | verified |
| `F-ru-012` | `ru` | `tools.paragraph.placeholder` | context / grammar | `"Напишите что-нибудь или нажмите / для выбора блока"` | `"Напишите что-нибудь или нажмите /, чтобы выбрать инструмент"` | The slash menu chooses a tool, and the purpose clause requires punctuation. | verified |
| `F-ru-013` | `ru` | `tools.toggle.placeholder` | tool terminology | `"Сворачиваемый блок"` | `"Сворачиваемый список"` | The visible tool type is the toggle-list tool rather than a generic block. | verified |
| `F-ru-014` | `ru` | `tools.toggle.bodyPlaceholder` | action distinction / source synchronization | `"Пустой сворачиваемый блок. Нажмите или перетащите блоки внутрь."` | `"Пустой сворачиваемый блок. Нажмите, чтобы добавить блок, или перетащите блоки сюда."` | The instruction must distinguish click-to-create from drag-to-drop. | verified |
| `F-ru-015` | `ru` | `tools.table.clearSelection` | established table action terminology | `"Очистить"` | `"Очистить содержимое"` | The action preserves cells and formatting; [Microsoft’s Russian Excel UI](https://support.microsoft.com/ru-ru/office/%D0%BE%D1%87%D0%B8%D1%81%D1%82%D0%BA%D0%B0-%D1%8F%D1%87%D0%B5%D0%B5%D0%BA-%D1%81%D0%BE%D0%B4%D0%B5%D1%80%D0%B6%D0%B8%D0%BC%D0%BE%D0%B3%D0%BE-%D0%B8%D0%BB%D0%B8-%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%82%D0%BE%D0%B2-9ff6b8ff-1afd-495f-8ad8-8c1f6f82a9d6) uses `Очистить содержимое`. | verified |
| `F-ru-016` | `ru` | `tools.table.headerColumn` | established table terminology | `"Колонка-заголовок"` | `"Столбец заголовков"` | `Столбец заголовков` is the established Russian term for a table header column. | verified |
| `F-ru-017` | `ru` | `tools.table.headerRow` | established table terminology | `"Строка-заголовок"` | `"Строка заголовков"` | `Строка заголовков` is the established Russian term for a table header row. | verified |
| `F-ru-018` | `ru` | `tools.table.clickToAddRow` | clarity / action | `"Нажмите, чтобы добавить строку"` | `"Нажмите, чтобы добавить новую строку"` | The add-row affordance creates a new row. | verified |
| `F-ru-019` | `ru` | `tools.table.dragToAddRemoveRows` | gesture terminology | `"Тяните, чтобы добавить или удалить строки"` | `"Перетащите, чтобы добавить или удалить строки"` | `Перетащите` is the natural Russian UI verb for the drag gesture. | verified |
| `F-ru-020` | `ru` | `tools.table.clickToAddColumn` | clarity / action | `"Нажмите, чтобы добавить столбец"` | `"Нажмите, чтобы добавить новый столбец"` | The add-column affordance creates a new column. | verified |
| `F-ru-021` | `ru` | `tools.table.dragToAddRemoveColumns` | gesture terminology | `"Тяните, чтобы добавить или удалить столбцы"` | `"Перетащите, чтобы добавить или удалить столбцы"` | `Перетащите` is the natural Russian UI verb for the drag gesture. | verified |
| `F-ru-022` | `ru` | `tools.table.comfortableText` | context / terminology | `"Комфортный текст"` | `"Обычный текст"` | The implementation exposes the regular editor text size opposite compact, not a comfort judgment. | verified |
| `F-ru-023` | `ru` | `tools.table.placement` | established table terminology | `"Расположение"` | `"Выравнивание"` | The picker controls cell-content alignment; [Microsoft’s Russian Excel help](https://support.microsoft.com/ru-ru/excel/get-started/align-or-rotate-text-in-a-cell) uses the corresponding alignment terminology. | verified |
| `F-ru-024` | `ru` | `a11y.dragHandle` | accessibility / action results | `"Перетащите или нажмите для меню"` | `"Перетащите, чтобы переместить блок, или нажмите, чтобы открыть меню"` | The accessible label must describe both actions, their results, and the block object. | verified |
| `F-ru-025` | `ru` | `a11y.dragHandleRole` | accessibility / role terminology | `"управление блоком"` | `"маркер перетаскивания"` | The current role description is generic; this element is specifically a drag handle. | verified |
| `F-ru-026` | `ru` | `a11y.dropPosition` | number agreement / accessibility | `"Будет перемещён на позицию {position} из {total}"` | `"Будет размещено на позиции {position} из {total}"` | Masculine singular fails for one-or-many drag; the replacement is count-neutral and preserves both placeholders. | verified |
| `F-ru-027` | `ru` | `a11y.blocksMoved` | grammar / accessibility | `"Блоков перемещено: {count}, позиция {position}"` | `"Перемещено блоков: {count}. Позиция: {position}"` | Count-neutral wording and two complete announcements remove the comma splice. | verified |
| `F-ru-028` | `ru` | `a11y.movedUp` | grammar / placeholder context | `"Блок перемещён вверх, позиция {position} из {total}"` | `"Блок перемещён вверх на позицию {position} из {total}"` | Russian requires the preposition `на` before the resulting position. | verified |
| `F-ru-029` | `ru` | `a11y.movedDown` | grammar / placeholder context | `"Блок перемещён вниз, позиция {position} из {total}"` | `"Блок перемещён вниз на позицию {position} из {total}"` | Russian requires the preposition `на` before the resulting position. | verified |
| `F-ru-030` | `ru` | `a11y.atTop` | accessibility / failure reason | `"Блок уже вверху"` | `"Блок находится вверху и не может быть перемещён выше"` | The boundary announcement must explain why the requested move failed. | verified |
| `F-ru-031` | `ru` | `a11y.atBottom` | accessibility / failure reason | `"Блок уже внизу"` | `"Блок находится внизу и не может быть перемещён ниже"` | The boundary announcement must explain why the requested move failed. | verified |
| `F-ru-032` | `ru` | `a11y.searchResults` | accessibility / number | `"Результатов: {count}"` | `"Результаты поиска: {count}"` | The label-before-count form is explicit and grammatical for every result count. | verified |
| `F-ru-033` | `ru` | `blockSettings.convertWithChildrenWarning` | number agreement / source-only contract | `"Этот блок содержит {count} вложенных блоков. При конвертации они будут перемещены на верхний уровень. Продолжить?"` | `"Вложенных блоков: {count}. При преобразовании этого блока каждый вложенный блок будет перемещён на верхний уровень. Продолжить?"` | The count-neutral source-only warning avoids one/many agreement failure and replaces jargon. | verified |
| `F-ru-034` | `ru` | `searchTerms.separator` | search alias / transliteration | `"сепаратор"` | `"линия"` | The current alias is needless transliteration; `линия` is a useful native divider query distinct from the other aliases. | verified |
| `F-ru-035` | `ru` | `searchTerms.plain` | search alias / clarity | `"простой"` | `"обычный текст"` | A bare adjective is ambiguous as a paragraph search alias. | verified |
| `F-ru-036` | `ru` | `searchTerms.header` | search alias / register | `"шапка"` | `"название"` | `шапка` is colloquial UI jargon and a misleading heading alias. | verified |
| `F-ru-037` | `ru` | `searchTerms.number` | search alias / semantics | `"число"` | `"нумерация"` | The alias targets a numbered list, not numeric data. | verified |
| `F-ru-038` | `ru` | `searchTerms.citation` | search alias / semantics | `"ссылка"` | `"цитирование"` | The alias targets quote/citation content, not a hyperlink. | verified |
| `F-ru-039` | `ru` | `tools.callout.addEmoji` | source synchronization / icon terminology | `"Добавить эмодзи"` | `"Добавить значок"` | The corrected source presents the selected emoji as the callout icon. | verified |
| `F-ru-040` | `ru` | `tools.callout.editIcon` | established UI terminology | `"Изменить иконку"` | `"Изменить значок"` | `значок` is the established native Russian UI term and matches the adjacent controls. | verified |
| `F-ru-041` | `ru` | `tools.callout.removeEmoji` | established UI terminology | `"Удалить иконку"` | `"Удалить значок"` | `значок` is the established native Russian UI term and matches the adjacent controls. | verified |
| `F-ru-042` | `ru` | `tools.callout.filterEmojis` | accessibility / search context | `"Фильтр…"` | `"Поиск эмодзи…"` | The searchbox accessible name must state both the action and its target. | verified |
| `F-ru-043` | `ru` | `tools.callout.pickRandom` | action completeness | `"Случайно"` | `"Выбрать случайный эмодзи"` | The dice-button tooltip requires a complete action rather than an adverb. | verified |
| `F-ru-044` | `ru` | `tools.callout.skinTone` | established platform terminology | `"Тон кожи"` | `"Оттенок кожи"` | `Оттенок кожи` is the established Russian platform term for an emoji skin-tone selector. | verified |
| `F-ru-045` | `ru` | `tools.callout.emojiCategoryActivity` | emoji category terminology | `"Активности"` | `"Действия"` | `Активности` is an unnatural plural calque; `Действия` is the natural category label. | verified |
| `F-ru-046` | `ru` | `tools.callout.colorDefault` | capitalization | `"по умолчанию"` | `"По умолчанию"` | This is a standalone visible option and follows sentence case. | verified |
| `F-ru-047` | `ru` | `tools.quote.defaultSize` | capitalization | `"по умолчанию"` | `"По умолчанию"` | This is a standalone visible option and follows sentence case. | verified |
| `F-ru-048` | `ru` | `toolNames.equation` | untranslated source copy | `"Equation"` | `"Формула"` | The toolbox name is untranslated; `Формула` is the natural concise Russian tool name. | verified |
| `F-ru-049` | `ru` | `tools.equation.placeholder` | untranslated source copy | `"Enter a LaTeX formula…"` | `"Введите формулу LaTeX…"` | The equation placeholder is untranslated and must follow the locale’s polite imperative register. | verified |
| `F-ru-050` | `ru` | `tools.code.searchLanguage` | number / punctuation | `"Поиск языка..."` | `"Поиск языков…"` | The picker spans multiple languages and the corpus uses the single ellipsis character. | verified |
| `F-ru-051` | `ru` | `blockSettings.copyLinkError` | error context | `"Не удалось скопировать ссылку"` | `"Не удалось скопировать ссылку на блок"` | The error must identify the failed block-link operation. | verified |
| `F-ru-052` | `ru` | `tools.link.linkTitle` | field semantics / source synchronization | `"Название ссылки"` | `"Текст ссылки"` | The field edits visible anchor text rather than link metadata. | verified |
| `F-ru-053` | `ru` | `tools.code.plainText` | source-only terminology / source synchronization | `"Простой текст"` | `"Обычный текст"` | The source-only format contract uses the established Microsoft Russian plain-text term, corroborated by [official Word format help](https://support.microsoft.com/ru-ru/word/file-formats-for-saving-documents). | verified |
| `F-ru-054` | `ru` | `tools.image.converting` | untranslated progress copy | `"Converting…"` | `"Преобразование…"` | The image-conversion progress state is untranslated. | verified |
| `F-ru-055` | `ru` | `tools.image.toggleCaption` | toggle semantics | `"Показать подпись"` | `"Показать или скрыть подпись"` | The same toggle represents both showing and hiding the caption. | verified |
| `F-ru-056` | `ru` | `tools.image.altDescription` | accessibility / source synchronization | `"Добавьте описание изображения. Это сделает вашу страницу доступнее для людей с нарушениями зрения."` | `"Опишите изображение для тех, кто его не видит."` | The corrected source uses concise, direct, user-centered alt-text guidance. | verified |
| `F-ru-057` | `ru` | `tools.image.previewControls` | accessibility / object context | `"Управление просмотром"` | `"Элементы управления просмотром изображения"` | The accessible group label must identify the image-preview object. | verified |
| `F-ru-058` | `ru` | `tools.image.errorFileTooLarge` | untranslated upload error | `"Image is too large. {size} exceeds the {max} limit."` | `"Размер изображения ({size}) превышает ограничение {max}."` | The upload error is untranslated; the replacement preserves both placeholders exactly. | verified |
| `F-ru-059` | `ru` | `tools.image.errorDefaultMessage` | error context / source synchronization | `"Сервер вернул ошибку. Попробуйте другой источник или загрузите файл заново."` | `"Не удалось загрузить изображение по этому URL. Попробуйте другой источник или загрузите файл ещё раз."` | The message should describe the URL image-load failure rather than expose a server implementation detail. | verified |
| `F-ru-060` | `ru` | `tools.image.emptyOrDropHere` | drop-target context | `"или перетащите сюда"` | `"или перетащите изображение сюда"` | The empty-state instruction omitted the object being dropped. | verified |
| `F-ru-061` | `ru` | `tools.image.cropRatioFree` | crop-mode terminology | `"Свободно"` | `"Свободный формат"` | The current adverb is unnatural as a standalone crop-mode label. | verified |
| `F-ru-062` | `ru` | `tools.database.addView` | database terminology | `"Добавить вид"` | `"Добавить представление"` | `представление` is the established Russian database term for a view. | verified |
| `F-ru-063` | `ru` | `tools.database.viewTypeListDescription` | clarity / source synchronization | `"Простой линейный вид"` | `"Показывать элементы простым списком"` | The abstract current phrase should describe the rendered simple-list result. | verified |
| `F-ru-064` | `ru` | `tools.database.propertyTypeSelect` | property semantics | `"Список"` | `"Выбор"` | The property represents one choice, not a list view. | verified |
| `F-ru-065` | `ru` | `tools.database.propertyTypeMultiSelect` | terminology / transliteration | `"Мультивыбор"` | `"Множественный выбор"` | The current hybrid transliteration violates the native terminology requirement. | verified |
| `F-ru-066` | `ru` | `tools.database.cardDetails` | accessibility / object context | `"Карточка"` | `"Сведения о карточке"` | The drawer’s accessible name must identify that it exposes card details. | verified |
| `F-ru-067` | `ru` | `tools.bookmark.loading` | progress context / punctuation | `"Загрузка превью ссылки"` | `"Загрузка предварительного просмотра ссылки…"` | The progress state needs the full Russian link-preview term and an ellipsis. | verified |
| `F-ru-068` | `ru` | `tools.bookmark.error` | terminology / error context | `"Не удалось загрузить превью ссылки"` | `"Не удалось загрузить предварительный просмотр ссылки"` | The natural full Russian term avoids unnecessary English-derived shorthand. | verified |
| `F-ru-069` | `ru` | `tools.embed.empty` | read-only context / source synchronization | `"Вставьте ссылку для встраивания"` | `"Нет ссылки для встраивания"` | The caller renders a read-only empty embed where a paste instruction is impossible. | verified |
| `F-ru-070` | `ru` | `tools.linkPaste.embed` | action terminology | `"Создать встраивание"` | `"Встроить содержимое"` | The nominal calque is unnatural; [YouTube’s official Russian help](https://support.google.com/youtube/answer/171780?hl=ru) uses `Встроить` for the embed action. | verified |
| `F-ru-071` | `ru` | `tools.linkPaste.embedVideo` | embed action / placeholder grammar | `"Вставить {provider}-видео"` | `"Встроить видео из {provider}"` | Embed is not insert, and the brand compound is awkward; the provider placeholder is preserved. | verified |
| `F-ru-072` | `ru` | `tools.linkPaste.embedAudio` | embed action | `"Вставить аудио из {provider}"` | `"Встроить аудио из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-073` | `ru` | `tools.linkPaste.embedImage` | embed action | `"Вставить изображение из {provider}"` | `"Встроить изображение из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-074` | `ru` | `tools.linkPaste.embedSocial` | embed action / terminology | `"Вставить пост из {provider}"` | `"Встроить публикацию из {provider}"` | The action creates an embed, and `публикация` is the natural neutral term. | verified |
| `F-ru-075` | `ru` | `tools.linkPaste.embedDocument` | embed action | `"Вставить документ из {provider}"` | `"Встроить документ из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-076` | `ru` | `tools.linkPaste.embedTable` | embed action | `"Вставить таблицу из {provider}"` | `"Встроить таблицу из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-077` | `ru` | `tools.linkPaste.embedForm` | embed action | `"Вставить форму из {provider}"` | `"Встроить форму из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-078` | `ru` | `tools.linkPaste.embedCode` | embed action | `"Вставить код из {provider}"` | `"Встроить код из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-079` | `ru` | `tools.linkPaste.embedDesign` | embed action | `"Вставить макет из {provider}"` | `"Встроить макет из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-080` | `ru` | `tools.linkPaste.embedChart` | embed action / terminology | `"Вставить график из {provider}"` | `"Встроить диаграмму из {provider}"` | The action creates an embed, and `диаграмма` covers the broader chart concept. | verified |
| `F-ru-081` | `ru` | `tools.linkPaste.embedMap` | embed action | `"Вставить карту из {provider}"` | `"Встроить карту из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-082` | `ru` | `tools.linkPaste.embedCalendar` | embed action | `"Вставить календарь из {provider}"` | `"Встроить календарь из {provider}"` | The paste-menu action creates an embed, not a generic insertion. | verified |
| `F-ru-083` | `ru` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Упоминание"` | `"Упомянуть"` | The paste-menu contract names an action alongside other infinitive commands. | verified |
| `F-ru-084` | `ru` | `tools.file.toggleCaption` | toggle semantics | `"Показать подпись"` | `"Показать или скрыть подпись"` | The same toggle represents both showing and hiding the caption. | verified |
| `F-ru-085` | `ru` | `tools.file.errorFileTooLarge` | untranslated upload error | `"File is too large. {size} exceeds the {max} limit."` | `"Размер файла ({size}) превышает ограничение {max}."` | The upload error is untranslated; both placeholders remain exact. | verified |
| `F-ru-086` | `ru` | `tools.file.previewRaw` | preview-tab semantics | `"Код"` | `"Исходный текст"` | The raw tab shows source text that is not necessarily program code. | verified |
| `F-ru-087` | `ru` | `tools.file.previewRender` | preview-tab semantics | `"Просмотр"` | `"Предпросмотр"` | This names the formatted preview state opposite the source-text tab. | verified |
| `F-ru-088` | `ru` | `tools.video.alignmentLeft` | action terminology | `"Слева"` | `"Выровнять по левому краю"` | The settings item performs an alignment action and has no separate action label. | verified |
| `F-ru-089` | `ru` | `tools.video.alignmentCenter` | action terminology | `"По центру"` | `"Выровнять по центру"` | The settings item performs an alignment action and has no separate action label. | verified |
| `F-ru-090` | `ru` | `tools.video.alignmentRight` | action terminology | `"Справа"` | `"Выровнять по правому краю"` | The settings item performs an alignment action and has no separate action label. | verified |
| `F-ru-091` | `ru` | `tools.video.toggleCaption` | toggle semantics / source-only contract | `"Показать подпись"` | `"Показать или скрыть подпись"` | The source-only toggle represents both showing and hiding the caption. | verified |
| `F-ru-092` | `ru` | `tools.video.errorFileTooLarge` | untranslated upload error | `"Video is too large. {size} exceeds the {max} limit."` | `"Размер видео ({size}) превышает ограничение {max}."` | The upload error is untranslated; both placeholders remain exact. | verified |
| `F-ru-093` | `ru` | `tools.video.emptyOrDropHere` | drop-target context | `"или перетащите сюда"` | `"или перетащите видео сюда"` | The empty-state instruction omitted the object being dropped. | verified |
| `F-ru-094` | `ru` | `tools.audio.alignmentLeft` | action terminology | `"Слева"` | `"Выровнять по левому краю"` | The settings item performs an alignment action and has no separate action label. | verified |
| `F-ru-095` | `ru` | `tools.audio.alignmentCenter` | action terminology | `"По центру"` | `"Выровнять по центру"` | The settings item performs an alignment action and has no separate action label. | verified |
| `F-ru-096` | `ru` | `tools.audio.alignmentRight` | action terminology | `"Справа"` | `"Выровнять по правому краю"` | The settings item performs an alignment action and has no separate action label. | verified |
| `F-ru-097` | `ru` | `tools.audio.errorFileTooLarge` | untranslated upload error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Размер аудиофайла ({size}) превышает ограничение {max}."` | The upload error is untranslated; both placeholders remain exact. | verified |
| `F-ru-098` | `ru` | `tools.audio.errorGoogleDrive` | recovery copy / product terminology | `"Ссылки Google Drive нельзя воспроизвести напрямую — скачайте файл и загрузите его сюда."` | `"Аудио по ссылкам на Google Диск нельзя воспроизвести напрямую — скачайте файл и загрузите его сюда."` | Links are not played; [Google’s official Russian help](https://support.google.com/drive/answer/2424384?co=GENIE.Platform%3DDesktop&hl=ru-US) uses the product name `Google Диск`. | verified |
| `F-ru-099` | `ru` | `tools.audio.errorOneDrive` | recovery copy / subject clarity | `"Ссылки OneDrive нельзя воспроизвести напрямую — скачайте файл и загрузите его сюда."` | `"Аудио по ссылкам на OneDrive нельзя воспроизвести напрямую — скачайте файл и загрузите его сюда."` | The audio, not the links themselves, cannot be played; [Microsoft’s Russian OneDrive help](https://support.microsoft.com/ru-RU/onedrive/share-files-and-folders-in-microsoft-onedrive) corroborates the product context. | verified |
| `F-ru-100` | `ru` | `tools.audio.titlePlaceholder` | untranslated metadata | `"Track title"` | `"Название трека"` | The track-title metadata placeholder is untranslated. | verified |
| `F-ru-101` | `ru` | `tools.audio.artistPlaceholder` | untranslated metadata | `"Artist"` | `"Исполнитель"` | The artist metadata placeholder is untranslated. | verified |
| `F-ru-102` | `ru` | `tools.audio.emptyOrDropHere` | drop-target context | `"или перетащите сюда"` | `"или перетащите аудиофайл сюда"` | The empty-state instruction omitted the audio-file object. | verified |
| `F-ru-103` | `ru` | `tools.audio.coverChange` | untranslated cover action | `"Change cover"` | `"Изменить обложку"` | The cover-image action is untranslated. | verified |
| `F-ru-104` | `ru` | `tools.audio.coverSet` | untranslated cover action | `"Set cover image"` | `"Установить обложку"` | The cover-image action is untranslated. | verified |
| `F-ru-105` | `ru` | `tools.audio.coverRemove` | untranslated cover action | `"Remove cover"` | `"Удалить обложку"` | The cover-image action is untranslated. | verified |
| `F-ru-106` | `ru` | `tools.audio.coverErrorType` | untranslated recovery copy | `"Choose an image file"` | `"Выберите файл изображения"` | The wrong-file-type recovery instruction is untranslated. | verified |
| `F-ru-107` | `ru` | `tools.audio.coverErrorTooLarge` | untranslated error | `"Image is too large"` | `"Изображение слишком большое"` | The cover-image size error is untranslated. | verified |
| `F-ru-108` | `ru` | `tools.audio.coverAdd` | untranslated cover action | `"Add a cover"` | `"Добавьте обложку"` | The empty-cover action is untranslated. | verified |
| `F-ru-109` | `ru` | `tools.audio.coverOrDropHere` | drop-target context | `"или перетащите сюда"` | `"или перетащите изображение сюда"` | The cover-image drop instruction omitted its object. | verified |
| `F-ru-110` | `ru` | `tools.audio.coverSourceAria` | accessibility / object context | `"Источник изображения"` | `"Источник обложки"` | The accessible tab-group name must identify the cover-image role rather than a generic image source. | verified |
| `F-ru-111` | `ru` | `a11y.allBlocksSelected` | accessibility / number grammar | `"Выбраны все блоки, блоков: {count}"` | `"Выбраны все блоки. Всего: {count}"` | The replacement is count-neutral and removes repetition and a comma splice. | verified |
| `F-ru-112` | `ru` | `a11y.navigationModeEntered` | accessibility / interaction and keyboard terminology | `"Режим навигации. Используйте стрелки для перемещения между блоками, Enter — для редактирования, Escape — для выхода."` | `"Режим навигации. Используйте клавиши со стрелками для перехода между блоками, Enter — для редактирования, Esc — для выхода."` | The instruction names the arrow keys, distinguishes navigation from moving blocks, and uses the current Russian platform label `Esc`, corroborated by [Apple’s shortcut reference](https://support.apple.com/ru-ru/102650), [Microsoft Access shortcuts](https://support.microsoft.com/ru-ru/accessibility/access/keyboard-shortcuts-for-access), and [Microsoft keyboard-interaction guidance](https://learn.microsoft.com/ru-ru/windows/uwp/design/input/keyboard-interactions). | verified |
| `F-ru-113` | `ru` | `a11y.navigationModeExited` | accessibility / completed state | `"Выход из режима навигации"` | `"Режим навигации завершён"` | A live-region announcement should describe the completed state. | verified |
| `F-ru-114` | `ru` | `a11y.navigatedToBlock` | accessibility / completed event | `"Переход к блоку"` | `"Вы перешли к блоку"` | A live-region announcement should describe the completed navigation event. | verified |
| `F-ru-115` | `ru` | `blockSettings.orConjunction` | composition grammar | `" или "` | `" или используйте "` | The fragment must compose naturally as `Нажмите или используйте Ctrl+/…`. | verified |
| `F-ru-116` | `ru` | `blockSettings.openMenuAction` | composition punctuation | `" чтобы открыть меню"` | `", чтобы открыть меню"` | Both runtime compositions require the leading comma before the purpose clause. | verified |
| `F-ru-117` | `ru` | `tools.video.seek` | accessibility / media terminology | `"Перемотка"` | `"Позиция воспроизведения"` | The range control represents the current playback position, not a rewind action. | verified |
| `F-ru-118` | `ru` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization / grammar | `"Переключить отображение времени"` | `"Переключить отображение прошедшего и оставшегося времени"` | The accessible action must name the two actual display states while retaining `отображение` as the grammatical object of `Переключить`; the intermediate wording incorrectly treated the two times themselves as objects being switched. | verified |
| `F-ru-119` | `ru` | `tools.video.speedPresets` | UI terminology | `"Предустановки скорости"` | `"Предустановленные скорости"` | The adjective phrase is natural Russian UI copy and avoids an implementation-style nominal calque. | verified |
| `F-ru-120` | `ru` | `tools.video.ctxStats` | slang / source synchronization | `"Статистика для гиков"` | `"Статистика воспроизведения"` | The current label uses prohibited slang; the replacement identifies the playback-data context. | verified |
| `F-ru-121` | `ru` | `tools.callout.emojiCategoryTravel` | category scope / established terminology | `"Путешествия"` | `"Путешествия и места"` | The caller maps emoji-mart’s `places` category to this label, so travel alone omits part of the gallery; [Microsoft Teams’ Russian emoji guidance](https://support.microsoft.com/ru-ru/teams/chat/send-an-emoji-gif-or-sticker-in-microsoft-teams) uses the established category `Путешествия и места`. | verified |
| `F-ru-122` | `ru` | `blockSettings.lastEdited` | metadata terminology | `"Последнее редактирование"` | `"Последнее изменение"` | The footer reports the latest saved modification rather than the editing process; Google Docs uses the exact Russian metadata term `Последнее изменение`. | verified |
| `F-ru-123` | `ru` | `blockSettings.lastEditedBy` | metadata relationship / placeholder | `"Последнее редактирование: {name}"` | `"Автор последнего изменения: {name}"` | The author-bearing footer must state the person’s relationship to the last modification; Microsoft uses `автор последнего изменения` in Russian metadata UI. | verified |
| `F-ru-124` | `ru` | `tools.callout.emojiCategoryPeople` | category scope / accessibility | `"Люди"` | `"Смайлики и люди"` | The visible heading and navigation accessible name cover smileys as well as people; Microsoft’s Russian emoji UI names both scopes. | verified |
| `F-ru-125` | `ru` | `tools.callout.emojiCategoryNature` | category scope / accessibility | `"Природа"` | `"Животные и природа"` | The category begins with and contains animals as well as plants; Google’s Russian emoji picker names both scopes. | verified |
| `F-ru-126` | `ru` | `tools.callout.emojiCategoryFood` | category scope / accessibility | `"Еда"` | `"Еда и напитки"` | The category contains food and beverages; Google’s Russian emoji picker names both scopes. | verified |
| `F-sd-001` | `sd` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"فارميٽنگ صاف ڪريو"` | WordPress Sindhi supplies the native clear action `صاف ڪريو` in its [official catalog](https://translate.wordpress.org/projects/wp/dev/snd/default/export-translations/?format=po); the object reuses this dictionary’s established `فارميٽنگ` noun. This adapted value remains flagged for a distinct full-language pass. | verified |
| `F-si-001` | `si` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"හැඩතල ගැන්වීම ඉවත් කරන්න"` | WordPress Sinhala uses `ආකෘතිකරණය ඉවත්කරන්න` for Clear formatting in its [official catalog](https://translate.wordpress.org/projects/wp/dev/si/default/export-translations/?format=po); the selected wording follows this dictionary’s existing formatting noun and spacing conventions. | verified |
| `F-sk-001` | `sk` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Vymazať formátovanie"` | Microsoft’s Slovak editor UI uses the exact command [Vymazať formátovanie](https://support.microsoft.com/sk-SK/PowerPoint/clear-all-text-formatting). | verified |
| `F-sl-001` | `sl` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Počisti oblikovanje"` | Microsoft’s Slovenian editor UI uses the exact concise command [Počisti oblikovanje](https://support.microsoft.com/sl-SI/PowerPoint/clear-all-text-formatting). | verified |
| `F-sq-001` | `sq` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Largo formatimin"` | CKEditor’s Albanian remove-format plugin uses the exact command [Largo formatimin](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/sq.po#L14-L16). | verified |
| `F-sr-001` | `sr` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Уклони форматирање"` | CKEditor’s Serbian Cyrillic remove-format plugin uses the exact command [Уклони форматирање](https://github.com/ckeditor/ckeditor5/blob/master/packages/ckeditor5-remove-format/lang/translations/sr.po#L14-L16), preserving this dictionary’s shipped script. | verified |
| `F-sv-001` | `sv` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"Radera formatering"` | Microsoft’s Swedish editor UI uses the exact concise command [Radera formatering](https://support.microsoft.com/sv-SE/PowerPoint/clear-all-text-formatting). | verified |
| `F-sv-002` | `sv` | `blockSettings.convertWithChildrenWarning` | number / terminology / source synchronization | `"Det här blocket innehåller {count} nästlade block. Om du konverterar det flyttas de till den översta nivån. Vill du fortsätta?"` | `"Nästlade block: {count}. Om du omvandlar det här blocket flyttas varje nästlat block till den översta nivån. Fortsätta?"` | The source-only count can be one or many; the first correction retained plural `de`, which fails at `{count}=1`. `Varje nästlat block` is count-neutral, while `omvandla` stays consistent with the visible conversion terminology and corrected source contract. | verified |
| `F-sv-003` | `sv` | `toolbox.optionAddAbove` | shortcut / action clarity | `"⌥ — lägg till ovanför"` | `"⌥-klicka för att lägga till ovanför"` | The tooltip must state the click gesture required with the Option key rather than present a key and an unrelated action fragment. | verified |
| `F-sv-004` | `sv` | `toolbox.ctrlAddAbove` | shortcut / action clarity | `"Ctrl — lägg till ovanför"` | `"Ctrl-klicka för att lägga till ovanför"` | The tooltip must state the Ctrl-click gesture required by the caller. | verified |
| `F-sv-005` | `sv` | `tools.colorPicker.defaultSwatchLabel` | accessibility / spoken-label clarity | `"{mode} {default}"` | `"{mode}: {default}"` | The template is a swatch accessible name; the colon makes caller output such as `Textfärg: Standard` an unambiguous label-value pair. | verified |
| `F-sv-006` | `sv` | `tools.colorPicker.colorSwatchLabel` | accessibility / spoken-label clarity | `"{mode} {color}"` | `"{mode}: {color}"` | The template is a swatch accessible name; the colon makes values such as `Textfärg: Grå` unambiguous. | verified |
| `F-sv-007` | `sv` | `tools.paragraph.placeholder` | hint clarity | `"Skriv något eller tryck / för att välja"` | `"Skriv något eller tryck / för att välja ett verktyg"` | The current sentence is incomplete because it omits what the slash command selects. | verified |
| `F-sv-008` | `sv` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"Tom vikbar lista. Klicka eller släpp block här."` | `"Tom vikbar lista. Klicka för att lägga till ett block eller dra block hit."` | The click creates a child block while drag accepts existing blocks; the replacement names both distinct actions. | verified |
| `F-sv-009` | `sv` | `tools.toggle.ariaLabelCollapse` | action terminology / accessibility | `"Dölj"` | `"Fäll ihop"` | The control collapses a disclosure; `Dölj` only says hide and loses the paired expand/collapse model. | verified |
| `F-sv-010` | `sv` | `tools.toggle.ariaLabelExpand` | action terminology / accessibility | `"Visa"` | `"Fäll ut"` | The control expands a disclosure; `Visa` only says show and loses the paired expand/collapse model. | verified |
| `F-sv-011` | `sv` | `tools.table.clearSelection` | context / action accuracy | `"Rensa"` | `"Rensa innehåll"` | Both table callers clear selected cell, row, or column contents rather than merely clearing the painted selection. | verified |
| `F-sv-012` | `sv` | `tools.table.placement` | terminology / source synchronization | `"Placering"` | `"Justering"` | The 3-by-3 control changes cell-content alignment, not the cell’s location; Microsoft Swedish uses `textjustering` for this concept. | verified |
| `F-sv-013` | `sv` | `blockSettings.copyLink` | semantics / compound terminology | `"Kopiera länk till block"` | `"Kopiera blockets länk"` | The current phrase can mean copying a link into a block; the action copies the link that belongs to this block. | verified |
| `F-sv-014` | `sv` | `a11y.dragHandle` | accessibility / clarity | `"Dra för att flytta eller klicka för meny"` | `"Dra för att flytta blocket eller klicka för att öppna menyn"` | The accessible instruction needs both objects and the result of clicking the handle. | verified |
| `F-sv-015` | `sv` | `a11y.blocksMoved` | number agreement / accessibility | `"{count} block flyttade till position {position}"` | `"Flyttade block: {count}. Position: {position}"` | Swedish participle agreement differs for one and many; the label-before-count form remains grammatical for every runtime count. | verified |
| `F-sv-016` | `sv` | `a11y.blocksDuplicated` | number agreement / accessibility | `"{count} block duplicerade från position {position}"` | `"Duplicerade block: {count}. Från position {position}"` | The current plural participle is ungrammatical for a count of one; the replacement is count-neutral. | verified |
| `F-sv-017` | `sv` | `a11y.atTop` | grammar / accessibility / source synchronization | `"Blocket är högst upp, kan inte flyttas uppåt"` | `"Blocket är högst upp och kan inte flyttas uppåt"` | Replaces a comma splice with the complete conjunction required by the corrected source. | verified |
| `F-sv-018` | `sv` | `a11y.atBottom` | grammar / accessibility / source synchronization | `"Blocket är längst ner, kan inte flyttas nedåt"` | `"Blocket är längst ner och kan inte flyttas nedåt"` | Replaces a comma splice with the complete conjunction required by the corrected source. | verified |
| `F-sv-019` | `sv` | `a11y.searchResults` | accessibility / source synchronization | `"{count} resultat"` | `"Sökresultat: {count}"` | The label-before-count form identifies what the live-region number represents and remains grammatical for every count. | verified |
| `F-sv-020` | `sv` | `a11y.allBlocksSelected` | number / punctuation / source synchronization | `"Alla block markerade, {count} block"` | `"Alla block markerade. Totalt: {count}"` | Avoids a comma splice and repeated count-sensitive noun while preserving the total. | verified |
| `F-sv-021` | `sv` | `a11y.blocksSelected` | number agreement / accessibility | `"{count} block markerade"` | `"Markerade block: {count}"` | Swedish participle agreement differs for one and many; the replacement is count-neutral. | verified |
| `F-sv-022` | `sv` | `a11y.navigationModeEntered` | accessibility / instruction grammar | `"Navigeringsläge. Använd piltangenterna för att flytta mellan block, Enter för att redigera, Escape för att avsluta."` | `"Navigeringsläge. Använd piltangenterna för att flytta mellan block. Tryck på Enter för att redigera och på Escape för att avsluta."` | Complete keyboard instructions are clearer when read aloud than the current comma-separated fragments. | verified |
| `F-sv-023` | `sv` | `a11y.navigationModeExited` | grammar / event state | `"Avslutade navigeringsläge"` | `"Navigeringsläget avslutades"` | The current phrase lacks definite agreement and an explicit event subject; the passive sentence announces the completed state naturally. | verified |
| `F-sv-024` | `sv` | `a11y.navigatedToBlock` | grammar / accessibility | `"Navigerade till block"` | `"Navigerat till blocket"` | The completed status announcement requires a resultative participle rather than a finite past-tense verb without a subject, and the definite noun identifies the specific block that received focus. | verified |
| `F-sv-025` | `sv` | `a11y.dropCreateColumnLeft` | drop context / accessibility | `"Skapar en kolumn till vänster"` | `"En kolumn skapas till vänster när du släpper"` | The announcement occurs before drop and must describe the prospective result rather than imply creation is already happening. | verified |
| `F-sv-026` | `sv` | `a11y.dropCreateColumnRight` | drop context / accessibility | `"Skapar en kolumn till höger"` | `"En kolumn skapas till höger när du släpper"` | The announcement occurs before drop and must describe the prospective result rather than imply creation is already happening. | verified |
| `F-sv-027` | `sv` | `tools.columns.resizeAriaLabel` | accessibility / specificity | `"Ändra kolumnstorlek"` | `"Ändra kolumnbredd"` | The drag handle changes column width, not an arbitrary column dimension or property. | verified |
| `F-sv-028` | `sv` | `tools.columns.turnInto` | terminology consistency / source-only contract | `"Konvertera till kolumner"` | `"Omvandla till kolumner"` | `Omvandla` matches the reviewed visible conversion heading and is the natural document-editing action for this source-only title. | verified |
| `F-sv-029` | `sv` | `searchTerms.header` | semantic alias / duplicate search slot | `"sidhuvud"` | `"överskrift"` | The alias targets the heading tool, so `sidhuvud` is semantically wrong; the first correction duplicated `searchTerms.heading=rubrik` and wasted one of the tool's three search slots. Svenska Akademiens ordlista records [överskrift](https://svenska.se/saol/?sok=%C3%B6verskrift) as a genuine heading synonym. | verified |
| `F-sv-030` | `sv` | `searchTerms.unordered` | list terminology | `"osorterad"` | `"oordnad"` | An unordered list is not an unsorted data set; `oordnad` preserves the list-model meaning. | verified |
| `F-sv-031` | `sv` | `searchTerms.ordered` | list terminology | `"sorterad"` | `"ordnad"` | An ordered list expresses sequence rather than semantic sorting; `ordnad` preserves that distinction. | verified |
| `F-sv-032` | `sv` | `searchTerms.collapse` | terminology consistency | `"dölj"` | `"fäll ihop"` | The search alias should name the disclosure-collapse action used by the corrected toggle control rather than generic hiding. | verified |
| `F-sv-033` | `sv` | `searchTerms.expand` | terminology consistency | `"visa"` | `"fäll ut"` | The search alias should name the disclosure-expand action used by the corrected toggle control rather than generic showing. | verified |
| `F-sv-034` | `sv` | `tools.callout.addEmoji` | terminology / source synchronization | `"Lägg till emoji"` | `"Lägg till ikon"` | The callout presents the chosen emoji as an editable and removable icon, matching the corrected source. | verified |
| `F-sv-035` | `sv` | `tools.callout.filterEmojis` | search clarity / accessibility / source synchronization | `"Filtrera…"` | `"Sök efter emojier…"` | The value is the placeholder and accessible name of an emoji searchbox, not a generic filter action. | verified |
| `F-sv-036` | `sv` | `tools.callout.pickRandom` | action clarity / accessibility / source synchronization | `"Slumpmässig"` | `"Välj en slumpmässig emoji"` | The dice button needs a complete action and object rather than a bare adjective. | verified |
| `F-sv-037` | `sv` | `tools.callout.skinTone` | established product terminology | `"Hudfärg"` | `"Hudton"` | Microsoft’s Swedish emoji UI uses the exact selector term [Hudton](https://support.microsoft.com/sv-se/teams/chat/select-your-emoji-skin-tone). | verified |
| `F-sv-038` | `sv` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"Ekvation"` | The inline equation tool retains an English fallback instead of the standard Swedish mathematical term. | verified |
| `F-sv-039` | `sv` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"Ange en LaTeX-formel…"` | Localizes the complete instruction while retaining the LaTeX product name. | verified |
| `F-sv-040` | `sv` | `tools.code.searchLanguage` | punctuation / source synchronization | `"Sök språk..."` | `"Sök språk…"` | The continuing search input must use the corpus-standard U+2026 ellipsis rather than three full stops. | verified |
| `F-sv-041` | `sv` | `tools.link.linkTitle` | context / terminology / source synchronization | `"Länktitel"` | `"Länktext"` | The inline-link field edits the anchor’s visible text, not title metadata. | verified |
| `F-sv-042` | `sv` | `tools.image.exitFullscreen` | action terminology | `"Avsluta helskärm"` | `"Avsluta helskärmsläge"` | The control exits a mode; [official Swedish platform terminology](https://support.microsoft.com/sv-se/topic/windows-spel-helsk%C3%A4rmsl%C3%A4ge-67fb8d12-5467-4a95-8adf-0a10789576ab) uses `helskärmsläge`. | verified |
| `F-sv-043` | `sv` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"Konverterar…"` | The visible image-processing progress state retains an English fallback. | verified |
| `F-sv-044` | `sv` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"Lägg till alt-text som beskriver bilden. Det gör sidan mer tillgänglig för personer med nedsatt syn eller som är blinda."` | `"Beskriv den här bilden för personer som inte kan se den."` | The dialog already establishes alternative text; the corrected source is concise and directly describes the audience, consistent with [Microsoft’s Swedish alternative-text guidance](https://support.microsoft.com/sv-se/accessibility/office-accessibility/everything-you-need-to-know-to-write-effective-alt-text). | verified |
| `F-sv-045` | `sv` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"Bilden är för stor. {size} överskrider gränsen på {max}."` | Localizes the upload error and preserves both interpolation placeholders exactly. | verified |
| `F-sv-046` | `sv` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"URL:en returnerade ett fel. Prova en annan källa eller ladda upp filen igen."` | `"Bilden kunde inte läsas in från den här webbadressen. Prova en annan källa eller ladda upp filen igen."` | The corrected source identifies the failed image load; the current text instead personifies a URL and obscures what failed. | verified |
| `F-sv-047` | `sv` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"Filen är för stor. {size} överskrider gränsen på {max}."` | Localizes the file upload error and preserves both placeholders exactly. | verified |
| `F-sv-048` | `sv` | `tools.file.previewRender` | terminology / source synchronization | `"Vy"` | `"Förhandsgranskning"` | The corrected source names the rendered Preview tab; `Vy` is only a generic view and does not match the surrounding preview UI. | verified |
| `F-sv-049` | `sv` | `tools.video.alignmentLeft` | action terminology | `"Vänster"` | `"Vänsterjustera"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-sv-050` | `sv` | `tools.video.alignmentCenter` | action terminology | `"Centrerat"` | `"Centrera"` | The settings item performs an alignment action; the current adjective only describes a state. | verified |
| `F-sv-051` | `sv` | `tools.video.alignmentRight` | action terminology | `"Höger"` | `"Högerjustera"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-sv-052` | `sv` | `tools.video.hideControls` | media terminology / specificity | `"Dölj kontroller"` | `"Dölj uppspelningsreglage"` | The setting hides the player’s playback controls; `reglage` is the established Swedish media-interface term and the compound supplies the missing context. | verified |
| `F-sv-053` | `sv` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"Videon är för stor. {size} överskrider gränsen på {max}."` | Localizes the video upload error and preserves both placeholders exactly. | verified |
| `F-sv-054` | `sv` | `tools.audio.alignmentLeft` | action terminology | `"Vänster"` | `"Vänsterjustera"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-sv-055` | `sv` | `tools.audio.alignmentCenter` | action terminology | `"Centrerat"` | `"Centrera"` | The settings item performs an alignment action; the current adjective only describes a state. | verified |
| `F-sv-056` | `sv` | `tools.audio.alignmentRight` | action terminology | `"Höger"` | `"Högerjustera"` | The settings item performs an alignment action and has no separate accessible action label. | verified |
| `F-sv-057` | `sv` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"Ljudfilen är för stor. {size} överskrider gränsen på {max}."` | Localizes the upload error, identifies the file resource, and preserves both placeholders exactly. | verified |
| `F-sv-058` | `sv` | `tools.audio.errorGoogleDrive` | natural recovery copy / source synchronization | `"Google Drive-länkar kan inte spelas upp direkt — ladda ner filen och ladda upp den här."` | `"Google Drive-länkar kan inte spelas upp direkt. Ladda ner filen och ladda upp den här i stället."` | Two complete sentences improve readability and restore the source’s missing `instead` recovery relationship. | verified |
| `F-sv-059` | `sv` | `tools.audio.errorOneDrive` | natural recovery copy / source synchronization | `"OneDrive-länkar kan inte spelas upp direkt — ladda ner filen och ladda upp den här."` | `"OneDrive-länkar kan inte spelas upp direkt. Ladda ner filen och ladda upp den här i stället."` | Two complete sentences improve readability and restore the source’s missing `instead` recovery relationship. | verified |
| `F-sv-060` | `sv` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"Spårtitel"` | [Spotify’s Swedish metadata guidance](https://support.spotify.com/se/artists/article/metadata-formatting-guidelines/) uses the established compound `spårtitel` for a track-title field. | verified |
| `F-sv-061` | `sv` | `tools.audio.emptyAddAudio` | grammar / media terminology | `"Lägg till en ljud"` | `"Lägg till ljud"` | Swedish `ljud` is neuter and is naturally used as a mass noun in this media action; the current common-gender article is ungrammatical. | verified |
| `F-sv-062` | `sv` | `tools.audio.emptyOrDropHere` | grammar / media terminology | `"eller släpp en ljud här"` | `"eller släpp en ljudfil här"` | The drop target accepts an audio file; the current common-gender article before neuter `ljud` is ungrammatical. | verified |
| `F-sv-063` | `sv` | `tools.audio.coverChange` | pending translation / established media terminology | `"Change cover"` | `"Ändra omslagsbild"` | Localizes the artwork action with Spotify Swedish’s exact [Ändra omslagsbild](https://support.spotify.com/se/article/add-playlist-cover/) terminology. | verified |
| `F-sv-064` | `sv` | `tools.audio.coverSet` | pending translation / established media terminology | `"Set cover image"` | `"Ange omslagsbild"` | Localizes the action and uses the same established `omslagsbild` term as the adjacent artwork controls. | verified |
| `F-sv-065` | `sv` | `tools.audio.coverRemove` | pending translation / established media terminology | `"Remove cover"` | `"Ta bort omslagsbild"` | Localizes the removal action and retains the reviewed cover-image term. | verified |
| `F-sv-066` | `sv` | `tools.audio.coverErrorType` | pending translation / error | `"Choose an image file"` | `"Välj en bildfil"` | Localizes the wrong-file-type recovery instruction. | verified |
| `F-sv-067` | `sv` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"Bilden är för stor"` | Localizes the cover-image size error. | verified |
| `F-sv-068` | `sv` | `tools.audio.coverAdd` | pending translation / established media terminology | `"Add a cover"` | `"Lägg till omslagsbild"` | Localizes the empty-cover action with Spotify Swedish’s established `omslagsbild` term. | verified |
| `F-sv-069` | `sv` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"Bildkälla"` | `"Omslagsbildens källa"` | The accessible tab-group name must identify the cover-image source selector rather than a generic image source. | verified |
| `F-sv-070` | `sv` | `tools.database.viewTypeBoardDescription` | grammar / source synchronization | `"Visa arbete som kolumner"` | `"Visa arbetet i kolumner"` | The view description needs a definite object and the natural preposition for arranging work in columns. | verified |
| `F-sv-071` | `sv` | `tools.database.viewTypeListDescription` | terminology / clarity / source synchronization | `"En enkel linjär vy"` | `"Visa objekt i en enkel lista"` | The current abstract phrase loses both the user action and the familiar list concept from the corrected source. | verified |
| `F-sv-072` | `sv` | `tools.bookmark.loading` | progress context / punctuation / source synchronization | `"Läser in förhandsvisning av länk"` | `"Läser in en förhandsgranskning av länken…"` | The rendered progress state needs the definite link context and the corpus-standard ellipsis. | verified |
| `F-sv-073` | `sv` | `tools.bookmark.error` | context / source synchronization | `"Det gick inte att läsa in förhandsvisningen"` | `"Det gick inte att läsa in förhandsgranskningen av länken"` | The error must identify the link preview rather than a generic preview. | verified |
| `F-sv-074` | `sv` | `tools.embed.empty` | read-only context / source synchronization | `"Klistra in en länk att bädda in"` | `"Ingen inbäddningslänk"` | The caller renders a read-only empty embed, where a paste instruction is impossible. | verified |
| `F-sv-075` | `sv` | `tools.linkPaste.mention` | action grammar / source-only contract | `"Omnämnande"` | `"Omnämn"` | `buildPasteMenuItems` defines an action title alongside imperatives; Notion Swedish uses the exact action phrase [Omnämn en person](https://www.notion.com/sv/help/writing-and-editing-basics). | verified |
| `F-sv-076` | `sv` | `notifier.dismiss` | semantics / action | `"Avfärda"` | `"Stäng"` | The × button closes the notification; `Avfärda` means rejecting or dismissing a proposition and is unnatural as the button’s accessible action. | verified |
| `F-sv-077` | `sv` | `tools.video.seek` | accessibility / media terminology | `"Sök"` | `"Uppspelningsposition"` | The accessible name belongs to a playback-position slider; `Sök` incorrectly suggests content search. | verified |
| `F-sv-078` | `sv` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"Växla tidsvisning"` | `"Växla mellan förfluten och återstående tid"` | The accessible action must identify the two actual time-display states instead of exposing an abstract toggle. | verified |
| `F-sv-079` | `sv` | `tools.video.fullscreenExit` | action terminology | `"Avsluta helskärm"` | `"Avsluta helskärmsläge"` | The control exits a mode; official Swedish platform terminology uses `helskärmsläge`. | verified |
| `F-sv-080` | `sv` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"Kopiera videons URL vid aktuell tid"` | `"Kopiera videons URL vid aktuell uppspelningsposition"` | The copied URL targets the current playback head; `aktuell tid` can instead mean the current wall-clock time. | verified |
| `F-sv-081` | `sv` | `tools.video.ctxStats` | slang / terminology / source synchronization | `"Statistik för nördar"` | `"Uppspelningsstatistik"` | The corrected source deliberately removes slang and identifies the playback-data context. | verified |
| `F-sv-082` | `sv` | `tools.callout.emojiSearchResults` | number / accessibility / source synchronization | `"{count} emojier hittades"` | `"Emojiträffar: {count}"` | The live region can announce one match; the label-before-count form is grammatical for every result count. | verified |
| `F-sv-083` | `sv` | `tools.callout.emojiCategoryActivity` | established emoji-category terminology / number | `"Aktivitet"` | `"Aktiviteter"` | The emoji picker renders this as a section heading and category-navigation accessible name; [Unicode CLDR Swedish](https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/main/sv.xml) and [Microsoft Teams Swedish](https://support.microsoft.com/sv-se/office/skicka-en-emoji-eller-gif-i-kostnadsfritt-microsoft-teams-cfbfc796-de50-4c59-b116-9117e0b25b6b) use the plural category label `Aktiviteter`. | verified |
| `F-sv-084` | `sv` | `blockSettings.orConjunction` | composed-shortcut grammar | `" eller "` | `" eller tryck på "` | The settings tooltip composes `Klicka` + this fragment + a raw shortcut + ` för att öppna menyn`; the old result `Klicka eller Ctrl+/…` is ungrammatical, while [Apple’s Swedish shortcut guidance](https://support.apple.com/sv-se/102650) uses `tryck på` before key combinations. Both boundary spaces are part of the composition contract. | verified |
| `F-sv-085` | `sv` | `tools.table.comfortableText` | naturalness / density terminology | `"Bekväm text"` | `"Luftig text"` | The implementation exposes the roomier regular-size option opposite `Kompakt text`; the old wording describes emotional comfort, while `Luftig text` naturally names the visual density. | verified |
| `F-sv-086` | `sv` | `tools.image.previewControls` | accessibility / object context | `"Förhandsvisningskontroller"` | `"Reglage för bildförhandsvisning"` | This accessible name labels the concrete image-preview toolbar, so it must identify both its controls and the image-preview object; Apple’s Swedish UI guidance uses [`reglage`](https://support.apple.com/sv-se/guide/mac-pro/apddf030866a/mac) for an actionable preview toolbar. | verified |
| `F-sv-087` | `sv` | `tools.callout.emojiCategoryTravel` | category scope / established terminology | `"Resor"` | `"Resor och platser"` | The caller maps emoji-mart’s `places` category to this label, so travel alone omits part of the gallery; [Microsoft Teams’ Swedish emoji guidance](https://support.microsoft.com/sv-SE/teams/chat/send-an-emoji-gif-or-sticker-in-microsoft-teams) uses the established category `Resor och platser`. | verified |
| `F-sv-088` | `sv` | `tools.image.altEdit` | established accessibility terminology | `"Redigera alt-text"` | `"Redigera alternativtext"` | This is a full image action label, not the compact `Alt` badge; Microsoft’s Swedish accessibility UI uses the established compound `alternativtext`. | verified |
| `F-sv-089` | `sv` | `tools.image.altPlaceholder` | established accessibility terminology | `"Alt-text"` | `"Alternativtext"` | The full text-field placeholder should use established Swedish `alternativtext`, reserving `Alt` for the compact adjacent control. | verified |
| `F-sv-090` | `sv` | `tools.image.cropRatioFree` | option clarity / established media terminology | `"Fri"` | `"Fri form"` | As a standalone aspect-ratio option, `Fri` is underspecified; Adobe’s Swedish crop UI uses `Fri form` for unconstrained cropping. | verified |
| `F-sv-091` | `sv` | `tools.linkPaste.embedVideo` | provider-template grammar | `"Bädda in {provider}-video"` | `"Bädda in en video från {provider}"` | Immutable provider titles such as `VK Video` and `Tencent Video` make the old compound repeat `video`; the prepositional template remains natural for every registered provider. | verified |
| `F-sv-092` | `sv` | `tools.callout.emojiCategoryPeople` | category scope / accessibility | `"Människor"` | `"Smileys och människor"` | The visible heading and navigation accessible name cover smileys as well as people; Unicode CLDR’s Swedish category names both scopes. | verified |
| `F-sv-093` | `sv` | `tools.callout.emojiCategoryNature` | category scope / accessibility | `"Natur"` | `"Djur och natur"` | The runtime category begins with and contains animals as well as plants; Unicode CLDR’s Swedish category names both scopes. | verified |
| `F-sv-094` | `sv` | `tools.callout.emojiCategoryFood` | category scope / accessibility | `"Mat"` | `"Mat och dryck"` | The category contains food and beverages; Unicode CLDR’s Swedish category names both scopes. | verified |
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
| `F-zh-002` | `zh` | `toolbox.optionAddAbove` | shortcut clarity | `"⌥ 在上方添加"` | `"按住 Option 键点击以在上方添加"` | The plus-button tooltip must name the modified click gesture; Apple’s Simplified Chinese guidance describes the same gesture as holding Option while clicking. | verified |
| `F-zh-003` | `zh` | `toolbox.ctrlAddAbove` | shortcut clarity | `"Ctrl 在上方添加"` | `"按住 Ctrl 键点击以在上方添加"` | The Windows tooltip omitted the click gesture required by the shortcut. | verified |
| `F-zh-004` | `zh` | `tools.marker.textColor` | terminology | `"文字"` | `"文字颜色"` | The shared color picker needs an explicit text-color mode label to distinguish it from the adjacent background mode. | verified |
| `F-zh-005` | `zh` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"空的折叠块。点击或将块拖入其中。"` | `"空折叠块。点击添加内容块，或将内容块拖到此处。"` | The click action creates a child block; the old hint never stated that result. | verified |
| `F-zh-006` | `zh` | `blockSettings.lastEditedBy` | grammar | `"{name} 上次编辑"` | `"最后由 {name} 编辑"` | The old word order reads as though `{name}` is the subject of an incomplete “last edited” statement rather than the editor attribution. | verified |
| `F-zh-007` | `zh` | `a11y.dragHandle` | accessibility / missing object | `"拖动移动或点击打开菜单"` | `"拖动以移动内容块，或点击打开菜单"` | The drag-handle accessible name must identify the block being moved and separate its two actions naturally. | verified |
| `F-zh-008` | `zh` | `tools.table.clearSelection` | context / source synchronization | `"清除"` | `"清除内容"` | The command clears selected cells’ contents while preserving their structure and formatting; row and column deletion are separate actions. | verified |
| `F-zh-009` | `zh` | `tools.callout.addEmoji` | terminology / source synchronization | `"添加表情"` | `"添加图标"` | The callout UI presents the selected emoji as its editable and removable icon. | verified |
| `F-zh-010` | `zh` | `tools.callout.filterEmojis` | search clarity / accessibility / source synchronization | `"搜索…"` | `"搜索表情符号…"` | The value is both the placeholder and accessible name of an emoji searchbox and must state what is searched. | verified |
| `F-zh-011` | `zh` | `tools.callout.pickRandom` | action clarity / accessibility / source synchronization | `"随机"` | `"随机选择表情符号"` | The dice button needs a complete action and object instead of a bare adjective. | verified |
| `F-zh-012` | `zh` | `tools.table.placement` | terminology / source synchronization | `"位置"` | `"对齐方式"` | The picker controls horizontal and vertical alignment inside selected cells, not their position in the table. | verified |
| `F-zh-013` | `zh` | `tools.table.placementTopCenter` | naturalness | `"居中上"` | `"顶部居中"` | Chinese spatial modifiers precede the alignment state in this cell-alignment label. | verified |
| `F-zh-014` | `zh` | `tools.table.placementMiddleLeft` | naturalness | `"左中"` | `"左侧居中"` | The old clipped coordinate is not a natural UI label for middle-left alignment. | verified |
| `F-zh-015` | `zh` | `tools.table.placementMiddleRight` | naturalness | `"右中"` | `"右侧居中"` | The old clipped coordinate is not a natural UI label for middle-right alignment. | verified |
| `F-zh-016` | `zh` | `tools.table.placementBottomCenter` | naturalness | `"居中下"` | `"底部居中"` | Chinese spatial modifiers precede the alignment state in this cell-alignment label. | verified |
| `F-zh-017` | `zh` | `toolNames.equation` | pending translation / tool name | `"Equation"` | `"公式"` | The inline equation tool retained an English fallback instead of the standard concise Chinese mathematical term. | verified |
| `F-zh-018` | `zh` | `tools.equation.placeholder` | pending translation / hint | `"Enter a LaTeX formula…"` | `"输入 LaTeX 公式…"` | Localizes the complete input instruction while retaining the LaTeX product name. | verified |
| `F-zh-019` | `zh` | `tools.code.searchLanguage` | punctuation / source synchronization | `"搜索语言..."` | `"搜索语言…"` | The continuing search input must use the corpus-standard U+2026 ellipsis. | verified |
| `F-zh-020` | `zh` | `tools.link.linkTitle` | context / terminology / source synchronization | `"链接标题"` | `"链接文本"` | The field changes the anchor’s visible text, not title metadata. | verified |
| `F-zh-021` | `zh` | `tools.image.converting` | pending translation / progress | `"Converting…"` | `"正在转换…"` | The visible image-processing progress state retained an English fallback. | verified |
| `F-zh-022` | `zh` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"添加替代文本以描述此图片。这能让页面对视障或失明用户更易访问。"` | `"为看不到这张图片的用户描述图片。"` | The dialog already establishes alternative text; the corrected source is shorter, direct, and centered on the people who need the description. | verified |
| `F-zh-023` | `zh` | `tools.image.errorFileTooLarge` | pending translation / error | `"Image is too large. {size} exceeds the {max} limit."` | `"图片过大。{size} 超过 {max} 上限。"` | Localizes the image-size error while preserving both placeholders exactly. | verified |
| `F-zh-024` | `zh` | `tools.image.errorSourceOffline` | semantics / error recovery | `"来源可能已更改或离线。"` | `"源文件可能已移动或离线。"` | A generic “source” cannot itself go offline or move; the message refers to the remote source file. | verified |
| `F-zh-025` | `zh` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"URL 返回错误。请尝试其他来源或重新上传文件。"` | `"无法从此 URL 加载图片。请尝试其他来源或重新上传文件。"` | The corrected source identifies the failed image load directly instead of personifying the URL. | verified |
| `F-zh-026` | `zh` | `tools.database.viewTypeListDescription` | terminology / source synchronization | `"简洁的线性视图"` | `"在简单列表中显示项目"` | The old abstract noun phrase omits the user action and familiar list concept supplied by the corrected source. | verified |
| `F-zh-027` | `zh` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"正在加载链接预览"` | `"正在加载链接预览…"` | The rendered in-progress state needs the corpus-standard ellipsis. | verified |
| `F-zh-028` | `zh` | `tools.embed.empty` | read-only context / source synchronization | `"粘贴链接以嵌入"` | `"没有嵌入链接"` | The caller renders a read-only empty embed where a paste instruction is impossible. | verified |
| `F-zh-029` | `zh` | `tools.file.errorFileTooLarge` | pending translation / error | `"File is too large. {size} exceeds the {max} limit."` | `"文件过大。{size} 超过 {max} 上限。"` | Localizes the file-size error while preserving both placeholders exactly. | verified |
| `F-zh-030` | `zh` | `tools.file.previewRaw` | terminology / source synchronization | `"源文件"` | `"源文本"` | This Markdown-preview tab shows source text rather than a separate source file. | verified |
| `F-zh-031` | `zh` | `tools.video.errorFileTooLarge` | pending translation / error | `"Video is too large. {size} exceeds the {max} limit."` | `"视频过大。{size} 超过 {max} 上限。"` | Localizes the video-size error while preserving both placeholders exactly. | verified |
| `F-zh-032` | `zh` | `tools.audio.errorFileTooLarge` | pending translation / error | `"Audio is too large. {size} exceeds the {max} limit."` | `"音频文件过大。{size} 超过 {max} 上限。"` | Localizes the audio-size error, identifies the file resource, and preserves both placeholders exactly. | verified |
| `F-zh-033` | `zh` | `tools.audio.titlePlaceholder` | pending translation / metadata | `"Track title"` | `"曲目标题"` | Localizes the audio metadata field with the standard Chinese term for a track title. | verified |
| `F-zh-034` | `zh` | `tools.audio.artistPlaceholder` | pending translation / metadata | `"Artist"` | `"艺人"` | Localizes the audio metadata field with the standard concise Chinese label. | verified |
| `F-zh-035` | `zh` | `tools.audio.coverChange` | pending translation / action | `"Change cover"` | `"更换封面"` | Localizes the cover-art replacement action. | verified |
| `F-zh-036` | `zh` | `tools.audio.coverSet` | pending translation / action | `"Set cover image"` | `"设置封面图片"` | Localizes the action and explicitly names the cover image. | verified |
| `F-zh-037` | `zh` | `tools.audio.coverRemove` | pending translation / action | `"Remove cover"` | `"移除封面"` | Localizes the cover-art removal action. | verified |
| `F-zh-038` | `zh` | `tools.audio.coverErrorType` | pending translation / error recovery | `"Choose an image file"` | `"选择图片文件"` | Localizes the wrong-file-type recovery instruction. | verified |
| `F-zh-039` | `zh` | `tools.audio.coverErrorTooLarge` | pending translation / error | `"Image is too large"` | `"图片过大"` | Localizes the cover-image size error. | verified |
| `F-zh-040` | `zh` | `tools.audio.coverAdd` | pending translation / action | `"Add a cover"` | `"添加封面"` | Localizes the empty-cover action. | verified |
| `F-zh-041` | `zh` | `tools.audio.coverSourceAria` | accessibility / terminology consistency | `"图片来源"` | `"封面来源"` | The accessible tab-group name must identify the cover source selector rather than a generic image source. | verified |
| `F-zh-042` | `zh` | `a11y.navigationModeEntered` | keyboard convention / accessibility | `"导航模式。使用方向键在内容块之间移动，Enter 编辑，Escape 退出。"` | `"导航模式。使用方向键在内容块之间移动，按 Enter 编辑，按 Esc 退出。"` | The instruction needs explicit key-press verbs and the conventional Chinese-platform `Esc` key name. | verified |
| `F-zh-043` | `zh` | `tools.video.seek` | accessibility / media terminology | `"跳转"` | `"播放位置"` | The value labels a playback-position slider; the old action verb suggests a one-shot jump command. | verified |
| `F-zh-044` | `zh` | `tools.video.seekValueText` | accessibility / naturalness | `"{total} 中的 {current}"` | `"当前位置 {current}，总时长 {total}"` | The slider’s spoken value needs a natural current-position and total-duration relationship. | verified |
| `F-zh-045` | `zh` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"切换时间显示"` | `"在已播放时间和剩余时间之间切换"` | The accessible action must identify the two actual time-display states instead of exposing an abstract toggle. | verified |
| `F-zh-046` | `zh` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"复制当前时间的视频网址"` | `"复制当前播放位置的视频网址"` | The copied URL targets the playback head, whereas “current time” can mean wall-clock time. | verified |
| `F-zh-047` | `zh` | `tools.video.ctxStats` | slang / source synchronization | `"极客统计信息"` | `"播放统计信息"` | The corrected source deliberately removes the “geek” label and identifies the playback-data context. | verified |
| `F-zh-048` | `zh` | `blockSettings.orConjunction` | composed shortcut grammar | `" 或 "` | `" 或按 "` | In the editable tooltip, this fragment precedes the raw shortcut notation; Simplified Chinese needs the key-press verb so the composition reads “click or press Ctrl+/”. Preserve both boundary spaces. | verified |
| `F-zh-049` | `zh` | `blockSettings.openMenuAction` | composed action grammar | `" 打开菜单"` | `" 以打开菜单"` | This fragment completes both the click-only and click-or-shortcut tooltip lines; the purpose marker `以` makes both compositions grammatical while preserving the required leading space. | verified |
| `F-zh-050` | `zh` | `a11y.dropPosition` | prospective drag context / accessibility | `"将移动至第 {position} 位，共 {total} 个"` | `"将放置在第 {position} 位，共 {total} 个"` | This announcement is spoken before drop; `放置` describes the prospective drop result instead of incorrectly announcing completed movement. | verified |
| `F-zh-051` | `zh` | `blockSettings.convertWithChildrenWarning` | terminology / source synchronization | `"此内容块包含 {count} 个嵌套块。转换后，这些嵌套块将被提升至顶层。是否继续？"` | `"嵌套内容块：{count} 个。转换此内容块会将嵌套内容移至顶层。是否继续？"` | The corrected source avoids implementation-flavored “promote,” remains count-neutral, and states that conversion moves the nested content. | verified |
| `F-zh-052` | `zh` | `tools.colorPicker.defaultSwatchLabel` | accessibility / label-value punctuation | `"{mode} {default}"` | `"{mode}：{default}"` | The color-picker caller inserts localized mode and default labels into one spoken tooltip; W3C’s [Chinese Layout Requirements](https://www.w3.org/TR/clreq/#punctuation_marks) identifies the native colon as U+FF1A `：`. Both placeholders remain intact. | verified |
| `F-zh-053` | `zh` | `tools.colorPicker.colorSwatchLabel` | accessibility / label-value punctuation | `"{mode} {color}"` | `"{mode}：{color}"` | The swatch caller composes values such as “文字颜色：灰色”; a bare space leaves the adjacent nouns ambiguous, while W3C documents `：` as the native Chinese colon. Both placeholders remain intact. | verified |
| `F-zh-054` | `zh` | `a11y.dragHandleRole` | accessibility / role terminology | `"拖动控件"` | `"拖动手柄"` | The value is the handle’s `aria-roledescription`, not a generic control name; Microsoft’s Mainland guidance uses the handle-specific term [拖动手柄](https://support.microsoft.com/zh-cn/teams/meetings/present-content-in-microsoft-teams-meetings). | verified |
| `F-zh-055` | `zh` | `toolNames.todoList` | tool distinction / terminology | `"清单"` | `"待办清单"` | The visible tool and list-style title must distinguish a checklist from generic list tools; Notion’s Mainland catalog uses [待办清单](https://www.notion.com/zh-cn/templates/category/to-do-lists). | verified |
| `F-zh-056` | `zh` | `tools.columns.turnInto` | source-only terminology consistency | `"转换为列"` | `"转换为分栏"` | The source-only label names the same side-by-side page-layout tool already localized as `分栏`; Microsoft likewise uses [分栏](https://support.microsoft.com/zh-cn/word/insert-a-column-break) for page columns, while `列` suggests a table column. | verified |
| `F-zh-057` | `zh` | `toolNames.inlineCode` | tool distinction / terminology | `"代码"` | `"行内代码"` | The visible inline-toolbar title must distinguish this formatter from the code-block tool; MDN uses the explicit term [行内代码](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Elements/code). | verified |
| `F-zh-058` | `zh` | `a11y.blocksDuplicated` | grammar / accessibility | `"已复制 {count} 个内容块，起始位置第 {position} 位"` | `"已复制 {count} 个内容块，起始位置为第 {position} 位"` | The assertive spoken announcement needs `为` between the topic `起始位置` and its ordinal complement; both placeholders remain unchanged. | verified |
| `F-zh-TW-001` | `zh-TW` | `toolNames.clearFormat` | missing key / source coverage | `missing` | `"清除格式"` | Microsoft’s Taiwan Traditional Chinese editor UI uses the exact concise command [清除格式](https://support.microsoft.com/zh-TW/PowerPoint/clear-all-text-formatting). | verified |
| `F-zh-TW-002` | `zh-TW` | `blockSettings.orConjunction` | composed shortcut grammar | `" 或 "` | `" 或按 "` | In the editable tooltip, this fragment precedes the raw shortcut notation; Taiwan Chinese needs the key-press verb so the composition reads “按一下或按 Ctrl+/”. Preserve both boundary spaces. | verified |
| `F-zh-TW-003` | `zh-TW` | `blockSettings.openMenuAction` | composed action grammar | `" 開啟選單"` | `" 以開啟選單"` | This fragment completes both the click-only and click-or-shortcut tooltip lines; the purpose marker `以` makes both compositions grammatical while preserving the required leading space. | verified |
| `F-zh-TW-004` | `zh-TW` | `tools.marker.textColor` | terminology / source synchronization | `"文字"` | `"文字顏色"` | The shared color picker needs an explicit text-color mode label to distinguish it from the adjacent background mode. | verified |
| `F-zh-TW-005` | `zh-TW` | `tools.toggle.bodyPlaceholder` | action clarity / source synchronization | `"空白的收合區塊。按一下或將區塊拖曳至此。"` | `"空白收合區塊。按一下以新增區塊，或將區塊拖曳至此。"` | The click action creates a child block; the old hint never stated that result. | verified |
| `F-zh-TW-006` | `zh-TW` | `tools.table.clearSelection` | context / source synchronization | `"清除"` | `"清除內容"` | The command clears selected cells’ contents while preserving structure and formatting; deletion is a separate action. | verified |
| `F-zh-TW-007` | `zh-TW` | `tools.table.placement` | terminology / source synchronization | `"位置"` | `"對齊方式"` | The picker controls horizontal and vertical alignment inside selected cells, not their position in the table. | verified |
| `F-zh-TW-008` | `zh-TW` | `a11y.dragHandle` | accessibility / missing object | `"拖曳以移動，或按一下以開啟選單"` | `"拖曳以移動區塊，或按一下以開啟選單"` | The drag-handle accessible name must identify the block being moved. | verified |
| `F-zh-TW-009` | `zh-TW` | `a11y.navigationModeEntered` | keyboard convention / accessibility | `"導覽模式。使用方向鍵在區塊間移動，按 Enter 編輯，按 Escape 離開。"` | `"導覽模式。使用方向鍵在區塊間移動，按 Enter 編輯，按 Esc 離開。"` | Taiwan platform guidance uses the concise physical-key label `Esc`; the spoken instruction should match it. | verified |
| `F-zh-TW-010` | `zh-TW` | `tools.callout.addEmoji` | terminology / source synchronization | `"新增表情符號"` | `"新增圖示"` | The callout UI presents the selected emoji as its editable and removable icon. | verified |
| `F-zh-TW-011` | `zh-TW` | `tools.callout.filterEmojis` | search clarity / accessibility / source synchronization | `"搜尋…"` | `"搜尋表情符號…"` | The value is both the placeholder and accessible name of an emoji searchbox and must state what is searched. | verified |
| `F-zh-TW-012` | `zh-TW` | `tools.callout.pickRandom` | action clarity / accessibility / source synchronization | `"隨機選取"` | `"隨機選取表情符號"` | The dice button needs a complete action and object. | verified |
| `F-zh-TW-013` | `zh-TW` | `tools.link.linkTitle` | context / terminology / source synchronization | `"連結標題"` | `"連結文字"` | The field changes the anchor’s visible text, not title metadata. | verified |
| `F-zh-TW-014` | `zh-TW` | `tools.image.altDescription` | accessibility / brevity / source synchronization | `"新增替代文字來描述此圖片，讓視障或全盲使用者也能理解內容。"` | `"為看不到這張圖片的使用者描述圖片。"` | The dialog already establishes alternative text; the corrected source is shorter, direct, and centered on the user who needs the description. | verified |
| `F-zh-TW-015` | `zh-TW` | `tools.image.errorFileTooLarge` | error clarity | `"圖片大小為 {size}，上限為 {max}。"` | `"圖片太大。{size} 超過 {max} 上限。"` | The visible error must explicitly state that the current image exceeds the limit while preserving both placeholders. | verified |
| `F-zh-TW-016` | `zh-TW` | `tools.image.errorSourceOffline` | semantics / error recovery | `"來源可能已移動或離線。"` | `"來源檔案可能已移動或離線。"` | A generic “source” cannot itself move or go offline; the message refers to the remote source file. | verified |
| `F-zh-TW-017` | `zh-TW` | `tools.image.errorDefaultMessage` | natural error copy / source synchronization | `"網址傳回錯誤。請嘗試其他來源或重新上傳檔案。"` | `"無法從此網址載入圖片。請嘗試其他來源或重新上傳檔案。"` | The corrected source identifies the failed image load directly instead of personifying the URL. | verified |
| `F-zh-TW-018` | `zh-TW` | `tools.file.errorFileTooLarge` | error clarity | `"檔案大小為 {size}，上限為 {max}。"` | `"檔案太大。{size} 超過 {max} 上限。"` | The visible error must explicitly state that the current file exceeds the limit while preserving both placeholders. | verified |
| `F-zh-TW-019` | `zh-TW` | `tools.video.errorFileTooLarge` | error clarity | `"影片大小為 {size}，上限為 {max}。"` | `"影片太大。{size} 超過 {max} 上限。"` | The visible error must explicitly state that the current video exceeds the limit while preserving both placeholders. | verified |
| `F-zh-TW-020` | `zh-TW` | `tools.audio.errorFileTooLarge` | error clarity | `"音訊大小為 {size}，上限為 {max}。"` | `"音訊檔案太大。{size} 超過 {max} 上限。"` | The visible error must explicitly identify the audio file and state that it exceeds the limit while preserving both placeholders. | verified |
| `F-zh-TW-021` | `zh-TW` | `tools.database.viewTypeListDescription` | terminology / source synchronization | `"依序顯示內容"` | `"在簡單清單中顯示項目"` | The old phrase loses the familiar list concept supplied by the corrected source. | verified |
| `F-zh-TW-022` | `zh-TW` | `tools.bookmark.loading` | progress punctuation / source synchronization | `"正在載入連結預覽"` | `"正在載入連結預覽…"` | The rendered in-progress state needs the corpus-standard ellipsis. | verified |
| `F-zh-TW-023` | `zh-TW` | `tools.embed.empty` | read-only context / source synchronization | `"貼上連結以嵌入內容"` | `"沒有嵌入連結"` | The caller renders a read-only empty embed where a paste instruction is impossible. | verified |
| `F-zh-TW-024` | `zh-TW` | `tools.video.seek` | accessibility / media terminology | `"跳至"` | `"播放位置"` | The value labels a playback-position slider; the old action verb suggests a one-shot jump command. | verified |
| `F-zh-TW-025` | `zh-TW` | `tools.video.seekValueText` | accessibility / naturalness | `"{total} 中的 {current}"` | `"目前位置 {current}，總長度 {total}"` | The slider’s spoken value needs a natural current-position and total-duration relationship. | verified |
| `F-zh-TW-026` | `zh-TW` | `tools.video.toggleTimeDisplay` | accessibility / source synchronization | `"切換時間顯示"` | `"在已播放時間與剩餘時間之間切換"` | The accessible action must identify the two actual time-display states instead of exposing an abstract toggle. | verified |
| `F-zh-TW-027` | `zh-TW` | `tools.video.ctxCopyUrlAtTime` | context / clarity | `"複製目前時間點的影片網址"` | `"複製目前播放位置的影片網址"` | The copied URL targets the playback head, whereas “current time” can mean wall-clock time. | verified |
| `F-zh-TW-028` | `zh-TW` | `tools.video.ctxStats` | terminology / source synchronization | `"詳細統計資料"` | `"播放統計資料"` | The corrected source identifies playback data; the old generic label omits that context. | verified |
| `F-zh-TW-029` | `zh-TW` | `a11y.dropPosition` | prospective drag context / accessibility | `"將移動至第 {position} 個位置，共 {total} 個"` | `"將放置於第 {position} 個位置，共 {total} 個"` | This announcement is spoken before drop; `放置` describes the prospective drop result instead of incorrectly announcing completed movement. | verified |
| `F-zh-TW-030` | `zh-TW` | `tools.colorPicker.defaultSwatchLabel` | accessibility / label-value punctuation | `"{mode} {default}"` | `"{mode}：{default}"` | The color-picker caller inserts localized mode and default labels into one spoken tooltip; W3C’s [Chinese Layout Requirements](https://www.w3.org/TR/clreq/#punctuation_marks) identifies the native colon as U+FF1A `：`. Both placeholders remain intact. | verified |
| `F-zh-TW-031` | `zh-TW` | `tools.colorPicker.colorSwatchLabel` | accessibility / label-value punctuation | `"{mode} {color}"` | `"{mode}：{color}"` | The swatch caller composes values such as “文字顏色：灰色”; a bare space leaves the adjacent nouns ambiguous, while W3C documents `：` as the native Chinese colon. Both placeholders remain intact. | verified |
| `F-zh-TW-032` | `zh-TW` | `a11y.dragHandleRole` | accessibility / role terminology | `"拖曳控制項"` | `"拖曳控點"` | The value is the handle’s `aria-roledescription`, not a generic control name; Microsoft’s Taiwan Fluent UI guidance uses the handle-specific term [拖曳控點](https://learn.microsoft.com/zh-tw/power-apps/teams/use-the-fluent-ui-controls). | verified |
| `F-global-001` | all non-English | 46 changed English source keys | source dependency | Localized values have not been re-reviewed against the 45 corrected source values and the new clear-formatting key. | Re-audit all 46 dependent values in all 68 localized dictionaries and correct them where required. | English-source changes invalidate dependent semantic evidence; every complete 539-key locale pass must inspect all 46 dependencies, including `toolNames.clearFormat` and `F-en-037` through `F-en-046`. | open |
| `F-global-002` | all non-English | four expanded emoji category keys | source dependency / category scope / accessibility | The 68 localized dictionaries still use one-part labels for some or all of the newly expanded smileys-and-people, animals-and-nature, food-and-drink, and travel-and-places source categories. | Apply the independently reviewed native four-label matrix to all 68 localized dictionaries, retaining a current value only when it already expresses both scopes. | Three independent language-family reviews inspected all 272 visible and ARIA labels against runtime category contents, bundled Emoji Mart data, Unicode CLDR, and official Apple, Google, Microsoft, Android, and native-language product terminology. The executable 68-locale matrix records all 253 required corrections and 19 valid retentions. | verified |

## Exact-English Retentions

Record every non-English value that is exactly identical to English. The only
allowed categories are `universal notation`, `product-brand`, `acronym`,
`established cognate`, and `established loanword`. Similar spelling alone is
not a justification; the source must support normal unchanged use in the
locale and UI context.

| Retention ID | Locale | Key | Category | Justification | Source |
|---|---|---|---|---|---|
| `R-<locale>-NNN` | `<locale>` | `<key>` | category | justification | source |
| `R-cs-001` | `cs` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Apple’s Czech guidance retains the `⌘` platform symbol. | [Apple — Klávesové zkratky na Macu](https://support.apple.com/cs-cz/102650) |
| `R-cs-002` | `cs` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Microsoft’s Czech guidance retains `Ctrl` in key combinations. | [Microsoft — Klávesové zkratky ve Windows](https://support.microsoft.com/cs-cz/windows/kl%C3%A1vesov%C3%A9-zkratky-ve-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-cs-003` | `cs` | `toolNames.video` | established loanword | `Video` is an established Czech media noun and the natural concise toolbox label. | [Apple — Úpravy videí](https://support.apple.com/cs-cz/104968) |
| `R-cs-004` | `cs` | `toolNames.audio` | established loanword | `Audio` is established Czech product terminology and the concise audio-tool label. | [Apple — Audio mix](https://support.apple.com/cs-cz/guide/iphone/iph1d1344a2d/ios) |
| `R-cs-005` | `cs` | `tools.link.linkText` | established cognate | `Text` is the normal unchanged Czech noun for visible hyperlink text. | [Microsoft — Text hypertextového odkazu](https://support.microsoft.com/cs-cz/office/p%C5%99izp%C5%AFsoben%C3%AD-textu-hypertextov%C3%A9ho-odkazu-v-outlooku-63d4fdcc-bce2-41ea-9649-d8aaa900fe2f) |
| `R-cs-006` | `cs` | `tools.image.altButton` | acronym | `Alt` is the conventional compact alternative-text control label; the surrounding Czech dialog supplies the full phrase. | [Microsoft — Alternativní text](https://support.microsoft.com/cs-cz/office/video-vylep%C5%A1en%C3%AD-p%C5%99%C3%ADstupnosti-pomoc%C3%AD-alternativn%C3%ADho-textu-9c57ee44-bb48-40e3-aad4-7647fc1dba51) |
| `R-cs-007` | `cs` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation rather than English prose. | [Apple — Ořezávání fotografií](https://support.apple.com/cs-cz/guide/iphone/iph3dc593597/ios) |
| `R-cs-008` | `cs` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation rather than English prose. | [Apple — Ořezávání fotografií](https://support.apple.com/cs-cz/guide/iphone/iph3dc593597/ios) |
| `R-cs-009` | `cs` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation rather than English prose. | [Apple — Ořezávání fotografií](https://support.apple.com/cs-cz/guide/iphone/iph3dc593597/ios) |
| `R-cs-010` | `cs` | `tools.database.propertyTypeText` | established cognate | `Text` is the normal Czech database value type and concise property label. | [Microsoft Access — Datové typy](https://support.microsoft.com/cs-cz/access/introduction-to-data-types-and-field-properties) |
| `R-cs-011` | `cs` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional unchanged technical acronym in Czech product interfaces. | [Microsoft Access — Hypertextový odkaz a URL](https://support.microsoft.com/cs-cz/access/introduction-to-data-types-and-field-properties) |
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
| `R-fi-001` | `fi` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Finnish shortcut guidance retains the Command symbol. | [Microsoft — Wordin verkkoversion pikanäppäimet](https://support.microsoft.com/fi-fi/word/keyboard-shortcuts-in-word-web-app) |
| `R-fi-002` | `fi` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than English prose; Finnish shortcut guidance retains `Ctrl` in key combinations. | [Microsoft — Wordin verkkoversion pikanäppäimet](https://support.microsoft.com/fi-fi/word/keyboard-shortcuts-in-word-web-app) |
| `R-fi-003` | `fi` | `toolNames.video` | established loanword | `Video` is the established unchanged Finnish media noun and the natural concise toolbox label. | [Apple — Videoiden toistaminen iPhonessa](https://support.apple.com/fi-fi/guide/iphone/iphb71f9b54d/ios) |
| `R-fi-004` | `fi` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form associated with Finnish `vaihtoehtoinen teksti`; the surrounding dialog supplies the full localized label. | [Microsoft — Vaihtoehtoisen tekstin kirjoittaminen](https://support.microsoft.com/fi-fi/office/kaikki-mit%C3%A4-sinun-tulee-tiet%C3%A4%C3%A4-vaihtoehtoisen-tekstin-kirjoittamisesta-df98f884-ca3d-456c-807b-1a1fa82f5dc2) |
| `R-fi-005` | `fi` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Finnish media interfaces. | [Apple — Kuvan tai videon rajaaminen](https://support.apple.com/fi-fi/guide/iphone/iph3dc593597/ios) |
| `R-fi-006` | `fi` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Finnish media interfaces. | [Apple — Kuvan tai videon rajaaminen](https://support.apple.com/fi-fi/guide/iphone/iph3dc593597/ios) |
| `R-fi-007` | `fi` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Finnish media interfaces. | [Apple — Kuvan tai videon rajaaminen](https://support.apple.com/fi-fi/guide/iphone/iph3dc593597/ios) |
| `R-fi-008` | `fi` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Finnish product interfaces. | [MDN — Mikä on URL?](https://developer.mozilla.org/fi/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_URL) |
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
| `R-fr-023` | `fr` | `tools.file.previewRaw` | established cognate | `Source` is the standard French term for a source-text view and pairs naturally with the adjacent `Aperçu` tab. | [MDN — Déboguer du CSS](https://developer.mozilla.org/fr/docs/Learn_web_development/Core/Styling_basics/Debugging_CSS) |
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
| `R-no-015` | `no` | `tools.colorPicker.defaultSwatchLabel` | universal notation | The placeholder-only template contains no English words. Bokmål modifier-before-noun order renders the caller output as idiomatic `Standard tekstfarge`. | [Microsoft — Endre standard tekstfarge](https://support.microsoft.com/nb-no/office/endre-standard-tekstfarge-skriftfarge-i-word-59f83009-12c2-4feb-b548-93621dfe6f2f) |
| `R-no-016` | `no` | `tools.colorPicker.colorSwatchLabel` | universal notation | The placeholder-only template contains no English words. Bokmål modifier-before-noun order renders caller values such as `Rød tekstfarge` naturally. | [Microsoft — Endre standard tekstfarge](https://support.microsoft.com/nb-no/office/endre-standard-tekstfarge-skriftfarge-i-word-59f83009-12c2-4feb-b548-93621dfe6f2f) |
| `R-pl-001` | `pl` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Apple’s Polish guidance retains the `⌘` platform symbol. | [Apple — Skróty klawiszowe na Macu](https://support.apple.com/pl-pl/102650) |
| `R-pl-002` | `pl` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Microsoft’s Polish guidance retains `Ctrl` in key combinations. | [Microsoft — Skróty klawiaturowe w systemie Windows](https://support.microsoft.com/pl-pl/windows/skr%C3%B3ty-klawiaturowe-w-systemie-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-pl-003` | `pl` | `toolNames.link` | established loanword | `Link` is the standard unchanged Polish web noun and the natural concise toolbox label. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-004` | `pl` | `toolNames.audio` | established loanword | `Audio` is standard unchanged Polish media terminology and the concise toolbox label. | [Microsoft — Dodawanie wideo, audio lub obrazów](https://support.microsoft.com/pl-pl/office/dodawanie-wideo-audio-lub-obraz%C3%B3w-do-strony-klasycznej-b5220c61-e56a-40fd-8754-d06a2e38b492) |
| `R-pl-005` | `pl` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form of Polish `tekst alternatywny`; the surrounding dialog supplies the full localized label. | [Apple — Tekst alternatywny (alt)](https://support.apple.com/pl-pl/guide/apple-business-connect/abcb04e20054/web) |
| `R-pl-006` | `pl` | `tools.image.emptyLink` | established loanword | `Link` is the standard concise Polish source-option label. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-007` | `pl` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Polish media interfaces. | [Apple — Zmienianie proporcji](https://support.apple.com/pl-pl/guide/iphone/iph3dc593597/ios) |
| `R-pl-008` | `pl` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Polish media interfaces. | [Apple — Zmienianie proporcji](https://support.apple.com/pl-pl/guide/iphone/iph3dc593597/ios) |
| `R-pl-009` | `pl` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Polish media interfaces. | [Apple — Zmienianie proporcji](https://support.apple.com/pl-pl/guide/iphone/iph3dc593597/ios) |
| `R-pl-010` | `pl` | `tools.file.emptyLink` | established loanword | `Link` is the standard concise Polish source-option label. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-011` | `pl` | `tools.video.emptyLink` | established loanword | `Link` is the standard concise Polish source-option label. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-012` | `pl` | `tools.audio.emptyLink` | established loanword | `Link` is the standard concise Polish source-option label. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-013` | `pl` | `tools.audio.coverLink` | established loanword | `Link` is the standard concise Polish source-option label for an image URL. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-014` | `pl` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional unchanged technical acronym in Polish product interfaces. | [Microsoft — Dostosowywanie immersywnego wydarzenia](https://support.microsoft.com/pl-PL/teams/meetings/customize-an-immersive-event-in-microsoft-teams) |
| `R-pl-015` | `pl` | `tools.database.defaultStatusProperty` | established cognate | `Status` is the normal unchanged Polish workflow-property noun. | [Microsoft Planner — status zadania](https://support.microsoft.com/pl-pl/planner/training/build-your-plan-in-microsoft-planner) |
| `R-pt-001` | `pt` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; Apple’s Brazilian Portuguese guidance retains the `⌘` platform symbol. | [Apple — Atalhos de teclado no Mac](https://support.apple.com/pt-br/102650) |
| `R-pt-002` | `pt` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Microsoft’s Brazilian Portuguese guidance retains `Ctrl` in key combinations. | [Microsoft — Atalhos de teclado no Windows](https://support.microsoft.com/pt-br/windows/atalhos-de-teclado-no-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-pt-003` | `pt` | `toolNames.link` | established loanword | `Link` is the standard unchanged Brazilian Portuguese web noun and the natural concise toolbox label. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-004` | `pt` | `searchTerms.layout` | established loanword | Lowercase `layout` is an established Brazilian Portuguese design term and follows the locale’s search-alias casing. | [Adobe — Visão geral do painel Layout flexível](https://helpx.adobe.com/br/indesign/using/flex-layout-panel-overview.html) |
| `R-pt-005` | `pt` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form for Brazilian Portuguese alternative-text controls; the surrounding dialog supplies the full localized phrase. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-006` | `pt` | `tools.image.emptyLink` | established loanword | `Link` is the standard unchanged Brazilian Portuguese action/source label in media interfaces. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-007` | `pt` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Brazilian Portuguese media interfaces. | [Apple — Use as ferramentas da câmera para configurar a foto](https://support.apple.com/pt-br/guide/iphone/iph3dc593597/ios) |
| `R-pt-008` | `pt` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Brazilian Portuguese media interfaces. | [Apple — Use as ferramentas da câmera para configurar a foto](https://support.apple.com/pt-br/guide/iphone/iph3dc593597/ios) |
| `R-pt-009` | `pt` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Brazilian Portuguese media interfaces. | [Apple — Use as ferramentas da câmera para configurar a foto](https://support.apple.com/pt-br/guide/iphone/iph3dc593597/ios) |
| `R-pt-010` | `pt` | `tools.image.cropRatioOval` | established cognate | `Oval` is the normal unchanged Brazilian Portuguese geometry term and a concise crop-shape label. | [Microsoft — Usar uma forma oval](https://support.microsoft.com/pt-br/topic/usar-a-forma-do-caso-3aa9183f-a32d-4b71-8d54-ed18e67f6f53) |
| `R-pt-011` | `pt` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Brazilian Portuguese database interfaces. | [Notion — Propriedades do banco de dados](https://www.notion.com/pt/help/database-properties) |
| `R-pt-012` | `pt` | `tools.database.defaultStatusProperty` | established loanword | `Status` is the established unchanged Brazilian Portuguese workflow-property name. | [Notion — Propriedades do banco de dados](https://www.notion.com/pt/help/database-properties) |
| `R-pt-013` | `pt` | `tools.file.emptyLink` | established loanword | `Link` is the standard unchanged Brazilian Portuguese action/source label in file interfaces. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-014` | `pt` | `tools.video.emptyLink` | established loanword | `Link` is the standard unchanged Brazilian Portuguese action/source label in video interfaces. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-015` | `pt` | `tools.audio.emptyLink` | established loanword | `Link` is the standard unchanged Brazilian Portuguese action/source label in audio interfaces. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-016` | `pt` | `tools.audio.coverLink` | established loanword | `Link` is the standard unchanged Brazilian Portuguese source label in cover-art interfaces. | [Notion — Imagens, arquivos e mídia](https://www.notion.com/pt/help/images-files-and-media) |
| `R-pt-017` | `pt` | `tools.video.volume` | established cognate | `Volume` is the normal unchanged Brazilian Portuguese media-control noun. | [Google Drive — Usar um leitor de tela para reproduzir vídeos](https://support.google.com/drive/answer/12169158?hl=pt-BR) |
| `R-pt-018` | `pt` | `tools.audio.volume` | established cognate | `Volume` is the normal unchanged Brazilian Portuguese media-control noun. | [Google Drive — Usar um leitor de tela para reproduzir vídeos](https://support.google.com/drive/answer/12169158?hl=pt-BR) |
| `R-ru-001` | `ru` | `blockSettings.menuShortcutMac` | universal notation | `⌘/` is macOS shortcut notation rather than English prose; the Command symbol is language-independent. | [Apple — Сочетания клавиш Mac](https://support.apple.com/ru-ru/102650) |
| `R-ru-002` | `ru` | `blockSettings.menuShortcutWin` | universal notation | `Ctrl+/` is Windows shortcut notation rather than translatable prose; Russian product guidance retains `Ctrl` in key combinations. | [Microsoft — Сочетания клавиш в Windows](https://support.microsoft.com/ru-ru/windows/%D1%81%D0%BE%D1%87%D0%B5%D1%82%D0%B0%D0%BD%D0%B8%D1%8F-%D0%BA%D0%BB%D0%B0%D0%B2%D0%B8%D1%88-%D0%B2-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec) |
| `R-ru-003` | `ru` | `tools.image.altButton` | acronym | `Alt` is the conventional compact form associated with Russian alternative-text controls; the surrounding dialog supplies the full localized phrase. | [Microsoft — Добавление замещающего текста](https://support.microsoft.com/ru-RU/accessibility/office-accessibility/add-alternative-text-to-a-shape-picture-chart-smartart-graphic-or-other-object) |
| `R-ru-004` | `ru` | `tools.image.cropRatio1to1` | universal notation | `1:1` is language-independent aspect-ratio notation used unchanged in Russian media interfaces. | [Apple — Настройки съёмки с помощью инструментов камеры iPhone](https://support.apple.com/ru-ru/guide/iphone/-iph3dc593597/ios) |
| `R-ru-005` | `ru` | `tools.image.cropRatio4to3` | universal notation | `4:3` is language-independent aspect-ratio notation used unchanged in Russian media interfaces. | [Apple — Настройки съёмки с помощью инструментов камеры iPhone](https://support.apple.com/ru-ru/guide/iphone/-iph3dc593597/ios) |
| `R-ru-006` | `ru` | `tools.image.cropRatio16to9` | universal notation | `16:9` is language-independent aspect-ratio notation used unchanged in Russian media interfaces. | [Apple — Настройки съёмки с помощью инструментов камеры iPhone](https://support.apple.com/ru-ru/guide/iphone/-iph3dc593597/ios) |
| `R-ru-007` | `ru` | `tools.database.propertyTypeUrl` | acronym | `URL` is the conventional technical acronym retained unchanged in Russian product interfaces. | [Microsoft — Работа со ссылками в Excel](https://support.microsoft.com/ru-ru/excel/work-with-links-in-excel) |
