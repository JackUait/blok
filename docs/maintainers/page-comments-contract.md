# Page and passage comments

The desktop and web client share two entry points:

- The empty page discussion action sits beside Add icon / Add cover above the title, on header hover or keyboard focus (always available on touch). Activating it hides the action and opens the full-width composer below the title/properties. Leaving an empty composer closes it; Escape also closes it without discarding a draft. Existing discussions stay discoverable under the title.
- Select text and choose **Commenter** in the inline toolbar, or press Cmd/Ctrl+Shift+M. The top toolbar opens the discussion list, with open/resolved filters.

Threads and replies remain `database-comment` annotation blocks. Page and passage threads are document-root blocks; replies are children of the thread. The optional `data.anchor.segments` records block ID, editable-field index, text offset, exact quote, and surrounding text. It does not duplicate the document body. Saved documents without anchors retain their page/row behavior.

Passage resolution uses block IDs and quote/context matching, not HTML formatting. Inserting text before a passage or changing its inline formatting leaves it attached. Multiple matching candidates, a removed block, or a modified quoted passage are treated conservatively: the thread remains in the list with its original quote and an unavailable-target label. This is quote anchoring, not CRDT-relative range tracking; arbitrary edits inside a quote may detach it.

Highlights and margin badges are derived overlay elements outside tool content. They never enter saved paragraph HTML, paste content, or undo history. Comments themselves use the existing transaction-without-capture path. Event listeners, observers, animation frames, panels, and drafts are released with the editor.

The discussion panel reuses existing reply/edit/delete/resolve controls and checks current write permission before mutations. Editing/deleting remains restricted to the comment author in the client. The server's existing page edit access is still required; this change does not add a comment-only role, notifications, mentions, attachments, or reactions.

Targeted validation: desktop anchor/controller/header tests; core comment persistence and document-schema tests; isolated-browser toolbar and keyboard creation, reply, reload, highlight and margin navigation. Run one job at a time through `scripts/low-memory.py`.
