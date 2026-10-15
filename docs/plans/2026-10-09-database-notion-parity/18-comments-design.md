# 18 — Built-in comments for databases: design (STOPPED for user decisions)

Audit row 15 (`15-parity-audit-2026-10-15.md:26`): no built-in composer or thread; cells open comments by right-click (plus the url/email/phone hover pill, 4b58a0a3); no entry from the row page, calendar or timeline.

Status: **design only, nothing built.** Storing threads in the document changes saved documents and reaches agent and export surfaces. The task's stop rule applies. Five decisions below need the user.

## 1. Evidence: what exists today

- **No comment model anywhere.** `grep -rniE "comment[-_ ]?thread|threadId|discussion" src types` finds only `src/tools/database/page-layout-builder.ts:126` ("Page discussions is skipped (plan §2.4)"). There is no inline-comment tool, no collab comment store, and no server converter. `11-builder-full-window-plan.md:87` notes it: "Skipped: Blok has no inline comments (§2.4)".
- **The host hook is the whole feature.** `types/tools/database.d.ts:1123-1142`: `DatabaseCommentTarget {databaseId,rowId,propertyId?}` and `DatabaseComments {open(target, anchor); count?(target); subscribe?(databaseId, onChange)}`. It carries **no thread data**. It only opens the host's UI and reads a count.
  - Wiring: `src/tools/database/index.ts:837-887` (`commentLever`, `commentBadgeLever`, `subscribeComments`).
  - Badge: `src/tools/database/database-comment-badge.ts` ("Open comments" + `IconMessage` + count, updated in place because the host anchors its popover to it).
  - Entries: the table right-click (`database-table-view.ts:1329-1337`), the cell pill (`:895-932`), the row ⋮⋮ menu (`database-table-menus.ts:378-406`), and the card/list right-click (`index.ts:5909-5917`).
- **Nothing here shipped.** `git show v1.16.1:types/tools/database.d.ts` has no `DatabaseComments` and no `DatabasePeople`. Changing either is ordinary work, not BREAKING (CLAUDE.md, "a surface that never shipped").
- **The author lever is optional.** `DatabasePeople.me?(): string` (`types/tools/database.d.ts:523-527`). Without a host there is no current user.
- **Row children are the page body.** 000e3710 (post-v1.16.1, already BREAKING) made row bodies the row's child blocks. `database-row` renders them all into one body slot (`src/tools/database-row/index.ts:97-131`). Every reader treats every row child as body:
  - HTML view: `src/view/emitters.ts:203` (`renderList(env.childrenOf(block.id))`). The C# server embeds `src/view` (memory: tabs-block-levers).
  - Unknown types in the view: `src/view/blocks-to-html.ts` emits the children, plus `<!-- blok:unknown type -->` when `onUnknownBlock === 'comment'`. An unknown thread block's replies would still render as body text.
  - Agents: `src/shared/agent/snapshot.ts:231` `childrenOf` returns the raw `content` list. `blok_read` would show threads as page content.
- **Hidden children have a cost.** The database block already keeps one kind of non-row child (layout `tabs`). It took about 300 lines: dedupe races between peers ("losers"/"winner", `index.ts:1800-1820`), foreign drafts, `transactWithoutCapture` (`index.ts:1583-1890`). The view had to filter it too (`emitters.ts:790`).
- **The undo escape hatch exists.** `api.blocks.transactWithoutCapture` (`types/api/blocks.d.ts:449`) writes with no undo entry.
- **How collab stores an id-bearing array.** `plainToYValue` turns an array of objects that each have an `id` into a keyed identity map (`src/components/modules/yjs/serializer.ts:895-921`, `plainToIdentityMap`). Two peers adding threads with different ids land as separate keys. Whether the diffing write path merges a concurrent *append* without overwriting it: **UNVERIFIED** (not tested here).

## 2. What Notion does (measured; the only spec)

All of the following is from research/12 §3 (lines 45-60), unless another line says otherwise.

- **Entry points.**
  - Board, gallery and list: "•••" or right-click opens a menu with **Comment ⌘⇧M** (L48-50). Blok already has this.
  - Table: a filled cell's hover toolbar has Autofill / **Comment** / Copy to Clipboard (L38, L51). Blok has this for url/email/phone only.
  - Table row context menu: **UNMEASURED** (L51).
  - Shortcut ⌘/Ctrl+⇧+M: research/06:103, 210.
  - Timeline right-click has no Comment (research/06:102, a [DOC] quote: "any database view except the timeline view"). Calendar: **UNMEASURED**.
- **Composer popover** (L52), anchored under the card.
  - Box: 470×44, white, radius 10px, shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`.
  - Contents: avatar, placeholder **"Add a comment…"**, then "Attach file", "Mention a person, page, or date", and "Send comment" (disabled while empty).
  - Enter sends. The popover then shows the thread (author, "Just now", text) above a new composer.
- **Badge** (L55-56). It shows in every view after the title: `commentFilledSmall` 16px glyph, count, 12px/400 rgb(44,44,43), no fill. It is a button labelled "Open comments", and a click opens the thread with a reply composer. Blok already has this. Badges after a delete: **UNMEASURED** (L64).
- **Row page** (L59-64).
  - A **"Comments"** label (13px/500 rgb(125,122,117)) sits under the properties, with an always-visible "Add a comment…" composer, even with zero comments.
  - Threads render inline above the composer (avatar, name, relative time, text).
  - The top bar gains a "Comments" button only when there is at least one comment. It opens a "Discussions" popover with "See all", which opens the "All discussions" sidebar.
  - Comment hover toolbar: **Add reaction, Resolve, More actions**. More actions: Mark as unread, **Edit**, Copy link, Mute replies, **Delete**. Delete confirms with "Delete this comment?" and Delete / Cancel.
- **Layout options.** "Page discussions" switch, default ON. It removes the module (research/09:129). Inline comments Default/Minimal (research/09:130-135) is for text comments, which Blok does not have.
  - In tabbed layout, Comments sits inside the first tab above the body (research/10:128).
  - The classic layout has a 1px divider under Comments (research/10:168).
  - With the property group in the panel, there is no "Comments" label (research/10:183).
- **Mentions and attachments** appear in the composer, but their behaviour is **UNMEASURED**. Reactions, unread and mute are **UNMEASURED** beyond their labels.
- Whether duplicating a row or applying a template copies comments: **UNMEASURED**.

## 3. Options for storage when no host is present

**A. Thread blocks as row children, plus a generic core lever.**
A `comment` block (data `{author, createdAt, text, resolved?}`); replies are its children. A new static, for example `static isAnnotation = true` ("not page content"), would be honoured by:

- the row body slot and placeholder
- the view emitters and plain text (`emitters.ts:203`, `blocks-to-plain-text.ts:246`)
- markdown and HTML export
- the agent snapshot (`src/shared/agent/snapshot.ts:231`)
- find, the TOC, `bodyBlocks`, duplicate-row and apply-template copy paths
- drag targets and keyboard navigation

This follows the block law literally. The cost is that **every** child walker must learn the lever. Old clients and the C# server render the replies as body text (see the unknown-type note above). It is a new block type in saved documents.

**B. One hidden `comments` container child per row, holding thread blocks.**
Fewer walkers need changing: skip one child type, like `tabs` at `emitters.ts:790`. But a per-row singleton needs the same create-race dedupe the layout tabs needed (`index.ts:1800-1820`). Old clients still render it.

**C. Threads in row data (`data.comments: [{id, …}]`).**
Old clients keep unknown row keys (`database-row/index.ts:17-25`), so nothing renders, exports or reaches agents by accident. The collab layer keys id-bearing arrays by id (§1); concurrent appends are UNVERIFIED. **Against it:** CLAUDE.md "Everything Is a Block": threads have ids, store data, and nest (replies). It is also the "internal data model that shadows the block tree" the law forbids.

**D. No in-document storage: Blok draws the measured UI, and the host stores threads.**
Extend `DatabaseComments` (unshipped, so not BREAKING) with optional `list(target)`, `add`, `reply`, `edit`, `resolve` and `remove`. With them, Blok draws the composer, thread, row-page section and hover toolbar. With only `open`, behaviour stays as today. This is additive and touches no saved shape. But it gives **no** comments when there is no host, so it does not meet "no host → built-in". It is a fallback, not a recommendation.

**Recommendation, if the user wants built-in storage in the document: A.** It is the only option that obeys the block law without a singleton race. Ship it behind the generic lever, with a law test that scans for child walkers, as `table-cell-content-law` does.

## 4. Rules that hold under any option

- **Host first.** If `config.comments.open` exists, every entry point calls the host, as today. The built-in UI runs only without it. `permissions.can('comment')` still gates both (`index.ts:841`).
- **Comments are not document undo.**
  - Writes go through `transactWithoutCapture`.
  - The composer is a keyboard owner, so it must `preventDefault` history keys or let native text undo work (memory: keyboard-owner-undo-passthrough, a field target is exempt).
- **Exports skip comments**: HTML view, markdown, plain text, CSV, and the C# server via `src/view`.
- **Escape closes one layer** (memory: escape-dismisses-one-layer-test-law). Resolve and selected states are gray, never blue (CLAUDE.md "No blue selected states"). Hover toolbar hints follow the hint-delay law.
- **Read-only.** You can read comments. Whether a read-only viewer may comment (Notion's "Can comment" access) is decided by `permissions.can('comment')`.

## 5. Decisions only the user can make

1. **Should comments live in the document at all?** Anyone with document access, an export, a copy-paste or the C# server would get them.
2. **Which option**: A (recommended for in-document), B, C, or D (host-only, no built-in fallback).
3. **Agent and MCP surfaces.** Under A or B, `blok_read` shows threads as content until `src/shared/agent/snapshot.ts` (and the `src/agent`/`src/mcp` describe surfaces this task may not touch) learn the lever. Who changes them, and should agents be able to read or write comments?
4. **Author when `people.me` is absent.** Use `collaboration.user` (types/configs/blok-config.d.ts:780-832), "Anonymous", or hide the built-in composer?
5. **Release note.** A new block type in saved documents is not BREAKING under CLAUDE.md, because the surface is new. But v1.16.1 clients and the C# server will show reply text inside row bodies (A/B). Does the user want that called out, or the feature held until the server learns to skip it?

## 6. Build plan once decided (Option A)

1. **Core lever.** Add the `static isAnnotation` lever plus `acceptsChildren`/`childTools` (only `comment` under a `comment`). Teach every child walker found by a law test. Mirror the change in `built-in-statics.ts` (memory: database-landing-gate fifth miss).
2. **The `comment` tool.** Not user-insertable. Data `{author, createdAt, text, editedAt?, resolved?}`; text is rich-text segments.
   - Repin the schema snapshot and the sha256 values in `media-blocks.test.ts` / `container-blocks.test.ts`.
   - Update the render-tools snapshot.
3. **Composer and thread popover** (measured box, §2), from the existing entry points when there is no host. Add ⌘⇧M.
4. **Row page "Comments" section** under the properties, with the Page discussions switch (default ON) in the layout builder.
5. **Built-in badges.** `count` comes from the thread blocks; refresh through the block-changed path.
6. **Hover toolbar** (Resolve, More actions: Edit, Delete with confirm). Reactions, unread, mute and mentions only after measuring.
7. **Remaining entry points.** All filled cells get the hover pill. The table row context menu waits on measuring. Calendar: measure first. Timeline: none (research/06:102).
8. **i18n.** About 12 keys × 69 locales, plus `message-keys.d.ts` and the ledger. Add lifecycle pins and agent-coverage rows.
