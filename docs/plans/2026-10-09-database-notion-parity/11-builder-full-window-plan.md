# 11: Full-window "Customize page layout" builder — Notion parity plan

Written 2026-10-13. Inputs: research/09 (round 1), research/10 (round 2), 10-backlog.md (P6 block), current code at `8190cf13` plus whatever is in the working tree.

Already shipped in `8190cf13`, so not re-planned here:
- the Cancel discard question;
- Escape never leaving the builder;
- pin arrows;
- the More settings row;
- the details panel geometry.

They appear in the gap table as DONE.

Citations:
- `09 §n Lnn` / `10 §n Lnn` are research file sections and line numbers.
- Code citations are `file:line` at the time of writing. `drawer` = `src/tools/database/database-card-drawer.ts`, `layout` = `src/tools/database/page-layout.ts`.

---

## 1. Gap table

Statuses:
- **DONE**: Blok matches the measured behaviour.
- **PARTIAL**: some of it exists.
- **MISSING**: not built.
- **UNMEASURED**: Notion's behaviour was not measured, or comes from a single sample that cannot be made a rule.

BLOCKED items and divergences that a Blok law forces are noted in the Notes column. They keep their own status.

### 1a. Entry and framing

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 1 | Entry: View settings > More settings > **Customize page layout**, 4th and last (09 §1 L13-16) | DONE | `database-view-settings-panel.ts:289` (`database-settings-more`), `index.ts:2615-2630`. Test: database-view-settings-panel.test.ts "puts Sub-items, Dependencies and Customize page layout in More settings, after Automations". Notion's Connections row has no Blok counterpart |
| 2 | Item icon is the `layout` glyph (tall rect + 2 squares). Every More settings item has a trailing chevron (09 §1 L19-20) | PARTIAL | `index.ts:2621` uses `IconSplitView`. The trailing chevron on a non-submenu row was not checked in the panel code |
| 3 | The builder is a **full-window takeover**: the database is replaced, the sidebar is gone, the URL is unchanged (09 §1 L22, framing L8-9) | MISSING | The builder is a bar inside the drawer. `drawer:1727-1766` (`renderLayoutBar` prepends into `[data-blok-database-drawer-content]`) |
| 4 | Zero rows: the builder still opens on a placeholder "New page" ("No backlinks", group "Empty", Content "Empty"). The preview popover reads "No results." (09 §1 L23) | MISSING | Blok disables the entry: `index.ts:2622`. Test: row-page-layout.integration.test.ts "disables Customize page layout with no rows" |
| 5 | First-ever open shows an onboarding card on "+": "Start creating your layout" / "Click the (+) icon to add to the page" (09 §1 L24; not shown again, 10 §8 L42) | MISSING | No code found (`grep -rn "Start creating" src/` → none). **Law conflict**: it shows without hover (hints law). See Q5 |
| 6 | Launched from a row page, the builder previews **that** page. From the database menu, it opens on the first row in view order, which is also the oldest (09 §1b L100) | DONE | Row page head button `drawer:805-806` → `startCustomizing()` on the current row. Menu → `index.ts:2624` `viewRowOrder()[0]`. Tests: database-card-drawer-layout.test.ts "offers Customize layout, which bears the layout lists and shows the builder bar"; row-page-layout.integration.test.ts "opens the first row page in Customize from More settings > Customize page layout". The sample cannot tell view order from oldest. Blok uses view order |
| 7 | Row page "•••" (Actions) menu holds **Customize layout** (09 §1b L98) | MISSING | The drawer has no row actions menu. `grep -n "IconDotsHorizontal" drawer` → only the builder item menu, `drawer:2098` |
| 8 | A property's menu on the row page ends with **Customize layout** (09 §1b L99) | MISSING | `grep -n "customiz\|layoutCustomize" database-property-menu.ts` → none |
| 9 | The title-hover row holds "↙ backlinks · Add icon · Add cover · Customize layout" (09 §6 L121) | PARTIAL | Add icon, Add cover and Customize layout are in the head (`drawer:754-806`). The CSS test "shows Customize layout on page hover, like Add icon" pins the hover. There are no backlinks (row 61) |

### 1b. Top bar

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 10 | Bar 60.4px tall, 16px side padding, no fill. Centered database glyph + title (16px/500), and below it "Preview: <page>" (09 §10 L159-160, §2 L28) | PARTIAL | `drawer:1739-1765`: a "Customizing page layout" title span, a search field, Page settings, Cancel and Apply in one bordered sticky row (`database.css:2028-2048`). No database title, no preview switch |
| 11 | **Cancel** = x icon + "Cancel", 86x32, no fill (09 §10 L161) | PARTIAL | `drawer:1763` is a text-only button |
| 12 | **Apply** split button: "✓ Apply to all pages" (fill rgb(39,131,222)) + a chevron half "More save options" (09 §10 L161) | PARTIAL | `drawer:1764` is a text-only Apply. There is no split and no chevron. A primary action is not a selected state, so blue is allowed |
| 13 | "More save options" holds one item, "Reset to original page layout" / "No properties will be deleted" with `arrowUTurnUpLeft` (09 §3b L64; 10 §5 L151) | MISSING | Reset sits in the Page settings popover (`drawer:1806-1813`) |
| 14 | Tab order: Preview → Cancel → Apply → More save options → module •••s → "+" → side panel → Page settings (10 §9 L56-71) | MISSING | DOM order `drawer:1760-1765`: search, Page settings, Cancel, Apply |
| 15 | Escape never closes the builder. With a menu open, the first Escape closes the menu only (10 §9 L51-55) | DONE | `drawer:535`. Tests: database-card-drawer-layout.test.ts "keeps the page and the draft open on Escape while customizing", "keeps the drawer and the draft when Escape closes the discard question"; e2e "keeps Customize layout and its draft open on Escape" |
| 16 | Focus ring: 2px light + 4px blue box-shadow on every builder control (10 §9 L72) | PARTIAL | No builder-specific focus rule in `database.css:2028-2060`. Blok's own ring law (keyboard modality only, `--blok-focus-ring`) governs, so this is a law-driven divergence on the values. Whether builder buttons get the global ring today was **not checked** |
| 17 | Narrow windows: at 756px nothing wraps and the side panel collapses to "«". At 600px the title overlaps Cancel (09 §10 L163-165) | MISSING | The drawer bar wraps (`database.css:2033` `flex-wrap: wrap`). There is no side panel column. The 600px overlap is a Notion defect and is not copied |

### 1c. Preview switch

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 18 | "Preview: <page>" text button (12px/500 grey, chevron). It opens a 300px popover with a focused "Search pages…" field and every row; the current row has a trailing ✓ with no fill (09 §2 L28-30) | MISSING | `grep -rn "Preview:\|layoutPreview" src/` → none. Blok steps rows with the peek's prev/next (`adjacentRow`) |
| 19 | Popover order: newest-created first (09 §2 L31) | UNMEASURED | One sample (3 rows). Not a rule. Plan uses view order (Q4) |
| 20 | Switching swaps the canvas. **Unapplied edits survive** (09 §2 L33-34) | DONE | Via row stepping. Test: database-card-drawer-layout.test.ts "keeps the unapplied draft when stepping to the next page" |

### 1d. Canvas, modules, side panel

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 21 | Backdrop `rgb(249,248,247)` on the full-window wrapper (10 §8 L43) | MISSING | `grep -n "249, 248, 247" database.css` → only `--blok-database-calendar-weekend-bg` (`:89`) |
| 22 | Canvas card: white, radius 12 12 0 0, outline as box-shadow `rgb(206,227,247) 0 0 0 3px, rgba(15,15,15,.1) 0 9px 12px` (10 §8 L44) | MISSING | `grep -n "206, 227" database.css` → none. The blue outline is decoration, neither a selected state nor a link/focus ring (Q6) |
| 23 | Modules stacked: **Heading** (no handle) · **Property group** (⠿) · "+" Add page module · **Page discussions** (⠿) · **Content** (⠿). Each has a header strip (name in blue) and a "•••" "Action menu for module" (09 anatomy L39; 10 §8 L45-46) | MISSING | No module concept. The drawer draws the row page regions straight (`drawer:1395-1458`) |
| 24 | Module card ring: hairline `rgb(182,212,243)` 0.5px inset at rest, 1.25px on hover. Selected ring value UNMEASURED (10 §8 L45) | MISSING | No code. A selected module is a selected state: neutral under the blue law (Q6) |
| 25 | A click anywhere in a module selects it and opens its ••• menu (10 §8 L47) | MISSING | No code |
| 26 | Modules drag (⠿) (09 anatomy L39) | MISSING | Blok moves with "Move up / Move down" (`layout:123-139`, `drawer:1844`) |
| 27 | Side panel column: "»" "Hide sidebar" + "+ Add to panel", which opens the "Add to panel" list (09 anatomy L40, §3b L65) | MISSING | The details panel exists on the row page only (`drawer:1631-1661`). There is no builder column |
| 28 | "+" Add page module → "Add to page": "Use an existing property" / "Create new property" (09 §3b L65) | PARTIAL | Per-property "Add to page" / "Add to panel" items (`drawer:1855-1856`). No "+" and no create-new path |
| 29 | Content module reads "Empty" with zero rows (09 §1 L23). What it shows for a row with a body: UNMEASURED | MISSING | — |
| 30 | Property group order alphabetical (09 anatomy L44) | UNMEASURED | Contradicted by 10 §2 L91 (order changed after a Simple/Tabbed round-trip). Blok keeps schema order (`layout:90`) |
| 31 | Turning Full width on does not change the builder canvas (09 §9 L139). Toggling templates does not either (10 §6 L138) | MISSING | No such switches (rows 37, 38) |

### 1e. Page settings column

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 32 | A "Page settings" column (290 wide, title 16px/500), always visible (09 §10 L162, anatomy L41) | PARTIAL | A "Page settings" button opens a popover menu (`drawer:1761`, `1792-1815`) |
| 33 | **Structure**: two 117x80 cards, Simple (default) / Tabbed. Selected = 0.75px blue ring + 600 label (10 §2 L76) | PARTIAL | Check items `structure-simple` / `structure-tabbed` (`drawer:1797-1798`). **Blue law**: the selected card must be neutral |
| 34 | Options: **Inline comments** (Default ✓ / Minimal) (09 §7 L130) | MISSING | Skipped: Blok has no inline comments (§2.4) |
| 35 | Options: **Page discussions** switch, ON (09 §7 L129) | MISSING | Skipped: no discussions (§2.4) |
| 36 | Options: **Property icons** switch, ON. OFF removes icons from group rows and pins; menus keep their glyphs (09 §8 L80-81) | PARTIAL | Behaviour DONE: `layout:35,44,164`, `drawer:2042`. Tests: database-card-drawer-layout.test.ts "turns property icons off from Page settings as a draft edit", "draws no property icons when the layout turns them off"; page-layout.test.ts "turns property icons off as false…". The control is a check item, not a switch (`drawer:1804`) |
| 37 | Options: **Full width** switch, OFF, (i) "Page width can be overwritten on individual pages." (09 anatomy L42, §9) | MISSING | `grep -rln "fullWidth" src/tools/database src/tools/database-row` → none |
| 38 | Options: **Database templates** switch, ON, (i) "If enabled, empty pages will show the template picker." (09 anatomy L42) | MISSING | No toggle. Templates themselves exist (§2.3) |
| 39 | Switches: 30x18, role=switch, ON = blue (09 anatomy L43) | MISSING | The builder uses check items. `panelSwitch` exists in `database-panel.ts:229`. A blue ON switch is allowed (memory: switch-on-stays-blue) |
| 40 | (i) hints on hover (09 anatomy L42) | MISSING | Must use `onHover` (`src/components/utils/tooltip.ts:977`). Hints law |
| 41 | "Properties in the page / details panel" is not in Page settings. It is "Move to panel" in the Property group ••• (09 §3 L56) | PARTIAL | Blok has the two check items in Page settings (`drawer:1800-1801`) |

### 1f. Heading module menu, pins

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 42 | Heading ••• menu: header "Heading", focused "Search properties…", "Pinned properties" / "Unpinned properties" lists, 28px rows (09 §3 L49-51) | MISSING | Blok has one search field in the bar (`drawer:1747-1759`) and a ⋯ menu per property (`drawer:1824-1870`) |
| 43 | 📌 button per row, always visible. aria "Show <Name> as pinned" / "Do not show <Name> as pinned". `pin` outline vs `pinFill` (09 §3 L52) | MISSING | Pin / Unpin are items in the per-property ⋯ menu (`drawer:1842,1852`) |
| 44 | A pin moves the row between lists at once. The canvas shows it under the title and drops it from the group (09 §3 L53) | DONE | `layout:111-115`, `resolvePageLayout`. Tests: database-card-drawer-layout.test.ts "shows pinned properties in the heading and not again in the group", "previews a pin and writes nothing until Apply to all pages" |
| 45 | Pin limit | DONE | `PAGE_LAYOUT_PIN_LIMIT = 15` (`layout:4`). Tests "disables Pin to heading at the pin limit", "keeps Pin to heading disabled when search hides all 15 existing pins". Notion's limit is not measured in 09/10 (backlog: help page 15, guide 4) |
| 46 | Pinned list's "+ Add a property" lands **pinned only**, first in the Pinned list, not in the group (10 §7 L107-108) | DONE | `drawer:1572-1577`, `1313-1316`. Tests: "adds a property from the pins row as a draft pin, even with no pins yet", "pins a property made with the built-in type menu from the pins row only"; integration "adds a pinned property from the pins row…". **The backlog line calling this unmeasured is stale.** Notion puts it *first* in the Pinned list. Blok appends (`withPlacement`, `layout:106-109`): that order is PARTIAL, fixed in Phase 5 |
| 47 | After the type pick: a compact edit card (name, Type, Property access). Escape turns it into a context menu (Rename · Edit property · Add to layout · Duplicate · Delete) (10 §7 L109-110) | MISSING | The type popover closes on select (`drawer:1293-1302`). "Add to layout" was never clicked: its effect is UNMEASURED |
| 48 | "Options > Property labels" switch, ON, present even with zero pins (10 §7 L106, correcting 09 §3 L54) | MISSING | `grep -rn "propertyLabels\|PropertyLabels" src/ types/` → none |

### 1g. Property group module menu, visibility

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 49 | Property group ••• menu: header + "+ Add section", "Search properties…", one row per property with a 👁️ button, "+ Add a property", divider, "→ Move to panel" (09 §3 L56) | MISSING | The pieces are scattered: Add section button `drawer:1266-1269`; group-in-panel check `drawer:1801`; add property `drawer:1272-1279` |
| 50 | Add a property from the group: name field + type list. The new property lands **at the top** of the group (09 §3 L57) | PARTIAL | `DatabasePropertyTypePopover` with `withNameField` (`drawer:1290-1308`). Placement is schema order (`layout:90`), so it lands where the schema puts it, not first. There is no AI Autofill section |
| 51 | 👁️ menu: Always show (`eyeFill`) / Hide when empty (`eyeSlash`) / Always hide (`eyeClosed`). No checkmark; the row glyph shows the state (09 §5 L70-74) | PARTIAL | The setting exists as `pageVisibility` (`types/tools/database.d.ts:151`) in the property menu (`database-property-menu.ts:363-375`), and it is written at once. There is no 👁️ in the builder |
| 52 | The canvas updates at once: hidden properties leave the group and "N more properties" appears. It does **not** expand in the builder (09 §5 L75) | MISSING | In the builder every property is shown (`drawer:1240` `shown()` is true while drafting), but the reveal button still renders (`drawer:1251`) |
| 53 | Visibility is a draft: Discard throws it away (09 §5 L76) | MISSING | `pageVisibility` writes at once. `PageLayoutOp` only rewrites title-property layout data (`layout:15`) |
| 54 | After Apply the row page per-property visibility menu shows the same value (one value, two surfaces) (09 §5b L93) | DONE | One field, `pageVisibility`, read by `isShownOnPage` (`drawer:191-195`) and the property menu |
| 55 | Layout visibility never touches the view's column visibility (09 §5b L94) | DONE | Separate fields: view `visibleProperties` vs property `pageVisibility` |
| 56 | Row page: "N more properties" disclosure (chevron + grey). It expands in place: hidden rows merge in order, then "+ Add a property", then "^ Hide N properties" (09 §5b L91-92) | PARTIAL | Expands in place: `drawer:1251-1263`. Wording is "{count} hidden properties" (`en.json:719`). Order is reveal button → Add section → Add a property (`drawer:1251-1279`), not rows → Add a property → Hide. There is no singular form |
| 57 | The expanded state carries across rows in a session and resets on reload (09 Other L173) | PARTIAL | Blok resets it per opened row: `drawer:486`, `drawer:620` (`showHiddenProps = false`) |

### 1h. Sections

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 58 | "+ Add section" adds "New section" **at the top**. The **first** one takes every existing property. A rename popover opens with the name pre-selected + "Done" (blue) (10 §3 L97) | PARTIAL | `addSection` appends an empty section (`layout:141-144`). The name is an inline input in the canvas (`drawer:1331-1338`) |
| 59 | A later "Add section" also lands at the top, empty. An empty section shows a grey "Empty" line. In the menu each section has its own "+ Add a property" (10 §3 L98) | PARTIAL | Lands last. An empty section draws nothing in its body (`drawer:1365-1367`). No per-section add |
| 60 | Properties move between sections by dragging in the menu (10 §3 L99) | PARTIAL | "Move to {name}" / "Remove from section" items (`drawer:1857-1869`) |
| 61 | Section menu: Rename · Move down (only valid directions) · Delete with sub-line "No properties will be deleted" (10 §3 L101) | PARTIAL | Rename input + trash button (`drawer:1331-1343`). No move. No sub-line |
| 62 | Section header on the canvas: 664x34 button, name 13px/500 grey + filled chevron (10 §3 L100). Menu header: ⠿ + name 14px/500 (L101) | PARTIAL | `database.css:2284-2304`. Values not compared with Notion |
| 63 | No folding inside the builder (10 §3 L102) | DONE | `drawer:1323` (never collapsed while drafting); the header is the name input |
| 64 | Row page: a header click folds; the chevron turns −90°; no count. Notion sets no `aria-expanded` (10 §2b L132) | DONE | `drawer:1345-1362`, `database.css:2300-2304`. Test "draws named sections that fold away"; e2e "folds a named section and opens and closes the details panel". Blok also sets `aria-expanded`, an a11y improvement, kept |
| 65 | Row page: each section ends with its own "+ Add a property" (10 §2b L131) | MISSING | One add button at the end (`drawer:1272-1279`) |
| 66 | Fold state **carries to other rows and survives a reload**. Storage (per user / per layout) not determined (10 §2b L133) | PARTIAL | Carries across rows: `collapsedSections` is one Set per drawer (`drawer:286`). Lost on reload. Storage choice: Q3 |

### 1i. Property labels

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 67 | Labels ON strip: a flex row with 8px gap. Each item is a label row (16.8px icon + 13px/500 name) over a 30px value box. Empty reads "Empty" (10 §4 L116) | PARTIAL | Pins are `createPropertyRow` label+value rows (`drawer:1603-1615`, `2029-2104`). Look not compared |
| 68 | Labels OFF: no label row. An **empty** value shows type icon + name as a grey placeholder. An empty checkbox shows only its box. A filled value shows only the value. No tooltip. Same on the row page (10 §4 L117-122) | MISSING | No setting (row 48) |

### 1j. Reset

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 69 | Confirm modal 300x226: glyph, "Reset to original page layout?", "No properties will be deleted.", **Reset** (red) / Cancel, close x (10 §5 L152-156) | MISSING | `drawer:1818-1822` writes at once. Test "sets the structure from Page settings and resets to the original layout at once" pins the no-confirm behaviour |
| 70 | Reset applies at once (no Apply step) and closes the builder (10 §5 L157) | DONE | `drawer:1819` (`layoutDraft = null`), `1820` writes |
| 71 | Reset: Simple, no pins, no sections, labels gone, Database templates back ON (10 §5 L158-163) | PARTIAL | `resetPageLayout` → `pageLayoutOf(undefined)` (`layout:167`) clears everything that exists today. Labels/templates do not exist yet |
| 72 | Reset keeps properties made in the builder (10 §5 L165) | DONE | `resetLayout` never calls `onDeleteProperty` (`drawer:1818-1822`). No test pins it; Phase 8 adds one |
| 73 | After Reset the group order is old pins, then old sections (10 §5 L166) | MISSING | No position write on reset |
| 74 | Reset's effect on 👁️ states, Property icons, Page discussions, Full width | UNMEASURED | 10 §5 L163 (they were default before Reset) |

### 1k. Tabbed structure

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 75 | Tabbed puts a tab bar under the Heading, outside any module. Everything else sits in the first tab, "Content" (10 §2 L77-78) | PARTIAL | Tab bar after pins (`drawer:1424-1426`) with a Content tab (`drawer:1534`) |
| 76 | Builder tab pills: 32px, radius 20, selected ring blue (10 §2 L78-80) | MISSING | No builder tab look. **Blue law**: the selected tab is neutral |
| 77 | Hover-only "Add tab" (28px circle) → "Link existing data source" → database picker → "View name" / "View of" / "Add new relation" (OFF) / "Add view" (10 §2 L81-83) | MISSING | Tabs are derived from relation properties (`drawer:1494-1498`), a Blok invention (backlog L101) |
| 78 | "Add view" adds a tab named after the view, selects it and opens its View settings (10 §2 L84) | MISSING | — |
| 79 | A view tab holds a **whole linked database** (not filtered to the row), with Filter / Sort / Search / New (10 §2 L85, §2b L130) | MISSING | The relation tab shows the relation cell (`drawer:1538-1548`) |
| 80 | Clicking the selected tab: a view tab gets full View settings + Duplicate view + Delete view. Content gets rename only, no delete (10 §2 L86-88) | MISSING | — |
| 81 | Delete view → "Delete this view?" (Delete view / Cancel) → tab gone, Content selected, toast "Deleted <name> view" (10 §2 L89) | MISSING | — |
| 82 | Simple ↔ Tabbed in the draft keeps the view tabs (10 §2 L90) | PARTIAL | `setStructure` is a draft op (`layout:160`). Tabs are derived, so trivially kept |
| 83 | Row page tabs: no ring; selected = fill `rgba(33,27,23,.05)` + primary text (10 §2b L129) | PARTIAL | Blok: primary ink + underline. CSS test "marks the open tab with primary ink and an underline, never blue". A neutral fill also passes the blue law |
| 84 | Cancel / Discard after Tabbed changes | UNMEASURED | 10 §2 L92 |
| 85 | Whether adding/removing a view tab writes at once (hypothesis from the real confirm + toast) | UNMEASURED | 10 §2 L93 |
| 86 | Whether Reset deletes the linked view behind a tab | UNMEASURED | 10 §5 L167 |

### 1l. Database templates on the row page

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 87 | ON, no templates: "Press ‘enter’ to continue with an empty page, or create a template". "create a template" is an underlined role=button that opens a new template (10 §6 L139-140) | PARTIAL | "Press Enter to continue with an empty page" (`en.json:672`, `src/tools/database-row/index.ts:103`). No "create a template" |
| 88 | ON, ≥1 template: "…or pick a template (use ‘↑’ and ‘↓’ to select)" + list: each template, "Empty", "+ New template". Rows 32px, grey 16px (10 §6 L141-145) | MISSING | Templates exist (`templates.ts:4` `isTemplateData`, `database-template-menu.ts`), but only in the "New" dropdown |
| 89 | OFF: no prompt and no picker (10 §6 L146) | MISSING | No toggle |
| 90 | Picker keyboard (Enter / ↑ / ↓) | UNMEASURED | 10 §6 L147 |

### 1m. Full width, details panel, other

| # | Notion behaviour | Blok | Evidence / notes |
|---|---|---|---|
| 91 | Full width ON widens only the full page (h1 720 → 1050 at 1512px). Peeks do not change (09 §9 L143-149) | MISSING | No setting |
| 92 | A page's own Full width overrides the layout (09 §9 L150) | MISSING | No row-level width and no row actions menu (row 7) |
| 93 | Details panel 385px full page / 280px center peek, starts closed, not remembered (09 §9 L151-154; 10 §10 L177-182) | DONE | Shipped. Tests: database-card-drawer-layout.test.ts "starts the details panel closed on every open and on the next row"; database-page-layout-css.test.ts "docks the details panel to the window edge on a full page", "docks the details panel inside the center peek modal"; e2e "docks the details panel…" |
| 94 | Toggle text flips "View details" ↔ "Hide details" (09 §9 L151; 10 §10 L174) | PARTIAL | The label is always "View details" (`drawer:1639`). Only `aria-expanded` flips (`drawer:1655`) |
| 95 | Panel holds a "Properties" header (13px/500) and a round "Close panel" button (`arrowChevronDoubleForward`) (10 §10 L176-177) | MISSING | `drawer:1641-1651` has neither. Listed missing in backlog L104 |
| 96 | Top-bar "Page info" icon button (`sidebarRight`), only when the group is in the panel. It toggles the panel and gets a fill when open (10 §10 L175) | MISSING | No code |
| 97 | Pin arrows outside the builder, none inside (09 §4) | DONE | Shipped. Tests "pin scroll arrows" (unit), e2e "scrolls overflowing pins 400px per arrow click", "shows no pin arrows in Customize layout" |
| 98 | Cancel: no edits → close; edits → "Discard all layout changes?". Discard deletes builder-made properties (09 §3b L61-63) | DONE | Shipped. Tests "closes at once on Cancel with no edits…", "asks before dropping edits on Cancel…", "drops the draft and every property made while customizing on Discard"; e2e "asks before discarding layout edits on Cancel" |
| 99 | "{#} backlinks" line above the title (09 §6) | MISSING | Skipped: Blok has no backlinks (§2.4) |
| 100 | Property access: two entries, one 600x520 dialog. Fully disabled on Free (10 §1) | MISSING | **BLOCKED** (§2.2). `grep -rn "propertyAccess" src/` → none |
| 101 | Property icon sizes: pinned 14px box at scale 1.2. Group rows 16px at scale 1.2. Per-type mask glyphs (09 §8 L82-85) | PARTIAL | A 16px icon from `propertyTypeMeta` (`drawer:2042-2050`). Test "puts a 16px property icon beside each label, outside the label text". Sizes and glyph mapping not compared. Formula/Text/Relation/Rollup/… glyph names UNMEASURED |
| 102 | Builder-made property (from the group) survives Apply. Table column after Apply: not checked (10 §7 L111) | DONE | Properties are written at once (`drawer:1284-1311`). Test "adds a pinned property from the pins row: the property saves at once, the pin on Apply" |

### 1n. Counts

| Status | Count |
|---|---|
| DONE | 17 |
| PARTIAL | 29 |
| MISSING | 49 |
| UNMEASURED | 7 |
| **Total** | **102** |

Build scope: the 49 MISSING less 4 rows decided not to build (34, 35, 99 skipped; 100 BLOCKED) = **45**.

BLOCKED: row 100 (Property access).
Skipped by decision (no Blok counterpart): rows 34, 35, 99, plus the "Page discussions" module in row 23.

### 1o. Row → phase map

Every row that is not DONE has a home here.

| Phase | Rows |
|---|---|
| 1 Layout data | data for 46 (order), 48, 50, 53, 58, 59, 61, 73 |
| 2 Shell + top bar | 3, 10, 11, 12, 13, 14, 17 (bar), 21, 22 |
| 3 Preview, zero rows, entries | 2, 4, 8, 18, 29 (zero-row placeholder) |
| 4 Page settings column | 31, 32, 33, 36 (switch), 37 (data), 38 (data), 39, 40 |
| 5a Heading menu + modules | 23, 24, 25, 42, 43, 46 (order), 48 (switch) |
| 5b Group menu + 👁️ | 41, 49, 50, 51, 52, 53, 56 |
| 5c "+", module drag, side panel | 17 (side panel), 26, 27, 28 |
| 6 Sections | 58, 59, 60, 61, 62, 65, 66 |
| 7 Property labels | 67, 68, 101 (sizes) |
| 8 Reset | 69, 71, 73 |
| 9 Templates on the row page | 87, 88, 89 |
| 10 Full width | 91 |
| 11 Details polish | 57, 94, 95, 96 |
| 12 Tabbed as blocks | 75, 76, 77, 78, 79, 80, 81, 82, 83 |

Not planned, with the reason:
- 5: the onboarding card shows without hover, against the hints law (Q5).
- 7, 92: they need a row "•••" actions menu Blok does not have (Q10).
- 9: only its backlinks part is missing, and backlinks are skipped (§2.4).
- 16: Blok's focus-ring law decides ring values.
- 19, 30: single samples (§2.5).
- 34, 35, 99: skipped (§2.4).
- 47: the compact edit card's main field is Property access (BLOCKED). Its "Add to layout" item was never clicked (UNMEASURED).
- 100: BLOCKED (§2.2).
- 74, 84, 85, 86, 90: UNMEASURED. 84-86 are decided by Q2, 90 by Q8.

---

## 2. Decisions

### 2.1 Tabbed structure: tabs and linked views are blocks

Notion's tab "+" links an existing data source and makes a view tab (10 §2 L81-85). Under the Everything Is a Block law, a tab and the database it shows are content. They must be blocks, not a list inside `pageLayout*` data.

**Today's relation-derived tabs go away.** They are a Blok invention (backlog L101, `drawer:1494-1548`). `pageLayoutStructure: 'tabbed'` was added after v1.16.1 (verified below), so removing those tabs is not BREAKING.

**Proposed shape** (needs the user's OK, Q1):

```
database (block)
├── database-row … (rows, templates; unchanged)
└── tabs   ← one shared "layout tabs" block, id saved as `pageLayoutTabsId` on the title property
    ├── tab {title: "Content"}          ← first tab = the page modules; never has children
    └── tab {title: "<view name>", icon?}
        └── database {source: {databaseId}}   ← linked view, existing lever (`index.ts:486-511`, types `DatabaseSourceRef`)
```

- **One shared block, not one per row.** The layout is shared by every row (types `PageLayoutFields` doc: "shared by every row"). A per-row copy would need N inserts per tab and would drift.
- **Existing levers:**
  - `tabs` declares `ownsChildren`, `deletesChildren` and `childTools.allow: ['tab']` (`src/tools/tabs/index.ts:424-440`).
  - `tab` declares `isLayout` and `deletesChildren` (`src/tools/tab/index.ts:198-209`).
  - Deleting the tabs block cascades. A stray cannot be adopted.
- **Rendering:**
  - The row page draws its own tab strip from the `tab` children. It does not run the core tabs UI.
  - The drawer then attaches the active tab's linked `database` holder into the tab panel, the way it attaches the row body (`attachedBodyRowId`).
  - Child-holder decoration law: no wrapper around a child holder. Attributes only on the holder.
- **The "Content" tab:**
  - It is a `tab` so it can be renamed as a block edit (10 §2 L88: rename only, no delete).
  - Delete is refused for the first tab in the builder UI.
- **Risks found while checking, to be pinned by tests before building:**
  1. **Export.** `src/view/emitters.ts:789` emits every non-row child of a database after the rows. The layout tabs block would leak into HTML, and through `src/view` into the C# server's render (memory: tabs server integration). The emitter must skip the block named by `pageLayoutTabsId`. Plain-text export (`src/view/blocks-to-plain-text.ts`) needs the same check.
  2. **Mounting.** Core mounts a database child into the first `nestedBlocks` slot, the hidden `rowPool` (`index.ts:697-705`). The tabs holder then sits hidden. Hidden ancestry makes find-in-page skip it (memory: hidden ancestry), and Notion's search behaviour inside a view tab is unmeasured.
  3. **Database walkers.** Most filter `name === 'database-row'` (`index.ts:1075, 1289, 6619`). The ones that `.find` by id (`index.ts:1600, 1703, 1814, 6588`) are safe. `6588` writes `updateProperties` to children it selects by id, so it is safe too. Re-grep `getChildren(this.dataId)` at build time.
  4. **Self-link recursion.** A view tab that links its own parent database (Notion allowed "View of: This database", 10 §2 L83). The linked view reads the source's rows (`dataId`). Whether it also walks the source's non-row children (the tabs block holding itself) is **unverified**. Write a test first.
  5. **Undo.** row-page-layout.integration.test.ts "adds no undo step for opening Customize layout, and one for Apply" must still hold. Tab blocks created mid-draft are recorded like `draftProperties` and must fold into the Apply step (`api.blocks.transact`).
- **UNMEASURED, so the plan follows the Blok draft model and asks the user (Q2):**
  - what Cancel/Discard does to tab blocks made in the session (10 §2 L92);
  - whether add/remove writes at once (L93);
  - whether Reset deletes them (10 §5 L167).

  The Blok default proposed:
  - tab blocks made in the draft are deleted on Discard, like builder-made properties (`drawer:1716-1722`);
  - Reset sets Simple and keeps the tabs block, so a later Tabbed brings the tabs back. This mirrors 10 §2 L90 inside the draft.

### 2.2 Property access: BLOCKED

The dialog is plan-gated on Notion Free. Every control is disabled and the level list was never visible (10 §1 L11, L35-36). The level names come only from an unverified help-page summary.

**Not planned.** It needs a Business workspace to measure, or the user's OK to skip it (Q7). The "Property access" rows in Notion's menus (column header, edit panel, compact edit card) are left out too.

### 2.3 Database templates

Blok **has** templates:
- template rows are `database-row` blocks with `data.template === true` (`templates.ts:4`);
- there is a "New" dropdown with use / edit / set default / repeat / duplicate / delete (`database-template-menu.ts:31-85`);
- a default is stored as `defaultTemplateId` on the title property (`database-model.ts:201-211`);
- an edit banner exists (`drawer:1139-1150`).

So this is not a separate feature. The plan covers both parts (Phase 9):
- **Toggle storage:** `pageLayoutTemplates?: false` on the title property. Default ON, key absent, the same pattern as `pageLayoutPropertyIcons` (`layout:44`). Reset drops the key, so templates come back ON (10 §5 L162).
- **Row page effect:**
  - The empty-page placeholder in `src/tools/database-row/index.ts:97-103` reads its parent's layout through `api.blocks.getById(parentId).call('readPageLayout', {receive})`. This is the same call pattern `expand()` uses (`database-row/index.ts:119-127`).
  - ON + no templates: append the "create a template" button. It calls the existing `addTemplate` host path (`index.ts:3142` area).
  - ON + templates: draw the picker (templates, "Empty", "+ New template").
  - OFF: draw neither, and leave the body blank (10 §6 L146).
  - Picker keyboard is UNMEASURED (10 §6 L147): Enter keeps today's "start an empty page"; ↑/↓ wait for a measurement (Q8).

### 2.4 Page discussions, inline comments, backlinks: skipped

Blok has none of them:
- `grep -rni "backlink\|discussion\|inlineComments" src/tools/database/` → none;
- `config.comments` is only a host hook (`types/tools/database.d.ts:956`).

Not planned:
- the Page discussions module and switch;
- the Inline comments row;
- the backlinks line.

The builder canvas therefore has three modules: Heading, Property group, Content. If the user later wants Page discussions backed by `config.comments`, that is its own feature (Q9).

### 2.5 Law-driven divergences (stated, not invented)

- **Blue law.** These are selected states and are drawn neutral (`--blok-icon-active-bg` / primary ink, checkmark where Notion has one):
  - the selected Structure card (Notion 0.75px blue ring);
  - the selected module ring;
  - the selected builder tab.

  Each gets a test asserting no blue fill and primary ink. Kept blue: the Apply button (primary action) and switch ON (user decision, memory switch-on-stays-blue). Open: the decorative blue canvas outline, module header strip and "+" button (Q6).
- **Hints law.**
  - The (i) hints use `onHover`: delayed, never on focus.
  - The first-open onboarding card is not built unless the user says so (Q5).
- **Body-mount law.** The full-window builder mounts on `document.body` with `data-blok-interface="database-layout-builder"`. It must pass `test/unit/architecture/body-mount-scope-law.test.ts`. Body-mounted UI cannot rely on scoped utilities, so it uses attribute selectors in `database.css` like the rest of the drawer.
- **Focus rings** follow Blok's keyboard-modality law, not Notion's values (row 16).
- **Single samples are not rules.** Group order (row 30) and preview list order (row 19) follow schema / view order.

### 2.6 Public surface and breaking status (checked)

The last release is `v1.16.1` (`git tag --sort=-v:refname | head -1`).

| Surface | In v1.16.1? | Evidence | Breaking if changed? |
|---|---|---|---|
| `PageLayoutFields`, `PageLayoutPlacement`, `PageLayoutSection`, `pageLayout*` keys (`types/tools/database.d.ts:43-75`) | No | `git show v1.16.1:types/tools/database.d.ts \| grep -c pageLayout` → 0. Added in 72b7c159, which is not an ancestor of v1.16.1 | No |
| `pageVisibility` / `PageVisibility` | No | Same grep → no match | No |
| `src/tools/database/page-layout.ts` | No | `git show v1.16.1:src/tools/database/page-layout.ts` → "exists on disk, but not in 'v1.16.1'" | Internal anyway |
| i18n keys `tools.database.layout*`, `hiddenProperties`, `hideHiddenProperties`, `rowBodyEmpty`, `pageVisibility*` (public via `types/message-keys.d.ts`) | No | `git show v1.16.1:src/components/i18n/locales/en.json \| grep -E '"tools.database.(layout\|hiddenProperties\|hideHiddenProperties\|pageVisibility\|rowBodyEmpty)'` → nothing. 7451ee26 (hidden properties) is after v1.16.1 | No: renaming or removing them is ordinary work |
| Data attributes `data-blok-database-drawer-layout-bar`, `-layout-*`, `-drawer-pins*`, `-drawer-section*`, `-drawer-details*`, `-drawer-tabs`, `-drawer-hidden-props` | No | v1.16.1 drawer attributes were only `drawer-add-prop, -close, -content, -editor, -prop-dot, -prop-label, -prop-pill, -prop-row, -prop-value, -props, -title, -toolbar` | No |
| `data-blok-database-drawer-props`, `-prop-row`, `-prop-label`, `-prop-value`, `-add-prop` | **Yes** | Same list | **Yes**: keep them. No phase renames them |

So no phase below is BREAKING. Re-run the check at build time if a release is cut first.

**New public surface (additive, post-release):**
- `PageLayoutFields` gains:
  - `pageLayoutPropertyLabels?: false`
  - `pageLayoutTemplates?: false`
  - `pageLayoutFullWidth?: true`
  - `pageLayoutTabsId?: string` (Phase 12)
- New i18n keys land in `types/message-keys.d.ts`, regenerated with `node scripts/generate-message-keys-dts.mjs`.

Every new field also goes into the agent tool description `src/shared/tool-descriptions/database.ts` (it lists `defaultTemplateId` at `:400`). **That file is modified in another session's working tree right now** (git status at start). Coordinate before editing it, and hunk-check, never `add` the whole file.

---

## 3. Plan

### Conventions for every phase

- **TDD.** Write the failing test, watch it fail, write the minimal code, watch it pass.
- **Unit runs.** One file per call: `timeout 600 yarn vitest run <file>`. Never several paths in one call (memory: multi-path vitest skips files).
- **E2E runs.** `yarn e2e test/playwright/tests/database/database-page-layout.spec.ts -g "<name>"`.
- **Referencing tests.** Before landing, grep the changed selectors and symbols across `test/`. Today the builder selectors are referenced by:
  - `row-page-layout.integration.test.ts`
  - `database-card-drawer-layout.test.ts`
  - `row-body-blocks.integration.test.ts`
  - `database-page-layout-css.test.ts`
  - `test/unit/styles/__snapshots__/main-css-rules.snap.txt`
  - `database-page-layout.spec.ts`

  Also see memory "database landing gate": about 87 tests outside tools/database reference the database.
- **CSS phases** re-run:
  - `test/unit/styles/database-page-layout-css.test.ts`, including "uses logical properties and radius role tokens only";
  - the main CSS snapshot.
- **Do not touch** `test/playwright/tests/database/database-row-page.spec.ts`. Another session is editing it.
- **New i18n keys** go into `en.json`, then all 68 other locales (`blok-translations` skill), then `node scripts/generate-message-keys-dts.mjs`.
- **Commit and push** each green slice (memory: commit in parts).

### Phase 1: Layout data (pure, no UI)

**Goal:** the data the later phases need, tested in isolation.

**Files:**
- `src/tools/database/page-layout.ts`
- `types/tools/database.d.ts`
- `src/tools/database/database-model.ts` (only if `pageLayoutFields` needs the new keys)
- `src/shared/tool-descriptions/database.ts` (coordinate, see §2.6)

**Changes:**
1. `PageLayoutData` gains `propertyLabels`, `templates` and `fullWidth`, with fields written only when they differ from the default (`false`, `false`, `true`).
2. `addSection(id, name)` inserts **first**. When the layout has no section yet, it moves every group property into it as `place: 'section'` placements (10 §3 L97-98).
3. `moveSection(id, step)`.
4. `pin(id)` for a property made from the Pinned list puts it **first** among pins. Add `pinFirst`, or a position argument (10 §7 L108).
5. **Group order owned by the layout.** Add `place: 'group'` to `PageLayoutPlace`. Group properties with a `group` placement come first, in placement order. The rest follow in schema order (`layout:90`). This one mechanism serves two needs:
   - "+ Add a property" from the Property group lands at the top (Phase 5b, 09 §3 L57);
   - Reset leaves the group ordered as old pins, then old sections (Phase 8, 10 §5 L166).

   Property `position` is **never** rewritten for layout order. `database-model.ts:149` sorts the schema by `position`, and that order feeds the table, so a write would also reorder table columns. Notion's post-Reset order "is not the table's column order" (10 §5 L166).
6. **One draft owner.** New `PageLayoutDraft` in `page-layout.ts`: `{ ops: PageLayoutOp[]; visibility: Map<propertyId, PageVisibility>; madeProperties: string[] }`.
   - The drawer owns the one instance (`draft: PageLayoutDraft | null`), replacing `layoutDraft` + `draftProperties`.
   - Every existing `layoutDraft !== null` branch (`drawer:535, 894-895, 1238-1240, 1266, 1323, 1331, 1405, 1572, 1637-1646, 2097`) reads `this.draft !== null`. The Phase 2 builder is UI only and reads and writes the drawer's draft through callbacks.
   - `visibility` is the 👁️ channel. It writes the property, not the title property, so it cannot be a `PageLayoutOp`. Apply writes it, Discard drops it.
   - `apply(draft, layout)` and `isEmpty(draft)` are pure helpers, tested here.

**Tests (fail first):**
- `test/unit/tools/database/page-layout.test.ts`:
  - "adds the first section at the top and moves every group property into it"
  - "adds a later section at the top, empty"
  - "moves a section up and down"
  - "pins a property made from the Pinned list first"
  - "writes property labels off as false, templates off as false, full width on as true, and drops each key at its default"
  - "resets property labels, templates and full width to their defaults"
  - "puts group placements first, in placement order, and the rest in schema order"
  - "never changes a property position for layout order"
  - "a draft with only visibility edits is not empty, and applying it replays the ops on the newest layout"
- `test/unit/tools/database/database-card-drawer-layout.test.ts`: the whole "customizing" block must stay green after the `layoutDraft` → `draft` swap. That swap is a refactor, so no new test is needed.
- `test/unit/tools/database/concurrent-page-layout.test.ts`:
  - "keeps a peer's pin made while the first section was being added" (the bulk placement write must not drop a concurrent pin)

**i18n:** none.

**Public surface:** additive `PageLayoutFields` keys and the `'group'` member of `PageLayoutPlace` (post-release, not breaking).

### Phase 2: Full-window builder shell and top bar

**Goal:** a full-window takeover with Notion's top bar. The canvas first renders the existing row-page regions inside a canvas card.

**Files:**
- new `src/tools/database/page-layout-builder.ts` (class `PageLayoutBuilder`). It is body-mounted, `role="dialog"`, `aria-modal="true"`, `data-blok-interface="database-layout-builder"`.
  - It is UI only. The draft stays in the drawer (Phase 1, item 6). The builder gets `draft()`, `edit(op)`, `apply()` and `cancel()` callbacks. The discard question moves into it.
  - It calls back into the drawer for property rows (`createPropertyRow`). While a draft is open, a canvas row's label click must **not** open the live property menu (`drawer:2058-2068` → `onOpenPropertyMenu`). That menu writes `pageVisibility` at once and would bypass the draft. Drop the label button while customizing.
  - **Direction.** A body mount loses the editor's `dir`. Set the builder's `dir` from the drawer (`getElementDirection`), as the confirm dialog does with `directionSource`.
  - **Focus.** Trap Tab inside the dialog: Notion's order wraps, 10 §9 L70. On close, return focus to the control that opened it.
- `database-card-drawer.ts`: remove `renderLayoutBar`. `startCustomizing()` opens the builder. The bar's property search and the Page settings popover move into the builder unchanged, so nothing is lost. Phase 5a retires the search and Phase 4 retires the popover.
- `index.ts`: `customizeLayoutAction` opens the builder.
- `src/styles/database.css`:
  - new tokens `--blok-database-builder-backdrop` (light `rgb(249,248,247)`, plus a dark value) and `--blok-database-builder-canvas-ring` (`rgb(206,227,247)`, Q6);
  - bar 60px with 16px inline padding;
  - Cancel with `IconCross`;
  - the Apply split button with a chevron "More save options" menu that holds Reset. Reset moves out of Page settings; its confirm comes in Phase 8.

**Tests (fail first):**
- new `test/unit/tools/database/page-layout-builder.test.ts`:
  - "opens full window over the page, outside the drawer, and closes on Apply"
  - "puts Cancel, Apply and More save options in that tab order" (Phase 3 puts Preview first)
  - "keeps Tab inside the builder and returns focus to the opener on close"
  - "follows the editor's direction (ltr|rtl)"
  - "does not open the live property menu from a canvas label while customizing"
  - "keeps the builder and its draft on Escape"
  - "holds Reset to original page layout in More save options"
  - "asks Discard all layout changes? on Cancel after edits" (moved from the drawer test)
- new `test/unit/styles/database-page-layout-builder-css.test.ts`:
  - "paints the backdrop and the canvas ring with builder tokens"
  - "keeps the top bar on one line at 756px"
- `test/unit/architecture/body-mount-scope-law.test.ts`: must stay green. Run it.
- Migrate the drawer tests that query `[data-blok-database-drawer-layout-bar]` / `-layout-settings` / `-layout-cancel` / `-layout-apply`:
  - `database-card-drawer-layout.test.ts` "customizing" block;
  - `row-page-layout.integration.test.ts`;
  - `row-body-blocks.integration.test.ts`.
- e2e `database-page-layout.spec.ts`: new "opens Customize page layout full window and applies from its top bar". Update "pins a property for every page with Apply to all pages", "asks before discarding layout edits on Cancel" and "keeps Customize layout and its draft open on Escape" to the new surface.

**i18n:**
- `tools.database.layoutMoreSaveOptions` = "More save options"

Removed (post-release, not breaking): `tools.database.layoutCustomizing`, plus `layoutGroupInPage` / `layoutGroupInPanel` in Phase 4.

**Public surface:** data attributes only (post-release).

### Phase 3: Preview switch, zero rows, entry points

**Files:**
- `page-layout-builder.ts`
- `index.ts` (zero-row entry)
- `database-property-menu.ts` (last item "Customize layout")

**Changes:**
- "Preview: <page>" button (chevron down) → a popover with a focused "Search pages…" field and rows in **view order** (Q4). The current row gets a trailing check (`IconCheck`, no fill). Switching keeps the draft.
- With zero rows the entry is enabled. The canvas previews a placeholder titled "New page" with an "Empty" group and Content. The popover reads "No results."
- The **row-page** property menu gains "Customize layout" as its last item when customizable (09 §1b L99). `database-property-menu.ts` also serves the column header, and Notion's header menu has no such item (10 §1 L15). So the item is gated on the row-page caller.
- More settings > Customize page layout gets a layout icon (row 2). Grep `src/components/icons/index.ts` first, per memory reuse-icons-first. Draw a new icon only if none fits, then follow the icon README + `iconGroups` + `generate-icons-dts.mjs` rules.

**Tests:**
- `page-layout-builder.test.ts`:
  - "previews the chosen page from the Preview switch and keeps the draft"
  - "searches pages in the Preview switch"
  - "marks the previewed page with a check and no fill"
  - "opens on a New page placeholder when the database has no rows"
- `row-page-layout.integration.test.ts`: replace "disables Customize page layout with no rows" with "opens Customize page layout on a placeholder page with no rows"
- `test/unit/tools/database/database-property-menu.test.ts` (confirm the file name at build time):
  - "ends the row page property menu with Customize layout, which opens the builder on this page"
  - "offers no Customize layout in the column header menu"
- Preview tab order: extend Phase 2's test to "puts Preview, Cancel, Apply and More save options in that tab order".

**i18n:**
- `tools.database.layoutPreview` = "Preview: {page}"
- `tools.database.layoutPreviewSearch` = "Search pages…"
- `tools.database.layoutPreviewEmpty` = "No results." (or reuse `find.noResults` "No results" if the period difference is acceptable)
- `tools.database.layoutNewPage` = "New page"

### Phase 4: Page settings column

**Files:**
- `page-layout-builder.ts`
- `database.css`
- `database-panel.ts` (reuse `panelSwitch`, `:229`)

**Changes:**
- A fixed "Page settings" column (290px):
  - **Structure**: Simple / Tabbed cards, 117x80. The selected card is neutral per the blue law.
  - **Options** switches:
    - Property icons (existing data);
    - Full width (`pageLayoutFullWidth`; data only here, effect in Phase 10);
    - Database templates (`pageLayoutTemplates`; data only here, effect in Phase 9).
  - (i) hints via `onHover`.
- Page settings is now a column, so the popover from Phase 2 goes. Its "Properties in the page / details panel" check items **stay** in the column under Options for now. They are retired in 5b, when "Move to panel" lands, so "moves the property group into the details panel" stays green.

**Tests:**
- `page-layout-builder.test.ts`:
  - "sets Simple or Tabbed from the Structure cards as a draft edit"
  - "turns Property icons, Full width and Database templates on and off as draft edits, with switches"
  - "shows the Full width and Database templates hints only after a hover delay, never on focus"
- `database-page-layout-builder-css.test.ts`:
  - "marks the selected Structure card with primary ink and no blue"
- Keep `test/unit/styles/selected-state-neutral.test.ts` and `test/unit/architecture/hint-delay-law.test.ts` green.

**i18n:**
- `tools.database.layoutStructure` = "Structure"
- `tools.database.layoutOptions` = "Options"
- `tools.database.layoutFullWidth` = "Full width"
- `tools.database.layoutFullWidthHint` = "Page width can be overwritten on individual pages."
- `tools.database.layoutTemplates` = "Database templates"
- `tools.database.layoutTemplatesHint` = "If enabled, empty pages will show the template picker."

### Phase 5: Modules and their ••• menus

Split into three commits.

**Retiring the per-property ⋯ menu (`drawer:1824-1870`).** It holds five jobs. Each leaves in the commit that lands its replacement, and the menu is deleted when it is empty (Phase 6):

| Job | Replaced in | Old test retired there |
|---|---|---|
| Pin / Unpin | 5a (📌) | "disables Pin to heading at the pin limit", "keeps Pin to heading disabled when search hides all 15 existing pins" → rewritten against the 📌 button |
| Add to page / Add to panel / Move to panel / Move to page / Remove from layout | 5c ("+", "Add to panel", module •••) | "draws modules in the page and in a details panel…" setup, "never offers the details panel for a relation" → rewritten against "+" / "Add to panel" |
| Module Move up / Move down | 5c (module drag, with Move up/down kept in the module ••• as the keyboard path) | "searches pins and page and panel modules…" setup |
| Move to {section} / Remove from section | 6 (drag in the group menu, with "Move to {section}" kept in the property row's menu as the keyboard path) | "adds and names a section, then moves a property into it" |
| Builder property search | 5a (Heading menu search) and 5b (group menu search) | "searches property names live, including hidden properties and folded sections", "clearing property search restores…", "keeps the selected relation tab when property search hides its value", "shows searched content beside a relation tab…" → retired in 5b, when both menu searches exist |

**5a. Heading module menu.**
- Canvas modules: Heading, Property group and Content, each a card with a header strip + "•••" ("Action menu for module"). A click in a module selects it and opens its menu (10 §8 L47).
- Heading menu:
  - "Search properties…";
  - "Pinned properties" and "Unpinned properties";
  - a 📌 button per row with aria "Show {name} as pinned" / "Do not show {name} as pinned";
  - "+ Add a property" at the end of Pinned, which lands **first** (Phase 1 op);
  - "Options > Property labels" switch (data from Phase 1, rendering in Phase 7).
- Removes only Pin / Unpin from the per-property ⋯ menu (table above).
- Tests (`page-layout-builder.test.ts`):
  - "lists pinned and unpinned properties in the Heading menu with a pin button each"
  - "pins and unpins at once from the pin button, and the canvas follows"
  - "adds a property from the Pinned list first among pins, never in the group"
  - "selects a module and opens its menu on a click anywhere in it"
  - "marks the selected module without blue"
- i18n:
  - `layoutModuleHeading` = "Heading"
  - `layoutModuleGroup` = "Property group"
  - `layoutModuleContent` = "Content"
  - `layoutModuleMenu` = "Action menu for module"
  - `layoutPinnedProperties` = "Pinned properties"
  - `layoutUnpinnedProperties` = "Unpinned properties"
  - `layoutSearchProperties` = "Search properties…"
  - `layoutPinAria` = "Show {name} as pinned"
  - `layoutUnpinAria` = "Do not show {name} as pinned"
  - `layoutPropertyLabels` = "Property labels"
  - Drop `layoutPin` / `layoutUnpin` once unused.

**5b. Property group menu and 👁️.**
- Group menu:
  - "+ Add section";
  - search;
  - one row per property with a 👁️ button (glyph shows the state, no checkmark in its 3-item menu);
  - "+ Add a property", which lands **first in the group** (09 §3 L57) through the Phase 1 `place: 'group'` placement;
  - "Move to panel" / "Move to page". This retires the Page settings "Properties in the page / details panel" items and their keys `layoutGroupInPage` / `layoutGroupInPanel`;
  - the builder bar search is retired here (table above).
- 👁️ edits go into the draft's `visibility` map. The canvas hides them at once, and "N more properties" appears but does not expand in the builder.
- Apply writes the layout ops **and** the visibility map in **one** undo step (`api.blocks.transact`). Discard drops both.
- Tests:
  - `page-layout-builder.test.ts`:
    - "sets Always show, Hide when empty and Always hide from the eye button as a draft"
    - "shows N more properties for hidden properties and does not expand it while customizing"
    - "adds a property from the Property group menu at the top of the group"
    - "moves the property group to the panel and back"
  - `row-page-layout.integration.test.ts`:
    - "applies eye visibility and layout edits as one undo step"
    - "drops eye visibility edits on Discard"
    - Keep "adds no undo step for opening Customize layout, and one for Apply" green.
- i18n:
  - `layoutVisibilityAria` = "Visibility of {name}" (Notion's label UNMEASURED)
  - `layoutMoreProperties` = "{count} more properties"
  - `layoutMorePropertiesOne` = "1 more property"
  - `layoutHideMoreProperties` = "Hide {count} properties"
  - `layoutHideMorePropertiesOne` = "Hide 1 property"
  - Remove `hiddenProperties` / `hideHiddenProperties` (post-release).
  - Reuse `pageVisibility.*` for the 3 items.

**5c. Add page module, module drag and side panel column.**
- A "+" between modules → "Add to page" with "Use an existing property" / "Create new property".
- The side panel column: "»" Hide sidebar, "+ Add to panel" (same list, titled "Add to panel"). At 756px it collapses to "«".
- Module ••• menu for a single-property module: Move up / Move down (the keyboard path), Move to panel / Move to page, Remove. Modules and pins drag (⠿, row 26), using the database's pointer drag and the drop line (`database-drop-line.ts`).
- The per-property ⋯ menu loses its module jobs (table above).
- Tests:
  - "adds an existing property as a page module from +"
  - "creates a property into the panel from Add to panel"
  - "never offers Add to panel for a relation" (replaces "never offers the details panel for a relation")
  - "drags a module below another, and Move down does the same from the keyboard"
  - "collapses the side panel column at a narrow width"
- i18n:
  - `layoutAddModule` = "Add page module"
  - `layoutUseExisting` = "Use an existing property"
  - `layoutCreateNew` = "Create new property"
  - `layoutHideSidebar` = "Hide sidebar"
  - `layoutShowSidebar` = "Show sidebar" (the collapsed "«" label is UNMEASURED)
  - Reuse `layoutAddToPage` and `layoutAddToPanel`.

### Phase 6: Sections parity

**Files:**
- `page-layout-builder.ts`
- `database-card-drawer.ts` (row page)
- `database.css`

**Changes:**
- Builder:
  - Add section lands at the top (first takes all), with a rename popover: text pre-selected, "Done".
  - Section rows in the group menu: Rename · Move up/down (valid directions only) · Delete with sub-line "No properties will be deleted".
  - An empty section shows "Empty" on the canvas. Each section in the menu has "+ Add a property".
  - Properties drag between sections in the group menu (row 60). A property row's menu keeps "Move to {section}" / "Remove from section" as the keyboard path.
  - The per-property ⋯ menu is now empty and is deleted, with `layoutItemOptions` and the `data-blok-database-layout-item-menu` attribute.
- Row page: each section ends with its own "+ Add a property".
- Fold state persists per viewer across reloads, using the storage the user picks (Q3). Proposed: `localStorage` keyed by database block id + section id, wrapped in try/catch. Read-only viewers fold too, so a document write is ruled out.

**Tests:**
- `page-layout-builder.test.ts`:
  - "adds the first section at the top holding every property, and opens its rename with the name selected"
  - "shows Empty in an empty section"
  - "moves a section down from its menu and offers only valid directions"
  - "deletes a section without deleting its properties"
  - "drags a property from one section to another in the group menu"
  - "deletes the per-property layout menu once every job has a home" (the `data-blok-database-layout-item-menu` query returns nothing)
- `database-card-drawer-layout.test.ts`:
  - "ends each section with its own Add a property"
  - "keeps a folded section folded after the drawer is rebuilt" (reload stand-in)
- e2e: "keeps a folded section folded after a reload"

**i18n:**
- `layoutSectionDone` = "Done"
- `layoutRenameSection` = "Rename"
- `layoutDeleteSectionHint` = "No properties will be deleted"
- Reuse `layoutMoveUp`/`Down`, `layoutNewSection` and `cellEmpty`.

### Phase 7: Property labels OFF rendering

**Files:**
- `database-card-drawer.ts` (pins row; shared with the builder canvas)
- `database.css`

**Changes:**
- With labels OFF the pins strip is one 30px row with no label row.
- An empty value shows type icon + name as a grey placeholder.
- An empty checkbox shows only its box.
- A filled value shows only the value.
- No tooltip.

**Tests:**
- `database-card-drawer-layout.test.ts`:
  - "drops pin labels when Property labels is off"
  - "shows an empty pin as its icon and name in grey when labels are off"
  - "shows a filled pin as its value only when labels are off"
  - "shows an empty checkbox pin as its box only"
  - "sizes a pin icon 16.8px and a group row icon 19.2px" (row 101; 09 §8 L83-84. Per-type glyph names for Formula, Text, Relation, Rollup, Button, Place and the people/time types are UNMEASURED, so the glyph mapping is not changed)
- `database-page-layout-css.test.ts`: "draws a label-less pin cell 30px high with a grey placeholder"

**i18n:** none. Names are data.

**a11y note:** a label-less checkbox needs an accessible name. Give the box `aria-label` = property name, which is invisible and so not a visible divergence.

### Phase 8: Reset confirm and order

**Files:**
- `page-layout-builder.ts`
- `database-confirm-dialog.ts` (reuse)
- `page-layout.ts` (`resetPageLayout` takes the current layout)

**Changes:**
- "Reset to original page layout" (from More save options) asks "Reset to original page layout?" / "No properties will be deleted." with Reset (destructive) and Cancel.
- Confirming writes `resetPageLayout()` and closes the builder.
- `resetPageLayout(current)` leaves `place: 'group'` placements listing the old pins, then the old sections' properties, in order (10 §5 L166). Everything else is cleared. No property `position` is written (Phase 1, item 5), so table columns keep their order.
- It never deletes properties, including ones made this session.

**Tests:**
- `page-layout-builder.test.ts`:
  - "asks before resetting and resets nothing on Cancel"
  - "resets to Simple with no pins, sections or labels, templates back on, and closes the builder"
  - "keeps properties made in this session on Reset"
  - "orders the group by the old pins, then the old sections, after Reset"
  - "leaves the table column order alone on Reset"
- `row-page-layout.integration.test.ts`: "Reset is one undo step"
- Replace "sets the structure from Page settings and resets to the original layout at once" in `database-card-drawer-layout.test.ts`.

**i18n:**
- `layoutResetConfirmTitle` = "Reset to original page layout?"
- `layoutResetConfirmBody` = "No properties will be deleted."
- `layoutResetConfirm` = "Reset"

### Phase 9: Database templates on the empty row page

**Files:**
- `src/tools/database-row/index.ts`
- `src/tools/database/index.ts` (`readPageLayout` call handler + template list + `addTemplate`)
- `database.css`

**Changes:** as in §2.3, plus:
- **Refresh path.** The placeholder reads the layout when it draws (`database-row/index.ts:97-113`), so it must be told when the inputs change. After an Apply or Reset that changes `pageLayoutTemplates`, and after a template is added or removed, the database tool calls `child.call('refreshPlaceholder')` on each row child (`getChildren(this.dataId)` filtered to `database-row`). A peer's change arrives through the same schema refresh path.
- **Template rows.** A template row (`isTemplateData`) uses the same tool. What Notion shows on an empty template is UNMEASURED. Proposed: no picker on a template row (Q8).

**Tests:**
- `test/unit/tools/database-row/` (new or existing; confirm at build time): "shows create a template on an empty page when templates are on and none exist"
- `row-page-layout.integration.test.ts`:
  - "lists templates, Empty and New template on an empty page when templates are on"
  - "shows no prompt and no picker when Database templates is off"
  - "creates a template from create a template"
  - "Reset turns Database templates back on"
  - "redraws the empty-page prompt on every row when Database templates is applied off"
  - "shows the picker on an empty row once the first template is added"
  - "shows no picker on an empty template row"
- e2e: "picks a template from the empty page picker"

**i18n:**
- Replace `tools.database.rowBodyEmpty` (post-release) with `rowBodyEmptyOr` = "Press Enter to continue with an empty page, or"
- `rowBodyCreateTemplate` = "create a template"
- `rowBodyPickTemplate` = "Press Enter to continue with an empty page, or pick a template (use ↑ and ↓ to select)"
- Reuse `templateNew` and `cellEmpty`.

If Q8 says to skip ↑/↓, the picker copy drops the parenthesis.

### Phase 10: Full width

**Files:** `database-card-drawer.ts` (full page mode), `database.css`.

**Changes:** with `pageLayoutFullWidth` the full page content widens (Notion: 720 → 1050 at a 1512px window). Peeks do not change. The page override (09 §9 L150) needs a row-level field and a row actions menu (row 7). Not planned until Q10.

**Tests:**
- `database-page-layout-css.test.ts`: "widens only the full page when the layout is full width"
- e2e: "widens the full page and leaves both peeks alone when Full width is on"

**i18n:** none beyond Phase 4.

### Phase 11: Row page details polish

**Files:** `database-card-drawer.ts`, `database.css`, `index.ts` (peek toolbar).

**Changes:**
- The toggle text flips "View details" ↔ "Hide details".
- The panel gets a "Properties" header and a round "Close panel" button.
- A "Page info" icon button sits in the peek/full-page toolbar only when the group or modules are in the panel. It has a neutral fill when open.
- The "N more properties" expanded state is kept across rows for the session (stop resetting `showHiddenProps` at `drawer:486, 620`) and reset on reload.

**Tests:**
- `database-card-drawer-layout.test.ts`:
  - "says Hide details while the panel is open"
  - "closes the panel from its Close panel button"
  - "shows Page info only when the layout uses the panel, and toggles the panel"
  - "keeps N more properties expanded on the next row"

**i18n:**
- `layoutHideDetails` = "Hide details"
- `layoutClosePanel` = "Close panel"
- `layoutPageInfo` = "Page info"
- Reuse `propertiesSection` ("Properties").

### Phase 12: Tabbed structure as blocks (after Q1/Q2)

**Files:**
- `page-layout.ts` (`pageLayoutTabsId`)
- `page-layout-builder.ts`
- `database-card-drawer.ts` (strip + linked view mount)
- `index.ts` (create/delete the tabs block and linked databases)
- `src/view/emitters.ts` + `src/view/blocks-to-plain-text.ts` (skip the layout tabs block)
- `database.css`
- Remove the relation-tab code (`drawer:1494-1548`).

**Tests, in this order, each failing first:**
1. `test/unit/view/…` (export tests next to the database emitter): "never exports the page layout tabs block as database content"
2. `row-page-layout.integration.test.ts`:
   - "a view tab that links its own database renders without recursing"
   - "adds a linked view tab as a tab block holding a linked database block under the layout tabs block"
   - "deletes a view tab after Delete this view? and selects Content"
   - "Content tab renames and has no delete"
   - "Discard deletes tab blocks made while customizing" (per Q2)
   - "Apply with a new view tab is one undo step"
3. `page-layout-builder.test.ts`:
   - "shows Add tab only while the pointer is over the tab bar"
   - "marks the selected builder tab without blue"
4. `database-card-drawer-layout.test.ts`: "a view tab shows the whole linked database, not filtered to the row"
5. Concurrency (`concurrent-page-layout.test.ts`): "two peers turning Tabbed on make one layout tabs block"

**i18n:**
- `layoutAddTab` = "Add tab"
- `layoutLinkDataSource` = "Link existing data source"
- `layoutLinkDataSourceSearch` = "Link to a data source…"
- `layoutExistingDataSources` = "Existing data sources"
- `layoutViewName` = "View name"
- `layoutViewOf` = "View of"
- `layoutAddRelation` = "Add new relation"
- `layoutAddView` = "Add view"
- `layoutDeleteViewTitle` = "Delete this view?"
- `layoutDeleteView` = "Delete view"
- `layoutViewDeleted` = "Deleted {name} view"
- Reuse `renameView` and `layoutContentTab`.

**Public surface:** `pageLayoutTabsId` (additive, post-release). The removed relation tabs are post-release behaviour.

---

## 4. Questions only the user can answer

1. **Q1 Tabbed placement.** OK to hold view tabs in one shared `tabs` block under the database block, referenced by `pageLayoutTabsId`, with exports skipping it (§2.1)? The alternative is per-row copies, which is not recommended.
2. **Q2 Tab blocks and Cancel/Reset.** Notion is unmeasured here. Accept the proposed defaults (Discard deletes tab blocks made in the session; Reset keeps them), or measure first?
3. **Q3 Section fold storage.** Notion keeps folds across rows and reloads, storage unknown. Per viewer in `localStorage` (proposed), or something shared?
4. **Q4 Preview list order.** View order (proposed) instead of Notion's single-sample newest-first?
5. **Q5 Onboarding card.** It shows without hover, against the hints law. Skip it (proposed)?
6. **Q6 Decorative blue.** The canvas outline, module header strips and "+" are blue in Notion. They are not selected states, links or focus rings. Keep them blue as builder chrome, or use neutral tokens?
7. **Q7 Property access.** Skip it, or provide a Business workspace to measure?
8. **Q8 Template picker.** Two unmeasured points:
   - ↑/↓ keys: build Blok's usual menu keys, or measure first?
   - An empty *template* row: show no picker (proposed), or something else?
9. **Q9 Page discussions.** Skip (proposed), or back a Page discussions module with `config.comments`?
10. **Q10 Full width page override.** It needs a row actions menu ("•••") that Blok's row page does not have. Build that menu as its own feature, or ship only the layout-level switch?
