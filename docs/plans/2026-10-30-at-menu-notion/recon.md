# Recon: Notion's "@" menu, the page part

Scope (user, 2026-10-30): match Notion's "@" menu for **Link to page** and
**New page**. People (user tagging), Date and Remind me are out of scope for now.

Sources:
- User video 1: Blok playground. "@" opens nothing (that checkout had no `search` wired).
- User video 2: Notion, "@" then "@p", "@page", hover on New page items.
- Live read of the user's own Notion workspace (Demo Page, 2026-10-30): "@" with an empty query, "@zzqx" with no match, the "/link to page" slash menu.
- Screenshots are kept in the session scratchpad only. They are reference and never ship.

## Screens

| ID | Screen | How you get there | States seen |
|---|---|---|---|
| S01 | "@" menu, empty query | type "@" in text | open at once, sections, recents, "N more results" |
| S02 | "@" menu, query | "@page" | loading (spinner next to the header, two skeleton rows), results with a path line, New page items with the query in bold |
| S03 | "@" menu, no page match | "@zzqx" | the Link to page section is gone, New page stays. No "Nothing found" while another section has items |
| S04 | Hover card on a New page item | hover "New "page" sub-page" | after a delay, a card with a small drawing and "Create a new sub-page where your cursor is, inside the current block." |
| S05 | "/" menu, Link to page | "/link to page" | one item "Link to page" with a page-arrow icon. Its picker was not captured: Enter moved focus to the title |

## S01: empty query
- The menu opens on "@" itself, before the first answer arrives.
- Section headers are small, gray and sentence case: "Link to page", "New page". Sections are split by a hairline.
- Link to page lists recent pages: icon (emoji or page glyph) + title. About 6 rows, then a gray row "15 more results" that expands the list.
- New page has two rows: "+ Add new sub-page" and "↗ Add new page in…".
- Footer "Give search feedback": Notion-internal. Skip.
- The typed "@" (and the query after it) sits in a light gray pill while the menu is open.
- The menu flips above the line when there is no room below.

## S02: query
- While the search runs, the "Link to page" header shows a small spinner. Two skeleton rows show under the results already known: a square plus two bars.
- A result row: icon + title, and under it a smaller gray path line "Workspace / Parent / …", cut with an ellipsis.
- The New page rows become `New "page" sub-page` and `New "page" page in…`, with the query in bold.
- The first selectable row is active (gray fill). Arrows move across sections, and headers are skipped.

## S03: no match
- The Link to page section and its header disappear. Only New page remains. Notion still has People, so the menu never empties.
- Blok rule: if NO section has items (no results and no `create`), show the standard "Nothing found".

## Flows
- F01 Link an existing page: "@" → type → Enter or click → inline mention, and "@query" is replaced. 2 keys after the query.
- F02 New sub-page: "@page" → `New "page" sub-page` → the page is created with title "page" under the current page → a mention of it is inserted.
- F03 New page in…: "@page" → `New "page" page in…` → a second picker with a search field to choose the parent → the page is created there → a mention is inserted. Unverified live; inferred from the label and Notion's help.
- F04 Cancel: Escape closes the menu and "@query" stays as plain text (seen).
- F05 "/" Link to page: already in Blok (block `page-link`).

## Data model (inferred)
- `PageSearchResult { pageId, title, icon, path, status }`: exists.
- An empty-query `search('')` returns recents. The host decides; Blok shows the first N.
- Creating from "@" needs the title and an optional parent: `PageConfig.create({ pageId, title?, parentId? })`. Both are additive optional fields. Today `create` only gets `{ pageId, document? }`. Confidence: high that the title is needed; medium on the parent shape.

## Out of scope (skip)
- People / Invite (user said so), Date / Remind me (user chose not to), "Give search feedback" (Notion-only).

## Size
M. The hard parts:
1. A sectioned menu with keyboard navigation across sections, a loading state and expandable "N more results", inside the existing PagePicker.
2. Create-and-mention: an async `create` while the "@query" must stay valid (stale guards exist for commit already).
3. "Page in…": a nested picker with its own search, then create with a parent.
