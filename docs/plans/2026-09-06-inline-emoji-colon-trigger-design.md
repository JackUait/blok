# Inline emoji trigger (":") — design

Date: 2026-09-06
Status: approved design, not implemented

## Goal

Typing `:` followed by a name opens an inline emoji menu in text blocks. Picking a
result replaces the typed `:query` with the emoji character.

## Non-goals

- No general-purpose suggestion framework. This is emoji only. The trigger-span
  resolver is written as a pure function so a future `@` mention can copy the
  shape, but no abstraction is introduced now.
- No custom-emoji / workspace-emoji support.
- No change to the callout emoji button or its picker UI.

## Provenance of the behaviour rules

Notion documents only the bare rule: type `:` then the emoji name. It publishes
nothing about boundaries, thresholds, or dismissal. Attempts to observe the live
app failed, so **every rule below is a deliberate convention choice**, not
observed Notion behaviour. The word-boundary rule follows Tiptap's `allowedPrefixes`
convention. Do not describe any of this as "Notion parity" in code comments.

## Behaviour

### Opening

The menu opens when all of these hold:

1. The block is text-like, by the same test `/` uses (`isTextLikeBlock`).
2. The character at the span start is `:`.
3. The `:` is at offset 0 of the block text, or the character before it is
   whitespace. This is what keeps `10:30`, `Внимание: да` and `http://` quiet.
4. At least one non-whitespace character follows the `:` before the caret.
5. The query contains no whitespace.

A bare `:` never opens the menu. The dataset prefetch fires on rule 3 alone, one
keystroke before the menu can appear, so the chunk is warm by the time it opens.

### The query span

`resolveEmojiTriggerSpan(text, caretOffset)` returns `{ start, end }` or `null`.
`start` is the index of the `:`; `end` is the caret offset. Text after the caret
is never part of the query. The function is pure and takes no DOM.

| Input (caret marked `|`)   | Result        |
|----------------------------|---------------|
| `:fi|`                     | span `[0,3)`  |
| `hello :fi|`               | span `[6,9)`  |
| `10:30|`                   | `null`        |
| `:|`                       | `null`        |
| `:fi re|`                  | `null`        |
| `http://|`                 | `null`        |
| `:fire|` (text after: `x`) | span `[0,5)`  |

### Closing

The menu closes on: whitespace typed into the query, `Escape`, deletion of the
`:`, the caret moving outside the span, zero search results, and block change.
`Escape` closes the menu and leaves the typed text alone.

### Committing

`Enter`, `Tab` and click insert the highlighted emoji. Additionally, typing a
closing `:` commits immediately when the query is an exact shortcode match, so
`:fire:` works without touching the menu. A non-exact `:` just closes the menu.

When the menu is open, `Enter` and `Tab` must not reach the block's own handlers.
The existing `needToolbarClosing` guard in `blockEvents` already models this for
the toolbox and is extended, not duplicated.

### Insertion

The emoji is inserted as a plain text character, replacing `[start, end)`. It is
not an inline node. The saved skin tone from `blok-emoji-skin-tone` is applied.
The caret lands directly after the inserted character.

### Positioning

The popover anchors once, at the rect of the `:` character, when the menu opens.
It does not re-anchor per keystroke. No pill styling is applied to the query
text; the `data-blok-slash-search` pill stays specific to `/`.

### Accessibility

The contenteditable gets the same combobox roles and `aria-activedescendant`
wiring the toolbox already applies via `applyComboboxRoles`. Arrow keys move the
active option; `Home`/`End` jump to first/last. Mobile switches to
`PopoverMobile` the same way the toolbox does.

## Architecture

### Detection lives on `input`, not `keydown`

A new composer, `EmojiTrigger`, sits beside `MarkdownShortcuts` in
`src/components/modules/blockEvents/composers/`. It is invoked from the same
place `markdownShortcuts.handleInput(event)` is called.

Reasons this is not a `keydown` handler like `slashPressed`:

- `:` is Shift+6 on Russian layouts and Shift+; on US. `input` is layout-agnostic.
- IME composition, autocorrect, paste and mobile keyboards all produce `input`
  but not a clean `keydown` for the character.

Composition is skipped while `event.isComposing` is true.

`keydown` interception is still needed, but only while the menu is open, for
arrows, `Enter`, `Tab` and `Escape`.

### Replacement and undo

`MarkdownShortcuts.handleInlineMarkdown` is the working precedent: it locates the
span before the caret, calls `YjsManager.stopCapturing()`, rebuilds the text
nodes, and restores the caret. The emoji insertion follows the same sequence, so
the replacement becomes one undo step rather than merging with the typing that
preceded it.

### Menu rendering

The menu reuses the popover the toolbox uses. The toolbox already solves the hard
parts: keeping the caret in the block while a popover is open, deriving the query
from block text, bounding the query at the caret, and combobox ARIA. The emoji
menu mirrors that structure; it does not fork the popover.

## Search and ranking

`searchEmojis` today matches `name` and `keywords` by substring, does not match
the emoji-mart `id`, does not rank, and does not cap. On `:a` that returns
hundreds of results in category order. A new pure function replaces it for this
feature:

- Match against `id` (shortcode), `name`, `keywords`, and the localized name and
  keywords when locale data is loaded.
- Rank: exact `id` match, then `id` prefix, then keyword prefix, then name
  prefix, then substring anywhere. Ties break on the dataset's own order so
  results are stable across keystrokes.
- Cap the visible list at 10.

Note `thumbsup` is not an id in the dataset; the id is `+1` and `thumbsup` is a
keyword. Both must resolve.

Table-driven unit tests cover the ranking contract.

## Layering: move the emoji data out of the callout tool

`emoji-data.ts`, `emoji-locale.ts` and the 65 files in `locales/` currently live
under `src/tools/callout/emoji-picker/`.

There is **no rule in this repo against core importing from a tool** — core already
does it in several places (`toolbox.ts` imports the table's restrictions,
`ui.ts` imports the toggle's shortcuts, `blockSelection.ts` imports the list's DOM
builder). So the move is not a law fix. The reason is narrower and practical: once
the inline trigger ships, the emoji dataset has two consumers, one of which is core.
A ~415KB lazily-loaded asset shared by core and a tool belongs in a shared location,
and leaving it under `callout/` makes the callout tool look like the owner of data it
no longer solely owns. They move to `src/components/utils/emoji/`.

Moving with them: `scripts/build-emoji-locale-data.mjs` (its `ROOT`-relative
output path is hard-coded to the callout directory) and
`test/unit/scripts/build-emoji-locale-data.test.ts`. The callout tool keeps its
picker UI and imports the data from the new location. `src/tools/callout/index.ts`
is the only outside importer today.

## Config surface

A new top-level key, default on:

```ts
inlineEmoji?: boolean;
```

Per the four-edit law for a new `BlokConfig` key, it must be declared in:

1. `types/configs/blok-config.d.ts`
2. `packages/react/src/config-keys.ts`
3. `packages/vue/src/config-keys.ts`
4. a prop declaration in `packages/vue/src/BlokEditor.ts`

Missing any of the adapter edits fails `tsc` with a `Type 'true' is not assignable
to type 'never'` error from the exhaustiveness guard.

**Correction to an earlier assumption:** `emojiPicker` is a *callout tool* config
(`types/tools/callout.d.ts`), not a global key, so it cannot govern a core-level
inline trigger. The two are therefore independent. A host that supplies its own
callout picker and does not want the built-in inline menu turns it off with
`inlineEmoji: false`.

This is not a breaking change by the project's definition, but it is new
default-on behaviour that intercepts typing, so it is called out in the release
notes.

## i18n

New keys are needed for the menu's empty state and its accessible label. Adding
any key to `en.json` triggers the full seven-layer contract: all 69 locale files,
the ledger digests, cognate retentions, the lifecycle count pins, the
regenerated `types/message-keys.d.ts`, and the i18n test run. Bulk edits are
scripted, never hand-applied across the locale files.

## Testing

- Unit, pure: `resolveEmojiTriggerSpan` against the case table above, plus the
  ranking contract.
- Unit, DOM: opening, closing on each dismissal condition, commit by Enter and by
  closing colon, single-step undo, skin tone applied.
- Unit, config: `inlineEmoji: false` disables detection entirely.
- Architecture: a test pinning the emoji dataset's new location, so a later move
  back under a tool directory fails loudly. Do **not** write a blanket
  "core must not import from tools" test; it would fail on existing, intentional
  imports.
- E2E: type `:fi`, pick from the menu, assert the emoji is in the saved block
  data; type `10:30` and assert no menu; run it inside a table cell.

## Out of scope

Custom workspace emoji, emoji in code blocks, an emoji inline tool button, and
recent-emoji history.
