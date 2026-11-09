namespace Blok.Server.Agent;

/// <summary>Runs command batches over stored documents or live rooms.</summary>
public interface IBlokAgentExecutor
{
  /// <summary>Returns a document to save only when the batch succeeds.</summary>
  /// <param name="documentJson">The stored document.</param>
  /// <param name="batchJson">The command batch.</param>
  /// <param name="actor">The agent identity.</param>
  /// <param name="options">The host's agent options.</param>
  /// <param name="cancellationToken">Cancels the runtime call.</param>
  /// <returns>The batch result and saved document.</returns>
  ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);

  /// <summary>
  /// Returns the command contract for <see cref="ExecuteAsync"/>. A plain call keeps no
  /// steps, so <c>history.undo</c> and <c>history.redo</c> are unavailable; a
  /// <see cref="BlokAgentSession"/> offers them.
  /// </summary>
  /// <param name="options">The host's agent options.</param>
  /// <param name="cancellationToken">Cancels the runtime call.</param>
  /// <returns>The agent contract as JSON.</returns>
  ValueTask<string> GetContractAsync(
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);

  /// <summary>
  /// Returns the command contract for <see cref="ExecuteInRoomAsync"/>. Blok's
  /// executor adds the version history reads and restore when the journal keeps history.
  /// Defaults to <see cref="GetContractAsync"/>, so a host's own executor still builds.
  /// </summary>
  /// <param name="options">The host's agent options.</param>
  /// <param name="cancellationToken">Cancels the runtime call.</param>
  /// <returns>The agent contract as JSON.</returns>
  ValueTask<string> GetRoomContractAsync(
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default) =>
      GetContractAsync(options, cancellationToken);

  /// <summary>
  /// Opens a session for one agent on stored documents. <c>history.undo</c> and
  /// <c>history.redo</c> take back and write again its own batches, as long as each
  /// call passes the document the session last returned. A plain
  /// <see cref="ExecuteAsync"/> call keeps no steps.
  /// </summary>
  /// <param name="actor">The agent identity.</param>
  /// <param name="options">The host's agent options.</param>
  /// <returns>The session.</returns>
  BlokAgentSession OpenSession(BlokAgentActor actor, BlokAgentOptions? options = null) =>
      throw new NotSupportedException("This executor keeps no agent sessions.");

  /// <summary>Runs a room batch when collaboration is supported.</summary>
  /// <param name="docId">The room's document ID.</param>
  /// <param name="batchJson">The command batch.</param>
  /// <param name="actor">The agent identity.</param>
  /// <param name="options">The host's agent options.</param>
  /// <param name="cancellationToken">Cancels the runtime call.</param>
  /// <returns>The batch result and room revision.</returns>
  ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
}

/// <summary>The identity of an agent running a batch.</summary>
/// <param name="Id">The agent ID used for attribution.</param>
/// <param name="Name">The display name.</param>
/// <param name="OnBehalfOf">The optional represented user's ID.</param>
public sealed record BlokAgentActor(string Id, string Name, string? OnBehalfOf = null);

/// <summary>The public result of an agent batch.</summary>
/// <param name="ResultJson">The AgentResult as JSON.</param>
/// <param name="DocumentJson">The stored document to save, or null on failure.</param>
/// <param name="Revision">The stored content hash or room journal head.</param>
public sealed record BlokAgentExecution(string ResultJson, string? DocumentJson, string Revision)
{
  /// <summary>An MCP room run that must ask the person first: nothing was written.</summary>
  internal System.Text.Json.Nodes.JsonObject? Ask { get; init; }

  /// <summary>An MCP room run: the batch holds a writing command of the handle's contract.</summary>
  internal bool Writes { get; init; }

  /// <summary>The room took edits from this run.</summary>
  internal bool Wrote { get; init; }
}

/// <summary>The host options passed to the agent runtime.</summary>
public sealed class BlokAgentOptions
{
  /// <summary>
  /// An MCP live handle's input (its start flags, mode and write). Set, the bundle runs the
  /// MCP contract, so the contract revision and refusals match the handle's.
  /// </summary>
  internal System.Text.Json.Nodes.JsonObject? Mcp { get; init; }

  /// <summary>The MCP call's approval input: client capabilities, replies and client name.</summary>
  internal System.Text.Json.Nodes.JsonObject? Approval { get; init; }

  /// <summary>Opts in to writing target page titles and icons.</summary>
  public bool PageTitles { get; init; }

  /// <summary>Resolves target page documents when page titles are enabled.</summary>
  public IBlokPageTarget? PageTarget { get; init; }

  /// <summary>A BlokCustomToolsFile as JSON.</summary>
  public string? CustomToolsJson { get; init; }

  /// <summary>ManifestOverrides as JSON.</summary>
  public string? OverridesJson { get; init; }

  /// <summary>
  /// On by default. Set false when the editors keep comments in your own system (a <c>comments</c>
  /// hook): people there never see Blok's comment blocks, so the comment commands are unavailable.
  /// </summary>
  public bool BuiltInComments { get; init; } = true;
}

/// <summary>Resolves a target page's stored document or live room.</summary>
public interface IBlokPageTarget
{
  /// <summary>Finds the document behind a page ID, for an agent that renames it or sets its icon.</summary>
  /// <param name="pageId">The target page ID.</param>
  /// <param name="actor">The agent asking, with the person it acts for. Check that they may write the page.</param>
  /// <param name="cancellationToken">Cancels the lookup.</param>
  /// <returns>The page location, or null when it is not found or this actor may not write it.</returns>
  ValueTask<BlokPageLocation?> ResolveAsync(
      string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default);
}

/// <summary>
/// A page target that also creates the document for a new sub-page, as the editor's page
/// tool <c>create</c> does. With it and <see cref="BlokAgentOptions.PageTitles"/>, agents can
/// insert page blocks. Deleting a page block never calls the host: the page stays, and its
/// trash belongs to the host, as when a person deletes the block.
/// </summary>
public interface IBlokPageCreator : IBlokPageTarget
{
  /// <summary>
  /// Creates an empty page document for a new page block, stored or as a live room, that
  /// <paramref name="actor"/> (and the person it acts for) may write.
  /// </summary>
  /// <param name="actor">The agent asking, with the person it acts for.</param>
  /// <param name="cancellationToken">Cancels the create.</param>
  /// <returns>The new page ID, or null when this actor may not create a page; the batch then fails with FORBIDDEN.</returns>
  ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default);

  /// <summary>
  /// Creates an empty page document for a new page block, with what the caller knows about it:
  /// the parent document, the MCP principal and a suggested id. By default it calls
  /// <see cref="CreateAsync(BlokAgentActor, CancellationToken)"/>, so existing creators keep working.
  /// </summary>
  /// <param name="request">The page to create and who asks for it.</param>
  /// <param name="cancellationToken">Cancels the create.</param>
  /// <returns>The new page ID, or null (or empty) when this actor may not create a page; the batch then fails with FORBIDDEN.</returns>
  ValueTask<string?> CreateAsync(BlokPageCreateRequest request, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(request);

    return CreateAsync(request.Actor, cancellationToken);
  }
}

/// <summary>What a page creator is told about a new page block.</summary>
/// <param name="Actor">The agent asking, with the person it acts for.</param>
public sealed record BlokPageCreateRequest(BlokAgentActor Actor)
{
  /// <summary>
  /// The document the page block goes into. Null only on the executor's stored path
  /// (<see cref="IBlokAgentExecutor.ExecuteAsync"/>), which is given document JSON, not an id.
  /// </summary>
  public string? ParentDocumentId { get; init; }

  /// <summary>The MCP caller's principal; null outside Blok's MCP server.</summary>
  public string? Principal { get; init; }

  /// <summary>A fresh Blok page id the host may use or ignore.</summary>
  public string SuggestedPageId { get; init; } = string.Empty;
}

/// <summary>A target page's stored document or live room.</summary>
public abstract record BlokPageLocation
{
  private BlokPageLocation()
  {
  }

  /// <summary>A stored page document supplied by the host.</summary>
  /// <param name="LoadAsync">Loads the document JSON.</param>
  /// <param name="SaveAsync">Saves the document JSON.</param>
  public sealed record Stored(
      Func<CancellationToken, ValueTask<string>> LoadAsync,
      Func<string, CancellationToken, ValueTask> SaveAsync) : BlokPageLocation;

  /// <summary>A page document in a live room.</summary>
  /// <param name="DocId">The room document ID.</param>
  public sealed record Room(string DocId) : BlokPageLocation;
}

/// <summary>What the host's history hooks allow one agent call.</summary>
/// <param name="CanRead">The read hook's answer. No refuses history.versions, history.read and history.changes.</param>
/// <param name="Window">How far back the call may see; null for all of it.</param>
internal sealed record BlokAgentHistoryAccess(bool CanRead, TimeSpan? Window);

/// <summary>Asks the host's history hooks for <paramref name="userId"/> on <paramref name="documentId"/>.</summary>
internal delegate ValueTask<BlokAgentHistoryAccess> BlokAgentHistoryPolicy(
    string userId, string documentId, CancellationToken cancellationToken);
