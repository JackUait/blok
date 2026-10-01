# Notion page-block edge behaviours: evidence pass

Date: 2026-10-01. Read-only web research. No Notion login, no content created.

How to read this:
- **primary** = notion.com (help center, release notes) or developers.notion.com.
- **secondary** = third-party guide or community post.
- **inference** = my reading of a primary text, not something the text says directly.
- **not found** = searched, no source. Not filled in from memory.

Corpus searched: all 467 English help articles from `https://www.notion.com/help/sitemap.xml`, fetched 2026-10-01 and grepped as text. Also all 152 release-note pages from `https://www.notion.com/releases/sitemap.xml`, grepped in both stripped text and the raw rich-text JSON. Also developers.notion.com (`llms.txt`, enhanced-markdown, working-with-page-content, trash-page, delete-a-block, move-page).

Secondary pass: see the addendum. It was kept to one or two searches per gap.

**As-of caveat:** help-center quotes are the text live on 2026-10-01. Release-note quotes describe the UI on their release date, and several are from 2020–2022 (paste options, sub-page permissions, Trash/Move-to toasts). Those may have changed since.

---

## 1. Inline look of a page block

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Icon + title on one line, underline, hover style | **not found** in primary | The help docs only say a page icon shows "at the top left of your page and in the sidebar next to it." https://www.notion.com/help/customize-and-style-your-content (primary) |
| Page blocks accept a color | **found (primary, API)** | Enhanced markdown defines a page block as `<page url="URL" color="Color">Title</page>`. https://developers.notion.com/guides/data-apis/enhanced-markdown (primary) |
| Hover over a page link shows a preview of its content | **found (primary)** | "Hover preview of a Notion page … Now you can hover to preview page content." Release 2.34. https://www.notion.com/releases/2023-11-07 (primary) |
| Sub-page block menu has "Open in new tab" | **found (primary)** | "The dropdown menu that appears when you click the ⋮⋮ block handle of a sub-page now includes a button to Open in new tab." https://www.notion.com/releases/2021-12-23 (primary) |
| Empty-title text ("Untitled" / "New page") for a page block | **not found** in primary | The only "Untitled" hit is for mentions of pages the viewer cannot access, which now say "No access" instead of "Untitled" (https://www.notion.com/releases/2021-12-23, primary). That covers mentions only. It does not cover page blocks or the empty-title placeholder. |

Secondary: see the addendum at the end.

## 2. Cut / copy / paste of a page block

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Cut + paste of a page block in the same workspace moves the page (vs copy/link) | **not found** in primary | Help docs mention cut/copy/paste only for partial text across blocks. https://www.notion.com/help/writing-and-editing-basics (primary) |
| Pasting a Notion page URL offers "Mention page" (inline) or "Link to page" (full-width block) | **found (primary)** | "When you paste the URL of a Notion page, there's a new Mention page option in the dropdown that appears — this creates an inline link, whereas the Link to page option creates a full-width block." https://www.notion.com/releases/2020-11-19 (primary) |
| A Link to page block makes the target show in the sidebar under the page that holds the link | **found (primary)** | "When you add a Link to page block, the linked page will show up in your sidebar under the page where you inserted the link, just like any other sub-page." https://www.notion.com/help/create-links-and-backlinks (primary) |
| Copy/paste of blocks between workspaces is normally allowed | **inference from primary** | The Marketplace docs say a locked template blocks "copying certain blocks from the template and pasting them into a page in another Notion workspace". That implies it works for other content. https://www.notion.com/help/selling-on-marketplace and https://www.notion.com/help/finding-templates-on-marketplace (primary) |
| Moving a page to another workspace is a duplicate, not a move | **found (primary)** | "When you move content from one place to another, your content will be duplicated into the destination workspace or account, and the original content will continue to live where it used to … some content or settings … may be broken. This could include links, relations, permissions, page history." The flow is ••• → Move to → pick a workspace → "I understand, duplicate". https://www.notion.com/help/transfer-content-to-another-account (primary) |
| A same-account workspace move takes the sub-pages along | **found (primary)** | "When you move top-level pages, all their sub-pages go with them. They'll appear in the Private section." https://www.notion.com/help/intro-to-workspaces (primary; same text in workspace-settings, delete-your-account) |
| "Copy link" on a page vs "Copy link to block" | **found (primary)** | Block menu: "Copy link to block: Copies the anchor link to this particular block." (https://www.notion.com/help/writing-and-editing-basics). Sidebar page menu: "Delete, Duplicate, Copy link, Rename, and Move to." (https://www.notion.com/help/intro-to-workspaces). Copy page URL: "cmd/ctrl + L to copy a page's URL." (https://www.notion.com/help/keyboard-shortcuts) (all primary) |
| Bookmark/link-preview blocks have both "Copy link to block" and "Copy link to original" | **found (primary)** | https://www.notion.com/releases/2022-01-19 (primary) |

## 3. Duplicate (Cmd/Ctrl+D) of a page block

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Cmd/Ctrl+D duplicates the selected blocks | **found (primary)** | "Press cmd/ctrl + D to duplicate the blocks you've selected." Also "/duplicate creates an exact copy of the current block." https://www.notion.com/help/keyboard-shortcuts (primary) |
| Option/Alt + drag duplicates | **found (primary)** | "Duplicate any content on a Notion page by holding down option/alt as you drag and drop." https://www.notion.com/help/keyboard-shortcuts (primary) |
| Duplicating blocks that contain sub-pages copies the sub-pages, not links | **inference from primary** (2020 bug-fix note) | "Fixed a bug that caused duplicated blocks with sub-pages to create a link instead of a copy." https://www.notion.com/releases/2020-11-11 (primary). My reading: the intended behaviour is a copy. |
| Deep copy of the whole sub-tree at every depth | **partly found** | Public-page duplicate: "It will include all the sub-pages contained in the original page." https://www.notion.com/help/duplicate-public-pages (primary). For in-workspace Duplicate, depth is not stated beyond the bug-fix note above. |
| The copy is named "Title (1)", not "Copy of Title" | **found (primary)** | "Duplicated items are now appended with automatically incrementing numbers instead of 'Copy of' (e.g. … 'Meeting note (1)')." https://www.notion.com/releases/2022-01-19 (primary) |
| Databases: "Duplicate with content" or "Duplicate without content" | **found (primary)** | "You can choose to Duplicate with content or … Duplicate without content." https://www.notion.com/help/intro-to-databases (primary). Release note: https://www.notion.com/releases/2023-12-20 (primary) |
| Limit | **found (primary)** | "Currently, you can duplicate up to 50,000 blocks per hour." Error text: "Rate limit reached, please try again later." https://www.notion.com/help/notion-error-messages and https://www.notion.com/help/transfer-content-to-another-account (primary). An older 5,000-block limit was removed in 2020: https://www.notion.com/releases/2020-06-23 (primary) |
| Async "Duplicating…" progress UI | **not found** in primary | See the addendum for secondary. |

## 4. Delete a page block with Backspace

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Backspace/Delete on a selected page block deletes it | **found (primary)** | "You can always select any page block and press the backspace or delete keys." https://www.notion.com/help/duplicate-delete-and-restore-content (primary) |
| The deleted page goes to Trash, kept 30 days | **found (primary)** | "Once you delete a page, it will end up in Trash." "By default, pages will remain in Trash for 30 days." Same URL (primary) |
| Sub-pages go with it | **found (primary)** | "When pages are deleted, they and all of their contents immediately move to the trash." https://www.notion.com/help/guides/notions-data-retention-settings (primary) |
| Trash can be filtered by the old parent | **found (primary)** | Filter "In: The page that the deleted content used to live in." (https://www.notion.com/help/duplicate-delete-and-restore-content). On mobile, Trash splits into "all deleted pages, and sub-pages deleted off the current page you're looking at." (https://www.notion.com/help/workspaces-on-mobile) (primary) |
| A trashed page cannot be edited until restored | **found (primary)** | "You won't be able to edit a page that's in the trash unless you restore it." https://www.notion.com/help/duplicate-delete-and-restore-content (primary) |
| A toast with an Undo button after moving to Trash | **found (primary)** | "Now a small pop-up appears at the bottom of your screen whenever you move an item to the Trash, with a button to Undo." https://www.notion.com/releases/2022-04-14 (primary) |
| Cmd/Ctrl+Z restores a deleted page block in place | **not found** in primary | The toast is a button, not a statement about Cmd+Z. The help docs list no undo shortcut. The only undo text is the mobile ••• menu: "Undo/Redo: Take back your last action on a page, or reinstate it." https://www.notion.com/help/writing-and-editing-basics (primary). The one documented undo limit is for synced blocks: after deleting an original with more than 10 copies, "Undo won't restore them." https://www.notion.com/help/synced-blocks (primary) |
| Link to page blocks / mentions pointing at a deleted page show "deleted page" | **not found** in primary | Weak secondary: a 2020 Reddit post says that after cut+paste, "all my @ links and favorites were leading to deleted pages". That implies mentions still point at the trashed original. It does not say what label they show. See the addendum. |
| API view of deletion | **found (primary)** | Delete a block "Sets a Block object, including page blocks, to in_trash: true … In the Notion UI application, this moves the block to the 'Trash' where it can still be accessed and restored." https://developers.notion.com/reference/delete-a-block. Restore by setting `in_trash: false`: https://developers.notion.com/reference/trash-page (primary) |

## 5. Restoring from Trash: where it goes

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Normal Trash restore returns the page to its old parent and position | **not found** in primary | The help docs only say "restore the page", and on mobile "restore a page to your workspace". https://www.notion.com/help/duplicate-delete-and-restore-content and https://www.notion.com/help/workspaces-on-mobile (primary). See the addendum for secondary. |
| Enterprise admin restore offers "Restore to original location" or "Restore to Private pages" | **found (primary)** | "Enterprise workspace owners can restore deleted and retained pages to their original location … select Restore to original location or Restore to Private pages." Also "View original permissions to see who will regain access." https://www.notion.com/help/custom-data-retention-settings (primary). Guide: "This will restore a page to its original location, granting access back to those who originally had it." https://www.notion.com/help/guides/notions-data-retention-settings (primary) |
| Deleting and restoring create an event in updates | **found (primary)** | "Deleting, restoring, and permanently deleting items now creates an event in 'All updates'." https://www.notion.com/releases/2022-01-19 (primary). Audit log: "Page restored". https://www.notion.com/help/audit-log (primary) |

## 6. Block links

| Sub-claim | Verdict | Evidence |
|---|---|---|
| "Copy link to block" copies a URL to that block | **found (primary)** | "Select Copy link to block. This will copy the URL of that specific block to your clipboard. Paste this URL anywhere." https://www.notion.com/help/create-links-and-backlinks (primary) |
| Shortcut | **found (primary)** | "Added Alt/Option + Shift + L as a shortcut to copy a link to a specific block." https://www.notion.com/releases/2022-10-12 (primary) |
| Pasting a block link in Notion offers "Mention block" | **found (primary)** | "When you paste the link to a specific block in a Notion page, you'll see a Mention block option that creates a dynamic inline link to that content." https://www.notion.com/releases/2022-04-14 (primary) |
| URL fragment format (`#<blockid>`) | **not found** in primary | See the addendum for secondary. |
| Opening a block link on another page (scroll/highlight) | **not found** in primary | See the addendum for secondary. |

## 7. Rename propagation

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Rename updates every link to the page (title and icon) | **found (primary)** | "Links in Notion are dynamic and update themselves. If you change a page's title or icon, every link to that page will automatically update." https://www.notion.com/help/guides/creating-links-and-backlinks (primary) |
| Rename updates @-mentions | **found (primary)** | "If you change the title of a page, the new title will automatically reflect that change wherever the page is @-mentioned." https://www.notion.com/help/comments-mentions-and-reminders (primary) |
| Breadcrumbs and sidebar update | **not found** in primary | Not stated. |
| Instant for collaborators | **not found** in primary for renames | Only the general line: "Edits, comments, and suggestions made by other people will appear to you in real-time." https://www.notion.com/help/collaborate-within-a-workspace (primary). That does not mention titles. |

## 8. Move to / Turn into page

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Move to on a page moves it under another page or workspace | **found (primary)** | "Move to: This opens up a menu where you can choose any other workspace or page to move the current page into." https://www.notion.com/help/intro-to-workspaces (primary) |
| Move to on a regular (non-page) block is supported | **found (primary)** | Block menu: "Move to: Moves the block to another page in your workspace." (https://www.notion.com/help/writing-and-editing-basics). "/moveto lets you move that block to a different page." (https://www.notion.com/help/keyboard-shortcuts). Mobile: "The same menu appears when you use the Move To function for pages or blocks." (https://www.notion.com/releases/2020-02-19) (all primary) |
| Move to a database row: the row becomes a sub-page | **found (primary)** | "Move to: Lets you move the row to another workspace or page (where it will show up as a subpage)." https://www.notion.com/help/intro-to-databases (primary) |
| Moving into a database: dragged non-page blocks become pages | **found (primary)** | "Any other type of content you drag into a database (like bullets or to-do items), will automatically turn into pages." https://www.notion.com/help/intro-to-databases (primary) |
| Toast after Move to with Undo and "go to page" | **found (primary)** | "When you use the 'Move to' function, a new pop-up appears at the bottom of your screen with options to undo, or visit the page that you moved the item to." https://www.notion.com/releases/2022-05-03 (primary) |
| Moving needs Full access | **found (primary)** | "Note that you have to have Full access to a page in order to move it." https://www.notion.com/help/guides/how-workspace-owners-can-set-up-teamspaces-for-their-organization (primary) |
| Admins can block moves to other workspaces | **found (primary)** | "Disable moving pages to other workspaces" setting. https://www.notion.com/help/transfer-content-to-another-account (primary) |
| API: only pages move, under a page or data source | **found (primary)** | "This must be a regular Notion page, and not a database. Moving databases or other block types in the API is not currently supported." https://developers.notion.com/reference/move-page (primary) |
| Turn into page shortcut | **found (primary)** | "Press cmd/ctrl + option/shift + 9 to create a new page, or turn whatever you have on a line into a page." https://www.notion.com/help/keyboard-shortcuts (primary). Block menu "Turn into" includes "into a page" (https://www.notion.com/help/writing-and-editing-basics). Guide: "The Turn into page feature allows you to transform a block into a separate page and choose its location in your workspace. Multiple content blocks can be turned into pages and nested elsewhere in the workspace." (https://www.notion.com/help/guides/transforming-content-blocks-in-notion) (primary) |
| Cmd+Shift+P as the Move to shortcut | **not found** in primary | Not in the keyboard-shortcuts article and not in any release note. See the addendum. |

## 9. Undo scope

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Undo is per page vs global | **not found** in primary | The only wording is mobile: "Undo/Redo: Take back your last action on a page." https://www.notion.com/help/writing-and-editing-basics (primary). "On a page" is not a scope rule. |
| Undo across a move to another page | **partly found** | A Move to toast offers undo. https://www.notion.com/releases/2022-05-03 (primary). Whether Cmd+Z undoes it from either page is **not found**. |

## 10. Opening pages

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Any page link, including a sub-page, can open in side peek | **found (primary)** | "Open any Notion page link (e.g. subpage, page mention) in side peek mode." https://www.notion.com/releases/2023-04-27 (primary). The gesture is not given. |
| Database views choose side peek / center peek / full page | **found (primary)** | "Use the 'Open pages as' dropdown to set the default … side peek, center peek, or open as full page." https://www.notion.com/releases/2022-07-20 (primary). Current UI: "Layout → Open pages in → Full page." https://www.notion.com/help/tables (primary) |
| Enter / Cmd+Enter open a page | **found (primary)** | "Press enter to edit any text inside a selected block (or open a page inside a page)." "Press cmd/ctrl + enter to modify the current block … Open a page." https://www.notion.com/help/keyboard-shortcuts (primary) |
| Cmd/Ctrl+click opens in a new tab | **found (primary, desktop app; search results)** | Desktop: "Command/Control + Click now opens a tab in a new tab rather than a new Window." (https://www.notion.com/releases/2022-12-15). Search: "Hold cmd/ctrl while clicking any of these results to open in a new tab (web app) or a new window (desktop app)." (https://www.notion.com/help/search) (primary) |
| Sub-page ⋮⋮ menu has "Open in new tab" | **found (primary)** | https://www.notion.com/releases/2021-12-23 (primary) |
| Alt/Option-click on a page block opens side peek | **not found** in primary | See the addendum. |
| Button action can open a page in full page / side peek / center peek | **found (primary)** | "You can decide whether you want to open as a full page, side peek or center peek." https://www.notion.com/help/guides/automatically-generate-blocks-pages-with-buttons (primary) |

## 11. Offline (Aug 2025)

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Launch | **found (primary)** | Notion 2.53, 2025-08-19: "you can access pages, capture ideas, and keep work moving on the Notion desktop and mobile app offline." https://www.notion.com/releases/2025-08-19 (primary) |
| Sub-pages are NOT auto-downloaded | **found (primary)** | "Note: Subpages of any downloaded pages won't automatically download for offline use. Make sure to download any important subpages individually!" https://www.notion.com/help/use-pages-offline (primary) |
| What is downloaded | **found (primary)** | One page at a time via ••• → "Available offline". On paid plans, recently visited and favorited pages download automatically. Databases: "the first 50 rows of the first view." Same URL (primary) |
| Platforms | **found (primary)** | Desktop and mobile apps only. "This feature isn't available on web browsers." Same URL (primary) |
| Offline limits | **found (primary)** | Users can create new pages and edit downloaded ones. Embeds, AI blocks, forms and buttons are unavailable. Users "won't be able to share a page or edit permissions." Same URL (primary) |
| Conflicts | **found (primary)** | "Notion attempts to automatically resolve conflicts … for text-based edits … there are still risks associated with conflicts related to non-text edits … only one update can ultimately be saved." Same URL (primary) |
| Downloads are per device | **found (primary)** | "Pages you download individually for offline use will only be available at the device level." Same URL (primary) |

## 12. Permissions

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Sub-pages inherit the parent's permissions | **found (primary)** | "When you create a subpage inside of a page, that subpage will take on the permissions of its parent page. To change this, go into a subpage and update the permissions there." https://www.notion.com/help/sharing-and-permissions (primary) |
| Sub-pages can widen or narrow access | **found (primary)** | "Now, you can expand or restrict permissions for any sub-page." https://www.notion.com/releases/2020-11-11 (primary) |
| A "restore" action for sub-page permissions | **partly found (primary)** | The 2020-11-11 release note links to a page titled "Learn how to expand, restrict, and restore sub-page permissions →" (link target `https://www.notion.so/Sharing-permissions-524c32ac63dc424a842891ace7a99bf8`). The exact control label ("Restore inheritance" or similar) is **not found** in the current 467 help articles. See the addendum. |
| Broadest access wins | **found (primary)** | "Notion respects the broadest level of access given to a user." Moving a shared page to Private removes others' access, but "This override will only apply to the parent page — the permissions granted for any subpages will remain the same." https://www.notion.com/help/sharing-and-permissions (primary) |
| A "No access" level hides the page from that person and from search | **found (primary)** | "No access — the page is hidden from you and it will not appear in search." https://www.notion.com/help/guides/grant-access-teamspaces (primary) |
| Opening a page you cannot access shows "No access", with a request button | **found (primary)** | "If you open a page that you don't have access to, you can select No access on the page to send a request." https://www.notion.com/help/sharing-and-permissions (primary) |
| Mentions of inaccessible pages are titled "No access" | **found (primary)** | https://www.notion.com/releases/2021-12-23 (primary). Mentions only. |
| Duplicated content can contain blocks that "say No access" | **found (primary)** | "After you've duplicated a page to your workspace, you might see some blocks that say No access." https://www.notion.com/help/duplicate-public-pages (primary) |
| How a sub-page block renders in the parent for a reader without access | **not found** in primary | Not stated. Applying the mention rule or the duplicate-template rule to page blocks would be inference. |
| Backlinks to inaccessible pages | **found (primary)** | "Users can't use backlinks to open pages that they don't have access to." Backlinks to pages visible only to you are labelled "Private". https://www.notion.com/help/create-links-and-backlinks (primary) |

## 13. Page lock and version history

| Sub-claim | Verdict | Evidence |
|---|---|---|
| Lock page makes the page read-only for everyone, including the locker | **found (primary)** | "No one can make changes to the page's content unless they explicitly turn the lock off — including you." "Locked" shows in the breadcrumb. "Unlock for me" / "Unlock for everyone" / "Re-lock". Anyone with full or edit access can unlock. https://www.notion.com/help/collaborate-within-a-workspace (primary) |
| Lock reaches sub-pages | **not found** in primary | Not stated. |
| Version restore replaces the page with that version, and can itself be reverted | **found (primary)** | "Open the desired version and click Restore … you can always go back to the page as it was." https://www.notion.com/help/duplicate-delete-and-restore-content (primary) |
| Snapshot cadence | **found (primary)** | "A new version … recorded every 10 minutes as you actively edit it. Two minutes after you've made your last edit … another version." Same URL (primary) |
| Retention | **found (primary)** | Free 7 days, Plus 30, Business 90, Enterprise unlimited. Viewing needs Can edit access or higher. Same URL (primary) |
| Database restore scope | **found (primary)** | "If you're restoring a database, all of its pages and their properties will be restored. However, any contents of the database pages … won't be restored. To restore database page contents, you'll have to restore an earlier version of every individual page." Same URL (primary) |
| Inline database inside a page | **found (primary)** | "If you're restoring a page with an inline database … you can choose to restore or not restore the database's pages and properties." Same URL (primary) |
| Preview before restoring | **found (primary)** | "Notion shows a preview so you can better understand what will change. This is especially helpful for pages with databases or nested content." Same URL (primary) |
| Restoring a page version also restores its sub-pages' contents | **not found** in primary | Not stated. The database rule (row contents are NOT restored, only the rows) points toward per-page scope, but that is **inference**. |
| Archive (2026, Business/Enterprise) cascades to sub-pages | **found (primary)** | "If you archive a parent page, all … pages below are archived automatically." https://www.notion.com/help/duplicate-delete-and-restore-content. Release: https://www.notion.com/releases/2026-03-27 (primary) |

---

## Addendum: secondary pass

Tooling limits hit during this pass. Record them before trusting any "not found" below:
- The WebSearch tool returned "weekly limit" on every call.
- DuckDuckGo HTML answered 3 queries, then served an anomaly/captcha page.
- Bing returned unrelated results.
- Reddit returned 403. One thread was read through a Wayback Machine snapshot instead.

So most secondary gaps below are "not searched", not "searched and absent".

| Item | Secondary finding | Source |
|---|---|---|
| 6. Block-link URL format | `https://www.notion.so/<page-id>#<block-id>`, copied via the block menu. **secondary** (a user-filed issue on Notion's own MCP repo, not Notion staff text). The developers.notion.com full corpus (`llms-full.txt`, 1.5 MB) has no `notion.so/...#<hex>` example. | https://github.com/makenotion/notion-mcp-server/issues/211 |
| 2. Cut/paste of pages | A Reddit post from Aug 2020, read via a Wayback snapshot from 2022-07-28. Title: "Pro Tip: If you want to move pages, don't cut and paste. Use the \"move to\" option or ctrl+shift+p". Body: "I cut and pasted them. Everything looked fine at first, but then I realized that all my @ links and favorites were leading to deleted pages." So in 2020, cut+paste made new pages and trashed the originals, and old mentions and favorites stayed on the trashed originals. **secondary, one user, 2020; unverified for current Notion.** | https://www.reddit.com/r/Notion/comments/i8hjmg/pro_tip_if_you_want_to_move_pages_dont_cut_and/ (via https://web.archive.org/web/20220728051641/https://www.reddit.com/r/Notion/comments/i8hjmg/pro_tip_if_you_want_to_move_pages_dont_cut_and/) |
| 8. Cmd+Shift+P | **Conflicting secondary sources.** The 2020 Reddit post above (title) and one cheat sheet say Ctrl/Cmd+Shift+P is Move to. That cheat sheet also lists the same keys as "Sort database". Another cheat sheet says Cmd/Ctrl+Shift+P creates a new page. None cites Notion. Treat it as **unverified** (leaning Move to, per 2 of 3). Not in the official shortcut article. | https://www.skillademia.com/shortcuts/notion-shortcuts/ ; https://keyshortcuts.net/notion-shortcuts |
| 9. Undo shortcut | Third-party cheat sheets list Cmd/Ctrl+Z undo and Cmd/Ctrl+Shift+Z redo, with no scope. **secondary.** Says nothing about per-page vs global, or about undoing page deletes or moves. | https://fastshortcuts.com/shortcuts/notion/ ; https://keyshortcuts.net/notion-shortcuts |
| 1. Inline look / empty title | not found (not searched successfully) | — |
| 3. "Duplicating…" progress UI | not found (not searched successfully) | — |
| 4. Link-to-page after target deleted | not found (not searched successfully) | — |
| 5. Normal Trash restore location | not found (not searched successfully) | — |
| 6. Opening a block link on another page (scroll/highlight) | not found | — |
| 10. Alt-click → side peek | not found (not searched successfully) | — |
| 12. "Restore inheritance" label | not found. The only lead is the 2020-11-11 release link to a notion.so page, "Learn how to expand, restrict, and restore sub-page permissions" (`https://www.notion.so/Sharing-permissions-524c32ac63dc424a842891ace7a99bf8`). That page is client-rendered and was not read. A Wayback snapshot of notion.so/help/sharing-and-permissions (2022-01-05) has no restore/inherit text in its static HTML. | https://www.notion.com/releases/2020-11-11 |
| 13. Lock reaching sub-pages | not found (not searched successfully) | — |

## Still open: the shortest path to settle them

These need either a working search tool (after the WebSearch reset on Oct 4) or a hands-on test in a scratch Notion workspace. A hands-on test was out of scope here (no login).
1. Inline page-block rendering and empty-title text.
2. Cut+paste of a page block within a workspace: move, or copy + trash?
3. Whether Cmd+Z undoes a page-block delete and a Move to.
4. What a Link to page block and a mention show after the target is trashed.
5. Where a normal Trash restore puts the page.
6. Alt-click behaviour on a page block.
7. Whether Lock page cascades to sub-pages.
8. Whether a version restore touches sub-pages.
9. How a page block renders for a reader without access.
