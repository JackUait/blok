# Tab sync — design

Date: 2026-10-03. Status: approved in brainstorming, awaiting spec review.
Research evidence (file:line, sources): `docs/plans/2026-10-02-tab-sync-research.md`.

## Goal

When the same document is open in several tabs of one browser, every change in one tab appears in the others. No server. Works for plain `data` and `persistence` setups. On by default.

Synced: document content, a small set of editor settings, and the personal open/closed state of toggles.
Never synced: selection, caret, scroll, open popovers, find-in-page, code view mode, mobile layout, media playback position, read-only state, host config (tokens, placeholder, toolbar, tools).

## Public surface

```ts
interface BlokConfig {
  /** The host's id for this document. Unique across the whole origin. Fixed for the editor's life. */
  documentId?: string;
  /** On by default. `false` turns all tab sync off. */
  tabSync?: boolean | { settings?: boolean };
}

interface OutputData {
  /** Minted by Blok on first save when absent. Identifies the document for tab sync. */
  id?: string;
  version?: string;
  time?: number;
  blocks: OutputBlockData[];
}
```

- `onChange` events gain `origin: 'local' | 'tab'` (additive).
- Toggle and toggle-heading: `isOpen` is removed from saved output AND from the public type `ToggleData` (`types/tools/toggle.d.ts:14`; the header's toggleable `isOpen` has no published type). User decision: no migration, no BREAKING label. Consumers that reference `isOpen` get a `tsc` error; old documents open with toggles collapsed.
- With `collaboration` set, tab sync stays off (the server already syncs tabs). `documentId` is still accepted.
- Framework adapters (React, Vue, Angular) pass `documentId` and `tabSync` through like any config key (`packages/*/src/config-keys.ts`). A changed `documentId` recreates the editor; hosts remount with `key`.

## Document identity

1. `documentId` from the host wins.
2. Else `id` from the loaded `OutputData`. Blok mints a UUID into saved output when the document has none.
3. Else no sync.

Channel key = document id + `location.pathname` (no query, no hash, no holder id). The path keeps a copy that carries the same `id` but lives at another path from merging with the original.

Auto mode (no `documentId`) joins only when:
- the document is not empty, and
- the document came through `persistence.load` or a save (raw `data` such as templates never auto-joins).

Documented limits: an app that copies stored documents AND opens every document at one path must pass `documentId` or strip `id` on copy. The same document at two different paths does not sync (safe).

## Components

A new core module `TabSync`, one per editor. It is constructed always and decides at ready whether to activate.

1. **Identity** — resolves the key as above.
2. **Channel** — `BroadcastChannel` named from the key. Envelope: `{ protocol, key, from, to?, kind, payload }`. `to` set = point-to-point; unset = fan-out. Messages with another protocol version or key are dropped.
3. **Leader** — `navigator.locks.request(<key>)`. Only a tab that has finished joining may queue for the lock, so a successor always holds the full document. The leader answers joins and is the only tab that calls `persistence.save` / `onSave`.
4. **Join gate** — a joining tab renders what it loaded but writes nothing to Yjs (no `fromJSON` broadcast, no default empty paragraph, `renderer.ts:253`) until the leader answers. Reuses the "do not seed until first sync" pattern collaboration uses (`core.ts:462-475`).
5. **Yjs bridge** — inbound via `YjsManager.applyRemoteUpdate` with one long-lived object origin (never raw `Y.applyUpdate`: it skips the buffer flush, echo suppression and structural repair). Outbound from `onDocUpdate`, which already skips remote origins. Undo tracks only `'local'` (`undo-history.ts:390-392`), so tab edits stay off the local undo stack.
6. **Events** — `onChange` carries `origin`. A `'tab'` change never sets the pending-save flag that drives the close prompt (`modificationsObserver.ts:264`).
7. **Wake** — on `pageshow` (persisted) and `visibilitychange` → visible, the tab re-runs the join handshake. bfcache'd and frozen tabs miss channel messages.
8. **Settings channel** — one site-wide channel (not per document) for locale (`i18n.update`) and theme mode (`theme.set`, mode not resolved value); width (`width.set`) travels on the document channel. Applied through the public API with echo suppression. `storage` event listener re-reads Blok's localStorage prefs live: `blok-recent-colors`, `blok-recent-links`, `blok:code:recent-languages`, `blok-emoji-skin-tone`, `blok:audio:volume|rate|loop`, `blok:video:volume|rate|loop` (never `*:pos:*`). `tabSync: { settings: false }` turns this part off.
9. **Personal toggle state** — click writes `localStorage['blok:open:<docKey>:<blockId>']` and nothing to the document. No entry = collapsed. Other tabs follow through the `storage` event. Applies to toggle and toggleable heading. Old entries expire by age. No localStorage → in-memory per tab.

## Data flow

**Join (tab B):**
1. B loads, resolves the key, opens the channel, writes stay off.
2. B sends `join { stateVector, persistenceVersion }`.
3. Leader A exists:
   - waits until its own `persistence.load` finished;
   - B's version newer than A's → A answers `replace`; B's document becomes the live one in every tab;
   - otherwise A answers to B only with the missing update (SyncStep2), then asks B for what A lacks (SyncStep1 back).
4. No leader → B takes the lock and is the only tab allowed to seed content.
5. Writes turn on; B may now queue for the lock.

Newer-version comparison uses the `persistence` version/ETag. Without a version, open tabs win.

**Edit:** local Yjs write → `onDocUpdate` → fan-out. Receivers apply with origin `tab`, emit `onChange { origin: 'tab' }`. The leader saves every change (local or tab) and broadcasts the new version so a successor saves with the right `If-Match`.

**Hand-off:** leader closes → lock released → next synced tab takes it. The leader flushes unsaved edits on `pagehide`; a successor that holds edits newer than the last saved version saves them itself.

## Errors and edge cases

- No `BroadcastChannel` or Web Locks → sync off silently (one `debug` log).
- Join timeout (about 3 s; tune by measurement) → the tab stays separate, writes on, retries on next `visibilitychange`. Never seeds by force.
- Save errors: existing retry + `persistence.onError`, leader only. Passive tabs never save, so own tabs never race ETags.
- Malformed / foreign-key / other-protocol message → dropped. A Yjs update that fails to apply → the tab leaves sync with one `warn`, keeps its data, retries on wake.
- Different Blok versions across a deploy → protocol mismatch → tabs stay separate.
- Read-only tab → receives and applies, never sends, never leads, never saves.
- `destroy()` → closes the channel, releases the lock; a leader flushes first.
- Several editors on one page with one key → each is its own participant.
- Third-party iframes: Chrome 115+ and Firefox partition BroadcastChannel and Web Locks by top-level site → no sync (documented).
- Typing reaches other tabs with up to ~400 ms delay (existing write buffer, `yjs/write-buffer.ts:21-34`).

## Testing

TDD: every item below is written first and watched failing.

Unit (vitest):
- identity: `documentId` beats `id`; key uses pathname only; empty doc and raw-`data` doc never auto-join; `id` minted into `save()` output.
- protocol: write gate during join; answer addressed to the asker only; newer version wins; join timeout → separate; foreign protocol dropped.
- leader: only the leader saves; version broadcast; successor saves unsaved edits.
- Yjs bridge: a tab edit is not undone by local undo (through the public undo API); `onChange` gets `origin: 'tab'`; no close prompt from tab edits.
- settings: locale, theme mode, width applied without echo; `storage` re-read for each listed key.
- toggles: `isOpen` absent from `save()`; inbound `isOpen` ignored; no entry → collapsed; `storage` event toggles open state.

E2E (Playwright, 2 and 3 pages in one browser context, real BroadcastChannel + Web Locks, no server):
- an edit in A shows in B and C;
- three tabs produce no duplicate blocks;
- closing the leader keeps saving from another tab;
- a tab back from bfcache catches up;
- a toggle collapsed in A collapses in B;
- a locale change in A changes B.

Pre-existing gaps to verify (test first, fix if red):
1. Table column-width resize, code `setLanguage`, database `switchView` — confirm each reaches Yjs.
2. Column reset-to-even leaves a stale `widthRatio` in Yjs (`columns-shared.ts:347-363`) — regression test, then fix.
3. Edits made during a pointer drag are dropped from Yjs (`blockManager.ts:2030`) — confirm the other tab sees the drop result.

## Documentation

- `documentId`, `tabSync`, `OutputData.id`, `onChange` `origin` in `types/configs/blok-config.d.ts` and related types.
- Docs site page: where to get `documentId` (route param, the id inside `persistence` URLs, record key, fixed name, `crypto.randomUUID()` for new docs), what syncs and what never does, the limits above.
- Release notes: default-on tab sync; `isOpen` removed and toggles default collapsed; `OutputData.id` added to saved JSON.

## Out of scope

- Presence (carets / avatars of your own other tabs).
- Cross-browser or cross-device sync (that is `collaboration`).
- Durable local storage of document content (that is `collaboration.offline`).
