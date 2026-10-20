# Research 27: the remaining unmeasured Notion behaviours (suggested templates, CSV mapping, Manage in Calendar, default time, source switch, dark leftovers)

Measured 2026-10-20 (local, 17:14–19:14 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion-measure15 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2, never changed. Theme at start: **"Use system setting"** (light, body bg rgb(255, 255, 255)).
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure15/` (not in the repo). Helpers copied from research/26 (`notion-measure14/`), session renamed. New: `ax.sh` (elements by aria-label), `propfull.sh` / `optcolor.sh` (a property's edit page, then each option's colour menu, reading the checked colour), `vsroot.sh` / `vsub.sh` / `swst.sh` (View settings rows, sub-pages, switch states), `tabs.sh`, `peekbody.sh`, `cell.sh`, `fmt.sh` (date format vs field text), `inctime.sh` (clock read, then Include time on), `menus.sh`, `hl.js`.
Every value is `getComputedStyle` / `getBoundingClientRect` read in the page, DOM text, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Input: research/26 §6 (UNMEASURED) and the task list for this round.

## 0. Setup

- Sidebar "New page" (tooltip "New…") › Page. Private page "Blok measure scratch 15 2026-10-20" (breadcrumb read "Private").
- Every database was added with `/table view` › Enter on a fresh line below the previous one, which opens the "New database" side panel (research/26 §2).

## 1. Suggested templates (Tasks Tracker, Projects, Skills) and "More templates"

### 1a. The Suggested list changes after a template is used

| Panel opened | "Suggested" rows |
|---|---|
| 1st database | Tasks Tracker, Projects, Skills |
| after Tasks Tracker was used | **Projects, Skills, Document Hub** |
| after Projects was used | **Skills, Document Hub, Brainstorm Session** |
| after Skills was used | **Document Hub, Brainstorm Session, Meeting Notes** |

So the panel always shows three templates the user has not used yet, taken in order from the gallery list (§1e). No row showed a badge, lock or tooltip (`guard.sh`, hover).

### 1b. Tasks Tracker: a two-step "Customize" modal, then the database

Clicking **Tasks Tracker** opens a centred 1000x637 modal (same shell as the Import CSV modal). The left column is a form and the right column is a live preview.

**Step 1: "Customize Tasks Tracker" / "Select features to turn on or off"** (`02-customize-tasks.png`). Feature chips are `role=button`, 28 tall, radius 24px, padding 0 12px, 14px/16.8px/400:
- **On** (white fill, ring `rgb(39, 131, 222) 0 0 0 1.5px`): **Priority, Task type, Effort level, Description**.
- **Off** (no fill, ring `rgb(230, 229, 227) 0 0 0 1px`): **Updated at, Past due, Attach file**.
- **"Get started"** 320x32, bg rgb(39, 131, 222), text rgb(243, 249, 253) 14px/500, radius 8px. Close is a 26x26 button at the top left (focus ring on open).
- The preview reads "0 hidden properties" under the table.

**Step 2: "Select how you prefer to see your Tasks Tracker"** (`03-customize-tasks-views.png`). View cards 308x52, radius 14px, padding 16px, gap 8px, 14px/20px/500: **All Tasks, By Status, My Tasks** on (blue 1.5px ring), **Checklist** off. A Back arrow replaces the close button. Button **"Done"** (same box as Get started).

Defaults were kept. Result:

- Database title **"Tasks Tracker"**, icon `checkmark_green.svg` (an image icon, 21x21, radius 4px).
- View settings shows a row **"Undo Task database"** where other databases show "Turn into" (§1c, §1d show the same pattern for Skills).
- Database template (New ▾): **"New task"** marked **Default**, plus Empty and "New template".

| Property | Type | Options (colour = the checked row in the option's colour menu) |
|---|---|---|
| Task name | Title | |
| Status | Status | To-do: **Not started** (DEFAULT; no colour row checked, pill rgba(28, 19, 1, 0.11) / rgb(73, 72, 70)) · In progress: **In progress** (Blue) · Complete: **Done** (Green). "Display as: Select" |
| Assignee | Person | Limit: No limit, Default: No default, Notifications: Users only. Header shows an (i) description icon (text not read) |
| Due date | Date | Date format Month/Day/Year, Time format 12 hour, Notifications None |
| Priority | Select | **High** (Red), **Medium** (Yellow), **Low** (Green); Sort: Manual |
| Task type | Multi-select | **🐞 Bug** (Orange), **💬 Feature request** (Green), **💅 Polish** (Pink) |
| Description | Text | |
| Effort level | Select | **Small** (Green), **Medium** (Yellow), **Large** (Red) |

The three "off" features (Updated at, Past due, Attach file) were not created.

| View | Layout | Shown properties | Filter / Sort / Group | Layout switches |
|---|---|---|---|---|
| **All Tasks** | Table | all 8 | none / none / none | Show page icon **off**, Wrap all content off, vertical lines on; Load limit 50; Side peek |
| **By Status** | Board | Task name, Assignee, Priority, Task type (Description, Due date, Effort level, Status hidden) | Group by **Status**, Sub-group none | Show page icon on, Wrap all content on, Color columns on; Load limit 25; Card preview None, Card size Medium, Card layout Compact |
| **My Tasks** | Table | Task name, Assignee, Due date, Status | **Filter "Assignee: Contains Me"** | Show page icon on, Wrap all content off; Load limit 50 |

Sample rows (3):

| Task name | Status | Due date | Priority | Task type | Description | Effort level | Page icon |
|---|---|---|---|---|---|---|---|
| Improve website copy | Done | 02/03/2025 | High | 💅 Polish | "Change header text to better reflect our latest product offerings." | Medium | none |
| Update help center & FAQ | In progress | 02/20/2025 | Medium | 💬 Feature request | "Update support documents to reflect new product releases." | Small | 📕 |
| Publish release notes | Not started | 02/28/2025 | Low | 💬 Feature request | "Include product updates in next release note." | Small | 🗒️ |

Assignee is empty on every row. With "My Tasks" open the table showed no rows and an "Edit filters" link.

**Row page body** (side peek, `05-tasks-row-peek.png`): the page uses a custom layout ("Customize layout", "View details"), with Assignee / Status / Due date pinned under the title and Priority / Task type / Effort level / Description under a "Properties" panel. Body blocks: `sub_header` "Task description", text "Provide an overview of the task and related details.", empty text, `sub_header` "Sub-tasks", three empty `to_do`s (placeholder "To-do"), `sub_header` "Supporting files", a `pdf` embed placeholder ("Embed a PDF"), a Google Drive placeholder ("Connect Google Drive to Notion to embed a file"), a `figma` placeholder ("Embed Figma").

### 1c. Projects

Same two-step modal. **Step 1 "Customize Projects"** chips: **Priority, Team, Start and end dates, Assignee, Attach file** on; **Progress, Budget** off. Preview: "4 hidden properties". **Step 2** views: **By Status, All Projects, Gantt** on; **My Projects** off. Defaults kept.

- Title **"Projects"**, icon `iterate_blue.svg`. View settings shows **"Turn into"** (no Undo row). Template: **"New project"** (Default).
- The Team feature is a Multi-select, not a relation, so no second database was made. No new sidebar entry was seen.

| Property | Type | Options |
|---|---|---|
| Project name | Title | |
| Assignee | Person | (i) description icon in the header |
| Priority | Select | High (Red), Medium (Yellow), Low (Green) |
| Attach file | Files & media | Limit: No limit |
| End date | Date | Month/Day/Year, 12 hour |
| Start date | Date | Month/Day/Year, 12 hour |
| Status | Status | same three as Tasks Tracker, same colours |
| Team | Multi-select | **Account Management** (Default, pill rgba(42, 28, 0, 0.07) / rgb(44, 44, 43)), **Business Development** (Blue), **Product Design** (Green), **Human Resources** (Purple) |

| View | Layout | Shown | Other |
|---|---|---|---|
| **By Status** | Board | Project name, Assignee, Priority | Group by Status; Load limit 25; Card preview None, size Medium, layout Compact; Show page icon on, Wrap all content on, Color columns on |
| **All Projects** | Table | all 8 | Show page icon off, Wrap off, vertical lines on; Load limit 50 |
| **Gantt** | **Timeline** | Project name, Assignee | **Group by Status**; Start date / End date, "Separate start and end dates" on, **Show table on, Table properties "1 shown"**; zoom **Month**; Load limit 25 |

Sample rows (3), All Projects order:

| Project name | Status | Start | End | Priority | Team | Page icon |
|---|---|---|---|---|---|---|
| Quarterly sales planning | Not started | 03/24/2025 | 03/28/2025 | Medium | Account Management | 📖 |
| Revamp new hire onboarding | Done | 01/20/2025 | 02/04/2025 | Low | Human Resources | none |
| Public launch of iOS app | In progress | 04/09/2025 | 04/30/2025 | High | Product Design | 📱 |

Row body ("Quarterly sales planning"): custom layout, Status / Assignee / Priority / End date pinned, Start date / Team / Attach file under "Properties". Blocks: `sub_sub_header` "About project", text "Provide an overview of the project’s goals and context", empty text, `sub_sub_header` "Action items", one empty `to_do`, `sub_sub_header` "Documents", Google Drive embed placeholder, PDF placeholder, Figma placeholder.

### 1d. Skills: no modal, an empty database

Clicking **Skills** created the database at once (no Customize modal):

- Title **"Skills"**, icon `magic-wand_gray.svg`. **0 rows.** One Table view, no tab bar shown. A **COUNT 0** calculation is on the title column. View settings shows **"Undo skills database"**, and has **no "Manage in Calendar"** row (the source has no date).
- Properties: **Skill name** (Title), **Description** (Text), **Files** (Files & media, No limit), **Tags** (Multi-select, **no options**: "Add an option"), **Created by** (Created by). All five shown.
- Layout: Table; Show data source title on, vertical lines on, page icon on, **Wrap all content on**; Load limit 50.
- Templates menu: "Create a reusable page template for this database." + New template (no default template).

### 1e. "More templates" gallery (`07-more-templates.png`, `08-more-templates-click.png`)

The modal (research/26 §2) lists "Empty database", then "Existing data sources" (4 cards + "Show more"; this time the three new databases came first, newest first), then "Templates":

- First view (6): **Document Hub** "Collaborate on docs in one hub.", **Brainstorm Session** "Spark new ideas together.", **Meeting Notes** "Turn meetings into action.", **Goals Tracker** "Set team goals, achieve together.", **Tasks Tracker** "Stay organized with tasks, your way.", **Projects** "Manage projects start to finish." Research/26 saw Skills in this set; after Skills was used it dropped down the list.
- The **"More templates"** button (a `div role=button`, no `href`; `window.open` was patched and stayed unused) **expands the list in place**. Full list after it, in order: Document Hub, Brainstorm Session, Meeting Notes, Goals Tracker, Tasks Tracker, Projects, **Skills** "Save reusable instructions for agents.", **Campaign Management** "Plan and deliver winning campaigns.", **Content Calendar** "Streamline content creation.", **Event Management** "Plan and manage your events.", **Social Media Planner** "Organize and schedule social posts.", **Issue Tracking** "Resolve issues and feedback fast.", **Feature Requests** "Manage feature requests end-to-end.", **Engineering Docs** "Organize knowledge with your team.", **Fundraising Tracker** "Track investor deals and progress.", **Pipeline Tracking** "Track your sales pipeline.", **Account Management** "One hub to manage clients.", **Creative Projects** "Keep creative projects on track.", **Inventory Management** "Manage inventory efficiently.", **Product Roadmap** "Take products from idea to launch.", **Asset Library** "Create shared design assets." (21 templates).
- Then a **"More in Marketplace"** button (`notionTemplate` icon + right arrow). **Not clicked** (it leads to the template marketplace).
- Escape inside the modal did not close it (focus was in its Search field). The × at the top left did.

**Blok should:** if it offers starter templates, treat each as a full schema + views + sample rows + a row-page body, and keep the Suggested list to unused ones. A "Customize" step with feature chips and view cards is Notion's pattern for the bigger ones; a small one (Skills) is created directly and empty.

## 2. Import CSV: "Setup CSV columns" (`10-…`–`17-…`)

File fed with a page-side hook on `HTMLInputElement.prototype.click` (research/21 §4 method), then the page was reloaded and the hook was gone (`window.__csvHook` false). CSV `blok-r27.csv`:

```
Name,Due,Amount,Site,Email,Done,Stage
Alpha,2026-03-04,12,https://example.com,a@example.com,Yes,Todo
Bravo,2026-03-05,7.5,https://example.org,b@example.com,No,Doing
Charlie,2026-03-06,100,https://example.net,c@example.com,Yes,Todo
```

**After choosing the file** (`10-csv-chosen.png`): the "Choose file" button becomes a file chip "blok-r27.csv" with a 24x24 **"Clear file"** ×. "Map CSV headers" becomes enabled (bg rgb(39, 131, 222), no opacity). The right-hand preview title becomes the file name without extension, "blok-r27".

**"Map CSV headers" opens a step titled "Setup CSV columns"** (`11-csv-map.png`). The button and the step title differ; research/21 saw the same title.

| Element | Value |
|---|---|
| Back | arrow at the top left (replaces the close ×) |
| Title | **"Setup CSV columns"** 26px/36px/600 rgb(44, 44, 43) |
| Text | "Choose the property type for each column in your CSV file" 14px/20px rgb(125, 122, 117) |
| Switch | **"Use first row as headers"**, on by default (30x18 `input.switch`, label 14px/20px rgb(125, 122, 117), padding-left 8px) |
| Column labels | "CSV File Columns" and "Property Type", 12px/18px rgb(125, 122, 117) |
| CSV column chip | 145x32, radius 6px, bg rgba(0, 0, 0, 0.1), border 1px rgb(230, 229, 227), 14px/500 (drawn faded, see shot) |
| Arrow | `arrowStraightRight` 16px, fill rgb(142, 139, 134) |
| Type button | 145x32, **white, border 1px solid rgb(230, 229, 227), radius 4px**, padding 2px 6px, type icon + label + chevron |
| Primary | **"Import CSV"** 322x36, bg rgb(39, 131, 222), radius 6px |
| Secondary | **"Cancel"** 322x32, text rgb(142, 139, 134) |

**Detected types (defaults):**

| CSV column | Values | Default type |
|---|---|---|
| Name | Alpha… | **Name** (the title) |
| Due | 2026-03-04… | **Date • Full date** |
| Amount | 12, 7.5, 100 | **Number** |
| Site | https://… | **URL** |
| Email | a@example.com… | **Email** |
| Done | Yes / No | **Checkbox** |
| Stage | Todo / Doing / Todo | **Text** (not Select) |

**Type picker** (click a type button, `12-csv-type-picker.png`, `13-csv-date-formats.png`): a 240-wide menu with a focused **"Search property types…"** field, section **"Existing property"**: **Don’t import**, **Name** with a grey "Title" tag; divider; **"Add new property ›"**. Hovering it opens a 240-wide submenu: **Text, Number, Select, Multi-select, Status, Date, Checkbox, URL, Email, Phone, Person**, with a checkmark on the current type. Date has its own `›`; hovering or clicking that chevron did **not** open a date-format submenu (UNMEASURED).

**Escape on this step closes the whole import modal and the side panel** (the mapping is lost). Clicking empty space in the modal closes only the type picker.

Turning "Use first row as headers" off and on did not change the preview text within 1.5s (what "off" does: UNMEASURED).

**Result** (Stage changed to Select, rest default; "Import CSV"):
- A dialog **"Import complete"** (22px/26px/700) / "Your CSV import was successful" (14px/20px rgb(125, 122, 117)) / **"Go to import"** (101x28, border 1px rgba(28, 19, 1, 0.11), radius 6px), in the same 1000x637 shell.
- The data went into the database the panel was opened from (inline on the page). "Go to import" opened that database as a full page. Title stayed the placeholder **"New database"**, not the file name. One view, "Table".
- **Property order: Name, Amount, Done, Due, Email, Site, Stage**: alphabetical after the title, not the CSV order.
- **Rows: Charlie, Bravo, Alpha** (reversed, as research/21 saw). The Map step's preview showed other orders (Bravo, Charlie, Alpha, and once Bravo, Alpha, Charlie), so the preview order is not the result order.
- Values: Due "March 6, 2026" (Full date, no time), Amount 100 / 7.5 / 12, Done ticked for Yes, Email as text, Site shown as "example.net" (scheme hidden in the cell).
- **Stage (Select) options: "Todo" then "Doing"** (first-appearance order). Pill colours **Todo rgba(92, 0, 163, 0.14) / rgb(85, 59, 105)** and **Doing rgba(0, 96, 38, 0.157) / rgb(42, 83, 60)**. These match the pills that §1 measured as Purple and Green. That is a match by pill colour; the colour menus were not opened.
- A full-page database opens **View settings as a docked side panel** (not a `role=dialog` popover), 290 wide at the right edge (`18.png`).

**Blok should:** detect Date, Number, URL, Email and Yes/No → Checkbox; leave repeated short strings as Text (Notion does not guess Select). Offer Don't import / map to title / "Add new property" per column. Keep CSV column order and row order (Notion's alphabetical columns and reversed rows are not worth copying). A single Escape should not throw the mapping away.

## 3. "Manage in Calendar" (View settings row and timeline toolbar button)

Hovered first: no tooltip, no badge, icons `calendarDate20` + `arrowDiagonalUpRightSmall` (`guard.sh` "ok"). Before clicking, `window.open` was patched and a capture-phase click listener called `preventDefault()` on any anchor click, so nothing could navigate.

- **Both entries** (the View settings row on a table view, and the timeline toolbar button on the Projects "Gantt" view) click a **hidden anchor** (width 0, `target="_blank"`, `rel="noopener noreferrer"`) to **`https://app.notion.com/calendarAuth?env=production&from=openInCalendarButton&…`**. The rest of the query carries a device id, workspace id and the view id (values not recorded).
- `window.open` was not called. The tab did not navigate. No in-app modal opened. No new tab opened (it was blocked).
- So "Manage in Calendar" starts **Notion Calendar's sign-in / connect flow in a new tab**. Stopped there, as the task says; the page behind that URL was not opened.

**Blok should:** not copy this row; it is a link into a separate Notion product. A host lever ("open in calendar" URL) would be the generic form.

## 4. Dates

### 4a. Date picker field text per Date format (the picker's own field, vs the cell)

Measured on a date with no time (`fmt.sh`):

| Date format | Mar 4, 2026 (this year, past): picker field / cell | **Mar 4, 2027 (future year)**: picker field / cell |
|---|---|---|
| Full date | "Mar 4, 2026" / "March 4, 2026" | "Mar 4, 2027" / "March 4, 2027" |
| **Short date** | **"Mar 4" / "Mar 4"** | **"Mar 4" / "Mar 4"** |
| Month/Day/Year | "03/04/2026" / "03/04/2026" | "03/04/2027" / "03/04/2027" |
| Day/Month/Year | "04/03/2026" / "04/03/2026" | not re-read |
| Year/Month/Day | "2026/03/04" / "2026/03/04" | not re-read |
| Relative | "Mar 4, 2026" / "March 4, 2026" | "Mar 4, 2027" / "March 4, 2027" |

- **Short date drops the year for a future year too** (research/26 saw it for a past year). Three samples now (2025, 2026, 2027): Short date never shows a year, in the cell or in the picker field.
- **Full date: the picker field uses the short month ("Mar 4, 2026"); the cell uses the long month ("March 4, 2026").** The numeric formats are the same in both.
- Relative, for a date months away, shows the Full date text.
- The picker header follows the selected date ("Mar 2026", "Mar 2027").
- With Include time on, the picker shows two fields: date ("Oct 20, 2026") and time ("8:00 PM").

### 4b. Default time when Include time turns on: settled

Three samples in one minute, clock read in the page (`new Date()`) just before each toggle; all on the imported database (Due = Date, Full date, 12 hour):

| Cell before | Clock at toggle | Time filled | Cell after |
|---|---|---|---|
| (a) **empty** (field showed today, Oct 20, 2026) | **19:01:31** | **8:00 PM** | "October 20, 2026 8:00 PM" |
| (b) a set date, **today** (Oct 20, 2026), no time | **19:01:49** | **8:00 PM** | "October 20, 2026 8:00 PM" |
| (c) a set date, **another day** (Mar 4, 2027), no time | **19:02:01** | **9:00 AM** | "March 4, 2027 9:00 AM" |

- **(a) and (b) agree, and (b) and (c) differ**, so the deciding variable is **today vs another day**, not empty vs set.
- At 19:01 the nearest whole hour is 7:00 PM, but Notion filled 8:00 PM. So the rule is **the next whole hour**, not the nearest.
- Rule: **if the date is today, the time is the next whole hour; on any other day it is 9:00 AM.** This fits every earlier sample too (research/23: 5:49 → 6:00 AM; research/26: 1:58 → 2:00 PM; two set other-day dates → 9:00 AM).
- Open edge: what happens at exactly hh:00, and in the 23:xx hour (next hour is tomorrow). UNMEASURED.

### 4c. "Today" button sets the date

With Include time off, clicking the picker's "Today" set the cell to "October 20, 2026" (not only a jump to the month).

## 5. Switching a view's Source: filters and sorts

Database with two sources: **S1** (the imported one: Name, Amount, Done, Due, Email, Site, Stage = Select) and **S2** (added via Add view › New data source › New empty data source, plus a property named **"Stage"**, type Select, added by hand). S1's "Table" view got:

- Filters: **Name: Contains a** (title, present in both), **Amount = 12** (only in S1), **Stage: Todo** (same name and type in both, different property). The table showed only Alpha.
- Sorts: **Name A → Z**, **Stage ascending**, **Amount low → high**.

View settings › Source › S2 (the "Suggested" row):

| | Before (S1) | After switching to S2 | After switching back to S1 |
|---|---|---|---|
| Filter row | "3" | **blank**; Filter page shows only "Add filter" | **blank** (not restored) |
| Sort row | "3" | **"Name"**; Sort page: **Name, Sort A → Z** only | **"Name"** (Name A → Z only); rows Alpha, Bravo, Charlie |
| Property visibility | 7 | 2 (Name, Stage) | 7 |

- **Every filter is dropped on a source switch, even the one on the title (Name), which both sources have.** Filters do not come back when the view returns to S1.
- **Sorts: only the sort on the title survives.** A sort on a property that only S1 has (Amount) is dropped, and so is a sort on a property that has the same name and type in S2 (Stage). Matching is by property id, not by name; the title is the one shared property. Dropped sorts do not come back.
- This extends research/26 §5b (a sort on a missing property is dropped for good).

**Blok should:** on a source switch, keep a sort on the title, drop sorts on other properties, and drop all filters. Blok today keeps them and lets unknown ids match nothing (34f20350). Notion's filter behaviour is stricter than "drop what's missing". Copy it or not: product call.

## 6. Dark leftovers and the "Now" button

Theme set Settings › Preferences › Theme from "Use system setting" to **Dark**, then back (§8).

| Element | Light | Dark |
|---|---|---|
| View settings root row, hover | ≈ rgba(33, 27, 23, 0.051) (research/26) | **rgba(255, 255, 255, 0.055)** (`color(srgb 1 1 1 / 0.0549)`) |
| View settings root row, **active** (mouse held down, `:active` true) | not read | **rgba(255, 255, 255, 0.11)** (`color(srgb 1 1 1 / 0.1098)`) |
| View settings root row ink | rgb(44, 44, 43) | rgb(240, 239, 237); rows 274x28, radius 6px |
| View settings panel | white | rgb(37, 37, 37) |
| Date picker **"Today"** box | 51x20, radius 3px, padding 0 8px, 12px/14.4px/500, ink rgb(142, 139, 134) | **same box and same ink rgb(142, 139, 134)** |
| "Today" hover | ≈ rgba(33, 27, 23, 0.051) | **rgba(255, 255, 255, 0.055)** |
| **"Now"** box | 43x20, same as Today | 43x20, ink rgb(142, 139, 134) |
| **"Now" hover** | **rgba(33, 27, 23, 0.051)** (`color(srgb 0.129 0.106 0.090 / 0.051)`) | **rgba(255, 255, 255, 0.055)** |

- Neither Today nor Now has a tooltip (dark, hover 1.5s).
- Releasing the mouse off the row did not open the Filter page (the panel stayed on its root).

## 7. Property header menu: the "Edit property" submenu does not open by itself

On a Number property ("Amount"), clicked the header; the pointer stayed on the header (above the menu, `elementsFromPoint` = the header cell).

- After the click, and 1.4s later: **only the 220x498 menu is open; no submenu.** Research/26's open submenu came from the pointer resting on the row (hover).
- Keyboard: ArrowDown/ArrowUp move the highlight (bg ≈ rgba(33, 27, 23, 0.051)) through the items and wrap at the ends. **Highlighting "Edit property" with the keys does not open the submenu.**
- **ArrowRight** on "Edit property" opens the 300-wide submenu (Number format / Decimal places / Show as …) and moves focus into it. **ArrowLeft** closes it and returns to "Edit property". **Enter** opens it too. **Escape** closes the submenu only; a second Escape closes the menu.

**Blok should:** open the Edit property submenu on hover, ArrowRight or Enter, never on keyboard highlight alone; ArrowLeft / Escape close one level.

## 8. Account state and safety

- **No billing surface opened.** Every new control was hovered first. No "Plus" / "Business" / "Upgrade" badge or lock was seen. `guard.sh` flagged "New data source" as GATED, but only because the regex matches the word "New" in its label; research/26 had already checked that row. In the workspace menu "Upgrade" sits at (158, 237) and "Settings" at (158, 265). The point was read with `elementsFromPoint` ("Settings") before each click.
- **Theme:** "Use system setting" → Dark → back to **"Use system setting"** (dropdown read back; body rgb(255, 255, 255)).
- Not used: Notion AI (nothing typed in the AI box, no "Generate with AI"), chart quota, Copy-to-Clipboard buttons, favorites, "More in Marketplace", the calendar auth page (blocked before navigation).
- Templates used: Tasks Tracker, Projects, Skills (Notion's own). Import CSV: one file, one import.
- Page-side patches (CSV file hook; `window.open` stub and anchor-click blocker) were removed by reloading the page after each.
- Two CSV attempts were lost (an Escape, then a click on the panel's "Import CSV" row behind the modal). The third went through. This left an extra empty inline database on the scratch page, which was trashed with it.
- The scratch page "Blok measure scratch 15 2026-10-20" was moved to Trash (page Actions › Move to Trash; toast "Moved to Trash"). Its five inline databases (Tasks Tracker, Projects, Skills, one empty, one imported with two sources) went with it. Right after Tasks Tracker was created, a leaf with the text "My Tasks" was found in the sidebar (DOM text only, not looked at). After the reload the sidebar had a different layout and no leaf matching Task/Project/Skill except Recents entries for the scratch page's own databases. Whether the template added a sidebar entry is unverified. Trashing navigated the tab to another recent page; nothing was clicked there.
- After the first reload, Notion showed a different sidebar layout ("Search or ask", Home, Library, Recents). This is Notion's UI, not a setting changed here.
- `.playwright-cli/` auto-snapshots were deleted. Lines naming one of the user's pages were removed from `more-templates*.txt`. The session `notion-measure15` was closed; no other session was touched.

## 9. UNMEASURED (this round)

- CSV: the Date type's date-format submenu in the Map step (hover/click on its `›` did nothing); what "Use first row as headers" off does; Phone / Person / Status detection; merging a CSV into an existing database.
- Colour names of the CSV-created Select options (matched by pill colour only); the Status "Not started" colour (no colour row was checked in its menu).
- Default time at exactly hh:00 and during 23:xx.
- Customize modal: what turning a feature chip on/off or a view card on/off changes (defaults kept).
- Other templates (Document Hub … Asset Library): only titles and descriptions read.
- "More in Marketplace" and the calendarAuth page contents (not opened, by design).
- Whether the root "View settings" title was ever 14/600 (history; not measurable now).
- From research/26, still not attempted: dark favorite star (needs favoriting); calendar Escape after an inside-grid drag box; undo on a read-only block (Cmd/Ctrl not forwarded); 99+ toggle scope; side peek at a narrow window; table undo scroll; backlinks 20+; map pins; form anonymous / "View my response" / "Email me a copy"; builder sidebar-leave; gallery Cmd-click tab; feed alarm; other users' reaction pills; sort-row drag motion; "Out of range" under a descending sort; ranges under a day; timeline snap at other zooms; whether the Content tab moves in the layout list; "Hide data source titles" scope.
