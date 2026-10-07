# Built-in page title — design

Status: draft for review (2026-10-08).

## Goal

Blok gets a built-in title and icon for the open page, so apps stop hand-building them.
Today the playground builds both itself (`src/playground/page-host.ts`, `index.html`).
The built-in version must:

- let the app place the title anywhere, for example above its own metadata strip and separate from the content;
- follow the editor's narrow/wide width mode and shrink on narrow containers;
- wrap to as many lines as the text needs;
- keep the playground's emoji icon behaviour;
- keep the playground's keyboard, undo and collaboration behaviour.

## Decisions

| Question | Decision | Who |
|---|---|---|
| Is the title a block? | No. It is a property of the page (architectural law, rule 4). The body is the page's children. | design |
| Who owns the value? | Blok. It lives in the document. Apps read it through `onChange` and `title.get()`. | USER |
| Is the icon undoable? | Yes. The playground moves onto the built-in title, so it gets icon undo too. | USER |
| Line limit? | None. The title wraps as long as the text is. No clamp, no ellipsis. | USER |
| Emoji | Same as the playground icon (see "Icon"). | USER |
| Default placement | Above the first block, inside the editor. | design |

## Data model

- Title and icon live in a new Yjs map, `page`, with keys `title` (string) and `icon` (`PageIcon | null`). It is added to the undo scope the same way the `values` map of `history.track` is (`document-store.ts:160`), so undo, redo and collaborative sync work the same.
- Not inside `values`: `history.track` shipped in v1.16.1, so any key there could already be a host's. A separate map cannot collide.
- **Unlike other tracked values, these are saved.** `history.track` values are left out of `save()` output, and the collab server loses them on a rebuild (`types/api/history.d.ts:40`). The title must not be lost, so:
  - `OutputData` gains optional `title?: string` and `icon?: PageIcon`;
  - `blok.render(data)` / the initial `data` config reads them;
  - both server converters carry them between the record and the Yjs doc. Today they read `blocks` only (`Collab/CollabDocConverter.cs:39`, `Collab/YDocConverter.cs:77`). The JS runtime (`Generated/blok-server-runtime.js`) and the C# converter both need it.
- Empty title is saved as an absent field, not `""`.
- `PageIcon` is the existing type from `types/tools/page.d.ts`. The picker offers emoji only. `{ type: 'image' }` is accepted on input and rendered, but there is no UI to pick one.

## Config

```ts
new Blok({
  title: true,                         // off by default; true = built-in defaults
  title: {
    holder: '#page-title',             // element or selector; omitted = above the first block
    placeholder: 'New page',           // default comes from i18n
    icon: true,                        // false hides the icon and "Add icon"
    onChange: (title: string) => {},   // every change: typing, paste, undo, redo, peer
    onIconChange: (icon: PageIcon | null) => {},
  },
});
```

- `onChange` fires for every source, and the payload says which: `onChange(title, { source: 'user' | 'undo' | 'redo' | 'remote' | 'api' })`. The app saves on `user`/`undo`/`redo` and may skip `remote` (the peer already saved it).
- `onChange` is how the app keeps its page records in sync, so the parent page's link block (`PageConfig.resolve`) shows the same title.

## Instance API

```ts
blok.title.get(): string
blok.title.set(text: string): void           // one undo step
blok.title.focus(position?: 'start' | 'end'): void
blok.title.mount(holder: HTMLElement | string): void   // move it after boot
blok.title.icon.get(): PageIcon | null
blok.title.icon.set(icon: PageIcon | null): void      // one undo step
```

Exposed on the instance before `isReady` and buffered, the same as `width` and `placeholder` (`src/blok.ts:362`).

## Placement

- No `holder`: Blok renders the header (icon row + title) inside the editor wrapper, before the first block.
- With `holder`: Blok renders the header into the app's element, outside the editor wrapper. Anything the app puts between that element and the editor (the metadata strip in the reference screenshot) is the app's own. Blok does not know it exists.
- `mount()` moves the same element, so focus, caret and the picker survive.
- The icon always renders inside the title's holder, above the text. They move together.
- Keyboard movement uses Blok's state, not DOM position, so it works across any gap:
  - Enter in the title: split at the caret. The text after the caret becomes a new first block.
  - ArrowDown on the last line of the title: first block's first line, at the same x.
  - ArrowUp on the first line of the first block: title's last line, at the same x.
  - Backspace at the start of the first block: join its text into the title and remove the block. Not when the block has children or isn't plain text (same rule as `page-host.ts:526`).

## Width and responsiveness

- The header root carries `data-blok-width` and the content-column rule `max-width: var(--blok-content-max-width, var(--max-width-content))`, centered the same way as the editor content. Its text's left edge lines up with the blocks' text in both modes.
- `width.set()` / `width.toggle()` update the editor wrapper and the header together (`ui.ts:480`).
- For app sections between the title and the editor: Blok writes `--blok-content-inset` (the computed side gutter) on the header holder and keeps it current, so the app's strip lines up with CSS alone.
- For apps that need it in JS: `setting:changed` (`src/components/events/SettingChanged.ts`) already fires on `width.set`, but it is not in the published `BlokEditorEventMap` (`types/events/editor-events.ts:252`). Add it there. Additive, not breaking.
- Narrow containers: the header is a size container. Title font and icon size step down at fixed container-width tiers (for example 40px → 32px → 28px). Fixed tiers, no fluid `cqw` units (see the image-control-size-tiers note).
- Wrapping: `overflow-wrap: anywhere`, no clamp. Pasted newlines become spaces. The title is one text run that wraps, never paragraphs.

## Icon

Copied from the playground (`page-host.ts:780-840`, `playground.css:119-162`):

| State | Behaviour |
|---|---|
| No icon | "Add icon" button (smile icon + label) above the title. Hidden until the header is hovered or reached by keyboard. Always visible on `hover: none` devices. |
| Click "Add icon" | A random emoji is set at once, then the picker opens. |
| Icon set | Large emoji button above the title. Click opens the picker. |
| Picker | The existing `EmojiPicker`, `curated: false`, with Remove. |
| Read-only | Icon shown, not clickable. "Add icon" hidden. |

- The emoji grid is preloaded when the header renders without an icon, so the random pick resolves at once (as in the playground).
- Focus ring only after keyboard navigation (user rule: no ring on click).
- Random-pick tests must not assert `\p{Extended_Pictographic}`: flag emoji fail it (a flake already seen in the playground test).

## Undo, redo, collaboration

- Typing in the title is a typing run, like a block. Paste, Enter-split, Backspace-join, `set()` and icon changes are their own steps.
- Undo/redo of a title or icon step moves focus to the title. A peer's change never moves focus. The caret keeps its offset, clamped to the new text (`replaceTitleText`, `page-host.ts:610`).
- Known traps from `history.track` carry over: the first title keystroke can join the click's gesture; a step made outside the editor skips caret restore; specs wait 60ms between identical key presses.
- Concurrent typing in the title is last-writer-wins on the whole string, as the playground has it today. Character-level merge is out of scope.

## Other behaviour

- Read-only: not editable; `setReadOnly` toggles it in place.
- RTL: follows the editor's direction.
- i18n: new keys for the placeholder, "Add icon", "Change icon" and the title's aria-label. All locales (blok-translations skill).
- Accessibility: `role="textbox"`, `aria-label`, `aria-multiline="false"`. Rendered as `h1` text inside the header.
- Find (Cmd/Ctrl+F) searches the title.
- Markdown export: `# title` first line when a title is set. HTML/view export: an `h1`.
- `page` tool: no change. Link blocks keep reading from `PageConfig.resolve`.

## Framework adapters

New core surface ships in all three adapters (parity law):

- React: `<BlokTitle />`, mounted through the editor context; renders a host `div` and calls `title.mount()` on it.
- Vue and Angular: the matching component.
- `title` config keys go through each adapter's config forwarding.

## Playground

The playground drops its hand-built title and icon and uses `title: { holder }` instead. Breadcrumbs, Trash banner and the page morph view transitions stay playground code. They target Blok's title and icon through `data-blok-testid` hooks instead of `#pg-page-title` / `.pg-page-icon`.

## Breaking-change check

- Opt-in config, optional new `OutputData` fields: not breaking for current consumers.
- Old Blok versions reading new data ignore `title`/`icon`. Data is not lost on their side, but they will drop the fields on their next save. That goes in the release note.
- No collision with `history.track` keys: title and icon use their own `page` map (see "Data model").
- `BlokEditorEventMap` gains `'setting:changed'`: additive.

## Testing

- Unit: config parsing, API buffering before ready, save/load round trip, a host `track('title')` not touching the page title, width attribute and `--blok-content-inset` sync, onChange sources.
- Server: JS and C# converters round-trip `title` and `icon` (conformance tests on both sides).
- E2E:
  - title in an outside holder with a gap element, and keyboard moves across the gap;
  - narrow ↔ wide: title text left edge equals first block's text left edge in both modes;
  - container tiers: font size steps at narrow widths;
  - long title wraps to more than 2 lines with no clamp;
  - icon: Add icon → random emoji + picker, change, remove, read-only;
  - undo/redo of title typing and of icon change;
  - two-page collab: peer title and icon changes appear, focus does not move.
- Architecture law test: the header element never lives in the block tree (no block id, not in `save().blocks`).

## Out of scope

- Cover images.
- Image icons from a picker (type accepted, no UI).
- Character-level merge of concurrent title typing.
- Page properties (dates, status) above the body.
