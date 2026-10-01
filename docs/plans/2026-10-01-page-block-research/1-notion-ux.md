# Notion page block — user-facing behavior (research for Blok)

Researched 2026-10-01. Sources were fetched from notion.com/help (all 467 help articles in the help sitemap were downloaded and searched), developers.notion.com, notion.com/releases, and Notion's engineering blog.

Evidence tiers, shown at the start of each bullet:
- **[doc]**: Notion states it directly. The quote or paraphrase is close to the source text.
- **[inferred]**: follows from Notion's data-model blog or API reference. Notion's UX docs do not state it.
- **[secondary]**: an official Notion account, seen only as a search snippet. The page itself was not fetched.
- **[unverified]**: not found in any Notion doc searched. Do not treat it as fact.

---

## 0. The model underneath (read first)

- [doc] "Everything you see in Notion is a block. Text, images, lists, a row in a database, even pages themselves—these are all blocks." — https://www.notion.com/blog/data-model-behind-notion
- [doc] Every block has `id` (UUID v4), `type`, `properties`, `content` (an ordered array of child block IDs, "downward pointers"), and `parent` (an "upward pointer"). "The parent block is only used for permissions." — https://www.notion.com/blog/data-model-behind-notion
- [doc] "The most common property is `title`, which stores the text content of block types like paragraphs, lists, and of course, the title of a page." — https://www.notion.com/blog/data-model-behind-notion
- [doc] "Page blocks display their content in a new page, instead of rendering it indented in the current page. To see this content, you would need to click into the new page." — https://www.notion.com/blog/data-model-behind-notion
- [doc] Turn into: "Changing the type of a block doesn't change the block's properties or content—it only changes the type attribute." A to-do's `checked` property is ignored as a heading and is still set when the block is turned back into a to-do. — https://www.notion.com/blog/data-model-behind-notion
- [doc] "You can see the ID of page blocks at the end of the URL in your browser." — https://www.notion.com/blog/data-model-behind-notion
- **Blok mapping:** `content` maps to Blok's `contentIds` and `parent` maps to `parentId`. A page is a block whose children render on their own screen, not indented in place. This matches Blok's "a page is a block with children" law. (judgment; see sources above)

---

## 1. Creating a page

- [doc] `/page` "creates a new page (and will open it automatically when you press `enter`)." — https://www.notion.com/help/keyboard-shortcuts
- [doc] Block menu: "Page: Adds a sub-page inside your page. You can put pages inside pages inside pages." The `+` in the left margin opens the same block menu as `/`. — https://www.notion.com/help/writing-and-editing-basics
- [doc] Create a subpage: open the parent page and use `/page`, or press `+` next to the parent in the sidebar. "When you return to the parent page, you'll see the subpage there." — https://www.notion.com/help/create-a-subpage
- [doc] Other ways to create a page: the 📝 button at the top of the sidebar, and `cmd/ctrl + N` on desktop. — https://www.notion.com/help/create-your-first-page
- [doc] The sidebar 📝 button "creates a new page in preview mode, letting you start a new page and then choose where to put it… If you don't choose, it will default to your Private section." — https://www.notion.com/help/navigate-with-the-sidebar
- [doc] `[[` and `+` while typing:
  - "Type `[[` and the name of the sub-page… select `+ Add new sub-page`."
  - "`↗ Add new page in...`" creates the page somewhere else.
  - Picking an existing page instead inserts a link to it.
  - "When you use `[[`, the dropdown menu will show page linking options first. When you use `+`, the dropdown menu will show page creation options first."
  - Source: https://www.notion.com/help/keyboard-shortcuts
- [doc] `@` + a new title can also create a page as you type, "nest that new page in the page where you are writing, or store it somewhere else." — https://www.notion.com/help/guides/how-to-create-new-pages-as-you-type
- [doc] `cmd/ctrl + option/shift + 9` "create[s] a new page, or turn[s] whatever you have on a line into a page." — https://www.notion.com/help/keyboard-shortcuts
- [doc] The ⋮⋮ menu has "Turn into: Transforms the block into another type of block… or into a page." — https://www.notion.com/help/writing-and-editing-basics
- [doc] "The Turn into page feature allows you to transform a block into a separate page and choose its location in your workspace. Multiple content blocks can be turned into pages." — https://www.notion.com/help/guides/transforming-content-blocks-in-notion
- [inferred] **Turn into → Page on a text block:** the block's text becomes the page title, and its children become the page body. Turn into changes only `type`. The text lives in `title`, which is also a page's title. Nested blocks live in `content`, which a page renders as its body. Same block ID, same children. — https://www.notion.com/blog/data-model-behind-notion
- [inferred] **Toggle → Page:** same reasoning. The toggle's summary text becomes the title, and its hidden children become the page body. — https://www.notion.com/blog/data-model-behind-notion
- [doc] Blocks dragged into a database become pages: "any other type of content you drag into a database (like bullets or to-do items), will automatically turn into pages." — https://www.notion.com/help/intro-to-databases
- [doc] Sidebar drag: "Nest pages by dragging one into another. You'll see the selected page highlight blue." — https://www.notion.com/help/navigate-with-the-sidebar
- [unverified] Dragging a block onto a sub-page block inside the editor (not the sidebar) to move it into that page. Not found in Notion docs. — unverified

## 2. Sub-page vs Link to page vs @mention

- [doc] **Link to page** is a block inserted with `/link` or `+` → `Link to page`. "When you add a Link to page block, the linked page will show up in your sidebar under the page where you inserted the link, just like any other sub-page." — https://www.notion.com/help/create-links-and-backlinks
- [doc] FAQ: "Link to page works kind of like creating a sub-page… it will show up in your sidebar as a subpage of the page where it was linked. @-mentioning a page creates something more like a hyperlink. Pages you @-mention won't show up as subpages of the pages they've been mentioned in." — https://www.notion.com/help/create-links-and-backlinks
- [doc] **@mention / `[[` / `+` link** is inline in a paragraph. "If you change the name of the page, this link will automatically change too." — https://www.notion.com/help/keyboard-shortcuts
- [doc] API data shapes:
  - A sub-page is a `child_page` block whose only field is `title` ("The plain text title of the page"). It is created through the Pages API with the parent page's ID in `parent`. — https://developers.notion.com/reference/block
  - `link_to_page` is a block holding `{ "type": "page_id", "page_id": … }` or a `database_id`. — https://developers.notion.com/docs/historical-changelog (Nov 17, 2021 entry)
  - A page mention is a rich-text `mention` of type `page` holding `{ id }`. Without access, its `plain_text` shows as `"Untitled"`. — https://developers.notion.com/reference/rich-text
- [doc] Backlinks "are created automatically every time you @-mention a page." They are shown as `{#} backlinks` under the title. — https://www.notion.com/help/create-links-and-backlinks
- [inferred] **The key data difference:**
  - A sub-page block IS the page. Its ID is the page ID, and its children are the page body.
  - A link_to_page block is a separate block that holds a pointer to another page.
  - A mention is an inline span holding a pointer.
  - Source: https://developers.notion.com/reference/block and https://www.notion.com/blog/data-model-behind-notion
- [unverified] Exact inline rendering of a sub-page block (icon + title on one line, underline, a link-arrow badge for Link to page). Not found in Notion docs. The help docs only say a page icon appears "at the top left of your page and in the sidebar next to it." — https://www.notion.com/help/customize-and-style-your-content — unverified

## 3. Opening a page

- [doc] Database views have an "Open pages in" setting with three options. "Side peek: Open pages on the right side of the database… Center peek: Open pages in a focused, center modal. Full page: Open pages as full pages directly." It is set via database settings → `Layout` → `Open pages in`. — https://www.notion.com/help/views-filters-and-sorts
- [doc] "Table, Board, List & Timeline layouts will open pages in side peek by default. Gallery & Calendar layouts will open pages in center peek by default." — https://www.notion.com/help/views-filters-and-sorts
- [doc] Release note: "Open any Notion page link (e.g. subpage, page mention) in side peek mode." — https://www.notion.com/releases/2023-04-27
- [secondary] NotionHQ on X: "Clicking a page without holding opt/alt will open it in full-page by default!" So opt/alt+click opens side peek. Seen as a search snippet only. — https://x.com/NotionHQ/status/1651271572911718406
- [doc] Other open shortcuts:
  - `cmd/ctrl + click` opens a link as a new tab (desktop).
  - `option + shift + click` opens a page as a new window.
  - `cmd/ctrl + [` / `]` go back and forward.
  - `cmd/ctrl + shift + U` goes "up one level in the page hierarchy".
  - `cmd/ctrl + L` copies the page URL.
  - In database peek, `ctrl+shift+K`/`J` (Mac) go to the previous/next page.
  - Source: https://www.notion.com/help/keyboard-shortcuts
- [doc] URL shape (API example): `https://app.notion.com/p/Avocado-d093f1d200464ce78b36e58a3f0d8043`. That is a title slug, a hyphen, and the 32-hex page ID without dashes. Published pages look like `https://jm-testing.notion.site/p1-6df2c07bfc6b4c46815ad205d132e22d`. — https://developers.notion.com/reference/page
- [doc] "Every block in Notion has its own anchor link that can be copied and shared." Use ⋮⋮ → `Copy link to block`. — https://www.notion.com/help/create-links-and-backlinks
- [unverified] The exact fragment format of a block link (e.g. `#<blockid>`). The docs only say it copies "the URL of that specific block." — unverified

## 4. The page itself

- [inferred] **Title = the block's text.** It is the same `title` property a paragraph uses. — https://www.notion.com/blog/data-model-behind-notion
- [doc] A non-database page has no other properties. "If `parent.type` is `"page_id"` or `"workspace"`, then the only valid key is `title`." Database pages carry the data source's schema. — https://developers.notion.com/reference/page
- [doc] To get properties on plain pages, you "turn any page with sub-pages into a database (wiki), allowing you to add properties to those pages." Use `•••` → `Turn into wiki`. — https://www.notion.com/help/guides/build-a-docs-first-culture-with-a-beautiful-team-wiki-powered-by-a-database and https://www.notion.com/help/wikis-and-verified-pages
- [doc] **Icon:**
  - "Hover over the top of any page and click `Add icon`."
  - Tabs are Emoji, Icon, and Upload (image or URL, ideally 280×280).
  - 🔀 picks a random emoji, and `Remove` clears the icon.
  - An uploaded icon can be added to the workspace emoji library.
  - The icon shows "at the top left of your page and in the sidebar next to it."
  - Source: https://www.notion.com/help/customize-and-style-your-content
- [doc] **Cover:**
  - `Add cover`, then on hover `Change cover`.
  - The picker offers a curated gallery, `Upload`, `Link`, and Unsplash.
  - "images at least 1,500 pixels wide"; the cover is "dynamic depending on the width of your window."
  - Source: https://www.notion.com/help/customize-and-style-your-content
- [unverified] Cover **Reposition** on pages. The help corpus mentions `Reposition` only for profile covers and gallery/board card images. — https://www.notion.com/help/people-profiles — unverified
- [doc] **Font:** `•••` → `Default`, `Serif`, or `Mono`. "All the text on your page will change accordingly." — https://www.notion.com/help/customize-and-style-your-content
- [doc] **Small text** and **Full width** are toggles in `•••`. Full width "shrink[s] the margins on any page and widen[s] your content area." Neither can be made a default. Neither is available on mobile. — https://www.notion.com/help/customize-and-style-your-content
- [doc] **Lock page:**
  - `•••` → `Lock page`. The page becomes "read-only for everyone", including you.
  - `Locked` appears next to the name in the top breadcrumb.
  - Unlock options are `Unlock for me` (later `Re-lock`) or `Unlock for everyone`.
  - Anyone with full or edit access can unlock.
  - Source: https://www.notion.com/help/collaborate-within-a-workspace
- [doc] **Customize page** (`•••` → `Customize page`) has toggles for `Show backlinks`, `Page discussions`, and `Table of contents`. — https://www.notion.com/help/customize-and-style-your-content and https://www.notion.com/help/columns-headings-and-dividers
- [doc] **Table of contents** appears in two forms:
  - A block (`/toc`). It is "a single unit that must be moved, deleted, duplicated, and styled as a unit." H2/H3 are indented, and indented headings are excluded.
  - A page-level floating ToC "in the right side of your Notion page by default if your page has two or more headings."
  - Source: https://www.notion.com/help/columns-headings-and-dividers
- [doc] **Breadcrumbs** appear "at the top of your page… what page you're in, and where that page lives." — https://www.notion.com/help/create-a-subpage. There is also a `/bread` block that "shows where your current page is in your workspace." — https://www.notion.com/help/keyboard-shortcuts
- [doc] **Backlinks** "automatically appear above the page title and show on hover." Backlinks to private pages are labeled Private, and you cannot open pages you lack access to. — https://www.notion.com/help/create-links-and-backlinks
- [doc] **Page comments:**
  - "Hover over the top of any page and click `Add comment`" to start a top-level discussion.
  - Resolve with ✔️, and reopen via 💬 → Resolved.
  - Inline comments use `cmd/ctrl+shift+M`.
  - Source: https://www.notion.com/help/comments-mentions-and-reminders
- [doc] **Version history:**
  - `•••` → `Version history`, which needs Can edit access.
  - A version is recorded every 10 minutes while you edit, and again 2 minutes after the last edit.
  - Retention is 7 days (Free), 30 days (Plus), 90 days (Business), and unlimited (Enterprise).
  - You can `Restore` the whole page or copy blocks out of an old version.
  - Source: https://www.notion.com/help/duplicate-delete-and-restore-content
- [doc] **Who last edited** shows at the bottom of the `•••` menu. Avatars of current viewers show at the top. — https://www.notion.com/help/sharing-and-permissions

## 5. Hierarchy UX

- [doc] **Sidebar sections:**
  - `Private`: "only visible to you".
  - `Shared`: pages shared with select people.
  - `Teamspaces`: Plus and higher plans.
  - `Favorites`.
  - Sub-pages appear under each page's sidebar toggle, and `+` on hover adds a nested page.
  - "All pages have the same functionality, even if they're nested as sub-pages."
  - Source: https://www.notion.com/help/navigate-with-the-sidebar
- [doc] "There are no folders in Notion. Instead, you can organize pages inside pages... inside pages." — https://www.notion.com/help/create-a-subpage
- [doc] **Move to** works from ⋮⋮ or `/moveto`: "Moves the block to another page in your workspace." — https://www.notion.com/help/writing-and-editing-basics. When moving top-level pages to another workspace: "When you move top-level pages, all their sub-pages go with them." (Stated only for the move-between-workspaces case.) — https://www.notion.com/help/create-delete-and-switch-workspaces
- [doc] **Duplicate** (⋮⋮ or `cmd/ctrl+D`) "Makes an exact copy of the content block." — https://www.notion.com/help/writing-and-editing-basics
- [doc] Duplicating a *public* page into your workspace "will include all the sub-pages contained in the original page." — https://www.notion.com/help/duplicate-public-pages
- [unverified] Whether in-workspace Duplicate of a page block deep-copies all sub-pages. No doc states it outside the public-page case. — unverified
- [doc] **Delete a page:**
  - Ways to delete: sidebar `•••` → `Delete`, page `•••` → `Delete`, ⋮⋮ on a sub-page → `Delete`, or drag the page to Trash.
  - "You can always select any page block and press the `backspace` or `delete` keys."
  - Source: https://www.notion.com/help/duplicate-delete-and-restore-content
- [doc] **Sub-pages on delete:** dragging a page into Trash "will delete all the sub-pages nested within that page, including database items." This sentence is stated for drag-to-Trash. — https://www.notion.com/help/navigate-with-the-sidebar
- [doc] **Trash:**
  - Pages stay in Trash 30 days, then are permanently deleted. After that they are "retained for 30 days before they become inaccessible to all users."
  - Trash supports search and filters by `Last edited by`, `In` (old parent page), and `Teamspace`.
  - You can open a page to `Restore` it or permanently delete it. A trashed page is not editable.
  - There is no "empty trash" for everything at once.
  - Source: https://www.notion.com/help/duplicate-delete-and-restore-content
- [doc] **Archive** (Business/Enterprise beta) is separate from delete. "If you archive a parent page, all sub pages are archived automatically." — https://www.notion.com/help/archive-pages
- [doc] API: a page has `in_trash`, which is set to trash or restore it. — https://developers.notion.com/reference/page
- [unverified] Whether `cmd/ctrl+Z` undoes deleting a page block. Not found in Notion docs. — unverified
- [unverified] Cut/paste of a page block (does it move the page or create a copy?) and copy/paste within or between pages. Not found in Notion docs. — unverified

## 6. Permissions and sharing

- [doc] "When you create a subpage inside of a page, that subpage will take on the permissions of its parent page. To change this, go into a subpage and update the permissions there." — https://www.notion.com/help/sharing-and-permissions
- [doc] "Notion respects the broadest level of access given to a user." — https://www.notion.com/help/sharing-and-permissions
- [doc] Moving a shared page to Private removes others' access. "This override will only apply to the parent page — the permissions granted for any subpages will remain the same." — https://www.notion.com/help/sharing-and-permissions
- [doc] A page set to "Anyone with link" may be reachable without the link if "The page is nested inside another page that has been shared more broadly." — https://www.notion.com/help/sharing-and-permissions
- [doc] Levels are Full access, Can edit, Can edit content (database only), Can create (database only), Can comment, and Can view. — https://www.notion.com/help/sharing-and-permissions
- [doc] Blocks inherit permissions through the `parent` pointer, not `content`. — https://www.notion.com/blog/data-model-behind-notion
- [unverified] A "Restore inheritance" action. Not found in any of the 467 help articles. — unverified
- [doc] **Publish:** `Share` → `Publish` tab → `Publish`. "Publishing a Notion page to the web means all of its subpages will be published too." You "can restrict subpage permissions to hide them from public view." The site updates automatically as you edit. — https://www.notion.com/help/public-pages-and-web-publishing

## 7. Database rows are pages

- [doc] "Every item in a Notion database is also a whole page of its own! You can add any content you want inside… To open a row as a page, hover over a cell in the Name column and click OPEN. You can add or edit any properties. You can also add additional content into the body of the page." — https://www.notion.com/help/create-a-database
- [doc] "Properties provide data about the page you're looking at… Under the properties is free page space, where you can add any type of content block, including sub-pages or an inline database." — https://www.notion.com/help/intro-to-databases
- [doc] The same Page object is used for both. Only `parent.type` differs (`data_source_id` vs `page_id`/`workspace`), and so does the property set. — https://developers.notion.com/reference/page
- [doc] The blog lists "a row in a database, even pages themselves" as blocks. A database page is "a page block in a database with user-defined properties." — https://www.notion.com/blog/data-model-behind-notion
- [doc] A row "Move to… another workspace or page (where it will show up as a subpage)." — https://www.notion.com/help/intro-to-databases
- [inferred] A row page and a sub-page are the same kind of thing: the same Page object, differing only in parent and properties. — https://developers.notion.com/reference/page and https://www.notion.com/blog/data-model-behind-notion

## 8. Keyboard

- [doc] `esc` "select[s] the block you're currently in." Arrow keys select a different block, and `shift+↑/↓` extends the selection. — https://www.notion.com/help/keyboard-shortcuts
- [doc] With a block selected, "Press `enter` to edit any text inside a selected block (or open a page inside a page)." — https://www.notion.com/help/keyboard-shortcuts
- [doc] `cmd/ctrl + enter` "modif[ies] the current block… Open a page." — https://www.notion.com/help/keyboard-shortcuts
- [doc] `backspace`/`delete` deletes the selected blocks, including a page block. — https://www.notion.com/help/keyboard-shortcuts and https://www.notion.com/help/duplicate-delete-and-restore-content
- [doc] Other block shortcuts: `cmd/ctrl+D` duplicates, `cmd/ctrl+shift+arrows` moves, `cmd/ctrl+/` edits or turns the block into another type, and `option/alt`+drag duplicates. — https://www.notion.com/help/keyboard-shortcuts
- [unverified] What plain typing does while a page block is selected, and Enter/Backspace with the caret just before or after a page block. Not found in Notion docs. — unverified

## 9. Empty new page state and templates

- [doc] "Once your new page opens, you can give your page a title… On desktop or web, select any of the options at the bottom of the page to get started. You can import from an app or file, use a template, create a table, and more." — https://www.notion.com/help/create-your-first-page and https://www.notion.com/help/create-a-subpage
- [doc] "A menu of page types will appear, allowing you to turn your empty page into a table, board, list, or simply keep it as an empty page." — https://www.notion.com/help/guides/creating-a-page
- [doc] AI entry: "Just hit the spacebar and ask AI to help you write." — https://www.notion.com/help/guides/how-notion-can-help-your-marketing-team-stay-organized-and-efficient
- [unverified] The exact string "Press Enter to continue with an empty page, or pick a template". Not found in Notion docs. — unverified
- [doc] Template button: `/button` or `/template` "gives you a template button that duplicates any combination of blocks you define." — https://www.notion.com/help/keyboard-shortcuts. Database templates pre-fill properties and body. — https://www.notion.com/help/start-with-a-template
- [doc] For a reusable page template, Notion suggests keeping an empty page and using `Duplicate`. — https://www.notion.com/help/start-with-a-template

## 10. Other notable behavior

- [doc] **Export:**
  - "Any non-database Notion page can be exported as a Markdown file. Full page databases will be export[ed] as a CSV file, with Markdown files for each subpage."
  - The export dialog asks "whether to include sub-pages." "Notion creates nested folders for subpages", with an option "Create folders for subpages".
  - HTML export puts sub-pages "in their own folders."
  - Source: https://www.notion.com/help/export-your-content
- [unverified] How a sub-page reference is written inside the parent's exported .md/.html (link format). Not stated in the docs. — unverified
- [doc] Block **Color** "Only appears for certain types of blocks." — https://www.notion.com/help/writing-and-editing-basics
- [unverified] Whether page blocks accept a color. — unverified
- [unverified] Read-only/published rendering of a sub-page block, beyond the fact that sub-pages publish with the parent. — https://www.notion.com/help/public-pages-and-web-publishing — unverified
- [doc] Sharing to a teamspace by dragging a page into it in the sidebar. Dragging out of a shared section into `Private` removes others' access. — https://www.notion.com/help/sharing-and-permissions (drag into teamspace) and https://www.notion.com/help/navigate-with-the-sidebar (drag into Private)
- [doc] On a database's sub-page block, ⋮⋮ → `Turn into inline` converts a full-page database into an inline one. — https://www.notion.com/help/intro-to-databases

---

## Must-have vs nice-to-have for v1

**Must-have**
- A `page` block whose text is the title and whose children (`contentIds`) render on their own screen, not inline. (judgment; see §0, §4)
- Creation via `/page` and the toolbox, opening the new page right away. (judgment; see §1)
- Turn into → Page, and back, keeping text as the title and children as the body. Toggle → Page works the same way. (judgment; see §0, §1)
- Inline row in the parent with icon + title. Click or `Enter`/`Cmd+Enter` opens it. (judgment; see §2, §8; the inline look is unverified)
- Navigation into the page with breadcrumbs back up through the ancestors. `cmd/ctrl+shift+U` goes up. (judgment; see §3, §4)
- Delete of a page block takes the whole subtree, with undo. (judgment; see §5; undo of delete is unverified in Notion)
- Page icon (emoji) and title editing on the page screen. (judgment; see §4)
- Duplicate deep-copies the subtree, and Move to / drag reparents it. (judgment; see §5; deep duplicate is unverified in-workspace)
- A database row and a page are the same kind of block. (judgment; see §7)

**Nice-to-have**
- Cover image, Full width, Small text, and Font. (judgment; see §4)
- Side/center peek, plus the "Open pages in" setting. (judgment; see §3)
- Link to page block, @mention/`[[`/`+` page links, and backlinks. (judgment; see §2)
- Page-level floating ToC, Lock page, and page discussions. (judgment; see §4)
- Trash with 30-day restore, version history, permissions, publish, and export with sub-page folders. These are host and backend concerns more than editor concerns. (judgment; see §5, §6, §10)
- Empty-page starter options (templates, table, AI). (judgment; see §9)
