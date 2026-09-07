# Russian Docs Translation Audit — blokeditor.com

Date: 2026-09-07
Status: research complete, no code changed

## Question

Which parts of blokeditor.com are not translated into Russian, and how do we translate
them correctly?

## Method

Every number below was measured, not estimated.

1. Rebuilt the site (`cd docs && yarn build`, exit 0 — "sitemap.xml (148 urls), 148
   markdown mirrors, llms.txt (74 links)").
2. Scanned all 75 prerendered `docs/dist/client/ru/**/index.html` files with the same
   English-prose heuristic the repo's own law uses
   (`docs/src/i18n/ru-language-purity.test.tsx`): strip
   `script,style,pre,code,kbd,samp,svg,noscript,[data-lang-exempt]`, merge inline tags
   into phrases, split on block tags, add `aria-label`/`alt`/`title`/`placeholder`, then
   flag any phrase with no Cyrillic and >=2 Latin words of which one is lower-case.
3. Flattened `en.json` and `ru.json` and compared keys and values.
4. Diffed every English `.md` mirror against its Russian twin.

Scan output (per page, raw phrases):
`scratchpad/ru-html-offenders.json` (session scratchpad, not committed).

## Headline

The Russian site is **structurally complete and textually incomplete**.

Structure is in place: 75 routed and prerendered Russian pages, 74 `/ru` URLs in the
sitemap, a genuinely Russian `.md` mirror for every page. Nothing is missing a page.

Content is not: **1,197 English phrases (~26,700 English words) still render on Russian
pages.** 74 of 75 pages carry at least some English. Only `/ru/tools` is clean.

| Surface | English phrases | English words |
| --- | ---: | ---: |
| `/ru/changelog` | 656 | 14,519 |
| `/ru/docs/*` API reference (32 pages) | 537 | 12,177 |
| Global chrome (2 strings x 74 pages) | 148 | — |
| Everything else | 4 (all false positives) | 8 |

**These counts are a lower bound.** The heuristic returns false on any phrase containing
Cyrillic, so a mixed-language string is invisible to it. That is exactly how a third global
chrome defect (`ThemeToggle.tsx:35`) escaped the scan — see the chrome section.

Already clean, and it shows the pattern works: every block/inline tool page, `/ru/tools`,
`/ru/presets`, `/ru/server`, `/ru` home. Those are exactly the surfaces covered by
`ru-language-purity.test.tsx`.

The guard is green while the site is broken. Run today:

```
yarn vitest run src/i18n/ru-language-purity.test.tsx
Test Files  1 passed (1)      Tests  36 passed (36)
```

36 passing assertions, 1,197 English phrases shipping. The test is not wrong — it covers
7 component families and every one of them is clean. It simply never renders the API
reference, the changelog, or the page chrome.

## Root cause

Docs prose does not live in `en.json`. It lives as English string literals in data
modules — `docs/src/components/api/api-data.ts`, `tools-data.ts`, `presets-data.ts`,
`server-data.ts`, `migration-data.ts` — and the `use*Translations` hooks overlay
`ru.json` keys on top of them.

`safeTranslate` (`docs/src/hooks/useApiTranslations.ts:100-104`) returns `undefined` when
a key resolves to nothing, and the caller falls back to the English literal. `translateOr`
in the other hooks does the same. That fallback is deliberate and correct — it prevents a
raw key like `api.themeApi.title` reaching the reader (`useApiTranslations.ts:178-179`) —
but it means **a missing key renders English with no error, no warning, and no failing
test.**

Precisely: `getTranslation` (`docs/src/i18n/index.ts:24-45`) falls back to English before
returning the key, and `ru.json` is a strict superset of `en.json`. So the untranslated
strings are not "present in `en.json`, missing from `ru.json`" — they are absent from
*both*, and the `api-data.ts` literal renders. English shows up either way; the distinction
matters only for how you detect it.

Consequence: key parity between `en.json` and `ru.json` is structurally incapable of
measuring translation coverage. **`en.json` contains only 198 of the 571 keys the API hook
requests** — barely a third of the surface — so a parity check is blind to the real gap and
raises false alarms about the rest. It reports 0 missing keys while 1,197 English phrases
render. The correct invariant is *every translatable string field in a data module has a
`ru.json` key*, not *`en.json` ⇔ `ru.json`*.

### Two content patterns, one of them safe

The repo already contains both. This is the most useful finding for "how do we do it
correctly", because one pattern cannot produce this bug.

**Pattern A — key-only data module (safe).** The data module stores *i18n key names*, never
English prose. `docs/src/components/migration/migration-data.ts:16-20` is the model:

```ts
{ id: "codemod", titleKey: "migration.sectionCodemodTitle", descriptionKey: "..." }
```

The component calls `t(step.titleKey)` (`MigrationWalls.tsx:32`). `getTranslation` falls
back to English and then to the raw key, so a missing translation renders
`migration.sectionCodemodTitle` at the reader — loud, ugly, and impossible to ship
unnoticed. The migration pages are clean in the scan, and this is why.

**Pattern B — English-literal data module + optional overlay (silent).** The data module
holds the English sentence; the hook tries a `ru.json` key and quietly keeps the English
when it misses. Used by `api-data.ts`, `tools-data.ts`, `presets-data.ts`,
`server-data.ts`. All 537 API-page phrases are this pattern.

Key derivation per hook, verified by reading the source:

| Module | Hook | Key shape |
| --- | --- | --- |
| `api-data.ts` | `useApiTranslations.ts` | `api.<sectionKey>.title` / `.badge` / `.description`, `.methods.<name>.description` / `.note` / `.params.<p>.description` / `.errors.<i>.condition` / `.resolution`, `.properties.<n>.description`, `.table.<option>.description`. Section key from `SECTION_TRANSLATION_KEYS` (`:14-49`); method name stripped of `(...)` by `getMethodKey` (`:94`) |
| `tools-data.ts` | `useToolsTranslations.ts` | `tools.links.<id>`, `tools.docs.<id>.description`, `tools.docs.<id>.options.<option>.description` — dots in an option name become `_` (`optionKey`, `:11`) |
| `presets-data.ts` | `usePresetsTranslations.ts` | `presets.items.<id>.title` / `.description` / `.uploadByUrlNote` / `.productionNote` / `.configOptions.<option>.description` / `.storageSetup.<i>` |
| `server-data.ts` | `useServerTranslations.ts` | `server.paths.<id>.title` / `.situation` / `.description` / `.whatToRun.<i>.label` / `.failureModes.<i>.symptom` / `.cause` / `.fix`, `server.limits.<id>.title` / `.body`, `server.coverageNote` |

`useServerTranslations.ts:17-22` records that `/ru/server` once rendered ~90 chunks of
English for exactly this reason. The fix that was applied there is the same fix the API
reference now needs — the pattern was proven, just never finished.

**Recommendation: new docs content should use Pattern A.** Pattern B needs a test to be
safe; Pattern A is safe without one.

## Machine-facing surfaces: Russian is already first-class

Swept all 150 built `index.html` files (75 en + 75 ru). This part of the site is in good
shape and needs no work — worth stating plainly so nobody re-audits it.

| Surface | Russian | Evidence |
| --- | --- | --- |
| sitemap.xml | PARITY | 148 `<url>`, 74 under `/ru` |
| hreflang | PARITY | 148/150 pages carry `en`/`ru`/`x-default`, all absolute; 74/74 Russian sets byte-identical to their English twin; 0 reciprocity mismatches |
| canonical | PARITY | 148/150 self-canonical; **0 Russian pages canonicalize to English** |
| og / twitter | PARITY | `og:url == canonical` on 150/150; Russian pages carry `og:locale=ru_RU` + alternate `en_US` |
| JSON-LD | PARITY | 1 block per page; all 75 Russian carry `inLanguage: ru`, `@id` `…/ru/#website`, breadcrumbs under `/ru/` with Russian names |
| `<html lang>` | PARITY | 75 × `ru`, 75 × `en`, 0 deviations |
| `<title>` / description | PARITY | **0** Russian pages with an English title or description |
| `.md` mirrors | PARITY | 74 Russian mirrors, Russian front matter, `source:` under `/ru/` |
| robots.txt | PARITY | path-agnostic `Allow: /`; nothing under `/ru` disallowed |
| **`llms.txt`** | **MISSING** | 0 occurrences of `/ru`; all 74 links English |
| **`llms-full.txt`** | **MISSING** | 74 `source:` lines, 0 under `/ru` |

Two things are load-bearing and should not be "fixed":

- Russian titles and descriptions cannot silently fall back to English.
  `docs/src/seo/route-metadata.ts:605` does `if (!copy) continue`, and
  `generate-seo-artifacts.mjs:149` then throws `Route ${route} is prerendered but has no
  route metadata`. A missing Russian entry fails the build. This is Pattern A applied to
  metadata, and it is why the metadata surface has no drift.
- `docs/src/seo/route-metadata.ru.test.ts:33-51` asserts every Russian title/description/h1
  matches `/[Ѐ-ӿ]/` and that none reuses an English string. English copy pasted into
  `RU_COPY` fails CI.

`/tools` and `/ru/tools` omit hreflang and canonicalize to `/docs/paragraph/` — symmetric,
and deliberate because both are `noindex` (`meta-descriptors.ts:70-78`). Not a gap.

### The one machine-facing gap: `llms*.txt`

Neither file contains the substring `/ru`. An LLM crawler reading them learns that Russian
documentation does not exist. Two different mechanisms cause it:

- `llms.txt` is English-only *by construction* — its `sections` array
  (`docs/scripts/generate-seo-artifacts.mjs:245-261`) is built from unprefixed route
  strings, so a `/ru/...` route can never appear. No filter involved.
- `llms-full.txt` is *filtered* — `isDefaultLocale` (`:266`) is used exactly once, at
  `:278`, to drop the Russian mirrors.

The omission is documented at `generate-seo-artifacts.mjs:263-265` ("duplicating every page
in every language would double the file for no retrieval gain") — a defensible choice. But
**no test pins it**: deleting the `isDefaultLocale` filter would break nothing. Whichever way
this goes, it should be a decision with a test behind it rather than an accident.

## `/ru/changelog` — the one place where "translate everything" is the wrong answer

This is the biggest single block of English on the site and the only one that should not
simply be translated. It needs a decision from you.

**Where the content comes from.** `docs/src/pages/ChangelogPage.tsx:4` does
`import CHANGELOG_MARKDOWN from "../../../CHANGELOG.md?raw"` — the root `CHANGELOG.md`
(127 KB, 1,323 lines) is inlined at build time and parsed by
`docs/src/utils/changelog-parser.ts:208`. There is no `CHANGELOG.ru.md`. One source file,
one language.

**What is and isn't translated, measured.** The chrome is 100% Russian: 512 category
badges, 74 release-type badges, 74 dates correctly formatted as `3 сент. 2026 г.`, the
page title and lede. The entry bodies are 0% Russian. Cross-matching the 656 flagged
phrases against the parser's output: **656 of 656 are release-entry text, 0 are chrome.**
Total volume is **16,174 words** across 74 releases, 512 change items and 145 sub-bullets.

For scale: `ru.json` today holds 1,373 strings. Translating the changelog would add 657
more — **+48% of the entire translation corpus, for one page.**

**Three findings that make this different from every other surface:**

1. **The overlay pattern does not transfer.** `Change` has no id
   (`docs/src/types/changelog.d.ts:12-18` is `{ category, description, details?, link? }`),
   so a key could only be `version` + array index. Entries get rewritten after release —
   `473aea62`, `119f7781`, `b46a89c3` all revised shipped entries on 2026-09-04, after
   1.13.0 went out on 09-03. Any such edit shifts indices and silently detaches the
   translation, with `translateOr` falling back to English and no test noticing. The seam
   that actually fits is a locale-selected source file (`CHANGELOG.ru.md`) matched by
   `version`, which also gives "newest N releases" for free.
2. **A hidden authoring constraint.** `formatDescription` (`ChangelogPage.tsx:163`) splits
   on the first em-dash to style the title, which is why release rule 6 in
   `.claude/commands/release/release.md:43` forbids em-dashes inside sub-bullets. 502 of
   512 descriptions rely on it. Russian prose uses тире far more freely, so the rule
   carries into Russian or the parser changes.
3. **It bills you forever.** No `conventional-changelog`/changesets — `scripts/release.mjs`
   only *reads* `CHANGELOG.md` (`:386-394`) to build GitHub release notes. A human writes
   each entry at release time. Last 5 releases averaged **~555 words each**, plus
   retroactive edits to entries already translated.

Cumulative cost of the partial option: newest 1 = 1,086 words; newest 3 = 2,086;
newest 5 = 2,777; newest 10 = 4,551; all 74 = 16,174.

### The options, honestly costed

- **A — translate everything.** 16,174 words now, ~555/release forever, plus keeping
  `CHANGELOG.ru.md` in lockstep through retroactive edits.
- **B — newest N, English below.** 1,086–4,551 words. Cleanest mechanically. But at N=5 the
  page is still 83% English by word count, so it does not fix the SEO argument — this is a
  reader-comfort option, not a ranking one.
- **C — headline-only** (translate the bold title, leave the summary English). 918 words,
  but produces `**Живое соредактирование** — Real-time multiplayer editing…` on 502 lines.
  Not worth doing.
- **D — explicit exemption via `noindex`.** Today's state is the worst combination:
  `/ru/changelog/` self-canonicalises, declares `hreflang="ru"` and sits in the sitemap —
  three signals asserting a Russian page exists — over an English body. Google's likely
  reading is "duplicate of `/changelog/`". Marking it `noindex` makes the signals honest.
  All the levers already exist and are how `/tools` is handled
  (`route-metadata.ts:606,611`; `meta-descriptors.ts:51,72-78`;
  `generate-seo-artifacts.mjs:186`; `locales.ts:152-153`).

Two verified gotchas for option D: a cross-locale canonical without `noindex` is impossible
— `generate-seo-artifacts.mjs:192-198` throws *"Indexable route … must self-canonicalise or
be marked noindex"*; and `alternateUrls` (`locales.ts:170-176`) is locale-blind, so the
English `/changelog` would keep advertising `hreflang="ru"` at a noindex page, producing the
unreciprocated set that `meta-descriptors.ts:70-71` says is ignored outright. A correct
exemption needs `alternateUrls` to know about per-locale noindex — small, but not zero.

**Recommendation: D, optionally plus B's first slice for reader comfort.** Every other
Russian surface is a fixed corpus you translate once. This one is generated by your release
process, bills ~555 words per release forever, and drifts silently when you revise an
entry — which the git log shows you do. Giving up indexing on a page that was never going
to rank for Russian queries costs little.

**The input I could not read, and that would change the answer:** GA4 traffic to
`/ru/changelog` from Russian-language search. If it is materially non-zero, A becomes
defensible. Naming it rather than guessing.

Either way, one thing should change: `ChangelogContent` is absent from
`ru-language-purity.test.tsx:8-16`, so the page is exempt today with no recorded reason.
The end state is either a row in that law or an explicit commented exemption.

## The API reference — the actual work item

**311 missing `ru.json` keys, ~11,500 English words, average 37 words per key.** This is
the whole real translation job on the site (excluding the changelog decision above).

The list is machine-derived, not hand-transcribed: `api-data.ts` was parsed with the
TypeScript compiler API and the hook's own key derivation replayed over it, with
`SECTION_TRANSLATION_KEYS` read out of the hook source. The extraction was cross-checked
against a runtime import of `API_SECTIONS` and matches byte-for-byte except one
`${BLOK_VERSION}` interpolation inside a code example.

Full list with English source and `api-data.ts` line number:
`scratchpad/api-missing-keys.json` (311 objects, all keys unique).

### The 537 flagged phrases, fully attributed

Every phrase was matched to a specific `api-data.ts` string. Nothing was left unexplained,
which is what makes the 221 false positives safe to dismiss.

| Cause | Phrases | What it is |
| --- | ---: | --- |
| (a) key absent from both JSON files | 302 | the real defect |
| (b) key present, value is English | 1 | `api.devOverrideSeam.title` |
| (c) field the hook never overlays | 13 | all `error.message` |
| (d) heuristic false positive | 221 | `method.name` 173, `returnType` 44, `table.option` 2, `property.name` 2 |

**Do not chase the 221.** They are identifiers and type signatures rendered *outside*
`<code>` — a method name in `<h3 class="font-mono">` (`ApiMethodCard.tsx:39`), a return
type in a `<span>` (`:40`), property names repeated bare in the On-this-page nav. Correct
as they are.

Two missing keys the heuristic *cannot* see — `api.uploaderApi.title` and
`api.uploaderApi.badge` — have no lower-case word, so they never trip `isEnglishProse`.
That is why the key-derivation count (311) is the number to work from, not the rendered
count (302). The arithmetic closes exactly: 311 missing → 304 distinct (page, phrase) pairs
after de-duplication → −2 invisible → 302.

### Where the gap is

| Section | Missing keys | Section | Missing keys |
| --- | ---: | --- | ---: |
| blocks-api | 42 | uploader-api | 6 |
| view-api | 38 | history-api / saver-api | 5 each |
| core | 26 | blok-editor, theme, width, listeners, events, ui, use-blok-ready | 3 each |
| block-api | 25 | placeholder, readonly, inline-toolbar, sanitizer | 2 each |
| output-data | 20 | use-blocks, notifier | 1 each |
| marks-api | 20 | dev-override-seam | 0 (has the English *value*) |
| i18n-api / config | 15 each | quick-start, tutorial, concepts, custom-block-tool | 0 — fully translated |
| tools-api | 12 | | |
| tooltip-api | 11 | | |
| styles-api | 10 | | |
| block-data | 9 | | |
| caret / selection / toolbar | 7 each | **TOTAL** | **311** |

All 36 sections have a `SECTION_TRANSLATION_KEYS` prefix, so none is skipped wholesale.
`theme-api` shows the pattern cleanly: `ru.json` has Russian `.note` values for
`theme.get/set/getResolved` but no `.description`, and the built page renders a Russian note
directly above an English description.

### Three findings worth acting on separately

**1. Prose smuggled into an untranslatable slot.** `error.message` is deliberately never
overlaid — `api-data.ts:28-31` calls it "the literal thrown error text
(language-agnostic)", and 11 of the 13 are genuine thrown strings (two verified against
`src/components/modules/api/saver.ts:26` and
`src/components/modules/blockManager/block-insertion.ts:115`). But two are English prose in
a field with no translation route at all:

- `api-data.ts:1553` — `"(no error thrown — the call returns false)"`
- `api-data.ts:1740` — `"…— or the originating tool error, re-thrown when one was recorded"`

These need to move to a translatable field, not a `ru.json` key.

**2. `en.json` silently shadows stale English at readers.** Where a key exists in both
`en.json` and `api-data.ts`, `en.json` wins on the English page. Four have drifted apart:

| Key | Which side is stale |
| --- | --- |
| `api.stylesApi.description` | `api-data.ts` — missing the callout / "5px vertical" text |
| `api.outputData.description` | `en.json` — missing nullable `parent`/`content` |
| `api.blokEditor.description` | `en.json` — missing `toolbarPosition` |
| `api.useBlocks.description` | `en.json` — says `useBlocks(editor)`, actual is `useBlocks(editor, options?)` |

**This is an English-side bug, found while auditing Russian.** English readers see outdated
copy on three pages, and a translator working from `api-data.ts` would translate text no
English reader ever sees.

**3. The 62 "ru-only" keys are not orphans.** All 62 are requested by
`useApiTranslations`; their English side lives in `api-data.ts`, not `en.json`, and all 62
hold real Russian values. No runtime defect — but it confirms that any en↔ru parity check
fires false alarms on these while missing the 311 that matter.

Separately, 27 `ru.json` values copy the `api-data.ts` English exactly — and all 27 are
`section.title` (`"Blocks API"`, `"Caret API"`, `"useBlocks"` …), no descriptions. Whether
module names should stay English is your call, not a defect. The one that trips the scan is
`api.devOverrideSeam.title` = `"Dev override seam"`, and `route-metadata.ru.ts:251-254`
keeps it English in the Russian `<title>` and `h1` too — so the repo is at least
consistent about treating it as a retained term.

## Global chrome — three defects, one of which the scan could not see

### The heuristic has a structural blind spot

`isEnglishProse` (`ru-language-purity.test.tsx:98-100`) short-circuits on *any* Cyrillic:

```ts
if (CYRILLIC.test(text)) { return false; }
```

So a mixed-language string is invisible to it. That is how
`ThemeToggle.tsx:35` — `aria-label={`Toggle theme (current: ${label})`}` — ships on all 74
Russian chrome pages as `aria-label="Toggle theme (current: Светлая тема)"` and neither my
scan nor the repo's own law notices. Only `label` is translated; the wrapper sentence is a
hardcoded literal.

**Any count produced by this heuristic — including every number in this document — is a
lower bound.** Mixed English/Russian strings are systematically under-reported.

### The three global strings

| String | Location | Class |
| --- | --- | --- |
| `alt="Blok mascot"` | `Footer.tsx:50` | Screen-reader content. `Footer` already calls `useI18n()` at `:24` and every other string in it uses `t()` — this attribute was simply missed. |
| `aria-label="Toggle theme (current: …)"` | `ThemeToggle.tsx:35` | Screen-reader content. Invisible to the scan (above). |
| `A Markdown version of this page is available at …` | `MarkdownPointer.tsx:31` | **Not** screen-reader content — see correction below. |

**Correction to an assumption I made earlier.** I treated the Markdown pointer as
screen-reader content because it is `sr-only`. It is not: `MarkdownPointer.tsx:27` also sets
`aria-hidden="true"`, and the component comment (`:11-13`) says so explicitly. No human
ever reads it. Its only audience is crawlers and LLM fetchers, which puts it in a different
class from the two `alt`/`aria-label` defects — and makes translating it a judgement call
rather than a defect. Argument for: the Russian `.md` mirrors it points at genuinely are
Russian. Argument against: an English instruction may be more reliably parsed by an LLM
fetcher. Either is defensible; the mechanism is identical.

It also cannot use `useI18n()` — `root.tsx:118` renders it inside `Layout`, outside the
`I18nProvider` mounted at `root.tsx:125-134`, so the hook would throw
(`I18nContext.tsx:85-87`). It needs `getTranslation(splitLocalePath(pathname).locale, key)`.

### "Skip to content" was never a defect

The law's header comment names it as a known offender. It is translated:
`Nav.tsx:194` → `t("common.skipToContent")`, `ru.json:16` → `"Перейти к содержимому"`,
and the built Russian HTML confirms it. `git log -S skipToContent` returns exactly one
commit, `a6df2dc2`, whose diff *simultaneously* translates the string and adds the comment
calling it untranslated. **The comment was wrong the moment it was written**, not stale over
time. Worth correcting so nobody chases it again.

### The 404 page

There is no Russian 404, by design — `locales.ts:113-118` excludes `/404` from the prefixed
trees because GitHub Pages serves a single root `404.html`. `routes.ts:35` catches `/ru/**`
misses with the English page.

Runtime-verified by serving `dist/client` with Pages semantics and loading `/ru/does-not-exist`
in Chrome:

- On the wire: `<html lang="en">`, `<title>Page not found — Blok</title>`, English throughout.
- After hydration: `lang` becomes `ru`, the skip link becomes `Перейти к содержимому`, the
  nav and footer become Russian — but the title, `h1` ("Page not found") and body stay
  English.

So: **Russian chrome wrapped around an English 404 body, under an English tab title.** It
also logs `Minified React error #418` (server/client text mismatch) on `/ru/does-not-exist`
and *not* on `/nope` — the `/ru` prefix causes it, because `root.tsx:96` derives the locale
from the pathname while the file was prerendered at `/404`. Same failure class that commit
`a6df2dc2` was written to eliminate elsewhere.

Localising the component (`not-found.tsx:13,29,32,40,46`, plus giving `meta` the
`({ location })` signature) fixes the post-hydration body but **not** the first paint: the
static `404.html` is prerendered once and always ships English bytes. A full fix is a
locale-aware 404 shell, which is a design decision, not a `ru.json` key.

### Separately: the search index is English-only on `/ru`

`buildSearchIndex()` (`src/utils/search.ts:187`) takes no locale parameter, and
`Search.tsx:420` calls it unconditionally. On `/ru` the search modal renders English module
headers, titles and descriptions (`Home` / `Welcome to Blok documentation`,
`search.ts:223-228`). The chrome around it is fully translated; the *data* is not.

It renders client-side only, which is why no build-output scan can see it. The fix is a
locale-aware index, not a `ru.json` key.

### How to pin these — a trap worth knowing

A new `it('renders the theme toggle in Russian')` row would **pass today, defect included**,
because the Cyrillic veto makes it green before the fix. A pin that is already green is not
a pin.

Two ways out were measured:

- **Relaxing the veto globally — rejected on evidence.** Dropping it adds 302 hits, nearly
  all Russian prose containing API identifiers. Requiring ≥3 consecutive Latin words catches
  the theme toggle but also flags `tools.docs.audio.description` (`ru.json:2145`) — a
  legitimate translation the test already renders green.
- **Dropping the veto for text-attribute values only — clean.** Measured across all 74
  Russian chrome pages: exactly **3** hits — the two real defects plus the deliberate
  `aria-label="Dev override seam"`. **Zero** false positives anywhere in the Russian tree.
  Keep the veto in the text-node path; skip it for the values pushed by the
  `TEXT_ATTRIBUTES` loop at `ru-language-purity.test.tsx:80-88`.

With that change, three new component-scoped rows (`<Footer />`, `<ThemeToggle />`,
`<NotFoundPage />`) fail first and then pass — respecting the file's component-scoped
design, no page-scoped rewrite needed. `MarkdownPointer` renders outside `I18nProvider` and
does not belong to that law; assert it in `seo-artifacts.test.ts` instead.

Note for whoever does the Footer fix: `Footer.test.tsx:31` and `:41` use
`getByAltText('Blok mascot')` and will break.

## How to translate correctly: the terminology standard

The reader sees the editor's Russian UI and the Russian docs side by side, so the docs
glossary is *derived* from the shipped editor dictionary
(`src/components/i18n/locales/ru.json`, 578 keys), not invented. Where the editor ships a
term, it binds. Where it does not — and it has no term for *toolbox, tune, caret, editor,
document, render, placeholder, read-only, theme, preset, popover, marks* — the docs are the
sole authority and their convention is a transliterated loanword.

### Terms where docs and editor already agree (use these)

блок · инструмент · панель инструментов · преобразовать · вложенный · перетащить ·
вставить · меню · форматирование · свернуть/развернуть · **столбец** (table) vs
**колонка** (layout — a real distinction both surfaces honour) · Enter · Esc

Plus 20 tool names that match exactly: Таблица, Выноска, База данных, Разделитель, Отступ,
Цитата, Колонки, Код, Формула, Изображение, Видео, Аудио, Файл, Закладка, Встраивание,
Ссылка, Курсив, Подчёркнутый, Зачёркнутый, Список.

### Terminology defects — 12 found, ranked

The two marked **contradicts the editor** are the serious ones: the docs use a word the
user does not see in the product.

| # | Defect | Resolve toward |
| --- | --- | --- |
| D1 | "inline tool" has **four** Russian forms — «строчный инструмент» (16) vs «инлайн-инструмент» vs «inline-инструмент» vs «инлайн-тулза» (slang, which `TRANSLATION_GUIDELINES.md` forbids) | «строчный инструмент» — the nav label |
| D2 | "toolbar" — «тулбар» (16) vs «панель инструментов» (10). **Contradicts the editor**, which shows «Панель инструментов блока» (`ru.json:117`). The two collide inside one section: `api.toolbarApi.description` says «панелью инструментов», `…close.note` says «тулбар» | «панель инструментов» |
| D3 | "toolbox" has **five** forms — «тулбокс» / «слэш-меню» / «меню вставки +» / «меню + / слэш» / «меню команд». Two appear in a single sentence at `api.toolbarApi.methods.toolbar.toggleToolbox.note` | «тулбокс» |
| D4 | "tune" — «тюн» in 3 keys, bare English `tune`/`tunes` in 9, including two home-page strings that render «…и block tunes.» on `/ru` | «тюн» |
| D5 | "convert" — «преобразов-» (15) vs «конверт-» (11). **Contradicts the editor** (`popover.convertTo` = «Преобразовать в»). The same menu is named both ways | «преобразование» |
| D6 | "caret" — «курсор» (30) vs «каретка» (15), colliding inside the Caret API section itself | «курсор» |
| D7 | "placeholder" — «плейсхолдер» (16) vs «текст-заполнитель» (2 keys) | «плейсхолдер» |
| D8 | Undo/Redo labelled twice in one demo toolbar: «Отменить»/«Отмена», «Повторить»/«Повтор» | pick one per role |
| D9 | Block settings named three ways; «попап» appears nowhere else in the file | «настройки блока» |
| D10 | Escape spelled «ESC» / «Escape» in docs; the editor deliberately chose «Esc» | «Esc» |
| D11 | `api.devOverrideSeam.title` = `Dev override seam` — untranslated, while its own sidebar label *is* translated («Подмена версии для разработки») | translate, or retain deliberately |
| D12 | `api.links.outputData`/`blockData` translate a type identifier in the sidebar while the page title keeps `OutputData`/`BlockData` — the other 32 `api.*.title` keep identifiers English | keep identifiers English |

**Two tool names disagree, and the divergence was introduced in Russian** — same English on
both sides, different Russian:

| Tool | Editor shows | Docs say |
| --- | --- | --- |
| Bold | **Полужирный** | Жирный |
| Toggle | **Сворачиваемый список** | Переключатель |

Three more differ because the *English* differs (Text/Paragraph, Color/Marker,
Code/Inline Code) — those need an English decision first, not a Russian one.

### What stays English

74 `ru.json` values are byte-identical to English, and all but one are legitimate. The rule
is mechanical:

- **Identifiers a consumer types** — `blocks.render()`, `OutputData`, `useBlocks`,
  `parentId`, config keys, legacy saved-JSON field names. Never translated, always in
  backticks, never inflected. Measured: 1,714 backticks in `ru.json`, **zero** unbalanced,
  **zero** identifiers declined with a Russian ending. To decline, add a Russian head noun
  in front: «в конфигурации `tools` редактора».
- **Brand and product names** — React, Vue, Angular, Editor.js, Markdown, JSON, GitHub, npm.
- **Notation** — `⌘/`, `16:9`, `© 2026`, `25+`.

The one illegitimate retention is D11 above.

`data-lang-exempt` is used exactly once in the whole app (`WhyBlok.tsx:167`, competitor
names). It is for a rendered element whose text is a proper name — not for `ru.json` values.

### Style rules, measured from the existing translation

Each of these was counted, not assumed. They are already near-absolute in `ru.json`, so
they describe the house style rather than proposing one.

| Rule | Evidence |
| --- | --- |
| Formal «вы», lowercase mid-sentence; never «ты», never «Вы» | 46 lowercase «вы», **0** capitalized mid-sentence, **0** singular imperatives |
| Always «ё» | 504 occurrences; **0** «е»-spelled counterparts (еще 0, ее 0, идет 0…) |
| «Ёлочки» for prose; straight `"` only inside code/CSS/JSON/URL literals | 81 `«` / 81 `»`, balanced; all 41 straight quotes are literals |
| Em dash «—»; en dash only in numeric ranges; never `-` as a dash | 582 `—`; 2 `–`, both ranges; 1 ` - `, the literal Markdown character |
| Sentence case for every heading, title, label, badge | **0** of 175 title-like keys are Title-Cased |
| Infinitive for controls; imperative plural for instructions; **mirror the English mood** for API descriptions | 18/18 controls infinitive; 129 values open with an imperative; the `useBlocks` infinitive vs `blokClass` third-person split faithfully mirrors an inconsistency in the English source — **do not "fix" it in Russian alone** |
| Terminal punctuation matches the English exactly | disagrees on 2 of 1,311 shared keys |
| Latin compounds: `CSS-свойство`, `MIME-тип`, `React-компонент` | 30+ distinct, Latin part unchanged, Russian part declined |
| Copy every `{token}` verbatim; reorder the sentence around it | the editor does exactly this: `{count} blocks selected` → «Выбрано блоков: {count}» |
| Plurals use `_one`/`_few`/`_many` | `search.result_one/few/many` |

No established convention exists for ellipsis — 24 `…` against 15 `...`, and the Russian
mirrors the English character per string, so the mixture is inherited. The editor uses `…`
exclusively; adopting it and fixing the English in the same change is a reasonable call, but
it is a recommendation, not existing practice.

### The verification gap a translator must cover by hand

`npx vitest run src/i18n/ru-language-purity.test.tsx src/i18n/index.test.ts` is green today
(45 tests). `index.test.ts` additionally enforces no copied English in four overlay
namespaces (`server.paths.`, `server.limits.`, `presets.items.`, `tools.docs.`) — which is
exactly why those surfaces are clean.

But both use the same `isEnglishProse` predicate, which bails on a single Cyrillic
character. **An English term inside a Russian sentence passes silently.** That is precisely
how D4's «block tunes» and D1's «inline-инструменты» ship today. This was found
independently by two agents, which is why it is the single most important gap to close: a
term-level allowlist check over `ru.json` (English terms that must never appear outside
backticks) is the smallest change that would have caught D4 and D11.

## Why nothing caught this, and the guardrail that would

### The numbers, reconciled

Two independent agents produced different totals, so I re-derived them myself by replaying
the hook's key builders over `api-data.ts` with a bundle walker that does **not** use the
English fallback (`scratchpad/reconcile.mjs`). The result reconciles both and is
set-identical to the 311-key deliverable:

| Measure | Count |
| --- | ---: |
| Keys `useApiTranslations` asks for | 761 |
| …backed by an English literal in `api-data.ts` | 571 |
| …**missing from `ru.json` → the translation work** | **311** |
| `note` keys the hook asks for with no `api-data.ts` literal | 190 |
| …present in both bundles | 98 |
| …present in neither | 92 |
| …present in only one bundle | **0** |
| Asked keys missing from `en.json` | 465 |

**A correction worth making explicitly.** The 92 note keys absent from both bundles are
*not* a defect and *not* an English-side content gap. `note` is optional; the hook asks for
it unconditionally, so a method with no note authored in any language simply renders no
note. The note corpus is perfectly symmetric — 98 in both, 0 in only one. Counting those 92
as missing inflates the job from 311 to 403. **311 is the real number.**

### Why every existing guard missed it

The docs test suite *does* run in CI — `ci.yml:119-141` runs `yarn --cwd docs test:coverage`
and `production-readiness` requires it (`:622`); `deploy-docs.yml:44-45` gates the deploy.
New files under `docs/src/` are picked up automatically (`vitest.config.ts:22`), so no
workflow change is needed for any test proposed here. The suite is not the problem; its
coverage is.

- **`ru-language-purity.test.tsx`** never renders `ApiSection`. Its list is hand-maintained;
  a page enters only when someone adds an `it(...)`.
- **`index.test.ts:66-71`** diffs `en.json` against `ru.json`. Both are *overlays*.
  `en.json` holds only 296 of the 761 asked keys, so 465 are invisible to it by
  construction. It compares two partial overlays and can never see the corpus underneath.
- **`index.test.ts:75-90`** does check for copied English — but only under
  `server.paths.`, `server.limits.`, `presets.items.`, `tools.docs.`. **`api.` and
  `migration.` are absent from that list.** This is the guard that would have caught
  `api.devOverrideSeam.title`.
- **`scripts/i18n/check-docs-translations.mjs`** does the same en→ru diff, and its banner
  literally says `Source of truth: en.json` (`:119`) — the misconception, encoded. It exits
  0 today, printing the 62 healthy Russian translations as "extra keys" to consider
  deleting.
- **`api-data.i18n-runtime.test.ts`** comes closest and misses on every axis: it looks up one
  section and two methods by name, asserts two notes are `!== ""`, and its one content
  assertion is `.toContain("i18n.update")` — an **ASCII substring** a fully English value
  would pass.

### The fix already exists in this repo — three times

`server-data.test.ts:19-77` derives every key its hook asks for and asserts it exists in
both bundles, using a `holdsKey()` walker that deliberately bypasses the English fallback.
Its comment already names this exact bug: *"a key missing from BOTH bundles renders English
on /ru with no error; and `yarn i18n:check:docs` only diffs en against ru, so a key in
neither is invisible to it too."* `useToolsTranslations.test.tsx:42-60` asserts every tool
description matches `/[Ѐ-ӿ]/` and differs from the English.
`migration-data.test.ts:57-73` does the same.

**Those three surfaces measure zero English phrases. The pattern was never applied to the
largest data module.** The guardrail is not an invention — it is applying the house pattern
to `api-data.ts`.

### What to add

1. **`docs/src/components/api/api-data.ru-coverage.test.ts`** (new). Walk `API_SECTIONS`,
   rebuild every key the way the hook does, and assert: every section id is in
   `SECTION_TRANSLATION_KEYS` (an unmapped id makes `useApiTranslations.ts:116-118` return
   the *whole section* untranslated with no error); every literal-backed key exists in
   `ru.json`; every `ru.json` value contains Cyrillic. Use a `holdsKey`-style walker, never
   `getTranslation` — the fallback would answer a string for a key `ru.json` lacks.
   Requires exporting `SECTION_TRANSLATION_KEYS` and `getMethodKey` from the hook: mirroring
   the `/\(.*\)$/` regex would be a second place for `save()` → `save` to diverge silently.
2. **Add `'api.'` and `'migration.'` to `OVERLAY_PREFIXES`** (`index.test.ts:75`). One line.
3. **Extend `ru-language-purity.test.tsx`** with `it.each(API_SECTIONS)` rows plus `Footer`,
   `ThemeToggle` and `NotFoundPage` — and apply the attribute-only veto change described in
   the chrome section, without which the `ThemeToggle` row is green before the fix.
4. **Companion change, not optional:** an `ApiSection` purity row reports ~533 offenders, of
   which **230 are language-agnostic identifiers** rendered outside `<code>` —
   `ApiMethodCard.tsx:41` (`method.name`), `:42` (`returnType`), `:130` (`error.message`).
   Add `data-lang-exempt` to those three elements; the attribute is already honoured at
   `ru-language-purity.test.tsx:32`. Property and table identifiers are already inside
   `<code>` and correctly ignored.

Both new checks will be **red until `ru.json` is filled** — they are the acceptance
criterion for the translation work and should land with it. No allowlists, no `.skip` rows;
those rot into permanent exemptions. `it.each` makes per-section progress visible.

### Why this must be a vitest test, not the CI script

`scripts/i18n/check-docs-translations.mjs` is plain Node and cannot import the TypeScript
data modules — which is precisely why it only ever compared two JSON files. The enforcement
has to live where `API_SECTIONS` can be imported.

The failure message should name the file, the field, and the literal key to add, because the
author has just written the English and should not have to reverse-engineer `getMethodKey`:

```
api-data.ru-coverage › ru.json is missing 2 keys for strings added to api-data.ts

  api-data.ts › marks-api › methods["marks.applyRange(range, mark)"].description
    → add to docs/src/i18n/ru.json:  api.marksApi.methods.marks.applyRange.description
    English: "Apply a mark across a range without moving the caret."

  Every string a reader sees on /ru/docs/** must exist in ru.json. A missing key
  silently renders the English literal from api-data.ts (useApiTranslations.ts:182).
```

## What to do, in order

1. **Decide the changelog** (`noindex` vs translate) — it is 656 of the 1,197 phrases and
   nothing else can be sized until it is settled.
2. **Fix the three chrome strings** and the attribute-only veto change. Small, and it makes
   the purity test able to fail on the next one.
3. **Add the coverage test and the two `OVERLAY_PREFIXES` entries.** Red on arrival — that
   is the point.
4. **Translate the 311 API keys** (~11,500 words), resolving the 12 terminology defects as
   you go so the corrections land once rather than being retro-fitted.
5. **Fix the four English-side `en.json` drifts** — independent of translation, and English
   readers are seeing stale copy today.
6. **Decide `llms.txt`** — include the Russian tree or pin the exclusion with a test.

Items 2, 5 and 6 are independent of the changelog decision and can start immediately.

