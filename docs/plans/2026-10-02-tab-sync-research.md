# Cross-tab sync (serverless) — research notes, 2026-10-02

Scope chosen by user: a new Blok option so editors on the SAME document in tabs of one browser converge live with NO server (plain `data` / `persistence`). Content + settings + UI state.

## Yjs core (evidence)
- Y.Doc always alive: YjsManager registered unconditionally `src/components/modules/index.ts:110`; `ydoc = new Y.Doc()` `yjs/document-store.ts:143`.
- Remote→DOM path NOT gated on collaboration: `yjsSync.subscribe()` unconditional `blockManager.ts:424`; any non-local origin maps to `'remote'` `yjs/block-observer.ts:148-155`; LOCAL_ORIGIN_TAGS `yjs/types.ts:73-80`.
- Correct seam: `YjsManager.applyRemoteUpdate` (flush buffer, echo registration, reconcileStructure) `yjs/index.ts:1224-1227`, `document-store.ts:2274-2297`. Outbound: `onDocUpdate` skips remote origins `document-store.ts:2303-2318`. Use ONE long-lived object origin (`collaboration/types.ts:128-131`).
- No public seam; ydoc is private, yjs bundled → never hand Y.Doc to host (`document-store.ts:2228-2230`).
- Undo tracks only `'local'` `undo-history.ts:390-392`; deleteFilter spares other clients' items `:426-440`.
- Seeding hazard: `fromJSON` runs as `'load'` (local origin → would broadcast), deletes keys missing from JSON `document-store.ts:216-254`; empty doc inserts random-id paragraph `renderer.ts:253`; JSON without ids gets fresh ids `renderer.ts:289-297` → duplicates. Collab avoids it by not seeding until first sync `core.ts:462-475`, `collaboration/index.ts:1461-1490`.
- onChange has no origin check `modificationsObserver.ts:255-264`; remote changes emit BlockChanged etc.; events carry no origin field. persistence → onSave `utils/persistence.ts:282, 629`; per-editor version `:291-294`; pendingSave → close prompt `modificationsObserver.ts:264`.
- Writes buffered 400ms `yjs/write-buffer.ts:21-34` → cross-tab typing latency. Drag writes dropped `blockManager.ts:2030`.

## Collab transport seam (evidence)
- `socketFactory` internal only `collaboration/index.ts:34-66`; not in types/.
- collaboration refused with persistence `core.ts:332-334`; requires `server` `core.ts:336-338`; `server` also installs uploader + unfurl `utils/server-config.ts:76-83`; boots read-only until first sync `collaboration/index.ts:434-438`.
- BC relay harness `test/playwright/tests/helpers/collab.ts`: v1 only (`save` unavailable forever, `index.ts:549-557`); fan-out wrong at 3+ tabs (premature markSynced `provider.ts:1163`); no trailing SyncStep1, no QueryAwareness, no 107; seeder self-answer → phantom paragraph (`index.ts:1456-1491`).
- operation-store BroadcastChannel = payload-free commit ping for shared outbox, not content `operation-store.ts:457-460, 733-736`.
- Own other tabs show as separate participants/carets (`presence.ts:242`, `participants.ts:100-101,136`).

## Settings / UI state (evidence)
- Observable: only `i18n:changed` `i18n.ts:343-346`. Theme mode page-global `themeManager.ts:112-126` (onThemeChange only on resolved change). Tokens page-global, no event. Width per-editor no event `ui.ts:480-488`. readOnly no event; a permission → never sync.
- UI state already in block data (syncs with content): toggle/toggle-heading `isOpen` (only dispatched when !readOnly `toggle/index.ts:350-352`), column `widthRatio`, table colWidths, image crop/markup, code language, database activeViewId.
- Unverified dispatch paths: table column-width resize, code `setLanguage` `code/index.ts:701-736`, database `switchView` `database/index.ts:618-649`.
- Real gap: column reset-to-even never deletes `widthRatio` in Yjs `columns-shared.ts:347-363`.
- Transient (never sync): selection, scroll, popovers, find, code view mode, mobile layout.
- localStorage prefs (no `storage` listener): `blok-recent-colors`, `blok-recent-links`, `blok:code:recent-languages`, `blok-emoji-skin-tone`, `blok:audio:*`, `blok:video:*`.

## Web platform (sources in agent report)
- BroadcastChannel: Safari 15.4+, all engines. Web Locks: Safari 15.4+. SharedWorker on Chrome Android only 148+ → avoid.
- Chrome 115+/Firefox partition BC + Web Locks in third-party iframes by top-level site. Safari unverified.
- bfcache/frozen tabs miss BC messages; no Yjs provider resyncs on pageshow → we must.
- y-websocket bc join: SyncStep1, SyncStep2(full), queryAwareness, awareness; every tab answers (N−1 diffs to all). `synced` never fires from bc alone.
- Measured: two docs seeded from same JSON with random clientIDs → duplicated blocks. Fix: one seeder (leader) or shared stored seed update.
- Measured: remote update applied with null origin lands on local undo stack → always apply with origin.
- tldraw: BC + IndexedDB, only document-scope user changes broadcast; session state (camera/selection/UI) per tab.
- Notion: SharedWorker + Web Locks to pick one writer tab (multiple writers corrupted data).

## Decisions (user-approved)
- New core module, ON BY DEFAULT (opt-out `tabSync: false`). Refused/no-op with `collaboration`.
- Join conflict: open tabs ALWAYS win (2026-10-03 revision; version comparison dropped).
- Identity: explicit `documentId` (host) wins. Else Blok mints `id` into saved `OutputData` (new top-level field; BREAKING for strict backend schemas — release note owed). Channel key = doc id + `location.pathname` (no query/hash/holder). Auto mode joins only versions that came via `persistence.load` or a save (raw `data` templates never auto-join). Empty docs never auto-join.
- Docs must say: app that copies stored docs or shows all docs at one path → pass `documentId` or strip `id` on copy.
- Blok has NO document-duplicate op (page block copies as link, `src/tools/page/index.ts:147-150`); copy risk is host-side.
- Saving: only leader calls persistence.save/onSave; onChange fires in all tabs with `origin: 'local' | 'tab'` (additive); passive tabs never show close prompt.
- Settings: sync locale, theme MODE (site-wide channel, not per doc), width (per doc key); live-reload localStorage prefs via `storage` event (recent colors/links/code langs, emoji skin tone, media volume/rate/loop). Never: tokens, readOnly, placeholder/toolbar/tools config, media playback position. Opt-out `tabSync: { settings: false }`.
- Toggle/toggle-heading open state: PERSONAL. Remove `isOpen` from saved output; default COLLAPSED; personal state in localStorage keyed by doc key + block id, live across this browser's tabs via `storage` event. User: no migrations, no BREAKING label ("behavior change we can afford"). Input `isOpen` ignored (old docs open collapsed). /view renders all collapsed. Keep `isOpen?` in public type as @deprecated/ignored so consumers' tsc does not break.
- UPDATE: user wants `isOpen` REMOVED from public types too (types/tools/toggle.d.ts, header). Told: consumers referencing it get tsc errors. User still says no BREAKING label. Part 1 (architecture) APPROVED.
- Part 2 (data flow: join handshake w/ write gate, leader-only save + version broadcast, handoff via lock + pagehide flush, wake resync, settings channel, personal toggle key blok:open:<docKey>:<blockId>) APPROVED.
- Part 3 (errors: no BC/locks → silent off; join timeout ~3s → stay separate, retry on visibilitychange; save errors leader-only; bad msg dropped; protocol version in envelope; read-only receive-only; destroy releases lock; multiple editors same key = participants) APPROVED.
