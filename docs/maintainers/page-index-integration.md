# Page index in a host

Blok returns facts for one saved document. The host owns document storage, the page catalog, access checks, search, and the workspace UI. A `page` block points to another document by `pageId`; its saved position is the ownership edge. Do not infer an owner from a URL, title, or legacy pointer cache.

## Save and replace document facts

Update the consumer document and its index rows in one host transaction. Replace the rows for that document rather than appending: a removed or moved pointer must stop claiming its old parent, and edited text must replace its old search entry.

```ts
await host.transaction(async (tx) => {
  await tx.saveConsumerDocument(documentPageId, saved);
  const facts = pageIndex(saved);
  await tx.replaceOwners(documentPageId, facts.owners);
  await tx.replaceText(documentPageId, facts.text);
  await tx.replaceReferences(documentPageId, facts.references);
});
```

For a move between documents, save and reindex both changed documents in the same authoritative host operation. `pageIndex` reports only facts inside each document; it does not retain a workspace index. A pointer without a source block ID cannot claim ownership. A valid repeated `pageId` remains repeated so the tree can report a duplicate.

## Project the tree

Attach the source document's page ID to each stored owner edge as `ownerPageId`. Use `null` for a root document. Give `projectPageTree(edges, metadata)` metadata filtered for the current viewer. Do not include a root document's metadata unless it should itself have an owning pointer.

`roots` and `children` follow saved numeric order, with input order breaking ties. A node uses only host metadata: `access: 'none'` contains no title or icon even if the record includes them, while absent metadata yields `access: 'missing'` and a `missing-page` diagnostic. The projection never reads a pointer's old cached title or icon.

Check `diagnostics` before presenting a definitive parent or breadcrumb. `duplicate-owner` carries every competing source block and document edge; neither owner is selected. `cycle` and `unreachable` identify paths that cannot be placed under a root. `missing-owner` identifies metadata pages with no pointer. Repair the saved owners or catalog data and reproject; do not guess a parent.

## Search and access

Index the `text` rows for their source document. At query time, filter each matching source document under the current viewer's document access before returning a title, snippet, or result. Filtering only the tree metadata is not enough. Favorites and recent pages remain host-owned lists of page IDs.

The collaboration room may accept edits before its deferred consumer PUT. Durable catalog search therefore reflects the latest consumer save, not necessarily the live room. A host may overlay its own unsaved local results for instant feedback, but that overlay is not a durable index update.

Store `references` separately from owning edges. A `page-link` block or an inline `<a data-blok-page-id>` names a target page; an ordinary URL does not. Repeated references stay repeated. A table-cell child reference keeps the table's visible order but names its own source block.

For backlinks, query references by target `pageId`. Check the current viewer's access to each source document before returning its title, snippet, or block ID. Filtering only the target page is not enough.
