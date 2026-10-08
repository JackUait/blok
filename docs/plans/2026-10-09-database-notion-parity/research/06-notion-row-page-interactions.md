# 06 — Notion database row pages, peek, keyboard and interactions

Research date: 2026-10-09. Every claim below has a URL that was fetched in this session (raw HTML pulled with curl, then turned into text). Help-centre pages were fetched from `https://www.notion.com/help/sitemap.xml` (472 English pages, all grepped). Releases came from `https://www.notion.com/releases/sitemap.xml`, which lists only 152 release pages (2020 → 2026-09-15). So "not found" means **not found in the fetched sources**. It does not mean "Notion does not do this". WebSearch was out of quota, so no third-party or extra search sources were used. Nothing was observed live in Notion.

Labels: **[DOC]** = stated in a help page. **[REL]** = stated in a release note (dated; may be outdated). **UNVERIFIED** = not found in any fetched primary source.

Short URL keys used below:
- KS = https://www.notion.com/help/keyboard-shortcuts
- INTRO = https://www.notion.com/help/intro-to-databases
- VIEWS = https://www.notion.com/help/views-filters-and-sorts
- TABLES = https://www.notion.com/help/tables
- BOARDS = https://www.notion.com/help/boards
- LAYOUTS = https://www.notion.com/help/layouts
- LGUIDE = https://www.notion.com/help/guides/build-the-perfect-workflow-with-customizable-layouts
- PROPS = https://www.notion.com/help/database-properties
- TPL = https://www.notion.com/help/database-templates
- BACK = https://www.notion.com/help/create-links-and-backlinks
- COMM = https://www.notion.com/help/comments-mentions-and-reminders
- CUST = https://www.notion.com/help/customize-your-database
- TASKS = https://www.notion.com/help/tasks-and-dependencies
- COLLAB = https://www.notion.com/help/collaborate-with-people
- RESTORE = https://www.notion.com/help/duplicate-delete-and-restore-content
- R:YYYY-MM-DD = https://www.notion.com/releases/YYYY-MM-DD

---

## 1. Opening a row: side peek, center peek, full page

### Documented
- **Three open modes per view.** "Side peek: Open pages on the right side of the database. The rest of the database view continues to be interactive on the left. Center peek: Open pages in a focused, center modal. Full page: Open pages as full pages directly." [DOC] VIEWS
- **Setting path (help wording).** Settings menu at top of database → **Layout** → menu next to **Open pages in**. [DOC] VIEWS. Same path is in the FAQs: "Layout → Open pages in → Full page". [DOC] TABLES, BOARDS
- **Setting path (release wording, older label).** "Click the ••• at the top right of your database, and open the Layout menu. Use the **"Open pages as"** dropdown… side peek, center peek, or open as full page right away. This setting affects everyone who uses the database view." [REL] R:2022-07-20. The label differs ("as" vs "in"). The help page is the newer text.
- **Defaults per layout.** "Table, Board, List & Timeline layouts will open pages in side peek by default. Gallery & Calendar layouts will open pages in center peek by default." [DOC] VIEWS. Same split stated at launch. [REL] R:2022-07-20
- **The setting is per view.** "Within each view, you can choose how you'd like database pages to open." [DOC] VIEWS. It is shared: "affects everyone who uses the database view". [REL] R:2022-07-20
- **Side peek purpose.** "edit the database page's properties and content on the right side of your screen, and keep your database items visible and interactive on the left side". [REL] R:2022-07-20
- **How to open an item, by view** [DOC] INTRO:
  - Tables: "hover over your first column and click the **OPEN** button that appears."
  - Lists: "just click on the title of the item."
  - Boards, calendars, galleries: "click anywhere on the card."
- **Expand to full page from peek.** "Pages will always open in a peek preview. Click **⤡** at the top left to view in full page mode." [DOC] INTRO. Note: this sentence predates the Full-page option, which is documented in VIEWS. Treat "always" as stale.
- **Next/previous row in peek: buttons.** "Quickly jump to the next/previous item in your databases, using the new 🔼 and 🔽 buttons at the top left of the pop-up window." [REL] R:2022-01-19
- **Next/previous row in peek: shortcuts** (exact text from KS) [DOC] KS:
  - "Use `ctrl` + `shift` + `K` on Mac or `ctrl` + `K` on Windows while in database peek view to go to the previous database page."
  - "Use `ctrl` + `shift` + `J` on Mac or `ctrl` + `J` on Windows while in database peek view to go to the next database page."
- **Other links in side peek.** "Open any Notion page link (e.g. subpage, page mention) in side peek mode". [REL] R:2023-04-27
- **Hover preview** of a Notion page (a separate feature, not database peek). [REL] R:2023-11-07
- **Buttons can open a created page** "as a full page, side peek or center peek". [DOC] https://www.notion.com/help/guides/automatically-generate-blocks-pages-with-buttons
- **Peek limits.** "You can't make suggestions to … pages that are open in peek view." [DOC] https://www.notion.com/help/suggested-edits
- **Selection survives a preview.** "If you have a few database pages selected and then open a page preview, your selection will be retained when you click out of the preview window." [REL] R:2020-01-14
- **Shortcuts inside peek** are expected to work. Bug fixes mention keyboard shortcuts in peek [REL] R:2021-05-13, and the toggle-all shortcut on database pages in peek [REL] R:2022-04-14.

### Unverified / not found
- **Esc closes peek.** UNVERIFIED. KS documents `esc` only as "select the block you're currently in. Or to clear selected blocks."
- **Switching side ↔ center from inside an open peek** (a mode switcher in the peek header). UNVERIFIED. Only ⤡ → full page is documented (INTRO).
- **Clicking outside the side peek to close it.** UNVERIFIED.
- **Peek panel width or resize.** UNVERIFIED.

---

## 2. Row page layout

### 2a. Base structure (classic, pre-layouts)
- **Every item is a page.** "Every item you enter into your database is a Notion page." [DOC] INTRO
- **Properties sit at the top, one per row.** "In this page, you'll see all your database properties at the top. Each row is one property, with a name, type, and a value. Click on the value to edit." [DOC] INTRO
- **Property ⋮⋮ handle.** "Click the ⋮⋮ that appears to the left of each property on hover in order to: drag it up or down, change the Property type, rename it, Duplicate or Delete it." [DOC] INTRO
- **Body.** "Underneath your properties is free page space, where you can add any type of content block, including sub-pages or an inline database." [DOC] INTRO
- **Blocks dragged in become pages.** "any other type of content you drag into a database (like bullets or to-do items), will automatically turn into pages." [DOC] INTRO
- **Top section contents.** "Properties", "Comments", and "Backlinks". [DOC] INTRO

### 2b. "Customize page" menu (older system, still in INTRO)
- **Path.** "Click the ••• at the top right of any Notion page in a database and select **Customize page**." The menu can also be opened from the ⋮⋮ next to any property. That ⋮⋮ "can also be clicked and dragged up or down to reorder". [DOC] INTRO. It was introduced in [REL] R:2020-11-11 ("new Customize page button in the ••• menu").
- **Per-property visibility:** "Always show", "Hide when empty", "Always hide". [DOC] INTRO
- **Hidden properties collapse into one item.** "When you hide properties, they get aggregated in a single menu item at the bottom of the list. You can click this to easily show any hidden properties." [DOC] INTRO
- **New properties inherit "Hide when empty".** "When you change a database property's visibility to 'Hide when empty,' new properties added to the database will default to 'Hide when empty'". [REL] R:2021-12-23
- **Backlinks options (old):** "Expanded", "Show in popover", "Off". **Comments options (old):** "Expanded", "Off". [DOC] INTRO; "Show in popup" setting [REL] R:2020-11-11
- **Relations as a page section.** Click a relation property → "Show as" → "As page section". It shows "up to 10 relations at a time in a dedicated section at the top of a Notion page". [REL] R:2022-08-25

### 2c. Layouts / layout builder (newer system, launched 2024-10-24)
- **Launch.** "Layouts to customize your page … Try it out by hovering over any database page title and clicking **Customize layout**." [REL] R:2024-10-24
- **Help entry point (desktop/web).** "Open the database as a full page (not inline) and select ••• at the top. Select Customize layout. Use the page preview toggle under the database name to see how your layout changes will look for any page in the database." [DOC] LAYOUTS. Mobile: "tap ··· → Customize layout" or database settings → Customize layout. Tablet: "the layout button that appears above the page title." [DOC] LAYOUTS. Guide: "hover above your database page title and click Customize layout." [DOC] LGUIDE. Settings menu entry: "Customize page layout". [DOC] CUST
- **Scope.** "A page layout will apply to all pages in the database. Layouts can't be applied only to specific pages or specific views." It needs at least **Can edit** access. [DOC] LAYOUTS
- **Builder components:** "A Heading with the name of your page and room to pin specific properties", "A main page area containing a Property group", "A details panel on the right side", and "Page settings". [DOC] LAYOUTS
- **Pinned properties (Heading).** "Under Unpinned properties, click 📌 next to a property to pin it. You can pin up to **15 properties**." [DOC] LAYOUTS. **Conflict:** the guide says "a place for up to **four** important database properties. These show up under page title." [DOC] LGUIDE. Both are reported here. The help page is the reference doc.
- **Pin overflow.** "When you pin more properties than fit on screen, they appear in a horizontal scroller. Use the > and < arrows to scroll". [DOC] LAYOUTS
- **"Add a property" under Pinned properties** creates a new property that is already pinned. [DOC] LAYOUTS
- **Backlinks (new options):** "Always show backlinks", "Show on hover only", "Off". [DOC] LAYOUTS. Also: "Backlinks automatically appear above the page title and show on hover whenever a page has them… To see a page's backlinks, select {#} backlinks under its title, or its properties if it's a database page." [DOC] BACK
- **Property group.** There is exactly one per layout. It can live in the main page or the details panel. A property that is pinned or given its own module "will no longer be shown in your Property group". [DOC] LAYOUTS
  - Show/hide each property with 👁️. [DOC] LAYOUTS
  - "Add section" creates named sections. Drag properties between sections. [DOC] LAYOUTS. The guide calls them "neat, collapsible sections with labels". [DOC] LGUIDE
  - Property search: "Type any part of a property name to filter the list in real time. The search works across collapsed sections and hidden properties too. Search is not case-sensitive." [DOC] LAYOUTS
- **Details panel.** It can be opened and closed. Use "Add to panel" to add a property, the Property group, or a module. On a page, "open and close the details panel by selecting **View details** at the top of the page." [DOC] LAYOUTS. The guide calls it a "collapsible, right-side panel". [DOC] LGUIDE
- **Modules.** "+" in the main page or panel adds a single-property module. Move a module by dragging, or with ••• → "Move up", "Move down", "Move to panel", "Move to page". Remove with "Remove from layout". [DOC] LAYOUTS
- **Constraints.** "You can't move or remove a page's Heading. You can't remove the Property group. Some properties, like Relation, can't be moved to the details panel." [DOC] LAYOUTS
- **Page settings → Structure:** "Simple" (main page + details panel) or "Tabbed" (one Content tab plus tabs holding views of other databases). [DOC] LAYOUTS. Tabbed release: "select Tabbed under Page settings, and add your databases to the tabs below the heading." [REL] R:2025-03-26
- **Page settings → Options:** inline comments "Default" vs "Minimal" (count only); show or hide page discussions; show or hide **Property icons**; **Full width**. [DOC] LAYOUTS
- **Apply/reset.** "Apply to all pages" (new pages also get the layout). "Reset to original page layout" ("No properties will be deleted"). [DOC] LAYOUTS
- **Mobile.** You can view layouts, but "the full layout builder experience" is desktop/web only. [DOC] LAYOUTS

### 2d. Comments on a row page
- Page-level discussion: "Hover over the top of any page and click **Add comment**." Resolve with ✔️. Use ••• for "Edit comment" and "Delete comment". [DOC] COMM
- **Property comments:** "You can leave comments directly on database properties when you're in table view or when you have a database page open… hovering over a property and selecting 💬." [DOC] COMM
- Comment without opening the row: "In a table or list view, hover over a database page and select ⋮⋮ → Comment… In a gallery or board view, hover over a database page and select ••• → Comment… In any database view except the timeline view, right-click on a database page… select Comment." [DOC] COMM. Release: [REL] R:2024-06-25
- Shortcut: "`cmd/ctrl` + `shift` + `M` to create a comment." [DOC] KS

### 2e. Templates on a new/empty row page
- "Create a new page in your database and choose any of the templates from the **gray menu** it contains." Templates are also available from "the dropdown menu on the right of the blue New button". [DOC] TPL
- Create one with: dropdown arrow next to New → "+ New template". The template editor shows "a bar across the top indicating which database it's located in". [DOC] TPL
- Template ••• → Edit, Duplicate, Delete, Repeat (daily/weekly/monthly/yearly). Nesting is capped at "three levels". [DOC] TPL
- Templates belong to one database only ("only available in the specific database where you created them"). [DOC] TPL
- Buttons can choose "a database template as the default page that gets created". [REL] R:2023-09-22
- Enter in the title of an empty page: a bug fix restored "using the Return / Enter key inside a title to insert the remaining text as the first block in an empty page". [REL] R:2022-04-14

### 2f. Icon & cover on row pages
- Gallery/board cards can show "Page cover" or "Page content". [DOC] BOARDS. No row-page-specific icon/cover doc was found beyond the general guide https://www.notion.com/help/guides/page-icons-and-covers. Its fetched HTML had little usable text, so nothing is cited from it.

### Unverified / not found
- How the old "Customize page" menu and Layouts coexist today. The help still documents both. Which one wins in the current UI is UNVERIFIED.
- Property "pinning" before layouts: UNVERIFIED (none found).
- Exact position of comments and backlinks relative to properties in the classic page: UNVERIFIED. INTRO says only that they sit in the "top section".

---

## 3. Table view interactions

### Documented
- **Open row:** hover the first column → **OPEN** button. [DOC] INTRO
- **Row drag:** "For rows, hover, then click and hold the ⋮⋮ icon on the left to drag it up or down." [DOC] TABLES
- **Row actions via right-click:** "Delete", "Duplicate", "Copy link" ("an anchor link to that specific item"), "Rename" ("without opening it"), "Move to", "Edit property". [DOC] INTRO. Add "Comment" via ⋮⋮ or right-click. [DOC] COMM
- **Row checkbox selection / bulk edit:** "Hover over any row and click the checkbox that appears next to it. If you want to select all of the rows… hover over the Name property and click the checkbox that appears next to it. From the menu that appears, edit any of your database properties for your selected rows." [DOC] TABLES
- **Bulk edit shortcut:** "In a database, select multiple rows or cards, then use `cmd/ctrl` + `/` to edit them all at once." [DOC] KS
- **Add row:** "For a table, list or board: Click **+ New** at the bottom to add a new item." Also the blue **New** button at top right for every database. [DOC] INTRO
- **Accidental empty row:** "If you create an empty row in a Table view database by accident, you can press the **Esc** key to automatically delete the empty row". [REL] R:2022-04-14
- **Focus after + New:** a fix restored "the title field … being automatically focused after clicking the + New button" (on row-limited databases). [REL] R:2022-04-14. This implies + New focuses the new row's title.
- **Large collections:** "When a database contains more than 1,000 items, new pages may appear in the middle of the collection instead of at the end." [DOC] INTRO
- **Column reorder:** "For columns, click and hold their headings to drag them left or right." Columns can also be reordered from Properties → ⋮⋮. [DOC] TABLES
- **Column resize:** "Resize columns by hovering over their edges, and dragging right or left." [DOC] TABLES. **Double-click to auto-fit:** "double click column resizers in Table view databases to automatically resize columns to fit the content inside". [REL] R:2022-04-14
- **Checkbox column** can be narrowed to fit the checkbox. [REL] R:2021-12-23
- **Column header menu (documented items):** Wrap text / "Wrap column" toggle [DOC] TABLES, [REL] R:2022-04-14; **Calculate** [DOC] TABLES; "Insert left" / "Insert right" [DOC] PROPS; "Freeze up to column" / "Unfreeze column" [DOC] VIEWS; and from the header "edit the property's name, filter or sort by that property, run calculations, and more" [DOC] PROPS. Hovering a header shows a tooltip with the full title. [REL] R:2022-04-14
- **Add property at end:** "Select **+** next to the right-most property." [DOC] PROPS
- **Freeze / sticky column:** "freeze one column, which will cause it to stay visible on the left side no matter where you scroll". [DOC] VIEWS. Launched in [REL] R:2023-09-22 ("Freeze columns while you scroll. Available in table view."). The title column cannot be deleted but can be dragged. [DOC] TABLES (FAQ)
- **Calculate footer.** Options: Count all, Count values, Count unique values, Count empty, Count not empty, Percent empty, Percent not empty, Earliest date, Latest date, Date range, plus Sum/Average/Median/Min/Max/Range for numbers. [DOC] TABLES. On inline tables, "the 'Calculate' placeholder button is now hidden by default … until you hover your cursor". [REL] R:2022-04-14
- **Fill:** "In a table, press `cmd/ctrl` + `R` or `cmd/ctrl` + `D` to fill cells right or down (respectively) when you have multiple cells selected." [DOC] KS. **Fill handle:** "click and hold the small blue circle at the bottom of any cell, then drag up or down to other cells… use Command + D to paste the value of a starting cell to other selected cells". [REL] R:2022-08-25
- **Paste one value into many cells:** "You can paste the same content into multiple selected cells simultaneously in Table view databases". [REL] R:2021-12-23
- **Edit a cell value:** "Click on the value to edit" (page view). [DOC] INTRO. Select/multi-select: type the tag and press enter after each; manage tags via the cell → ••• that appears on hover. Reorder tags with ⋮⋮. [DOC] PROPS
- **Sub-items:** "Hover over any database row, and then click on the toggle on the left side of the row to add a new sub-item". [REL] R:2022-12-15. Display options: "Nested in toggle" or "Flattened list". [DOC] TASKS
- **Toggle all groups:** "The cmd/ctrl + option/alt + T shortcut now opens & closes all database groups on a page in addition to toggle blocks". [REL] R:2022-08-11. The KS wording covers toggle lists only. [DOC] KS
- **Inline row limit:** inline tables can show "10, 25, 50, or 100 rows at first, then click to load more". [REL] R:2020-11-11
- **Search:** a database with ≥3 pages can be searched via 🔍. Search covers titles and properties. [DOC] VIEWS
- **Lock:** "Lock database" / "Lock views" stops property and view changes but still allows data entry. [DOC] INTRO, CUST

### List-view-only keys (do NOT generalise to tables)
- "Use **Shift + Enter** on any selected page, to create a new item underneath. Use **tab** to move between properties for easy editing". [REL] R:2022-12-15 (List view)

### Block-level keys that may apply (context = blocks, not cells)
These are documented on KS for *selected blocks*. Whether they behave the same on a database cell or row is UNVERIFIED.
- `esc`: "select the block you're currently in. Or to clear selected blocks."
- `enter`: "edit any text inside a selected block (or open a page inside a page)."
- `cmd/ctrl` + `enter`: "modify the current block": "Open a page", toggle checkbox, etc.
- arrow keys: "select a different block". `shift` + up/down: "expand your selection".
- `space`: open a selected image full-screen.
- `cmd/ctrl` + `D`: duplicate selected blocks. In a table with multiple cells selected, the same keys fill down (see above).
- `cmd/ctrl` + `shift` + arrows: move a selected block.
[all DOC] KS

### Unverified / not found
- Cell-level keyboard model: click selects a cell, Enter edits, arrows move, Tab moves, Shift+arrows range-select, Esc leaves edit mode. **UNVERIFIED.** It is not on KS or any fetched help or release page. Simple tables (not databases) document only "use the tab key to navigate horizontally" (https://www.notion.com/help/guides/simple-tables-vs-databases).
- Copying or pasting a multi-cell **range**: UNVERIFIED. Only pasting one value into many selected cells is documented (R:2021-12-23).
- Enter in the last row creates a new row: UNVERIFIED.
- Clicking empty space below the table creates a row: UNVERIFIED. R:2022-09-13 says clicking beneath a table that is the last block "will automatically create a new **block**". That is a page block, not a row.
- The row ⋮⋮ menu contents. Only "Comment" via ⋮⋮ is documented (COMM). "Open in…" and the full list are UNVERIFIED. The R:2021-12-23 "Open in new tab" item belongs to a **sub-page block's** ⋮⋮, not a database row.
- Shift-click row range selection: UNVERIFIED for rows. KS documents shift+click for blocks.

---

## 4. Board view interactions

### Documented
- **Grouping default:** "grouped by a status property if your database has one. Otherwise… a select, person, multi-select, or relation property… If none of these properties exist, a new status property will be created". [DOC] BOARDS
- **Drag:** "To rearrange columns, click and hold on a heading, then drag left or right. To move cards up and down or between columns, click, hold, and drag." [DOC] BOARDS
- **Add card:** "+ New at the bottom" (table, list or board). [DOC] INTRO
- **Open card:** "click anywhere on the card". [DOC] INTRO
- **Edit on card without opening it:** "Just click on a property and make edits on the card." [REL] R:2022-08-25
- **Card hover ••• → Comment.** [DOC] COMM
- **Column header ••• → Hide group.** Reveal via settings → **Group**, which lists visible and hidden columns. [DOC] BOARDS. FAQ: drag cards "into that tag under **Hidden Columns**". [DOC] BOARDS
- **Rename or recolor groups** by editing the grouped property's options under Edit properties ("give your options a new name or color, or Delete them… select + next to your existing options to create a new one"). [DOC] BOARDS
- **Column colors:** on by default. Turn off via Group → "Color columns". [DOC] BOARDS; [REL] R:2021-10-19
- **Group options:** hide/show groups with 👁️, sort groups manually or by preset, "Hide empty groups". [DOC] VIEWS
- **Sub-groups.** [DOC] BOARDS
- **Column count / calculation:** "To the immediate right of each column heading, you'll see a gray number". It defaults to the card count and can be changed to any calculation. [DOC] BOARDS
- **Card display:** Card size (large/medium/small); Card preview (Page cover / Page content / Files & media property); "Fit image" toggle; "Reposition" on hover. Property visibility uses 👁️ and is ordered by ⋮⋮. [DOC] BOARDS. "Wrap all properties" option for Board/Gallery. [REL] R:2023-09-22
- **Sub-items on boards:** shown as a "Card property". [DOC] TASKS

### Unverified / not found
- "+ New" at the **top** of a column, or a "+" in the column header: UNVERIFIED. Only the bottom is documented.
- Renaming a group directly from the column header menu: UNVERIFIED. The documented path is Edit properties.
- A card hover edit (✏️) icon: UNVERIFIED. Only ••• → Comment and click-property-to-edit are documented.
- Grouping by relation: BOARDS lists relation as a default group-by candidate. Its own FAQ says grouping by relation/formula is "Not currently" supported. This conflicts within the same page (BOARDS). Unresolved.

---

## 5. Database keyboard shortcuts (exact, from KS)

| Action | Mac | Windows/Linux | Source |
|---|---|---|---|
| Previous database page in peek | `ctrl`+`shift`+`K` | `ctrl`+`K` | KS |
| Next database page in peek | `ctrl`+`shift`+`J` | `ctrl`+`J` | KS |
| Fill cells right (multiple selected) | `cmd`+`R` | `ctrl`+`R` | KS |
| Fill cells down (multiple selected) | `cmd`+`D` | `ctrl`+`D` | KS, R:2022-08-25 |
| Edit selected rows/cards at once | `cmd`+`/` | `ctrl`+`/` | KS |
| Create comment | `cmd`+`shift`+`M` | `ctrl`+`shift`+`M` | KS |
| Open/close all toggles (and database groups per R:2022-08-11) | `cmd`+`option`+`T` | `ctrl`+`alt`+`T` | KS, R:2022-08-11 |
| Copy page URL | `cmd`+`L` | `ctrl`+`L` | KS |
| Back / forward | `cmd`+`[` / `]` | `ctrl`+`[` / `]` | KS |
| Up one level in hierarchy | `cmd`+`shift`+`U` | `ctrl`+`shift`+`U` | KS |
| Search in page (also finds hidden database content per R:2024-06-25) | `cmd`+`F` | `ctrl`+`F` | KS, R:2024-06-25 |
| Copy link to block | `option`+`shift`+`L` | `alt`+`shift`+`L` | R:2022-10-12 |
| List view: new item below selected | `shift`+`enter` | `shift`+`enter` | R:2022-12-15 |
| List view: move between properties | `tab` | `tab` | R:2022-12-15 |
| Delete accidental empty table row | `esc` | `esc` | R:2022-04-14 |

KS note: "These instructions are for English/QWERTY keyboards". KS
Not found on KS: Space to open a row, Cmd+Enter as a row-open key, and any cell-navigation keys. All are UNVERIFIED.

---

## 6. Undo, history, multi-user presence

- **Undo/Redo on mobile:** the ••• menu has "Undo/Redo: Take back your last action on a page, or reinstate it." This is in the mobile toolbar section. [DOC] https://www.notion.com/help/writing-and-editing-basics
- **Undo toasts:** moving to Trash shows "a small pop-up … at the bottom of your screen… with a button to Undo". [REL] R:2022-04-14. "Move to" shows a pop-up "with options to undo, or visit the page". [REL] R:2022-05-03
- **Cmd/Ctrl+Z:** not on KS. A grep of all fetched help and release text found no `cmd/ctrl + z`. UNVERIFIED (as documentation; it presumably exists).
- **Version history and databases:** "Some simple table and database changes" appear in version history. "If you're restoring a database, all of its pages and their properties will be restored. However, any contents of the database pages, like text inside of the pages, won't be restored." [DOC] RESTORE
- **Presence:** "You can edit the same page at the same time with an unlimited number of people. Their profile photos will show you where they're looking or working on the page. Edits and comments made by everyone will appear to you instantly." [DOC] COLLAB. "When other people are viewing the same page as you, click on their avatar at the top to jump to wherever they're reading or editing." [REL] R:2020-03-18
- **Database-specific presence** (for example, avatars on rows or cells): UNVERIFIED.
- **Permissions:** "Can edit content" (database pages only) lets users create, edit and delete pages and edit values. It does not allow changing properties, views, filters or sorts, or locking. [DOC] INTRO

---

## 7. Accessibility

- "Improved keyboard accessible buttons & focus rings". [REL] R:2021-03-10
- Colors: "Text colors and background colors are more accessible too, passing all contrast tests from the Web Content Accessibility Guidelines". Select/multi-select use custom text colors "to maximize contrast". [REL] R:2021-10-19
- Dark-mode palette redesign "keeping accessibility in mind". [REL] R:2022-03-03
- "High contrast mode … makes text, icons, and borders easier to read." Found under Settings > Preferences > Appearance (desktop/web). [REL] R:2026-07-30
- Screen-reader, ARIA, or keyboard grid semantics for databases: not found in any fetched source. UNVERIFIED.

---

## 8. Motion

- No fetched help page or release text describes peek slide-in, card drag, or other animation timing or easing.
- Release pages embed YouTube videos (for example R:2022-07-20, R:2024-10-24), shown as "Please watch it on YouTube". They were not watched (no video frames extracted). **All motion details are UNVERIFIED.** Recording the real UI or extracting video frames would be needed.

---

## 9. Conflicts and staleness to watch
1. INTRO says "Pages will always open in a peek preview". VIEWS and R:2022-07-20 add a Full-page mode. Use VIEWS.
2. "Open pages **as**" (R:2022-07-20) vs "Open pages **in**" (VIEWS, TABLES, BOARDS). Help is newer.
3. Backlinks: old "Expanded / Show in popover / Off" (INTRO) vs new "Always show / Show on hover only / Off" (LAYOUTS).
4. Pinned properties limit: 15 (LAYOUTS) vs four (LGUIDE).
5. Customize layout entry: hover the page title (R:2024-10-24, LGUIDE) vs full-page database ••• (LAYOUTS).
6. Board group-by relation: listed as a default candidate but "Not currently" supported in the FAQ (both BOARDS).
