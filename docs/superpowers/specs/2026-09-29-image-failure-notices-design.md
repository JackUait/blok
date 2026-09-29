# Image failure notices — design

Status: approved in chat 2026-09-29. Awaiting written-spec review.

## Goal

Tell the user when an image fails, in two ways:

1. A toast as soon as an image fails, with **Retry** and **Show** buttons.
2. A notice when the user saves or leaves while images are still failed. The host gets an event it can act on.

## Two kinds of failure (verified in code)

| Kind | When | Saved data today |
|---|---|---|
| `upload` | An upload of a picked file or pasted link fails (`applyError`, `src/tools/image/index.ts`). | The failed source is rolled back. A new block with an empty `url` fails `validate()` and is dropped from `save()`. **Lost.** |
| `load` | A saved `url` will not load after `reloadAttempts` (default 5) automatic reloads (`applyBrokenImage`). | `url` is saved unchanged. **Saved, but broken for readers.** |

This design does **not** change saved data for either kind.

## User-facing behaviour

### On failure — toast

- `upload`: the toast shows right away.
- `load`: the toast shows only after the automatic reloads run out. Images that recover on their own never toast.
- Text: "Image failed to upload" / "Image failed to load". Several failures show as one toast: "Images failed to load: {count}". (Blok i18n has no plural forms; the "Label: {count}" pattern matches existing strings.)
- Buttons:
  - **Retry** retries every failure in the toast.
  - **Show** calls `scrollToBlock` on the first failure (scroll + highlight).
- Failures that arrive within ~300 ms join one toast. If a failure toast is already open, it is updated instead of adding a second one.
- A toast with buttons does not auto-dismiss. The "×" closes it.
- Shown in read-only mode too.

### On save — toast

- After a real save, if failures remain, show one toast: "Won't be saved: {n} · Won't display: {m}" (omit a zero part). Same Retry / Show buttons.
- The save is not blocked.
- Each failure is reported once per reason. It is reported again only if it recovers and then fails again. This stops autosave from toasting every few seconds.
- Not shown in read-only mode.

### On leave

- **In-app navigation:** `blok.confirmLeave(): Promise<boolean>`. The host's router guard calls it.
  - No failures, or read-only → resolves `true` at once, no UI.
  - Otherwise show a banner pinned to the top of the viewport with the same counts and four buttons:
    - **Retry** keeps the banner open, and the counts update as images recover. When none are left, it resolves `true`.
    - **Show** resolves `false` and scrolls to the first failure.
    - **Stay** resolves `false`.
    - **Leave anyway** resolves `true`.
  - `role="alertdialog"`, focus on the first button, Escape = Stay.
  - A second `confirmLeave()` while the banner is open returns the same promise.
- **Tab close / reload:** browsers allow only their own fixed dialog. It is shown only while `upload` failures exist, because only those are unsaved. A `load` failure is saved, so asking "leave without saving?" would be false.
- Links inside the article are not intercepted.

### Host event

New config callback:

```ts
onImageFailure?(report: ImageFailureReport): boolean | void;

interface ImageFailureReport {
  reason: 'fail' | 'save' | 'leave';
  failures: ImageFailure[];
}

interface ImageFailure {
  blockId: string;
  tool: string;          // 'image' for now
  kind: 'upload' | 'load';
  url?: string;
  retry(): void;
  scrollTo(): void;
}
```

- It fires before Blok shows its own UI for that reason.
- Returning `false` stops Blok's own toast or banner. For `leave`, `confirmLeave()` then resolves `true`, and the host guard decides.
- A throw is caught and logged. Blok's UI is then shown as usual.
- `'fail'` lets hosts with a custom `notifier` (which will ignore `actions`) build their own Retry / Show toast.
- `'leave'` fires only from `confirmLeave()`. `beforeunload` cannot run host UI and does not fire it.

## Architecture

### 1. Tool → core: `api.media` (new tool API)

```ts
api.media.reportFailure({ blockId, tool, kind, url, retry }): void
api.media.clearFailure(blockId): void
```

- Chosen over watching `data-state="error"` (fragile DOM coupling) and `api.events` (cannot carry `retry` cleanly).
- Lets custom tools and video join later.
- Only the image tool is wired now.

### 2. Core module `MediaFailures` (`src/components/modules/mediaFailures.ts`)

- Registry: `blockId → { tool, kind, url, retry, reported: Set<reason> }`. Reporting the same block again replaces the entry and resets `reported`.
- Clears an entry itself when its block is removed. It does not trust the tool to call `clearFailure`.
- Coalesces failure toasts (~300 ms window, updates an open toast).
- Report-once per (block, reason).
- Registers an unsaved-work source through the existing `registerUnsavedWork` (`src/components/utils/persistence.ts`) while `upload` failures exist and the editor is not read-only. The existing `syncUnloadGuard` attaches or detaches `beforeunload`. There is no second listener.
- Owns `confirmLeave()` and the banner.
- Releases everything on editor destroy.

### 3. Notifier buttons

- `NotifierOptions` (alert type) gets `actions?: { label: string; onClick(): void }[]`.
- Drawn in `src/components/utils/notifier/draw.ts`.
- A toast with actions does not auto-dismiss.
- The notifier needs a way to update or close an open toast, so the failure toast can be updated. If the built-in notifier cannot do that, `MediaFailures` closes the old toast and opens a new one.

### 4. Banner

A small UI piece next to the notifier, with the behaviour above. Localised strings. `data-blok-testid` on the banner and its buttons.

### 5. Saver

- After an actual save completes, the Saver calls `MediaFailures.onSave()`.
- Callers that join an in-flight save do not trigger it again.
- Saved output is unchanged.

### 6. Image tool (`src/tools/image/index.ts`)

- Report in `applyError`: `kind: 'upload'`, `retry` = `retryLastSource`.
- Report in `applyBrokenImage`: `kind: 'load'`, `retry` = `retryBrokenImage`.
- Clear when:
  - the image renders successfully
  - the image is replaced
  - the error is dismissed (`onUploadError` returned `false`)
  - `removed()` / destroy runs

## Public surface

All additive. Every file under `types/` is hand-written with no `src/` imports (`published-types-no-src-refs` test).

- `types/api/media.d.ts` (new) + a `media` field on the tool API type.
- `types/configs/blok-config.d.ts`: `onImageFailure`, `ImageFailureReport`, `ImageFailure`.
- `types/configs/notifier.d.ts`: `actions`.
- The Blok class and its public type: `confirmLeave()`.
- The React, Vue and Angular adapters: `confirmLeave` (the adapter parity guard requires all three).

**Behaviour change:** existing consumers will see a toast when an image fails, where today they see nothing. The opt-out is `onImageFailure: () => false`. It ships as a feature, not labelled BREAKING (approved).

## Strings

Every locale, through the `blok-translations` skill. Keys cover:

- the single-failure titles (upload / load)
- the multi-failure titles with `{count}`
- the save summary parts with `{count}`
- the buttons: Retry, Show, Stay, Leave anyway
- the banner title

## Testing (TDD — each test written first and seen failing)

- **Unit, `MediaFailures`:**
  - coalescing
  - report-once and reset after recovery
  - auto-clear on block removal
  - unsaved-work source on/off for `upload` only, and off in read-only
  - `confirmLeave` resolution per button, plus the no-failure, read-only and callback-`false` paths
  - a callback throw still shows Blok UI
- **Unit, notifier:** actions render and fire; a toast with actions does not auto-dismiss.
- **Unit, Saver:** `onSave` fires once per real save, not for joined in-flight callers.
- **Unit, image tool:** report and clear at each point in §6.
- **E2E** (roles or `data-blok-testid`, no class selectors):
  - A broken URL toasts after the reloads run out.
  - Show scrolls to the block.
  - Retry recovers the image once the URL is served.
  - Saving with a failed upload shows the save toast.
  - `confirmLeave` shows the banner, and each button resolves correctly.

## Out of scope

- Video, audio and file tools (the report shape supports them later).
- Intercepting link clicks in the article.
- Exit-intent detection.
- Changing saved data for failed images.
