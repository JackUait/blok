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
  /// executor adds the version history reads when the journal keeps history.
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
public sealed record BlokAgentExecution(string ResultJson, string? DocumentJson, string Revision);

/// <summary>The host options passed to the agent runtime.</summary>
public sealed class BlokAgentOptions
{
  /// <summary>Opts in to writing target page titles and icons.</summary>
  public bool PageTitles { get; init; }

  /// <summary>Resolves target page documents when page titles are enabled.</summary>
  public IBlokPageTarget? PageTarget { get; init; }

  /// <summary>A BlokCustomToolsFile as JSON.</summary>
  public string? CustomToolsJson { get; init; }

  /// <summary>ManifestOverrides as JSON.</summary>
  public string? OverridesJson { get; init; }
}

/// <summary>Resolves a target page's stored document or live room.</summary>
public interface IBlokPageTarget
{
  /// <summary>Finds the document behind a page ID.</summary>
  /// <param name="pageId">The target page ID.</param>
  /// <param name="cancellationToken">Cancels the lookup.</param>
  /// <returns>The page location, or null when it is not found.</returns>
  ValueTask<BlokPageLocation?> ResolveAsync(
      string pageId, CancellationToken cancellationToken = default);
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
