# Notion clipboard fixtures

Real Notion clipboard payloads. The demo-page files were captured with `Ctrl+C`
on 2026-06-22 from `app.notion.com/p/Demo-Page-2c0c2586eb6d807cbafdc7f973fd5fce`.
That published page is edit-enabled when you log in.

`link-to-page.blocks-v3.json` was captured on 2026-10-04 from a selected block on
a temporary private page linking to Demo Page. A browser copy command triggered
Notion's copy handler. Identifying IDs were redacted.

These are the ground-truth fixtures for the Notion → Blok paste migration. See
`docs/plans/2026-06-22-notion-paste-migration-design.md` §0.1.

| File | MIME flavor | Notes |
|---|---|---|
| `demo-page.blocks-v3.json` | `text/_notion-blocks-v3-production` | **Lossless** Notion record-map. The primary migration source. Pretty-printed. |
| `demo-page.clipboard.html` | `text/html` | Clean GitHub-flavored-markdown-style HTML. NO Notion classes. Fallback source. |
| `demo-page.clipboard.txt` | `text/plain` | Flattened text floor. |
| `demo-page.page-source.json` | `text/_notion-page-source-production` | Page identity only (id/table/spaceId). |
| `link-to-page.blocks-v3.json` | `text/_notion-blocks-v3-production` | A real `alias` record with `format.alias_pointer.id` targeting a page; IDs redacted. |

## How the demo-page files were captured

1. Open the page in Chromium. The logged-out public view works for this page.
2. Grant `clipboard-read`/`clipboard-write`.
3. Click into a text block, then press `Escape`. That enters Notion's
   **block selection**. Press `Cmd+A` to select all blocks, then `Cmd+C`.
   - A raw DOM-range selection yields an EMPTY copy
     (`<!-- notionvc -->` marker only). The proprietary flavors require Notion's
     internal block selection.
4. Paste into a `contentEditable` with a capture-phase `paste` listener that reads
   every `event.clipboardData.getData(type)`. Download the bundle, then split it
   per flavor.

## Key facts (verified against these files)

- All four flavors are present on the live clipboard for web→web paste in the same browser engine.
- Code language IS in the HTML (`<pre><code class="language-jsx">`).
- To-do checked state in HTML is literal markdown text (`[ ]` / `[x]`), not a class or `<input>`.
- Callouts/toggles lose their state in the HTML. They stay intact in the JSON
  (`to_do.properties.checked`, `code.properties.language`, `callout.format.page_icon`/`block_color`).
