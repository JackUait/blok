# All-Locales Translation Guideline Audit Design

## Objective

Verify, as deeply as the repository and available review tools allow, that every
message in every Blok locale follows
`src/components/i18n/locales/TRANSLATION_GUIDELINES.md`, and correct every defect
found.

The audit includes `en/messages.json` because unclear or contextually incorrect
source copy propagates into every translation. It also includes all 68 localized
dictionaries.

## Current Baseline

- 69 locale variants
- 538 flat message keys per locale
- 37,122 total message values, including English
- 36,584 non-English message values
- Existing focused i18n suite: 659 passing tests
- Existing completeness checker: all locales contain the 538 English keys
- Existing placeholder scan: no known placeholder drift
- Existing exact-English exceptions:
  - 15 intentionally pending product strings remain English in 67 locales
    (1,005 untranslated values)
  - universal notation, brands, acronyms, and documented cognates account for
    additional exact matches
- One known Unicode normalization defect:
  `kn:tools.table.mergeCells`

Passing the current suite does not establish guideline compliance. In
particular, it deliberately permits the 1,005 pending translations and cannot
prove semantic accuracy, natural UI wording, register consistency, or
context-appropriate terminology.

## Scope

The audit covers every value in:

`src/components/i18n/locales/*/messages.json`

For each locale, it evaluates:

1. JSON and dictionary structure
2. Key completeness and uniqueness
3. String type and non-empty content
4. Placeholder preservation
5. Encoding and Unicode normalization
6. Meaning relative to the English source and actual UI context
7. Natural, concise product-UI phrasing
8. Imperative, user-centered action wording
9. Accessibility clarity without unnecessary verbosity
10. Locale-appropriate script, punctuation, capitalization, grammar, and
    register
11. Consistency of recurring product terminology
12. Short, recognizable tool names
13. Useful, distinct toolbox search aliases
14. Legitimate retention of brands, shortcuts, ratios, acronyms, and standard
    loanwords

Hardcoded source strings outside the locale dictionaries are not translation
values and are therefore not part of this audit. Existing tests covering
hardcoded strings remain part of regression verification.

## Accepted Treatment of Unchanged Terms

An exact English match is not automatically a defect. It is acceptable only
when at least one of these is true:

- it is universal notation, such as a shortcut or aspect ratio;
- it is a product or provider name;
- it is a technical acronym conventionally retained in the locale;
- it is an established cognate or loanword used naturally in comparable
  product interfaces.

Every retained exact match must be justified by an explicit allowlist or the
per-locale audit record. The existing allowlists are evidence to re-check, not
assumptions to inherit.

## Chosen Approach

Use a layered exhaustive audit.

### Layer 1: Executable Structural Contracts

Strengthen automated coverage so every locale is checked for:

- valid flat JSON with unique keys;
- exact key-set parity with English;
- string-only, non-empty values;
- exact placeholder multiset parity;
- required boundary whitespace parity;
- NFC Unicode normalization;
- no replacement characters, mojibake, or forbidden control characters;
- no unexpected values identical to English;
- no duplicate search aliases within a tool's search group;
- native-script use where an automated rule can be made precise without
  rejecting legitimate technical tokens.

The repository translation checker should report these defects directly, and
unit tests should cover the checker functions and the real locale corpus.

### Layer 2: Source and Context Audit

Audit English first. Resolve each key in its real interface role by inspecting
the consuming source code and grouping keys into:

- tool names and search aliases;
- buttons and menu actions;
- tooltips and hints;
- placeholders and empty states;
- errors and recovery actions;
- accessibility announcements and ARIA labels;
- media, table, database, and formatting terminology.

Correct unclear English before reviewing dependent translations. Preserve
placeholder and key contracts.

### Layer 3: Exhaustive Locale Review

Review every non-English dictionary in language-family batches. Each review
compares all 538 entries with English and nearby related keys, not only values
flagged by heuristics.

For each locale, record:

- script and regional variant;
- formal or informal register;
- recurring terminology decisions;
- justified retained terms;
- every defect and correction;
- completion of structural, semantic, style, and punctuation checks.

Use authoritative product-localization references for ambiguous terminology.
Prefer official terminology or style guidance from established software
vendors. Web research is supporting evidence rather than a substitute for
contextual language judgment.

### Layer 4: Test-First Corrections

Before each correction class:

1. add a failing invariant or locale-specific regression case;
2. run it and confirm the expected failure;
3. update only the affected locale values;
4. rerun the focused test;
5. run the all-locale structural checks.

Remove the 15-key pending-translation exemption after those values are
localized. Re-audit existing cognate allowlists and remove unjustified entries.

Agents may work concurrently only on disjoint locale files. Shared validators,
tests, and audit records remain owned by the primary agent to avoid conflicting
edits.

### Layer 5: Independent Review and Verification

Every locale receives a second pass by a reviewer other than the first-pass
author when concurrency permits. The primary agent reviews every resulting
diff, reconciles cross-locale terminology patterns, and runs:

- checker unit tests;
- all i18n unit tests;
- `node scripts/i18n/check-translations.mjs`;
- lint and type checks relevant to changed code;
- the complete unit suite where repository state permits;
- final scripts that recalculate every structural invariant from the current
  files.

## Audit Evidence

Completion requires all of the following:

- an audit ledger containing one completed row for each of the 69 locales;
- no unresolved finding in that ledger;
- no pending-translation exemption;
- explicit justification for every exact-English retention;
- clean structural and placeholder reports;
- passing focused and full i18n tests;
- a reviewed final diff limited to intended translation, validation, test, and
  audit-document changes;
- no claim that passing automation alone proves linguistic quality.

## Error Handling and Review Discipline

- If source context is ambiguous, inspect the caller before translating.
- If a term has multiple plausible translations, prefer the wording used by
  established editors in the locale and record the choice.
- If automated script checks conflict with normal locale usage, treat the
  heuristic as a review signal and refine its allowlist instead of forcing an
  unnatural translation.
- If a language judgment remains genuinely uncertain, leave the finding open
  rather than silently marking the locale complete.
- Preserve unrelated working-tree changes and work directly on the existing
  `master` branch. Do not create branches, worktrees, detached checkouts, or
  equivalent isolated workflows.

## Limitations

Repository tests can prove structural contracts and prevent known regressions,
but no automated system can conclusively certify native-speaker naturalness
across 68 languages. This design therefore combines exhaustive entry review,
context inspection, official terminology research, independent second passes,
and executable invariants. Any residual linguistic uncertainty must be reported
explicitly rather than converted into an unsupported completion claim.
