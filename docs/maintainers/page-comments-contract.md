# Page and passage comments

The desktop and web client share two entry points:

- The empty page discussion action sits beside Add icon / Add cover above the title, on header hover or keyboard focus (always available on touch). Activating it hides the action and opens the full-width composer below the title/properties. Leaving an empty composer closes it; Escape also closes it without discarding a draft. Existing discussions stay discoverable under the title.
- Select text and choose **Commenter** in the inline toolbar, or press Cmd/Ctrl+Shift+M. The top toolbar opens the discussion list, with open/resolved filters.

Threads and replies remain `database-comment` annotation blocks. Page and passage threads are document-root blocks; replies are children of the thread. The optional `data.anchor.segments` records block ID, editable-field index, text offset, exact quote, and surrounding text. It does not duplicate the document body. Saved documents without anchors retain their page/row behavior.

Passage resolution uses block IDs and quote/context matching, not HTML formatting. Inserting text before a passage or changing its inline formatting leaves it attached. Multiple matching candidates, a removed block, or a modified quoted passage are treated conservatively: the thread remains in the list with its original quote and an unavailable-target label. This is quote anchoring, not CRDT-relative range tracking; arbitrary edits inside a quote may detach it.

Highlights and margin badges are derived overlay elements outside tool content. They never enter saved paragraph HTML, paste content, or undo history. Comments themselves use the existing transaction-without-capture path. Event listeners, observers, animation frames, panels, and drafts are released with the editor.

The discussion panel reuses existing reply/edit/delete/resolve controls and checks current write permission before mutations. Editing/deleting remains restricted to the comment author in the client. The server's existing page edit access is still required; this change does not add a comment-only role, notifications, mentions, attachments, or reactions.

Targeted validation: desktop anchor/controller/header tests; core comment persistence and document-schema tests; isolated-browser toolbar and keyboard creation, reply, reload, highlight and margin navigation. Run one job at a time through `scripts/low-memory.py`.

## Local profile and avatar

Local settings now separate the person's display name/photo from the workspace name/icon.
`blok:desktop:local-profile:v1` stores the device profile; the existing
`blok:desktop:comment-author:v1` author ID is retained, so renaming the profile does
not alter comment ownership. The legacy `blok:desktop:profile-name` value remains
workspace naming data and is not migrated into the person's name.

PNG/JPEG/WebP imports are decoded locally, fitted without cropping into a transparent
256×256 PNG, and bounded before storage (10 MB input, 400,000-character encoded
output). No image upload or external avatar request occurs. Storage/decode failures
are shown and leave the previous profile intact. Notion Faces opens separately;
the user downloads the portrait and imports it using the photo control. The native
command opens only the fixed Faces URL, not arbitrary caller-provided URLs.

Page, passage and database-row comments resolve the current local author's name
and photo from the host profile. Photos are not copied into annotation blocks.
Profile changes refresh mounted discussions without discarding composer drafts;
storage events also refresh other windows. New comments still save their author
ID and display name for document portability. Remote accounts keep their existing
identity: this device profile is not a server account profile, and it does not
synchronize to other devices. Exported comments do not carry the local photo.
