# Version history v2 — closing the Notion gaps

Date: 2026-10-08. Builds on `docs/plans/2026-10-07-version-history-design.md` (shipped f4518ac9) and the playground drawer (9b05443a). Gap list from a live look at Notion's version history (USER asked to cover all gaps, in Blok and in the playground).

None of the history routes have been released (last tag v1.16.1), so changing them is not BREAKING.

## Server (Blok)

### G1. Grouping choice
- `GET /sync/{doc}/history?group=<minutes>` with `group` ∈ {1, 15, 60}. Any other value → 400.
- With `group = W`: a new group starts when `t − prev > W` or `t − start ≥ W` (same clamping of negative gaps as today).
- Without `group`: today's rule (2 min idle, 10 min span). Unchanged JSON shape.
- `CollabVersionTimeline.Group` takes the two limits as parameters; the default stays.

### G2. Edits inside a version
- New route `GET /sync/{doc}/history/{lineage}/{sequence}/changes?since=<s>`: the record-level edits in `(since, sequence]` of that lineage. The client passes `since` (the previous version's sequence in the grouping it shows), because only the client knows which grouping it uses. Absent → `since = 0`. `since > sequence` or not a ulong → 400. Same gates, statuses, headers and `no-store` as the read route.
- Answer, oldest first:
  ```json
  { "changes": [ { "sequence": 12, "committedAt": 1760000000000, "actor": "playground-anna",
      "blocks": [ { "id": "b1", "type": "paragraph", "kind": "changed",
                    "before": { …block… }, "after": { …block… } } ],
      "page": ["title"] } ] }
  ```
  - `kind` ∈ `added` | `removed` | `changed` | `moved` (moved = different parent or different previous sibling; a block can only have one kind; `changed` wins over `moved`).
  - `before` is absent for `added`, `after` is absent for `removed`. Blocks are export-shaped (same as the read route).
  - `page` lists the keys of the `page` map (title, icon) and of the `values` map (prefixed `values.`) that changed in that record. Absent when none.
  - A record with no visible block or page change (e.g. a parked update) still appears with `blocks: []` so the client can say "Not visualizable".
- Computed by replaying once and exporting after each record in the range (reuse `CollabHistoryReplay` and the converter). Cap: at most 200 records per call; more → only the newest 200 and `"truncated": true`.

### G3. Restore covers page fields
- Restore also makes the live `page` map (built-in title and icon, `document-store.ts:166`) and the `values` map (`history.track`, `document-store.ts:161`) equal to the target point's: set every key whose value differs (deep copy), delete keys the target lacks. Same transaction as the block ops, so it is one journal record and one undo step for peers; it counts toward the size gate.
- Implemented at the Y level from the replayed target doc. Do NOT change `CollabDocConverter`/`YDocConverter` export or seed paths: another session is adding `title`/`icon` to OutputData there (`docs/plans/2026-10-08-page-title-design.md`). Restore must not depend on that work.
- An internal-only `CollabEditOp` kind (never parsed from the `/edit` wire) carries the map patch to `ApplyOpsAsync`, or the restore factory applies it directly inside the same transaction — implementer's choice, stated in the report.

## Client library (Blok)
- No new public API. The playground calls the routes directly, as a host would.

## Playground

### P1. Jump to the change (gap 5)
- Selecting a version scrolls the preview to its first marked block and outlines it briefly (1.2s, gray ink outline, no blue). Reduced motion: no smooth scroll.

### P2. Grouping control + bookmarks (gaps 1, 6)
- A "Group by" control at the top of the drawer: 1 minute, 15 minutes, 1 hour, Bookmarks; default 15 minutes. Gray-selected with a check (no blue). Choice remembered per browser (localStorage, try/catch).
- Each row gets a bookmark toggle (icon from `src/components/icons/index.ts`; grep first). Bookmarks are the HOST's records: the dev doc store (`scripts/dev-doc-store.mjs`, :4500) gains `GET/PUT /bookmarks/<doc>` storing `[{ lineage, sequence, savedAt }]` in its existing storage. Shared by every tab.
- "Bookmarks" grouping lists only bookmarked points (newest first), empty state "No bookmarked versions yet".

### P3. Restore dialog (gap 7)
- "Restore" opens a dialog (not the inline confirm): title "Restore <page> to <time>", sections:
  - What will be restored: "Page content — text, blocks, and everything nested in them, including database rows" and "Page title and icon".
  - Will remain unchanged: the sub-pages (page blocks) found in the version, listed by title, with the note "Sub-pages keep their own history."
  - Primary "Restore this version", secondary "Cancel", footnote "This will not delete any other versions and you can always restore again."
- Escape and Cancel close only the dialog.

### P4. Per-version edits (gap 2)
- Each row has a ">" "See all changes in version" button → the list switches to "← All versions" + that version's card + one entry per record from G2: "<name> edited <a paragraph | a heading | 3 blocks | the page title …>" and the time to the second. Clicking an entry marks only that record's blocks in the preview and scrolls to the first; an entry with no blocks shows a "Not visualizable" note over the preview.

### P5. Entry points + Updates feed (gaps 4, 8)
- Header: an "Edited <relative time>" link next to the History button (from the newest version's `savedAt`; hidden when history is unavailable). It opens an Updates panel in the same drawer (tabs: "History" | "Updates").
- Updates: newest first, one card per record across the newest 3 versions (via G2): avatar initial, "<name> edited <page title>", relative time, a clock button "View version for this update" (opens History on that version), and up to 4 changed blocks as inline text diffs (added words highlighted, removed words struck; plain text via `blocksToPlainText`), "View N more" when longer. Each block snippet scrolls the live editor to that block.
- The playground's page menu (if it has one; check `src/playground/page-tree.ts`) gets a "Version history" item. If none exists, skip and say so.

## Rules for every task
- TDD; scoped tests; scoped eslint; tsc once; comments short and only non-obvious constraints; no inline `<svg>` in src; no blue selected states; hints hover-only with delay; Airbnb-neutral playground look; no edits to vite/vitest/playwright/tsconfig/eslint configs or package.json.
- Another session is changing `index.html` and the page title. Keep `index.html` edits to wiring only; put logic in `src/playground/*.ts`.
- Docs: README "Version history" + protocol §12.4 + docs-site entry get G1, G2, G3 (done after the code lands).
