using System.Text.Json.Nodes;

namespace Blok.Server.Agent;

/// <summary>
/// One agent's batches on stored documents, kept in memory so that
/// <c>history.undo</c> and <c>history.redo</c> can take them back and write them again.
/// Each step holds the document from before it. Its steps stay usable while each
/// call passes the document the session last returned; when someone else saved
/// in between, undo and redo answer <c>CONFLICT</c>. Not thread-safe: await each
/// call before the next, or two calls race on the steps.
/// </summary>
public sealed class BlokAgentSession
{
  private readonly BlokAgentExecutor executor;
  private readonly BlokAgentOptions? options;
  private JsonObject history = [];

  internal BlokAgentSession(BlokAgentExecutor executor, BlokAgentActor actor, BlokAgentOptions? options)
  {
    this.executor = executor;
    this.options = options;
    Actor = actor;
  }

  /// <summary>The agent identity every batch runs as.</summary>
  public BlokAgentActor Actor { get; }

  /// <summary>Runs a batch. Returns a document to save only when the batch succeeds.</summary>
  /// <param name="documentJson">The stored document, as the session last returned it.</param>
  /// <param name="batchJson">The command batch.</param>
  /// <param name="cancellationToken">Cancels the runtime call.</param>
  /// <returns>The batch result and saved document.</returns>
  public async ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, CancellationToken cancellationToken = default)
  {
    var (execution, next) = await executor.RunAsync(documentJson, batchJson, Actor, options, history, cancellationToken);

    history = next ?? history;

    return execution;
  }
}
