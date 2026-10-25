# Live Notion: a database that is its own page

Measured 2026-10-25 (about 01:37–01:52 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion-fpdb open --extension`, on app.notion.com. Viewport 1512x717 CSS px, light theme, sidebar open (270 px).
Scratch page: "Blok measure fpdb 2026-10-25" (private). It was moved to Trash at the end and was gone from the sidebar after that. No 403 or block page appeared.
Every value below is DOM text, `getBoundingClientRect`, `getComputedStyle` or a screenshot (`shots/`). Anything not observed is marked **UNMEASURED**.

Ids seen: scratch page `403c2586eb6d80ab99c7ea292348d680`; database block `403c2586eb6d801fb4eddfc41147cf2f`; its view `v=403c2586eb6d8078bd9f000c1231424f`; row "Row A" `403c2586eb6d8088a50ac846f8fb1e19`.

## 1. Creating "Database - Full page"

- `/database full` filtered the slash menu to ONE row: "Database - Full page · Database" (highlighted).
- Enter did NOT insert a block and stay. It **navigated straight into the new database page**: URL `/p/<db id>?v=<view id>`, tab title "New database", breadcrumb "Blok measure fpdb 20… / New database". So the page is created as a child of the scratch page right away.
- The new page shows an empty Table (Name column, "Add property", 4 blank rows, "New page") with a right side panel titled "New database" (close ×): an AI box "Describe what you want to build", then "New empty data source", "Import CSV", section "Suggested": "Tasks Tracker", "Projects", "Skills", "More templates", then "Link to existing data source". Shot: `shots/01-new-fpdb-source-chooser.png`.
- After "New empty data source" the panel closed. Title placeholder was "New database"; typed "FPDB One". Tab title became "FPDB One".

## 2. Full-page database layout (`shots/02-fpdb-header-hover.png`)

Block class is `notion-collection_view_page-block` (same as research 07/242).

| Part | Geometry (x, y, w, h) | Type / color |
|---|---|---|
| Frame (`.notion-frame`) | 270, 44, 1242, 673 | |
| Hover row: "Add icon" / "Add cover" / "Add description" | 365/458/559, 48, 93/101/138, 28 | 14px/400, rgb(161, 158, 153) |
| Title h1 "FPDB One" | 366, 80, 166, 38 | 32px/700, rgb(44, 44, 43), lh 38.4px |
| View tab "Table" (only view) | 374, 130, 85, 32 | 14px/500, rgb(44, 44, 43), bg rgba(33, 27, 23, 0.05), radius 20px |
| Toolbar: "Settings" (sliders) | 1305, 132, 28, 28 | rgb(125, 122, 117) |
| "New" + "More add options" (blue split button) | 1339/1384, 132, 45/24, 28 | 14px/500 "New", text rgb(243, 249, 253) |
| Table view (`.notion-table-view`) | 270, 166, 1242, 413 | header "Name" at 374, 166, 280, 36 |

- The three hover buttons have opacity 0 until the pointer is over the header. With the pointer on the title they become opacity 1. The row has **"Add description"**, which a plain page does not (a plain page shows "Add icon / Add cover / Add comment", seen on the new scratch page).
- When the pointer was elsewhere the toolbar showed only Settings + New. With the pointer over the table it also showed Filter, Sort, Automations, AI Autofill, Search (`shots/09`).
- Content column: x 366 → 1416 (1050 px) in a 1242 px frame. The parent (plain, default-width) page's `.notion-page-content` is 720 px wide (x 531). So the full-page database is much wider than a default page. Whether this is the "Full width" setting or a database default: **UNMEASURED** (the page ••• menu has no "Full width" item, see §6).
- Breadcrumb (topbar text): "Blok measure fpdb 2026-10-25 / FPDB One", then "Edited just now", "Share". The plain parent page's topbar shows "Blok measure fpdb 2026-10-25" then a lock "Private ▾"; the database page has no "Private" chip.

### Can you type page blocks on the full-page database?

No.
- `.notion-frame .notion-page-content` does not exist on the database page.
- The only `contenteditable=true` element in the frame is the h1 title.
- A click at (800, 520), below the rows, lands on `.notion-table-view` (it fills to the frame bottom). Focus went to `BODY`. Typing "zq" put no text anywhere and opened nothing.

## 3. The child full-page database inside the parent (`shots/05`)

After step 1 the parent page body held only one block (the `/database full` line was replaced).

- Block: `notion-collection_view_page-block`, 531, 220, 720×40. Same block id as the database page.
- Inner link (`role=link`): 537, 226, 708×28, radius 4px. `href="/p/<db id>?v=<view id>&pvs=25"`.
- Icon: svg `viewTable`, 540, 229, 22×22, fill rgb(142, 139, 134).
- Text "FPDB One": 16px / **500**, rgb(44, 44, 43), line-height 20.8px, x 567. No text-decoration. It has `border-bottom: 1px solid rgba(28, 19, 1, 0.11)` (the faint page-link underline).
- Hover: link background `rgba(33, 27, 23, 0.051)` (written as `color(srgb 0.129 0.106 0.090 / 0.051)`). Handles appear: "+" (tooltip label "Click to add below. Option-click to add a block above") 479, 228, 24×24, and ⋮⋮ ("Drag to move, click to open menu") 503, 228, 18×24.
- Hover also opened a **preview card** under the link: table glyph, breadcrumb "Blok measure fpdb 2026-10-25", bold "FPDB One", and a small grey drawing of a table with a blue "New" pill. In the screenshot it is about 537, 260, 260×220. Its exact geometry and styles are **UNMEASURED** (the element search found nothing).

### ⋮⋮ menu on the child full-page database (`shots/06`)

Search box "Search actions…", then:
- Section "Database": **Turn into inline database**, Color ›, Edit icon, Add to Favorites, Lock database (switch), More options ›
- Open in new tab ⌘⇧↵, Open in side peek ⌥Click
- Copy link, Duplicate ›, Move to ⌘⇧P, Move to Trash
- Ask AI ⌘J
- Footer: Last edited, the user's name, "Today at 1:45 AM", "Learn about databases"

The item is labelled "Turn into inline database", not "Turn into inline". While the menu is open the block row turns light blue (selected).

## 4. Turn into inline database, and back (`shots/07`–`11`)

- After "Turn into inline database" the parent URL stayed the same. The block is now `notion-collection_view-block` with the **same block id** `403c2586-eb6d-801f-b4ed-dfc41147cf2f` (same database, the block type changed in place).
- Inline block: 531, 220, 720×163. Title "FPDB One" 539, 224, 252×31, **24px/600**, rgb(44, 44, 43). With only one view there is **no view tab**: no `role=tab` in the block. The title row has the toolbar on the right.
- Inline toolbar while hovering (x, y=226, all 28×28): Filter 960, Sort 988, Automations 1016, AI Autofill 1044, Search 1072, **Open as full page 1100**, Settings 1128, New 1162 (45 wide), More add options 1207 (24 wide). With the pointer on the ⤢ button a "»" glyph also showed at about x 945 (**UNMEASURED** what it is).
- "Open as full page": a link (`<a>`, aria-label "Open as full page"), svg `arrowExpandDiagonalBottomLeftToTopRightSmall`, 1100, 226, 28×28. `href="/p/<db id>?v=<view id>&pvs=23"`. Tooltip text "Open as full page", dark pill shown **above** the button (screenshot shows it at about y 196–218).
- Clicking it went to `/p/403c2586eb6d801fb4eddfc41147cf2f?v=403c2586eb6d8078bd9f000c1231424f`. That is the **same URL** the full-page database had. Breadcrumb "Blok measure fpdb 2026-10-25 / FPDB One". h1 "FPDB One", view tab "Table", hover row "Add icon / Add cover / Add description", no `.notion-page-content`. The block on that page reported class `notion-collection_view-block` (it is still inline in its parent), yet the page looks the same as §2 (`shots/09`).
- Back in the parent, the inline database's ⋮⋮ menu (`shots/10`): Section "Database · Table": **Turn into page**, **Turn into simple table**, Edit icon, Add to Favorites, Lock database, More options ›; **Open as page**, Open in new tab ⌘⇧↵, Open in side peek ⌥Click; Copy link, Duplicate, Move to ⌘⇧P, Move to Trash; Ask AI ⌘J; footer "Last edited … Today at 1:48 AM", "Learn about databases". (No "Color" item here, which the full-page block's menu had.)
- "Turn into page" put the parent back to one link row: `notion-collection_view_page-block`, 531, 220, 720×40, `viewTable` icon, text "FPDB One", same `href` (`…&pvs=25`). The row stayed selected (light blue) after the change (`shots/11`).

## 5. Sidebar (`shots/04`)

- Expanding the scratch page ("Open" chevron on hover) shows "FPDB One" nested one level in: tree item padding-left 16px (top-level items 8px), icon svg `viewTable`, its own chevron (`aria-expanded=false`), hover actions "Add a page inside" and "Delete, duplicate, and more…".
- Expanding "FPDB One" shows **its views, not its rows**: one child "• Table" (padding-left 24px). "Row A" did not appear anywhere in the sidebar.
- After "Turn into inline database" the sidebar still listed "FPDB One" (table icon) with "• Table" under the scratch page (`shots/07`). Whether that was a stale sidebar or Notion keeps inline databases in the sidebar: **UNMEASURED** (no reload was done).

## 6. Full-page database ••• menu (topbar "Actions"; `shots/03`)

Search box "Search actions…", then:
- Copy link ⌘⌥L, Duplicate ›, Move to ⌘⇧P, Merge with CSV, Version history, Updates & analytics
- Customize layout, Notify me (value "Comments") ›
- Lock database (switch), Move to Trash
- More ›
- Footer: Last edited, user, "Today at 1:45 AM", "Learn about databases"

For comparison, the plain scratch page's ••• menu listed: Copy link, Copy page contents, Duplicate ⌘D, Move to, Version history, Updates & analytics, **Appearance & layout**, Use with AI, Suggest edits, Notify me (Comments), **Lock page**, Move to Trash, More, footer with "2 words". So the database page swaps in "Merge with CSV", "Customize layout" and "Lock database", and drops "Copy page contents", "Appearance & layout", "Use with AI", "Suggest edits". The "More ›" submenu was not opened: **UNMEASURED**. The Settings (sliders) view menu was not opened: **UNMEASURED**.

## Not measured

- Dark theme; narrower viewports.
- Cover / icon / description after adding them (only the hover buttons were seen).
- The hover preview card's geometry and styles.
- A full-page database with several views (tabs in the parent link? tabs in sidebar).
- Whether the sidebar keeps an inline database listed after reload.
- Row peek / row page (covered by research 07).
