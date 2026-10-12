# Research 10: Notion row-page builder, round 2 (measured)

Measured across 2026-10-12 and 2026-10-13 (local dates; the page name uses 2026-10-13 as the task asked) in the user's signed-in Chrome via `playwright-cli -s=notion-measure2 open --extension`, on app.notion.com.
Workspace "Personal", Free Plan, 1 member (see research-09). Viewport 1512x717 CSS px. Light theme.
Scratch: private page "Blok measure scratch 2 2026-10-13" holding full-page database "Measure DB 2" (`/database` > "Database - Full page" > "New empty data source").
Properties: Name (title), Text, Number, Person, Select, Date. Rows: Alpha, Beta, Gamma (created in that order).
Screenshots: ~/Packages/.blok-undo/db-parity-ledger/notion-measure2/ (not in the repo) (`NN-*.png`). Raw probe dumps: `*.json`.

## 1. Property access

**Headline: on this Free-plan workspace Property access is plan-gated. The dialog opens, but every level control is disabled. No level could be changed, so no level list was seen in the UI.**

### Entry points

- Column header menu (on "Text"), in order: Property name field (with "Change icon" button and "Add property description" (i) button), **Property access**, Change type, AI Autofill, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property (`01-text-header-menu.png`). The "Property access" item has an icon and a label only: no current value, no chevron.
- Property edit panel (View settings > Edit properties > Text; panel titled "Edit property" with Back and Close buttons): name field, then **Type** (value "Text" 14px rgb(161,158,153) + chevron), **Property access**, AI Autofill (chevron); divider; Wrap content (switch, ON), Duplicate property, Delete property (`05-edit-property-panel.png`).
  - Property access row: 274x28 at x=1134, label 14px/400 rgb(44,44,43), icon `lockSmall` 20px. No value text, no chevron.
- Both entries open the **same modal dialog** (role=dialog, aria-label "Property access"), same box and content (`02-property-access-from-header.png`, `06-property-access-from-edit-panel.png`).

### The dialog (exact text, top to bottom)

- Box: 600x520 at x=456 y=98.5 (centered), white, radius **20px**, shadow `rgba(25,25,25,0.24) 0 24px 48px, rgba(25,25,25,0.14) 0 4px 12px, rgba(42,28,0,0.07) 0 0 0 1px`. Backdrop dims the page.
- Title **"Property access"** 17px/600 rgb(44,44,43). Close button aria-label "Dismiss": 22x22 circle, fill rgba(55,53,47,0.06), `xMarkFill` 16px.
- **"For"** + a property switcher button (type glyph + "Text" 14px/500 rgb(125,122,117) + 14px chevron-down; 73.8x28, radius 6px). It is **enabled** on Free. It opens a popover with a "Search for property…" field (focused) and one 28px option per property, the current one with a trailing `checkmarkSmall` and no fill. Order shown: **Date, Text, Person, Select, Number**. The title property "Name" is **not** offered (`03-property-access-for-switcher.png`).
- Upsell note card: **"Unlock property access for your databases"** (14px/500) / **"Get the Business plan to customize property access"** (14px/400 rgb(125,122,117)) / button **"Upgrade now"** (112x32, fill rgb(39,131,222), text rgb(243,249,253) 14px/500, radius 6px) + an illustration. Not clicked.
- **"Default access"** (14px/500) / **"Applies to all people, agents, and connections"** (13px/400 rgb(125,122,117)). Below it a 544x60 card (radius 16px, shadow ring rgba(42,28,0,0.07)) holding a disabled dropdown: database glyph + **"Inherit from database"** + chevron (button 528x44, radius 6px). Clicking it opened nothing.
- **"Exceptions"** / **"Give specific individuals different access than the default"**. Card (544x88, radius 16px): row "Everyone with full access" (people glyph in a 20px round grey chip) with a disabled **"Full access"** value button on the right; then a disabled **"+ Add a person, group, or person property"** row (text rgb(125,122,117)).
- The whole settings block (Default access + Exceptions) sits at **opacity 0.5** while gated. The body scrolls (clientHeight 368 / scrollHeight 500) under a 32px top/bottom mask fade (`04-property-access-scrolled.png`).
- Footer: **"Learn more"** link (to notion.com/help/database-property-access, 14px/500 rgb(125,122,117)) on the left; **"Clear"** (disabled, text rgb(125,122,117), no fill) and **"Save"** (disabled, fill rgb(39,131,222), opacity 0.4) on the right; all 32px high, radius 6px.
- A hidden (0x0) **"Preview as"** section is in the DOM: "Preview as", "Jack Uait (You)" (button, 1px solid rgba(28,19,1,0.11) border, radius 8px), "Checking access…", "Hide preview". It never rendered in this run.

### Levels, default, who it applies to

- Default shown in the UI: **"Inherit from database"**. Applies to: "all people, agents, and connections" (dialog copy). Exceptions default: "Everyone with full access" → "Full access".
- The level list itself was **not visible** (dropdown disabled on Free). Per a summarized fetch of the help page linked by "Learn more" (NOT seen in the UI; exact wording and order unverified), the levels are: Inherit from database, Can edit property & values, Can edit values only, Can view property only, Can view property & values, No access. Plan: Business or Enterprise.
- Changing a level as the owner: **UNMEASURED** (gated). Header indicator after a change: **UNMEASURED**. At rest, the "Text" header holds only its type glyph, label and a drag handle; no lock or other access glyph. Effects on other users: **UNMEASURED** (one-member workspace, nobody invited).
- Nothing changed, so nothing needed restoring.
- Correction to research-09: it said Property access is "offered on the Free plan". The entry is offered; the setting is not usable without Business.

## 8. Canvas card outline and builder backdrop (computed)

Builder opened from View settings > More settings > Customize page layout, no edits (`10-builder-clean.png`, `08-canvas-colors.json`). No onboarding tooltip showed this time (it showed on the first-ever open in research-09).
- **Builder backdrop**: the full-window wrapper (0,0 1512x717) has `background-color: rgb(249, 248, 247)`. It is the first non-transparent ancestor of the canvas card.
- **Canvas card** (x=24 y=60.4 w=1198 h=656.6, i.e. it runs off the bottom edge): `background: rgb(255,255,255)`, `border-radius: 12px 12px 0 0`, no border, no outline. The light-blue outline is a **box-shadow ring**: `rgb(206, 227, 247) 0 0 0 3px, rgba(15, 15, 15, 0.1) 0 9px 12px 0`.
- **Module card** (`.layout-content`, e.g. Heading 689x140): white, radius 8px. At rest the outline is a hairline `rgb(182, 212, 243) 0 0 0 0.5px inset`. Hovered (pointer over it, menu closed): `rgb(182, 212, 243) 0 0 0 1.25px, rgb(182, 212, 243) 0 0 0 1.25px inset`. Selected (menu open): a stronger blue 2px-looking ring in the screenshot (`12-module-selected.png`); its computed value was not read (UNMEASURED).
- **Module header strip**: 688x32, fill `rgba(35, 131, 226, 0.07)`, square corners. Label ("Heading", "Property group") 14px/500 `rgb(39, 131, 222)`. The "+" Add page module button: 32x32 circle (radius 9999px), fill `rgba(35, 131, 226, 0.07)`, glyph rgb(39,131,222).
- Clicking anywhere in a module selects it **and opens its "•••" menu at once** (`12-module-selected.png`).

## 9. Builder keyboard

- **Escape does not close the builder**, in every case tried:
  - No edits, focus on body: builder stays, no dialog.
  - No edits, focus on "Apply to all pages": builder stays; focus drops to a DIV.
  - A module's menu open: the first Escape closes the menu only; the module stays highlighted. A second Escape does nothing.
  - After an edit (Property icons OFF, unapplied): Escape does nothing. **No "Discard all layout changes?" dialog**, the edit stays (`14-escape-after-edit.png`). Only Cancel triggers the discard modal (research-09).
- **Tab order** from a blurred document (Notion elements only; a third-party browser-extension toast button was skipped):
  1. "Skip to content" link (off-screen, y=-31, shows on focus)
  2. "Preview: Alpha" switch
  3. Cancel
  4. Apply to all pages
  5. "More save options" (chevron)
  6. "No backlinks" (Heading module)
  7. "Action menu for module" (Heading •••)
  8. "Action menu for module" (Property group •••)
  9. "Add page module" (+)
  10. "Add a comment…" field, then "Attach file", "Mention a person, page, or date" (inside the Page discussions preview)
  11. "Action menu for module" (Page discussions), then (Content)
  12. "Hide sidebar" (») in the side panel, then "Add to panel"
  13. Page settings: Simple card, Tabbed card (117x80 buttons), "Inline comments Default", then the four `menuitemcheckbox` rows: Page discussions, Property icons, Full width, Database templates
  14. Wraps back to "Skip to content".
  - So the top bar's order is **Preview switch → Cancel → Apply → More save options** (the database title is not focusable). Module headers themselves are not tab stops; only their ••• buttons are. Property rows inside modules are not tab stops.
- **Focus ring** (all builder controls): `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px` plus `outline: 2px solid transparent`.

## 2. Tabbed structure (in the builder)

- **Structure cards** (Page settings > Structure): two 117x80 buttons, radius 6px, white. Unselected: ring `rgba(84,72,49,0.15) 0 0 0 0.5px inset`, label 12px/400 rgb(115,114,110). Selected: ring `rgb(39,131,222) 0 0 0 0.75px` + same inset, label 12px/**600** rgb(29,27,22). No tooltip on hover.
- **Switching to Tabbed** inserts a tab bar right under the Heading module, **outside any module** (no module header strip around it) (`20-tabbed-structure.png`). Everything below the Heading (Property group, "+", Page discussions, Content) now lives in the first tab. The Heading module stays above the tabs.
- **Tabs that exist by default: one, "Content"** (page glyph `page` 20px). Tablist 681x60 at y=228. Each tab is a 32px pill: padding 6px 12px, radius 20px, label 14px/500, no fill.
  - Selected tab: text rgb(44,44,43), ring `rgb(39,131,222) 0 0 0 1.25px` + inset (blue) when another tab exists; with only "Content", its ring was the light `rgb(182,212,243)` 1.25px (hover state at the time of reading).
  - Unselected tab: text rgb(125,122,117), ring `rgb(182,212,243) 0 0 0 0.5px` + inset.
- **Add a tab**: an "Add tab" button (28x28 circle, fill rgb(229,242,252), `plusSmall` 16px rgb(39,131,222)) sits 5px right of the last tab. It is **not in the DOM until the pointer is over the tab bar** (hover-only). Click opens a 270x36 menu with **one item: "Link existing data source"** (`viewTable` glyph) (`22-add-tab-click.png`).
  - Next step: a 290px picker, field "Link to a data source…" (focused), group "Existing data sources", one row per database in the workspace (title + parent page as a sub-line) (`23-link-data-source.png`).
  - Picking one: a form with a "View name" field (prefilled with the database name, selected), "View of: This database ›", "Add new relation" (switch, OFF) and an "Add view" button (`24-after-link-tab.png`). "Add new relation" was left OFF.
  - "Add view" adds a **second tab named after the view** ("Measure DB 2", `viewTable` glyph), selects it, and opens its **"View settings"** menu at once (`25-two-tabs.png`).
  - **What a tab holds**: a database view (a linked view of the chosen data source), not modules. In the builder it rendered as a table (Name, Date, Number columns; rows Gamma, Beta, Alpha) with Filter and Sort icons at the tab bar's right (`26-linked-view-tab.png`). No modules can be added into it from the "+" (none visible). The first tab ("Content") holds the page modules.
- **Tab menu** = clicking the already-selected tab:
  - On a view tab: the full "View settings" menu: name field, Layout (Table) · Property visibility (6) · Filter · Sort · Group · Conditional color · "Data source settings": Source (disabled) · Edit properties · AI Autofill · More settings · then **Duplicate view** · **Delete view** (`27-tab-click-selected.png`).
  - On "Content": a small "View settings" card with only a page glyph + name field "Content" (rename) and an (i). **No delete** (`30-content-tab-click.png`).
- **Remove a tab**: "Delete view" → modal **"Delete this view?"** with buttons **"Delete view"** (focused) and **"Cancel"**. Confirming removed the tab, selected "Content", and raised an alert/toast "Deleted Measure DB 2 view" (`29-after-delete-view.png`).
- **Simple ↔ Tabbed in the draft**: switching back to Simple removed the tab bar and showed the modules as before; the view tab did not show anywhere in Simple (`31-back-to-simple.png`). Switching to Tabbed again **brought the "Measure DB 2" tab back** (the draft keeps it).
- Side effect seen: after the Simple/Tabbed round-trip the Property group order changed from alphabetical (Date, Number, Person, Select, Text) to **Date, Text, Person, Select, Number**, the same order the Property access "For" switcher used.
- Apply: see 2b below. **Cancel / Discard with Tabbed changes: UNMEASURED** (Cancel was never clicked in this run).
- Hypothesis (unverified): "Delete view" showed a real confirm and a "Deleted Measure DB 2 view" toast, so adding or removing a view tab may write to the database at once rather than stay in the draft. Whether Cancel undoes it is unknown.

## 3. Add section (Property group menu)

- "+ Add section" (top-right of the Property group "•••" menu header). Click: a section **"New section"** is created **at the top of the group, and every existing property is placed under it**. A small rename popover opens at once over the menu row: a text input with "New section" **pre-selected** (181x20, 14px/400, no fill) + a **"Done"** button (51x28, fill rgb(39,131,222), text rgb(243,249,253) 14px/500, radius 6px) (`32-add-section.png`). Typing replaces the name; Done commits ("Details", `33-section-named.png`).
- A **second** "Add section" also lands **at the top**, and is **empty**. On the canvas an empty section shows a grey "Empty" line (14px rgb(161,158,153), 20px left padding). In the menu each section gets its own "+ Add a property" row (`34-two-sections.png`).
- Properties move between sections by dragging their row in the menu (dragged Number into "More") (`36-after-drag.png`).
- **Section header, canvas**: a full-width button (664x34, radius 6px, padding 0 6px) holding the name 13px/500 rgb(125,122,117) + `arrowChevronSingleDownFillSmall` 14px, fill rgb(173,169,163). Gap above the next section ≈ 20px.
- **Section header, menu**: 270x24 button, `dragHandleFillSmall` 16px rgb(142,139,134) + name 14px/500 rgb(125,122,117). Clicking it opens: **Rename** (`pencilLine`) · **Move down** (`arrowStraightDown`; only "down" was offered for the top section) · **Delete** with sub-line **"No properties will be deleted"** (`trash`) (`38-section-row-click.png`).
- **Folding in the builder: no.** Clicking a section header on the canvas opened the module menu instead; the section stayed open (`39-fold-in-builder.png`). Row-page rendering and folding: see 2b.

## 7. The Pinned list's own "+ Add a property" (Heading module menu)

- With **zero pins**, the Heading menu already shows "Pinned properties" (header + "+ Add a property" only), "Unpinned properties" (all 5) and **"Options > Property labels" (switch ON)** (`40-heading-menu.png`). Correction to research-09: "Options" is there before the first pin.
- Click "+ Add a property": the same add-property popover as the Property group's (icon button + "Property name" field focused, "AI Autofill" Summarize/Translate with "Basic" tags, then "Type 🔍" list: Text, Number, Select, Multi-select, Status, Date, Person, Files & media, Checkbox, URL, Email, Phone, Formula, Relation, Rollup, Created time, Created by, Last edited time, Last edited by, Button, Place) (`41-pinned-add-property.png`).
- Typed "Pinned Prop", picked Checkbox. **The new property lands pinned**: it is the first row of "Pinned properties" with a solid pin (aria "Do not show Pinned Prop as pinned"), it appears in the strip under the title ("Pinned …" truncated label + an empty checkbox), and it is **not** added to the Property group (`42-after-pinned-add.png`).
- After picking the type, a compact edit card opens beside the row: icon button + name field (text pre-selected) with (i), **Type › Checkbox**, **Property access**. (No AI Autofill / Duplicate / Delete there.)
- Escape on that card turned it into a property context menu: **Rename · Edit property · Add to layout · Duplicate property · Delete property** (`43-three-pinned-labels-on.png` was retaken after closing it). "Add to layout" was not clicked.
- The table view did not show a "Pinned Prop" column in the first screen after Apply (columns Name, Text, Number, Person, Select, Date visible; further columns off-screen, not checked).

## 4. "Property labels" OFF (Heading module menu)

Pinned: Pinned Prop (checkbox), Date, Select, all empty.
- **Labels ON** (builder): the strip is a flex row (660x54, column gap 8px). Each item is a column: label row (16.8px masked type icon + name 13px/500 rgb(125,122,117)) above a 30px value box (padding 4-5px 6px, radius 4px). Empty values read "Empty" 14px rgb(161,158,153). Item widths: Pinned Prop 100px, Date 80px, Select 80px. Heading module height 204px.
- **Labels OFF** (`44-labels-off-builder.png`): the label row is gone; the strip is one 30px row and the Heading module shrank to 180px.
  - **An empty value shows its type icon + property name as a placeholder**, 14px/400 rgb(161,158,153) (icon 16.8px masked, same grey): "📅 Date", "⌄ Select". Cell 80x30, padding 0 6px, radius 4px.
  - The empty checkbox shows only the box (16x16, radius 3px). There is no name next to it, so an unchecked checkbox has no visible name.
  - A **filled** value shows the value only, no icon, no name: Date "October 13, 2026" 14px/400 rgb(44,44,43) (row page, `55-labels-off-filled.png`).
  - Hovering a label-less value showed no tooltip (1.5s hover).
- On the row page (side peek) the strip renders the same: checkbox, "📅 Date"/value, "⌄ Select" placeholder, with no labels (`51-alpha-peek-after-apply.png`).

## 2b/3b. After Apply: Tabbed + sections on the row page

Applied: Tabbed (Content + "Measure DB 2" view tab), sections More (Number) and Details (Text, Person), 3 pins, labels OFF.
- Apply closed the builder and returned to the database; **no row was opened** (launched from the database menu).
- Row page (Alpha, side peek, `51-alpha-peek-after-apply.png`): title, label-less pinned strip, then the **tab bar** (tablist 596x60), then the Content tab body: sections, Comments, then the empty-page prompt.
  - Row-page tabs differ from the builder's: **no ring**. Selected tab: fill `rgba(33,27,23,0.05)`, text rgb(44,44,43). Unselected: no fill, text rgb(125,122,117). Both 32px pills, radius 20px, padding 6px 12px, 14px/500, glyph 20px.
  - The view tab ("Measure DB 2") holds the **whole linked database**: table (Name, Date, Number…), all 3 rows (Gamma, Beta, Alpha), Filter / Sort / Search icons and a **New** split button at the tab bar's right. It is not filtered to the current row (`54-row-view-tab.png`).
- **Sections on the row page**: header button 602x34 (radius 6px, padding 0 6px), name 13px/500 rgb(125,122,117) + 14px `arrowChevronSingleDownFillSmall` (fill rgb(173,169,163)). Each section ends with its own "+ Add a property" row. Gap between sections ≈ 20px.
- **Folding works on the row page**: a click on the header collapses the section: its rows and its "+ Add a property" vanish, and the chevron turns to point right (the chevron's wrapper gets `transform: matrix(0,-1,1,0,0,0)`, i.e. −90°). No count or summary is shown when folded (`53-section-folded.png`). `aria-expanded` is not set on the header button.
  - The folded state **carried over to another row** (Beta showed More folded) and **survived a reload**. Where it is stored (per user, per layout) was not determined.

## 6. "Database templates" ON vs OFF (empty row page)

Option in Page settings > Options, default ON. (i) copy (research-09): "If enabled, empty pages will show the template picker."
- The builder canvas does **not** change when it is toggled (the Content module still reads "Empty").
- **ON, database has no templates** (Alpha, side peek, `51-alpha-peek-after-apply.png`, `65-alpha-after-reset.png`): below the page header, one line: **"Press ‘enter’ to continue with an empty page, or create a template"**. Line box 604x56 (padding 8px top, 24px bottom, 8px start), 16px/400, line-height 24px, color `var(--c-texTer)` = rgb(161,158,153), cursor text. "create a template" is a `role=button` (126x24), same grey, **underlined**, cursor pointer.
  - Clicking "create a template" opens a new template in a center modal with a yellow banner **"You're editing a template in [Measure DB 2] (?)"** and a **"Duplicate every…"** dropdown; title placeholder "New page"; sidebar Recents lists it with a grey "Template" tag (`66-create-template-click.png`).
- **ON, database has 1 template** ("Tmpl A"; Beta, side peek, `67-beta-with-template-picker.png`): the line becomes **"Press ‘enter’ to continue with an empty page, or pick a template (use ‘↑’ and ‘↓’ to select)"** (wraps to 2 lines at 604px), followed by a list:
  1. "Tmpl A" (`pageEmpty` 20px + name)
  2. "Empty" (`pageEmpty` + "Empty")
  3. "+ New template"
  - Rows: 604x32 buttons, radius 4px, padding 3px 2px 3px 8px, text 16px/400 rgb(125,122,117), no fill at rest.
- **OFF, no templates** (Gamma, `61-gamma-templates-off.png`) and **OFF, with "Tmpl A"** (Gamma, `70-gamma-templates-off-with-template.png`): **no prompt and no picker**. The body below the header is blank.
- Keyboard use of the picker (Enter / ↑ / ↓) was not exercised: UNMEASURED.

## 5. "Reset to original page layout"

- Where: Apply split button > chevron "More save options" > one item **"Reset to original page layout"** / sub-line **"No properties will be deleted"** (254x56 at x=1242 y=50; `arrowUTurnUpLeft` icon; title 14px rgb(44,44,43), sub-line 14px rgb(125,122,117)) (`62-more-save-options.png`).
- **It has a confirm** (`63-after-reset-click.png`): modal 300x226, white, radius 12px, centered:
  - `arrowUTurnUpLeft` glyph at the top (grey).
  - Title **"Reset to original page layout?"** 17px/600 rgb(44,44,43).
  - Body **"No properties will be deleted."** 14px/400 rgb(125,122,117).
  - **Reset**: 260x32, fill rgb(229,100,88), text white 14px/500, radius 6px. **Cancel**: 260x32, no fill, text rgb(125,122,117). Close (x) 22x22 circle top-right, fill rgba(55,53,47,0.06).
- **Reset applies at once and closes the builder** (no Apply step); it returns to the database (`64-after-reset.png`).
- What it reset, compared with the layout applied before (Tabbed + view tab, 2 sections, 3 pins, labels OFF, templates OFF):
  - Structure → **Simple**; no tab bar on the row page.
  - Pins → none; sections → none; one flat Property group.
  - Property labels / pinned strip → gone with the pins.
  - Database templates → **back ON** (the "create a template" prompt returned).
  - Property icons, Page discussions, Full width stayed at their defaults (they were default before too, so this does not show whether Reset touches them).
- What it kept:
  - **"Pinned Prop" (created inside the builder) survived** as a normal property, listed first. Its value column and the Date value on Alpha were kept.
  - Property group order after Reset: **Pinned Prop, Date, Select, Number, Text, Person** (`65-alpha-after-reset.png`, `68-builder-after-reset.png`). This matches the old pin order followed by the old section order. It is not alphabetical and not the table's column order.
  - Whether the linked view created for the deleted tab still exists anywhere was not checked: UNMEASURED.
- In the classic (reset) layout the row page shows a 1px divider under Comments, above the body (`65-alpha-after-reset.png`).

## 10. Details panel on a full page

Setup: builder > Property group "•••" > "Move to panel" (`69-group-moved-to-panel.png`; the Heading module gains a "View details" line, the side panel holds the group). Applied. Page: Gamma, full page (`/p/<id>`), sidebar open, Full width OFF.
- **Two controls open/close it**:
  - Under the title: a text button **"View details"** (closed) / **"Hide details"** (open). 28px high (93.6 / 92.3 px wide), padding 0 8px, radius 6px, 14px/400 rgb(142,139,134), no fill.
  - Top bar: an icon button **aria-label "Page info"** (`sidebarRight` glyph, 28x28, radius 6px) between Copy link and Favorite. It was absent from the row page's top bar before "Move to panel" (`51-alpha-peek-after-apply.png`) and present after (`70-gamma-templates-off-with-template.png`, `71-gamma-full-page.png`). When the panel is open it has a fill `color(srgb 0.129 0.106 0.090 / 0.051)`; closed: no fill. It toggles the panel both ways. No tooltip appeared on a 1.2s hover.
  - Inside the panel: **"Close panel"** button, 24x24 circle (radius 9999px), `arrowChevronDoubleForward` glyph, at the panel's top-left (x=1137).
- **Width: 385px** (panel column x=1128 → window edge; content padding 0 16px 16px 20px), white, under the top bar (y=44, h=673). Header "Properties" 13px/500 rgb(125,122,117). Rows: Pinned Pr… (truncated), Date, Select, Number, Text, Person, "+ Add a property" (`72-details-open-full.png`).
- Page column with the panel open: h1 moves from x=531 w=720 to **x=366 w=665**.
- **Does not remember being open:**
  - Open on Gamma → breadcrumb to the database → browser Back to Gamma: closed ("View details").
  - Open on Gamma → sidebar to Beta (full page): Beta opened closed.
  - Open on Beta → reload: closed.
- Side note: with the group in the panel, the page's main column shows the Comments box with **no "Comments" label** (avatar + "Add a comment…" directly under "View details") (`71-gamma-full-page.png`).

## Teardown

- The scratch page "Blok measure scratch 2 2026-10-13" (id 3f7c2586eb6d8059ba70d9b0ff48c78e, holding "Measure DB 2", its rows Alpha/Beta/Gamma and the template "Tmpl A") was moved to Trash via its own "•••" (Actions) > "Move to Trash". Notion then navigated to the user's "New database" page, which still reads "Edited 2d ago" (not touched).
- Sidebar check after trashing: the sidebar text contains none of "Blok measure scratch 2", "Measure DB 2", "Tmpl A", "Alpha", "Beta", "Gamma". The Private section starts at "Полугодовое ревью" (`80-after-trash.png`). Trash was not emptied.
- No viewport emulation was used in this run (1512x717 throughout). No workspace settings, sharing, plan or members were touched. "Upgrade now" was never clicked.
- The extension relay hung once during teardown. The session was closed and re-opened under the same name (`-s=notion-measure2`), then closed at the end. Unverified: the hung first attachment may have left an extra Notion tab open in the user's browser.
