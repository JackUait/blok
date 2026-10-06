using System.Text.Json.Serialization;

namespace Blok.Server.Documents;

/// <summary>The page facts in one saved document, for a host-owned page catalog.</summary>
/// <remarks>
/// The same rows a Node host gets from Blok's <c>pageIndex</c> for the same
/// document. A host replaces a document's rows with these on every save.
/// </remarks>
/// <param name="Owners">The <c>page</c> blocks that own a page, in document order.</param>
/// <param name="Text">The searchable text of each block, in document order.</param>
/// <param name="References">Every non-owning link to a page, in document order.</param>
public sealed record BlokPageIndex(
    [property: JsonPropertyName("owners")] IReadOnlyList<BlokPageOwnerEdge> Owners,
    [property: JsonPropertyName("text")] IReadOnlyList<BlokPageTextEntry> Text,
    [property: JsonPropertyName("references")] IReadOnlyList<BlokPageReference> References);

/// <summary>A <c>page</c> block that owns a page: the page is a child of this document.</summary>
/// <param name="PageId">The owned page.</param>
/// <param name="SourceBlockId">The <c>page</c> block that holds it.</param>
/// <param name="Order">The block's position in reading order. Blocks inside a table cell share the table's.</param>
public sealed record BlokPageOwnerEdge(
    [property: JsonPropertyName("pageId")] string PageId,
    [property: JsonPropertyName("sourceBlockId")] string SourceBlockId,
    [property: JsonPropertyName("order")] int Order);

/// <summary>The searchable text of one block. A <c>page</c> block's text is empty.</summary>
/// <param name="BlockId">The block, or <c>null</c> when the saved block has no id.</param>
/// <param name="Order">The block's position in reading order.</param>
/// <param name="Text">The block's plain text; a table's cells are folded into it.</param>
public sealed record BlokPageTextEntry(
    [property: JsonPropertyName("blockId")] string? BlockId,
    [property: JsonPropertyName("order")] int Order,
    [property: JsonPropertyName("text")] string Text);

/// <summary>A link to a page that does not own it: a <c>page-link</c> block or an inline page reference.</summary>
/// <param name="PageId">The linked page.</param>
/// <param name="SourceBlockId">The block that holds the link, or <c>null</c> when it has no id.</param>
/// <param name="Order">The block's position in reading order. Blocks inside a table cell share the table's.</param>
public sealed record BlokPageReference(
    [property: JsonPropertyName("pageId")] string PageId,
    [property: JsonPropertyName("sourceBlockId")] string? SourceBlockId,
    [property: JsonPropertyName("order")] int Order);
