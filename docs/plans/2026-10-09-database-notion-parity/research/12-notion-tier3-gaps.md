# Research 12: Notion tier-3 parity (Verification, AI Autofill actions, comments, form choice display) — measured

Measured 2026-10-13 (local) in the user's signed-in Chrome via `playwright-cli -s=notion-measure4 open --extension`, on app.notion.com.
Workspace "Personal", Free plan (same workspace as research-09/10). Viewport 1512x717 CSS px, never changed. Light theme.
Scratch: private page "Blok measure scratch 4 2026-10-13" (id 3f7c2586eb6d802dbfa6db2e1771448f) holding full-page database "Measure DB 4" (`/database` > "Database - Full page" > "New empty data source"), as in research-10.
Rows: Alpha, Beta, Gamma (created in that order, `06-rows.png`). Properties added during the run: Summary (Text + AI Autofill), Status (auto-created by the Board view), Multiple choice (Multi-select, created by the form).
Screenshots: ~/Packages/.blok-undo/db-parity-ledger/notion-measure4/ (not in the repo) (`NN-*.png`). Probe dumps: `*.json`. Page ids: `ids.json`.
Not observed = **UNMEASURED**.

## 1. Verification property

**Headline: not available on this Free workspace. There is no "Verification" property type and no page-level "Verify" action anywhere I looked. Nothing about the verify menu, expiry choices, owner, badge or expired state could be seen.**

- Add property type list (full DOM text, incl. the part below the fold), in order: AI Autofill > Summarize (Basic), Translate (Basic); Select type > Text, Number, Select, Multi-select, Status, Date, Person, Files & media, Checkbox, URL, Phone, Email, Relation, Rollup, Formula, Button, ID, Place, Created time, Last edited time, Created by, Last edited by, Google Drive File, Figma File, GitHub Pull Requests, Zendesk Ticket. **No Verification** (`10-add-prop-verif.png`, `11-type-list-scrolled.png`, `11-type-list.json`).
- The type search ("Select type" magnifier) with "verif" returns zero results (`12-type-search-verif.png`).
- Database page "•••" (Actions) menu: Copy link, Duplicate, Move to, Move to Trash, Customize layout, Lock database, Undo, Import, Merge with CSV, Export, Updates & analytics, Version history, Notify me > Comments, Connections > None, Open in Mac app. No "Turn into wiki", no verify item (`13-db-actions-menu.png`).
- Row page (Alpha) "•••" menu: font Default/Serif/Mono, Copy link, Copy page contents, Duplicate, Move to, Move to Trash, Small text, Full width, Table of contents, Customize layout, Lock page, Use with AI, Suggest edits, Translate, Import, Export, Updates & analytics, Version history, Notify me > Comments, Connections, Open in Mac app. No "Verify" (`15-row-page-actions.png`).
- View settings > Data source settings > "Turn into" offers only "Turn into Tasks database" and "Turn into Skills database". No wiki (`36-view-settings-turn-into.png`).
- Plan lock: no upsell or lock glyph was shown; the type is simply absent. Notion's help page (notion.com/help/wikis-and-verified-pages, fetched, NOT seen in the UI) says: "This feature is available on Business and Enterprise Plans", pages can be verified "until a specific time or indefinitely", and verified pages show "a blue check mark next to their name when they're @-mentioned, and when they're displayed in Notion search results". The help page summary did not list the exact expiry labels.
- Cell menu (Verify / 1 week / 30 days / 90 days / Custom / Unverify): **UNMEASURED**. Verified cell look (owner, date, badge): **UNMEASURED**. Owner / verified-by setting in Edit property: **UNMEASURED**. Expired state: **UNMEASURED**.

## 2. AI Autofill: manual update actions

Setup: Add property > AI Autofill > Summarize > "One-liner" (the Summarize submenu offers Paragraph, Bullets, One-liner, `20-summarize-hover.png`). That creates a Text property named "Summary" and opens its Autofill dialog at once.

**Headline: Notion has no "Update" / "Regenerate" / "Update all pages" labels. The manual actions are: a per-cell "Autofill" button (hover), and "Run AI Autofill now" in the Autofill dialog footer. The column menu and Edit property panel only open the dialog.**

### The Autofill dialog
- Modal 800x637 at x=356 y=40 (`21-after-one-liner.png`, `21-autofill-dialog.json`). Title "Autofill Summary" with sparkle glyph; header "•••" (aria "More…") whose only item is **"Delete AI Autofill"** (`25-autofill-more-menu.png`, not clicked).
- Left column, top to bottom: segmented control **Basic** | **Custom Agent**; "Suggested" chips **Translate** ⌄ and **Summarize** ⌄; "Instructions" box (prefilled prompt: "Read the page content and summarize it into this property in one sentence. Guidelines: …"); "Triggers": **On page creation** (value None) and **On page update** (value None).
  - On page creation options: **None** (checked), **Any page creation** (`22-trigger-creation-menu.png`). Its hover hint: "The agent automatically fills this property when new pages are created" (`23-autofill-scrolled.png`).
  - On page update menu: a switch **"When page content is edited"** (off); then heading "When a property is updated" with **None** (checked), **Any properties**, **Only specific properties** (`24-trigger-update-menu.png`).
- Right column: "Preview with" + page picker (Alpha ⌄); eye glyph, "Preview with real data", button **Generate** (not clicked).
- Footer, right-aligned: **"Save changes"** (blue) and **"Run AI Autofill now"** (outlined, play glyph). On first open Save was enabled and Run disabled, with a blue unsaved dot + undo arrow in the header (`21-after-one-liner.png`). Moments later, without clicking Save, the dot was gone, Save was disabled and Run enabled (`22-trigger-creation-menu.png`). So the property saved itself. "Run AI Autofill now" was not clicked (it would run on every row).

### Entry points to the dialog
- Column header: a sparkle button right of the "Summary" label (no tooltip seen, `27-header-sparkle-hover.png`) opens the same dialog (`28-header-sparkle-click.png`).
- Column header menu: Property name field, Property access, Change type, **Autofill Summary**, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property (`29-summary-header-menu.png`). "Autofill Summary" replaces the plain "AI Autofill" item seen on a non-autofill property in research-10. No "Update all pages" item.
- Edit property panel (View settings > Edit properties > Summary): Type (Text), Property access, **Autofill Summary**; Wrap content (on), Duplicate property, Delete property (`34-edit-property-summary.png`). No update/regenerate item.
- View settings > Data source settings has **"AI Autofill"** with count **1** (`32-view-settings.png`). It opens a panel "AI Autofill" (Feedback ↗ link) listing a card "Autofill Summary / Autofills Summary when a page is created or updated", and a blue **"+ New AI Autofill"** button (`35-view-settings-ai-autofill.png`). Note: the card says "created or updated" even though both triggers were None.

### Cell actions
- Empty cell, hover: one 24x20 button, aria-label **"Autofill"**, tooltip "Autofill", Notion-AI face glyph, at the cell's right edge (`30-summary-cell-hover.png`, `31-cell-autofill-button-hover.png`).
- Click (run 1): the cell shows **"Thinking…"** (`37-cell-autofill-clicked.png`), then the value "The page describes Alpha." (Alpha's body is empty).
- Filled cell, hover: three buttons, left to right: **Autofill**, **Comment**, **Copy to Clipboard** (aria-labels; each 24x20) (`38-cell-filled-hover.png`).
- Click Autofill on the filled cell (run 2): no confirm, no menu. The value was replaced with "The page describes an entity named Alpha." within ~2 s (`40-filled-autofill-clicked.png`, `67-table-badge.png`). So re-running = regenerate, same button.
- Credits: both runs worked on Free with no prompt, counter or paywall. Credit cost / remaining credits: **UNMEASURED**. Total AI runs spent: 2 (plus two search "Quick Answers" Notion generated on its own during the teardown searches, `97-search-after-trash.png`, `97b-search-recheck.png`).

## 3. Comments on rows

Comment added on Beta only, then deleted.

### Entry points by view
- **Board** card hover: two buttons, pencil (edit) and "•••" (tooltip "Rename, delete, move to and more…", `51-board.png`). "•••" and **right-click** open the same menu: Page > Add to Favorites, Edit icon, Edit property ›, Layout, Property visibility, Open in ›, **Comment ⌘⇧M**, Copy link, Duplicate ⌘D, Move to ⌘⇧P, Move to Trash Del, footer "Last edited by …/ date / word count" (`53-board-card-more-menu.png`, `54-board-card-rightclick.png`).
- **Gallery** card: same hover pencil + "•••" at the cover's top-right (`61-gallery-card-hover.png`); right-click gives the same menu incl. Layout/Property visibility and **Comment** (`62-gallery-card-rightclick.png`).
- **List** row hover: only a pencil button (aria "Edit") after the title, plus the left gutter "+" and drag handle (`64-list-row-hover.png`). Right-click and a click on the drag handle open the same menu **without** Layout / Property visibility: Add to Favorites, Edit icon, Edit property, Open in, **Comment ⌘⇧M**, Copy link, Duplicate, Move to, Move to Trash (`65-list-row-rightclick.png`, `66-list-handle-click.png`).
- **Table**: a filled cell's hover toolbar includes a **Comment** button (§2, `38-cell-filled-hover.png`). Table row context menu: **UNMEASURED** this run.
- Menu "Comment" opens an inline composer popover anchored under the card: 470x44, white, radius 10px, shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`; avatar, placeholder **"Add a comment…"**, buttons "Attach file", "Mention a person, page, or date", "Send comment" (disabled while empty) (`55-card-comment-clicked.png`, `55-composer.json`). Enter sent it; the popover then shows the thread (author, "Just now", text) above a new composer (`56-after-comment-sent.png`).

### Badge
- Once Beta had 1 comment, a badge shows in **every** view: Board card (below title, `57-board-badge.png`), Gallery card (below title, `60-gallery.png`), List row (after title, `63-list.png`), Table name cell (after title, `67-table-badge.png`).
- Badge = `commentFilledSmall` 16px glyph + count "1", 12px/400 rgb(44,44,43), no fill (`57-board-badge.json`). It is a button with aria-label **"Open comments"**; click opens the thread popover with a reply composer (`59-badge-click.png`).

### Row page
- Under the properties there is a **"Comments"** section label (13px/500 rgb(125,122,117)) with an always-visible composer **"Add a comment…"**, shown even with zero comments (`70-gamma-page-hover.png`, `70-comments-label.json`). Title hover on a row page offers Add icon, Add cover, Customize layout — **no "Add comment"** there. (For contrast: the DOM of the plain, non-database scratch page contained an "Add comment" control in its title area, read via `textContent` at creation. It was not hovered or seen on screen; no screenshot.)
- With a comment: the thread renders inline (avatar, "Jack Uait", "2m", text) above the composer (`71-beta-page-comment.png`). The top bar gains a **Comments** button (aria "Comments") that is absent when the page has none (compare `70-…` vs `71-…`).
- That button opens a "Discussions" popover (bell glyph, one row per thread, **"See all"**) (`73-topbar-comments-panel.png`). "See all" opens a right sidebar "All discussions" (filter + bell icons, grouped "Today", thread with a quoted "Beta" page ref and "Reply…") (`74-…`, `75-discussions-sidebar.png`).
- Comment hover toolbar: **Add reaction**, **Resolve**, **More actions** (`76-comment-hover.png`). More actions: Mark as unread, Edit, Copy link, Mute replies, Delete (`77-comment-more-actions.png`). Delete asks **"Delete this comment?"** with **Delete** / **Cancel** (`78-delete-confirm.png`).
- After delete: sidebar shows "No discussions", the top-bar Comments button is gone, the Comments section is back to just the composer (`79-after-comment-delete.png`). Badges after delete in board/list views: **UNMEASURED** (not re-checked).

## 4. Form view: choice display and text length

Add view > Form opens "Form builder" with a modal **"Auto-create form questions based on existing properties?"** / "Only supported property types will create new questions." / **"Create 1 question"** / "Start from scratch" (`80-form-view.png`). "Create 1 question" added Summary (Name is always there; Status was not turned into a question) (`81-form-builder.png`).

- Add-question type list: Text, **Multiple choice**, Date, Person, Files & media, Number, Checkbox, Email, URL, Phone, Place (`84-add-question-menu.png`). There is **no separate Select vs Multi-select** question; "Multiple choice" creates a **Multi-select** property (View linked property shows Type "Multi-select", `91-view-linked-property.png`).
- Question options for **Multiple choice** (side panel "Question options"): Required (switch), Description (switch), **Show options as** (value "List view" ›), **Max selection** (value "Unlimited" ›), Question type (Multiple choice), View linked property, Sync with property name (switch, on), Move question, Duplicate question, Delete question (`85-multiple-choice-added.png`).
  - **Show options as**: **List view** (default, checked) / **Dropdown** (`86-show-options-as.png`). With Dropdown the question shows a select box "Options below will appear in the dropdown" with an up/down chevron, above "+ Add option" (`87-dropdown-selected.png`).
  - **Max selection**: Unlimited (default), 1, 2, 3, 4, 5, 10, and a "Custom" number field (`88-max-selection.png`). Helper under the title follows it: Unlimited → "(Respondents can select as many as they like)"; 1 → "(Respondents can select up to 1)" (`89-max-selection-1.png`). The linked property stayed Multi-select at max 1.
- Question options for **Text**: Required, Description, **Long answer** (switch, off by default), Question type (Text), View linked property, Sync with property name (on), Move/Duplicate/Delete question (`82-summary-question-selected.png`, `82-question-options-text.json`). No "Short answer" label: short = Long answer off. Turning it on grows the "Respondent's answer" box from one line to a multi-line box (roughly 37px → 85px tall, read from screenshot pixels, not measured in the DOM) (`83-long-answer-on.png`).
- How a Select (not multi) property renders as a question: **UNMEASURED** (no Select property existed). Respondent-side (Preview) rendering of Dropdown vs List: **UNMEASURED**.

## Teardown

- Scratch page "Blok measure scratch 4 2026-10-13" (with "Measure DB 4", rows Alpha/Beta/Gamma, views Table/Board/Gallery/List/Form builder) moved to Trash via its own "•••" > "Move to Trash" (`95-scratch-actions.png`). Notion navigated to the user's "New database" page.
- Sidebar text after trashing contains none of "Blok measure scratch 4", "Measure DB 4", "Alpha", "Beta", "Gamma" (`98-sidebar-after-trash.png`).
- Sidebar **search** for "Blok measure scratch 4" still listed the page first ("Edited Just now", `97-search-after-trash.png`). Opening its URL shows the red banner "Jack Uait moved this page to Trash just now. It will be permanently deleted in 30 days." with Restore page / Permanently delete, and the DB marked "In Trash" (`99-trashed-page-banner.png`). So it is trashed; search had not caught up.
- Search re-run a few minutes later: results dropped from 21 to 17 and the scratch page itself is **gone**. The child "Measure DB 4" (Database, breadcrumb "Blok measure scratch 4 2026-10-13", "Edited 4m ago") was still listed (`97b-search-recheck.png`). The trashed-page banner above already showed that database marked "In Trash", so this is index lag on the child. Both searches made Notion generate an AI "Quick Answer" on its own.
- Trash not emptied. Session `notion-measure4` closed.
- The one comment was deleted before trashing. 2 AI Autofill runs used. No workspace settings, sharing or plan touched; no upsell clicked. The browser was left on the "New database" page.
