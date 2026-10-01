# 4 — Workspace features without a workspace store

Date: 2026-10-01. Read-only research. Nothing was built or changed in the repo.

Question: under model B (one document per page, stored by the consumer), how much of Notion's workspace layer can Blok supply without hosting anything?

Evidence labels: a `file:line` was read in this session. **[unverified]** means not checked. **[proposal]** is a design suggestion, not a finding. Notion facts cite `docs/plans/2026-10-01-page-block-research/1-notion-ux.md` (written `N:<line>`).

Web lookups for Notion search failed in this session (404 on `notion.com/help/search-with-notion`, then a rate limit). So every claim below about Notion's search is **[unverified]**.

---

## 0. The short answer

- **(a) Derive the index as data passes through: yes.** Do it as a pure function in `@bloklabs/core/view`, not as a field in the save payload. One function runs in the browser, in a Node endpoint, and in the C# server's Jint runtime. That covers both save paths, and the server stores nothing.
- **(b) Headless UI: mostly no new components.** Blok should render only what lives inside the editor: the page picker in the link field, `@` mentions, the link-to-page block, and the Move to picker. Backlinks, breadcrumbs, the trash list and quick-find are page chrome, so the host draws them. Blok gives them data functions, not widgets. This keeps the adapters out of it.
- **(c) Presets: yes, but as a SQL recipe plus a thin client.** There is no runtime. It covers persistence mode fully. In collab mode it needs a consumer-run endpoint (an Edge Function), because the C# server PUTs to an HTTP endpoint.

---

## 1. What can be derived today

### 1.1 Existing extractors (all DOM-free, all in `@bloklabs/core/view`)

| Function | What it gives | Evidence |
|---|---|---|
| `blocksToPlainText(data, { includeHiddenText })` | Plain text of the whole doc. `includeHiddenText` is "Made for a search index" (adds URLs, alt, file names). | `types/view.d.ts:186-222`, `:204` |
| `extractTexts(data)` | Every prose string in document order. URLs and file names are skipped. It does not give block ids. | `types/view.d.ts:225-246`, `src/view/document-texts.ts:26-52` |
| `outlineFromOutputData(data)` | Headings as `{id, level, text}`. | `types/view.d.ts:329-353` |
| `blocksToMarkdown(data)` | Markdown. **Takes no options**, so links cannot be rewritten. | `types/view.d.ts:298-300` |
| `restoreHeadingAnchors` internals | **The precedent for link extraction.** `collectFromValue` walks every string in a block's `data`, parses it with parse5 and collects `<a href="#…">`. It has no per-type field registry. | `src/view/restore-heading-anchors.ts:103-138, 172-192` |

No extractor returns outgoing links, page references or mentions today. A grep for `outgoingLinks|extractLinks|collectLinks|linkTargets|extractUrls` across `src` and the server found only the private `collectLinks` in `restore-heading-anchors.ts:125`.

### 1.2 What the server sees and sends

- The C# server runs the same JS through a Jint runtime. The operations are `markdownToBlocks`, `htmlToBlocks`, `blocksToHtml`, `blocksToMarkdown`, `blocksToPlainText`, `blocksToPlainTextWithReport`, `inspect`, `version`, `schema`, `extractTexts` and `injectTexts` (`src/view/server-runtime.ts:211-297`). The .NET surface is `IBlokDocumentConverter` (`packages/server/dotnet/Blok.Server/Documents/IBlokDocumentConverter.cs:112-351`).
- The collab room does **not** use the converter. A grep for `IBlokDocumentConverter|BlokRuntime` in `Blok.Server/Collab/*.cs` found nothing.
- The PUT to the consumer is **bare OutputData** in the body. The only metadata is three headers: `Blok-Doc-Version`, `Blok-Doc-Lineage` and `Blok-Doc-Sequence` (`DocEndpointClient.cs:150-178`; wire doc at `:68-76`).
- `DocProjection(Lineage, ServerSequence)` (`DocEndpointClient.cs:39`) names the committed point, so the consumer can refuse a stale write. It is built at `CollabRoom.cs:2583`. It carries no content metadata.
- The server's routes are `/health`, `/unfurl`, `/upload`, `/delete`, `/upload-by-url`, `/sync/{doc}`, `/sync/{doc}/reset` and `/sync/{doc}/edit` (`Blok.Server.AspNetCore/BlokServerEndpointRouteBuilderExtensions.cs:53-105`). There is no document route, which is the ownership line holding.
- Client persistence: `save(data: OutputData, ctx: SaveContext)`, where `SaveContext` is only `{ version }` (`types/configs/blok-config.d.ts:27-35, 708-718`). In collab mode the client does not save. The server PUTs.

### 1.3 Proposed `PageIndex` **[proposal]**

```ts
interface PageIndex {
  /** From OutputData.page if D2 adds it; otherwise null and the host supplies it. */
  page: { id: string; title: string; icon?: PageIcon } | null;
  /** OWNING pointers: `page` blocks in this doc. These are the parent→child edges of the page tree. */
  subPages: Array<{ pageId: string; blockId: string }>;
  /** NON-owning references: link-to-page blocks, inline page mentions, block links. */
  links: Array<{ pageId: string; blockId?: string; kind: 'block' | 'mention' | 'link'; fromBlockId: string }>;
  /** Per-block text, for search hits that jump to a block (#blockId). */
  blocks: Array<{ id: string; type: string; text: string }>;
  /** Whole-page text = blocksToPlainText(data, { includeHiddenText: true }). */
  text: string;
}
declare function pageIndex(data: OutputData | LooseOutputData | null | undefined): PageIndex;
```

Design points:

- **No `parentPageId`.** A page's own document does not know its parent: `OutputData` is `{version?, time?, blocks}` (`types/data-formats/output-data.d.ts:109-124`). The parent's document does know its children, through its `page` blocks. So the index reports `subPages` edges, and the host derives each child's parent from them. This also exposes the alias hazard in the main doc §6.4: two documents that claim the same `pageId` show up as a conflict the host can see.
- **`subPages` and `links` stay separate.** Notion treats link-to-page differently from a mention: link-to-page "will show up in your sidebar ... just like any other sub-page", while a mention will not (N:50-51). A host that wants Notion's sidebar unions `subPages` with `links` where `kind: 'block'`.
- **Inline references need an id in the saved HTML.** Today the link inline tool keeps only `href`, `target` and `rel` on `<a>` (`src/components/inline-tools/inline-tool-link.ts:116-124`). An href alone cannot be resolved back to a `pageId` on the server, because no host callback can cross into Jint. Lean: `<a data-blok-page="p1" data-blok-block="b9" href="…">`. The attribute must then be whitelisted in the link tool's `sanitize`, the paste structural attributes and the `/view` schema, in the same change. CLAUDE.md "Paste attribute law" requires this.
- **Walk strings, not fields.** Reuse the `collectFromValue` pattern (`restore-heading-anchors.ts:172-192`), so table cells and new tools are covered without a field registry.

### 1.4 Where to compute it

| Where | Covers | Trust | Verdict |
|---|---|---|---|
| Pure `pageIndex()` in `/view`, called by the consumer's save endpoint (Node), or through `IBlokDocumentConverter.GetPageIndexAsync` (.NET, via a new `invoke('pageIndex')` case next to `server-runtime.ts:289`) | both persistence and collab, because both end at the consumer's endpoint | the consumer's server computes it, so a client cannot forge backlinks | **Lean** |
| Blok adds `ctx.index` to `persistence.save` | persistence mode only. In collab mode no client saves. | client-computed, so it can be forged | an optional convenience at most |
| The server attaches the index to its PUT | collab only | trusted | **No.** The body is bare OutputData (`DocEndpointClient.cs:158-162`). An envelope would break every existing endpoint. A header cannot hold page text. It would also put Jint on the room's save path. |

How the consumer stores it: one row per page.

```
page_index(page_id pk, title, icon jsonb, text, blocks jsonb, updated_at)
page_edge(source_page, target_page, kind, from_block, target_block)  -- 'sub' | 'block' | 'mention' | 'link'
```

Two tables, not one: backlinks are a reverse lookup on edges, and a jsonb array cannot be indexed for that efficiently. **[proposal; Postgres indexing claims are general knowledge, not measured here]** Both are rewritten in the same transaction as the document.

---

## 2. Feature by feature

Columns: **Notion** · **mechanism** (host callback, plus what Blok renders) · **principle check** · **cost** · **residual difference**.

The base contract from the main doc is `pages { href, open?, resolve?, create?, insert? }`. Every new member below is **[proposal]**.

### 2.1 Search across pages
- **Notion:** quick-find and its filters are **[unverified]**. The research report has no search section. It covers only search inside Trash (N:151).
- **Mechanism:** `pages.search?(query, { limit, signal }) → Promise<PageHit[]>`, where `PageHit = PageInfo & { pageId; blockId?; snippet? }`. Blok uses it only inside the editor: the link field, `@`, Move to and the link-to-page picker. The workspace quick-find (Cmd+K) is app chrome and the host draws it. Blok supplies `pageIndex().text` / `blocks` for the host's full-text index.
- **Principle check:** OK. The query runs against the consumer's store.
- **Cost:** the popover's search is **synchronous over a fixed item list**. `filterItems` scores `itemsDefault` with `scoreSearchMatch` (`src/components/utils/popover/popover-desktop.ts:2028-2066`). There is no async source, loading state or result replacement. A picker fed by `search` needs that new ability (debounce, abort, a "Searching…" row, i18n keys in every locale).
- **Residual:** ranking, typo tolerance, permission filtering and recency belong to the host. Quality depends on the host's database (Postgres FTS vs a search engine).

### 2.2 Backlinks
- **Notion:** created automatically on every @-mention and shown as "{#} backlinks" (N:57). They appear above the title on hover. Backlinks from private pages are labelled Private and cannot be opened (N:115). "Show backlinks" is a toggle in Customize page (N:109).
- **Mechanism:** the host queries `page_edge where target_page = $id`. Blok supplies the edges (§1.3). No Blok callback is needed, because the panel sits above the title, which is page chrome. An optional `pages.backlinks?(pageId)` makes sense only if Blok ever renders the panel. **Lean: don't.**
- **Principle check:** OK. The edges are consumer rows.
- **Cost:** only `pageIndex()`.
- **Residual:** the host must filter by the reader's access to the source page (Notion's Private label, N:115). Freshness lags until the source page's next save. Edges are only as good as the attribute in §1.3, so a mention typed as a bare URL is not a backlink.

### 2.3 Link-to-page block
- **Notion:** inserted with `/link`. It is a separate block holding `{page_id}` (N:50, N:55) and appears in the sidebar like a sub-page (N:50-51).
- **Mechanism:** a separate tool type, e.g. `page-link { pageId, title?, icon? }`, kept apart from the owning `page` block so delete and duplicate never act on the target page. The picker uses `pages.search`. The card uses `resolve` for a fresh title and `open`/`href` on click. `/view` emits a link card.
- **Principle check:** OK. It is a block (law: everything is a block). Properties live in `data`.
- **Cost:** new tool, toolbox entry (with `preview` and caption key), `types/tools/page-link.d.ts`, a `/view` emitter, and a Notion paste mapping. Today `link_to_page` is dropped (`src/components/modules/paste/notion-blocks-v3.ts:366`).
- **Residual:** whether it appears in a sidebar is the host's choice (the `kind: 'block'` edge lets it copy Notion). The cached title is stale in published output unless the host refreshes it.

### 2.4 @page mention (inline)
- **Notion:** `@`, `[[` and `+` open a dropdown. `[[` shows link options first, `+` shows create options first (N:32-37). The link renames itself when the page is renamed (N:52). It is stored as a rich-text `mention {page:{id}}`, and it shows "Untitled" without access (N:56).
- **Mechanism:** an inline element `<a data-blok-page="id" href="{pages.href(id)}">Title</a>`. A trigger on `@`/`[[` opens a picker fed by `pages.search`. `+ Add new sub-page` calls `pages.create`. On render, `resolve(id)` refreshes the label. Clicks route through `pages.open`. This needs the core hook in `UI.redactorClicked`, because today a plain click calls `openTab` (`src/components/modules/ui.ts:1444-1461`, report 6 §1).
- **What exists:** `src/tools/link/mention/mention.ts:55-79` builds a **URL** mention chip (favicon and title, `target=_blank`). It is used by the link paste menu. It is a visual precedent, not a page mention. No `@` or `[[` trigger exists anywhere: a grep for `'@'` key handling found none. The only character trigger is `/`, hard-wired in `src/components/modules/blockEvents/index.ts:255`. So the trigger is new core infrastructure, not a reuse.
- **Principle check:** OK. It is inline data inside a block, like a link (not a block, since it is part of the text).
- **Cost:** the largest item. Trigger infrastructure, a new inline type, a sanitize whitelist plus a paste-law test, the derived-mark DOM rules, a `/view` `inlineRenderers` path (`types/view.d.ts:39-56`), and the Notion paste mapping (today `<a href="notion.so/…">`, report 6 §7).
- **Residual:** the label is a stored copy. Live in the editor through `resolve`. Stale in `/view` output unless the host passes a title map. Notion has no copy at all (N:52).

### 2.5 Trash and restore
- **Notion:** a deleted page goes to Trash for 30 days. Trash can be searched and filtered by Last edited by, In and Teamspace. Restore and Delete forever exist. A trashed page cannot be edited. There is no "empty all" (N:149-154). Deleting a page deletes its sub-pages (N:148). A page block can be deleted with Backspace (N:146). The API flag is `in_trash` (N:156).
- **Mechanism, lean: index-driven, with no new callback.** Deleting a page block removes the pointer only (main doc §6.3). On the next save, that `subPages` edge is gone. The host sees a page with no owning edge, marks it trashed after a grace period, and cascades down the `sub` edges. Undo puts the pointer back, the next save re-adds the edge, and the host restores the page. An alternative is an explicit `pages.trash?(pageId)` / `pages.restore?(pageId)` that Blok calls on delete and undo. That is more immediate, but undo then has to call out to the network. Blok renders no trash list.
- **Principle check:** OK. Retention and purge are consumer jobs.
- **Cost:** none in Blok for the lean route. Documentation and a preset SQL view only.
- **Residual:** not instant. The edge disappears only on save: the persistence debounce in persistence mode, the server's PUT cadence in collab mode. Purge, the trash UI and the 30-day timer belong to the host. A page orphaned by a concurrent edit could be trashed by mistake, so a grace period is required. The main doc's warning against auto-deleting dangling pointers (§6.4) applies the other way round here.

### 2.6 Move to
- **Notion:** `/moveto` or ⋮⋮ → "Moves the block to another page" (N:140). Sub-pages travel with a page (N:140, stated only for moves between workspaces).
- **Mechanism:** the picker uses `pages.search`, then `pages.insert(target, blocks)` (already in the main contract), confirm, then delete from the source. For a page block, only the pointer moves: insert the pointer into the target document. The edge change then reparents the page in the host's tree.
- **What exists:** block settings have Duplicate, Delete and Copy link (`types/message-keys.d.ts:59-64`). There is no Move to.
- **Principle check:** OK.
- **Cost:** a block-settings item, the async picker (§2.1) and i18n.
- **Residual:** not atomic. A failure leaves a duplicate. Typing in the moved block during the move is lost (main doc §6.4, D5).

### 2.7 Duplicate with sub-pages
- **Notion:** Duplicate is Cmd/Ctrl+D (N:141). A deep copy of sub-pages is documented only for public pages (N:142). In-workspace deep duplicate is **[unverified]** (N:143).
- **Mechanism:** `pages.duplicate?(pageId) → Promise<{ id }>` is called when a page block is duplicated. The host walks the `sub` edges, loads each document, mints new ids and saves the copies. Blok could ship a pure `remapDocumentIds(data, idMap)`. A private version already exists (`src/components/modules/paste/handlers/blok-data-handler.ts:411-424`). Without `duplicate`, Duplicate of a page block falls back to D6 (paste becomes a link-to-page).
- **Principle check:** OK. Copying is done by the host on its own records.
- **Cost:** one callback and one optional pure helper.
- **Residual:** not atomic across documents, so a partial copy is possible. Cost grows with the size of the tree.

### 2.8 Export with sub-pages
- **Notion:** Markdown/HTML export, with "include sub-pages" and nested folders (N:200-204). The link format inside the parent file is **[unverified]** (N:205).
- **Mechanism:** the host recurses over `sub` edges, loads each document and calls `blocksToMarkdown`/`blocksToHtml`. Blok needs a `page` and `page-link` emitter, plus a way to rewrite their href to a relative file path. `blocksToHtml` has `transformUrl` and `renderers` (`types/view.d.ts:83-168`). **`blocksToMarkdown` takes no options** (`:298-300`), so it needs an additive options argument. An optional pure `exportPageTree(rootId, load, opts) → Array<{ path, content }>` would make this a one-liner without Blok storing anything.
- **Principle check:** OK. `load` is the host's.
- **Cost:** emitters (already owed for the page tool), a markdown options argument, and the C# converter mirroring it.
- **Residual:** zipping, CSV for databases and permission filtering belong to the host.

### 2.9 Links to a block on another page
- **Notion:** every block has a copyable anchor link (N:80). The fragment format is **[unverified]** (N:81).
- **What exists:** Copy link builds `location.href` without the hash, plus `#blockId` (`src/components/block-tunes/block-tune-copy-link.ts:81-82`). Hash-to-block scrolling is always on (`types/configs/blok-config.d.ts:1224-1229`, read at `src/blok.ts:518`). So `pages.href(pageId) + '#' + blockId` already lands, as long as the host's route mounts the target editor with that hash.
- **Gaps:**
  - Copy link uses `window.location`, not `pages.href(currentPageId)`. That is wrong in a peek or an embedded editor.
  - The link field offers headings from **this** document only: `readHeadings()` walks this editor's blocks (`inline-tool-link.ts:941-952`) and applies `#blockId` (`:993`).
- **Mechanism:** the `pages.search` hits carry `blockId` (backed by `pageIndex().blocks`). The link field adds a "Pages" section next to Recent and Headings. The label already reads "Page or URL" (`inline-tool-link.ts:272`, `src/components/i18n/locales/en.json:316`). The saved anchor carries `data-blok-page` and `data-blok-block` (§1.3), so it is a backlink edge too.
- **Principle check:** OK.
- **Cost:** a new section in the link field, plus an editor-level "which page am I" input (see §5). Today Blok does not know its own page id.
- **Residual:** a block moved to another page breaks the link until the host rewrites edges. Notion's behaviour here is **[unverified]**.

### 2.10 Breadcrumbs (bonus, a dependency of several features above)
- **Notion:** breadcrumbs at the top of the page, plus a `/bread` block (N:114). Cmd+Shift+U goes up a level (N:75).
- **Mechanism:** the host computes ancestors from the `sub` edges and draws the top-of-page bar. A `/bread` block would need `pages.ancestors?(pageId)`. **Defer.**
- **Residual:** none worth noting while the bar is host chrome.

---

## 3. Existing UI to reuse

| Piece | State | Reuse for |
|---|---|---|
| Popover + `SearchInput` + `scoreSearchMatch` | Sync filter over fixed items (`popover-desktop.ts:2028-2066`). The `searchable` flag is public on popover params (`types/utils/popover/popover.d.ts:82`). | Visuals and keyboard handling for every picker. **Needs an async item source.** |
| Link inline tool | Sections for Recent (localStorage `blok-recent-links`, `link-history.ts:5, 80-98`), Headings (`readHeadings`, `:941`) and Kinds (`:786-790`). No host "suggest" contract: `link` config holds only `target`, `rel`, `transformHref`, `transform` and `unfurl` (`types/configs/blok-config.d.ts:944-1012`). | Add a "Pages" section fed by `pages.search`. This is the cheapest page picker, because the field and its keyboard handling already exist. |
| URL mention chip | `src/tools/link/mention/mention.ts:55-79`. URL only, `_blank`. | Visual precedent for a page mention. |
| Toolbox | `/` trigger hard-wired (`blockEvents/index.ts:255`). | `/page`, `/link-to-page`. Every entry needs a preview and a caption key. |
| Block settings | Duplicate, Delete, Copy link exist (`types/message-keys.d.ts:59-64`). | Move to, and Duplicate routed to `pages.duplicate`. |
| `DatabaseAdapter` | An async CRUD contract (`types/tools/database.d.ts:96-164`). | Shape precedent for host query callbacks. `resolveUser` (`blok-config.d.ts:1287`) is the sync-or-async resolver precedent. |

---

## 4. Presets: a pages recipe for Supabase **[proposal]**

Same rules as today's presets: zero runtime dependencies, the vendor client passed in (`packages/presets/package.json` has no `dependencies`; `src/supabase.ts:4-15` declares a structural `SupabaseLike`). The README already documents policies in prose (`packages/presets/README.md:36`).

**SQL the consumer runs** (shipped as a `.sql` snippet in the docs or README, not executed by Blok):

```sql
create table blok_pages (
  id uuid primary key, owner uuid not null default auth.uid(),
  doc jsonb, version bigint not null default 0,
  title text, icon jsonb, search tsvector, trashed_at timestamptz, updated_at timestamptz default now());
create table blok_page_edges (
  source uuid references blok_pages on delete cascade, target uuid, kind text,
  from_block text, target_block text);
create index on blok_page_edges (target);
create index on blok_pages using gin (search);
create table blok_page_members (page uuid references blok_pages, member uuid, role text,
  primary key (page, member));

alter table blok_pages enable row level security;
create policy read on blok_pages for select using (
  owner = auth.uid() or exists (select 1 from blok_page_members m where m.page = id and m.member = auth.uid()));
create policy write on blok_pages for update using (
  owner = auth.uid() or exists (select 1 from blok_page_members m where m.page = id and m.member = auth.uid() and m.role in ('edit','full')));
-- edges: readable only when the reader can read the SOURCE page (backlink privacy, N:115)
alter table blok_page_edges enable row level security;
create policy read on blok_page_edges for select using (exists (select 1 from blok_pages p where p.id = source));

-- One transaction: document, version check, index, edges.
create function blok_save_page(p_id uuid, p_doc jsonb, p_expected bigint, p_index jsonb) returns bigint ...
```

**Client side:** `supabasePages(client, { table })` returns `{ persistence: { load, save }, pages: { href?, resolve, search, create, insert, duplicate } }`.
- `save` calls `pageIndex(data)` and `client.rpc('blok_save_page', …)`. The index is computed on the client, so the backlinks are forgeable by that user. That is acceptable only because RLS already lets the user write the document itself.
- `search` uses `textSearch` / a `rpc`.
- Supabase API names (`rpc`, `textSearch`) are general knowledge, **[unverified in this session]**.

**Limits:**
- Collab mode needs `--doc-endpoint` pointed at a consumer-run HTTP endpoint (a Supabase Edge Function). It does `GET`/`PUT {endpoint}/{docId}` (`DocEndpointClient.cs:68-76`) and recomputes `pageIndex` there, which is also the trusted route. The preset can ship that function's source as a recipe, but Blok does not run it.
- Per-page sharing in collab also needs the server's per-doc ticket check (main doc §4) wired to the same `blok_page_members` table. That wiring is the consumer's.
- A preset that imports `pageIndex` from `@bloklabs/core/view` breaks "zero runtime deps". Either `pageIndex` is passed in as a function (the `SupabaseLike` pattern), or the preset takes a type-only peer. The second was skipped on purpose before (memory: presets-package-shipped).

---

## 5. Permanent public surface and adapter cost

Once released, these become permanent:

1. `pageIndex` and the `PageIndex` shape in `types/view.d.ts`. The field names and the edge `kind` values become a contract with consumers' database schemas, so changing them is BREAKING for stored rows. They are mirrored in `server-runtime.ts` `invoke` and in `IBlokDocumentConverter` (C# conformance).
2. Inline attributes `data-blok-page` / `data-blok-block`. Saved HTML and a data attribute (run `generate-data-attributes-dts.mjs`). This is the hardest to change, because it lives inside consumers' stored text.
3. New `pages` members: `search`, `duplicate` and maybe `trash`/`restore`. The hit type `PageHit`.
4. Tool type `page-link` and its `data`. The inline mention element.
5. An editor-level "current page id" input, needed by mention `create` (parent), Copy link (`pages.href(self)`) and self-exclusion in pickers. Either `pages.current` or D2's `OutputData.page.id`. **This depends on D2.**
6. Markdown options argument, and the emitters' HTML output (consumers style it).

**Adapter cost:**
- New members nested under `pages` do **not** add `BlokConfig` keys, so the React/Vue exhaustive guards (`packages/react/src/config-keys.ts:68-69`, `packages/vue/src/config-keys.ts:78-79`) fire once, for `pages` itself, which the main doc already counts.
- Vue: `pages` must be a prop, not an emit, because its members return values (report 6 §4).
- Angular: only through `config` unless a discrete `@Input()` is added (no exhaustive guard).
- `pageIndex` is a pure function, so it has no adapter cost.
- **Headless components** (`<Backlinks>`, `<PagePicker>`, `<TrashList>`) would cost 3× plus parity laws (`useblocks-scope-parity-law`, `child-decoration-parity-law`, report 6 §4). React alone has `BlokView` today, which is already a parity gap. **Recommend shipping none.** Data functions plus in-editor pickers only.

---

## 6. Summary table

| Feature | Notion | Blok mechanism | Blok renders | Cost | Residual |
|---|---|---|---|---|---|
| Search | [unverified] | `pages.search` + `pageIndex().text/blocks` | pickers only | async popover source | host owns ranking and Cmd+K |
| Backlinks | N:57, 115 | `sub`/`mention` edges from `pageIndex` | nothing | `pageIndex` only | lag to next save; host filters privacy |
| Link-to-page | N:50-55 | `page-link` tool + search/resolve | card | new tool + view + paste | cached title in `/view` |
| @mention | N:32-37, 52, 56 | `data-blok-page` anchor + `@`/`[[` trigger | chip + picker | **largest**: trigger infra, sanitize, paste law | label is a copy |
| Trash | N:146-156 | edge disappearance (lean) or `trash`/`restore` | nothing | ~0 | not instant; host purge and grace |
| Move to | N:140 | search + `insert` | picker | settings item | non-atomic (D5) |
| Duplicate deep | N:141-143 | `pages.duplicate` + `remapDocumentIds` | nothing | small | non-atomic, host recursion |
| Export tree | N:200-205 | emitters + markdown options + `exportPageTree` | nothing | small–medium | zip/CSV are the host's |
| Block links | N:80-81 | existing `#blockId` + search hits with `blockId` | link-field section | small + current-page id | moved block breaks link |

Nothing here needs Blok to host a store, and nothing needs a server route. The server's only possible role is `IBlokDocumentConverter.GetPageIndexAsync`, a pure conversion the consumer calls. That fits "owns what passes through".
