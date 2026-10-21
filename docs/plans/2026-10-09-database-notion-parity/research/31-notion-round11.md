# Research 31: round 11 measurements

Measured 2026-10-21 (local, from 09:43 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion31 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme: light (body bg rgb(255, 255, 255)).
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure18/` (not in the repo). Helpers copied from research/30 (`notion-measure17/`), session renamed.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Section 8 comes before 7 because Goals Tracker was read first.

## 0. Setup

- Sidebar "New page" › Page. Private page "Blok measure scratch 18 2026-10-21".
- "/" › "Table view · Database" on an empty line: an inline database with only "Name" (no panel; same as research/30 §7a).
- Rows R1, R2, R3 (table "New page" row). Properties added from the header "+": **Notes** (Text), **Due** (Date), **Tag** (Select), **Where** (Place).

## 1. Table header description hint

Setup: header menu of "Notes" › (i) "Add property description" › typed a long text › Escape (saves; research/30 X2). "Due" got the short text "Short one" the same way. Both headers then show `infoCircleSmall` (12x16) after the name. One header without a description (Due, before it got one) showed no hint after 2 s of hover (1 header tested).

`tipm.sh`: move the pointer away to (760, 650) for 2 s, arm a `pointerover` listener and a MutationObserver, jump to the target, read the first frame the text appears in.

**Content: the property name IS included.** Two lines in one box:

```html
<div style="max-width: 280px; width: max-content; overflow-wrap: break-word; text-wrap: wrap; white-space-collapse: preserve-breaks;">
  <div>Notes</div>
  <div style="color: var(--c-texInvSec);">This longer property description is here …</div>
</div>
```

| Part | Value |
|---|---|
| Box | `role=dialog`, bg **rgb(44, 44, 43)**, text rgb(240, 239, 237), **padding 5px 8px**, **radius 6px**, **max-width 300px** (box) / inner wrapper **max-width 280px, width max-content**, shadow `rgba(0, 0, 0, 0.08) 0 4px 12px -2px, rgba(255, 255, 255, 0.05) 0 0 0 1px inset` |
| Font | ui-sans-serif / -apple-system stack, **12px / 400, line-height 16.8px** (both lines) |
| Name line | rgb(240, 239, 237), 12px / 400 (not bold), 1 line, 17 px high |
| Description line | **rgb(173, 169, 163)** (`--c-texInvSec`), `white-space: pre-line` |
| Long text (109 chars) | box **296x77.2** at (508, 176.8); description wraps to **3 lines** at 280 px; name + description = 4 lines |
| Short text "Short one" | box **71.2x43.6** at (708, 210.4): shrinks to the text (max-content) |

- **Position**: above the header cell, **left edges aligned** (box x 508 = header x 508; Due: 708 = 708), box bottom 254 vs header top 260 (**6 px gap**). Screenshot `40-desc-hint.png`.
- **Delay depends on where the pointer lands** (cold, pointer away 2 s before each sample):

| Pointer lands on | Delay (`pointerover` → text in DOM) |
|---|---|
| the (i) icon | **26, 19, 24, 22, 16 ms** (5 samples): no wait |
| the header name text | **519, 510 ms** |
| the empty right part of the header | **515 ms** |

  So the whole header cell carries the hint; the icon shows it at once, the rest of the cell after ~0.5 s.

## 2. Side peek: the resize handle and ⌘\

Row R1 › "OPEN" › side peek 756x717 at x 756. The handle is `role=separator` 12x717 at x 756 (research/30 B24).

- **A click on the handle closes the peek** (mouse down + up at (762, 400) without moving): peek gone, URL lost `?p=…&pm=s`. Matches the handle tooltip "Close · Click or ⌘\".
- **Mouse down alone does not close** (still open 0.5 s after mouse down). Moving to x 700 then mouse up **resized** the peek (756 → 812 wide, x 700) and did not close it.
- **⌘\ does NOT close or toggle the peek in the web app. It toggles the left sidebar**, peek open or not:
  - A keydown listener confirmed the keys reach the page: `key "\\"`, `code "Backslash"`, `metaKey true`, not `defaultPrevented` (Meta+Backslash arrived with `metaKey: true` and the app acted on it).
  - Each Meta+Backslash moved the sidebar separator 269 ↔ 19 (sidebar x 0 ↔ -250); the peek stayed at x 756 every time.
  - Same with focus in the peek's title H1, with focus on BODY, and with the pointer resting on the peek handle (second session check).
- **Ctrl+\\**: no effect on peek or sidebar.
- Escape closes the peek (one press, also with the caret in the title).
- Not measured: the desktop app (the tooltip's "⌘\" may refer to it; inference only).

## 3. Board sub-group bands

Goals Tracker (made for §8) › By Status (board grouped by Status; its Group page: Sort Ascending, **Hide empty groups off**, Color columns off) › View settings › **Sub-group** › "Sub-group by" list (None, Goal name, Due date, End value, Owner, Priority, Progress, Quarter, Start value, Status, Team) › **Priority**.

- **"Hide empty groups" on the Sub-group page reads ON right after picking** (the only switch there; `aria-checked`/`checked` true), while the board's own Group page keeps it off. Bands shown: **High, Medium**; Low and No Priority (no cards) are hidden. Groups list: High, Medium, Low, No Priority; Sort Manual.
- Band header: a **▼ toggle**, the option pill, and on hover "…" and "+" after the pill. A "+ New group" row sits under the last band. Every cell has "+ New goal" (`49-subgroup.png`).
- **The toggle**: `role=button` **24x24**, radius 4px, transparent at rest, hover bg `color(srgb 0.129 0.106 0.090 / 0.051)`. Icon `arrowCaretDownFillSmall` **11x11**, fill rgb(44, 44, 43), `transition: transform 0.2s ease-out`. `aria-label="Close"`, `aria-expanded="true"` when open.
- **Click = collapse the band**: its whole row of cells (cards and "+ New goal") goes away. The header row stays, with the pill and the "…" / "+" buttons. No card count is shown. The button becomes `aria-label="Open"`, `aria-expanded="false"`, and the icon turns to `matrix(0, -1, 1, 0, 0, 0)` (−90°, points right) (`50-subgroup-collapsed.png`). The columns' counts at the top did not change (1, 1, 1).
- **Persisted**: after a page reload High was still collapsed (`Open`/false). The Sub-group page's group list did not change (no eye or hidden mark for High). Clicking again expanded it.
- Not measured: whether the collapse is per user or shared.


## 4. Escape in the Place editor and in bulk editors

### 4a. Place (single cell, "Where")

- Empty cell click: a 240 px popover with a focused input, placeholder **"Search for a location..."**, a "Current Location" row. Typing shows "Loading..." and "Results may be limited. Learn more." then results (5–10 s here).
- **There is no draft**: every change is written at once.
  - Picking a result (click, or ArrowDown + Enter) **saves immediately**; the popover switches to a "view" state: a chip button with the name ("Berlin, Germany"), a "Clear location field" × button, a 232x168 map (`region` "Map") and an "Open in Google Maps" link (seen in a screenshot that was not kept; `41-place-search.png` shows the earlier "Loading..." state). Clicking the name chip does nothing.
  - The × **clears the cell immediately** and returns to the search input.
  - **Typing any character in the view state clears the saved place at once** (cell read "" right after typing "R") and opens the search.
- **Escape = cancel the search only**:
  - Query typed, no pick, Escape → popover closes, cell stays empty.
  - Query typed, a result highlighted with ArrowDown, Escape → **not saved** (cell empty).
  - After clear + typing "Paris", Escape → cell stays **empty**: the old value is not restored.
  - After a pick, Escape → closes, value kept (it was already saved).

### 4b. Bulk editors (rows R1–R3 selected with their checkboxes)

The selection bar: "3 selected", then icon-only buttons with `aria-label` = property name (Notes, Due, Tag, Where), Move to Trash, "…".

| Editor | What it shows on open | After typing, before Escape | After **Escape** | Selection after Escape |
|---|---|---|---|---|
| **Text** (Notes) | contenteditable, **prefilled with the shared value** ("bulkA"), caret at end | cells update **live** on every key ("bulkAB" in all 3) | **kept** (value stays) | **cleared** (bar gone, one Escape) |
| **Select** (Tag) | "Select an option or create one" | query "alpha" → row "Create alpha" | **cancelled**: nothing created, cells empty | **kept** (3 selected) |
| Select, Enter on "Create alpha" | | all 3 cells "alpha", menu closes | (n/a) | **cleared** by Enter |
| **Date** (Due) | picker, input prefilled with **today** ("Oct 21, 2026"); cells NOT set on open | typed "Oct 5, 2026" in the input: cells still empty | **saved**: all 3 "October 5, 2026" | **kept** |
| **Place** (Where) | **the first selected row's value** (R1 "Paris, Ile-de-France, France") in view state, though R2/R3 were empty | typing one key **cleared all 3 cells at once** | search cancelled; **all 3 stay empty** (R1's Paris lost) | **kept** |

So Escape commits text and date, cancels select and place searches. Bulk Place shows R1's value as if shared.

## 5. CSV "Merge with CSV"

Entry: database opened as full page ("Open as full page" ↗) › top-right **Actions** › "Merge with CSV" (`arrowMergeUp`). The Actions menu also showed a "Get Notion Calendar / Connect Calendar" promo card (the database had a calendar view); not clicked. Files fed with the `hook.sh` page hook.

Target database: Name (title), Notes (Text), Due (Date), Tag (Select), Where (Place).

### 5a. Layout (step 1)

- Modal **1000x637** at (256, 40), bg rgb(249, 248, 247), radius 12px, shadow `rgba(25, 25, 25, 0.24) 0 24px 48px 0, rgba(25, 25, 25, 0.14) 0 4px 12px 0, rgba(42, 28, 0, 0.07) 0 0 0 1px`. Close × 26x26 at the top-left (282, 66).
- **Left column** (x 280, 322 wide), top to bottom:
  - "Import CSV into Notion" 26px / 600 rgb(44, 44, 43), at y 92.
  - "Create a new database with your CSV or merge it into an existing one" 14px / 400 rgb(125, 122, 117), 2 lines.
  - Label "**Upload CSV**" 12px / **500** rgb(125, 122, 117) at y 200; "Choose file" button 322x32. After a file: a chip with a file icon, the file name 14px / 500, and a "Clear file" × (24x24).
  - Label "**Import Location**" 12px / **400** (lighter than "Upload CSV") at y 282; a **322x36 button, disabled**, database icon, the target database's title (**"New database"**, the untitled target's placeholder) 14px, up/down chevron.
  - Bottom: "Map CSV headers" 322x36 blue (text rgb(243, 249, 253)), disabled until a file is chosen; "Learn about imports" 322x32 with a (?) icon.
- **Right column** (x ~700): before a file, title "New table" 22px / 600 grey and a skeleton table (3 columns of 9 px bars); after a file the title becomes the **file name without .csv** ("blok-r31-merge"), still skeleton (`44-merge-file.png`).

### 5b. Mapping (step 2 "Setup CSV columns")

CSV `Name,Notes,Due,Score,tag` (rows R1 / R7):

| CSV column | Property Type button (default) |
|---|---|
| Name | **Name** (existing title) |
| Notes | **Notes** (existing) |
| Due | **Due** (existing; preview "March 4, 2026" from `2026-03-04`) |
| Score | **Number** (new property, detected type) |
| **tag** (lower case) | **Tag**: **header matching is case-insensitive** |

- Left: "Use first row as headers" switch (on), columns "CSV File Columns" (disabled buttons with the header) and "Property Type" (145x32 buttons). Bottom: "Import CSV" (blue), "Cancel".
- Right preview: the target title, a "Table" tab, then columns **Name, Notes, Due, Score, Tag, Where**: the CSV columns in CSV order, then the existing unmapped **Where** (empty). Rows R1, R7 (`45-merge-map.png`).
- The type picker (240 wide): heading "Existing property", rows **Don’t import** (`eyeSlash`, highlighted on open), then existing properties, then **"Add new property ›"**. **Where (Place) is never listed**, in either file. The current mapping has a `checkmarkSmall`. A property already used by another column is still offered. The order changed between the two imports (first: Name/Title, Notes, Due, Tag; second: Score, Tag, Due, Notes, Name/Title).
- Escape closes only the picker.

**Result** (closed with the top-right ×, then page reload; the view did not show new rows before reload in research/30):

- Rows **appended, not merged**: "R1 | merged note | March 4, 2026 | alpha | | 5" became a second R1; existing R1 untouched.
- New property **Score** (Number) at the **end of the table** (after Where), not where the preview put it.
- Tag value "gamma" created a new select option; "alpha" reused the existing option.
- The new rows went **after the original R1–R3 and before 3 rows created later from the calendar** (so not at the very end); within the import, reversed file order (R7 then R1).
- "Import complete" step: same 1000x637 modal, "Import complete" 22px / 700, "Your CSV import was successful", "Go to import" button (not clicked), × at (1234, 62).

### 5c. Headers off, merge

CSV with no header line: `R8,hdr off,2026-03-06,9,delta` / `R9,second,2026-03-07,10,alpha`.

- With the switch **on** (default) the first line is read as headers: title column → **Name**, the rest → new properties named after R8's values ("hdr off" Text, "2026-03-06" Date • Full date, "9" Number, "delta" Text). The preview listed those new columns first, then the existing Score, Tag, Due, Where, Notes.
- **Switching it off changed nothing in the modal** (buttons, preview; checked=false read back), same as research/27 and /30.
- Mapped by hand: col 2 → Notes, col 3 → Due, col 4 → Score, col 5 → Tag. The preview then used the target's order (Name, Notes, Due, Score, Tag, Where) and still showed only R9 as a row.
- **Imported with headers off: both R8 and R9 became rows** (R8 | hdr off | March 6, 2026 | delta | | 9). So the switch does act at import time, though the preview ignores it. **The title column maps to the existing title "Name"**; no "Column N" properties were made because every column was mapped. Unmapped-column naming under headers off in a merge: not measured (research/30 §9c measured "Column N" for a new database).
- The second import's rows sat **above** the first import's (R9, R8, R7, R1), still after R3.

## 6. Calendar: day number and empty-day clicks

Calendar view (duplicate of the table, Layout › Calendar, by Due, Month), October 2026.

- Day number: a 8x24 DIV ("7"), 14px rgb(44, 44, 43), `cursor: default`, no bg, **no hover change**. Hovering anywhere in the cell shows an **"Add an item"** (+) button 20x20 at the cell's top-left (844, 506).
- **Single click on the day number: nothing** (no page, no peek, no menu; 3 tries, the last with event capture: `click detail 1` on a `notion-calendar…` element).
- **Single click on empty space in a day: also nothing** (5 tries, incl. `page.mouse.click`). Capture listeners showed `mousedown`/`mouseup`/`click` all with `detail 1`. Two separate single clicks 250 ms apart (each `detail 1`, no `dblclick`): nothing.
- **Only a real double click creates a page**: `page.mouse.dblclick` fired `click detail 1`, `click detail 2`, `dblclick detail 2` and made a row (count 6 → 7) plus a center peek.
- research/30 B11 wrote that a plain click created a page. Hypothesis (not verified): that click was the second of two quick clicks, so the browser counted it as a double click.
- **Double-click on empty space** in Wed 7: creates a page dated that day and opens it in a **center peek** (`pm=c`).
- **Double-click on the day number** "8": **also creates a page** dated Oct 8 (read later in the table: "October 8, 2026") and opens the center peek. The number is not a separate target.
- **Events selected** (drag box from Sun 4 over Mon 5's cards; R2 and R3 got the rgba(35, 131, 226, 0.14) overlay; the page auto-scrolled 541 px during the drag):
  - **Single click on an empty day (14): clears the selection**, creates nothing.
  - **Double-click on an empty day with events selected**: the selection is cleared and a page is created on that day (center peek).

## 8. Goals Tracker: the off-by-default chips Quarter, Progress, Days until due

"/" › Table view › panel › More templates › gallery › More templates › **Goals Tracker** › Customize. Step 1 chips: Due date, Priority, Team **on**; Quarter, Progress, Days until due **off** (same as research/30). All three were turned on, then step 2 **By Team** was turned on too, then Done.

**What each chip adds** (live preview, step 1):

| Chip | Columns it adds | Where in the column order |
|---|---|---|
| Quarter | **Quarter** | after Priority, before Team |
| **Progress** | **three**: **Start value**, **End value**, **Progress** | after Team, at the end |
| Days until due | **Days until due** | preview: at the end; in the created schema: after Due date |

Preview with all on: Goal name, Owner, Status, Due date, Priority, Quarter, Team, Start value, End value, Progress, Days until due. The preview sample rows showed Quarter empty, Progress 0%, Days until due "Overdue".

**Created schema** (Edit properties order): Goal name, Owner, Status, Due date, **Days until due**, Priority, **Quarter**, Team, **Start value**, **End value**, **Progress**.

| Property | Type | Settings / options |
|---|---|---|
| **Quarter** | **Multi-select** | Sort Manual. Options **Q1 (Yellow)**, **Q2 (Pink)**, **Q3 (Green)**, **Q4 (Gray)**. Pills: Q1 rgba(209, 156, 0, 0.282) / rgb(101, 81, 33); Q2 rgba(183, 0, 78, 0.153) / rgb(104, 53, 78); Q3 rgba(0, 96, 38, 0.157) / rgb(42, 83, 60); Q4 rgba(28, 19, 1, 0.11) / rgb(73, 72, 70) |
| **Start value** | **Number** | Number format Number, Decimal places Default, Show as **Number** |
| **End value** | **Number** | same as Start value |
| **Progress** | **Formula** | **`Start value/End value`** (formula text as stored, a line break after "/"). Number format **Percent**, Decimal places Default, **Show as Bar** (the Show-as page lists Number / Bar / Ring and adds **Color Green** and **Show number** rows; the cell renders `role=progressbar` `aria-valuenow`, a 123x4 track rgba(42, 28, 0, 0.07) and a fill **rgb(70, 161, 113)**; the board cards show the same bar) |
| **Days until due** | **Formula** | **`if(dateBetween(Due date, now(),"days")>0,dateBetween(Due date, now(),"days"), "Overdue")`** (line breaks before each "Due date" in the stored text). Returns a number of days or the text "Overdue". No number format rows on its page. |

Other properties: same as research/30 §10f (Owner Person; Status Not started DEFAULT / In progress Blue / Done Green; Due date Month/Day/Year, 12 hour; Priority High Red / Medium Yellow / Low Green; Team multi-select Account Management Default / Business Development Blue / Product Design Green / Human Resources Purple).

**Sample rows** (table "All Goals"):

| Goal | Status | Due date | Days until due | Priority | Quarter | Team | Start | End | Progress |
|---|---|---|---|---|---|---|---|---|---|
| Increase sales by 20% | In progress | 02/26/2025 | Overdue | High | **Q2** | Business Development | **15** | **20** | **75%** |
| Launch 3 new products | Not started | 04/16/2025 | Overdue | Medium | **Q3, Q4** | Account Management | **0** | **3** | **0%** |
| Acquire 20K new users | Done | 02/03/2025 | Overdue | Medium | **Q1** | Business Development | **25** | **20** | **125%** |

(The preview showed Quarter empty and 0% before Done; the created rows carry these values.) Progress above 100% is not capped (125%, full bar).

**Views** (the new data: By Team and the My Goals filter; All Goals and By Status as research/30):

| View | Layout | Shown | Filter / group | Other |
|---|---|---|---|---|
| All Goals | Table | all 11 | none | |
| By Status | Board | (as research/30) | Group Status, Sort Ascending, Hide empty groups off, Color columns off | |
| My Goals | Table | Goal name, Owner, Priority, Quarter, Status, Team (6) | **Filter "Owner: Contains Me"** | titles on, vertical lines on, page icon on, wrap off; Side peek; Load limit 50 |
| **By Team** (off by default) | **Table** | Goal name, Status, Owner, Team, Priority, Quarter (6) | **Group by Team**, Sort Manual, Hide empty groups **off**; groups Account Management, Business Development, Human Resources, Product Design, No Team | titles on, vertical lines on, page icon on, wrap off; Side peek; **Load limit 25** |

With the extra views on, the tab bar read "All Goals | By Status | 2 more…".

## 7. More templates: schemas beyond the four in research/30

Path: "/" › "Table view · Database" on a new line › panel › **More templates** opens a large gallery modal (search field, "Empty database", "Existing data sources" with the user's own databases, then "Templates") › its own "More templates" row expands the full list. Gallery order this session (`tpl-cards-31.txt`): Tasks Tracker, Projects, Skills, Document Hub, Brainstorm Session, Meeting Notes, Goals Tracker, **Campaign Management, Content Calendar**, Event Management, Social Media Planner, Issue Tracking, Feature Requests, Engineering Docs, Fundraising Tracker, Pipeline Tracking, Account Management, Creative Projects, Inventory Management, Product Roadmap, Asset Library, then "More in Marketplace" (not opened).

Each card was hovered first: no tooltip, no badge, no svg. `gate.sh` hits were only the option name "Business Development" (false positive). No upgrade or checkout appeared. Each template was created with its **default** chips and views (Done), then read through Edit properties (`schema*.sh`) and each view's settings pages (`vall.sh`). Colour names are the checked colour in each option's menu. "Chip on/off" = the Customize step 1 feature chips; "view card" = step 2.

### 7a. Campaign Management

Step 1 chips: **Campaign type, Markets, Channels, Audiences targeted, Files & media** on; **Owner, Budget** off (not created, so their types are not measured). Step 2: **By Status, All Campaigns, Calendar** on; **By Market** off. Preview footer: "3 hidden properties".

| Property | Type | Options (colour) / settings |
|---|---|---|
| Campaign name | Title | |
| Channels | Multi-select | Blog (Green), Email (Yellow), Instagram (Purple), X (Gray), Tiktok (Purple), Linkedin (Blue), Google (Brown); Sort Manual |
| Markets | Multi-select | AMER (Orange), EMEA (Gray), APAC (Purple), UK (Yellow), FR (Brown), LATAM (Green) |
| Campaign type | Multi-select | Product launch (Gray), Brand awareness (Brown), Lead generation (Blue), Sales promotion (Green), Content marketing (Yellow), Email marketing (Default) |
| Audiences targeted | Multi-select | Demographic 1 (Yellow), Demographic 2 (Blue), Demographic 3 (Red) |
| Completion date | Date | Full date, 12 hour, Notifications None |
| Files & media | Files & media | Limit No limit |
| Status | Status | **To-do**: Blocked (Red), Not started (DEFAULT, no checked colour); **In progress**: Planning (Yellow), On Hold (Orange), In Production (Purple); **Complete**: In Flight (Blue), Complete (pill rgba(0, 96, 38, 0.157) / rgb(42, 83, 60), the Green pill; its menu did not open, colour not read) |

| View | Layout | Shown | Group / filter / sort | Other |
|---|---|---|---|---|
| By Status | **Board** | Campaign name, Channels, Markets, Campaign type (hidden: Audiences targeted, Completion date, Files & media, Status) | **Group Status** "by Option", Sort Manual, switches read **Hide empty groups on**, **Color columns on**; no filter, no sort | titles on, page icon on, wrap off, Fit media off; **Card preview Files & media**, Card size Medium; Side peek; Load limit 25. Caveat: the board text still listed "On Hold 0", "In Production 0", "In Flight 0", "Complete 0" columns although the switch read on (not resolved). |
| All Campaigns | Table | Campaign name, Status, Audiences targeted, Campaign type, Channels, Markets, Files & media, Completion date | none | titles on, vertical lines on, page icon off, wrap off; Side peek; Load limit 50 |
| Calendar | **Calendar** | Campaign name only | none | **Show calendar by Completion date**, Month, Show weekends on; titles on, page icon on, wrap page titles off; **Center peek** |

Tab bar after create: "By Status | All Campaigns | 1 more…".

Sample rows: New mobile app (Blocked, Demographic 3, Product launch, X, EMEA, March 28, 2025), Engineering content (Not started, Demographic 2, Sales promotion, Linkedin, AMER, March 18, 2025), Win the market (Planning, Demographic 1, Brand awareness, Instagram, APAC, March 13, 2025). Files & media empty.

### 7b. Content Calendar

Step 1 chips: **Publish date, Platform, Content type, Owner, Post URL** on; **Accounts** off (not created). Step 2: **Calendar, All Content, By Status** on; **By Platform** off. Preview: a calendar, footer "7 hidden properties".

| Property | Type | Options (colour) / settings |
|---|---|---|
| Content name | Title | |
| Content type | Select | Live stream (Default), Long form video (Purple), Story / short form video (Gray), Social post (Red), Podcast (video) (Pink), Podcast (audio) (Orange), Blog article (Blue); Sort Manual |
| Film date | Date | Full date, 12 hour, Notifications None |
| Owner | Person | No limit, No default, Users only |
| Platform | Multi-select | LinkedIn (Default), Tiktok (Yellow), X (Blue), YouTube (Gray), Instagram (Purple), Spotify (Pink), Email (Red), Blog / website (Orange) |
| Post URL | URL | Show full URL |
| Publish date | Date | Full date, 12 hour, Notifications None |
| Status | Status | **To-do**: Idea (DEFAULT, no checked colour); **In progress**: Drafting (Yellow), Filming (Red), Editing (Orange), Ready for review (Purple), In review (Pink), Approved for publishing (Blue), Scheduled (Orange); **Complete**: Published (pill rgba(0, 96, 38, 0.157), the Green pill), On hold (pill rgba(127, 51, 0, 0.157), the Brown pill). The script failed on the last two menus, so their checked colours were not read. |

- A property **"Status (1)"** (Status type, same groups and options, every row "Idea") showed up at the end of the schema **after** the schema script ran. It is not in the Edit properties list the script read first. It is **probably an artifact of the script**: its last two option clicks failed, and "Duplicate property" sits at the bottom of that page. This is not verified. Treat it as not part of the template.

| View | Layout | Shown | Group / sort | Other |
|---|---|---|---|---|
| Calendar | **Calendar** | Content name (+ Status (1), see above) | **Sort Publish date, new → old** | **Show calendar by Film date**, Month, Show weekends on; titles on, page icon on, wrap page titles off; **Center peek** |
| All Content | Table | Content name, Owner, Status, Film date, Publish date, Content type, Platform, Post URL | **Sort Publish date new → old** | titles on, vertical lines on, page icon off, **wrap all content on**; Side peek; Load limit 50 |
| By Status | **Board** | Content name, Owner, Content type, Platform | **Group Status** by Option, Sort **Ascending**; switches read Hide empty groups on, Color columns on; **Sort Publish date new → old** | titles on, page icon on, wrap on, Color columns on; Card preview None, Card size Medium; Side peek; Load limit 25. All 10 status columns were drawn, the empty ones too (counts 0). |

Sample rows: Product launch (Idea, Film March 11, 2025, Publish March 28, 2025, Story / short form video, YouTube, x.com/NotionHQ), Opinion piece (Approved for publishing, February 19 / March 27, 2025, Social post, Instagram, x.com/NotionHQ), Blog post (Published, February 10 / February 13, 2025, Blog article, LinkedIn + Blog / website, x.com/NotionHQ). Owner is empty.

### 7c. "Hide empty groups" reads on, but empty columns show

For both Campaign Management's and Content Calendar's By Status boards, the Group page's first switch reads `checked=true`. Its label was matched by row geometry as "Hide empty groups". Yet the boards draw every empty status column. A screenshot of Campaign shows "On Hold" with "+ New campaign" and no cards (`51-campaign-board.png`). On the Goals sub-group (§3) the same switch read true and the empty bands were hidden. So Notion may not apply the switch to Status-grouped columns, or the read is wrong. This is not resolved.

## Not measured this round

| Item | Why |
|---|---|
| 7: the remaining 12 templates (Event Management … Asset Library) | Time. Each one took about 10 minutes to read. Only the card thumbnails are known (research/30 §10a; the same list again in `tpl-cards-31.txt`). |
| 7: Campaign's Owner and Budget, Content Calendar's Accounts, the off view cards (By Market, By Platform) | Left off, so never created. Their types are not known. |
| 7: card layout tile (Compact / List) on the template boards | The tiles' ring read was unclear (one "List" element had an inset ring). Not settled. |
| 2: ⌘\ in the desktop app | Only the web app was used. |
| 3: whether a band collapse is per user or shared | One account only. |
| 4: the Place editor inside a row page / peek | Only the table cell and the bulk bar were tried. |
| 5: naming of unmapped columns with headers off in a merge | Every column was mapped by hand. |
| 1: the hint on a header in a board, list or gallery | Only table headers were tried. |

## Safety and account state

- **No billing surface opened.** Each new control was hovered or guarded first. `gate.sh` hits were text false positives ("Business Development", "Plan…" in descriptions).
- Not used: Notion AI, Copy to Clipboard, charts, dashboards, favorites, share or invite, "Email me a copy", "More in Marketplace", "Go to import". In the full-page database's Actions menu, a "Get Notion Calendar / Connect Calendar" promo card appeared. It was not clicked.
- **Sidebar**: ⌘\ collapsed it several times. Each time it was restored, and the separator was read back at x 269.
- **Side peek width**: the resize tests left it at 750 px. It was dragged back to **756** and read back. Small drags (under ~10 px) did nothing.
- **CSV**: two merges went into the scratch database. The page-side file hook was cleared by the navigations and reloads that followed.
- **Templates** (Goals Tracker, Campaign Management, Content Calendar) were created only on the scratch page. No database templates were made.
- The scratch page "Blok measure scratch 18 2026-10-21" went to Trash (page Actions › Move to Trash; "Moved to Trash" toast). Its 5 databases went with it. The sidebar leaf list matched the list taken before the session. After trashing, the tab moved to another recent page. Nothing was clicked there.
- A gallery screenshot that showed the user's own databases was deleted. `.playwright-cli/` snapshots and the sidebar text dumps were deleted. The files directory was grepped for page names and the account name, with no matches. The kept screenshots are cropped to the editor.
- Theme stayed light the whole time. The session `notion31` was closed. No other session was touched.
