# Research 33: round 12 measurements

Measured 2026-10-21 (local, from 21:46 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion33 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme: light unless a section says dark.
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure33/` (not in the repo). Helpers copied from `notion-measure18/` (research 31), session renamed.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Input: list A item 10 and list B of `32-parity-status-2026-10-21-r12.md`, plus a colour dump asked for during the session.

## 0. Setup

- Sidebar "New page" › "Page". Private page "Blok measure scratch 33 2026-10-21".
- "/" › "Table view · Database" on an empty line. Properties added from the header "+": **Notes** (Text), **Due** (Date), **Tag** (Select). Rows R1, R2, R3.
- `sw.sh` (switch reader) was changed this round: each switch is now labelled by the text leaf on its own row (same y, left of the switch). Before the change it printed "=true" with no label. Rows read before the change (Event Management and Social Media Planner view Layout pages) are labelled **by row order** (the page text order), marked "(order)".

## 1. List A item 10: a header without a description shows no hint

`hint0.sh x y`: pointer away at (760, 650) for 2 s, a MutationObserver on `body` (childList, subtree), pointer onto (x, y), wait **3 s**, then list visible `[role=tooltip]` / `[role=dialog]` and every added element with a size.

| Header | Point 1 (left, cursor `grab`) | Point 2 (right part, cursor `pointer`) |
|---|---|---|
| Name (title) | none | none |
| Notes (Text) | none | none |
| Due (Date) | none | none (one 4x0 empty div added at 1169 ms) |
| Tag (Select) | none (4x0 empty div at 1154 ms) | none (4x0 empty div at 1140 ms) |

The 4x0 div has no text and no height. No tooltip or dialog appeared on any of the 8 samples.

**Positive control**, same script: Tag › header menu › (i) (`infoCircleFill`, no tooltip on hover) › typed "Tag desc control" › Escape. The header gained `infoCircleSmall`. Hover on the right part: a `role=dialog` "Tag / Tag desc control" was added at 1589 ms after the move (the observer clock includes the 2 s script gap; `tipm.sh` timed it as **512 ms** from `pointerover`). Box 110x43.6 at (1108, 210.4), bg rgb(44, 44, 43), padding 5px 8px, radius 6px, same as research 31 §1.

**Result: confirmed on 3 more headers (4 in all). A header with no description shows no hint at all.**

## 2. Session blocker: Cmd+Z reaches the page

A capture-phase `keydown` / `keyup` / `beforeinput` listener on `document`. Caret in a new text block after typing "undo probe abc". `press Meta+z`:

```
keydown key=Meta code=MetaLeft meta=true
keydown key=z code=KeyZ meta=true ctrl=false defaultPrevented=false (at capture)
keyup   key=z code=KeyZ meta=true
keyup   key=Meta code=MetaLeft meta=false
```

- The block text went from "undo probe abc" to "" (Notion's undo ran).
- `press Meta+Shift+z` brought "undo probe abc" back (redo ran).
- No `beforeinput` fired for either (Notion handles undo on keydown).

**Result: Cmd+Z and Cmd+Shift+Z keydowns arrive with `metaKey: true`, and Notion acts on them.** Cmd-click was not tried.

## 3. B6 templates

### 3.0 Method

Path: new empty line › "/" › "Table view · Database" › panel › "More templates" › the gallery's own "More templates" row (expands the list) › the template card. Each card was hovered first: no tooltip, no badge, no svg on any card. The gallery's "Existing data sources" section lists the user's own databases; it was never clicked and is not recorded.

**Deviation from research 31, on purpose:** each template was first read with its default chips (Customize step 1) and default view cards (step 2). Then **every chip and every view card was turned ON** before "Done", so that the off-by-default properties and views exist and can be read. So:

- "Default" columns below are the template's own defaults.
- The schema and the view rows are read from the all-on database. A property that is off by default shows up in the views' shown / hidden lists only because it was turned on.

Schema: Edit properties › each property's page (`schemat.sh` / `schemap.sh`). Option colours: the checked colour in each option's menu (`optcolor.sh`), or "by pill" when matched to the pill table in 3.1. Views: each view's Layout, Property visibility, Filter, Sort and Group pages (`vall.sh`). Card layout: `cardlay.sh`.

### 3.1 The ten option colours (light, pills)

Read off option pills whose menu showed the checked colour:

| Colour | Pill background | Pill text |
|---|---|---|
| Default | rgba(42, 28, 0, 0.07) | rgb(44, 44, 43) |
| Gray | rgba(28, 19, 1, 0.11) | rgb(73, 72, 70) |
| Brown | rgba(127, 51, 0, 0.157) | rgb(88, 68, 55) |
| Orange | rgba(196, 88, 0, 0.204) | rgb(106, 66, 34) |
| Yellow | rgba(209, 156, 0, 0.282) | rgb(101, 81, 33) |
| Green | rgba(0, 96, 38, 0.157) | rgb(42, 83, 60) |
| Blue | rgba(0, 118, 217, 0.204) | rgb(38, 74, 114) |
| Purple | rgba(92, 0, 163, 0.14) | rgb(85, 59, 105) |
| Pink | rgba(183, 0, 78, 0.153) | rgb(104, 53, 78) |
| Red | rgba(206, 24, 0, 0.165) | rgb(109, 53, 49) |

A Status option marked DEFAULT draws the **Gray** pill but its menu has no checked colour.

### 3.2 Card layout tile (board Layout page, "Card layout | Compact | List")

Each tile is a `BUTTON` 109x82, radius 10px, bg white, no ARIA state. The picked one is told only by its outline and its label ink:

| | Outline | Label ink |
|---|---|---|
| Picked | **2px solid rgb(39, 131, 222)** | rgb(44, 44, 43) |
| Not picked | 1px solid rgb(230, 229, 227) | rgb(125, 122, 117) |

<!-- per-template card layout goes in each template's section -->

### 3.3 "Hide empty groups" on a Status board (research 31 §7c), settled by behaviour

Event Management › By Status (board grouped by Status). `hidetest.sh` counted the board's column headers, flipped the Group page's first switch, closed the menu, counted again, then repeated:

| Step | Switch reads | Columns drawn |
|---|---|---|
| Fresh from the template | Hide empty groups **true** | **6**: Not started 0, Planning 1, Pending review 0, Registration open 1, Done 1, Cancelled 0 |
| Flip 1 | false | 6 (same) |
| Flip 2 | **true** | **3**: Planning 1, Registration open 1, Done 1 |

**Result:** the switch works on Status boards. A template board's switch reads on but its empty columns still draw until the switch is set by hand. The stored template state and the switch disagree. This explains research 31 §7c (both Campaign and Content Calendar). Only Event Management was flipped; the others are inferred from the same reading (on, empties drawn).

### 3.4 Event Management

Card text: "Plan and manage your events." Customize preview footer "0 hidden properties".

Step 1 chips, default: **Event owner, Category, Format, Venue** on; **Budget, Capacity, Event URL** off.
Step 2 view cards, default: **All Events, By Status, Calendar** on; **By Category, My Events** off.

| Property | Type | Settings / options (colour) |
|---|---|---|
| Event name | Title | |
| Event date | Date | Full date, 12 hour, Notifications None |
| Status | Status | **To-do**: Not started (DEFAULT, no checked colour); **In progress**: Planning (Blue), Pending review (Pink), Registration open (Yellow); **Complete**: Done (Green), Cancelled (Red). "Display as Select" |
| Event owner | Person | Limit No limit, Default No default, "Users only" |
| Format | Select | Sort Manual. In person (Purple), Virtual (Green) |
| Category | Select | Sort Manual. Webinar (Green), Conference (Gray), Tradeshow (Red), Workshop (Default), Internal event (Blue), Partner event (Yellow), Community meetup (Orange), Team building (Pink), Retreat (Purple **by pill**; its menu click missed) |
| Venue | Select | Sort Manual. Venue 1 (Yellow), Venue 2 (Orange), Venue 3 (Default) |
| Capacity | Number | Number format Number, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Budget | Number | Number format **US Dollar**, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Event URL | URL | Show full URL |

Edit properties order: Event name, Event date, Status, Event owner, Format, Category, Venue, Capacity, Budget, Event URL.

| View | Layout | Shown | Filter / sort / group | Other |
|---|---|---|---|---|
| All Events | Table | all 10 | **Sort Event date new → old** | (order) titles on, vertical lines on, page icon off, wrap off; Side peek; Load limit 50 |
| By Status | **Board** | Event name, Event owner, Format, Category, Event date, Venue (hidden: Budget, Capacity, Event URL, Status) | Sort Event date new → old; **Group Status** by Option, Sort Ascending, Hide empty groups on (see 3.3), Color columns on | (order) titles on, page icon on, wrap on, Color columns on; Side peek; Load limit 25; Card preview None; Card size Medium; **Card layout List** |
| Calendar | Calendar | Event name only | none | Show calendar by Event date, Month, **Show weekends on**; (order) titles on, page icon on, wrap page titles off; **Center peek** |
| By Category (off by default) | Table | Event name, Category, Format, Status, Event URL, Event date, Event owner, Budget, Venue, Capacity | Sort Event date new → old; **Group Category**, Sort **Manual**, Hide empty groups **off**; **group order Conference, Retreat, Tradeshow, No Category, Webinar, Workshop, Community meetup, Internal event, Partner event, Team building** (not the option order) | (order) all four switches on (titles, vertical lines, page icon, wrap); Side peek; Load limit 25 |
| My Events (off by default) | Table | same 10 as By Category | **Filter "Event owner: Contains Me"** | (order) titles on, vertical lines on, page icon on, wrap off; Side peek; Load limit 50 |

Tab bar after create (all on): "All Events | By Status | 3 more…".

Sample rows: Make with Notion (September 16, 2025, Registration open, In person, Community meetup, Venue 3, Capacity 2000, $500,000.00, makewithnotion.com/), Fireside chat with Ivan Zhao (March 13, 2025, Planning, In person, Internal event, Venue 2, 100, $10,000.00, a notion.so URL), VIP dinner (February 12, 2025, Done, Virtual, Community meetup, Venue 1, 50, $5,000.00, a notion.so URL). Event owner empty.

### 3.5 Social Media Planner

Card text: "Organize and schedule social posts." Preview: a calendar, footer "6 hidden properties" (7 with all on).

Step 1 chips, default: **Platform, Post URL, Content type, Owner** on; **Target audiences** off.
Step 2 view cards, default: **Calendar, All Posts, By Status** on; **By Platform** off.

| Property | Type | Settings / options (colour) |
|---|---|---|
| Post name | Title | |
| Content type | **Multi-select** | Sort Manual. Text (Yellow), Image / photo (Orange), Video (Blue), Link (Purple), Carousel (Red), Poll (Brown), Story (Gray), Live stream (Pink) |
| Owner | Person | No limit, No default, Users only |
| Platform | Multi-select | Sort Manual. Linkedin (Brown), TikTok (Default), X (Blue), YouTube (Red), Instagram (Green) |
| Post URL | URL | Show full URL |
| Post date | Date | Full date, 12 hour, Notifications None |
| Status | Status | **To-do**: Post Idea (DEFAULT); **In progress**: Draft (Yellow), Ready for Review (Purple), Scheduled (Blue); **Complete**: Published (Green), Cancelled (Red). Display as Select |
| Target audiences | Multi-select | Sort Manual. Segment 1 (Purple), Segment 2 (Yellow), Segment 3 (Gray) |

| View | Layout | Shown | Filter / sort / group | Other |
|---|---|---|---|---|
| Calendar | Calendar | Post name only | none | Show calendar by Post date, Month, **Show weekends off** (Mon–Fri drawn); (order) titles on, page icon on, wrap page titles off; Center peek |
| All Posts | Table | Post name, Owner, Status, Post date, Platform, Content type, Target audiences, Post URL | Sort Post date new → old | (order) titles on, vertical lines on, page icon off, **wrap on**; Side peek; Load limit 50 |
| By Status | Board | Post name, Post date, Platform, Owner (hidden: Content type, Post URL, Status, Target audiences) | Sort Post date new → old; Group Status by Option, Sort Ascending, **Hide empty groups=true, Color columns=true** (labelled read); columns drawn: Post Idea 1, Draft 0, Ready for Review 0, Scheduled 1, Published 1, Cancelled 0 | (order) titles on, page icon on, wrap on, Color columns on; Side peek; Load limit 25; Card preview None; Card size Medium; **Card layout List** (by label ink: List rgb(44, 44, 43), Compact rgb(125, 122, 117)) |
| By Platform (off by default) | Table | Post name, Status, Owner, Post date, Content type (hidden: Platform, Post URL, Target audiences) | Sort Post date new → old; grouped by Platform (groups No Platform 0, Linkedin 3, YouTube 1, X 3, TikTok, Instagram …; Group page not read) | (order) titles on, vertical lines on, page icon on, wrap off; Side peek; Load limit 25 |

Sample rows: Founder interview (Post Idea, March 12, 2025, Video, Linkedin + X), Brand awareness (Scheduled, March 5, 2025, Image / photo + Video, Linkedin + YouTube + X), Product launch (Published, February 13, 2025, Carousel + Text, Linkedin + Instagram + X).

### 3.6 Campaign Management, again with every chip on (research 31 §7a gaps)

Defaults are the same as research 31 §7a: step 1 Owner and Budget off, step 2 By Market off. Preview footer: 3 hidden properties (4 with all chips on).

New properties (option colours "by pill", 3.1):

| Property | Type | Settings |
|---|---|---|
| **Owner** | **Person** | Limit No limit, Default No default, Users only |
| **Budget** | **Number** | Number format **US Dollar**, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |

Edit properties order with all on: Campaign name, Owner, Channels, Markets, Campaign type, Audiences targeted, Budget, Completion date, Files & media, Status. The other properties and colours match research 31 §7a. Status "Complete" (the option) reads Green by pill.

| View | Layout | Shown | Filter / sort / group | Other |
|---|---|---|---|---|
| **By Market** (off by default) | Table | Campaign name, Status, Owner, Markets, Campaign type, Channels, Audiences targeted (hidden: Files & media, Budget, Completion date) | no sort; **Group Markets**, Sort Manual, Hide empty groups off; **group order APAC, FR, LATAM, UK, AMER, EMEA, No Markets** (option order is AMER, EMEA, APAC, UK, FR, LATAM) | titles on, vertical lines on, page icon on, wrap off (labelled); Side peek; Load limit 25 |
| By Status | Board | Campaign name, Owner, Channels, Markets, Campaign type (hidden: Audiences targeted, Budget, Completion date, Files & media, Status) | as research 31 | **Card layout List** (outline 2px rgb(39, 131, 222)) |
| All Campaigns | Table | Campaign name, Status, Owner, Audiences targeted, Campaign type, Channels, Markets, Budget, Files & media, Completion date | as research 31 | |
| Calendar | Calendar | Campaign name only | as research 31 | |

So Owner joins the shown list of By Status, All Campaigns and By Market; Budget is shown only in All Campaigns.

### 3.7 Content Calendar, again with every chip on (research 31 §7b gaps)

Defaults as research 31 §7b: step 1 Accounts off; step 2 By Platform off. Preview footer 7 hidden properties (8 with all on).

| Property | Type | Settings / options (checked colour in the menu) |
|---|---|---|
| **Accounts** | **Multi-select** | Sort Manual. **@Account1 (Gray), @Account2 (Red), @Account3 (Blue)** |

Edit properties with all on: Content name, Owner, Content type, Platform, Accounts, Film date, Post URL, Publish date, Status. **There is one Status property.** The "Status (1)" of research 31 §7b was a script artifact, as research 31 suspected.

| View | Layout | Shown | Filter / sort / group | Other |
|---|---|---|---|---|
| **By Platform** (off by default) | Table | Content name, Owner, Status, Film date, Publish date, Content type, Platform, Accounts, Post URL (all 9) | **Sort Publish date new → old**; **Group Platform**, Sort Manual, Hide empty groups off; **group order Instagram, LinkedIn, X, Blog / website, Email, Spotify, Tiktok, YouTube, No Platform** (option order is LinkedIn, Tiktok, X, YouTube, Instagram, Spotify, Email, Blog / website) | all four switches on (labelled: titles, vertical lines, page icon, **wrap on**); Side peek; Load limit 25 |
| By Status | Board | Content name, Owner, Content type, Platform, Accounts (hidden: Film date, Post URL, Publish date, Status) | as research 31 | **Card layout List** (outline 2px rgb(39, 131, 222)) |
| All Content | Table | all 9 in the order above | as research 31 | |
| Calendar | Calendar | Content name only | as research 31 | |

### 3.8 Database icons and the "New ▾" page templates

The database title icon (an `img` 21 px wide next to the title):

| Template | Icon file |
|---|---|
| Event Management | `ticket_purple.svg` |
| Social Media Planner | `feed_purple.svg` |
| Campaign Management | `flag-swallowtail_purple.svg` |
| **Content Calendar** | **`calendar_purple.svg`** |

"New ▾": the chevron beside "New" is `aria-label="More add options"`, 24x28, `arrowChevronSingleDownFill`. Its menu (Campaign: 360x173 at (871, 127), bg white, radius 10px, shadow `rgba(25, 25, 25, 0.05) 0 20px 24px 0, rgba(25, 25, 25, 0.027) 0 5px 8px 0, rgba(42, 28, 0, 0.07) 0 0 0 1px`):

```
Templates for  <database title>     (?)                 questionMarkCircle button
<icon> New campaign   Default   …   drag handle; "Default" 12px rgb(161, 158, 153)
[page] Empty                    …
+ New template
[sidebar] Add shortcut to sidebar   (not clicked)
```

Same shape for all four: "New event" (ticket icon), "New post" (feed icon), "New campaign" (flag icon), "New content" (calendar icon). The template's icon is the database's icon. Each was clicked once to make a row (the row opens in the view's open mode: side peek for board / table views, **center peek `pm=c`** from Content Calendar's Calendar view). The new row's title is empty, with the template name as its placeholder ("New campaign"), and the icon set.

Row body of each default template (top-level blocks, in order; "H2" = `sub_header`, "H1" = `header`; "(empty)" = an empty text block):

| Template | Body |
|---|---|
| New campaign | H2 "About campaign"; text "Provide a brief overview of the campaign's goals and context."; (empty); H2 "Tasks"; text "Add tasks required to plan and execute the campaign."; 3 empty to-dos; (empty); H2 "Related files"; Google Drive embed placeholder; image placeholder; PDF placeholder |
| New content | H2 "Content overview"; text "Provide 2-3 sentences describing the content."; (empty); H2 "ToDos"; 3 empty to-dos; (empty); H2 "Notes"; 2 empty bullets |
| New event | H2 "About event"; text "Provide a short overview of the event goals and context."; (empty); H2 "Tasks"; text "Add tasks to plan and execute the event."; 3 empty to-dos; (empty); H2 "Notes"; 3 empty bullets; (empty); H2 "Supporting files"; image; PDF; Drive |
| New post | **H1** "Request Overview"; text "Basic information about who is requesting the social media post and their objective."; H1 "Content Description"; text "Detailed description of what needs to be posted and any specific messaging requirements."; H1 "Resource Needs"; text "Required assets, copy approval contacts, and other resources needed to fulfill this request."; H1 "Request Status"; text "Current status of the request, next steps, and completion timeline."; (empty) |

The row page also shows the layout split (research 31 / layout builder): a top group under "View details" and a "Properties" group.

| Template | Top group | "Properties" group |
|---|---|---|
| New campaign | Status (Not started), Owner, Completion date, Campaign type | Markets, Channels, Audiences targeted, Files & media, Budget |
| New content | Status (Idea), Owner, Content type, Post URL | Publish date, Platform, Accounts, Film date |
| New event | Status (Not started), Event date, Event owner, Category | Format, Venue, Budget, Capacity, Event URL |
| New post | Status (Post Idea), Owner, Post date, Platform, Post URL | Content type, Target audiences |

The text-block guidance lines are plain text in primary ink rgb(44, 44, 43) (not placeholders).

### 3.9 Database creation shows no toast

A MutationObserver armed before "Done" (Campaign, Content Calendar) caught no toast and no "Undo" text in the next ~9 s. The only added node with matching text was a "New database" panel node (290x465 at (1210, 126)); what it was doing there was not checked.

### 3.10 What "Undo Task database" does, and Projects' "Turn into"

Tasks Tracker from the panel's **Suggested** list. Suggested templates also open the Customize modal (step 1 button "**Get started**", not "Continue"; step 2 "Done"). Defaults kept: chips Priority, Task type, Effort level, Description on; Updated at, Past due, Attach file off; views All Tasks, By Status, My Tasks, Checklist. Icon `checkmark_green.svg`.

View settings › Data source settings rows: Source | Edit properties | Automations | AI Autofill | **Undo Task database** (`arrowSquarePathUpDown`) | More settings | Manage data sources | Lock database | Manage in Calendar. No tooltip on the row after 1.2 s.

**Click "Undo Task database" opens a confirm dialog** (no change yet):

| Part | Value |
|---|---|
| Box | `role=dialog` 324x193 at (594, 262), centred; bg white; **radius 12px**; padding 20px; shadow `rgba(25, 25, 25, 0.24) 0 24px 48px 0, rgba(25, 25, 25, 0.14) 0 4px 12px 0, rgba(42, 28, 0, 0.07) 0 0 0 1px` |
| Backdrop | full window, rgba(15, 15, 15, 0.6) |
| Title | "**Undo Task Database?**" 16px / 500, rgb(44, 44, 43), centred |
| Text | "**Tasks from this database will no longer work with My tasks or Sprints.**" 12px / 400, rgb(125, 122, 117), 2 lines at 284 px |
| Button 1 | "**Remove**" 284x32, radius 6px, padding 0 12px, 14px / 500, ink **rgb(229, 100, 88)**, transparent, border 1px rgba(206, 24, 0, 0.165) |
| Button 2 | "Cancel" 284x32, same box, ink rgb(44, 44, 43), border 1px rgba(28, 19, 1, 0.11) |

**"Remove"**: the dialog closes and the View settings row becomes **"Turn into"**. Nothing else changed. Before and after (same block id): title "Tasks Tracker", icon `checkmark_green.svg`, tabs All Tasks / By Status (+1 more), the 8 table headers, and the 3 sample rows are identical. No toast.

So **"Undo … database" only removes the Tasks-database designation** (the link to My tasks / Sprints). It does not clear the title, the icon, rows or templates.

**"Turn into"** (Tasks Tracker after Remove, and **Projects** fresh from Suggested, icon `iterate_blue.svg`) opens a 250x65 submenu with two rows: "**Turn into Tasks database**" (`clipboard`) and "**Turn into Skills database**" (`paperBolt`). Neither was clicked. Projects' View settings has "Turn into" where Tasks Tracker had "Undo Task database". Projects' default view By Status (board): **Card layout List**.

So the Data source settings row reads "Undo <kind> database" only for a database that is currently a Tasks (or, per research 27, Skills) database, and "Turn into" for every other one, template-made or not (Event Management, Campaign, Content Calendar, Social, Projects all show "Turn into").

### 3.11 Generated per-template reads (all chips on; switches labelled)

Tables below are generated from the raw dumps by `gen.py` (files directory) and checked by eye. "Card layout" is read from the tile outline (3.2). Option colours are "by pill" (3.1). A formula property shows only "Edit formula" in the table; its expression is in 3.12. Switch rows are labelled by the text on their own row.

#### Issue Tracking

Card text: "Resolve issues and feedback fast.".
Step 1 chips, default: **Due date** on; **Type, Days open** off. Preview footer "2 hidden properties".
Step 2 view cards, default: **Kanban, All Issues, My Issues** on; **Untriaged, Completed** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Issue | Title |  |
| Assigned to | Person | Limit No limit, Default No default, Users only |
| Type | Multi-select | Sort Manual. Security (Yellow), Technical debt (Gray), Feature request (Brown), Bug (Pink) |
| Priority | Select | Sort Manual. High (Red), Medium (Yellow), Low (Default) |
| Created time | Created time | Date format Full date, Time format 12 hour |
| Days open | Formula | Edit formula, Learn about formulas |
| Due date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Status | Status | **To-do**: Backlog (Gray), Open (DEFAULT); **In progress**: In progress (Blue), In review (Brown), Testing (Purple); **Complete**: Won’t fix (Red), Resolved (Green). Display as Select |

Edit properties order: Issue, Assigned to, Type, Priority, Created time, Days open, Due date, Status.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| Kanban | board | Issue, Assigned to, Type, Priority (hidden: Created time, Days open, Due date, Status) | filter none; sort Created time new → old; group by **Status** (Option), Sort Ascending, Hide empty groups=false, Color columns=true; groups: Backlog, Open, In progress, In review, Testing, Won’t fix, Resolved | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Status; Card layout List |
| All Issues | table | Issue, Assigned to, Status, Type, Priority, Created time, Due date, Days open | filter none; sort Created time new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 50 |
| My Issues | list | Issue, Status, Days open, Assigned to, Type, Created time (hidden: Due date, Priority) | filter Assigned to: Contains Me; sort Created time old → new; group by **Priority**, Sort Manual, Hide empty groups=true; groups: High, Medium, Low, No Priority | Show data source titles=true, Show page icon=true; Side peek; Load limit 25 |
| Untriaged | table | Issue, Assigned to, Status, Type, Created time, Due date, Days open (hidden: Priority) | filter Assigned to: Is empty; sort Created time new → old; group by **Priority**, Sort Manual, Hide empty groups=true; groups: High, Medium, Low, No Priority | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=true; Side peek; Load limit 25 |
| Completed | table | Issue, Assigned to, Status, Type, Created time, Due date, Days open (hidden: Priority) | filter Status: Complete; sort Created time new → old; group by **Priority**, Sort Manual, Hide empty groups=true; groups: High, Medium, Low, No Priority | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=true; Side peek; Load limit 25 |

Icon: checkmark_red.svg?mode=light 21.
New ▾ menu: New issue / Default | Empty | New template | Add shortcut to sidebar.


#### Feature Requests

Card text: "Manage feature requests end-to-end.".
Step 1 chips, default: **Priority, Requested by, Requested date, Product area** on; **Estimated effort, Related files** off. Preview footer "5 hidden properties".
Step 2 view cards, default: **By Status, All Requests, Assigned to Me** on; **High Priority Requests, New Unassigned Requests** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Request name | Title |  |
| Assigned to | Person | Limit No limit, Default No default, Users only |
| Estimated effort | Select | Sort Manual. XL (Red), L (Orange), M (Yellow), S (Default) |
| Priority | Select | Sort Manual. High (Red), Medium (Yellow), Low (Green) |
| Product area | Multi-select | Sort Manual. Mobile (Pink), Growth (Green), AI (Orange), Other (Purple) |
| Related files | Files & media | Limit No limit |
| Requested by | Person | Limit No limit, Default No default, Users only |
| Requested date | Created time | Date format Full date, Time format 12 hour |
| Status | Status | **To-do**: New (DEFAULT); **In progress**: Under Review (Yellow), Planned (Brown), In Development (Blue); **Complete**: Launched (Green), Declined (Red). Display as Select |

Edit properties order: Request name, Assigned to, Estimated effort, Priority, Product area, Related files, Requested by, Requested date, Status.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| By Status | board | Request name (hidden: Assigned to, Estimated effort, Priority, Product area, Related files, Requested by, Requested date, Status) | filter none; sort none; group by **Status** (Option), Sort Ascending, Hide empty groups=false, Color columns=true; groups: New, Under Review, Planned, In Development, Launched, Declined | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Status; Card layout List |
| All Requests | table | Request name, Requested by, Status, Product area, Priority, Requested date, Estimated effort, Related files, Assigned to | filter none; sort Requested date new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 50 |
| Assigned to Me | table | Request name, Status, Assigned to, Priority, Product area, Estimated effort (hidden: Requested by, Requested date, Related files) | filter Assigned to: Contains Me; sort Requested date new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| High Priority Requests | table | Request name, Status, Assigned to, Priority, Estimated effort, Product area (hidden: Requested by, Requested date, Related files) | filter Priority: High; sort Requested date new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| New Unassigned Requests | table | Request name, Assigned to, Status, Requested date, Priority, Product area (hidden: Requested by, Estimated effort, Related files) | filter Assigned to: Is empty; sort Requested date new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |

Icon: comment_red.svg?mode=light 21.
New ▾ menu: New request / Default | Empty | New template | Add shortcut to sidebar.


#### Engineering Docs

Card text: "Organize knowledge with your team.".
Step 1 chips, default: **Author, Last edited time** on; **Reviewers, Created time** off. Preview footer "0 hidden properties".
Step 2 view cards, default: **All Docs, Published Docs, Docs by Category** on; **Recently Edited, My Docs** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Doc name | Title |  |
| Author | Person | Limit No limit, Default Created by, Users only |
| Status | Status | **To-do**: Draft (DEFAULT); **In progress**: In Review (Blue); **Complete**: Published (Green), Outdated (Brown). Display as Select |
| Category | Multi-select | Sort Manual. Tech Spec (Pink), PRD (Default), Guide (Yellow), Best Practices (Orange), Architecture (Blue) |
| Reviewers | Person | Limit No limit, Default No default, Users only |
| Created time | Created time | Date format Full date, Time format 12 hour |
| Last edited time | Last edited time | Date format Relative, Time format 12 hour |

Edit properties order: Doc name, Author, Status, Category, Reviewers, Created time, Last edited time.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| All Docs | table | Doc name, Author, Status, Category, Reviewers, Created time, Last edited time | filter none; sort Last edited time new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=true; Side peek; Load limit 50 |
| Published Docs | list | Doc name, Category, Author, Last edited time (hidden: Created time, Reviewers, Status) | filter Status: Published; sort Last edited time new → old; group none | Show data source titles=true, Show page icon=true; Side peek; Load limit 50 |
| Docs by Category | table | Doc name, Author, Status (hidden: Category, Last edited time, Reviewers, Created time) | filter none; sort Last edited time new → old; group by **Category**, Sort Manual, Hide empty groups=false; groups: PRD, Tech Spec, Architecture, Best Practices, Guide, No Category | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=true; Side peek; Load limit 25 |
| Recently Edited | table | Doc name, Category, Status, Author, Last edited time (hidden: Reviewers, Created time) | filter none; sort Last edited time new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=true; Side peek; Load limit 50 |
| My Docs | table | Doc name, Category, Status, Last edited time (hidden: Author, Reviewers, Created time) | filter Author: Contains Me; sort Last edited time new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=true; Side peek; Load limit 50 |

Icon: document_red.svg?mode=light 21.
New ▾ menu: New document / Default | Guide Template | Empty | New template | Add shortcut to sidebar.


#### Fundraising Tracker

Card text: "Track investor deals and progress.".
Step 1 chips, default: **Capital committed, Description, Partner name, Partner email, Warm contact email, Portfolio, Last contact date** on; **Warm contact name, Average check size, Firm LinkedIn, Lost reason** off. Preview footer "5 hidden properties".
Step 2 view cards, default: **By Status, All Investors, Won** on; **Lost, In Progress** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Investor name | Title |  |
| Partner email | Email |  |
| Warm contact email | Email |  |
| Average check size | Number | Number format US Dollar, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Capital committed | Number | Number format US Dollar, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Description | Text |  |
| Firm LinkedIn | Text |  |
| Last contact date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Lost reason | Text |  |
| Partner name | Text |  |
| Portfolio | Text |  |
| Status | Status | **To-do**: Not started (DEFAULT); **In progress**: Diligence (Blue), Pitched (Yellow); **Complete**: Won (Green), Lost (Red). Display as Select |
| Warm contact name | Text |  |

Edit properties order: Investor name, Partner email, Warm contact email, Average check size, Capital committed, Description, Firm LinkedIn, Last contact date, Lost reason, Partner name, Portfolio, Status, Warm contact name.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| By Status | board | Investor name, Partner email, Warm contact email (hidden: Average check size, Capital committed, Description, Firm LinkedIn, Last contact date, Lost reason, Partner name, Portfolio, Status, Warm contact name) | filter none; sort none; group by **Status** (Option), Sort Ascending, Hide empty groups=false, Color columns=true; groups: Not started, Diligence, Pitched, Won, Lost | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Status; Card layout List |
| All Investors | table | Investor name, Status, Capital committed, Partner name, Partner email, Warm contact name, Warm contact email, Average check size, Description, Portfolio, Firm LinkedIn, Lost reason, Last contact date | filter none; sort Last contact date old → new; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 50 |
| Won | table | Investor name, Average check size, Capital committed, Description, Firm LinkedIn, Last contact date, Lost reason, Partner email, Partner name, Portfolio, Status, Warm contact email, Warm contact name | filter Status: Won; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| Lost | table | Investor name, Average check size, Capital committed, Description, Firm LinkedIn, Last contact date, Lost reason, Partner email, Partner name, Portfolio, Status, Warm contact email, Warm contact name | filter Status: Lost; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| In Progress | table | Investor name, Status, Capital committed, Partner name, Partner email, Warm contact name, Warm contact email, Average check size, Description, Portfolio, Firm LinkedIn, Lost reason, Last contact date | filter Status: In progress; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |

Icon: currency_gray.svg?mode=light 21.
New ▾ menu: New investor / Default | Empty | New template | Add shortcut to sidebar.


#### Pipeline Tracking

Card text: "Track your sales pipeline.".
Step 1 chips, default: **Account owner, Priority level, Deal value, Decision maker, Expected close date, Email, Notes** on; **Last contact date, Lead source, Days since last contact, Phone number** off. Preview footer "5 hidden properties".
Step 2 view cards, default: **By Deal Stage, All Deals, Active Deals** on; **Recently Contacted** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Name | Title |  |
| Account owner | Person | Limit No limit, Default No default, Users only |
| Priority level | Select | Sort Manual. Low (Gray), Medium (Blue), High (Purple) |
| Days since last contact | Formula | Edit formula, Number format Number, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read), Learn about formulas |
| Deal stage | Select | Sort Manual. New (Green), Discovery (Red), Negotiation (Orange), Won (Blue), Lost (Pink) |
| Deal value | Number | Number format US Dollar, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Decision maker | Person | Limit No limit, Default No default, Users only |
| Email | Email |  |
| Expected close date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Last contact date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Lead source | Multi-select | Sort Manual. Inbound (Gray), Outbound (Orange), Referral (Blue), Event (Purple), Partner (Pink), Website (Green) |
| Notes | Text |  |
| Phone number | Phone |  |

Edit properties order: Name, Account owner, Priority level, Days since last contact, Deal stage, Deal value, Decision maker, Email, Expected close date, Last contact date, Lead source, Notes, Phone number.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| By Deal Stage | board | Name, Account owner, Priority level (hidden: Days since last contact, Deal stage, Deal value, Decision maker, Email, Expected close date, Last contact date, Lead source, Notes, Phone number) | filter none; sort none; group by **Deal stage**, Sort Manual, Hide empty groups=false, Color columns=true; groups: New, Discovery, Negotiation, Won, Lost, No Deal stage | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Deal stage; Card layout List |
| All Deals | table | Name, Account owner, Deal stage, Priority level, Deal value, Email, Phone number, Notes, Expected close date, Last contact date, Lead source, Decision maker, Days since last contact | filter none; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=true; Side peek; Load limit 50 |
| Active Deals | table | Name, Account owner, Deal stage, Priority level, Deal value, Email, Phone number, Notes, Expected close date, Last contact date, Lead source, Decision maker, Days since last contact | filter Deal stage: Discovery, Negotiation; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| Recently Contacted | table | Name, Days since last contact, Account owner, Deal stage, Priority level, Deal value, Email, Phone number, Expected close date, Last contact date, Lead source (hidden: Decision maker, Notes) | filter none; sort Days since last contact high → low; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |

Icon: user-circle_blue.svg?mode=light 21.
New ▾ menu: New deal / Default | Empty | New template | Add shortcut to sidebar.


#### Account Management

Card text: "One hub to manage clients.".
Step 1 chips, default: **Account manager, Product categories, Contact email, Notes** on; **Contract value, Last contact date, Phone number** off. Preview footer "3 hidden properties".
Step 2 view cards, default: **By Status, All Accounts, By Region** on; **Active Accounts** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Account name | Title |  |
| Account manager | Person | Limit No limit, Default No default, Users only |
| Product categories | Multi-select | Sort Manual. Base subscription (Blue), Analytics (Pink), Custom integrations (Brown) |
| Contact email | Email |  |
| Contract value | Number | Number format US Dollar, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Last contact date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Notes | Text |  |
| Phone number | Phone |  |
| Region | Multi-select | Sort Manual. AMER (Blue), EMEA (Pink), APAC (Green) |
| Status | Select | Sort Manual. Active (Brown), At Risk (Pink), Pending Renewal (Green), On Hold (Orange), Churned (Yellow) |

Edit properties order: Account name, Account manager, Product categories, Contact email, Contract value, Last contact date, Notes, Phone number, Region, Status.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| By Status | board | Account name, Account manager, Product categories (hidden: Contact email, Contract value, Last contact date, Notes, Phone number, Region, Status) | filter none; sort none; group by **Status**, Sort Manual, Hide empty groups=false, Color columns=true; groups: Active, Churned, Pending Renewal, At Risk, On Hold, No Status | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Status; Card layout List |
| All Accounts | table | Account name, Account manager, Status, Contract value, Contact email, Last contact date, Phone number, Product categories, Notes, Region | filter none; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=true; Side peek; Load limit 50 |
| By Region | table | Account name, Account manager, Status, Contract value, Contact email, Last contact date, Phone number, Notes, Product categories, Region | filter none; sort none; group by **Region**, Sort Manual, Hide empty groups=false; groups: AMER, APAC, EMEA, No Region | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 25 |
| Active Accounts | table | Account name, Account manager, Status, Contract value, Contact email, Last contact date, Phone number, Region, Notes, Product categories | filter Status: Active; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |

Icon: card_blue.svg?mode=light 21.
New ▾ menu: New account / Default | Empty | New template | Add shortcut to sidebar.


#### Creative Projects

Card text: "Keep creative projects on track.".
Step 1 chips, default: **Creative type, Priority, Assets** on; **Start date, End date** off. Preview footer "2 hidden properties".
Step 2 view cards, default: **By Status, All Projects, My Projects** on; **Timeline, By Type** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Project name | Title |  |
| Owner | Person | Limit No limit, Default No default, Users only |
| Creative type | Multi-select | Sort Manual. Video (Red), Photography (Default), Illustration (Orange), Print (Brown), Signage (Pink), Branding (Gray), Motion (Purple), Website (Blue), Sound / music (Green), Other (Yellow) |
| Assets | Files & media | Limit No limit |
| End date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Priority | Select | Sort Manual. Low (Blue), Medium (Yellow), High (Red) |
| Start date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Status | Status | **To-do**: Not started (DEFAULT); **In progress**: In progress (Blue), Needs review (Yellow), In review (Purple); **Complete**: Done (Green). Display as Select |

Edit properties order: Project name, Owner, Creative type, Assets, End date, Priority, Start date, Status.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| By Status | board | Project name, Owner, Creative type (hidden: Assets, End date, Priority, Start date, Status) | filter none; sort none; group by **Status** (Option), Sort Ascending, Hide empty groups=true, Color columns=true; groups: Not started, In progress, Needs review, In review, Done | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Status; Card layout List |
| All Projects | table | Project name, Priority, Owner, Status, Start date, End date, Creative type, Assets | filter none; sort Start date new → old; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 50 |
| My Projects | table | Project name, Status, Priority, Creative type, Assets (hidden: Owner, Start date, End date) | filter Owner: Contains Me; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| Timeline | timeline | Project name (hidden: Assets, Creative type, End date, Owner, Priority, Start date, Status) | filter none; sort Start date old → new; group none | Show data source titles=true, Show page icon=true, Separate start and end dates=false, Show table=false; Side peek; Load limit 50; Show timeline by Start date; Show table Open pages in |
| By Type | table | Project name, Owner, Status, Start date, End date, Creative type, Assets (hidden: Priority) | filter none; sort Start date new → old; group by **Creative type**, Sort Manual, Hide empty groups=false; groups: Branding, Illustration, Motion, Other, Photography, Print, Signage, Sound / music, Video, Website, No Creative type | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 25 |

Icon: paint-brush-wide_blue.svg?mode=light 21.
New ▾ menu: New project / Default | Empty | New template | Add shortcut to sidebar.


#### Inventory Management

Card text: "Manage inventory efficiently.".
Step 1 chips, default: **ID, Category, Quantity in stock, Supplier, Location, Notes** on; **Reorder minimum, Reorder Status** off. Preview footer "0 hidden properties".
Step 2 view cards, default: **All Inventory, Recently Ordered** on; **Hardware Inventory** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| ID | ID | Prefix, IM-1, IM-2, IM-3, …, Add ID prefix |
| Name | Title |  |
| Category | Select | Sort Manual. Hardware (Orange), Accessories (Yellow), Electronics (Default), Tools (Red) |
| Quantity in stock | Number | Number format Number, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Reorder minimum | Number | Number format Number, Decimal places Default, Show as tiles Number / Bar / Ring (picked tile not read) |
| Supplier | Select | Sort Manual. Supplier Z (Brown), Supplier X (Brown), Supplier Y (Default) |
| Last ordered date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Location | Select | Sort Manual. Warehouse 3 (Purple), Warehouse 1 (Pink), Warehouse 2 (Blue) |
| Notes | Text |  |
| Reorder Status | Formula | Edit formula, Learn about formulas |

Edit properties order: ID, Name, Category, Quantity in stock, Reorder minimum, Supplier, Last ordered date, Location, Notes, Reorder Status.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| All Inventory | table | ID, Name, Category, Quantity in stock, Reorder minimum, Supplier, Last ordered date, Location, Notes, Reorder Status | filter none; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 50 |
| Recently Ordered | list | Name, Category (hidden: ID, Last ordered date, Location, Notes, Quantity in stock, Reorder Status, Reorder minimum, Supplier) | filter none; sort Last ordered date old → new; group by **Last ordered date**, Sort Oldest first, Hide empty groups=false; groups: Sep 2024, Oct 2024, Feb 2025, Last 30 days, Last 7 days, No Last ordered date | Show data source titles=true, Show page icon=true; Side peek; Load limit 25 |
| Hardware Inventory | table | ID, Name, Category, Quantity in stock, Supplier, Reorder minimum, Last ordered date, Location, Notes, Reorder Status | filter Category: Hardware; sort ID low → high; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |

Icon: package_lightgray.svg?mode=light 21.
New ▾ menu: New item / Default | Empty | New template | Add shortcut to sidebar.


#### Product Roadmap

Card text: "Take products from idea to launch.".
Step 1 chips, default: **Priority, Category, Effort, Date** on; **Project description, Quarter** off. Preview footer "4 hidden properties".
Step 2 view cards, default: **By Status, All Projects, My Projects, By Team** on; **By Quarter, Timeline** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Project name | Title |  |
| Owner | Person | Limit No limit, Default No default, Users only |
| Category | Multi-select | Sort Manual. New Feature (Purple), Enhancement (Default), Bug Fix (Yellow), Performance Improvement (Orange), UI/UX (Red) |
| Date | Date | Date format Full date, Time format 12 hour, Notifications None |
| Effort | Select | Sort Manual. red (Red), L (Orange), M (Yellow), S (Blue), XS (Green) |
| Priority | Select | Sort Manual. High (Red), Medium (Yellow), Low (Green) |
| Project description | Text |  |
| Quarter | Multi-select | Sort Manual. Q1 (Default), Q2 (Orange), Q3 (Purple), Q4 (Brown) |
| Status | Status | **To-do**: Backlog (Brown), Planned (DEFAULT); **In progress**: In progress (Blue); **Complete**: Completed (Green), Cancelled (Red), On Hold (Gray). Display as Select |
| Team | Multi-select | Sort Manual. AI (Green), Platform (Red), Security (Default), Mobile (Purple) |

Edit properties order: Project name, Owner, Category, Date, Effort, Priority, Project description, Quarter, Status, Team.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| By Status | board | Project name, Owner, Category (hidden: Date, Effort, Priority, Project description, Quarter, Status, Team) | filter none; sort none; group by **Status** (Option), Sort Ascending, Hide empty groups=false, Color columns=true; groups: Backlog, Planned, In progress, Completed, Cancelled, On Hold | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true; Side peek; Load limit 25; Card preview None; Card size Medium; Group by Status; Card layout List |
| All Projects | table | Project name, Status, Owner, Priority, Category, Effort, Project description, Quarter, Team, Date | filter none; sort Date new → old | Status ascending; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 50 |
| My Projects | table | Project name, Status, Owner, Priority, Category, Effort, Project description, Quarter, Team, Date | filter Owner: Contains Me; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |
| By Team | list | Project name, Owner, Project description, Team (hidden: Category, Date, Effort, Priority, Quarter, Status) | filter none; sort Date new → old; group by **Team**, Sort Manual, Hide empty groups=false; groups: AI, Mobile, No Team, Platform, Security | Show data source titles=true, Show page icon=true; Side peek; Load limit 25 |
| By Quarter | list | Project name, Owner, Project description, Team (hidden: Category, Date, Effort, Priority, Quarter, Status) | filter none; sort Date new → old; group by **Quarter**, Sort Manual, Hide empty groups=false; groups: Q1, Q2, Q3, Q4, No Quarter | Show data source titles=true, Show page icon=true; Side peek; Load limit 25 |
| Timeline | timeline | Project name (hidden: Category, Date, Effort, Owner, Priority, Project description, Quarter, Status, Team) | filter none; sort Quarter ascending | Date new → old; group none | Show data source titles=true, Show page icon=true, Show table=true; Side peek; Load limit 50; Show timeline by Date; Show table Table properties |

Icon: map_pink.svg?mode=light 21.
New ▾ menu: New project / Default | Empty | New template | Add shortcut to sidebar.


#### Asset Library

Card text: "Create shared design assets.".
Step 1 chips, default: **Designer, Asset type, Last edited, Files & media** on; **Asset description, Asset URL** off. Preview footer "4 hidden properties".
Step 2 view cards, default: **Gallery, All Assets, By Status** on; **Asset Type, My Assets** off.

| Property | Type | Settings / options (colour by pill unless marked) |
|---|---|---|
| Asset name | Title |  |
| Status | Status | **To-do**: Not started (DEFAULT); **In progress**: Waiting for approval (Purple), In progress (Blue), 1st draft (Brown), 2nd draft (Yellow); **Complete**: Final version (Green). Display as Select |
| Asset URL | URL | Show full URL |
| Asset description | Text |  |
| Asset type | Multi-select | Sort Manual. Icon (Default), Illustration (Brown), Photo (Blue), Logo (Red), UI Component (Orange), Color (Green), Typography (Yellow), Animation (Gray), Other (Pink) |
| Designer | Person | Limit No limit, Default No default, Users only |
| Files & media | Files & media | Limit No limit |
| Last edited | Last edited time | Date format Full date, Time format 12 hour |

Edit properties order: Asset name, Status, Asset URL, Asset description, Asset type, Designer, Files & media, Last edited.

| View | Layout | Shown / hidden | Filter / sort / group | Switches, open mode, other |
|---|---|---|---|---|
| Gallery | gallery | Asset name, Status (hidden: Asset URL, Asset description, Asset type, Designer, Files & media, Last edited) | filter none; sort none; group none | Show data source titles=true, Show page icon=true, Wrap all content=false; Center peek; Load limit 50; Card preview None; Card size Medium |
| All Assets | table | Asset name, Designer, Asset type, Files & media, Status, Asset URL, Asset description, Last edited | filter none; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=true; Side peek; Load limit 50 |
| By Status | board | Asset name (hidden: Asset URL, Asset description, Asset type, Designer, Files & media, Last edited, Status) | filter none; sort none; group by **Status** (Option), Sort Ascending, Hide empty groups=false, Color columns=true; groups: Not started, Waiting for approval, In progress, 1st draft, 2nd draft, Final version | Show data source titles=true, Show page icon=true, Wrap all content=true, Color columns=true, Fit media=true; Side peek; Load limit 25; Card preview Files & media; Card size Medium; Group by Status; Card layout List |
| Asset Type | table | Asset name, Designer, Files & media, Status, Asset URL, Asset description (hidden: Asset type, Last edited) | filter none; sort none; group by **Asset type**, Sort Manual, Hide empty groups=false; groups: Animation, Color, Icon, Illustration, Logo, Other, Photo, Typography, UI Component, No Asset type | Show data source titles=true, Show vertical lines=true, Show page icon=false, Wrap all content=false; Side peek; Load limit 25 |
| My Assets | table | Asset name, Asset URL, Asset description, Asset type, Designer, Files & media, Last edited, Status | filter Designer: Contains Me; sort none; group none | Show data source titles=true, Show vertical lines=true, Show page icon=true, Wrap all content=false; Side peek; Load limit 50 |

Icon: fan-deck_green.svg?mode=light 21.
New ▾ menu: New asset / Default | Empty | New template | Add shortcut to sidebar.

### 3.12 Formulas in the 12 templates

Read from each formula's "Edit formula" editor (`formula2.sh`; closed with Escape, nothing typed). Stored text has a line break before each property reference; shown here on one line.

| Template | Property | Formula |
|---|---|---|
| Issue Tracking | Days open | `if(Status=="Open", if(dateBetween(now(), Created time, "days") == 1, "1 day", format(dateBetween(now(), Created time, "days")) + " days"), "Issue Closed")` |
| Pipeline Tracking | Days since last contact | `dateBetween(now(), Last contact date, "days")` (Number format Number, Decimal places Default) |
| Inventory Management | Reorder Status | `if(Quantity in stock <= Reorder minimum, "Reorder", if(Quantity in stock > 2 * Reorder minimum, "Overstocked", "In Stock"))` |

No other template among the 12 has a formula property.

### 3.13 Template summary and oddities

- **Card layout: every template board picks "List".** Boards read: Event Management, Social Media Planner, Campaign Management, Content Calendar, Projects, Issue Tracking (Kanban), Feature Requests, Fundraising Tracker, Pipeline Tracking (By Deal Stage), Account Management, Creative Projects, Product Roadmap, Asset Library. All: List tile outline 2px rgb(39, 131, 222); Compact 1px rgb(230, 229, 227). **A board view added by hand to a plain table database (scratch table › Add view › Board) also picks List**, so List is the default for any new board, not a template choice.
- **Icons** (database title `img`): Issue Tracking `checkmark_red`, Feature Requests `comment_red`, Engineering Docs `document_red`, Fundraising Tracker `currency_gray`, Pipeline Tracking `user-circle_blue`, Account Management `card_blue`, Creative Projects `paint-brush-wide_blue`, Inventory Management `package_lightgray`, Product Roadmap `map_pink`, Asset Library `fan-deck_green`; plus 3.8.
- **"New ▾" templates**: each has one Default page template named "New <noun>" (issue, request, document, investor, deal, account, project, item, project, asset) and "Empty". **Engineering Docs has a second one, "Guide Template".** Bodies of these were not opened (only the four in 3.8).
- **Group order is a per-view manual order, not the option order**, in several views: Event By Category, Campaign By Market, Content Calendar By Platform (3.4-3.7); Engineering Docs' Docs by Category (PRD, Tech Spec, Architecture, Best Practices, Guide vs options Tech Spec, PRD, Guide, Best Practices, Architecture); Account By Region (AMER, APAC, EMEA vs AMER, EMEA, APAC); Creative By Type and Asset Type (alphabetical); Product Roadmap By Team (AI, Mobile, No Team, Platform, Security: "No Team" sits in the middle).
- **Product Roadmap's Effort select has an option literally named "red"** (Red), then L, M, S, XS. That is the template's data as served.
- **Date grouping** (Inventory "Recently Ordered", list): group by Last ordered date, Sort "Oldest first", groups "Sep 2024, Oct 2024, Feb 2025, Last 30 days, Last 7 days, No Last ordered date".
- **Two sorts** on one view: Product Roadmap All Projects (Date new → old, then Status ascending) and Timeline (Quarter ascending, then Date new → old).
- **Suggested rotation** (panel "Suggested" list): Tasks Tracker, Projects, Skills at the start; after Tasks Tracker and Projects were used: **Skills, Document Hub, Brainstorm Session**. Consistent with "first three unused".
- **Hide empty groups** on template Status boards reads true on Creative Projects' By Status and false on most others (Issue, Feature, Fund, Roadmap, Asset). 3.3 shows a template "true" may not be applied.

## 4. Colour dump, light and dark (asked during the session)

### 4.0 Method

- Theme: the stored setting was "Use system setting" (system light). Dark was switched on with **Cmd+Shift+L** (it stores "dark"), and the setting was put back at the end through the workspace switcher (sidebar bottom) › Settings › Preferences › Theme › **Use system setting**, then read back after a reload: `appearanceSetting = "system"`, body bg rgb(255, 255, 255). No sweep or screenshot was taken with Settings open.
- `sweep.js`: every visible element (in the viewport's vertical band) under `.notion-frame`, `.notion-peek-renderer` and `.notion-overlay-container`, outside the sidebar; one row per unique (bg, background-image, own-text ink, svg fill, borders, box-shadow, outline) tuple with up to 3 examples (tag, `notion-*` classes, role, aria-label, own text, size, position). Light and dark were swept at the same scroll positions, so `pair.py` pairs light and dark values **by the same element at the same coordinates**.
- Hover and pressed: `hovdiff.sh` reads the element chain under the pointer at rest, after a hover, and while the mouse is held 0.4 s (then moved off before release).
- Raw JSON: `notion-measure33/colours/<surface>-<light|dark>.json`, `colours/log-<theme>.txt` (hover chains, tooltips), `colours/pairs.json` (light/dark pairs). Not in the repo. The user's name in Feed bylines was replaced by `<user>` in the files.
- Surfaces swept: table (Event Management, Creative Projects), board (Content Calendar 10 columns, Campaign), calendar (Event), timeline (Product Roadmap), list (Product Roadmap By Team), gallery (Asset Library), feed and map (views added to the scratch database), side peek, center peek (Asset gallery card), row page (full page), View settings menu, property menu, view search field, row selection.

### 4.1 Base colours

| Role | Light | Dark |
|---|---|---|
| Page / frame bg | rgb(255, 255, 255) | rgb(25, 25, 25) |
| Primary ink (titles, cells) | rgb(44, 44, 43) | rgb(240, 239, 237) |
| Secondary ink (view tab labels, table header, property names) | rgb(125, 122, 117) | rgb(173, 169, 163) |
| Tertiary ink ("New item" placeholder, "Add cover", feed "5h") | rgb(161, 158, 153) | rgb(125, 122, 117) |
| Toolbar icon (Sort etc., svg) | rgb(142, 139, 134) | rgb(173, 169, 163) |
| "View details", "Clear search" ink | rgb(142, 139, 134) | rgb(142, 139, 134) |
| Board column count / "New" row ink on an uncoloured column | rgb(95, 94, 89) | rgb(188, 186, 182) |
| Table cell borders, header-row bottom, menu dividers (196x1) | rgba(42, 28, 0, 0.07) | rgba(255, 255, 243, 0.082) |
| Outlined button border ("Manage in Calendar", "Clear search") | 1px rgba(28, 19, 1, 0.11) | 1px rgba(255, 255, 235, 0.1) |
| Row page property-block divider | rgba(55, 53, 47, 0.09) | rgba(255, 255, 255, 0.094) |
| Unselected view tab (hover-like fill seen on a non-active tab) | rgba(33, 27, 23, 0.05) | rgba(255, 255, 255, 0.055) |
| Active view tab with a focus ring present at sweep time (the tab had been clicked with the mouse; why the ring showed was not checked) | color(srgb 0.129 0.106 0.090 / 0.0765) + ring `rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px` | rgba(255, 255, 235, 0.1) + ring `rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px` |

### 4.2 Hover, pressed, selection

| State | Light | Dark |
|---|---|---|
| Table header cell hover (166x36 `role=button`) | color(srgb 0.129412 0.105882 0.0901961 / 0.0509804) | color(srgb 1 1 1 / 0.054902) |
| Table header cell pressed | same colour / **0.101961** | color(srgb 1 1 1 / **0.109804**) |
| Toolbar icon button (Sort, 28x28) hover / pressed | same as header (0.051 / 0.102) | same as header (0.055 / 0.110) |
| Table row (title cell) hover | no fill change on the cell chain (6 ancestors read) | same |
| Gallery card at rest / hover / pressed | white / **rgba(55, 53, 47, 0.04)** / rgba(55, 53, 47, 0.06) | rgba(255, 255, 255, 0.055) / **rgb(47, 47, 47)** / rgb(37, 37, 37) |
| Row selection (checkbox) | `.notion-selectable-halo` **rgba(35, 131, 226, 0.14)** | rgba(35, 131, 226, 0.14) |
| Column resize / drag guides | 1px rgba(35, 131, 226, 0.21), 2px rgba(81, 73, 60, 0.32), 4x28 rgb(35, 131, 226) | 0.2 / rgb(90, 90, 90) / rgb(35, 131, 226) |

Hover on "New" and Filter was not read (pointer target not found by the script).

### 4.3 Option colours (pill bg / pill text)

Light from 3.1. Dark is the same pill at the same position after the switch.

| Colour | Light bg | Light text | Dark bg | Dark text |
|---|---|---|---|---|
| Default | rgba(42, 28, 0, 0.07) | rgb(44, 44, 43) | rgba(255, 255, 243, 0.082) | not isolated (primary ink) |
| Gray | rgba(28, 19, 1, 0.11) | rgb(73, 72, 70) | rgba(255, 252, 235, 0.306) | rgb(240, 239, 237) (the only dark pill text that is plain primary ink) |
| Brown | rgba(127, 51, 0, 0.157) | rgb(88, 68, 55) | rgba(255, 184, 132, 0.365) | rgb(245, 237, 233) |
| Orange | rgba(196, 88, 0, 0.204) | rgb(106, 66, 34) | rgba(255, 143, 71, 0.482) | rgb(251, 235, 222) |
| Yellow | rgba(209, 156, 0, 0.282) | rgb(101, 81, 33) | rgba(255, 188, 53, 0.46) | rgb(249, 243, 220) |
| Green | rgba(0, 96, 38, 0.157) | rgb(42, 83, 60) | rgba(113, 255, 175, 0.337) | rgb(232, 241, 236) |
| Blue | rgba(0, 118, 217, 0.204) | rgb(38, 74, 114) | rgba(81, 166, 255, 0.494) | rgb(229, 242, 252) |
| Purple | rgba(92, 0, 163, 0.14) | rgb(85, 59, 105) | rgba(208, 147, 255, 0.427) | rgb(243, 235, 249) |
| Pink | rgba(183, 0, 78, 0.153) | rgb(104, 53, 78) | rgba(255, 133, 192, 0.427) | rgb(250, 233, 241) |
| Red | rgba(206, 24, 0, 0.165) | rgb(109, 53, 49) | rgba(255, 116, 105, 0.525) | rgb(252, 233, 231) |

Gray evidence: real Gray options, not only Status DEFAULT pills. "Product launch" (Campaign type, Gray) went rgba(28, 19, 1, 0.11) / rgb(73, 72, 70) → rgba(255, 252, 235, 0.306) / rgb(240, 239, 237); "Story / short form video" (Content type, Gray) and "YouTube" (Platform, Gray) card pills went to the same dark bg (their dark text was not isolated). A Status DEFAULT pill ("Not started", "Idea") reads the same as Gray in both themes.

Status pills carry an 8x8 dot. Its colour is the same in both themes: no-colour DEFAULT status rgb(142, 139, 134) (a Gray-coloured status dot was not read), Brown rgb(182, 137, 101), Orange rgb(213, 128, 59), Yellow rgb(216, 163, 47), Green rgb(70, 161, 113), Blue rgb(39, 131, 222), Purple rgb(181, 119, 214), Pink rgb(219, 105, 153), Red rgb(229, 100, 88).

### 4.4 Board (Color columns on)

Per column colour: column bg (`.notion-board-group`), the header count ink (= the dot colour, both themes), the "+ New" row (ink + 1px ring), and a card in that column.

| Colour | Column bg light | Column bg dark | "+ New" ring light | "+ New" ring dark | Card bg dark |
|---|---|---|---|---|---|
| none (Status DEFAULT "Idea") | rgba(66, 35, 3, 0.03) | rgba(252, 252, 252, 0.03) | rgba(42, 28, 0, 0.07), ink rgb(95, 94, 89) | rgba(255, 255, 243, 0.082), ink rgb(188, 186, 182) | rgb(32, 32, 32) |
| Brown | rgba(115, 59, 3, 0.035) | rgba(253, 158, 101, 0.05) | rgba(139, 46, 0, 0.086) | rgba(255, 174, 122, 0.133) | not read |
| Orange | rgba(186, 72, 3, 0.043) | rgba(254, 139, 71, 0.043) | rgba(224, 101, 1, 0.13) | rgba(255, 134, 51, 0.157) | not read |
| Yellow | rgba(207, 175, 0, 0.063) | rgba(255, 232, 48, 0.043) | rgba(211, 168, 0, 0.137) | rgba(255, 225, 117, 0.13) | rgb(55, 51, 37) |
| Green | rgba(3, 87, 31, 0.035) | rgba(83, 255, 140, 0.035) | rgba(0, 100, 45, 0.09) | rgba(119, 255, 179, 0.118) | rgb(36, 52, 43) |
| Blue | rgba(0, 128, 213, 0.047) | rgba(41, 139, 253, 0.063) | rgba(0, 124, 215, 0.094) | rgba(71, 157, 255, 0.173) | rgb(33, 48, 65) |
| Purple | rgba(98, 3, 161, 0.03) | rgba(196, 101, 253, 0.05) | rgba(102, 0, 178, 0.08) | rgba(201, 122, 255, 0.165) | not read |
| Pink | rgba(161, 3, 66, 0.03) | rgba(255, 78, 149, 0.055) | rgba(197, 0, 93, 0.086) | rgba(255, 104, 171, 0.165) | not read |
| Red | rgba(199, 3, 3, 0.035) | rgba(251, 107, 107, 0.047) | rgba(223, 22, 0, 0.094) | rgba(255, 106, 94, 0.173) | rgb(65, 39, 37) |
| Gray, Default | not on any swept board | | | | |

- The "+ New" row ink in a coloured column is the dot colour in both themes.
- Column header pill: the option pill of 4.3. The pill text in dark is the dark pill text (e.g. "Drafting" rgb(249, 243, 220)).
- **Card**: light bg white, shadow `rgba(25, 25, 25, 0.027) 0 4px 12px 0, rgba(25, 25, 25, 0.02) 0 1px 2px 0, <ring> 0 0 0 1px`, where the ring is rgba(42, 28, 0, 0.07) in an uncoloured column and the column's "+ New" ring colour in a coloured one. Dark: bg rgb(32, 32, 32) (uncoloured) or the tinted bg above, shadow `rgba(25, 25, 25, 0.08) 0 2px 4px 0, <ring> 0 0 0 1px` with the dark ring.
- Card hover was not read (card target not found by the script).

### 4.5 Gallery, list, feed, map

| Part | Light | Dark |
|---|---|---|
| Gallery card | bg white; shadow `rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, rgba(42,28,0,0.07) 0 0 0 1px` | bg **rgba(255, 255, 255, 0.055)**; shadow `rgba(25,25,25,0.08) 0 2px 4px 0, rgba(255,255,243,0.082) 0 0 0 1px` |
| Feed post card (692x176) | bg white; shadow `rgba(0,0,0,0.02) 0 12px 32px 0, rgba(0,0,0,0.05) 0 0 0 1px` | bg rgb(32, 32, 32); shadow `rgba(255,255,255,0.05) 0 0 0 1px inset` |
| Feed reaction button ("Add reaction") | bg rgb(249, 248, 247) | bg rgb(32, 32, 32) |
| Feed small control (55x30) | bg white, border 1px rgb(240, 239, 237) | bg rgb(47, 47, 47), border 1px rgb(44, 44, 43) |
| Feed avatar `img` | bg white, outline 1px rgba(42, 28, 0, 0.07) | bg rgb(25, 25, 25), outline 1px rgba(255, 255, 243, 0.082) |
| List view rows | no own colour beyond inks and pills (sweep found no list-specific fill) | same |
| Map view | the map canvas was not captured (no Place property, so no pins); only the toolbar and a card | |

### 4.6 Calendar and timeline

| Part | Light | Dark |
|---|---|---|
| Weekend day cell | bg **rgb(249, 248, 247)** | bg **rgb(32, 32, 32)** |
| Day grid borders (right, bottom) | 1px rgb(230, 229, 227) | 1px rgb(56, 56, 54) |
| Weekday header row bottom | `rgb(230, 229, 227) 0 1px 0 0` | `rgb(56, 56, 54) 0 1px 0 0` |
| Weekday names ink | rgb(125, 122, 117) | rgb(125, 122, 117) |
| **Today marker** (24x24 circle with the day number) | bg rgb(229, 100, 88), ink **rgb(255, 255, 255)** | bg rgb(229, 100, 88), ink **rgb(0, 0, 0)** |
| Timeline view bg | rgb(253, 253, 253) | rgb(25, 25, 25) |
| Timeline header bottom | `rgb(230, 229, 227) 0 -1px 0 0 inset` | `rgb(56, 56, 54) 0 -1px 0 0 inset` |
| Timeline today dot (22x22) | rgb(229, 100, 88) | rgb(229, 100, 88) |
| Timeline edge fades (30x30) | `linear-gradient(90deg, rgb(255,255,255) 20%, rgba(255,255,255,0) 100%)` | `linear-gradient(90deg, rgb(25,25,25) 20%, rgba(241,241,239,0) 100%)` |

Calendar events and timeline bars: **not measured** (the Event calendar had no event in October 2026, and no Roadmap bar was in the swept band).

### 4.7 Peeks, row page, menus, tooltip, inputs, buttons

| Part | Light | Dark |
|---|---|---|
| Side peek panel (756x717 at x 756) | bg white; shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`; radius 0 | bg **rgb(32, 32, 32)**; shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` |
| Center peek backdrop (full window) | rgba(15, 15, 15, **0.6**) | rgba(15, 15, 15, **0.8**) |
| Center peek panel (960x573 at (276, 72)) | bg white, radius **12px**, shadow as the side peek | bg rgb(32, 32, 32), radius 12px, shadow as the dark side peek |
| Peek comments column (280 wide) | bg white | bg rgb(32, 32, 32) |
| Row page (full page) | frame bg as 4.1; title ink primary; property label ink secondary | same rule |
| Menu / popover (View settings 290x574, property menu 220x502) | bg white; shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`; radius 10px (3.8) | bg **rgb(37, 37, 37)**; shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` |
| Small floating bar over a card (57x24) | bg white, shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px` | bg rgb(37, 37, 37), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` |
| **Tooltip** ("Sort", 39.8x26.8) | bg rgb(44, 44, 43), ink rgb(240, 239, 237), radius 6px, padding 5px 8px, 12px, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`; delay not measured (the 1.2-1.4 s seen includes the script gap; see §1, where the same clock read 1589 ms for a 512 ms hint) | **identical** in dark |
| Description hint (2nd line) | rgb(173, 169, 163) (research 31 §1) | not read |
| "New" button | bg rgb(39, 131, 222), ink rgb(243, 249, 253) | same |
| "New" chevron split | `rgba(28,19,1,0.11) 1px 0 0 0 inset` | `rgba(255,255,235,0.1) 1px 0 0 0 inset` |
| View search field | only the "Clear search" button was captured (ink rgb(142, 139, 134), border 4.1); the input box itself has no own bg or border in the sweep | same |
| Table row checkbox (16x16, left of the row) | border 1px rgba(27, 21, 0, 0.19) | border 1px rgba(255, 252, 235, 0.306) |
| Confirm dialog (3.10) | bg white, radius 12px, backdrop rgba(15, 15, 15, 0.6) | not read |

Toasts: **not measured**. No action in the session raised one (creating databases, "Remove" in 3.10 and row creation showed none).

## 5. List B status after this round

| Item | Status |
|---|---|
| A10 (header without description) | **Measured**, §1: no hint on 4 headers, 2 points each, with a positive control. |
| Session blocker: Cmd+Z | **Measured**, §2: keydown arrives with `metaKey: true`; undo and redo run. Cmd-click not tried. |
| B6 the 12 unread schemas | **Measured**, §3.4, 3.5, 3.11, 3.12 (all chips on; defaults recorded). |
| B6 Campaign Owner / Budget, Content Calendar Accounts, By Market / By Platform | **Measured**, §3.6, 3.7. |
| B6 card-layout tile per template board | **Measured**, §3.2, 3.13: List on every template board and on a board made from scratch. |
| B6 "Hide empty groups" on Status boards | **Measured**, §3.3: the template's "on" is not applied until set by hand. |
| B6 page templates behind "+ New campaign" / "New content" | **Measured**, §3.8 (plus New event, New post; Engineering Docs has a second template "Guide Template", body not opened). |
| B6 Content Calendar icon | **Measured**, §3.8: `calendar_purple.svg`. |
| B6 what "Undo … database" does | **Measured**, §3.10: confirm dialog, then only the Tasks-database designation goes. |
| B6 Projects' "Turn into" | **Measured**, §3.10: submenu "Turn into Tasks database" / "Turn into Skills database". |
| B6 Customize search and Escape | **Could not measure: time.** |
| Colour dump (asked mid-session) | **Measured**, §4. Gaps: Default / Gray board columns, calendar events, timeline bars, toasts, card hover, "New" / Filter hover, map canvas, dark description hint, dark confirm dialog. |
| B5, B2, B9, B10, B12, B4, B7, B8, B11, B13, B14, B15, B16, B18, B19, B20, B22, B3, B17, B21, B1 | **Could not measure: time.** The session (21:46 to about 04:00) went to B6 (12 templates at 14-25 min each, plus re-reads of Campaign and Content Calendar) and to the colour dump, in the order the coordinator set. None of these was started. |

## 6. Safety and account state

- **No billing surface opened.** Every new control was hovered or guarded first (`guard.sh`, `gate.sh`). `gate.sh` hits were text false positives ("Plan and manage your events", "Business Development").
- Not used: Notion AI, Copy to Clipboard, Copy link, charts, dashboards, favorites, share or invite, "Email me a copy", "More in Marketplace", "Add shortcut to sidebar", Sprints.
- Settings was opened twice, only to put the theme back. Nothing was read into a file and no screenshot was taken while it was open. The theme setting is back to **Use system setting** (read back after a reload).
- Sidebar: one screenshot of the sidebar was taken to find the workspace switcher; it showed page and workspace names and was deleted at once.
- The scratch page "Blok measure scratch 33 2026-10-21" went to Trash (page Actions › Move to Trash; "Moved to Trash" announced). Its databases (the scratch table and the 16 template databases) went with it. No scratch entry is left in the sidebar. After trashing, the tab moved to another page; nothing was clicked there.
- The gallery's "Existing data sources" list (the user's own databases) was never clicked. Dumps that held those names, the user's name or page names were deleted or scrubbed (`<user>`, `<own page>`). `.playwright-cli/` snapshots were deleted.
- The session `notion33` was closed. No other session was touched.
