namespace Blok.Server.Mcp;

/// <summary>
/// The host's own document store (<see cref="BlokMcpOptions.DocumentSource"/>): stored handles load
/// and save through it. Every call names the caller that opened the handle, so the host can check
/// its own rights and record who edited. Blok still checks every document it loads (a "blocks"
/// array, at most 48 levels deep, repeated keys and lone surrogates read as JSON.parse reads them),
/// and refuses the ids <c>""</c>, <c>"."</c> and <c>".."</c> before it calls the store.
/// Throw <see cref="BlokMcpSourceException"/> to refuse with a code. Any other exception is logged
/// in full; the agent sees SOURCE_UNAVAILABLE with Blok's own words, and the handle reloads.
/// Implement <see cref="IBlokMcpDocumentLister"/> too to serve blok_list_documents.
/// </summary>
public interface IBlokMcpDocumentSource
{
  /// <summary>Reads one document.</summary>
  /// <param name="caller">Who opened the handle.</param>
  /// <param name="documentId">The document.</param>
  /// <param name="cancellationToken">Cancels the read.</param>
  /// <returns>
  /// The stored JSON text and its version, or null when no document has this id yet: it then
  /// opens empty. An existing document must come with a non-empty version.
  /// </returns>
  ValueTask<BlokMcpStoredDocument?> LoadAsync(BlokMcpDocumentCaller caller, string documentId, CancellationToken cancellationToken);

  /// <summary>Writes one document, only if it is still at <paramref name="ifVersion"/>.</summary>
  /// <param name="caller">Who opened the handle.</param>
  /// <param name="documentId">The document.</param>
  /// <param name="documentText">The document as compact JSON text. Store it as it is.</param>
  /// <param name="ifVersion">
  /// The version the handle last loaded or saved. Null means the document must not exist yet.
  /// When the stored version differs, throw <see cref="BlokMcpSourceException"/> with
  /// <see cref="BlokMcpSourceErrorKind.Changed"/>.
  /// </param>
  /// <param name="cancellationToken">Cancels the write.</param>
  /// <returns>The new version; never null or empty.</returns>
  ValueTask<string> SaveAsync(BlokMcpDocumentCaller caller, string documentId, string documentText, string? ifVersion, CancellationToken cancellationToken);
}

/// <summary>A document store that can list documents, for blok_list_documents and blok_open by query.</summary>
public interface IBlokMcpDocumentLister
{
  /// <summary>One page of documents. Blok still drops every id the per-document check refuses.</summary>
  /// <param name="caller">Who asks.</param>
  /// <param name="request">The query, cursor and page size.</param>
  /// <param name="cancellationToken">Cancels the listing.</param>
  /// <returns>The page.</returns>
  ValueTask<BlokMcpDocumentList> ListAsync(BlokMcpDocumentCaller caller, BlokMcpListRequest request, CancellationToken cancellationToken);
}

/// <summary>Who a store call acts for.</summary>
/// <param name="Principal">The signed-in caller.</param>
/// <param name="ClientName">The MCP client's cleaned name.</param>
/// <param name="Scopes">The caller's scopes, or null when Blok checks none.</param>
/// <param name="Actor">The agent as Blok records it.</param>
public sealed record BlokMcpDocumentCaller(string Principal, string ClientName, IReadOnlyList<string>? Scopes, BlokMcpAgentActor Actor);

/// <summary>A stored document.</summary>
/// <param name="DocumentText">The document as JSON text, as stored. Blok parses it.</param>
/// <param name="Version">Its version, which Blok sends back on the next save. Never empty.</param>
public sealed record BlokMcpStoredDocument(string DocumentText, string Version);

/// <summary>What a listing asks for.</summary>
/// <param name="Limit">The most documents to return.</param>
public sealed record BlokMcpListRequest(int Limit)
{
  /// <summary>Part of an id or title to match; null lists every document.</summary>
  public string? Query { get; init; }

  /// <summary>The cursor a previous page returned.</summary>
  public string? Cursor { get; init; }
}

/// <summary>One page of documents.</summary>
/// <param name="Documents">The documents.</param>
public sealed record BlokMcpDocumentList(IReadOnlyList<BlokMcpListedDocument> Documents)
{
  /// <summary>The next page's cursor; null on the last page.</summary>
  public string? NextCursor { get; init; }
}

/// <summary>One listed document.</summary>
/// <param name="Id">Its id.</param>
public sealed record BlokMcpListedDocument(string Id)
{
  /// <summary>Its title, if the store knows it.</summary>
  public string? Title { get; init; }
}

/// <summary>Why a document store refused.</summary>
public enum BlokMcpSourceErrorKind
{
  /// <summary>Someone saved the document since the handle loaded it: DOCUMENT_CHANGED, retryable.</summary>
  Changed,

  /// <summary>The store cannot answer now: SOURCE_UNAVAILABLE, retryable.</summary>
  Unavailable,

  /// <summary>The host does not allow this: FORBIDDEN.</summary>
  Forbidden,

  /// <summary>The store does not take this id: INVALID_ARGS.</summary>
  InvalidId,
}

/// <summary>
/// Thrown by a document store to refuse with a code. The agent sees <see cref="AgentMessage"/>,
/// or Blok's own words when it is blank.
/// </summary>
public sealed class BlokMcpSourceException : Exception
{
  /// <summary>Creates the refusal.</summary>
  /// <param name="kind">Why the store refused.</param>
  /// <param name="agentMessage">What the agent sees. Write it for the agent: no paths, hosts or secrets. Blank: Blok's words.</param>
  /// <param name="innerException">The cause, for the server log only.</param>
  public BlokMcpSourceException(BlokMcpSourceErrorKind kind, string agentMessage = "", Exception? innerException = null)
      : base(string.IsNullOrWhiteSpace(agentMessage) ? kind.ToString() : agentMessage, innerException)
  {
    Kind = kind;
    AgentMessage = agentMessage ?? string.Empty;
  }

  /// <summary>Why the store refused.</summary>
  public BlokMcpSourceErrorKind Kind { get; }

  /// <summary>What the agent sees; blank means Blok's own words.</summary>
  public string AgentMessage { get; }
}
