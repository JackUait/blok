namespace Blok.Server.Collab;

/// <summary>What a member did in a document at the moment the room reported it.</summary>
public enum CollabActivityKind
{
  /// <summary>The member's connection joined the document's room.</summary>
  Joined,

  /// <summary>The member said it is still there without writing anything.</summary>
  Active,

  /// <summary>
  /// The member's write was journalled. Reported only where an
  /// <see cref="ICollabOperationStore"/> is registered, because it is raised
  /// where a committed operation is journalled; without a store an editing
  /// person still surfaces as <see cref="Active"/>.
  /// </summary>
  Edited,

  /// <summary>The member's connection left the document's room.</summary>
  Left,
}

/// <summary>
/// Told when a verified actor was present in a document, so a host can answer
/// "when was this person last here" for people who have already left.
/// </summary>
/// <remarks>
/// <para>
/// Blok stores none of this. The room reports and forgets; keeping it is the
/// host's job, and not registering an observer is how a host opts out — with
/// no observer the room makes no calls and the feature costs nothing.
/// </para>
/// <para>
/// Register an implementation with
/// <c>AddBlokServer(…).UseCollabActivityObserver&lt;T&gt;()</c>. It is resolved
/// as a singleton and must be safe to use from several documents at once.
/// </para>
/// <para>
/// This is best-effort telemetry, NOT the operation journal. A call that
/// throws or never completes is logged and dropped; it never closes a room and
/// never refuses an edit. Calls are made off the room's lane, so an
/// implementation that is slow costs the host its own latency and no one
/// else's, but a room's calls are serialized: one is in flight at a time and
/// they arrive in the order the room made them.
/// </para>
/// </remarks>
public interface ICollabActivityObserver
{
  /// <summary>Records one moment of a member's presence in a document.</summary>
  /// <param name="documentId">
  /// The document the member is in. It is caller-supplied text; treat it as
  /// untrusted when it becomes a path, a key or a query parameter.
  /// </param>
  /// <param name="actorId">
  /// The actor the connection was verified as at its handshake. Never null: a
  /// connection carrying no verified identity produces no call at all, because
  /// an unknown person stays unknown rather than getting a fabricated key.
  /// </param>
  /// <param name="at">
  /// The SERVER's clock when the room observed this. Nothing a client sends
  /// supplies it.
  /// </param>
  /// <param name="kind">What the member did.</param>
  /// <param name="cancellationToken">The caller's token.</param>
  /// <returns>A task that completes when the host has recorded the moment.</returns>
  /// <remarks>
  /// <see cref="CollabActivityKind.Active"/> and
  /// <see cref="CollabActivityKind.Edited"/> arrive at most once per 55 seconds
  /// per document-and-actor pair, so an implementation does not have to
  /// rate-limit them. The window is a little under the editor's own 60-second
  /// send cadence on purpose: the two are measured on different clocks, and
  /// equal thresholds drop every other heartbeat.
  /// <see cref="CollabActivityKind.Joined"/> and
  /// <see cref="CollabActivityKind.Left"/> are never suppressed: they are the
  /// boundaries of a session, and a host may want to store them as such.
  /// </remarks>
  ValueTask RecordAsync(
      string documentId,
      string actorId,
      DateTimeOffset at,
      CollabActivityKind kind,
      CancellationToken cancellationToken = default);
}
