# Research 23: Notion final leftovers (date picker submenus, research/22 UNMEASURED list, OU7, OU11, OU13, OU14, OU19)

Measured 2026-10-20 (local) in the user's signed-in Chrome via `playwright-cli -s=notion-measure13 open --extension`, on app.notion.com.
Workspace "Personal", Free plan. Viewport 1512x717 CSS px, DPR 2, never changed. Theme at start: light (body bg rgb(255, 255, 255)).
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure13/` (not in the repo). Helpers copied from research/22 (`notion-measure12/`, session renamed).
Every value is `getComputedStyle` / `getBoundingClientRect` read in the page, a tooltip read from the DOM, or a screenshot. Anything not observed is **UNMEASURED**.

Sections: 1 date picker, 2–3 research/22's UNMEASURED list, 4 OU11, 5 OU13, 6 OU14, 7 OU19, 8 gallery focus (extra), 9 table undo (extra), 10 OU7.

## 0. Setup

- Sidebar "New…" (tooltip) › Page. Private page **"Blok measure scratch 13 2026-10-20"**. Caret checked in the H1 before typing.
- `/table view` › "New empty data source". Properties: Stage (Select), Due (Date), Amount (Number), Mail (Email), Tel (Phone), Note (Text).
- Rows Alpha…Foxtrot. Amount **-5, 0, 100, 999, 1000, 1500** (chosen for the Range edges). Alpha: Mail a@b.co, Tel +1 555 0100.
- Page clock during the run: Tue Oct 20 2026 ~05:49 GMT+2, `Europe/Berlin`.

## 1. Date picker submenus (`10-…`–`16-…`)

Picker opened from the Alpha › Due cell: 248x500 (558 with Include time on). Rows, top to bottom: calendar, **End date** (switch), **Date format ›** (value "Full date"), **Include time** (switch), [with time: **Time format ›** "12 hour", **Timezone ›** "GMT+2"], **Remind ›** "None", **Clear**, **Learn about reminders**.
With Include time on, the calendar's "Today" button reads **"Now"**, and the time field fills **6:00 AM** (clock was 5:49 AM; one sample, so the rounding rule is UNMEASURED).

Submenus open as a 180-wide menu at the picker's right edge (x 1262 for a picker ending at 1266), radius 10px. Items 172x28, radius 6px, label 14px/16.8px rgb(44, 44, 43).
**Checked look:** a `checkmarkSmall` icon, 16x16, fill rgb(44, 44, 43) (primary ink), at the item's right end (x 1414 in a 1266–1438 item). **No fill, no colour change** on the checked row.

| Submenu | Options in order (✓ = default) | Cell shows for Oct 20 2026 6:00 AM |
|---|---|---|
| Date format | **Full date ✓**, Short date, Month/Day/Year, Day/Month/Year, Year/Month/Day, Relative | Full `October 20, 2026` · Short `Oct 20` · M/D/Y `10/20/2026` · D/M/Y `20/10/2026` · Y/M/D `2026/10/20` · Relative `Today` |
| Time format | Hidden, **12 hour ✓**, 24 hour | 12h `October 20, 2026 6:00 AM` · 24h `October 20, 2026 6:00` · Hidden `October 20, 2026` (time dropped from the cell; the picker's time field still shows `6:00 AM`) |
| Timezone | see below | — |
| Remind | None ✓, At time of event, 5 minutes before, 10 minutes before, 15 minutes before, 30 minutes before, 1 hour before, 2 hours before, 1 day before (9:00 AM), 2 days before (9:00 AM) | not changed |

- The picker's date field follows the format: `Oct 20` (Short), `10/20/2026`, `20/10/2026`, `2026/10/20`; Full and Relative both show `Oct 20, 2026`. Short date was seen only for a current-year date.
- Picking an option closes the submenu and keeps the picker open. Escape closes only the submenu.

**Timezone submenu** (`14-timezone.png`, `15-timezone-search.png`):

- Opens to the **left** of the picker: 342x595 at x 680, white, radius 10px, menu shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`.
- Top: search input **"Search cities, timezones…"**, 14px/20px, **focused on open**.
- Section **"Current timezone"** (12px/14.4px weight 500, rgb(125, 122, 117)) with one row **Berlin / GMT+2:00** and the checkmark. Then section **"Select a timezone"**: **567 rows** (568 options incl. the current one), first Abidjan, Accra, Addis Ababa, Algiers…; last Mountain (US), Pacific (US), UTC, W-SU, WET.
- Each option is two lines, 334x45, radius 6px: city 14px/16.8px rgb(44, 44, 43), offset `GMT+3:00` / `GMT` / `GMT-6:00` 12px/16.8px rgb(125, 122, 117). Offsets are not uniformly padded (`GMT+05:30` for Kolkata next to `GMT+10:30`).
- Search is fuzzy: "tok" → Vostok, Tokyo, Vladivostok, Khartoum, Atikokan, Tomsk… ; "zzqx" → **"No results"** under the "Select a timezone" header.

**"Learn about reminders"** (last row, `16-…`):

- `<a href="https://www.notion.com/help/reminders" target="_blank" rel="noopener noreferrer">`, 240x28, radius 6px, inside a 248x36 footer block (no border or inset line found on it).
- Icon `questionMarkCircle` 20x20 (viewBox 0 0 20 20), fill rgb(142, 139, 134). Label 14px/16.8px rgb(44, 44, 43).
- Hover bg ≈ rgba(33, 27, 23, 0.051). No tooltip. Not clicked (a new tab to the help page is implied by `target=_blank`, not observed).

**Blok should:** offer the same four menus with these exact labels and order, a right-end primary-ink checkmark (no fill) for the current value, and a searchable timezone list with "Current timezone" pinned on top and "No results". Swap "Today" for "Now" when time is on. Put a help link row at the bottom only if Blok has reminders.

## 2. research/22 UNMEASURED list

### 2a. Board "99+" (`41-board.png`, `42-count-menu.json`, `43-board-count-full.png`)

Rows doubled with select-all › right-click › **Duplicate** to 136 rows. Fresh Board, grouped (default) by Stage, which has no options, so all 136 sit in "No Stage".

- Toggle **on** (default): the column count reads **`99+`**. Element: the count button itself, **38x20**, radius 4px, 14px/16.8px weight 400, ink rgb(95, 94, 89). Hover bg ≈ rgba(33, 27, 23, 0.051). **No tooltip** on hover.
- Toggle **off** (count button › Count › "Show large counts as 99+"): the count reads **`136`**, button 36x20, same font and ink.
- Scope of the toggle: UNMEASURED. Inference only: it sits in the board-calculation menu, which research/22 found per view.

### 2b. Gallery: Delete with several cards selected (`27-…`, `28-g-multi-delete.png`)

Del3 + Del2 Shift-click selected, then **Delete**:

- Both rows go to Trash **at once. No dialog.**
- Toast (dark pill, bottom centre): **"Moved to Trash"** + **"Restore"**. Same toast as for one card.
- Screen-reader text: **"2 blocks deleted"** (one card gave "1 block deleted" in research/22).
- Selection cleared, card count 9 → 7.

### 2c. Calendar drag box started inside the grid (`32-cal-inside-during.png`, `-after.png`)

Pointer down on empty space in the Oct 19 day cell (690, 405), dragged up-right to (1010, 335) across Oct 20–22.

- A selection box draws (bg rgba(35, 131, 226, 0.14), border 1px transparent; mid-drag rect 690,347 266x58, lagging the pointer).
- **All five events it touched are selected**, across three days (Bravo, Alpha, Charlie, Echo, Delta), each with the 85x26 blue overlay.
- **No event was created** (still 5 items) and no dialog opened. No "N selected" bar.
- So for **selecting**, starting inside the grid behaves like starting in the page margin (research/22).
- One sample: pressing **Escape** right after this drag **did not clear** the selection (5 events still had the overlay). research/22 saw Escape clear it after a margin-start drag. Not repeated.

### 2d. Number Range edge buckets (`44-…`–`47-board-range.png`)

Board grouped by Amount › Number by **Range** with the defaults (inputs read `0`, `1000`, `100`). Values -5, 0, 100, 999, 1000, 1500:

| Value | Group |
|---|---|
| -5 (below start) | **"Out of range"** |
| 0 | "0 to 100" |
| 100 | **"100 to 200"** (lower bound inclusive, upper exclusive) |
| 999 | "900 to 1000" |
| **1000 (= end)** | **"1000 to 1100"** (a bucket past the end, not "Out of range") |
| 1500 (above end) | **"Out of range"** |
| empty | "No Amount" (first column) |

Order left to right: No Amount, 0 to 100, 100 to 200, 900 to 1000, 1000 to 1100, Out of range (hide-empty on). Below-start and above-end share **one** "Out of range" column (32 = 16 + 16).

### 2e. Hide empty groups default (`44-group-stage.png`, `45-group-amount.png`)

Fresh board, View settings › Group:

- Grouped by **Stage** (Select, the default): **Hide empty groups = off**, **Color columns = on**, Sort "Manual".
- Changed Group by to **Amount** (Number): **Hide empty groups turns on by itself**, Sort becomes "Ascending", Number by "Unique", and the **Color columns row disappears**.

### 2f. Not measured here

- "Don't remove", timeline right edge, email/phone Escape, ⋮⋮ menu while favorited: see §3 below.
- Side peek details panel at a narrow window: **UNMEASURED** (the window cannot be resized through the extension without resizing the user's real window; research/22 found 564px is the side peek minimum).

**Blok should:** show `99+` above 99 when the toggle is on (default), the full count when off. Delete on a multi-selection trashes all with one "Moved to Trash / Restore" toast and no dialog. A drag box can start anywhere in the calendar grid. Range buckets are [start, start+step); values below the range start or beyond the last bucket go to one "Out of range" group, but a value equal to the range end still gets its own "end to end+step" bucket. Grouping by a number turns Hide empty groups on and sorts ascending; grouping by a select leaves it off.

## 3. research/22 UNMEASURED list, continued

### 3a. "Don’t remove" in the remove-sorting dialog (`51-…`, `53-sorted-drag2-*.png`, `54-after-dont-remove2.png`)

The 136 test rows were trashed first (three batches of 43 via select › right-click › Move to Trash), leaving 7 rows.

- Manual order: Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Del1. Sort Amount **high → low**: Foxtrot, Echo, Delta, Charlie, Bravo, Alpha, Del1 (empty last).
- Dragged Alpha's ⋮⋮ handle to the top. Dialog **"Would you like to remove sorting?"** with **Remove** / **Don’t remove** (curly apostrophe U+2019).
- **Don’t remove** → the dialog closes, **the sort stays** (pill "↑ Amount" / "Amount" still shown), and the table **still shows the sorted order** (Alpha back at its sorted spot). The dragged row stays selected ("1 selected" bar seen in the first run, `52-…`).
- Then Sort pill › **Delete sort** → manual order is now **Alpha, Foxtrot, Echo, Delta, Charlie, Bravo, Del1**.
  - So "Don’t remove" still **wrote the manual order**: the sorted order was baked in and the drop applied (Alpha to the top). The old manual order is gone.
  - Same thing in an earlier run with 136 rows: after "Don’t remove" + Delete sort, all 16 Alpha copies (sorted first) had moved to the top of the manual order.

**Blok should:** on "Don’t remove", keep the sort and the sorted display. Whether to also bake the manual order like Notion does is a product call. Notion's behaviour loses the user's old manual order silently, which looks like a bug, not a rule.

### 3b. Timeline right-edge resize at Hours (`61-hours.png`, `62-…`, `63-redge-*.png`)

Alpha set to Oct 20 6:00 → 6:30 AM. Hours zoom: bar 792.4 → 935.2 (142.8px for 30 min).

- Right resize handle: **8px wide at x 933.2–941.2** with the bar edge at 935.2 (2px inside, 6px outside), `cursor: col-resize`. Mirror of the left handle.

| Gesture from the right edge | Readout while dragging | Result |
|---|---|---|
| +20px (≈4 min) | "Oct 20, 6:30 AM" | No change |
| −20px | "Oct 20, 6:30 AM" | No change |
| **+40px** (≈8 min) | **"Oct 20, 6:45 AM"** | End **6:45 AM** (width 215.8). Table cell read `October 20, 2026 6:00 AM → 6:45 AM`. |
| −40px from the new edge | "Oct 20, 6:30 AM" | End back to **6:30 AM** (width 142.8) |

- Mid-drag look (`63-redge-p40.png`): bar tinted blue (selected), a dark vertical marker at the edge, readout text **to the right of the edge** showing the **end** time.
- So the right edge snaps to 15 minutes, nearest step, live, like the left edge.

### 3c. Escape after editing an existing email / phone (`55-edit-Mail.png`, `55-edit-Tel.png`)

Opened the editor by clicking 110px into the cell (clear of the Copy button), pressed End, typed one character, then Escape.

| Cell | Before | Typed | After Escape |
|---|---|---|---|
| Mail | a@b.co | "m" | **a@b.com saved** |
| Tel | +1 555 0100 | "1" | **+1 555 01001 saved** |

The editor input already holds the value. For Tel the caret starts at the end (selection 11–11). For Mail `selectionStart` is `null` (an `type=email` input). Escape **commits** for both, like URL/number/text.

### 3d. ⋮⋮ handle menu while the row is favorited (`56-handle-menu-favorited.png`)

Bravo favorited through right-click › **Add to Favorites** (sidebar Favorites then listed "Bravo" first).

- Handle tooltip leaves: "to move", "or", "⌘/", "to open menu" (aria-label "Drag to move, click to open menu").
- Clicking the ⋮⋮ handle opens the same menu as right-click: **Page** (header) · **Remove from Favorites** · Edit icon · Edit property · Open in › · Comment ⌘⇧M · Copy link · Duplicate ⌘D · Move to ⌘⇧P · Move to Trash Del · footer "Last edited / Jack Uait / Today at 5:57 AM".
- Menu 265 wide, opened to the **left** of the handle (x 207 for a handle at 486).
- Clicked **Remove from Favorites** in it: the sidebar Favorites went back to the user's own "New page" only.

**Blok should:** commit email and phone edits on Escape. Snap the right edge like the left, with the end-time readout to the right of the edge. Make the ⋮⋮ menu and the right-click menu one menu, flipping "Add to Favorites" / "Remove from Favorites".

## 4. OU11: backlinks on a row page, order and many backlinks (`70-…`–`74-…`)

Setup: sub-pages of the scratch page, nested (BL1 › BL2 › … › BL5), each with one text block "See @Charlie" mentioning row **Charlie**, created BL1 → BL5 about 30 s apart. The `@` menu put **"Invite “Charlie”…"** (People) first and highlighted; the row was picked with the mouse by its breadcrumb ("Blok measure scratch 13 2026-10-20 / New database"). Rows with the same name from trashed scratch pages 11 and 12 were also offered.

Charlie opened full page, then reload:

| State | Button text | Popover rows, top to bottom |
|---|---|---|
| 5 pages, 1 mention each | **"5 backlinks"** | BL5, BL4, BL3, BL2, BL1 (**newest first**) |
| + a 2nd mention in BL1 (new block) | **"6 backlinks"** | **BL1**, BL5, BL4, BL3, BL2 (5 rows: BL1 listed **once**, moved to the top, its link now points at the new block) |
| + a mention inside row Delta's **Note** (Text property) | **"7 backlinks"** | **Delta**, BL1, BL5, BL4, BL3, BL2 (6 rows) |

- **Order: newest first.** Whether that is the mention's time or the source page's last-edit time is not separated here (each BLn was also edited when BLn+1 was nested in it). A page with two mentions is one row (at the position of its newest mention), but the **count is per mention**, so the number on the button (6, 7) is higher than the number of rows (5, 6).
- **A mention in a row property counts.** Its row: "Delta", breadcrumb "Blok measure scratch… / New database", href `/p/Delta-<id>?pvs=25` with **no `#block` anchor** (block mentions carry `#<blockId>`).
- Breadcrumbs collapse the middle: "Blok measure scratch…/.../BL4" for BL5, "Blok measure scratch…/BL1" for BL2, "Blok measure scratch…" for BL1. Span 12px/16px, rgb(161, 158, 153).
- Popover (`72-backlinks-5.png`, `74-…`): 500 wide, under the button at y 152, radius 10px, menu shadow. Header "Linked to this page" 12px/16px rgb(125, 122, 117). Rows are `<a>` 500x33; title 14px/18.2px weight 500 with a 1px rgba(28, 19, 1, 0.11) underline (border-bottom). Height 216 for 5 rows, 251 for 6. No max-height set and no scrolling at 6.
- 20+ backlinks (overflow, scrolling, "show more"): **UNMEASURED** (6 rows was the most built).

**Blok should:** count every mention (block or property), list one row per source page, newest mention first, link to the mentioning block (or to the row page for a property mention), and shorten long breadcrumbs as "first…/.../parent".

## 5. OU13: map pins (`80-…`–`88-…`)

Setup: header "+" › name "Place" › type **Place** (listed between ID and Created time; not gated). Place set with the location search (picked by mouse, Enter never pressed; results took 6–15 s to load, "Loading..." until then): Alpha = Eiffel Tower, Bravo = Louvre Museum, Charlie = Statue of Liberty. Map view added through "2 more…" › New view › Map (no gate). The map fit both pins clusters; Eiffel and Louvre share one pixel position at that zoom (1187,434).

- Markers: `.maplibregl-marker`, `aria-label="Map marker"`, 22x32. `getAttribute('href')` on that element read `null` on all three. A child or wrapper `<a>` (research/20 described the pin as `<a href>`) was not checked: link UNMEASURED.

### 5a. Hover delay (`82-pin-hover.png`)

Timed in the page with `performance.now()`: `pointerover` on the marker → the card's "Charlie" text in the DOM; `pointerout` → gone. Four runs:

| Run | Show delay | Hide delay |
|---|---|---|
| 1 | 163 ms | — |
| 2 | 165 ms | 54 ms |
| 3 | 162 ms | 55 ms |
| 4 | 160 ms | 55 ms |

- So the card shows **≈160 ms** after the pointer enters and goes **≈55 ms** after it leaves. No warm window was tested separately (each run started from a fully closed card 1.5 s later).
- Card: 260x119 at 434,404 for a pin at 553,530 (card above-left of the pin), white, radius 10px, menu shadow. Content: page icon, breadcrumb "Blok measure scratch 13 … / New dat…" (truncated), title **"Charlie"** 13px/14.95px weight 600 rgb(44, 44, 43).

### 5b. Pins with a conditional colour (`83-…`–`86-map-condcolor-gt50.png`)

View settings › Conditional color (no badge, no upgrade glyph, no tooltip on "New color setting"; clicking it opened no checkout).

- "New color setting" › property list **Name, Amount, Due, Note, Place, Stage** › Amount → a rule card **"Amount is not empty" / "Page background: Green"** (default colour Green) + **"Add another"**.
- Condition menu for a number: **=, ≠, >, <, ≥, ≤, Is empty, Is not empty**. After ">" the value field "Type a value…" is focused.
- **Pin colour = the rule's colour.** The pin's inner path fill switches from `#2383E2` (rgb(35, 131, 226)) to **`var(--c-greIcoAccPri)` = rgb(70, 161, 113)**. The white backing path (`var(--c-bacPri)`) is unchanged.
  - "Amount is not empty": all three pins green.
  - **"Amount > 50"**: Charlie (100) green; Alpha (-5) and Bravo (0) **stay blue #2383E2**.
- Other colours: UNMEASURED (only Green was seen).

### 5c. Clicking a row in the "No place" list (`87-no-place.png`, `88-no-place-click.png`)

- Toolbar chip **"No place (4)"** opens a 320-wide popover under it: search field **"Search for a page…"** (focused; ellipsis character this time), then rows **Del1, Foxtrot, Echo, Delta** (each an `<a role=menuitem>` 28px tall, `pageEmpty` icon). Order is **newest first** among the unplaced rows (Del1 was created last), **not** the table's manual order (which had Del1 last). New views listed rows newest-first in research/22 too.
- Each row's href is `/p/<scratch page>?p=<row id>&pm=c&pvs=31`.
- **Clicking Delta opens it in center peek** (`?p=…&pm=c`), the map's "Open pages in" default. **The popover stays open behind the peek**: the first Escape closes the peek, the second closes the popover.
- Many pins (100+, clustering, load limit): **UNMEASURED** (3 pins only).

**Blok should:** show the pin card after ≈160 ms and hide it ≈55 ms after leaving. Paint a pin with its conditional-colour rule's icon colour (rule precedence with several rules: UNMEASURED) and leave non-matching pins blue. A click in the "No place" list opens the row in the map's open mode and keeps the list open underneath.

## 6. OU14: form "Anonymous responses" and the Responses view (`90-…`–`99-…`)

Form added through "N more…" › New view › Form. Prompt **"Auto-create form questions based on existing properties?"** / "Only supported property types will create new questions." / **Create 7 questions** / **Start from scratch** → Create 7 questions (the respondent page starts Name, Due, Amount, Mail, Tel; the rest were not read). Tab name "Form builder".

- **Share form** panel: Who can fill out "Anyone at Personal with link", **Anonymous responses** (switch, off, `personCropCircleDashed`, no gate glyph, no tooltip), Access to submission "No access", the form URL `…/p/<form id>?pvs=106`, "Copy form link" (not pressed). Sharing was **not** changed.
- Turned Anonymous responses **on**. The builder did not change (bar still "Only members at Personal can fill out this form.").
- A "Who" property of type **Created by** was added to the table to see the effect.

**Respondent page** (opened the form URL in the same signed-in tab, i.e. as a workspace member; `96-form-respondent.png`):

- With anonymous on, the form starts with a pill **"Submitting response anonymously"**: 242x33, bg **rgba(84, 72, 49, 0.04)**, text 14px/21px rgb(125, 122, 117), radius 6px, no icon, no tooltip. It replaces nothing else; questions follow ("Your answer" inputs).
- Filled Name = "FormResp1", pressed **Submit**.
- Thank-you screen (`98-form-submitted.png`): an icon, **"Thank you!"** (H2 24px/36px weight 700), **"Your response has been submitted successfully."** (16px/24px), buttons **"View my response"** (144x32, bg rgb(44, 44, 43), text rgb(240, 239, 237) 14px weight 500, radius 6px) and **"Email me a copy"** (137x32, white, border 1px rgba(28, 19, 1, 0.11), 15px). Neither was clicked. (research/19 found no email-copy option in the builder; it is offered to the respondent here.)

**What anonymous changes:**

- The new row **FormResp1** was added at the end of the table. Its **Created by** cell reads **"Anonymous"** with a generic round avatar (`img alt="Anonymous"`, 20x20, a Notion static PNG), not the submitting user "Jack Uait" that every other row shows.

**Responses view:** **none appeared** after the submission. The view list (via "4 more…") stayed Table, Gallery, Calendar, Board, Timeline, Map, Form builder. The response is just a new row in the source.

- Anonymous **off** + submit (whether Created by shows the member then): UNMEASURED. Turning anonymous back off was not needed (the form is inside the trashed page).

**Blok should:** with anonymous responses on, show "Submitting response anonymously" at the top of the form and store the response with no author (Created by shows "Anonymous"). Do not create a Responses view on submit; the response is a row. Offer "View my response" / "Email me a copy" on the thank-you screen only if Blok has those features.

## 7. OU19: leaving the page while customizing the row-page layout (`100-…`–`109-…`)

Row Charlie opened full page › title hover row › **Customize layout** (`layoutFillSmall`, no badge, no tooltip). The builder takes the whole window (no app sidebar): top bar "New database" / **"Preview: Charlie ▾"**, **× Cancel**, **✓ Apply to all pages** (+ chevron), right panel "Page settings". Draft change used every time: **Full width** switch on (tooltip "Page width can be overwritten on individual pages.").

| Way out, with a draft | What happened |
|---|---|
| **Escape** | Nothing. Builder stays, draft kept. |
| **Cancel** | Dialog **"Discard all layout changes?"** with **Discard** / **Cancel**. Cancel keeps editing (draft kept). Discard closes the builder; Full width was not applied (h1 still 720 wide). |
| Cancel with **no** changes | Closes at once, no dialog. |
| **Preview ▾ › another row** (Bravo, "next row") | Preview switches to Bravo (h1 "Bravo"), **draft kept**, no prompt, URL unchanged (still Charlie's). |
| Browser back to an entry that needs a **full page load** | Native **`beforeunload`** prompt (message ""). Dismissed ("stay") → builder still open, draft kept. |
| **In-app back** (`history.back()` to BL2, reached earlier by in-app links; page JS state survived) | **The URL changes to BL2 at once, but the builder stays on screen** with the same **"Discard all layout changes?"** dialog. **Cancel** → builder and draft stay, **URL stays BL2** (address bar and screen out of sync). Back again (to Charlie) → dialog again → **Discard** → builder closes and the page at the current URL (Charlie) shows. |

- Dialog look (`104-builder-cancel.png`): 324x145, radius 12px, shadow `rgba(25,25,25,0.24) 0 24px 48px, rgba(25,25,25,0.14) 0 4px 12px, rgba(42,28,0,0.07) 0 0 0 1px`. **Discard** 284x32 bg rgb(229, 100, 88), text rgb(253, 246, 246) 14px weight 500, radius 6px. **Cancel** 284x32 white, border 1px rgba(28, 19, 1, 0.11). Same box as the remove-sorting dialog, but Discard here is a filled red button.
- The draft is never auto-saved: every exit that closed the builder (Discard) dropped it. Nothing persisted the draft across a page load (a load was only offered through `beforeunload`, which was dismissed).
- Leaving by clicking a sidebar item: not possible (no sidebar in the builder). Leaving through a link inside the preview: the preview's "7 backlinks" opens the Heading module settings, not the popover.

**Blok should:** keep the draft across Escape and preview-row switches. On Cancel or any navigation with a draft, ask "Discard all layout changes?" (Discard / Cancel) and only drop the draft on Discard; with no draft, close silently. Unlike Notion, block the route change until the user answers, so the URL and the screen stay in sync.

## 8. Gallery focus after closing a peek, and Enter after Cmd-click (`20-…`–`26-…`)

Gallery, 2 cards per row (Foxtrot Echo / Delta Charlie / Bravo Alpha). Selection read as the rgba(35, 131, 226, 0.14) overlay (research/22). Focus read from `document.activeElement`.

| Sequence | After Escape | Then ArrowDown |
|---|---|---|
| Plain click Delta (center peek) → Escape | Peek closed. **Nothing selected. Focus on `<body>`.** No ring. | **Nothing** (selection empty, scrollTop stayed 0). Seen twice. |
| Shift-click Delta → Enter (center peek opens; focus moves into the peek's page) → Escape | Peek closed. **Delta re-selected** (blue overlay back). **Focus on `<body>`**, not the card. | 1st press: **selection stays on Delta**, page scrolls 53.5px. 2nd press: selection moves to **Charlie** (next in reading order). Seen twice. |
| Control: Shift-click Delta → ArrowDown (focus still on Delta's `<a>`) | — | Selection moves to **Charlie** on the 1st press (page also scrolls 53.5px). Focus stays on Delta's `<a>` (`:focus-visible` true, outline `rgba(0,0,0,0) solid 2px`, so no visible ring). |

- **Cmd-click** a card (Meta held, `click` event had `metaKey: true`): **no selection, no peek**, focus lands on the card's `<a>` (`:focus-visible` false). `tab-list` still showed one tab (a tab outside the relayed one is not ruled out, unverified).
- **Enter after that Cmd-click: opens the card** (Delta) in **center peek** (`?p=…&pm=c`). The page saw a plain `click` on the card right after the Enter keydown (the focused `<a>` activates). **No rename.**

**Blok should:** after a peek opened from a selection closes, restore the selection (Notion does), but restore keyboard focus too so the first ArrowDown moves it (Notion's first press is lost to a scroll; do not copy that). After a peek opened by a plain click closes, nothing is selected. Enter on a focused, unselected card opens it; it never renames.

## 9. Table: Cmd+Z after a cell edit, focus and selection (`110-…`–`113-…`)

Meta key combos **did** reach the page this time: a capture listener logged `keydown "z" metaKey=true target=BODY`, and the undo ran.

**Enter in a cell editor** (Mail cell, typed, Enter): commits, closes the editor and **moves the cell selection one row down in the same column** (Foxtrot/Mail → Echo/Mail). `document.activeElement` is **`<body>`**. Selected-cell look: overlay with bg **rgba(35, 131, 226, 0.07)**, **`rgb(39, 131, 222) 0 0 0 2px inset`**, radius 2px, `pointer-events: none`, cell rect 199x36.

| Step | Values | Selected cell | Focus |
|---|---|---|---|
| Foxtrot/Mail "f@x.io" + Enter | f@x.io saved | Echo/Mail (moved down) | body |
| **Cmd+Z** | **f@x.io removed** | **Echo/Mail (unchanged)** | body |
| Delta/Mail "d@x.io" + Enter | saved | Charlie/Mail | body |
| Bravo/Mail "b@x.io" + Enter | saved | Del1/Mail | body |
| **Cmd+Z** (1st) | **b@x.io removed** (last edit first) | **Del1/Mail (unchanged)** | body |
| **Cmd+Z** (2nd) | **d@x.io removed** | **Del1/Mail (unchanged)** | body |

- Undo reverts edits **last-first, one edit per Cmd+Z**, across different cells.
- **Undo does not move the selection** to the reverted cell, does not open an editor, and does not focus anything (focus stays on `<body>`). No highlight or flash on the reverted cell was seen in the screenshots taken ≈1.5 s after the key.
- Whether the table scrolls to an off-screen reverted cell: UNMEASURED (all cells were on screen).

**Blok should:** on Enter in a cell editor, commit and select the cell below. Cmd+Z undoes one cell edit at a time, last first, and leaves the selection where it is. (Moving the selection to the reverted cell would be friendlier, but it is not what Notion does.)

## 10. OU7: "New data source" in the add-view menu (`120-…`–`127-…`)

Done last. Entry: "4 more…" › last row **"New data source"** (`squareOnSquarePlus`), below "New view". Hover: no tooltip, no badge, no upgrade glyph. Click opened no checkout.

- The click **at once adds a new view tab "Table"** (selected) with an **empty schema: only "Name" + "Add property"**, and opens a right panel **"New data source"**: search "Search…", **New empty data source**, **Import CSV**, "Suggested": Tasks Tracker, Projects, Skills, More templates, then **Link to existing data source** (same list as creating a database).
- Picked **New empty data source**: the panel closes; the new Table has 0 rows and only Name.
- So "New data source" = **a second data source (its own schema and rows) inside the same database block, plus one Table view on it**. The old views (Table, Gallery, Calendar, Board, Timeline, Map, Form builder) keep the original source and its 9 properties.

**How a view shows its source:**

- The title line above the tabs is the **selected view's data source title**, not one database title. Typed "Src B" there while on the new view: it showed **"Src B"**; switching to the first Table showed the original (untitled) source with placeholder **"New data source"** (before the 2nd source existed, the same line's placeholder read "New database").
- View settings › "Data source settings" › **Source**: "Src B" for the new view, "New data source" for the old ones.
- View tab menu (click the selected tab): Rename, Display as, Edit view, **Source › Src B**, Copy link to view, Add view to sidebar, Open as full page, **Hide data source titles** (`eye`), Duplicate view, Delete view. "Hide data source titles" removes the title line (tabs move up 269 → 224); the item then reads **"Show data source titles"** (restored). The item was also in this menu while there was only one source.
- **Tabs and the "N more…" list do not mark the source**: both views are just "Table" with the `viewTable` icon.
- Source › picker: search **"Link to a data source…"**, "Suggested" (the other source of this database, breadcrumb "Blok measure scratch… / New data source a…" — the database's name had become **"New data source and New data source"**), "Existing data sources" (other databases). Nothing picked.

**Blok should:** treat "New data source" as adding a second source to the same database block with its own schema, and create one table view bound to it (`view.dataSourceId`). Show the selected view's source title above the tabs, with a "Hide/Show data source titles" toggle (whether Notion scopes it per view or per block: UNMEASURED). Notion does not mark the source on tabs; Blok could, but that is extra.

## Teardown and side effects

- **Scratch page** "Blok measure scratch 13 2026-10-20": top-bar Actions (tooltip "Page settings & actions") › **Move to Trash**. Reloading its URL shows "Jack Uait moved this page to Trash 1 minute ago. It will be permanently deleted in 30 days." (`130-trash-banner.png`). BL1 and BL5 (sub-pages) show the same banner; the sidebar lists none of "scratch 13", BL1–BL5. Trash not emptied; Restore / Permanently delete never clicked. Notion then opened the user's "Demo Page"; nothing was clicked there.
- Everything else lives inside the trashed page: the database (both data sources), its views, the form and its one response (FormResp1), BL1–BL5.
- **Separate Trash entries** (restoring the page will not bring them back): Del2, Del3 (gallery multi-delete) and **129 duplicate rows** (three batches of 43, used for the 99+ test).
- **Favorites:** Bravo added, then removed through the ⋮⋮ menu. Favorites shows only the user's own "New page", as at the start.
- **Theme:** never changed. Body bg rgb(255, 255, 255), no dark class, at start and end.
- **No billing surface opened.** "Conditional color › New color setting" and "New data source" were hovered first (no badge, glyph or tooltip) and opened no checkout. No Upgrade / Plus / Business item clicked.
- **Clipboard:** no Copy button pressed ("Copy form link", "Copy link to view", cell Copy buttons untouched). Mail/Tel editors were opened by clicking 110px into the cell, away from the Copy button.
- **Form:** "Anonymous responses" turned on and left on (inside the trashed page). "Who can fill out" never changed; nothing published. One submission, from the user's own signed-in tab. "Email me a copy" not clicked.
- **A `beforeunload` "Leave site?" prompt** appeared once (builder test) and was dismissed; no page was left unsaved.
- The `@` mention menu offers "Invite “Charlie”…" highlighted first; it was never chosen (options were picked by mouse after a hover check).
- One stray Enter early on (after a mis-aimed Cmd-click on the page margin) may have added an empty block to the scratch page. Inside the trashed page.
- Auto-snapshot folder `notion-measure13/.playwright-cli/` (32 files) deleted. Screenshots kept; none shows a checkout or the account email.
- Session `notion-measure13` was opened by this run (no open session reached Notion at the start) and closed at the end.

## UNMEASURED (collected)

- Default time when turning on Include time: one sample only (5:49 → 6:00 AM); rounding rule unknown. Short date for a non-current year.
- Board count menu per-view scope of the 99+ toggle (only one board checked).
- Calendar: whether Escape clears a selection made by an inside-grid drag (one sample: it did not).
- Side peek details panel at a narrow window (window not resizable without touching the user's real window).
- Table undo: whether the table scrolls to an off-screen reverted cell (§9).
- Backlinks with 20+ sources (overflow / scrolling / "show more"); whether order follows mention time or source last-edit time.
- Map: whether a pin is (or contains) a link; 100+ pins, clustering, load limit; colours other than Green; warm window between pins.
- Form: Created by with anonymous **off**; what "View my response" opens; "Email me a copy".
- Layout builder: leaving by a sidebar click (no sidebar in the builder); draft survival across an accepted page reload.
- New data source: whether "Hide data source titles" is per view or per block; Import CSV / templates paths; picking another source for an existing view.
- Gallery: whether Cmd-click opened a tab outside the relayed one (`tab-list` showed one tab).
