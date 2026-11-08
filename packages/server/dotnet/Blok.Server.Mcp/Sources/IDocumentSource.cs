using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;

namespace Blok.Server.Mcp.Sources;

/// <summary>A loaded document. For a missing one, Raw is the empty document a first save creates.</summary>
internal sealed record LoadedDocument(JsonNode Raw, string? Version, bool Missing = false);

/// <summary>Where stored handles load and save documents, as Node's DocumentSource.</summary>
internal interface IDocumentSource
{
  /// <summary>How agentExecute writes the text to save: "file" or "compact".</summary>
  string DocumentTextForm { get; }

  bool CanList { get; }

  Task<LoadedDocument> LoadAsync(string documentId, CancellationToken cancellationToken);

  /// <returns>The saved version.</returns>
  Task<string?> SaveAsync(string documentId, string text, string? ifVersion, CancellationToken cancellationToken);

  /// <summary>Whether two ids name one stored document (a symlink or a case alias).</summary>
  Task<bool> SameDocumentAsync(string first, string second)
  {
    return Task.FromResult(false);
  }

  /// <summary>The same source acting for one caller. Only a host's source needs one; the others ignore who calls.</summary>
  IDocumentSource ForCaller(McpCaller caller)
  {
    return this;
  }

  /// <returns><c>{ documents: [{ id, title }], nextCursor }</c>.</returns>
  Task<JsonObject> ListAsync(int limit, string? query, string? cursor, CancellationToken cancellationToken);
}
