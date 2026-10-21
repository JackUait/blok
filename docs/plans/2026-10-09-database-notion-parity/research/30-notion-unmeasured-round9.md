# Research 30: round 9 measurements (list B of status 29)

Measured 2026-10-21 (local, 00:53–02:33 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion-measure17 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme at start: light (body bg rgb(255, 255, 255)).
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure17/` (not in the repo). Helpers copied from research/28 (`notion-measure16/`), session renamed.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Input: `29-parity-status-2026-10-21.md` §7 (list B). Item numbers below are list B numbers.

## 0. Setup

- Sidebar "New page" › Page. Private page "Blok measure scratch 17 2026-10-21".

Sections follow the order they were measured (list B priority, then the two extra items X1 and X2). Screenshots named below are in the files directory, cropped to the editor.

## B1. Default time when Include time turns on, at hh:00 (clock)

Table with a Date property "Due" (Full date, 12 hour). `inctime.sh`: open the cell picker, read `new Date()` in the page, click the "Include time" row, read the fields and the cell.

| Row | Cell before | Clock at toggle | Time filled | Cell after |
|---|---|---|---|---|
| R3 (control) | empty | 00:57:33 | 1:00 AM | "October 21, 2026 1:00 AM" |
| R1 | empty (field showed "Oct 21, 2026") | **01:00:07** | **2:00 AM** | "October 21, 2026 2:00 AM" |
| R2 | today, no time (set with the picker's "Today") | **01:00:19** | **2:00 AM** | "October 21, 2026 2:00 AM" |

- At 01:00:07 Notion filled **2:00 AM**, not 1:00 AM. So inside the hh:00 minute the rule is still "the next whole hour". The exact second hh:00:00 was not hit (the earliest sample is 7 s after).
- **23:xx: could not measure.** The session started at 00:53 local, so no 23:xx minute fell inside it. The page clock was not patched (Notion would write the fake time to the server).

## B2. Turning End date on in an empty date cell

Row R4, Due empty. Clicked the cell: the picker's start field already read "Oct 21, 2026" (today) with the cell still empty ("R4" only). Clicked the "End date" row.

- The picker then showed two fields, **"Oct 21, 2026" and "Oct 21, 2026"**. End date switch on, Include time off.
- The cell was written at once: **"October 21, 2026 → October 21, 2026"** (today → today). It stayed after Escape closed the picker.
- In the screenshot (`01-enddate-empty.png`) day 21 has the blue fill and the start field has the blue focus border. `document.activeElement` after the click was the "End date" row, not a field.

## B9. CSV import

Files fed with a page-side hook on `HTMLInputElement.prototype.click` (research/21 §4 method; `hook.sh`). The page was reloaded after the last import (`window.__csvHook` then undefined). Three CSV files:

`blok-r30-detect.csv`
```
Name,When,Phone,Owner,State,Score
Alpha,03/04/2026,+1 555 123 4567,Jane Roe,Not started,1
Bravo,03/05/2026,(555) 123-4567,jroe@example.com,In progress,2
Charlie,03/06/2026,555-123-4567,John Doe,Done,3
```
`blok-r30-neutral.csv`
```
Title,Contact,Status,Person,Progress,Tags
Alpha,+1 555 123 4567,Not started,Jane Roe,Not started,red
Bravo,(555) 123-4567,In progress,John Doe,In progress,blue
Charlie,555-123-4567,Done,Jane Roe,Done,red
```
`blok-r30-merge.csv`
```
Name,Due,Extra
R1,2026-03-04,x1
R9,2026-03-05,x9
```

Path for the first two: "/" › Table view on a new line › panel "New database" › **Import CSV** › modal "Import CSV into Notion" (subtitle **"Create a new database with your CSV or merge it into an existing one"**) › Choose file › Map CSV headers › "Setup CSV columns".

### 9a. Detection (defaults on the "Setup CSV columns" step)

| CSV column | Values | Default type |
|---|---|---|
| Name / **Title** (first column) | Alpha… | **Name** (the title). With the header "Title", the preview's column header reads **"Name"**. |
| When | 03/04/2026… | **Date • Full date** (preview "March 4, 2026": read as month/day) |
| Phone | `+1 555 123 4567`, `(555) 123-4567`, `555-123-4567` | **Phone** |
| **Contact** (same phone values, neutral header) | same | **Phone**: detection is by the values, not the header |
| Owner | Jane Roe, jroe@example.com, John Doe | **Text** |
| Person (header "Person") | Jane Roe, John Doe | **Text** |
| State / **Status** (header "Status") / Progress | Not started, In progress, Done | **Text** in all three |
| Score | 1, 2, 3 | Number |
| Tags | red, blue, red | Text |

So Notion detects Phone from the values. It did not detect Person or Status in these two files, not even with a header named "Person" or "Status".

### 9b. The Date type's date-format submenu

- **Mouse: does not open.** Hovering the "Date" row in the "Add new property ›" submenu (and moving to its right end) for 1.5 s left only the type list open (same as research/27).
- **Keyboard: opens.** Click the type button "Date • Full date" › ArrowDown ×2 (to "Add new property") › **ArrowRight** opens the type submenu (Text highlighted, a check on Date) › ArrowDown ×5 to Date › **ArrowRight** opens a third 240x152 menu at x 1074:
  **Full date, Short date, Month/Day/Year, Day/Month/Year, Year/Month/Day**. No Relative, no ISO. The first row is highlighted on open. No row has a checkmark (no svg in any row).
- Enter picks. The type button then reads **"Date • <format>"**.
- **The format is how the CSV text is read**, not how it is shown. The preview always shows the Full date text:

| Format picked | Preview for `03/04/2026`, `03/05/2026`, `03/06/2026` |
|---|---|
| Full date (default) | March 4, 2026 / March 5, 2026 / March 6, 2026 |
| Short date | March 4, 2026 / March 5, 2026 / March 6, 2026 |
| Month/Day/Year | March 4, 2026 / March 5, 2026 / March 6, 2026 |
| **Day/Month/Year** | **April 3, 2026 / May 3, 2026 / June 3, 2026** |
| **Year/Month/Day** | **empty cells** (not parsed) |

- Imported with Day/Month/Year: the cells read "April 3, 2026", "May 3, 2026", "June 3, 2026". The created Date property's own Date format was not read.
- Closing a picker without Escape: a click on empty space in the modal's left column (441, 560) closes only the picker.

### 9c. "Use first row as headers" off

- Turning it off changed **nothing in the modal** (chips, types, preview) after 2 s and again after 6 s. The switch read `checked=false`. Same as research/27.
- **Imported with it off** (`blok-r30-neutral.csv`, Progress set to Status, Tags set to Select):
  - Properties: **Name, Column 2, Column 3, Column 4, Column 5, Column 6** (the title keeps "Name"; the others are "Column N", N = CSV position).
  - **4 rows**: Charlie, Bravo, Alpha, **Title**. The header line became a row (its cells: "Contact", "Status", "Person", "Tags"). The order is the file order reversed.
  - Types kept the mapping chosen on the step (Column 2 Phone, Column 6 Select, Column 5 Status).

### 9d. Person and Status mapped by hand

- **Person** (Owner, picked from "Add new property ›"): the step's preview showed the Owner cells **empty**. After import the property is a Person property (people icon in the header) and **all cells are empty**. Names and an email that are not workspace members are dropped.
- **Status** (State; and Column 5 in 9c): the preview showed the values. After import the property is a Status property and **all cells are empty**. Clicking a cell opened only "Search for an option" and "Edit property" (`10-state-cell.png`). The property's edit page reads "Edit property | Type | Status | Property access | Wrap content | Display as | Select | Duplicate property | Delete property": **no options and no groups at all**. The header menu's "Edit property ›" submenu opened as an empty 300x8 box.
  - After a page reload the Owner (Person) and State (Status) cells were still empty.

### 9e. Select option colours from CSV (also B8)

`Column 6` (Tags, Select, imported with headers off). Edit properties › Column 6, then each option's menu (checked colour row):

| Option (order shown) | Pill bg / text | Checked colour |
|---|---|---|
| Tags (the header row's value) | rgba(0, 118, 217, 0.204) / rgb(38, 74, 114) | **Blue** |
| red | rgba(127, 51, 0, 0.157) / rgb(88, 68, 55) | **Brown** |
| blue | rgba(206, 24, 0, 0.165) / rgb(109, 53, 49) | **Red** |

- Options are in first-appearance order of the file (header line first). Option "Sort" reads **Manual**.
- The colour does not follow the option's text ("red" got Brown, "blue" got Red). Research/27's two options were Purple and Green. No rule is visible from 5 samples.

### 9f. Merging into an existing database

- Entry: the database opened as a full page ("Open as full page") › top-right **Actions** (`•••`) menu › **"Merge with CSV"** (icon `arrowMergeUp`). The menu also has a "Search actions…" box. Not in View settings or its "More settings" (that sub-page lists Sub-items, Dependencies, Connections, Customize page layout).
- It opens the same "Import CSV into Notion" modal with **one extra field, "Import Location"**: a 322x36 button reading **"New database"** (the target database's placeholder title; it has no title), drawn faded and disabled, with a database icon and an up/down chevron (`11-merge-modal.png`, `12-merge-chosen.png`).
- "Setup CSV columns" (`13-merge-map.png`): columns whose header matches an existing property map to it. **Due → "Due"** (the button shows the existing property name, not a type). Extra → Text (new). The type picker lists every existing property under "Existing property": **Don’t import, Name (Title), Due**, then "Add new property ›". The current one has a checkmark.
- Result after "Import CSV" → "Import complete":
  - A new property **Extra** (Text) at the end.
  - **Rows were appended, not merged.** The CSV row "R1" did **not** update the existing R1: the table now has two "R1" rows. New rows at the end: **R9 | March 5, 2026 | x9**, then **R1 | March 4, 2026 | x1** (reversed file order again).
  - **The open view did not show the new rows** for at least 7 s after "Import complete" was closed; the new column did show. They appeared after a page reload.

## B10. Schemas of the other "More templates" entries (and B8, the Customize modal)

Path: "/" › Table view on a new line › panel › **More templates** › click a template card. Each card was hovered first: no `[role=tooltip]` appeared (Notion's hints are not always `role=tooltip`, so one could have been missed), no badge, no svg in the card. `gate.sh` after each click: its only hits were the word "Plan" in two card descriptions (false positive). Picking a template **creates the database** on the page; there is no preview-only mode. Sample rows show the account's own name in Created by / Last edited by cells; written below as "(me)".

### 10a. What each card's thumbnail shows (no click needed)

Each card has the title, the description, then a small preview: the template name and the first view's visible column names or group names. Read from DOM text (`tpl-cards.txt`), full list after "More templates" was expanded:

| Template | Thumbnail text |
|---|---|
| Tasks Tracker | Task name, Status, Assignee · Not started, In progress, Done |
| Projects | Not started, In progress, Done |
| Skills | Skill name, Description, Files |
| Document Hub | Doc name, Created by, Created time |
| Brainstorm Session | Idea, Created by, Priority · Medium, Low, High |
| Meeting Notes | Meeting name, Date, Category · Presentation, Planning, Standup |
| Goals Tracker | Goal name, Owner, Status · Not started, In progress, Done |
| Campaign Management | Blocked, Not started, Planning |
| Content Calendar | Sun, Mon, Tue |
| Event Management | Event name, Status, Event date · Not started, Planning, Pending review |
| Social Media Planner | Sun, Mon, Tue |
| Issue Tracking | Backlog, Open, In progress |
| Feature Requests | New, Under Review, Planned |
| Engineering Docs | Doc name, Author, Status · In Review, Published, Draft |
| Fundraising Tracker | Not started, Diligence, Pitched |
| Pipeline Tracking | New, Discovery, Negotiation |
| Account Management | Active, Churned, Pending Renewal |
| Creative Projects | Not started, In progress, Needs review |
| Inventory Management | Name, ID, Category · Hardware, Accessories, Electronics |
| Product Roadmap | Backlog, Planned, In progress |
| Asset Library | (no preview text) |

The list order this time started with Tasks Tracker, Projects, Skills, Document Hub, … (research/27 saw used templates move to the back; here Tasks Tracker was first again on a new page). The panel's "Suggested" rows were Tasks Tracker, Projects, Skills on every panel this session.

### 10b. The Customize modal's chips and view cards (B8)

- Feature chip **on**: bg rgb(255, 255, 255), `box-shadow: rgb(39, 131, 222) 0 0 0 1.5px`. **Off**: transparent bg, `box-shadow: rgb(230, 229, 227) 0 0 0 1px`. Hovered: bg rgba(0, 128, 213, 0.047). Text rgb(44, 44, 43) in both states. No `aria-pressed` / `aria-checked`.
- **A feature chip adds or removes property columns** in the live preview at once. A chip can stand for several properties:
  - Document Hub: Reviewers on → adds a "Reviewers" column after Category. Category off → removes the Category column and its values.
  - Brainstorm Session: **Upvote off removes three columns: Upvote (button), Total votes, Upvoted by.** Status on → adds a "Status" column right after the title, sample value "New idea".
  - The preview footer counts hidden properties ("0 hidden properties").
- Step 2 view cards (308x52, same on/off look): turning a card on adds a tab to the preview, off removes it.
  - Document Hub: By Category on → a third tab, preview grouped (first group "Customer research"). All Docs off → the preview shows "My Docs" only, with "4 hidden properties".
  - **The last view cannot be turned off**: with All Docs off, clicking My Docs left it on (ring stayed blue).
  - Brainstorm Session: Top Ideas on → a third tab "Top Ideas" showing Idea and Created by, rows in reverse order (Improve SEO first), "5 hidden properties".
- All defaults were restored before Done.

### 10c. Document Hub

Step 1 chips: **Created time, Category, Last edited by, Last updated time** on; **Reviewers** off. Step 2 views: **All Docs, My Docs** on; **By Category** off.

- Title **"Document Hub"**, tabs All Docs, My Docs. 3 sample rows.

| Property | Type | Options / settings |
|---|---|---|
| Doc name | Title | |
| Category | **Multi-select** | Proposal (Yellow), Customer research (Blue), Strategy doc (Orange), Planning (Red); Sort Manual |
| Created by | Created by | |
| Created time | Created time | Full date, 12 hour |
| Last edited by | Last edited by | |
| Last updated time | Last edited time | Full date, 12 hour |

| View | Layout | Shown | Filter / sort / group | Other |
|---|---|---|---|---|
| All Docs | Table | all 6 | none | Load limit 50, Open pages in Side peek |
| My Docs | Table | Doc name, Category (2) | **Created by: Contains Me** | Load limit 50; the new-row button reads "New doc" |

Sample rows: Company mission and strategy (Strategy doc), Proposal for new year campaign (Proposal), Customer feedback report (Customer research).

### 10d. Brainstorm Session

Step 1 chips: **Created by, Priority, Upvote** on; **Status** off. Step 2 views: **All Ideas, By category** on; **Top Ideas** off.

- Title "Brainstorm Session", tabs All Ideas, By category. 3 sample rows, each with a 💡-style page icon (orange bulb in the screenshot).

| Property | Type | Options / settings |
|---|---|---|
| Idea | Title | |
| Created by | Created by | |
| Priority | Select | High (Red), Medium (Yellow), Low (Green); Sort Manual |
| Category | Multi-select | Top of funnel (Yellow), Activation (Orange), Conversion (Blue) |
| Upvote | **Button** | "Edit automation" row |
| Total votes | **Formula** | Number format Number, Show as Number (Bar / Ring offered), sample value 42 in the editor |
| Upvoted by | Person | Limit No limit, Default No default, Notifications Users only |

| View | Layout | Shown | Group | Other |
|---|---|---|---|---|
| All Ideas | Table | all 7 | none | Show data source titles on, vertical lines on, page icon off, wrap off (switch states in DOM order, matched to the label order); Load limit 50; Side peek |
| By category | **Board** | 1 (Idea) | **Category**, Sort Manual, Hide empty groups off, Color columns on; groups Activation, Conversion, Top of funnel, No Category | Load limit 25; Card preview None, Card size Medium, **Card layout List** (`22-card-layout.png`: the List tile has the blue border); show titles, page icon, wrap all on; new-card button reads "New idea" |

Sample rows: Launch back to school campaign (High, Activation), Simplify onboarding experience (Medium, Conversion), Improve SEO (Low, Top of funnel). Total votes 0.

### 10e. Meeting Notes

Step 1 chips: **Date, Category, Attendees** on; **Last edited by, Last updated time** off. Step 2 views: **All Meetings, My Notes** on; **By Category** off.

| Property | Type | Options / settings |
|---|---|---|
| Meeting name | Title | |
| Date | Date | **Date format Relative**, **Time format "Hidden"**, Notifications None |
| Category | Multi-select | Planning (Blue), Standup (Red), Presentation (Yellow), Retro (Green), Customer call (Blue); Sort Manual. Two options share Blue. |
| Attendees | Person | No limit, No default, Users only |
| Created by | Created by | |

| View | Layout | Shown | Filter | Other |
|---|---|---|---|---|
| All Meetings | Table | all 5 | none | titles on, vertical lines on, page icon off, wrap off; Load limit 50; has "Manage in Calendar" |
| My Notes | Table | 4 | **Created by** (the filter's operator and value were not read) | page icon **on**; Load limit 50 |

Sample rows (all dated "February 13, 2025": Relative shows the full date for a far day): Product release post-mortem (Retro), Weekly team sync (Standup), GTM strategy presentation (Presentation). Attendees empty, Created by (me).

### 10f. Goals Tracker

Step 1 chips: **Due date, Priority, Team** on; **Quarter, Progress, Days until due** off. Step 2 views: **All Goals, By Status, My Goals** on; **By Team** off.

| Property | Type | Options / settings |
|---|---|---|
| Goal name | Title | |
| Owner | Person | No limit, No default, Users only |
| Status | Status | To-do: **Not started** (DEFAULT); In progress: In progress (Blue); Complete: Done (Green) |
| Due date | Date | **Month/Day/Year**, 12 hour, Notifications None |
| Priority | Select | High (Red), Medium (Yellow), Low (Green) |
| Team | Multi-select | Account Management (Default), Business Development (Blue), Product Design (Green), Human Resources (Purple) |

**Status "Not started" colour (B8):** its option menu (Delete, Set as default, Group › To-do, Colors: Default, Gray, Brown, Orange, Yellow, Green, Blue, Purple, Pink, Red) shows **no checked colour** (`23-status-notstarted.png`; no svg in any colour row, "Default" only has the keyboard highlight). Its pill is **rgba(28, 19, 1, 0.11) / rgb(73, 72, 70)** with a grey dot, not the Default select pill rgba(42, 28, 0, 0.07) / rgb(44, 44, 43) seen on "Account Management".

| View | Layout | Shown | Filter / group | Other |
|---|---|---|---|---|
| All Goals | Table | all 6 | none | titles on, vertical lines on, page icon off, wrap off; Load limit 50 |
| By Status | **Board** | 3 | **Group Status**, "Status by Option", Sort Ascending, Hide empty groups off, **Color columns off** | Load limit 25; Card preview None, size Medium, **Card layout List** (`24-goals-card-layout.png`); cards show Priority and Status pills; new-card button "New goal" |
| My Goals | Table | 5 (Goal name, Owner, Priority, Status, Team) | **Filter Owner** | page icon on; folded into **"1 more…"** at once on a page this width; empty (sample rows have no Owner), shows "Edit filters" |

Sample rows (with page icons): Increase sales by 20% (In progress, 02/26/2025, High, Business Development), Launch 3 new products (Not started, 04/16/2025, Medium, Account Management), Acquire 20K new users (Done, 02/03/2025, Medium, Business Development). Owner empty.

### 10g. Board card layout picked by templates (B8)

Both template boards read this session have **Card layout = List** (Brainstorm "By category", Goals "By Status"), read from the screenshot (the List tile has the blue border). Research/27 wrote "Compact" for Tasks Tracker / Projects. That may have come from the row text "Card layout | Compact | List", which lists both tiles and does not say which is picked (a possibility, not verified). Those two are not re-checked.

### 10h. Not measured in B10

Campaign Management … Asset Library (14 templates): only the card thumbnails (10a). Not created, for time. Row-page bodies of the four templates above were not opened.

## B3. Delete-last-view dialog: focus on open

Goals Tracker › "1 more…" › **New data source** › New empty data source. A third tab "Table" (the new source's only view) appeared. Clicked that tab › **Delete view**.

- Dialog (`role=dialog`, `26-delete-last-view.png`): trash icon, "Delete the last view for this data source?", two cards "Delete view only" (picked, red border, red radio) / "Delete view and data source", red "Delete view" button, "Cancel" button, × at the top right.
- **Focus on open: the × button** (`aria-label="Close"`, 24x24). No ring is drawn on open (box-shadow none, outline none).
- **Tab four times: focus stayed on Close** each time, and now it draws a ring: `box-shadow: rgb(248, 248, 247) 0 0 0 2px, rgb(35, 131, 226) 0 0 0 4px, rgba(255, 255, 255, 0.25) 0 0 0 6px`. Tab never moved focus anywhere this session (see B23), so the tab order is **not trusted**; only the focus on open and the ring are.
- The cards are not `role=radio` and not `input[type=radio]` (no radios in the DOM query).
- Closed with Cancel; the menu behind it stayed open, focus then on its "Delete view" row.

## B7. "/" menu leftovers

### 7a. The first Table view insert skips the panel

- On the new scratch page, the **first block** (the line right under the title): "/table view" › Enter (highlighted row "Table view · Database") inserted a database **at once, with no "New database" panel**: title placeholder "New database", one column "Name", "Add property", "New page", no tabs. No dialog was open after it.
- The **second** insert, on a new line below that database, opened the panel (290x465 at x 1210: "New database | New empty data source | Import CSV | Suggested | Tasks Tracker | Projects | Skills | More templates | Link to existing data source"). Every later insert opened the panel too.
- This matches research/28's single sample. Two samples, both "first block on a fresh page". What exactly triggers the skip (first block, empty page, or first database on the page) is not separated.

### 7b. The inline Table view's rendered name

- A one-view inline database renders **no view name** and no tab. At x 817–841, left of Filter, sits a 24x24 icon button `aria-label="Add view"` with no text, but the top element at that point is an element labelled **"Collection actions"** (`elementsFromPoint`: Collection actions › DIV › Add view). A click there opened a 200x255 menu: Copy link to view, Duplicate view, View database, Edit title, Edit icon, Edit layout, Hide title, Manage in Calendar.

- After **Duplicate view** from that menu, the tab bar appeared and the original view's tab read **"Table"** (the copy "Table (1)"). So the one-view inline database's view is named "Table"; the name is just not rendered while it is the only view.

### 7c. Keyboard in the menu

On an empty line, "/" with no query:
- Open: the first row "AI Meeting Notes" is highlighted (index 0 of 25 rendered options; scrollHeight 952).
- ArrowDown moves one row. ArrowUp from the first row goes to the **footer "Close menu  esc"** (highlighted; no option highlighted).
- ArrowUp again from "Close menu" highlighted **"Web bookmark"** (last row of the Media section) and scrolled the menu (scrollTop 706.5, scrollHeight grew to 1866). The next ArrowDown went to **"Table view"** (first row of the Database section). So ArrowUp from the footer goes to the last row the menu had **rendered**, not to the true last row (Embeds); the menu renders more rows as it scrolls.

### 7d. Hint delay and position

`hint.sh`: a MutationObserver records when the hint text appears, timed from the option's `pointerover`.
- Moving the pointer **from one option to another** (the first had been hovered 1.5 s): the new hint text appeared **12–16 ms** after `pointerover` (3 samples: Board, Calendar, Timeline view). So between rows there is no new wait.
- Hint box: bg rgb(44, 44, 43), **x 859 with the menu's right edge at 857** (2 px gap), box 156x158 at y 257 while the option was at y 320–352 and the menu at y 214–459 (the menu opened above the line). The text wraps inside the 156 px box.
- **Cold delay: could not measure.** Entering an option from outside the menu (x 300 → the option), 3 tries, gave no hint within 2.5 s, and two more small moves on "List view" gave none either. Why the hint stopped showing is unknown.

### 7e. Not measured

Why Feed lists no properties (r28:162) and the full-page database's View settings (r28:163): not attempted.

## B6. Relative date format: picker field vs cell, nearby days

First database, row R1 (Due with time 2:00 AM). Cell picker › Date format › **Relative** (the cell picker's submenu lists Full date, Short date, Month/Day/Year, Day/Month/Year, Year/Month/Day, Relative). Then days were clicked in the picker grid. Today was **Wednesday, Oct 21, 2026**.

| Day picked | Picker field | Cell |
|---|---|---|
| Oct 21 (today) | "Oct 21, 2026" / "2:00 AM" | **Today** 2:00 AM |
| Oct 22 (+1) | "Oct 22, 2026" | **Tomorrow** 2:00 AM |
| Oct 20 (−1) | "Oct 20, 2026" | **Yesterday** 2:00 AM |
| Oct 23 (Fri, +2) | "Oct 23, 2026" | **Friday** 2:00 AM |
| Oct 19 (Mon, −2) | "Oct 19, 2026" | **Monday** 2:00 AM |
| Oct 25 (Sun, +4) | "Oct 25, 2026" | **Sunday** 2:00 AM |
| Oct 18 (Sun, −3) | "Oct 18, 2026" | **Last Sunday** 2:00 AM |
| Oct 26 (Mon, +5) | "Oct 26, 2026" | **Next Monday** 2:00 AM |
| Oct 28 (Wed, +7) | "Oct 28, 2026" | **Next Wednesday** 2:00 AM |
| Oct 31 (Sat, +10) | "Oct 31, 2026" | **Next Saturday** 2:00 AM |
| Nov 1 (Sun, +11) | "Nov 1, 2026" | **Next Sunday** 2:00 AM |
| Oct 14 (Wed, −7) | "Oct 14, 2026" | **Last Wednesday** 2:00 AM |
| Oct 13 (Tue, −8) | "Oct 13, 2026" | **Last Tuesday** 2:00 AM |
| Oct 11 (Sun, −10) | "Oct 11, 2026" | **October 11, 2026** 2:00 AM |
| Dec 2, Dec 21 | "Dec 2, 2026", "Dec 21, 2026" | full date |

- **The picker field never shows the relative word.** It always shows "Mon D, YYYY" (the Full date field text), even for today and tomorrow.
- The cell rule from these samples: ±1 day → Today / Tomorrow / Yesterday; other days of **this Monday–Sunday week** → the bare weekday; the **previous** Mon–Sun week → "Last <weekday>"; the **next** Mon–Sun week → "Next <weekday>"; anything further → Full date. (Oct 18, a Sunday 3 days back, is "Last Sunday", while Oct 25, a Sunday 4 days ahead, is "Sunday".)
- The picker grid itself starts weeks on **Sunday** (Su Mo Tu …). The week rule above is Monday-based anyway. Whether a workspace "start week on Monday" setting changes it was not checked.
- Other rows on Today showed "Today 2:00 AM", "Today 1:00 AM", "Today → Today".

## B25. Time zone list

Row R2 (Include time on) › cell picker › **Timezone  GMT+2 ›** (`27-timezone.png`).

- The list opens to the right of the picker: **342 px wide, x 1062, from y 158 to y 705** (547 px tall; the viewport is 717). `max-height` reads `none` on the scroller: the height came from the viewport, **not a 320 px cap**. scrollHeight 26202.
- **It has a search field** at the top: placeholder **"Search cities, timezones…"**, focused on open (306x20 input inside a bordered box, blue focus border in the screenshot). Blok's commit e1eefe62 assumed "no search".
- Section labels **"Current timezone"** and **"Select a timezone"**: 12px / 14.4px / 500, rgb(125, 122, 117).
- "Current timezone" holds one row, **Berlin / GMT+2:00**, with a checkmark (`checkmarkSmall`) at the right.
- Then **567 rows** (568 with Berlin), alphabetical by city: Abidjan, Accra, Addis Ababa, Algiers, Asmara, Asmera, Bamako, Bangui, Banjul, …
- Each row is **two lines**: city 14px / 16.8px / 400 rgb(44, 44, 43), then offset ("GMT", "GMT+3:00") 12px / 16.8px / 400 rgb(125, 122, 117). Row box **334x45**, rows 46 px apart, padding 0 on the row element.
- Typing "tok" filtered fuzzily: Vostok, Tokyo, Vladivostok, Khartoum, Atikokan, Tomsk, Broken Hill, Stockholm, Kanton, Nouakchott, Kentucky/Louisville, …
- Escape closed only the time zone list (the picker stayed, focus on the Timezone row). A second Escape closed the picker.

## B20. Escape in the title cell

First database, row R3: clicked the title cell's text (focus went to a contenteditable inside a `role=dialog` editor showing "R3"), End, typed "x", Escape.
- **Escape saved the title**: the row read **"R3x"**, and still "R3x" after a page reload. The editor closed (focus on BODY, no dialog left).
- A place's address and the bulk editors: not measured (time).

## B17. "Hide data source titles": per view or per block

Goals Tracker (two sources after B3: "Goals Tracker" with All Goals / By Status / My Goals, and an untitled one with view "Table").
- Before: All Goals, By Status and My Goals showed the title "Goals Tracker" above the tabs. The "Table" view (untitled second source) showed no title text.
- All Goals tab › menu › **"Hide data source titles"** (icon `eye`).
- After: the title was gone in **All Goals, By Status and My Goals**. By Status's Layout page then read **"Show data source titles" off**, though it was switched from All Goals.
- So it acts on **every view of the block** (at least every view of that source), not one view. Whether the second source's view changed could not be told (it had no title text before either).

## B23. "N more…" and arrow keys

Goals Tracker tab bar (All Goals, By Status, then "1 more…"). Clicked the By Status tab (focus on it, `role=tab`, selected). ArrowRight ×3, ArrowLeft, Tab: **focus stayed on "By Status" after every key**, and no menu opened.
- So Notion's view tabs do not move focus with arrows. The Tab key not moving focus is suspicious: in B3's dialog Tab did not move either. The extension relay may not perform Tab's default focus move (unverified). Whether arrows ever reach "N more…" therefore reads as "no"; the Tab result is **not trusted**.

## B28. Adding a property: does it show in other views

Goals Tracker, All Goals (table) › header "+" › "Zed" › Text.
- All Goals: the new column "Zed" at the end.
- **By Status (board): not shown.** Property visibility lists it under **"Hidden in board"** (Shown: Goal name, Priority, Status; Hidden: Due date, Owner, Team, **Zed**). Property visibility count stayed 3.
- Gallery, list and calendar views and relation tabs: not measured (no such views on that database; time).
- The tab bar now read "All Goals | By Status | **2 more…**". The cause was not isolated (inference: the "Table" view from B3 is the extra folded tab).

## X2. Property header menu: the (i) "Add property description" button

First database, header "Extra" (Text) › click: header menu 220x469 at (1013, 236). Name row: "Change icon" 28x28 at x 1021, name input "Extra" 133x20, then the **(i) button** `aria-label="Add property description"` (svg `infoCircleFill`, 15x20 at x 1204, inside the right end of the name field).

- The menu's rows: Property access, Change type, AI Autofill, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property. **There is no "Property description" menu item.**
- Hovering (i) for 1.5 s: no `[role=tooltip]` appeared. Notion's hints are not always `role=tooltip` (X1, B24, B26 were found by their text), so a hint could have been missed.
- **Click: an inline field opens right under the name row, inside the same menu** (not a popover). The menu grew 469 → 502 px and moved up (y 236 → 203) to stay on screen. Nothing else opened (`30-prop-desc.png`).
  - Field: a **`<textarea rows=2>`**, placeholder **"Add a description…"**, 13px / 20px rgb(44, 44, 43), focused at once.
  - Its box: 204x26 at x 1021 (left edge = the icon's left edge, so it spans icon + name field), radius 6px, padding 3px 6px, bg rgba(66, 35, 3, 0.03), focus ring `rgb(35, 131, 226) 0 0 0 1px inset, rgb(35, 131, 226) 0 0 0 1px`.
- **Enter** after typing "First line": no new line was added (value stayed "First line"), focus stayed in the field, the menu stayed open.
- **Escape** closed **the whole header menu at once** and **kept** the text: reopening showed the (i) button relabelled **"Edit property description"**, and its field held the text. Typing "Z" then Escape saved "First lineZ" the same way.
- With a description the header cell gets an `infoCircleSmall` icon after the name. Hovering it shows the description in a dark tooltip (bg rgb(44, 44, 43)) **above** the header: 72x44 at (1019, 184) for "First lineZ" (header at y ~252).

## X1. Template list at the right edge: the repeat (↻) hint and the "…" submenu

Setup: first database › "More add options" (the New ▾ chevron) › New template › title "Weekly T" › top button **"Duplicate every…"** › menu Day, Weekday, Week, 2 Weeks, Month, 3 Months, 6 Months, Year › **Week** › "Edit cadence" panel (Every Week, Mo…Su, At "Around midnight", Starting "Tomorrow", End) › **Save**. The button then read "Duplicate every week". No billing word or upgrade glyph on any of these (`gate.sh`). An "Empty" template marked **Default** appeared in the list as well.

Then the page was set to **Full width** (page Actions › Appearance & layout › Full width on). The database block became x 366–1416 in a 1512 px viewport; the chevron sat at x 1384–1408.

**The list** (`31-tpl-list.png`): 360x173 at (1048, 82), right edge 1408. Header "Templates for New database" with a (?) Help button; rows "Weekly T" (drag handle, page icon, **↻ button** 28x24 at x 1346 drawn blue, "…" button 24x24 at x 1376) and "Empty" (grey "Default" tag, "…"); "New template"; "Add shortcut to sidebar".

**↻ hint** (`32-repeat-hover.png`): **"Duplicate weekly"**, dark box (bg not read; dark in the screenshot), 112x27 at (1304, 89): **above** the ↻ icon, centred on it (icon centre x 1360, box centre x 1360), over the list's header row. Delay from `pointerover` on the icon to the hint text appearing: **309, 313, 315, 317 ms** (4 samples, pointer coming from elsewhere on the row or from x 1200).

**"…" hint**: "Edit this template", dark box rgb(44, 44, 43), 115x27 at (1330, 89), above the button. Coming straight from the ↻ icon while its hint showed: **4 ms** (swap, no new wait). From x 1200: one sample **2258 ms**, one sample **no hint within 3 s**. The cold delay is not settled.

**"…" submenu** (click):

| Where the list is | List rect (x, y, w, h, right) | Submenu rect | Opens |
|---|---|---|---|
| Full width, list right edge 1408 (104 px left to the viewport edge) | 1048, 82, 360, 173, 1408 | **1114, 122, 250, 152; right edge 1364** | **to the LEFT of the "…" button, on top of the list** (`33-tpl-more.png`); it covers the row's name area and the "New template" / "Add shortcut" rows |
| Normal width, list right edge 1231 (281 px left) | 871, 82, 360, 173, 1231 | **1235, 122, 250, 152; right edge 1485** | **to the right**, 4 px past the list's edge |

- In both cases the submenu's top is y 122, level with the "Weekly T" row's button top. It never went past the viewport.
- Submenu items: **Duplicate every…  Week ⌄** (the cadence as a value with a chevron), Set as default, Edit, Duplicate, Delete.
- Full width was turned back off afterwards (switch read false).

## B5. Light View settings row `:active` fill

View settings (290x574 at x 1210) of an imported table, row "Sort" (centre 1355, 317). `getComputedStyle(row).backgroundColor`:

| State | Fill |
|---|---|
| Rest | rgba(0, 0, 0, 0) |
| Hover | color(srgb 0.129412 0.105882 0.0901961 / 0.0509804) |
| **Pressed** (mouse down, held 0.3 s and 0.8 s) | **color(srgb 0.129412 0.105882 0.0901961 / 0.101961)** |

- Same ink as hover, **double the alpha** (0.051 → 0.102). Transition `background 0.02s ease-in`.
- The pointer was moved off the row before mouse up, so the row did not activate.

## B24. Side peek handle: hover look

Row R2 › "Open in side peek". Peek 756 px wide at x 756 (viewport 1512).

- The handle is a `role=separator` DIV, **12x717 at x 756** (the peek's left edge, overlapping it), `aria-label="Resize with left and right arrow keys"`, `cursor: col-resize`. (The sidebar has a second separator with the same label at x 269.)
- **Hover changes nothing on the handle**: at rest and after 1.2 s of hover it has bg transparent, no box-shadow, no border, opacity 1, no `::before` / `::after` content, no children. The peek panel's own edge is its shadow `rgba(25, 25, 25, 0.027) 0 8px 12px, rgba(25, 25, 25, 0.027) 0 2px 6px, rgba(42, 28, 0, 0.07) 0 0 0 1px`.
- **Hover shows a dark tooltip** (bg rgb(44, 44, 43)) to the **left** of the handle: two lines **"Close  Click or ⌘\"** and **"Resize  Drag"**. With the pointer at y 360 the box was 112x44 at (634, 338), vertically centred on the pointer. With the pointer at y 300 / 420 the "Drag" text sat at y 301 / 421, so the tooltip follows the pointer's height. The hint words ("Click or", "⌘\", "Drag") are 12px / 400 rgb(173, 169, 163).
- It appeared **21 ms** after `pointerover` in two samples, but the pointer had only been 62 px away (x 700) for 1.5 s, so this may be a warm reshow; a cold delay was not isolated.
- So "Click" on the handle closes the peek (per the tooltip; not clicked here). Escape closed the peek.

## B26. Board calculation hint, and sub-grouping

Goals Tracker › By Status (board grouped by Status).

**Calculation:** clicked a column's count ("1" next to "Not started"): a 200x94 menu **Count | Percent | Date**. Hovering **Count** opens a 250x233 submenu that starts with "Show large counts as 99+" / "This improves performance for large databases." then "Count all", "Count va…" (rest not read). Hovering **Date** opens **Earliest date | Latest date | Date range**. **Latest date** opens a third menu listing the date properties: **Due date** (the only one). After picking it, each column header shows the value next to the group pill: Not started **04/16/2025**, In progress **02/26/2025**, Done **02/03/2025**. The calc applies to every column at once.

- **Hint**: hovering a column's value shows **"Latest date in Due date"**: bg rgb(44, 44, 43), text 12px / 400 rgb(240, 239, 237), box 147x27 at (625, 222), **above** the value (value centre 698, 265), centred on it.
- Delay from `pointerover` on the value: **159, 162, 163 ms** (3 samples, pointer coming from x 500 on the same row).

**Sub-grouping:** View settings › **Sub-group** (icon `squareGridBelowLines`) › "Sub-group by": None, Goal name, Due date, Owner, Priority, Status, Team, Zed. Picked **Priority**. The page then read: Sub-group by Priority, Sort Manual, Hide empty groups, Groups (Hide all): High, Medium, Low, No Priority; "Remove grouping".
- The board (`35-subgroup.png`) keeps the Status columns across the top (with their calc values) and adds **horizontal bands**, one per Priority: a ▼ toggle and the option pill ("High", "Medium") on the left, then one cell per Status column. Every cell has its own "+ New goal" button, empty cells included.
- Only **High** and **Medium** bands showed; **Low** and **No Priority** (no cards) did not. The "Hide empty groups" switch state was not read.
- The chart X-axis picker is excluded (no charts).

## B12. Board: 99+ toggle scope, "Out of range" under a descending sort

**99+ toggle: could not measure its scope.** Goals Tracker's By Status was duplicated (tab menu › Duplicate view → "By Status (1)"). In the copy, column calc menu › hover **Count**: the submenu's first row "Show large counts as 99+" / "This improves performance for large databases." has a switch that is **off and disabled** (`input.disabled = true`, row `role=switch`, opacity 1, no badge or upgrade glyph). Clicking the switch and its label changed nothing. Inference, not verified: it is disabled on a small database (3 rows).

**"Out of range" under a descending group sort.** Imported table (Score 1, 2, 3) › View settings › Group › Score › "Number by" **Range** (choices Unique / Range). Range inputs: from **0** to **2**, "Group every" **1** (hint text "0 to 1, 1 to 2, ..."; defaults were 0, 1000, 100).

| Group sort | Groups listed in the Group page | Order on the table |
|---|---|---|
| Ascending | 1 to 2, 2 to 3, Out of range, No Score | **1 to 2** (Alpha 1), **2 to 3** (Bravo 2), **Out of range** (Charlie 3) |
| **Descending** | 2 to 3, 1 to 2, Out of range, No Score | **2 to 3**, **1 to 2**, **Out of range** |

- **"Out of range" stays after the number ranges in both directions** (and "No Score" after it). Only the ranges flip. Blok's ab1e8c9d flips it to first under descending: that differs.
- With range 0 to 2 every 1, Notion made a **"2 to 3"** bucket holding 2, and only 3 went to Out of range. So the end value 2 is inside the ranges.
- "0 to 1" (no rows) was not listed at all, not even in the Group page's list.

**Date spans under a day** (25caf2c3): not measured.

## B11. Calendar: Escape after a drag box made inside the grid

First database › Duplicate view › its Layout › **Calendar** (Show calendar by Due, Month, Center peek). Cards R4, R3x (1:00 AM), R2 (2:00 AM) sat in the Wed 21 cell.
- **A plain click in an empty day cell creates a page**: mouse down/up at (760, 595) in the Tue 20 cell made a "New page" row dated that day (Due "Yesterday") and opened it in a center peek with the template picker ("Press ‘enter’ to continue with an empty page, or pick a template…", rows Weekly T, Empty, New template). Escape closed it; the row stayed (empty title, in the 20 cell).
- **Drag box from inside the grid**: mouse down at (1000, 640) in the empty part of the Thu 22 cell, moved in 4 steps to (750, 712), mouse up. A rubber-band box with fill **rgba(35, 131, 226, 0.14)** showed during the drag. After mouse up, all four calendar cards (the new page in 20, R4, R3x, R2 in 21) each carried a **selection overlay** with the same fill rgba(35, 131, 226, 0.14), sized to the card (85x38).
  - Caveat: the end point was 5 px from the viewport's bottom, so the page auto-scrolled to its end during the drag. The cards were still selected.
- **One Escape cleared the selection** (no overlay left). A second Escape changed nothing.

## B4. Dark: "Manage in Calendar" arrow, the "/" menu, its hint and the "· Database" suffix

Theme set through Settings › Preferences › Theme › **Dark** (body bg rgb(25, 25, 25)); restored afterwards (see Safety).

**Manage in Calendar**
- View settings row (dialog bg rgb(37, 37, 37)): label rgb(240, 239, 237); leading `calendarDate21` 20x20 fill rgb(230, 229, 227); **trailing `arrowDiagonalUpRightSmall` 16x16, fill rgb(125, 122, 117)**.
- The calendar view's toolbar button "Manage in Calendar" (167x24): text rgb(240, 239, 237), bg transparent, one icon only (`calendarDate21` 16px, fill rgb(240, 239, 237)); **no trailing arrow** on the toolbar button.

**"/" menu** ("/table" on an empty line)
- Menu bg **rgb(37, 37, 37)**, shadow `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.2) 0 14px 28px -6px, rgba(25, 25, 25, 0.118) 0 2px 4px -1px`.
- Rows for "/table": **Table**, **Table view · Database**, Table of contents.
- "Table view · Database": label 14px **rgb(240, 239, 237)**; "·" and "Database" 14px **rgb(125, 122, 117)** (light was rgb(161, 158, 153), research/28). Glyph fill rgb(230, 229, 227).
- Highlighted row (the first, "Table"): bg **color(srgb 1 1 1 / 0.054902)**.
- **Hint** (hover "Table view · Database"): "Add a table view for a new or existing data source", text 12px **rgb(240, 239, 237)**, bg **rgb(44, 44, 43)** (the same as light), shadow `rgba(0, 0, 0, 0.08) 0 4px 12px -2px, rgba(255, 255, 255, 0.05) 0 0 0 1px inset`. Box 156x174 at x 859, to the right of the menu as in light.

## Not measured this round

| Item | Why |
|---|---|
| B1 23:xx | The session ran 00:53–02:33; no 23:xx minute. The page clock was not patched. |
| B7 Feed with no properties; full-page database View settings | Not attempted (time). |
| B10 the other 14 templates (Campaign Management … Asset Library) | Only card thumbnails read (10a). Not created (time). |
| B12 date spans under a day | Not attempted. 99+ scope: the switch was disabled (see B12). |
| B13 Backlinks with 20+ sources | Not attempted (needs 20+ pages mentioning one page). |
| B14 Map pins (link, 100+ pins, colours, warm window) | Not attempted. |
| B15 Form: Created by with anonymous off; "View my response" | Not attempted. "View my response" needs a submitted response through the form link (share/publish was out of scope). |
| B16 Layout builder: leaving by a sidebar click; draft after reload; Content tab moving | Not attempted. |
| B18 Gallery Cmd-click | Cmd/Meta is not forwarded by the extension relay (memory note), and a new tab would take the relay. |
| B19 Reminders (feed alarm, lane gap, bulk, paste default) | Not attempted. |
| B20 Escape in a place's address and in bulk editors | Not attempted (title cell done). |
| B21 Timeline snap at other zooms | Not attempted. |
| B22 Sort-row drag motion | Not attempted. |
| B23 Tab key | Tab did not move focus anywhere this session (also in B3), so focus-order results are not trusted. |
| B27 Light leftovers (c7b979bb, 218fec5b, b8cddcef, 8396d0eb) | Not attempted. |
| B28 gallery, list, calendar views; relation tabs | Only table → board checked. |
| X1 cold delay of the "…" hint | One sample 2258 ms, one sample none in 3 s. |
| B7d cold delay of the "/" hint | No hint appeared when entering from outside the menu (3 tries). |

## Safety and account state

- **No billing surface opened.** Every new control was hovered first and `guard.sh` / `gate.sh` ran around it. `gate.sh` hits were all text false positives: "Plan…" in template descriptions, "Business Development" option names, and Settings' own "Upgrade plan" nav item (not clicked). `guard.sh` flags "New template" / "New data source" for the word "New" (known, research/27). In the workspace menu "Upgrade" sits at (158, 237) and "Settings" at (158, 265); `elementFromPoint(158, 265)` read "Settings" before each click.
- Not used: Notion AI, Copy to Clipboard, charts / dashboards, favorites, share / invite, "Email me a copy", "More in Marketplace".
- Theme: "Use system setting" → Dark → back to **"Use system setting"** (read back; body rgb(255, 255, 255)).
- Page "Full width" was turned on for X1 and off again (read back false) before the page was trashed.
- CSV imports: 3 (two new databases, one merge). Page-side patches (file-input hook, `window.open` stub) were removed by page reloads; the last reload was after the merge.
- Templates used: Document Hub, Brainstorm Session, Meeting Notes, Goals Tracker. No new sidebar entries appeared: the sidebar's leaf list had the same 12 entries before and after (one entry differed only by an emoji leaf of a page the tab navigated to after trashing).
- A repeating template "Weekly T" (Duplicate every week, starting tomorrow) was made in the first database for X1. It went to Trash with the page, before its first run.
- The scratch page "Blok measure scratch 17 2026-10-21" was moved to Trash (page Actions › Move to Trash; toasts "1 block deleted", "Moved to Trash"). Its 7 inline databases went with it. The sidebar then had no "scratch 17" entry. Trashing navigated the tab to another recent page; nothing was clicked there.
- Uncropped screenshots (sidebar visible) were deleted; the rest are cropped to the editor. One local text dump had the account's display name replaced. `.playwright-cli/` snapshots were deleted. The session `notion-measure17` was closed; no other session was touched.
