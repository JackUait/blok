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
   `pending` or `open`.
5. Every value exactly retained from English is listed in the retention table
   with one allowed category, a locale-specific justification, and a supporting
   source. No pending-translation exemption remains.
6. Structural, semantic/style, and exact-English retention results all pass;
   focused and full i18n checks pass; the repository-wide completion gates and
   independent final review pass; and the evidence reflects the current files.

Any failed check, unresolved finding, unexplained exact-English match, changed
source string, or later dictionary edit reopens the affected row until the
relevant review and verification are repeated.

## Workflow and Finding States

| State | Semantics |
|---|---|
| `pending` | Work has not been completed for the field, locale, or finding. This is the initial state and is never evidence of review. |
| `first-pass-complete` | The first reviewer inspected every current entry, recorded all findings and retentions, applied or verified first-pass corrections, and reran the locale's structural checks. Independent review is still required. |
| `second-pass-complete` | A different reviewer independently inspected every current entry and the first-pass diff; every known finding is resolved, every exact-English retention is justified, and locale structural checks pass. Repository-wide final verification is still required. |
| `verified` | Terminal evidence state: the correction or locale satisfies all applicable completion rules against the current files, and the final independent review and required verification gates have passed. |
| `open` | A concrete defect, disagreement, or genuine linguistic uncertainty remains unresolved. An open finding blocks `second-pass-complete` and `verified`; the locale's final status must also be `open`. |

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
Markdown row. Use `pending` before review, `open` while unresolved, and
`verified` only after the correction and its evidence have been checked.

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
