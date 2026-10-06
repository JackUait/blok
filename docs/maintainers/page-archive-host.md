# Page archives in a host

Blok copies and renders one page document at a time. The host owns page traversal, access checks, archive paths and format, storage, and import visibility. A `page` block is an owning pointer; a `page-link` block or inline page reference is not.

## Export a permitted subtree

1. Read the host's current owning edges. Check read access before loading each body or metadata record. For a complete subtree export, refuse an unreadable owned descendant rather than silently shipping a broken tree.
2. Choose archive paths for the permitted page IDs. Render each saved body with `blocksToHtml(body, { pageInfo, pageHref })`. Give `pageInfo` only metadata the reader may see, and make `pageHref` return an archive path only for a permitted page.
3. Package the rendered pages in the host's chosen format. Blok does not traverse pages or choose filenames.

The saved inline page reference remains `<a data-blok-page-id="…">`. `blocksToHtml` derives its static link from the authorized metadata and `pageHref`; it does not write an archive URL into saved content. An unresolved or denied reference stays unlinked. Ordinary external URLs are not page identities.

## Import without a second owner

1. Check import and destination write access. Validate the selected ownership tree for cycles and duplicate owners.
2. Allocate all new page IDs for the copied subtree and a complete fresh block-ID map for each document. Build the full page-ID map before copying any body, so a root document can refer to a copied grandchild.
3. Call `remapPageDocument(body, { blockIds, pageIds })` once for each body. It changes block IDs, `parent`/`content`, typed page references, table-cell block references, and exact local `#blockId` anchors. It leaves ordinary text, external URLs, and references outside the map unchanged. It also rewrites blocks nested in legacy data (callout and toggle list `body.blocks`, columns `cols[].blocks`, list and checklist `items[]`), so a nested block that has an ID needs an entry in `blockIds`. It refuses a body with unmapped, duplicate-target or missing top-level IDs, and its error names them. A host custom tool must handle its own documented IDs.
4. In one durable host transaction, save every copied body and page record, then the new owning pointer. Make the import visible only after that transaction commits. Use a stable operation ID for retries so a lost response cannot create another owner.

The original documents and pointers keep their IDs. `remapPageDocument` does not generate IDs, authorize a page, store a document, or write an archive file.
