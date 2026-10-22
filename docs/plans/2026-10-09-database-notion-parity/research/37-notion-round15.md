# Research 37: round 15 measurements

Measured 2026-10-22 (local, from 16:01 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion37 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme: light unless a section says dark.
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure37/` (not in the repo). Helpers copied from `notion-measure36/` (research 36), session renamed. Raw output: `notion-measure37/raw/`.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Input: the 7 items of the round-15 brief.

Colour notation: Chrome reports some computed colours as `color(srgb r g b / a)` with 0-1 channels. They are given as read, with the 0-255 value after "≈".

## 0. Setup

- `playwright-cli list` at the start showed one open session, `spaceai`, a headless in-memory browser that cannot reach the signed-in Notion. So one new `--extension` session, `notion37`, was opened. `spaceai` was not touched.
- Stored theme at the start: `appearanceSettingStorageKey` = **"system"** (system light). Host time zone `Europe/Berlin`.
- Sidebar "New page" › "Page". Private scratch page **M37**.
- First body line: "/table view" › Enter → database **R15** (inline, no "New database" panel). Row **F1** (made at about 16:03). Property **Date** (Date) added from the header "Add property". View **Feed** from the tab bar "Add view".
- Second database on the same page, made later for §3: an empty line › "/table view" › Enter. This one **did** open the "New database" panel (with an AI prompt box focused; nothing was typed in it) › "New empty data source" → database **C15**, one data source, nothing imported.

## 1. The time zone list (item 1)

Path: R15 row F1 › Date cell › date picker › **Include time** on. A new row **"Timezone"** appears, value **"GMT+2"** (the picker row shows the short form). Clicking it opens the time zone menu: 342x595 at (1062, 110), bg white.

All 568 rows are in the DOM at once (no virtual list: `scrollHeight` 26202 in a 547 tall scroll box, 568 `role=option` nodes present without scrolling). They were read in DOM order in one pass. Raw: `raw/tz-list.json` (`{i, section, label, offset, selected, labelIsIanaId}` per row, captured 2026-10-22T14:0x Z).

**Offsets are as of 2026-10-22.** Europe is still on summer time that day, and the southern hemisphere is on its summer time (e.g. Sydney GMT+11:00, Santiago GMT-3:00, Lord Howe GMT+11:00).

### 1.1 Structure

| Part | Value |
|---|---|
| Search input | placeholder **"Search cities, timezones…"**, 14px / 20px / 400, rgb(44, 44, 43); focused on open |
| Section 1 | label **"Current timezone"** (12px / 14.4px / 500, rgb(125, 122, 117)), one row: **Berlin · GMT+2:00**, with a `checkmarkSmall` glyph (the only row with one) |
| Section 2 | label **"Select a timezone"**, 567 rows |
| Row | `role=option`, 334x45; two lines: label 14px / 16.8px / 400 rgb(44, 44, 43), offset 12px / 16.8px / 400 rgb(125, 122, 117). No `aria-selected` on any row. |

**Count: 568 rows** = 1 (Current timezone) + 567. Berlin appears only in section 1 (no duplicate "Berlin" in section 2).

### 1.2 Order and first / last rows

The order is the **IANA id sorted in ASCII order** (uppercase before lowercase): Africa/…, America/…, Antarctica/…, Arctic/…, Asia/…, Atlantic/…, Australia/…, Brazil/…, CET, Canada/…, Chile/…, Cuba, EET, EST, Egypt, Eire, Etc/…, Europe/…, GB, …, US/…, UTC, W-SU, WET. (The ids are not shown; the mapping is confirmed by the search, §1.4.)

First 10 (after Berlin): Abidjan GMT · Accra GMT · Addis Ababa GMT+3:00 · Algiers GMT+1:00 · Asmara GMT+3:00 · Asmera GMT+3:00 · Bamako GMT · Bangui GMT+1:00 · Banjul GMT · Bissau GMT.

Last 10: East-Indiana GMT-4:00 · Eastern (US) GMT-4:00 · Hawaii GMT-10:00 · Indiana-Starke GMT-5:00 · Michigan GMT-4:00 · Mountain (US) GMT-6:00 · Pacific (US) GMT-7:00 · UTC GMT · W-SU GMT+3:00 · WET GMT+1:00.

### 1.3 Label rules

- **The label is the last segment of the id**, with no area prefix: "Abidjan", not "Africa/Abidjan". Nested ids drop the middle too: America/Argentina/Buenos_Aires → "Buenos Aires", America/Indiana/Knox → "Knox", America/North_Dakota/Beulah → "Beulah".
- **Exception: America/Kentucky/…** keeps its middle segment: **"Kentucky/Louisville"**, **"Kentucky/Monticello"** (the only two labels with a "/"). America/Louisville is a separate row "Louisville".
- **Underscores become spaces in most rows** ("Addis Ababa", "Dar es Salaam", "Ho Chi Minh", "Port of Spain") **but not in four**: **"Buenos_Aires"** (America/Buenos_Aires, next to "Buenos Aires" for America/Argentina/Buenos_Aires), **"Tell_City"**, **"New_Salem"**, **"Santo_Domingo"**.
- Some names are rewritten, not just split: "Comod Rivadavia" (ComodRivadavia), "St. Johns" / "St. Barthelemy" / "St. Kitts" (St_Johns …), "Dumont d'Urville", "Mexico General" (Mexico/General), "Baja Norte" / "Baja Sur", "Easter Island" (Chile/EasterIsland). But **"DeNoronha"** (Brazil/DeNoronha) stays joined.
- **Legacy and alias ids are listed as their own rows**: Asmera, Calcutta, Katmandu, Rangoon, Saigon, Ulan Bator, Godthab, Faeroe ("Kiev" is absent, "Kyiv" is present); Etc/GMT±N, GMT, GMT+0, Greenwich, UCT, Universal, Zulu, CET, EET, EST, MET, MST, HST, WET, W-SU, GB, GB-Eire, NZ, NZ-CHAT, PRC, ROC, ROK, Cuba, Egypt, Eire, Iceland, Iran, Israel, Japan, Kwajalein, Libya, Navajo, Poland, Portugal, Turkey, Hongkong, Jamaica, Singapore.
- **Non-IANA labels**: 39 labels are themselves valid time zone ids (`new Intl.DateTimeFormat('en', {timeZone: label})` did not throw): Jamaica, Singapore, ACT, CET, Cuba, EET, EST, Egypt, Eire, GMT, GMT+0, Greenwich, UCT, Universal, Zulu, GB, GB-Eire, HST, Hongkong, Iceland, Iran, Israel, Japan, Kwajalein, Libya, MET, MST, NZ, NZ-CHAT, Navajo, PRC, Poland, Portugal, ROC, ROK, Turkey, UTC, W-SU, WET. The other 529 are display names, not ids.
- **Etc/GMT rows keep IANA's inverted sign**: label "GMT+1" shows offset **"GMT-1:00"**, "GMT-14" shows "GMT+14:00", and so on for all 25 (GMT+1 … GMT+12, GMT-1 … GMT-14).
- **A region in parentheses is added only where two areas would give the same label**:

| Area | Rows (label · offset on 2026-10-22) |
|---|---|
| **Canada/** | Atlantic GMT-3:00 · **Central (Canada)** GMT-5:00 · **Eastern (Canada)** GMT-4:00 · **Mountain (Canada)** GMT-6:00 · Newfoundland GMT-02:30 · **Pacific (Canada)** GMT-7:00 · Saskatchewan GMT-6:00 · Yukon GMT-7:00 |
| **US/** | Alaska GMT-8:00 · Aleutian GMT-9:00 · Arizona GMT-7:00 · **Central (US)** GMT-5:00 · East-Indiana GMT-4:00 · **Eastern (US)** GMT-4:00 · Hawaii GMT-10:00 · Indiana-Starke GMT-5:00 · Michigan GMT-4:00 · **Mountain (US)** GMT-6:00 · **Pacific (US)** GMT-7:00 (US/Samoa is not in the list) |
| **Brazil/** | Acre GMT-5:00 · DeNoronha GMT-2:00 · East GMT-3:00 · **West (Brazil)** GMT-4:00 |
| **Australia/** "West" | **West (Australia)** GMT+8:00 (the clash with Brazil/West). Australia/North and Australia/South stay "North", "South"; Brazil/East stays "East" (no clash). |
| **Mexico/** | **Baja Norte** GMT-7:00 · **Baja Sur** GMT-7:00 · **Mexico General** GMT-6:00 (the area name is kept in "Mexico General") |
| **Chile/** | **Continental** GMT-3:00 · **Easter Island** GMT-5:00 (Pacific/Easter is a separate row "Easter" GMT-5:00) |

So Canada and US get "(Canada)" / "(US)" on Central, Eastern, Mountain, Pacific only; Atlantic, Newfoundland, Saskatchewan, Yukon, Alaska, Hawaii … get none.

### 1.4 Search

The search matches the **IANA id**, loosely (fuzzy). Typed query → rows shown:
- "Canada" → the 8 Canada/ rows first, then loose matches (Grenada, Guadalcanal, Ensenada, …).
- "Brazil" → the 4 Brazil/ rows, then Brazzaville. "Mexico" → Baja Norte, Baja Sur, Mexico General, Mexico City. "Chile" → Continental, Easter Island, Hermosillo.
- "America/Kentucky" → Kentucky/Louisville, Kentucky/Monticello. "Australia/West" → West (Australia) only.
- "Etc/GMT+1" → the 10 Etc rows GMT+1, GMT+10, GMT+11, GMT+12, GMT-1, GMT-10 … GMT-14.
- "Buenos" → "Buenos Aires" and "Buenos_Aires".
No row was picked (the zone stayed Berlin).

### 1.5 Offset text

- Zero offset: **"GMT"** (no "+0:00"), 28 rows.
- Whole hours: **no zero padding**: "GMT+2:00", "GMT-9:00", "GMT+10:00" (two digits only when the hour has two).
- **Half and quarter hours: the hour is zero padded to two digits**: "GMT+05:30" (Kolkata, Calcutta, Colombo), "GMT+05:45" (Kathmandu, Katmandu), "GMT+04:30" (Kabul), "GMT+03:30" (Tehran, Iran), "GMT+06:30" (Yangon, Rangoon, Cocos), "GMT+08:45" (Eucla), "GMT+09:30" (Darwin, North), "GMT-02:30" (St. Johns, Newfoundland), "GMT-09:30" (Marquesas); two-digit hours as is: "GMT+10:30" (Adelaide, Broken Hill, South, Yancowinna), "GMT+13:45" (Chatham, NZ-CHAT).
- The "Current timezone" row uses the same rule ("GMT+2:00"); the picker's own Timezone row shows the short form **"GMT+2"**.

## 2. Property-level date settings (item 7)

R15 table header "Date" › menu (220 wide: Edit property · Property access · Change type · AI Autofill · Filter · Sort · Group · Calculate · Freeze · Hide · Unwrap content · Insert left · Insert right · Duplicate property · Delete property) › **Edit property** opens a submenu (300x94):

| Row | Value shown | Its menu (opened by a click on the row) |
|---|---|---|
| Date format | "Full date" | 250x181: Full date · Short date · Month/Day/Year · Day/Month/Year · Year/Month/Day · Relative |
| Time format | "12 hour" | 250x94: **Hidden** · 12 hour · 24 hour |
| Notifications | "None" | None · On day of event (9:00 AM) · 1 day before (9:00 AM) · 2 days before (9:00 AM) · 1 week before (9:00 AM) |

**There is no time zone control at the property level** and no row named "Date format & timezone". The time zone exists only per value, in the cell's date picker (§1), and only after "Include time" is on. Hovering these rows did not open their menus; a click did.

## 3. "Show large counts as 99+" in a fresh database (item 2)

C15 (§0): one data source, no import. Board view added from "Add view" › Board; it grouped by a **Status** property that the board created (groups Not started / In progress / Done). All rows in **Not started**. Each read: click the group's count › **Count** › the submenu (250x233: "Show large counts as 99+" / "This improves performance for large databases." / Count all ✓ / Count values / Count unique values / Count empty / Count not empty) › read the `INPUT[role=switch]`.

Rows were added with the column's "+ New page" (C1 … C10). For 99 and 100 the rows were **merged into the same data source**: C15 opened as a full page › top-right **Actions** › **"Merge with CSV"** (`arrowMergeUp`) › "Import CSV into Notion" dialog, Import Location **C15** › Choose file (fed by `hook.sh`) › Map CSV headers (Name → Name, Status → Status) › Import CSV › "Import complete". CSVs: 89 rows `M011`–`M099`, then 1 row `M100`, all Status "Not started". The board showed the new rows only after a page reload.

| Rows in the group (= in the database) | Count shown | `checked` | `disabled` | `aria-disabled` | ancestors with opacity < 1 / `pointer-events: none` |
|---|---|---|---|---|---|
| 1 | "1" | true | **false** | none | none (only the switch input itself, opacity 0 over its track) |
| 3 | "3" | true | **false** | none | none |
| 10 | "10" | true | **false** | none | none |
| 99 | "99" | true | **false** | none | none |
| 100 | **"99+"** | true | **false** | none | none |

- Track rgb(39, 131, 222), knob rgb(255, 255, 255), cursor pointer, no hover hint, in every case.
- At 1 row a click turned it off (`checked=false`, still enabled) and a second click on.
- At 100 rows, off → the count reads **"100"**; on → **"99+"**.

So in a standalone fresh database **the switch is enabled at every size tried, from 1 row**, and it is on by default. This agrees with research 36 §9. Research 30 B12 read the switch **off and disabled** in a different setup: a **duplicated view** ("By Status (1)") of the **Goals Tracker template** database; its "3 rows" cause was marked there as an inference. Row count is not the cause: a fresh 3-row database has it enabled. What does disable it (the template, the duplicated view, or something else) is **UNMEASURED**; a template database was not made this round.

## 4. Dark (item 3 and item 6)

Dark via **Cmd+Shift+L** (stored "dark", body bg rgb(25, 25, 25)). Afterwards Settings › Preferences › Theme › **"Use system setting"** (read back: stored `"system"`, body white; after a reload the `theme` cache key also read `{"mode":"light"}` as at the start).

### 4.1 "Reset to original page layout?" in dark

The brief points at research 36 §3 "light". The light Reset dialog is in research 36 **§8.2** (§3 is the template submenu), so §8.2's parts are read here. Path as there: R15 row F1 › side peek › "Customize layout" › builder › "More save options" › "Reset to original page layout" › dialog. Closed with Cancel, then the builder's own Cancel (nothing applied). Raw: `raw/reset-dark.json`.

| Part | Dark | Light (research 36 §8.2) |
|---|---|---|
| Box | **300x226 at (606, 246)**, bg **rgb(32, 32, 32)**, radius 12px, shadow **`rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.64) 0 24px 48px 0, rgba(25, 25, 25, 0.56) 0 4px 12px 0`** | white; `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px` |
| Backdrop | **rgba(15, 15, 15, 0.8)** | rgba(15, 15, 15, 0.6) |
| **×** `aria-label="Dismiss"` | 22x22 at (874, 256) (10px from top and right), radius 100%; **rest bg rgba(255, 255, 255, 0.055)**, **hover rgba(255, 255, 255, 0.03)** (hover is *fainter* than rest; read with the × focused and again after Tab moved focus away: same); `xMarkFill` 16px fill **rgb(173, 169, 163)**. Focused on open, no ring drawn. | rest rgba(55, 53, 47, 0.06), hover rgba(55, 53, 47, 0.16); fill rgb(142, 139, 134) |
| Icon | `arrowUTurnUpLeft` 32x32 at (740, 266), fill **rgb(173, 169, 163)** | same place, rgb(142, 139, 134) |
| Title | "Reset to original page layout?" 17px / 600, rgb(240, 239, 237), 234x22 at (639, 306) | 17px / 600 |
| Text | "No properties will be deleted." 14px / 400, **rgb(173, 169, 163)**, 260x20 at (626, 336) | rgb(125, 122, 117) |
| "Reset" | 260x32 at (626, 380), bg **rgb(229, 100, 88)**, ink rgb(255, 255, 255), 14px / 500, radius 6px; hover **`color(srgb 0.911511 0.472468 0.431627)` ≈ rgb(232, 120, 110)** (same values as light). Keyboard focus ring (after Tab): `rgb(25, 25, 25) 0 0 0 2px, rgb(35, 131, 226) 0 0 0 4px, rgb(25, 25, 25) 0 0 0 6px` | same fill and hover |
| "Cancel" | 260x32 at (626, 420), no border, ink **rgb(173, 169, 163)**, 14px / 500, radius 6px; hover **`color(srgb 1 1 1 / 0.054902)` ≈ rgba(255, 255, 255, 0.055)** | ink rgb(125, 122, 117), hover ≈ rgba(33, 27, 23, 0.051) |

### 4.2 Place editor "Open in Google Maps" in dark

R15 row F1, **Place** property, search "Paris" › "Paris, Ile-de-France, France" (picked in light, read after switching to dark with the editor still open). Opened from the **table cell** this time (not a peek), so the editor is **240 wide** at (1018, 340), 213 tall. Raw: `raw/place-dark.json`.

| Part | Dark |
|---|---|
| Popover | bg rgb(37, 37, 37), radius 6px, shadow `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.2) 0 14px 28px -6px, rgba(25, 25, 25, 0.118) 0 2px 4px -1px` |
| Name chip / × | "Edit place name" 191.7x20 radius 4px ink rgb(240, 239, 237); "Clear location field" 20x20 radius 4px, `xMarkFill` 14px fill rgb(173, 169, 163) |
| Map | `CANVAS[aria-label=Map]` **232x168** at (1022, 381) = editor width − 8 (4px inset), as research 36 §7 found in light |
| Pin | outline path fill **rgb(25, 25, 25)** (`var(--c-bacPri)`, the dark page bg), body rgb(35, 131, 226) (`#2383E2`) |
| **"Open in Google Maps"** | `A[role=link]` 24x24 at (1222, 515), radius 6px, **bg rgb(25, 25, 25)**, **shadow `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px`**; `maps` glyph 16x16 at (1226, 519), **fill rgb(173, 169, 163)**; ink rgb(240, 239, 237); cursor pointer; `target="_blank"`, href starts `https://www.google.com/maps/search/?api=`. **8px** from the map's right edge, **10px** from its bottom (same as light). |
| Its **hover** (1.5 s, pointer on it, no press) | bg → **`color(srgb 0.14902 0.14902 0.14902)` ≈ rgb(38, 38, 38)** (opaque); shadow, glyph and ink unchanged. No hint appeared within 1.5 s. Never clicked. |

So in dark the button is the page bg with the 1px rgb(56, 56, 54) ring + a soft drop, where light has white with a two-step shadow + rgba(42, 28, 0, 0.07) ring; hover lightens it by one step in both themes.

### 4.3 "Moved to Trash" toast in dark (item 6)

Trigger as research 36 §6: C15 table, row handle › Move to Trash (rows M091–M097). In-page logger (`tlog.js`): a 50 ms poller on the "Restore" leaf, plus capture-phase `pointerover` / `pointerout` listeners on the toast box, all stamped with `performance.now()` in the page (so the CLI's latency does not enter the numbers). Raw: `raw/toast-dark-run1..4.txt`.

**Look (dark).**

| Part | Dark | Light (research 36 §6) |
|---|---|---|
| Box | bg **rgb(44, 44, 43)**, ink rgb(240, 239, 237), radius **8px**, padding 11px 16px, 14px / 21px / 400, **shadow `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.2) 0 14px 28px -6px, rgba(25, 25, 25, 0.118) 0 2px 4px -1px`**, no border | same bg, ink, radius, padding, type; shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px` |
| Position at rest | **198x43 at (657, 646)** in a 1512x717 window: centred on x 756, bottom edge 28px above the window bottom | same |
| Content | "Moved to Trash" text, then "Restore" `role=button` 67x17 at (776, 659), transparent, 14px / 500, padding 0 8px, radius 6px; no svg, no × | same |
| "Restore" hover | **`color(srgb 1 1 1 / 0.054902)` ≈ rgba(255, 255, 255, 0.055)**, ink unchanged | ≈ rgba(33, 27, 23, 0.051) |

**Motion.** Slides up over about 250 ms (leaf y 702–708 → 659 in five 50 ms steps), the same as light. Exit: the leaf shrinks 67 → 64 px over about 250 ms, then the toast is gone.

**Timing.** Times in seconds from the toast's first frame ("appear"):

| Run | Pointer enters toast | Pointer leaves | Exit starts | **Leave → exit** | If the timer *resumed* (5.05 − time already shown) |
|---|---|---|---|---|---|
| 3 (no hover) | — | — | **5.05** | — | — |
| 1 | 4.14 | 8.26 | 13.30 | **5.05** | would be ≈ 0.9 |
| 2 | 2.81 | 6.91 | 12.00 | **5.08** | would be ≈ 2.2 |
| 4 | 2.83 | 4.96 | 10.00 | **5.04** | would be ≈ 2.2 |

- Untouched, the toast lives **5.05 s** from its first frame (exit animation then about 0.25 s more).
- **Hover holds it open.** Run 1 was still fully shown at 8.26 s.
- **Leaving starts a fresh timer of the full length (≈ 5.05 s)**, the same in every run, whether the hover began at 2.8 s or at 4.1 s. A resumed timer would have given 0.9 s and 2.2 s. So the "resume" hypothesis of research 36 is ruled out (in dark; the light number there, 4.0 s, was one sample read with a CLI-side clock).
- The CLI could not start a hover earlier than about 2.8 s after the toast appeared, so a hover in the first second was not tried.
