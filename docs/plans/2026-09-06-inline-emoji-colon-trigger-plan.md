# Inline emoji trigger (":") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `:` plus a name in a text block opens an inline emoji menu; picking a result replaces the typed `:query` with the emoji character.

**Architecture:** Detection runs on the block's `input` event through a new `EmojiTrigger` composer that sits beside `MarkdownShortcuts`. A pure `resolveEmojiTriggerSpan` decides when a menu is warranted. The menu is the same popover the toolbox uses, in listbox mode with `handleContentEditableNavigation`, so the caret stays in the block. Insertion mirrors `MarkdownShortcuts.handleInlineMarkdown`: stop Yjs capturing, rewrite the text nodes, restore the caret.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), `@emoji-mart/data`, Yjs.

**Spec:** `docs/plans/2026-09-06-inline-emoji-colon-trigger-design.md`

## Global Constraints

- TDD is mandatory: write the test, watch it fail, then implement. Bug fixes get a regression test that fails first.
- Run only the tests you added or changed while iterating. `yarn lint` and `yarn test` across the project are the final gate, not the per-task gate.
- Lint only changed files while iterating.
- Never use `any`, `@ts-ignore`, or non-null `!` in tests; use type guards.
- `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`.
- E2E locators: role, then text, then `data-blok-testid`. Never CSS classes.
- Code comments record only what silently breaks if changed. No history, no restating the code.
- Do **not** write "Notion parity" in any comment for this feature. The rules are our conventions; the spec explains why.
- Other sessions are active in this repo. Before committing, `git add` only the exact paths the task names. Never `git add -A`, never `git add` a file you did not write in this task.
- Never `git stash`. Other sessions have uncommitted work in this tree and a stash can destroy it.
- Before editing a file another session has claimed, message that session and wait. `src/components/modules/blockEvents/index.ts` (Task 6) sits next to the inline-toolbar and popover files another session owns.

---

### Task 1: Move the emoji dataset out of the callout tool

The dataset gains a second consumer in core, so it moves to a shared location. This task is a pure move: no behaviour changes.

**Files:**
- Create (by `git mv`): `src/components/utils/emoji/emoji-data.ts`, `src/components/utils/emoji/emoji-locale.ts`, `src/components/utils/emoji/locales/` (65 `.json` files)
- Delete (by the same `git mv`): `src/tools/callout/emoji-picker/emoji-data.ts`, `src/tools/callout/emoji-picker/emoji-locale.ts`, `src/tools/callout/emoji-picker/locales/`
- Modify: `src/tools/callout/emoji-picker/index.ts` (its two imports)
- Modify: `scripts/build-emoji-locale-data.mjs:9` (comment) and `:61` (output path)
- Modify: `test/unit/scripts/build-emoji-locale-data.test.ts` (expected output path)
- Test (by `git mv`): `test/unit/components/utils/emoji/emoji-data.test.ts`, `test/unit/components/utils/emoji/emoji-locale.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadEmojiData(): Promise<ProcessedEmoji[]>`, `searchEmojis(...)`, `groupEmojisByCategory(...)`, `CURATED_CALLOUT_EMOJIS`, `type ProcessedEmoji` from `src/components/utils/emoji/emoji-data`; `loadEmojiLocale(locale: string)`, `type EmojiLocaleData` from `src/components/utils/emoji/emoji-locale`.

- [ ] **Step 1: Move the source files**

The locale JSON files are imported as `./locales/<code>.json` relative paths, so moving the directory as a unit keeps every import valid.

```bash
mkdir -p src/components/utils/emoji
git mv src/tools/callout/emoji-picker/emoji-data.ts   src/components/utils/emoji/emoji-data.ts
git mv src/tools/callout/emoji-picker/emoji-locale.ts src/components/utils/emoji/emoji-locale.ts
git mv src/tools/callout/emoji-picker/locales         src/components/utils/emoji/locales
```

- [ ] **Step 2: Move the tests**

```bash
mkdir -p test/unit/components/utils/emoji
git mv test/unit/tools/callout/emoji-picker/emoji-data.test.ts   test/unit/components/utils/emoji/emoji-data.test.ts
git mv test/unit/tools/callout/emoji-picker/emoji-locale.test.ts test/unit/components/utils/emoji/emoji-locale.test.ts
```

- [ ] **Step 3: Fix the import paths**

In `src/tools/callout/emoji-picker/index.ts`, change the two dataset imports:

```ts
import { loadEmojiData, searchEmojis, groupEmojisByCategory, CURATED_CALLOUT_EMOJIS, type ProcessedEmoji } from '../../../components/utils/emoji/emoji-data';
import { loadEmojiLocale, type EmojiLocaleData } from '../../../components/utils/emoji/emoji-locale';
```

In both moved test files, the dynamic `await import('../../../../../src/tools/callout/emoji-picker/emoji-data')` specifiers now resolve from `test/unit/components/utils/emoji/`. Replace them with:

```ts
await import('../../../../../src/components/utils/emoji/emoji-data');
```

Apply the same rewrite for `emoji-locale` in the locale test.

- [ ] **Step 4: Fix the generator**

In `scripts/build-emoji-locale-data.mjs`, update the output comment on line 9 and the path on line 61:

```js
  join(ROOT, 'src/components/utils/emoji/locales');
```

Then update the expected path string in `test/unit/scripts/build-emoji-locale-data.test.ts` to match.

- [ ] **Step 5: Run the moved and touched tests**

Run:

```bash
yarn test test/unit/components/utils/emoji/ test/unit/scripts/build-emoji-locale-data.test.ts test/unit/tools/callout/
```

Expected: PASS. A failure here means an import specifier was missed.

- [ ] **Step 6: Verify no stale references remain**

Run:

```bash
grep -rn "callout/emoji-picker/emoji-data\|callout/emoji-picker/emoji-locale\|callout/emoji-picker/locales" src test scripts docs
```

Expected: no output.

- [ ] **Step 7: Pin the new location with an architecture test**

Create `test/unit/architecture/emoji-dataset-location-law.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

describe('emoji dataset location law', () => {
  it('keeps the dataset in the shared utils directory', () => {
    expect(existsSync(resolve(ROOT, 'src/components/utils/emoji/emoji-data.ts'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'src/components/utils/emoji/emoji-locale.ts'))).toBe(true);
  });

  it('does not leave a copy under the callout tool', () => {
    expect(existsSync(resolve(ROOT, 'src/tools/callout/emoji-picker/emoji-data.ts'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/tools/callout/emoji-picker/locales'))).toBe(false);
  });
});
```

Do **not** add a blanket "core must not import from tools" assertion. Core already imports from tools deliberately in several places, so such a test would fail on existing code.

Run: `yarn test test/unit/architecture/emoji-dataset-location-law.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/utils/emoji src/tools/callout/emoji-picker/index.ts scripts/build-emoji-locale-data.mjs test/unit/components/utils/emoji test/unit/scripts/build-emoji-locale-data.test.ts test/unit/architecture/emoji-dataset-location-law.test.ts
git commit -m "refactor(emoji): move the emoji dataset to a shared location"
```

---

### Task 2: `resolveEmojiTriggerSpan`

The pure decision function. No DOM, no state.

**Files:**
- Create: `src/components/utils/emoji/emoji-trigger-span.ts`
- Test: `test/unit/components/utils/emoji/emoji-trigger-span.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveEmojiTriggerSpan(text: string, caretOffset: number): EmojiTriggerSpan | null` and `interface EmojiTriggerSpan { start: number; end: number; query: string }`, exported from `src/components/utils/emoji/emoji-trigger-span`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/components/utils/emoji/emoji-trigger-span.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveEmojiTriggerSpan } from '../../../../../src/components/utils/emoji/emoji-trigger-span';

describe('resolveEmojiTriggerSpan', () => {
  const cases: ReadonlyArray<readonly [label: string, text: string, caret: number, expected: { start: number; end: number; query: string } | null]> = [
    ['colon at line start',            ':fi',        3, { start: 0, end: 3, query: 'fi' }],
    ['colon after a space',            'hello :fi',  9, { start: 6, end: 9, query: 'fi' }],
    ['colon inside a time',            '10:30',      5, null],
    ['bare colon',                     ':',          1, null],
    ['whitespace inside the query',    ':fi re',     6, null],
    ['colon inside a url',             'http://',    7, null],
    ['text after the caret is ignored',':firex',     5, { start: 0, end: 5, query: 'fire' }],
    ['colon directly after a word',    'a:b',        3, null],
    ['caret before the colon',         ':fire',      0, null],
    ['second colon wins',              ':a :fi',     6, { start: 3, end: 6, query: 'fi' }],
    ['non-breaking space counts as whitespace', 'x :fi', 5, { start: 2, end: 5, query: 'fi' }],
  ];

  it.each(cases)('%s', (_label, text, caret, expected) => {
    expect(resolveEmojiTriggerSpan(text, caret)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/utils/emoji/emoji-trigger-span.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/utils/emoji/emoji-trigger-span.ts`:

```ts
export interface EmojiTriggerSpan {
  start: number;
  end: number;
  query: string;
}

// A contenteditable renders a trailing space as U+00A0, so both forms must
// count as the word boundary before the colon.
const WHITESPACE = /[\s ]/;

/**
 * Plain-text span of a ":query" the caret currently sits in, or null when the
 * text under the caret is not an emoji trigger.
 * @param text - the block's plain text
 * @param caretOffset - caret position as a plain-text offset
 */
export function resolveEmojiTriggerSpan(text: string, caretOffset: number): EmojiTriggerSpan | null {
  const colonIndex = text.lastIndexOf(':', Math.max(0, caretOffset - 1));

  if (colonIndex === -1 || colonIndex >= caretOffset) {
    return null;
  }

  const charBefore = colonIndex === 0 ? '' : text.charAt(colonIndex - 1);

  if (charBefore !== '' && !WHITESPACE.test(charBefore)) {
    return null;
  }

  const query = text.slice(colonIndex + 1, caretOffset);

  if (query.length === 0 || WHITESPACE.test(query)) {
    return null;
  }

  return { start: colonIndex, end: caretOffset, query };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test test/unit/components/utils/emoji/emoji-trigger-span.test.ts`
Expected: PASS, 11 cases.

- [ ] **Step 5: Lint the changed files**

Run: `npx eslint src/components/utils/emoji/emoji-trigger-span.ts test/unit/components/utils/emoji/emoji-trigger-span.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/utils/emoji/emoji-trigger-span.ts test/unit/components/utils/emoji/emoji-trigger-span.test.ts
git commit -m "feat(emoji): resolve the inline ':' trigger span"
```

---

### Task 3: Ranked emoji search

`searchEmojis` matches by substring on name and keywords only, ignores the shortcode `id`, does not rank, and does not cap. It stays as-is for the callout grid; the inline menu gets its own ranked function.

**Files:**
- Create: `src/components/utils/emoji/emoji-search-ranked.ts`
- Test: `test/unit/components/utils/emoji/emoji-search-ranked.test.ts`

**Interfaces:**
- Consumes: `type ProcessedEmoji` and `type EmojiLocaleData` from Task 1.
- Produces: `searchEmojisRanked(emojis: ProcessedEmoji[], query: string, localeData?: EmojiLocaleData | null, limit?: number): ProcessedEmoji[]`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/components/utils/emoji/emoji-search-ranked.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { searchEmojisRanked } from '../../../../../src/components/utils/emoji/emoji-search-ranked';
import type { ProcessedEmoji } from '../../../../../src/components/utils/emoji/emoji-data';

function emoji(id: string, name: string, keywords: string[], native: string): ProcessedEmoji {
  return { id, name, keywords, native, skins: [native], category: 'test' };
}

const DATA: ProcessedEmoji[] = [
  emoji('fire', 'Fire', ['hot', 'cook', 'flame'], '🔥'),
  emoji('fire_engine', 'Fire Engine', ['truck'], '🚒'),
  emoji('firecracker', 'Firecracker', ['dynamite'], '🧨'),
  emoji('+1', 'Thumbs Up', ['+1', 'thumbsup', 'yes'], '👍'),
  emoji('extinguisher', 'Fire Extinguisher', ['quench'], '🧯'),
];

describe('searchEmojisRanked', () => {
  it('puts an exact shortcode match first', () => {
    expect(searchEmojisRanked(DATA, 'fire')[0]?.native).toBe('🔥');
  });

  it('resolves a keyword-only shortcode such as thumbsup', () => {
    expect(searchEmojisRanked(DATA, 'thumbsup')[0]?.native).toBe('👍');
  });

  it('ranks an id prefix above a name-substring match', () => {
    const natives = searchEmojisRanked(DATA, 'firec').map(e => e.native);

    expect(natives[0]).toBe('🧨');
  });

  it('ranks an id prefix above a name prefix', () => {
    const natives = searchEmojisRanked(DATA, 'fire').map(e => e.native);

    // fire_engine matches on the id; Fire Extinguisher only on the name.
    expect(natives.indexOf('🚒')).toBeLessThan(natives.indexOf('🧯'));
  });

  it('never matches a query containing whitespace', () => {
    // resolveEmojiTriggerSpan rejects these upstream; assert the contract here too.
    expect(searchEmojisRanked(DATA, 'fire e')).toEqual([]);
  });

  it('caps the result list', () => {
    expect(searchEmojisRanked(DATA, 'fire', null, 2)).toHaveLength(2);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchEmojisRanked(DATA, 'zzzz')).toEqual([]);
  });

  it('is stable: equal-rank results keep dataset order', () => {
    const natives = searchEmojisRanked(DATA, 'fire').map(e => e.native);

    // fire_engine and firecracker both rank as id prefixes, so their relative
    // order must come from the dataset, not from the sort.
    expect(natives.indexOf('🚒')).toBeLessThan(natives.indexOf('🧨'));
  });

  it('matches a localized name when locale data is supplied', () => {
    const locale = { '🔥': { n: 'Огонь', k: ['жар'] } };

    expect(searchEmojisRanked(DATA, 'огонь', locale)[0]?.native).toBe('🔥');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/utils/emoji/emoji-search-ranked.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/utils/emoji/emoji-search-ranked.ts`:

```ts
import type { ProcessedEmoji } from './emoji-data';
import type { EmojiLocaleData } from './emoji-locale';

const DEFAULT_LIMIT = 10;

// Lower is better. Gaps left between tiers so a tier can be inserted later
// without renumbering the others.
const RANK_EXACT_ID = 0;
const RANK_ID_PREFIX = 10;
const RANK_KEYWORD_PREFIX = 20;
const RANK_NAME_PREFIX = 30;
const RANK_SUBSTRING = 40;
const RANK_NONE = Number.POSITIVE_INFINITY;

function rankOne(emoji: ProcessedEmoji, query: string, localeData?: EmojiLocaleData | null): number {
  const id = emoji.id.toLowerCase();
  const name = emoji.name.toLowerCase();
  const keywords = emoji.keywords.map(k => k.toLowerCase());
  const localized = localeData?.[emoji.native];
  const localizedName = localized?.n.toLowerCase() ?? '';
  const localizedKeywords = (localized?.k ?? []).map(k => k.toLowerCase());

  if (id === query || keywords.includes(query)) {
    return RANK_EXACT_ID;
  }

  if (id.startsWith(query)) {
    return RANK_ID_PREFIX;
  }

  if (keywords.some(k => k.startsWith(query)) || localizedKeywords.some(k => k.startsWith(query))) {
    return RANK_KEYWORD_PREFIX;
  }

  if (name.startsWith(query) || localizedName.startsWith(query)) {
    return RANK_NAME_PREFIX;
  }

  if (id.includes(query) || name.includes(query) || localizedName.includes(query)) {
    return RANK_SUBSTRING;
  }

  return RANK_NONE;
}

/**
 * Emoji matching the query, best first, capped.
 *
 * Ties keep the dataset's own order so the list does not reshuffle between
 * keystrokes — the menu's highlighted row must not move under the user.
 * @param emojis - the loaded dataset
 * @param query - the text typed after ":", already without whitespace
 * @param localeData - translated names/keywords, when loaded
 * @param limit - maximum results
 */
export function searchEmojisRanked(
  emojis: ProcessedEmoji[],
  query: string,
  localeData?: EmojiLocaleData | null,
  limit: number = DEFAULT_LIMIT
): ProcessedEmoji[] {
  const lower = query.toLowerCase();

  return emojis
    .map((emoji, index) => ({ emoji, index, rank: rankOne(emoji, lower, localeData) }))
    .filter(entry => entry.rank !== RANK_NONE)
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .slice(0, limit)
    .map(entry => entry.emoji);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test test/unit/components/utils/emoji/emoji-search-ranked.test.ts`
Expected: PASS.

`searchEmojisRanked` never sees a whitespace query in production, because `resolveEmojiTriggerSpan` rejects one upstream. The assertion is kept here so the contract survives if the two functions are ever wired differently.

- [ ] **Step 5: Lint the changed files**

Run: `npx eslint src/components/utils/emoji/emoji-search-ranked.ts test/unit/components/utils/emoji/emoji-search-ranked.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/components/utils/emoji/emoji-search-ranked.ts test/unit/components/utils/emoji/emoji-search-ranked.test.ts
git commit -m "feat(emoji): rank inline search results by shortcode then keyword"
```

---

### Task 4: The `inlineEmoji` config key

A new `BlokConfig` key is four edits. Missing an adapter edit fails `tsc` with `Type 'true' is not assignable to type 'never'` from the adapters' exhaustiveness guards.

**Files:**
- Modify: `types/configs/blok-config.d.ts`
- Modify: `packages/react/src/config-keys.ts`
- Modify: `packages/vue/src/config-keys.ts`
- Modify: `packages/vue/src/BlokEditor.ts`
- Test: `test/unit/components/utils/emoji/inline-emoji-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `inlineEmoji?: boolean` on `BlokConfig`, default `true`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/components/utils/emoji/inline-emoji-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isInlineEmojiEnabled } from '../../../../../src/components/utils/emoji/inline-emoji-config';

describe('isInlineEmojiEnabled', () => {
  it('defaults to enabled when the key is absent', () => {
    expect(isInlineEmojiEnabled({})).toBe(true);
  });

  it('is disabled only by an explicit false', () => {
    expect(isInlineEmojiEnabled({ inlineEmoji: false })).toBe(false);
    expect(isInlineEmojiEnabled({ inlineEmoji: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/utils/emoji/inline-emoji-config.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Add the type and the reader**

In `types/configs/blok-config.d.ts`, add beside the other optional flags such as `inlineToolbar`:

```ts
  /**
   * Inline emoji menu opened by typing ":" followed by a name. On by default.
   */
  inlineEmoji?: boolean;
```

Create `src/components/utils/emoji/inline-emoji-config.ts`:

```ts
/**
 * Whether the inline ":" emoji menu is active for this editor.
 * Absent means on; only an explicit false turns it off.
 * @param config - the editor configuration
 */
export function isInlineEmojiEnabled(config: { inlineEmoji?: boolean }): boolean {
  return config.inlineEmoji !== false;
}
```

- [ ] **Step 4: Add the key to all three adapter declarations**

Add `'inlineEmoji'` to the key list in `packages/react/src/config-keys.ts` and in `packages/vue/src/config-keys.ts`, each in the same alphabetical position the file already uses. Then add the matching prop declaration in `packages/vue/src/BlokEditor.ts` next to the other boolean props.

- [ ] **Step 5: Run the test and the type check**

Run: `yarn test test/unit/components/utils/emoji/inline-emoji-config.test.ts`
Expected: PASS.

Then confirm the exhaustiveness guards are satisfied:

Run: `npx tsc --noEmit -p packages/react && npx tsc --noEmit -p packages/vue`
Expected: no errors. `Type 'true' is not assignable to type 'never'` means one of the two `config-keys.ts` files is missing the key.

- [ ] **Step 6: Commit**

```bash
git add types/configs/blok-config.d.ts src/components/utils/emoji/inline-emoji-config.ts packages/react/src/config-keys.ts packages/vue/src/config-keys.ts packages/vue/src/BlokEditor.ts test/unit/components/utils/emoji/inline-emoji-config.test.ts
git commit -m "feat(config): add the inlineEmoji opt-out key"
```

---

### Task 5: i18n keys for the menu

Adding any key to `en.json` triggers a seven-layer contract. Script the bulk edits; never hand-edit 69 files.

**Files:**
- Modify: `src/components/i18n/locales/*.json` (69 files)
- Modify: `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`
- Modify: `types/message-keys.d.ts` (generated)
- Test: the existing `test/unit/components/i18n/` suite

**Interfaces:**
- Consumes: nothing.
- Produces: message keys `emoji.search` (the menu's accessible label) and `emoji.nothingFound` (empty state).

- [ ] **Step 1: Add both keys to `en.json`**

Insert into `src/components/i18n/locales/en.json` under a new `emoji` object, placed after the existing `popover` object:

```json
  "emoji": {
    "search": "Search emoji",
    "nothingFound": "No emoji found"
  },
```

- [ ] **Step 2: Run the i18n suite to see it fail**

Run: `yarn test test/unit/components/i18n/`
Expected: FAIL. `untranslated-strings.test.ts` reports the key missing from the other 68 locales, and `lifecycle-coverage.test.ts` reports a key-count mismatch.

- [ ] **Step 3: Propagate the keys to all locales with a script**

Write a throwaway Node script that, for each file in `src/components/i18n/locales/`, inserts the same `emoji` object at the same position, using each locale's own established wording. Reuse existing translations where the meaning matches: most locales already translate a search placeholder for the toolbox filter and a "nothing found" string for the popover. Extract those first and reuse them rather than inventing new wording.

- [ ] **Step 4: Update the ledger**

Rewrite both digest columns for every locale in the "Reviewed Dictionary Digests" table of `docs/plans/2026-07-19-all-locales-translation-audit-ledger.md`. For any locale whose new values are identical to English, add both a `COGNATE_RETENTIONS` entry in `untranslated-strings.test.ts` and a matching `R-<locale>-NNN` retention row in the ledger. The ledger check demands exact parity between retention rows and exact-English keys.

- [ ] **Step 5: Update the lifecycle pins and regenerate the types**

Bump the total key count and the executable-literal count in both the test title and the assertions of `lifecycle-coverage.test.ts`. Then:

Run: `node scripts/generate-message-keys-dts.mjs`

- [ ] **Step 6: Run the i18n gate**

Run: `yarn test test/unit/components/i18n/ && yarn i18n:check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/i18n/locales types/message-keys.d.ts docs/plans/2026-07-19-all-locales-translation-audit-ledger.md test/unit/components/i18n
git commit -m "i18n(emoji): add inline emoji menu strings"
```

---

### Task 6: The `EmojiTrigger` composer — open and close

Detection and menu lifecycle. Insertion is Task 7.

**Files:**
- Create: `src/components/modules/blockEvents/composers/emojiTrigger.ts`
- Modify: `src/components/modules/blockEvents/index.ts` (import, field, construction beside `_markdownShortcuts` at line 43, and the `handleInput` call at line 308)
- Test: `test/unit/components/modules/blockEvents/composers/emojiTrigger.fixture.ts`, `test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts`

**Interfaces:**
- Consumes: `resolveEmojiTriggerSpan` (Task 2), `searchEmojisRanked` (Task 3), `isInlineEmojiEnabled` (Task 4), `emoji.search` / `emoji.nothingFound` (Task 5), `loadEmojiData` and `prefetchEmojiPickerData`.
- Produces: `class EmojiTrigger extends BlockEventComposer` with `handleInput(event: InputEvent): Promise<boolean>`, `handleKeydown(event: KeyboardEvent): boolean`, `close(): void`, `commit(emoji: ProcessedEmoji): void` (Task 7), and a readonly `opened: boolean`.

- [ ] **Step 1: Write the failing test**

These unit tests assert menu **state** (`opened`), never rendered popover markup. The composer constructs a real `PopoverDesktop`, which in jsdom reaches for `window.matchMedia` and layout APIs, so the fixture must stub the popover module:

```ts
vi.mock('../../../../../../src/components/utils/popover', () => ({
  PopoverDesktop: vi.fn(() => ({
    show: vi.fn(), hide: vi.fn(), on: vi.fn(), filterItems: vi.fn(),
    updatePosition: vi.fn(), getElement: vi.fn(() => document.createElement('div')),
  })),
  PopoverMobile: vi.fn(),
}));
```

Without that stub the first run fails with `matchMedia is not a function`. Popover rendering, positioning and keyboard navigation are covered by the e2e task, not here.

Put the harness in `test/unit/components/modules/blockEvents/composers/emojiTrigger.fixture.ts` and export `createBlock`, `createBlokModules` and `setCaret` from it, because Tasks 7 and 8 import the same three helpers. The shapes below follow `markdownShortcuts.test.ts`; do not invent different ones.

Then create `test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts` importing from that fixture.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import { isInlineEmojiEnabled } from '../../../../../../src/components/utils/emoji/inline-emoji-config';

const createInputEvent = (options: Partial<InputEvent> = {}): InputEvent => ({
  inputType: 'insertText',
  data: 'i',
  isComposing: false,
  ...options,
} as InputEvent);

const createBlock = (text: string, toolOverrides: Record<string, unknown> = {}): Block => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.textContent = text;

  const holder = document.createElement('div');

  holder.appendChild(input);

  return {
    id: 'test-block',
    name: 'paragraph',
    holder,
    currentInput: input,
    inputs: [input],
    isEmpty: text.length === 0,
    tool: { isDefault: true, isLineBreaksEnabled: false, name: 'paragraph', ...toolOverrides },
  } as unknown as Block;
};

const createBlokModules = (block: Block): BlokModules => ({
  BlockManager: {
    currentBlock: block,
    setCurrentBlockByChildNode: vi.fn(),
  } as unknown as BlokModules['BlockManager'],
  YjsManager: { stopCapturing: vi.fn() } as unknown as BlokModules['YjsManager'],
} as unknown as BlokModules);

/** Put the caret at `offset` inside the block's single text node. */
const setCaret = (block: Block, offset: number): void => {
  const input = block.currentInput;
  const textNode = input?.firstChild;

  if (textNode === null || textNode === undefined) {
    throw new Error('block has no text node');
  }

  const range = document.createRange();

  range.setStart(textNode, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('EmojiTrigger — opening and closing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the menu when ":fi" is typed at the start of a paragraph', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());

    expect(trigger.opened).toBe(true);
  });

  it('does not open when the colon sits inside "10:30"', async () => {
    const block = createBlock('10:30');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent({ data: '0' }));

    expect(trigger.opened).toBe(false);
  });

  it('does not open in a block that is not text-like', async () => {
    const block = createBlock(':fi', { isDefault: false, isLineBreaksEnabled: true });

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());

    expect(trigger.opened).toBe(false);
  });

  it('ignores input while a composition is in progress', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent({ isComposing: true }));

    expect(trigger.opened).toBe(false);
  });

  it('closes when a space is typed into the query', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());
    expect(trigger.opened).toBe(true);

    if (block.currentInput !== null && block.currentInput !== undefined) {
      block.currentInput.textContent = ':fi ';
    }
    setCaret(block, 4);
    await trigger.handleInput(createInputEvent({ data: ' ' }));

    expect(trigger.opened).toBe(false);
  });

  it('closes on Escape and leaves the typed text alone', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());

    const handled = trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(handled).toBe(true);
    expect(trigger.opened).toBe(false);
    expect(block.currentInput?.textContent).toBe(':fi');
  });

  it('never opens when inlineEmoji is false', async () => {
    // The composer itself has no config access; BlockEvents guards the call.
    // This asserts the guard, not the composer, so it drives the real wiring.
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));
    const handleInput = vi.spyOn(trigger, 'handleInput');

    // Stand in for BlockEvents.handleInput's guard line.
    if (isInlineEmojiEnabled({ inlineEmoji: false })) {
      void trigger.handleInput(createInputEvent());
    }

    expect(handleInput).not.toHaveBeenCalled();
    expect(trigger.opened).toBe(false);
  });

  it('closes when the search yields nothing', async () => {
    const block = createBlock(':zzzzzz');

    document.body.appendChild(block.holder);
    setCaret(block, 7);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent({ data: 'z' }));

    expect(trigger.opened).toBe(false);
  });
});
```

`handleInput` is async because it awaits the lazily-imported dataset. Keep that in the signature: `handleInput(event: InputEvent): Promise<boolean>`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts`
Expected: FAIL, cannot resolve the composer module.

- [ ] **Step 3: Write the composer**

Create `src/components/modules/blockEvents/composers/emojiTrigger.ts` extending `BlockEventComposer` from `./__base`. Its `handleInput`:

1. Returns `false` when `event.isComposing` is true, or when `event.inputType` is not an insert or delete text type.
2. Returns `false` when the current block is not text-like. Reuse the same test `slashPressed` uses; extract `isTextLikeBlock` from `blockEvents/index.ts` into a small exported helper so both call one implementation rather than two copies.
3. Reads the current block's plain text and the caret offset, then calls `resolveEmojiTriggerSpan`.
4. On `null`, closes any open menu and returns `false`.
5. On a span, fires `prefetchEmojiPickerData` once, awaits `loadEmojiData`, runs `searchEmojisRanked`, closes when the result is empty, otherwise opens or updates the menu.

The menu is a `PopoverDesktop` (or `PopoverMobile` on a mobile screen) constructed the way `Toolbox.initPopover` does, with `listbox: true`, `handleContentEditableNavigation: true`, a `listboxId`, and `messages.search` / `messages.nothingFound` from the Task 5 keys. Anchor it once, at open, to the rect of the `:` character; do not re-anchor on later keystrokes. Apply the combobox roles to the block's contenteditable exactly as `Toolbox.applyComboboxRoles` does, and restore the previous `aria-label` on close.

- [ ] **Step 4: Wire the composer into `blockEvents`**

In `src/components/modules/blockEvents/index.ts`, mirror the `MarkdownShortcuts` wiring: import it, construct it beside `this._markdownShortcuts = new MarkdownShortcuts(this.Blok)` at line 43, and call it from the input handler right after the markdown line at 308:

`BlockEvents` extends `Module`, so it owns `protected config: BlokConfig`. The composer only receives `BlokModules`, which carries no configuration, so the opt-out is enforced at the call site:

```ts
    // Markdown shortcuts first: a markdown conversion rewrites the block, and
    // an emoji span resolved against the pre-conversion text would be stale.
    this.markdownShortcuts.handleInput(event);

    if (isInlineEmojiEnabled(this.config)) {
      void this.emojiTrigger.handleInput(event);
    }
```

Route the menu's keys in the existing `keydown` path, before the block's own handlers run:

```ts
    if (this.emojiTrigger.opened && this.emojiTrigger.handleKeydown(event)) {
      return;
    }
```

`handleKeydown` returns `true` for `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, `Tab` and `Escape` while the menu is open, and `false` otherwise. Extend `needToolbarClosing` so `Enter` and `Tab` do not reach the block handlers while the emoji menu is open, following the `toolboxOpenForInlineSearch` pattern already in that method.

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint the changed files**

Run: `npx eslint src/components/modules/blockEvents/composers/emojiTrigger.ts src/components/modules/blockEvents/index.ts test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/components/modules/blockEvents/composers/emojiTrigger.ts src/components/modules/blockEvents/index.ts test/unit/components/modules/blockEvents/composers/emojiTrigger.fixture.ts test/unit/components/modules/blockEvents/composers/emojiTrigger.test.ts
git commit -m "feat(emoji): open an inline menu on the ':' trigger"
```

---

### Task 7: Insertion, skin tone, and single-step undo

**Files:**
- Modify: `src/components/modules/blockEvents/composers/emojiTrigger.ts`
- Test: `test/unit/components/modules/blockEvents/composers/emojiTrigger-insert.test.ts`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `EmojiTrigger.commit(emoji: ProcessedEmoji): void`, called by the popover item's click handler and by Enter/Tab.

- [ ] **Step 1: Write the failing test**

Create `test/unit/components/modules/blockEvents/composers/emojiTrigger-insert.test.ts`, reusing the `createBlock` / `createBlokModules` / `setCaret` helpers from the Task 6 test file (extract them into a shared `emojiTrigger.fixture.ts` beside the tests rather than copying them a second time).

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';
import type { ProcessedEmoji } from '../../../../../../src/components/utils/emoji/emoji-data';

const FIRE: ProcessedEmoji = {
  id: 'fire', name: 'Fire', keywords: ['hot'], native: '🔥', skins: ['🔥'], category: 'nature',
};
const HAND: ProcessedEmoji = {
  id: 'raised_hand', name: 'Raised Hand', keywords: ['hand'], native: '✋',
  skins: ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'], category: 'people',
};

describe('EmojiTrigger — insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the typed ":fi" with the emoji character', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(block.currentInput?.textContent).toBe('🔥');
  });

  it('keeps the text before and after the span', async () => {
    const block = createBlock('a :fi b');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(block.currentInput?.textContent).toBe('a 🔥 b');
  });

  it('leaves the caret directly after the inserted emoji', async () => {
    const block = createBlock('a :fi');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    const range = window.getSelection()?.getRangeAt(0);

    expect(range?.collapsed).toBe(true);
    expect(range?.startOffset).toBe('a 🔥'.length);
  });

  it('applies the saved skin tone', async () => {
    localStorage.setItem('blok-emoji-skin-tone', '3');

    const block = createBlock(':ha');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'a', isComposing: false } as InputEvent);
    trigger.commit(HAND);

    expect(block.currentInput?.textContent).toBe('✋🏽');
  });

  it('falls back to the default skin when the stored tone is out of range', async () => {
    localStorage.setItem('blok-emoji-skin-tone', '4');

    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(block.currentInput?.textContent).toBe('🔥');
  });

  it('stops Yjs capturing so the replacement is one undo step', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const modules = createBlokModules(block);
    const trigger = new EmojiTrigger(modules);

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(modules.YjsManager.stopCapturing).toHaveBeenCalledTimes(1);
  });

  it('closes the menu after committing', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(trigger.opened).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger-insert.test.ts`
Expected: FAIL, `commit` is not a function.

- [ ] **Step 3: Implement `commit`**

Follow the sequence `MarkdownShortcuts.handleInlineMarkdown` uses, in this order:

1. Guard: a collapsed selection whose `startContainer` is a text node inside `currentBlock.currentInput`.
2. `this.Blok.YjsManager.stopCapturing()` before any DOM write, so the replacement does not merge with the preceding keystrokes into one undo entry.
3. Build the replacement text: `before + native + after`, where `before` and `after` come from slicing the text node around the resolved span and `native` is the emoji's skin-tone-adjusted character.

   The stored tone is a **direct index into the emoji's `skins` array**, not a Fitzpatrick number. `loadSkinTone` in `src/tools/callout/emoji-picker/index.ts` reads `localStorage` key `blok-emoji-skin-tone`, parses it as an integer, and returns it when it falls in 0 to 5, otherwise 0. Index 0 is the default (tone-free) glyph. Reuse that reader rather than writing a second one, and additionally fall back to `skins[0]` when the index exceeds the array for a given emoji, since most emoji have exactly one skin.
4. Restore the caret to the offset just after the inserted character.
5. Close the menu and restore the contenteditable's previous `aria-label`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger-insert.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/blockEvents/composers/emojiTrigger.ts test/unit/components/modules/blockEvents/composers/emojiTrigger-insert.test.ts
git commit -m "feat(emoji): insert the picked emoji as one undo step"
```

---

### Task 8: Commit on a closing colon

`:fire:` inserts without touching the menu when the query is an exact shortcode match.

**Files:**
- Modify: `src/components/modules/blockEvents/composers/emojiTrigger.ts`
- Test: `test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon.test.ts`

**Interfaces:**
- Consumes: `commit` from Task 7, `searchEmojisRanked` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon.test.ts`, again reusing `emojiTrigger.fixture.ts`.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

const typeClosingColon = async (trigger: EmojiTrigger, block: ReturnType<typeof createBlock>, text: string): Promise<void> => {
  if (block.currentInput !== null && block.currentInput !== undefined) {
    block.currentInput.textContent = text;
  }
  setCaret(block, text.length);
  await trigger.handleInput({ inputType: 'insertText', data: ':', isComposing: false } as InputEvent);
};

describe('EmojiTrigger — closing colon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts on the closing colon when the query is an exact shortcode', async () => {
    const block = createBlock(':fire');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':fire:');

    expect(block.currentInput?.textContent).toBe('🔥');
    expect(trigger.opened).toBe(false);
  });

  it('matches a keyword shortcode such as ":thumbsup:"', async () => {
    const block = createBlock(':thumbsup');

    document.body.appendChild(block.holder);
    setCaret(block, 9);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'p', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':thumbsup:');

    expect(block.currentInput?.textContent).toBe('👍');
  });

  it('only closes the menu when the closing colon follows a non-exact query', async () => {
    const block = createBlock(':fir');

    document.body.appendChild(block.holder);
    setCaret(block, 4);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'r', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':fir:');

    expect(block.currentInput?.textContent).toBe(':fir:');
    expect(trigger.opened).toBe(false);
  });
});
```

These three run against the real `@emoji-mart/data` dataset, so no data mock is needed. That is deliberate: an exact-shortcode assertion is only meaningful against the real ids.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon.test.ts`
Expected: FAIL on the first case, the text still reads `:fire:`.

- [ ] **Step 3: Implement the branch**

In `handleInput`, when the inserted character is `:` and a span was open, look up the query. If exactly one result ranks as an exact shortcode match, extend the span by one to swallow the closing colon and call `commit`. Otherwise close the menu and leave the text alone.

This path depends on `RANK_EXACT_ID` in Task 3 treating an exact **keyword** hit the same as an exact **id** hit. That is what makes `:thumbsup:` work, because `thumbsup` is a keyword of the `+1` emoji and not an id. Do not "tidy" that tier into id-only matching without also changing this branch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/blockEvents/composers/emojiTrigger.ts test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon.test.ts
git commit -m "feat(emoji): commit on a closing colon for exact shortcodes"
```

---

### Task 9: End-to-end coverage

**Files:**
- Create: `test/e2e/emoji-inline-trigger.spec.ts`

**Interfaces:**
- Consumes: the shipped feature.
- Produces: nothing.

- [ ] **Step 1: Write the failing spec**

Create `test/e2e/emoji-inline-trigger.spec.ts`. Use role, text, and `data-blok-testid` locators only. Give the emoji popover a `data-blok-testid` of `emoji-menu` in Task 6's popover construction if it is not already there, and locate it by that. Cover:

1. Type `:fi` in an empty paragraph, assert the menu is visible, press Enter, assert the saved block data contains the emoji and no colon.
2. Type `10:30`, assert the menu never appears and the text is intact.
3. Type `:fi` inside a table cell, assert the menu appears and a pick lands in the cell.
4. Type `:fi`, press Escape, assert the menu closes and the text still reads `:fi`.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `yarn e2e test/e2e/emoji-inline-trigger.spec.ts`
Expected: FAIL if any wiring is missing. The build runs automatically before e2e; no manual build step.

- [ ] **Step 3: Fix whatever the spec exposes, then re-run**

Run: `yarn e2e test/e2e/emoji-inline-trigger.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/emoji-inline-trigger.spec.ts
git commit -m "test(emoji): cover the inline ':' trigger end to end"
```

---

### Task 10: Documentation and the final gate

**Files:**
- Modify: the docs app under `docs/` — the configuration reference page that lists `BlokConfig` keys

- [ ] **Step 1: Document `inlineEmoji`**

Add `inlineEmoji` to the configuration reference in the docs app, describing the default-on behaviour and the `:` interaction. The docs site is canonical, not the README.

- [ ] **Step 2: Run the full gate**

Other sessions are working in this repo. Confirm their verification windows are released before starting a full run.

Run: `yarn lint`
Expected: 0 errors.

Run: `yarn test`
Expected: PASS.

- [ ] **Step 3: Commit and push**

```bash
git add docs
git commit -m "docs(config): document the inlineEmoji key"
```

Then publish. Do **not** use `git pull --rebase`: it aborts while other sessions hold unstaged work in this tree, and stashing their work is forbidden.

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD   # prints "behind ahead"
```

If `behind` is 0, run `git push`. If it is not 0, stop and tell the user rather than rebasing over another session's WIP.

- [ ] **Step 4: Confirm the push landed**

Run: `git ls-tree origin/main --name-only docs/`

Expected: your changed files are listed. A concurrent session may push your commit along with its own, so a `0 0` count after fetching means the work already landed, not that there was nothing to push.

Mention in the release notes that the inline emoji menu is new default-on behaviour that intercepts typing, and that `inlineEmoji: false` turns it off.
