# Research 09: Notion row-page layout builder (measured)

Measured 2026-10-12 in the user's signed-in Chrome via `playwright-cli --extension`, on app.notion.com.
Workspace: "Personal". Viewport 1512x717 (CSS px). Light theme.
Scratch: private page "Blok measure scratch 2026-10-12" holding full-page database "Measure DB" (created via `/database` > "Database - Full page" > "New empty data source").
Screenshots: this folder (`NN-*.png`).

Important framing fact: in this Notion build the builder is a **full-window takeover**, not a bar inside a peek.
It has its own top bar (title + "Preview:" switch + Cancel + "Apply to all pages"), a page canvas on the left, a side panel column, and a "Page settings" column on the right.

## 1. Entry point: database menu > More settings > Customize page layout

- Entry is the view **"Settings"** button (sliders icon, aria-label "Settings") in the database view toolbar, next to "New". It opens a "View settings" menu. There is no "•••" glyph on that button in this build.
- "View settings" top level (in order): Layout (Table) · Property visibility (1) · Filter · Sort · Group · Conditional color · Copy link to view · section "Data source settings": Source (Measure DB, disabled) · Edit properties · Automations · AI Autofill · Turn into · More settings · then Manage data sources · Lock database.
- **"Customize page layout" is NOT at the top level. It is nested under "More settings".** (`01-view-settings-menu.png`, `01b-more-settings.png`)
- "More settings" submenu: 4 items, in order: Sub-items, Dependencies, Connections, **Customize page layout** (last, 4th).
  - Submenu box: x=1158 y=528.3 w=250 h=123 (opens to the side of "More settings" row which sat at y=651).
  - Each item: 242x28. Label 14px / weight 400 / line-height 16.8px / color rgb(44,44,43).
  - Icon: 20x20 svg, class `layout`, viewBox 0 0 20 20, fill inherit (computed rgb(56,56,54)). Shape: a tall rounded rect on the left + a square top-right (+ a square bottom-right; path starts `M3.3 4.825c0-.842.683-1.525 1.525-1.525h3.15…`).
  - Every item in the submenu, "Customize page layout" included, carries a trailing 16x16 chevron-right (`arrowChevronSingleRightSmall`), even though "Customize page layout" opens no submenu.
  - Sibling icons: Sub-items = `listToggleIndent`, Dependencies = `arrowTurnDownRight`, Connections = `integration`; "More settings" itself = `ellipsis` 20x20.
- Click result: the builder opens **full window** (URL unchanged: `/p/<db>?v=<view>`, title "Measure DB | Notion"). The database is replaced by the builder; the sidebar is gone.
- **Zero rows:** the builder still opens. It previews a placeholder page named "New page" (heading shows the grey placeholder "New page", "No backlinks", Property group "Empty", Content "Empty"). Top bar says "Preview: New page". Opening the preview switch with zero rows shows a "Search pages…" field and "No results." (`02-builder-zero-rows.png`, `03-preview-menu-zero-rows.png`).
- First open shows an onboarding tooltip (dark card) pointing at the "+" (Add page module) button: title "Start creating your layout", body "Click the (+) icon to add to the page", with a close (x) button.

## 2. Page preview switch

- Position: in the builder's top bar, centered under the database title. Title "Measure DB" (16px / 500, rgb(44,44,43)) at y=8, h=24, preceded by a database glyph. Below it the switch at x=685 y=32 w=141.8 h=20.4 (centered in the 1512px window).
- Control type: a text button `"Preview: <page name>"` + 14px chevron-down (`arrowChevronSingleDownSmall`). Padding 3px 6px, radius 6px, no fill at rest. "Preview:" and the page name are both 12px / 500, color rgb(125,122,117).
- Opens a popover (x=697 y=54 w=300 h=148 with 3 rows) holding a "Search pages…" text field (autofocused) and a menu of the database's pages. Each row 292x28, `pageEmpty` page icon + title; the current page carries a trailing `checkmarkSmall` (no fill, neutral). First row had keyboard-hover fill `color(srgb 0.129 0.106 0.090 / 0.051)`.
- Pages offered: every row of the database (3 here). Order shown: Gamma, Beta, Alpha (rows were created Alpha, Beta, Gamma; the view shows Alpha, Beta, Gamma). So the list is newest-created first in this sample.
- Default page: with rows, the builder opened on **Alpha** (first in view order AND oldest created; this sample cannot tell those two apart). With zero rows: a placeholder "New page", and the popover shows "No results." (`05-preview-menu-rows.png`).
- Switching: picking "Beta" swaps the canvas to Beta (h1 "Beta", "Preview: Beta"). URL unchanged.
- **Unapplied edits survive a switch.** Turned "Property icons" off on Alpha (not applied), switched to Beta: the switch stayed off and Beta's property rows also had no icons (`06-property-icons-off.png`, `07-after-switch-to-beta.png`).

## Builder anatomy (context for items 3–10)

Measured at 1512x717 with 16 properties and 3 rows (`04-builder-with-rows.png`).
- Left: page canvas (rounded card with a light blue outline, visual only, not measured) holding **modules** stacked vertically: **Heading** (no drag handle; holds "N backlinks" line, the title, and pinned properties), **Property group** (drag handle ⠿), a round "+" "Add page module" button between modules, **Page discussions** (⠿), **Content** (⠿). Each module has a light-blue header strip with its name in blue, and an "Action menu for module" "•••" button at the header's right that appears on hover/selection.
- Middle: the side panel column: a "»" "Hide sidebar" button and a pill "+ Add to panel" button (empty panel).
- Right: "Page settings" column: "Structure" (two thumbnail cards: **Simple** (selected by default, blue 2px outline, bold label) / **Tabbed**), then "Options": Inline comments (value "Default" + chevron), Page discussions (switch, ON), Property icons (switch, ON), Full width (switch, OFF, (i)), Database templates (switch, ON, (i)).
  - (i) tooltips (hover): Full width: "Page width can be overwritten on individual pages." · Database templates: "If enabled, empty pages will show the template picker."
  - Switches: 30x18 checkbox inputs with role=switch, ON = blue fill.
- The property list in the Property group is alphabetical by name in this sample (Checkbox, Created time, Date, …, URL), not table column order.
- There is **no "Backlinks" option** anywhere in Page settings in this build. The heading module shows the backlinks line itself ("↙ No backlinks").

## 3. Pinned / Unpinned lists, 📌, "Add a property"

- The "Pinned properties" / "Unpinned properties" lists live in the **Heading module's "•••" menu** (not in the Page settings column). (`17-heading-module-menu.png`)
  - Popover: x=761 y=88 w=290 h≈502 (max; scrolls). Header "Heading" 12px/500 rgb(125,122,117). Then a "Search properties…" field (autofocused). Section labels "Pinned properties" / "Unpinned properties" 12px/500 rgb(125,122,117).
  - Rows: **28px** high, 274px wide. Type glyph on the left (16-20px, dark), name 14px rgb(44,44,43). Hovered row shows a ⠿ drag handle in place of the type glyph and a hover fill.
  - 📌 control: 24x24 button at the row's right edge (x=1011), 16px glyph. Unpinned rows: outline `pin` (renders visibly lighter grey), aria-label "Show <Name> as pinned". Pinned rows: solid `pinFill`, aria-label "Do not show <Name> as pinned". Always visible (not hover-only). Computed fill rgb(56,56,54) on both.
  - Clicking 📌 moves the row between the lists **immediately** (pinned list grows in click order: Status, Select, Date, …). The canvas updates live: the pinned property appears under the title in the Heading module with a small label above its value, and **disappears from the Property group** (group kept only the 3 unpinned: Builder Prop, Formula, ID). (`18-after-first-pin.png`, `19-many-pinned.png`)
  - After the first pin, an "Options" section appears at the bottom of this menu with **"Property labels"** (switch, ON by default).
  - "Add a property" sits at the end of the Pinned list: 274x34, `plusFillSmall` + text 14px, both grey rgb(125,122,117).
- Property group "•••" menu (`09-property-group-menu.png`): header "Property group" + "+ Add section" (12px, rgb(142,139,134)), "Search properties…", one 28px row per property with a 👁️ button (24x24), "+ Add a property" (274x34, plusFillSmall, text rgb(44,44,43)), divider, "→ Move to panel".
- "Add a property" flow (from the Property group menu, `14-add-a-property.png`, `15-after-add-property.png`): opens a 290px-wide popover with a "Property name" field (focused) + type icon button, an "AI Autofill" section (Summarize, Translate — "Basic" tags), then "Type" list (Text, Number, Select, Multi-select, Status, Date, Person, Files & media, Checkbox, URL, Email, Phone, Formula, Relation, …). Picking a type adds the property to the draft at once (it is discarded on Cancel, see 3b) and switches to its edit panel (name field, Type, **Property access**, type options such as Number format / Decimal places / Show as Number·Bar·Ring). The new property ("Builder Prop", Number) appeared at the **top** of the Property group. The Pinned list's own "Add a property" was never clicked: that flow, and whether its new property lands pinned, is UNMEASURED.

### 3b. Cancel and properties created in the session

- Cancel with no edits (zero-row run): closed straight away, no dialog.
- Cancel after edits: modal "Discard all layout changes?" (324x145, radius 12px, title 16px/600). Buttons stacked, each 284x32, radius 6px: **Discard** (fill rgb(229,100,88), text rgb(253,246,246)) and **Cancel** (no fill, 1px solid rgba(28,19,1,0.11) border, text rgb(44,44,43)). (`27-after-cancel.png`)
- After **Discard**: the property "Builder Prop" created inside the builder was **gone**. Table headers did not list it. View settings said "Property visibility 16" (same as before). The row page showed no Builder Prop. **So Cancel does NOT keep a property created during the session.** The page's "Edited" stamp stayed "Edited 14m ago".
- Top-bar "More save options" (the chevron half of the Apply split button) holds one item: **"Reset to original page layout"**, sub-line "No properties will be deleted" (`24-more-save-options.png`).
- Add page module "+" popover (`22-add-page-module.png`): title "Add to page"; "Use an existing property" (Files & media, Number, Builder Prop, Text, More) and "Create new property" (Files & media, Number, Text, Person, Select, More). "+ Add to panel" opens the same list titled "Add to panel" (`23-add-to-panel.png`).

## 5. 👁️ per property

- Where: in the **Property group module's "•••" menu**, one 👁️ button per property row (24x24, 16px glyph, x=1011). Pinned properties are not in that list; they live in the Heading menu.
- Click opens a 3-item menu (180x94 popover; rows 172x28):
  1. **Always show** — `eyeFill`
  2. **Hide when empty** — `eyeSlash`
  3. **Always hide** — `eyeClosed`
  The menu had **no checkmark** on the current state (only the hover fill on the first row). The current state shows only through the row's 👁️ glyph: `eyeFillSmall` (Always show), `eyeSlashSmall` (Hide when empty), `eyeClosedSmall` (Always hide, drawn lighter). (`10-eye-click.png`, `11-text-always-hide.png`)
- The canvas updates **immediately** (before Apply): "Text" set to Always hide left the group, and a "1 more property" disclosure appeared at the group's bottom. After "Number" went to Hide when empty (its value was empty) it read **"2 more properties"**. Disclosure: `arrowChevronSingleDownFillSmall` + text 14px rgb(161,158,153), box 145x34. Clicking it in the builder did **not** expand it.
- What it writes: these are **layout states, not committed until Apply**. After Cancel > Discard, the row page (side peek) showed Text and Number again, as ordinary visible rows (`29-row-side-peek-default.png`). Whether Apply writes into the property's classic per-page visibility: see 5b below.

## 8. Property icons (measured inside the builder)

- Option: "Property icons" switch in Page settings > Options. **Default ON.**
- Turning it OFF in the builder removed the icons immediately from the **Property group rows** and from the **pinned strip under the title** (both checked). The builder's own menus (Heading / Property group "•••" lists, "Add to page" list) kept their type glyphs regardless (`06-property-icons-off.png`, `09-property-group-menu.png`).
- Rendering: icons are CSS-masked divs, `mask: url(/icons/<name>.svg?mode=light)`, `background-color: var(--c-icoSec)` = rgb(142,139,134).
  - Pinned strip: 14x14 box with `transform: scale(1.2)` (16.8px), label 13px/500 rgb(125,122,117), gap 2px. On hover the icon cross-fades (opacity, 150ms) to a ⠿ `dragHandleFillSmall` glyph.
  - Property group rows: 16px box at scale 1.2 (19.2px), label 14px rgb(125,122,117).
- Glyph per type (mask file name): Status `burst_gray` · Select `arrow-circle-down_gray` · Date `calendar_gray` · Person `friends_gray` · Multi-select `list_gray` · Number `hashtag_gray` · Email `username_gray` (an @) · Phone `phone-call_gray` · URL `link_gray` · Created time `clock_gray` · Checkbox `checkmark-square_gray` · Files & media `attachment_gray` (paperclip) · ID `numero_gray` (№). Formula (Σ) and Text (≡ lines) are seen in screenshots (`04-builder-with-rows.png`) but their file names were not read (they were hidden at measure time): UNMEASURED file names. Types never created in this run, so their glyphs are UNMEASURED: Relation, Rollup, Button, Place, Last edited time, Created by, Last edited by.
- Panel scope: with icons ON, the Property group moved to the side panel kept its icons, both in the builder and on the real page ("№ ID", `50-builder-group-in-panel.png`, `55-alpha-full-page-details-open-override-off.png`). Panel with icons OFF: UNMEASURED.

### 5b. After Apply ("Apply to all pages")

Applied: 12 pins, Text = Always hide, Formula = Hide when empty, everything else default. Apply closed the builder and returned to the database, with the row (Alpha) open in side peek (`33-after-apply.png`).
- The row page's Properties section (titled **"Properties"**, 13px label) showed only ID plus a **"2 more properties"** disclosure (chevron-down + grey text).
- Clicking it expands **in place**. The hidden rows merge into the list in the same order (Formula, ID, Text). They use the same style as shown rows: 34px row, label 14px rgb(125,122,117), opacity 1, no dimming. Below them: "+ Add a property", then "^ Hide 2 properties" (`36-row-hidden-expanded.png`).
- What it writes (observation): on the row page, Text's own property menu (Rename · Edit property · **Property visibility** · Duplicate property · Delete property · **Customize layout**) > "Property visibility" listed Always show / Hide when empty / **Always hide ✓** (checkmarkSmall). So the row page's per-property visibility menu shows the value the builder set; the two surfaces show one value. Whether that value is stored on the property or on the layout was not determined. Before Apply it is a draft, and Cancel > Discard throws it away (5 above). (`38-row-text-visibility-submenu.png`)
- The table view still showed the "Text" column after Apply. The page-layout visibility does not touch the view's own column visibility.

## 1b. Other entry points (found while measuring)

- Row page "•••" (Actions) menu, in order: style row (Ag Default / Serif / Mono), Copy link, Copy page contents, Duplicate, Move to, Move to Trash, Small text (switch), Full width (switch), Table of contents (switch, ON), **Customize layout**, Lock page (switch), Use with AI, Suggest edits, Translate, Import, Export, Updates & analytics, Version history, Notify me, Connections. The label there is **"Customize layout"**, not "Customize page layout".
- A property's menu on the row page also ends with **"Customize layout"**.
- Clicking "Customize layout" from Alpha's row menu opened the builder with "Preview: Alpha". Clicking the title-hover "Customize layout" on **Beta** (full page) opened it with **"Preview: Beta"**. So launched from a row page, the builder previews **that page**. Launched from the database menu, it opened on Alpha every time (3 opens). Alpha is the first row in view order and also the oldest.

## 4. Pinned overflow arrows (row page, side peek, outside the builder)

- **Inside the builder there are no arrows.** The pinned strip only has a 100px white fade at its clipped edge (`linear-gradient(90deg, #fff 0%, transparent 100%)`). In the builder, a mouse wheel over the strip did not scroll it (`20-pinned-strip-hover.png`).
- On the real row page (side peek, peek content width 600px, strip scrollWidth 1282):
  - Buttons: `aria-label` "Scroll to previous pinned properties" / "Scroll to next pinned properties". **32x32**, radius 6px, no fill and no border. Glyph `arrowChevronSingleLeft/Right` **20px**, fill rgb(142,139,134) at rest and rgb(56,56,54) on hover. No hover background.
  - Position: vertically centered on the 54px strip (button top = strip top + 11). Prev at x=830 (4px left of the strip's left edge at 834). Next at x=1406 (right edge 1438, strip right edge 1434).
  - **Not hover-only.** Each arrow shows whenever the strip can scroll that way. With the mouse away from the strip: prev opacity 0 / visibility hidden (at scrollLeft 0), next opacity 1 / visible. Transition `opacity 0.1s ease-in, visibility 0.1s ease-in`.
  - A 100px edge fade sits on each side that still has hidden content (`linear-gradient(270deg, #fff…)` at the right, `90deg` at the left).
  - **Scroll step: 400px per click.** next: 0 → 400 → 682 (clamped to max = 1282-600; the next arrow then hides). prev: 682 → 282 → 0 (prev hides). `scroll-snap-type: none`.
  - Shown on every row page that overflows, outside the builder. The next arrow was logged on all three rows and all three surfaces:
    - Side peek: Alpha and Beta, x=1406, visible.
    - Center peek: Alpha, Beta, Gamma, x≈1079-1080 (visibility "visible" logged for Alpha and Beta).
    - Full page: Beta (Full width ON) x=1386; Alpha (page override OFF) x=1221; x=1001 with the details panel open.

## 6. Backlinks

- **There is no Backlinks option in this builder.** Page settings has no backlinks row. The Heading module's "•••" menu has only Pinned / Unpinned properties + Options > Property labels. Clicking the backlinks line inside the builder only selected the Heading module and opened that menu.
- "{#} backlinks" sits **above the title, inside the Heading module**, at the far left. In the builder it shows `arrowDiagonalDownLeftSmall` (≈8.7px) + text: "No backlinks" with zero, "1 backlink" with one. Button 94x28, padding 0 8px, radius 6px, 14px/400, rgb(161,158,153). In the builder it is always shown, above the h1 (h1 top = button bottom).
- On a real row page (full page, Alpha with 1 backlink from a mention in Beta's body):
  - Hidden at rest (opacity 0). On **hover of the title area** it fades in as the first item of the hover row: **"↙ 1 backlink" · "Add icon" (`emojiFaceFill`) · "Add cover" (`photoFill`) · "Customize layout" (`layoutFillSmall`)**, each 28px high, at y=124 (title h1 at y=156) (`42-alpha-title-hover.png`).
  - Click opens a popover "Linked to this page", listing "Beta — Blok measure scratch…/Measure DB" (`43-backlink-click.png`).
  - Zero backlinks on a real row page: UNMEASURED. The only zero-backlink check was in side peek, and that same side-peek check also found nothing when Alpha had 1 backlink. In the builder, zero shows "No backlinks".
  - Peeks: the first side-peek check found no "/backlink/" element on Alpha (before and after a reload). A later center-peek check did find "1 backlink" (plus Add icon / Customize layout) at y=148, above the title, with opacity 0. A synthetic mouse hover over the title in center peek did not reveal it. So the button is present in peeks, and the hover reveal there is UNMEASURED.
- "Customize layout" in that title-hover row is one more entry point to the builder.

## 7. Comments options

- **Page discussions**: a switch, **default ON**. ON gives a "Page discussions" module in the canvas, which renders as a "Comments" label (13px/500, rgb(125,122,117)) + avatar + "Add a comment…" under the properties. Switching it OFF in the builder removed the module **at once** (before Apply) (`25-page-discussions-off.png`).
- **Inline comments**: a row with value + chevron that opens a 2-option menu: **Default ✓** / **Minimal**. The current choice has a trailing ✓ and no fill. **Default = "Default".** (`16-inline-comments-menu.png`) The builder canvas does not show the difference (`58-builder-minimal-comments.png`).
- On a real row page (full page, Beta, one inline comment "inline note" on the text "Comment target text"):
  - The commented text gets a 2px solid rgba(255,203,0,0.35) underline and an rgba(255,203,0,0.12) fill (computed in Default mode; Minimal looks the same in the screenshot only).
  - **Minimal**: only a count chip in the right margin. Button `aria-label` "1 comment", 40x24, radius 6px, no fill. `commentFilledSmall` 16px glyph, fill rgb(142,139,134). The number "1" is 12px, rgb(161,158,153). At x=1251 on the same line as the text, page h1 at x=531 w=720 (`59-beta-minimal-comments.png`).
  - **Default**: the full comment card shows in the right margin: 308x74, 1px solid rgba(42,28,0,0.07) border, radius 10px, white, holding avatar + "Jack Uait 1m" + "inline note" (14px). The **page column shifts left** to make room: h1 x=402 (vs 531 in Minimal), same 720 width (`60-beta-default-comments-fw-off.png`).
  - When the margin is too narrow, Default also showed only the count chip ("1 comment" 40x24 at x=1031). This was with the details panel open and Full width ON (`57-inline-comment-default.png`).

## 9. Full width

Layout "Full width" switch: default OFF. (i) "Page width can be overwritten on individual pages." Turning it on in the builder **did not change the builder canvas** (h1 stayed 664px wide).

Measured at 1512x717, sidebar open, details panel closed unless stated:

| Surface | Full width OFF | Full width ON |
|---|---|---|
| Full page (Beta) | h1 x=531, w=720 | h1 x=366, **w=1050** |
| Center peek (960x573 modal at 276,72) | h1 x=402, w=707 (Gamma) | h1 x=402, w=707-708 (Beta, Alpha) |
| Side peek (756 wide at x=756) | h1 x=832, w=604 (before any FW change) | h1 x=832, w=604 (Beta, Alpha) |

- So at these sizes only the full page changes. In both peeks the content width did not move.
- **Page-level override:** with the layout at Full width ON, Alpha's own "•••" menu showed "Full width" switched ON (inherited). Switching it OFF there narrowed Alpha's full page back to x=531 / w=720, while Beta stayed at 1050. **The page's own Full width overrides the layout.**
- **Details panel:** after "Move to panel" on the Property group, row pages show a "View details" / "Hide details" link under the title (14px, rgb(142,139,134)). The panel starts closed on full page and in center peek.
  - Full page, panel open: a 385px column docked to the **window's right edge** (x=1127, full height, border-left 1px solid rgba(42,28,0,0.07)), with "Properties" (13px/500) and a "Close panel" button. Content then sits at h1 x=366, w=665. This was the **same for Beta (FW ON) and Alpha (page override OFF)**, so the panel does not move with Full width.
  - Center peek, panel open: a 280px column inside the modal (x=956, border-left 1px solid rgb(240,239,237)). Content h1 x=352, w=528 (`53-beta-center-peek-details-open.png`).
  - The details panel started closed on every navigation measured (Alpha center peek, Beta full page after Beta's center-peek panel had been opened, Alpha full page). It does not appear to persist.

## 10. Builder top bar

There is no "Customizing page layout" bar in this build. The builder is a full-window takeover, and its top bar is:
- Height **60.4px** (banner y=0). Inner row starts at x=16, y=8 (h 44.4), i.e. 16px side padding and 8px top. The bar itself has no background, border or shadow (computed transparent). The screenshot shows a light warm-grey backdrop around the canvas; its color value was not read (UNMEASURED).
- Center: database glyph + title "Measure DB" (16px/500, rgb(44,44,43)), and below it the "Preview: <page>" switch (12px/500, rgb(125,122,117)).
- Right: **Cancel** = `xMarkSmall` (≈9.7px) + "Cancel", 86x32, padding 0 12px, gap 8px, radius 6px, no fill, 14px/400 rgb(44,44,43). **Apply** split button: "✓ Apply to all pages" 155.5x32, padding 0 8px, radius 6px 0 0 6px, fill rgb(39,131,222), text rgb(243,249,253) 14px/500, `checkmarkSmall` 16px. Chevron half "More save options" 24x32, radius 0 6px 6px 0, inset 1px left shadow rgba(28,19,1,0.11). Gap between Cancel and Apply ≈ 8px (1308.4 → 1316.5).
- "Page settings" column: x=1222, 290 wide, title 16px/500.
- Narrow widths (viewport emulated through CDP `setViewportSize`, then reset to 1512x717):
  - **756px (side-peek width):** nothing wraps. Bar stays 60.4 high; Cancel and Apply keep 86 / 155.5 px and one line ("Apply to all pages" label h=20). The title block re-centers (x=345). The side panel column collapses to a "«" button (`66-builder-topbar-756.png`).
  - **600px:** still no wrap, but the centered title/preview **overlaps Cancel** (title spans 267–357, Cancel starts at 310). The Page settings column is clipped at the right edge (`65-builder-topbar-600.png`).

## Other checks

- **Property access**: yes. The table column header menu (on "Text") lists, in order: Property name field, **Property access**, Change type, AI Autofill, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property (`63-column-header-menu.png`). It also appears in the property edit panel opened from the builder.
- **Plan**: the workspace switcher (read only, not Settings) shows "Personal — **Free Plan** · 1 member" with an "Upgrade" button (not clicked) (`64-workspace-switcher.png`). So the builder, Property access and Tabbed structure are all offered on the Free plan here.
- Not exercised: the **Tabbed** structure, "Add section", "Property labels" OFF, "Reset to original page layout", "Database templates" OFF, dark theme. UNMEASURED: these were seen but not toggled, for time.
- The expanded state of "N more properties" carried across rows in one session (Alpha → Beta both expanded) and reset to collapsed after a reload.

## Teardown

- Scratch page "Blok measure scratch 2026-10-12" (id 3f7c2586eb6d8047a9caf55b7d0f6319, holding "Measure DB") moved to Trash with its own "•••" > Move to Trash. Notion then navigated to the user's previous page ("New database", still "Edited 2d ago", not touched).
- Sidebar check after trashing: the sidebar text has no "Blok measure scratch" and no "Measure DB". The Private section now starts at "Полугодовое ревью" (`67-after-trash.png`). The Trash was not emptied.
- The viewport emulation used in item 10 was reset to 1512x717 before teardown.
