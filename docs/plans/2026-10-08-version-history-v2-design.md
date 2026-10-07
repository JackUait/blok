# Version history v2 — closing the Notion gaps

Date: 2026-10-08. Builds on `docs/plans/2026-10-07-version-history-design.md` (shipped f4518ac9) and the playground drawer (9b05443a). Gap list from a live look at Notion's version history (USER asked to cover all gaps, in Blok and in the playground).

None of the history routes have been released (last tag v1.16.1), so changing them is not BREAKING.

## Server (Blok)

### G1. Grouping choice
- `GET /sync/{doc}/history?group=<minutes>` with `group` ∈ {1, 15, 60}. Any other value → 400.
- With `group = W`: a new group starts when `t − prev > W` or `t − start ≥ W` (same clamping of negative gaps as today).
- Without `group`: today's rule (2 min idle, 10 min span). Unchanged JSON shape.
- `CollabVersionTimeline.Group` takes the two limits as parameters with today's values as defaults.
- Parse `group` like `PointAsync` parses sequence (`NumberStyles.None`, exactly one value; repeated, empty or leading-sign values → 400). README and protocol §12.4 currently say the list "never answers 400": update both.

### G2. Edits inside a version
- New route `GET /sync/{doc}/history/{lineage}/{sequence}/changes?since=<s>`: the record-level edits in `(since, sequence]` of that lineage. The client passes `since` (the previous version's sequence in the grouping it shows), because only the client knows which grouping it uses. Absent → `since = 0`. `since > sequence` or not a ulong → 400. Same gates, statuses, headers and `no-store` as the read route.
- Answer, oldest first:
  ```json
  { "changes": [ { "sequence": 12, "committedAt": 1760000000000, "actor": "playground-anna",
      "blocks": [ { "id": "b1", "type": "paragraph", "kind": "changed",
                    "before": { …block… }, "after": { …block… } } ],
      "page": ["title"] } ] }
  ```
  - `kind` ∈ `added` | `removed` | `changed` | `moved`. Moved = different parent, or not in the kept order of its parent's children (`CollabLongestKeptOrder.Of`, as `CollabRestorePlanner.KeptInPlace` does) — never "different previous sibling", which flags every block after an insert. `changed` (type, data or tunes differ, canonical JSON) wins over `moved`.
  - `before` is absent for `added`, `after` is absent for `removed`. Blocks are export-shaped (same as the read route).
  - `page` lists the keys of the `page` map (title, icon) and of the `values` map (prefixed `values.`) that changed in that record. Absent when none.
  - A record with no visible block or page change (e.g. a parked update) still appears with `blocks: []` so the client can say "Not visualizable".
- `since` = the previous row's sequence when it is in the same lineage, else 0. `sequence == 0` → `{ "changes": [] }`.
- Computed by replaying once from the baseline: extend `CollabHistoryReplay` with a stepping API (e.g. `StepAsync` yielding `(record, doc)` after each record) and export after every record in `(since, sequence]`. Use the sync `YDocConverter.Export(..., out slots)` per record and resolve rich-text slots only for blocks that changed (format-1 lineages run every HTML slot through the JS runtime). Keep the header bound check the read route has. Cap: at most 200 records per call; more → the newest 200 and `"truncated": true`. The replay from the baseline is not shortened by the cap.
- Do NOT modify `CollabRoomManager.ReadPointAsync` (G3 owns it); add a separate method.

### G3. Restore covers page fields
- Restore also makes the live `page` map (built-in title and icon, `document-store.ts:166`) and the `values` map (`history.track`, `document-store.ts:161`) equal to the target point's: set every key whose value differs (deep copy), delete keys the target lacks. Same transaction as the block ops, so it is one journal record; it counts toward the size gate. (Peers cannot undo it: their undo only tracks local edits.)
- Implemented at the Y level from the replayed target doc. Do NOT change `CollabDocConverter`/`YDocConverter` export or seed paths: another session is adding `title`/`icon` to OutputData there (`docs/plans/2026-10-08-page-title-design.md`). Restore must not depend on that work.
- The patch is a new internal-only op, `CollabEditOp.PatchMaps` (never parsed from the `/edit` wire), planned by `EditPlanner.PlanOne` and applied by its own `EditStep` (which needs access to the `page` and `values` maps, unlike today's `Apply(transaction, blockMap, rootOrder)`). It must NOT be written from the restore factory: the factory only reads, the size gate measures `ApplyOpsAsync` on a scratch copy, and the room requires exactly one local update.
- Values are plain JSON on the client (`page-fields.ts` `map.set`, `yjs/index.ts` `setValue`), so copy C# Any values (`AnyObject`, `AnyArray`, primitives). A key whose target value is a nested Y type or `YUndefined` is left as it is on the live doc; the report says how often that can happen.
- `ReadPointAsync` is refactored as needed so restore gets the replayed `YDoc` (G3 owns that method).

## Client library (Blok)
- No new public API. The playground calls the routes directly, as a host would.

## Playground

### P1. Jump to the change (gap 5)
- Selecting a version scrolls the preview to its first marked block and outlines it briefly (1.2s, gray ink outline, no blue). Reduced motion: no smooth scroll.

### P2. Grouping control + bookmarks (gaps 1, 6)
- A "Group by" control at the top of the drawer: 1 minute, 15 minutes, 1 hour, Bookmarks; default 15 minutes. Gray-selected with a check (no blue). Choice remembered per browser (localStorage, try/catch).
- Each row gets a bookmark toggle (`IconBookmark`, `src/components/icons/index.ts:491`). Bookmarks are the HOST's records: the dev page host (`scripts/dev-page-host.mjs`, already CORS-enabled, reachable via `VITE_BLOK_PAGE_HOST_URL`) gains `GET/PUT /bookmarks/<doc>` storing `[{ lineage, sequence, savedAt }]` in memory like its other data. Shared by every tab.
- A row shows a filled bookmark when its point `(lineage, sequence)` is bookmarked. Groupings do not nest, so a bookmark made in one grouping may not be a row in another; it always shows in Bookmarks.
- "Bookmarks" grouping lists only bookmarked points (newest first), empty state "No bookmarked versions yet". Rows show the time; there is no author line. "Show changes" there compares with the point just before it (`sequence − 1`, same lineage; none for 0).

### P3. Restore dialog (gap 7)
- "Restore" opens a dialog (not the inline confirm): title "Restore <page> to <time>", sections:
  - What will be restored: "Page content — text, blocks, and everything nested in them, including database rows" and "Page title and icon".
  - Will remain unchanged: the sub-pages (page blocks) found in the version, listed by title (page blocks store only `pageId`; titles come from the playground's own page records, as the page tree gets them), with the note "Sub-pages keep their own history." Omit the section when there are none.
  - Primary "Restore this version", secondary "Cancel", footnote "This will not delete any other versions and you can always restore again."
- Escape and Cancel close only the dialog: the dialog handles Escape before the drawer's window-capture handler (`history-drawer.ts:765-779`). Update the tests that pin today's inline confirm text.

### P1b. Moved blocks
- `ChangeMark` gains `moved`, painted as a dashed gray left bar (changed stays solid).

### P4. Per-version edits (gap 2)
- Each row has a ">" "See all changes in version" button → the list switches to "← All versions" + that version's card + one entry per record from G2: "<name> edited <a paragraph | a heading | 3 blocks | the page title …>" and the time to the second. Clicking an entry marks only that record's blocks in the preview and scrolls to the first; an entry with no blocks shows a "Not visualizable" note over the preview.

### P5. Entry points + Updates feed (gaps 4, 8)
- Header: an "Edited <relative time>" link next to the History button (from the newest version's `savedAt`; hidden when history is unavailable). It opens an Updates panel in the same drawer (tabs: "History" | "Updates").
- Updates: newest first, one card per record across the newest 3 versions (via G2): avatar initial, "<name> edited <page title>", relative time, a "View version for this update" button (reuse `IconRotateLeft`, the History icon — no new icon) (opens History on that version), and up to 4 changed blocks as inline text diffs (added words highlighted, removed words struck; plain text via `blocksToPlainText`), "View N more" when longer. Each block snippet scrolls the live editor to that block.
- The playground has no per-page menu (`page-tree.ts` has tab/close/toggle buttons only), so there is no "Version history" menu item; the History button and the "Edited …" link are the entry points.

## Rules for every task
- TDD; scoped tests; scoped eslint; tsc once; comments short and only non-obvious constraints; no inline `<svg>` in src; no blue selected states; hints hover-only with delay; Airbnb-neutral playground look; no edits to vite/vitest/playwright/tsconfig/eslint configs or package.json.
- Another session is changing `index.html` and the page title. Keep `index.html` edits to wiring only; put logic in `src/playground/*.ts`.
- Docs: README "Version history" + protocol §12.4 + docs-site entry get G1, G2, G3 (done after the code lands). They say "four routes" today (`blok-sync-v2.md:826,933`, README:340); the `HistoryRoutes` array and `MapShell` switch (`BlokServerEndpointRouteBuilderExtensions.cs:14-20,161-164`) need the fifth route.
