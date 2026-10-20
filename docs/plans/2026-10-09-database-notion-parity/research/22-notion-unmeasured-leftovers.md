# Research 22: Notion leftovers (OPEN-UNMEASURED rows OU2, OU5, OU8–OU21, research/21 dark gaps): measured

Measured 2026-10-20 (local) in the user's signed-in Chrome via `playwright-cli -s=notion-measure12 open --extension`, on app.notion.com.
Workspace "Personal", Free plan. Viewport 1512x717 CSS px, never changed.
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure12/` (not in the repo). Screenshots `NN-*.png`, DOM dumps `*.json`.
Helpers: copied from research/21 (`notion-measure11/`, paths and session renamed), plus `ovl.sh` (open a cell editor and dump its chain), `menustate.sh` (open menus + highlighted row), `calsel.sh` / `gsel.sh` (selection state of calendar / gallery items), `gclick.sh` (click or Shift-click an item by title), `tdrag.sh` (timeline drag with a mid-drag readout), `star.sh`, `pills.sh`, `peekgeo.sh`.
Every value is `getComputedStyle` / `getBoundingClientRect` read in the page, a tooltip read from the DOM, or a screenshot. Anything not observed is **UNMEASURED**.

## 0. Setup

- Sidebar "New…" › Page. Private page **"Blok measure scratch 12 2026-10-20"**. Caret checked in the H1 before typing.
- `/table view` › "New empty data source". Database left untitled ("New database").
- Properties: Stage (Select), Tags (Multi-select), Due (Date), Amount (Number), Link (URL), Mail (Email), Tel (Phone), Note (Text).
- Rows Alpha…Foxtrot. Amount 10 / 25 / 401 / 55 / 250 / 999. Due Oct 12 / 20 / 22 / 20 / 27 / 5 2026 (today = Tue Oct 20 2026). Delta later got a time range.
- Views: Table, Board, a second Board, Calendar, Gallery, Timeline, Feed.

## 1. OU2: calendar event selection (`41-…`–`46-…`)

| Gesture | Result |
|---|---|
| Plain click | Opens the row in **center peek** (`?p=…&pm=c`). Nothing selected. |
| Shift-click | Selects the event. **No peek.** |
| Shift-click a second event **on the same day** | Both stay selected (Delta + Bravo on Oct 20). |
| Shift-click an event **on another day** | Replaces the selection (Charlie alone; Delta and Bravo dropped). Seen twice. |
| Cmd-click | `metaKey: true` reached the page. Nothing selected, no peek. `tab-list` showed no new tab. A tab outside the relayed one cannot be ruled out (unverified). |
| Drag box from the page margin (x=450) across the grid | Selects every event the box touches, **across days** (Delta, Bravo, Charlie, Echo). |
| Escape | Clears the selection. |

- **No bulk selection bar** ("N selected") appeared in any case.
- Selection look: an overlay inside the card, same rect as the card (85x26), radius 6px, bg **rgba(35, 131, 226, 0.14)**, `pointer-events: none`. Card keeps its white bg and shadow.
- Drag box: bg rgba(35, 131, 226, 0.14), border 1px transparent, radius 0.
- Hover on an event: bg rgba(84, 72, 49, 0.08) (same as research/21).

**Blok should:** treat calendar events like the other views: Shift-click selects without opening, plain click opens, a drag box selects. Keep the 0.14 blue overlay. Do not show the bulk bar for calendar selection (Notion does not). Optional: Notion limits Shift-click growth to one day. That looks like a quirk, not a rule worth copying.

## 2. OU9: gallery keys (`54-gallery.png`, `55-…`, `56-gallery-backspace.png`)

Gallery was 2 cards per row. Selection made with Shift-click.

| Key (one card selected) | Result |
|---|---|
| ArrowDown | Selection moves to the **next card in reading order** (Foxtrot → Echo, the card to its right; then Delta, Charlie). |
| ArrowUp | Previous card in reading order. |
| ArrowRight | Nothing (selection stays). |
| ArrowLeft | **Clears the selection.** Focus lands on the card's `<a>`. Seen twice. |
| Home / End / PageUp / PageDown | **Scroll the page only** (scrollTop 0 ↔ 502). Selection does not move. |
| Escape | Clears the selection. |
| Enter, two cards selected | Opens **one** card in center peek: the **last one clicked** (Charlie then Delta → Delta; Delta then Charlie → Charlie). Selection is restored when the peek closes. |
| Backspace / Delete, one card selected | Moves the row to Trash at once. **No confirmation.** Toast "Moved to Trash" + "Restore" (screen-reader text "1 block deleted"). |

- Delete/Backspace with **several** cards selected: UNMEASURED.
- No "N selected" bar appeared in the gallery either.

**Blok should:** move the selection with Up/Down in reading order. Leave Home/End/PageUp/PageDown to page scroll. Enter on a multi-selection opens the last-clicked card. Delete/Backspace trashes the selection with an undo toast, no dialog. Do not copy the ArrowLeft-clears quirk.

## 3. OU10: URL / email / phone cells (`11-…`–`14-…`, `57-…`–`61-…`)

**Escape commits.**

| Case | Result |
|---|---|
| URL empty → typed "example.com" → Escape | Saved "example.com". |
| URL "example.com" → edited to "example.org" → Escape | Saved "example.org". |
| Email empty → "a@b.co" → Escape | Saved. |
| Phone empty → "+1 555 0100" → Escape | Saved. |
| Number "40" → "401" → Escape | Saved "401". |
| Text (Note) → Escape | Saved. |

Edited-existing-value + Escape was only tested for URL, number and text. For email and phone only empty → value was tested (the edit clicks hit the Copy button). UNMEASURED for those two.

**Table cell look:**

- Value is an `<a target="_blank" rel="noopener noreferrer">`. href: `http://example.org/`, `mailto:a@b.co`, `tel:+15550100` (spaces stripped).
- Ink rgb(44, 44, 43), 14px. Underline = `background-image` 1px line rgba(28, 19, 1, 0.11) at the bottom (`background-size: 100% 1px`). No `text-decoration`.
- Hover shows two 24x20 buttons at the cell's right end: **Comment** and **Copy to Clipboard** (tooltip "Copy to Clipboard"; hover bg ≈ rgba(33, 27, 23, 0.051), icon rgb(125, 122, 117)). **No edit (pencil) button.**
- Clicking the copy button shows the toast "Copied property to clipboard".
- Clicking empty space in the cell opens the editor with the value.

**Row page (center peek and side peek):**

- Same `<a target=_blank>`. Value row 538x34. Hover: no fill, same Comment + Copy buttons at the row's right end.
- Click on empty space right of the link → editor (input 521x21 inside a 539x38 white box, radius 6px, menu shadow).
- Click on the link text: Notion did **not** call `preventDefault`. No editor opened, no peek change. (My hook blocked the navigation. "Opens a new tab" is an inference from `target=_blank`, not observed.)

**Board and gallery cards** (Link/Mail/Tel made visible):

- Shown as links, **12px/18px**, same underline gradient.
- No per-property buttons on hover. The card hover pill (Edit pencil + ⋯) is the only edit affordance; Edit edits the title.
- Clicking the link: Notion did not prevent the default, and **the card did not open** (no peek, URL unchanged).

**Blok should:** commit on Escape for all three types. Render values as real links (`_blank`, `mailto:`, `tel:` with spaces stripped). Clicking the link follows it. Clicking beside it edits. On hover show Copy (+ Comment), not a pencil. On cards a link click must not open the card.

## 4. OU21: table cell editing look, light (`09-…`, `10-…`, `15-…`, `16-…`, `17-…`)

All editors share one chrome: bg rgb(255, 255, 255), radius 6px, shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`. **No blue ring, no border.**

| Cell | Editor box | Inner | Notes |
|---|---|---|---|
| Text (Note), cell 200x38 | **240x39**, at cell −1px left/top | padding 8px 9px; textbox 14px/21px, `white-space: break-spaces`, min-height 14px | Grows down while typing (240x79 for 3 lines). Near the right viewport edge it shifts left to stay on screen (x 1260 for a cell at 1306). |
| Name (title), cell 280 wide | **280x39** | padding 8px 9px | Same chrome. |
| URL / Email / Phone, cell 200x38 | **240x39** | `<input>` 222x21, padding 8px 9px | |
| Number, cell 200x38 | **240x38** | `<input inputmode="decimal">`, `text-align: end`, min-height 38px | |
| Select / multi-select | **300** wide popover over the cell | top token field 300x39, bg rgba(242, 241, 238, 0.6), bottom line `rgba(28,19,1,0.11) 0 -1px 0 0 inset`, max-height 240px; header "Select an option or create one" 12px/14.4px weight 500 rgb(125, 122, 117); options 292x28 radius 6px | |
| Date | **248x500** popover (opened above the row here) | input row 224x28, bg rgba(66, 35, 3, 0.03), ring `rgba(28,19,1,0.11) 0 0 0 1px`, radius 6px; text pre-selected | Opening an empty date cell shows today in the field, but Escape writes nothing. |

Only two cell widths were observed (200 → 240, 280 → 280). A "max(cell width, 240)" rule is a hypothesis.

Dark (`94-…`, `95-…`): same geometry; box bg rgb(37, 37, 37), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px`; select token field rgba(255, 255, 255, 0.03), divider rgba(255, 255, 235, 0.1).

**Blok should:** use a floating white box with the menu shadow and radius 6px, padding 8px 9px, aligned to the cell's top-left minus 1px, at least as wide as observed (240 for a 200 cell), growing downward for text. No focus ring.

## 5. OU8: board column calculation (`26-…`–`33-…`)

- Entry: click the column count (button 20x20, radius 4px, hover ≈ rgba(33, 27, 23, 0.051)). No tooltip on the count.
- Menu (200 wide): **Count › / Percent › / More options › / Date ›**.
  - Count: toggle **"Show large counts as 99+"** with hint "This improves performance for large databases." (**on by default**), then Count all (✓ default), Count values ›, Count unique values ›, Count empty ›, Count not empty ›.
  - Percent: Percent empty ›, Percent not empty ›.
  - More options: Sum, Average, Median, Min, Max, Range (each › property).
  - Date: Earliest date, Latest date, Date range (each › date property; only Due listed).
- **One setting for the whole board** (every column shows it). **Per view:** after setting Percent on Board 1, the Table footer showed nothing and a new Board 2 showed plain counts.
- Results, 14px/16.8px, in the column's colour (gray rgb(142, 139, 134), green rgb(70, 161, 113), purple rgb(181, 119, 214), "No Stage" rgb(95, 94, 89)):

| Calculation | Shown |
|---|---|
| Percent not empty (Tags) | `100%`, `50%`, `0%` (whole numbers) |
| Earliest date (Due) | `October 20, 2026` (full date) |
| Date range (Due) | `0 minutes` (one item), `8 days`, `22 days` |
| Median (Amount) | `25`, `32.5`, `401`, `624.5` |

- Tooltips: **"Percent not empty in Tags"**, **"Earliest date in Due"**, **"Date range in Due"** (pattern "<Calculation> in <Property>").
- "99+" display itself: UNMEASURED (needs >99 cards in a column).

**Blok should:** keep the calc per view and board-wide. Offer the four groups. Format percent as whole %, dates as full dates, a single-item range as "0 minutes". Tooltip "<calc> in <property>". Add the "Show large counts as 99+" toggle, default on.

## 6. OU12: feed replies and views (`51-feed.png`, `52-feed-2replies.png`)

- One comment → **"1 reply"**. Two comments → **"2 replies"**.
- Line: 24px avatar, then "N replies" 14px/21px rgb(44, 44, 43), then time 12px/18px rgb(161, 158, 153).
- The time is the **latest comment's**: Delta's comments were created 2:37:51 AM and 2:39:40 AM (tooltips "Created October 20, 2026 at …"); feed showed "2:39 AM".
- **No view count anywhere** on feed cards (no eye icon; card ⋯ menu has no views entry).
- Other users' reaction pills: UNMEASURED (single-user workspace).

**Blok should:** "1 reply" / "N replies", stamp with the latest reply's time. No view count.

## 7. OU15: number grouping (`36-…`–`38-…`)

- Group by a Number property defaults to **"Number by: Unique"** (one group per value: 10, 25, 55, 250, 401, 999, No Amount).
- "Number by" options: **Unique, Range**.
- Range defaults: **Group range 0 – 1000, Group every 100**, helper text "0 to 100, 100 to 200, ...".
- Group names: **"0 to 100"**, "200 to 300", "400 to 500", "900 to 1000". 10, 25, 55 went to "0 to 100"; 999 to "900 to 1000".
- After grouping by Amount the panel read Sort "Ascending" and **Hide empty groups = on** (only non-empty buckets showed). Its state while grouped by Stage was not recorded.
- Boundary values (exactly 100, values above 1000, negatives): UNMEASURED.

**Blok should:** default number grouping to Unique. When Range is picked, default 0–1000 step 100 and name buckets "A to B". This resolves the guess in `group-keys.ts`.

## 8. OU17: sorting and manual order (`75-…`–`78-…`)

- Table: Foxtrot dragged to the top (manual order: Foxtrot, Alpha, Bravo, Charlie, Delta, Echo).
- Sort by Amount, then **Sort panel › "Delete sort"** → **the manual order comes back** (Foxtrot first again).
- Sort by Amount again, then drag a row → dialog **"Would you like to remove sorting?"** with **Remove** / **Don't remove**.
  - Dialog 324x145, radius 12px, shadow `rgba(25,25,25,0.24) 0 24px 48px, rgba(25,25,25,0.14) 0 4px 12px, rgba(42,28,0,0.07) 0 0 0 1px`.
  - Remove: 284x32, text rgb(229, 100, 88), border 1px rgba(206, 24, 0, 0.165), radius 6px, 14px weight 500.
  - Don't remove: same, text rgb(44, 44, 43), border rgba(28, 19, 1, 0.11).
- **Remove** → the **sorted order becomes the new manual order**, then the drop applies: Foxtrot, Alpha, Bravo, Delta, Echo, Charlie. The old manual order (Charlie before Delta) does **not** come back.
- **Per view:** the Gallery kept its own order (Foxtrot, Echo, Delta, Charlie, Bravo, Alpha) through both the Table drag and Remove. New views listed rows newest-first; the first Table listed them oldest-first.
- "Don't remove": UNMEASURED.

**Blok should:** "Delete sort" restores the saved manual order. A drag while sorted asks "Would you like to remove sorting?"; Remove bakes the sorted order into that view's manual order. Manual order is per view. (This contradicts Blok's shared-order behaviour in 10-backlog P3.)

## 9. OU18: timeline at Hours zoom (`69-…`, `71-…`–`74-…`)

- Zoom list: **Hours, Day, Week, Bi-week, Month, Quarter, Year, 5 Years**.
- Hours: 15-minute columns ≈ 72.3px (a 1-hour bar is 288.7px). Header labels "1:45 AM", "2:00 AM"…; the current time label is red ("2:58 AM").
- Delta set to Oct 20 3:00 AM → 4:00 AM (table date picker, Include time + End date).

| Gesture | Drop result |
|---|---|
| Move +20px (≈4 min) | No change |
| Move +40px (≈8 min) | **+15 min** |
| Move −30px (≈6 min) | No change |
| Move −100px (≈21 min) | **−15 min** |
| Left-edge resize −20px | No change; readout "Oct 20, 3:00 AM" |
| Left-edge resize −40px | Start **2:45 AM**; readout "Oct 20, 2:45 AM" |

- So moves and resizes **snap to 15 minutes, rounded to the nearest step**.
- Move: the bar becomes a faded ghost that follows the pointer **unsnapped**; it snaps on drop. **No time readout while moving.**
- Resize: the bar snaps **live**, turns selected (blue tint), a dark edge marker shows, and a text readout "Oct 20, 2:45 AM" sits beside the edge.
- Resize handle: 8px wide, centred on the edge (6px outside, 2px inside), `cursor: col-resize`.
- Hovering an all-day or timed bar shows a dependency connector dot at its right end.
- Right-edge resize: UNMEASURED (the bar end was off-screen).

**Blok should:** snap moves and both edge resizes to 15 minutes at Hours zoom (nearest step). Show a live date-time readout on resize.

## 10. OU16: side peek and the details panel (`80-…`–`87-…`, `97-…`–`102-…`)

Side peek container:

- Default **756px** (half of 1512), full height. Resize handle on its left edge, 12px, `cursor: col-resize`.
- Drag limits: **min 564px, max 1008px** (two thirds of 1512). Width restored to 756 afterwards.
- Property label column stays **160px** at 564, 756 and 1008. Values start 174px after the label column start. Nothing collapses.

Details panel (page layout with a side panel):

- Built through row › "Customize layout" (no badge) › "Add to panel" › Amount › **Apply to all pages** (scratch DB only).
- After that, the side peek shows **"View details"** under the title (button 94x28, radius 6px, 14px rgb(142, 139, 134)) and a top-bar button `aria-label="Page info"` (icon `sidebarRight`). **The panel starts closed in the side peek.**
- Opening it (Page info or "View details", which turns into "Hide details"):
  - The panel is **280px** wide (x 1233–1512 at 1512), full height under the 44px top bar, white, left border 1px rgb(240, 239, 237).
  - The peek **grows by 280px to the left**: 564 → 844; 756 → clamped to 1008 (content column 728).
  - **The app's left sidebar collapses** while the panel is open, and comes back when it closes.
- Closing it shrinks the peek back, but from 756 it settled at 728. Width reset by hand to 756.
- A breakpoint where the panel drops below the content instead of sitting beside it: UNMEASURED (no width under 564 is reachable).

**Blok should:** start the details panel closed in the side peek, with a "View details" toggle and a top-bar button. Make the panel 280px (not 240) and widen the peek by that much, up to the peek max. Keep the 160px label column fixed.

## 11. OU5: comments on calendar events and timeline bars (`48-…`–`50-…`, `63-…`, `66-…`)

- **Calendar event right-click menu:** Add to Favorites · Edit icon · Edit property · Open in › · **Comment ⌘⇧M** · Copy link · Duplicate ⌘D · Move to ⌘⇧P · Move to Trash Del · footer "Last edited …".
  - Comment opens a floating box (470x44, white, radius 10px, menu shadow), "Add a comment…", with attach, @ and send icons. After posting it stays open and shows the thread ("Jack Uait  Just now").
  - The event then shows a comment badge ("Delta 💬 1", later 2).
- No hover buttons on calendar events.
- **Timeline bar right-click menu:** Add to Favorites · Edit icon · Edit property · Open in new tab ⌘⇧↵ · Open in side peek ⌥Click · Copy link · Duplicate ⌘D · Move to ⌘⇧P · Move to Trash Del. **No Comment item.** Bars show no comment badge.
- **Timeline table panel** ("Show table" ») rows show the badge (Delta 💬 2, Charlie 💬 1) and their right-click menu **does** have Comment ⌘⇧M.

**Blok should:** add Comment to the calendar event context menu (with the badge on the event). On the timeline, offer it in the table panel's rows. Notion has none on the bar itself.

## 12. Dark states missing from research/21 (`91-…`–`95-…`)

Theme set Settings › Preferences › Theme from "Use system setting" to Dark, then back.

| Item | Light | Dark |
|---|---|---|
| Table OPEN button | research/21 | wrapper 69x24, bg rgb(32, 32, 32), radius 6px, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`; inner 65x20 bg rgb(37, 37, 37), radius 4px, text 12px weight 500 rgb(173, 169, 163), icon same; inner hover ≈ rgba(255, 255, 255, 0.055) |
| OPEN tooltip "Open in side peek" | — | bg rgb(44, 44, 43), ink rgb(240, 239, 237), 12px/16.8px, padding 5px 8px, radius 6px, `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset` (**same as light**) |
| "+ New page" row hover | button 105x28 (text width only, not full row), radius 6px, bg ≈ rgba(33, 27, 23, 0.051), text rgb(161, 158, 153) 14px, plus icon rgb(173, 169, 163), `transition: background 0.02s ease-in` | bg ≈ rgba(255, 255, 255, 0.055), text + icon rgb(125, 122, 117) |

Select pills (20px tall, radius 4px):

| Colour | Light bg / ink | Dark bg / ink |
|---|---|---|
| Default | rgba(42, 28, 0, 0.07) / rgb(44, 44, 43) | rgba(255, 255, 243, 0.082) / rgb(240, 239, 237) |
| Brown | rgba(127, 51, 0, 0.157) / rgb(88, 68, 55) | rgba(255, 184, 132, 0.365) / rgb(245, 237, 233) |
| Red | rgba(206, 24, 0, 0.165) / rgb(109, 53, 49) | rgba(255, 116, 105, 0.525) / rgb(252, 233, 231) |
| Yellow (T1) | rgba(209, 156, 0, 0.282) / rgb(101, 81, 33) | rgba(255, 188, 53, 0.46) / rgb(249, 243, 220) |
| Green (T2) | rgba(0, 96, 38, 0.157) / rgb(42, 83, 60) | rgba(113, 255, 175, 0.337) / rgb(232, 241, 236) |

Option colour list (option ⋯): Default, Gray, Brown, Orange, Yellow, Green, Blue, Purple, Pink, Red.

**Blok should:** add these dark values. Tooltips need no dark variant. Make "+ New page" hover fill only the button, not the row.

## 13. OU20: multi-select Enter and the currency list (`18-…`, `19-…`, `22-number-format-list.png`)

Multi-select editor, Enter:

| Typed | Enter does |
|---|---|
| New name ("T1") | Shows "Create [T1]" while typing. Enter creates the option, adds it as a token, **clears the input, keeps the editor open and focused**. The new option is highlighted in the list. |
| A second new name ("T2") | Same. Both tokens kept. |
| An existing, **unselected** option ("T1" on Bravo) | Adds it, clears the input, editor stays open. |
| An existing, **already selected** option | **Nothing.** Input keeps the text, token stays (no toggle-off). |

Number format list (Amount › Edit property › Number format):

- **45 entries, no search field**: Number, Number with separators, Percent, then **42 currencies**: US Dollar (USD), Australian dollar (AUD), Canadian dollar (CAD), Singapore dollar (SGD), Euro (EUR), Pound (GBP), Yen (JPY), Ruble (RUB), Rupee (INR), Won (KRW), Yuan (CNY), Real (BRL), Lira (TRY), Rupiah (IDR), Franc (CHF), Hong Kong dollar (HKD), New Zealand dollar (NZD), Swedish krona (SEK), Norwegian krone (NOK), Mexican peso (MXN), Rand (ZAR), New Taiwan dollar (TWD), Danish krone (DKK), Złoty (PLN), Baht (THB), Forint (HUF), Koruna (CZK), Shekel (ILS), Chilean peso (CLP), Philippine peso (PHP), Dirham (AED), Colombian peso (COP), Riyal (SAR), Ringgit (MYR), Leu (RON), Argentine peso (ARS), Uruguayan peso (UYU), Peruvian sol (PEN), Vietnamese dong (VND), Pakistani rupee (PKR), Nigerian naira (NGN), **Bitcoin (BTC)**.
- **Ledger correction:** OU20's "41 measured" is wrong for this build. Notion lists 42 currencies including Bitcoin, which matches Blok's 42.

**Blok should:** on Enter, create-or-add, clear the input and stay open. Enter on an already-selected match does nothing. Keep the 42 currencies.

## 14. Favorite star on the row page (`80-…`–`85-…`)

Done on row Bravo of the scratch DB, in side peek (opened with the table's OPEN, tooltip "Open in side peek").

| State | Button | Icon | Tooltip |
|---|---|---|---|
| Not favorited | 28x28, `aria-label="Favorite"`, hover bg ≈ rgba(33, 27, 23, 0.051) | `star` outline, 20x20, fill rgb(56, 56, 54) | **"Add to your favorites"** |
| Favorited | `aria-label="Favorited"`, no `aria-pressed` | **`starFill`**, 20x20, fill **rgb(246, 192, 80)** (yellow) | **"Remove from your favorites"** |

- Clicking adds "Bravo" at the top of the sidebar's Favorites at once.
- Row right-click menu while favorited: first item **"Remove from Favorites"** (was "Add to Favorites"). The ⋮⋮ handle menu was not opened separately (research/21 says both menus match; not re-checked).
- The peek's ••• menu has no favorites item in either state.
- Clicking the star again: back to `star` / "Favorite", and Favorites shows only the user's original "New page" again.

**Blok should:** toggle a filled yellow rgb(246, 192, 80) star with tooltips "Add to your favorites" / "Remove from your favorites", and flip the row menu item to "Remove from Favorites".

## Teardown and side effects

- **Scratch page:** top-bar Actions (tooltip "Page settings & actions") › **Move to Trash**. Reloading its URL shows "Jack Uait moved this page to Trash just now. It will be permanently deleted in 30 days." (`103-trash-banner.png`). The sidebar no longer lists it. Trash not emptied; "Permanently delete" never clicked.
- After trashing, Notion opened the user's "Demo Page". Nothing was clicked there.
- **Theme:** "Use system setting" → Dark → back to **"Use system setting"**. Both rows (Theme, High contrast) read "Use system setting" afterwards; body bg rgb(255, 255, 255). High contrast never touched.
- **Favorites:** Bravo (scratch row) favorited, then un-favorited. Favorites shows only the user's own "New page", as before.
- **Side peek width** changed while measuring (564 / 1008 / 728) and set back to 756 by hand. Opening the details panel briefly collapsed the app's left sidebar; it came back when the panel closed, and was open at the end.
- **OS clipboard overwritten.** The hover "Copy to Clipboard" button on Mail/Tel was hit twice ("Copied property to clipboard" toast).
- **Del1 and Del2** were created and deleted from the gallery. They are separate Trash entries; restoring the page will not bring them back.
- **Three comments** posted (Delta ×2, Charlie ×1). Option colours changed (Idea → Default, Build → Brown, Ship → Red). Views changed: second Board grouped by Amount (Range), board calcs set, Timeline at Hours zoom, property visibility on Board/Gallery, a page layout with Amount in the panel ("Apply to all pages", this DB only). All inside the trashed page.
- **Cmd-click** on a calendar event: `tab-list` showed no new tab. A tab outside the relayed one is not ruled out (unverified).
- **No billing surface opened.** No Upgrade / Plus / Business item clicked. Settings was opened twice for the theme only. In the workspace menu, "Settings" (171,265) was clicked by coordinates after reading that "Upgrade" sat at (76,236).
- The auto-snapshot folder `.playwright-cli/` (held the workspace list and account email from the workspace menu) was deleted.
- Session `notion-measure12` was opened by this run (no session was open at start) and closed at the end.

## UNMEASURED (collected)

- Board "99+" display (only the toggle and its default were seen).
- Gallery Delete/Backspace with several cards selected.
- Calendar drag box started inside the grid (only from the page margin).
- "Don't remove" in the remove-sorting dialog.
- Timeline right-edge resize at Hours.
- Number Range boundaries (exactly 100, above 1000, negatives).
- Feed reaction pills from other users.
- Email / phone: Escape after editing an existing value.
- The ⋮⋮ handle menu text while favorited.
- Hide-empty-groups default before grouping by a number.
- A details-panel breakpoint where it stops sitting beside the content.
- Whether Cmd-click on a calendar event opened a tab outside the relayed one.
- Chart view (Free plan already used its one chart; not added).
