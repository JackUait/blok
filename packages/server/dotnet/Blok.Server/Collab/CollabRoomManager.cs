namespace Blok.Server.Collab;

internal enum CollabJoinStatus
{
  Joined,

  /// <summary>Access changed after the handshake; the endpoint answers 403.</summary>
  Forbidden,

  Purged,

  /// <summary>The doc endpoint could not seed the room; the endpoint closes 4503 and the next join retries.</summary>
  SeedFailed,

  /// <summary>The server is shutting down; new sessions are refused.</summary>
  Draining,

  /// <summary>
  /// The document cannot be served right now and nothing is wrong with the
  /// request: another live process holds its journal, or a commit failure put
  /// this document in its retry cooldown. The endpoint closes 4503 and the
  /// client comes back.
  /// </summary>
  Unavailable,
}

internal sealed record CollabJoinResult(
    CollabJoinStatus Status,
    CollabMembership? Membership,
    Exception? Error);

internal enum CollabEditStatus
{
  Applied,

  /// <summary>The id is committed for a different request body. The endpoint answers 409.</summary>
  Conflict,

  /// <summary>The server is going down; the endpoint answers 503.</summary>
  Draining,

  /// <summary>An op failed validation; nothing was written. The endpoint answers 422.</summary>
  Invalid,

  Purged,

  /// <summary>The doc endpoint could not seed the room; the endpoint answers 503.</summary>
  SeedFailed,

  /// <summary>
  /// The document cannot be served right now: another live process holds its
  /// journal, or a commit failure put it in its retry cooldown. The endpoint
  /// answers 503.
  /// </summary>
  Unavailable,

  /// <summary>
  /// The journal head is not the one the caller named; nothing was applied.
  /// The receipt carries the current head. The endpoint answers 412.
  /// </summary>
  PreconditionFailed,

  /// <summary>
  /// A precondition was sent but no journal is registered, so there is no
  /// head to check it against. The endpoint answers 428.
  /// </summary>
  PreconditionRequired,
}

/// <summary>The journal head an HTTP edit expects, from its If-Match header.</summary>
internal sealed record CollabEditPrecondition(string Lineage, ulong Sequence);

internal sealed record CollabEditReceipt(CollabWorkingSetTag Tag, ulong ServerSequence);

internal sealed record CollabEditResult(
    CollabEditStatus Status,
    Exception? Error,
    CollabEditReceipt? Receipt = null);

internal enum CollabStateStatus
{
  Ready,
  Purged,

  /// <summary>The server is going down; the endpoint answers 503.</summary>
  Draining,

  /// <summary>The doc endpoint could not seed the room; the endpoint answers 503.</summary>
  SeedFailed,

  /// <summary>Held by another process or in its commit cooldown; the endpoint answers 503.</summary>
  Unavailable,

  /// <summary>The converter cannot write this document as JSON; the endpoint answers 500.</summary>
  ExportFailed,
}

/// <summary>
/// One consistent read of a room: the export bytes and, on a journal-backed
/// room, the head they reflect. Both are taken in one lane hold.
/// </summary>
internal sealed record CollabStateResult(
    CollabStateStatus Status,
    byte[] Json,
    CollabEditReceipt? Head = null,
    Exception? Error = null);

internal enum CollabResetStatus
{
  Reset,
  SeedFailed,
  Unavailable,
  Purged,
}

internal sealed record CollabResetResult(
    CollabResetStatus Status,
    CollabWorkingSetTag? Tag,
    Exception? Error);

/// <summary>
/// Owns one <see cref="CollabRoom"/> per open doc. Rooms remove themselves
/// when they close (eviction, reset, seed failure, drain); a join that races
/// a closing room simply retries on a fresh one.
/// </summary>
internal sealed class CollabRoomManager : ICollabRoomManager, ICollabDocumentPurger
{
  private const int MaxJoinAttempts = 16;

  private readonly Dictionary<string, CollabRoom> rooms = new(StringComparer.Ordinal);
  private readonly Dictionary<string, SemaphoreSlim> purgeLanes = new(StringComparer.Ordinal);
  private readonly Dictionary<string, CommitCooldown> cooldowns = new(StringComparer.Ordinal);
  private readonly ICollabWorkingSetStore store;
  private readonly ICollabOperationStore? operationStore;
  private readonly ICollabActivityObserver? activityObserver;
  private readonly IDocEndpointClient endpoint;
  private readonly ICollabDocConverter converter;
  private readonly CollabRoomOptions options;
  private readonly TimeProvider timeProvider;
  private readonly Action<string>? log;
  private volatile bool draining;

  internal CollabRoomManager(
      ICollabWorkingSetStore store,
      IDocEndpointClient endpoint,
      ICollabDocConverter converter,
      CollabRoomOptions options,
      TimeProvider timeProvider,
      Action<string>? log = null,
      ICollabOperationStore? operationStore = null,
      ICollabActivityObserver? activityObserver = null)
  {
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(endpoint);
    ArgumentNullException.ThrowIfNull(converter);
    ArgumentNullException.ThrowIfNull(options);
    ArgumentNullException.ThrowIfNull(timeProvider);

    this.store = store;
    this.endpoint = endpoint;
    this.converter = converter;
    this.options = options;
    this.timeProvider = timeProvider;
    this.log = log;
    this.operationStore = operationStore;
    this.activityObserver = activityObserver;
  }

  internal int LiveRoomCount
  {
    get
    {
      lock (rooms)
      {
        return rooms.Count;
      }
    }
  }

  internal async ValueTask<CollabJoinResult> JoinAsync(
      string docId,
      ICollabMember member,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(member);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      if (IsPurging(docId))
      {
        return new CollabJoinResult(CollabJoinStatus.Purged, null, null);
      }

      if (draining)
      {
        return new CollabJoinResult(CollabJoinStatus.Draining, null, null);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabJoinResult(CollabJoinStatus.Unavailable, null, null);
      }

      var room = RoomFor(docId);

      if (room is null)
      {
        return new CollabJoinResult(CollabJoinStatus.Purged, null, null);
      }

      var result = await room.JoinAsync(member, cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during join.");
  }

  internal async ValueTask<CollabWorkingSetTag> ResetAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    var result = await ResetForHttpAsync(docId, cancellationToken);

    return result.Tag ?? throw result.Error ?? new InvalidOperationException(
        $"collab: document \"{docId}\" is unavailable");
  }

  internal async ValueTask<CollabResetResult> ResetForHttpAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      var room = RoomFor(docId);

      if (room is null)
      {
        return new CollabResetResult(CollabResetStatus.Purged, null, null);
      }

      var result = await room.ResetAsync(cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during reset.");
  }

  internal ValueTask<CollabEditResult> EditAsync(
      string docId,
      IReadOnlyList<CollabEditOp> ops,
      CancellationToken cancellationToken = default)
  {
    return EditAsync(
        docId,
        ops,
        Guid.NewGuid().ToString("N"),
        CollabEditOps.CanonicalBodyDigest(ops),
        actorId: null,
        cancellationToken: cancellationToken);
  }

  /// <summary>Block-level HTTP edit with the endpoint's idempotency receipt.</summary>
  internal async ValueTask<CollabEditResult> EditAsync(
      string docId,
      IReadOnlyList<CollabEditOp> ops,
      string operationId,
      ReadOnlyMemory<byte> digest,
      string? actorId,
      CollabEditPrecondition? expect = null,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(ops);
    ArgumentException.ThrowIfNullOrEmpty(operationId);

    // Checked before a room is made, so no seed GET is spent on it.
    if (expect is not null && operationStore is null)
    {
      return new CollabEditResult(CollabEditStatus.PreconditionRequired, null);
    }

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      if (IsPurging(docId))
      {
        return new CollabEditResult(CollabEditStatus.Purged, null);
      }

      // Refused during shutdown, like a join: a room created after the drain
      // pass has already swept would seed a document from the consumer's
      // endpoint and then be closed without ever flushing it back.
      if (draining)
      {
        return new CollabEditResult(CollabEditStatus.Draining, null);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabEditResult(CollabEditStatus.Unavailable, null);
      }

      var room = RoomFor(docId);

      if (room is null)
      {
        return new CollabEditResult(CollabEditStatus.Purged, null);
      }

      var result = await room.EditAsync(
          ops,
          operationId,
          digest,
          actorId,
          expect,
          cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during an edit.");
  }

  /// <summary>GET /sync/{doc}/state: the live document, loading the room the way an edit does.</summary>
  internal async ValueTask<CollabStateResult> StateAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      if (IsPurging(docId))
      {
        return new CollabStateResult(CollabStateStatus.Purged, []);
      }

      if (draining)
      {
        return new CollabStateResult(CollabStateStatus.Draining, []);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabStateResult(CollabStateStatus.Unavailable, []);
      }

      var room = RoomFor(docId);

      if (room is null)
      {
        return new CollabStateResult(CollabStateStatus.Purged, []);
      }

      var result = await room.StateAsync(cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during a state read.");
  }

  public async ValueTask<int> RecheckAccessAsync(
      string documentId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(documentId);
    CollabRoom? room;

    lock (rooms)
    {
      rooms.TryGetValue(documentId, out room);
    }

    return room is null ? 0 : await room.RecheckAccessAsync(cancellationToken);
  }

  /// <summary>
  /// Publishes a checkpoint on a document that is already loaded, and with it
  /// the one whole-JSON projection a checkpoint earns. Nothing drives this
  /// yet: the cadence belongs to the checkpoint publisher (plan task 5.1).
  /// False when no room holds the document, or the room had nothing new.
  /// </summary>
  internal async ValueTask<bool> CheckpointAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    CollabRoom? room;

    lock (rooms)
    {
      if (purgeLanes.ContainsKey(docId))
      {
        return false;
      }

      rooms.TryGetValue(docId, out room);
    }

    return room is not null && await room.CheckpointAsync(cancellationToken);
  }

  /// <summary>Consecutive commit failures for one document, and when it may be loaded again.</summary>
  private sealed record CommitCooldown(int Failures, DateTimeOffset Until);

  public async ValueTask<CollabDocumentPurgeOutcome> PurgeDocumentAsync(
      string documentId,
      Func<CancellationToken, ValueTask<bool>> authorize,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(documentId);
    ArgumentNullException.ThrowIfNull(authorize);

    if (documentId is "." or ".." ||
        documentId.Contains('/') ||
        documentId.Contains('\\') ||
        documentId.Contains("%2f", StringComparison.OrdinalIgnoreCase) ||
        documentId.Contains("%5c", StringComparison.OrdinalIgnoreCase))
    {
      throw new ArgumentException(
          "collab: document ids must be a single path segment.",
          nameof(documentId));
    }

    if (!await authorize(cancellationToken))
    {
      throw new UnauthorizedAccessException(
          "collab: document purge was not authorized.");
    }

    if (operationStore is not null &&
        operationStore is not ICollabOperationPurgeStore)
    {
      throw new NotSupportedException(
          $"the operation journal cannot purge documents: the registered {nameof(ICollabOperationStore)} " +
          $"({operationStore.GetType().FullName}) must also implement {nameof(ICollabOperationPurgeStore)}");
    }

    SemaphoreSlim purgeLane;

    lock (rooms)
    {
      if (purgeLanes.TryGetValue(documentId, out var existing))
      {
        purgeLane = existing;
      }
      else
      {
        purgeLane = new SemaphoreSlim(1, 1);
        purgeLanes[documentId] = purgeLane;
      }

      if (rooms.TryGetValue(documentId, out var current))
      {
        current.RequestPurge();
      }
    }

    await purgeLane.WaitAsync(cancellationToken);

    try
    {
      CollabRoom? room;

      lock (rooms)
      {
        rooms.TryGetValue(documentId, out room);
        room?.RequestPurge();
      }

      if (room is not null)
      {
        await room.PurgeAsync(cancellationToken);
      }

      if (operationStore is ICollabOperationPurgeStore journal)
      {
        var outcome = await journal.PurgeAsync(documentId, cancellationToken);

        if (outcome == CollabDocumentPurgeOutcome.DocumentOpenElsewhere)
        {
          return outcome;
        }
      }

      await store.DeleteAsync(documentId, cancellationToken);

      return CollabDocumentPurgeOutcome.Purged;
    }
    finally
    {
      purgeLane.Release();
    }
  }

  /// <summary>Plan decision 19: refuse new joins, flush every room (blob + export), close members 1001.</summary>
  public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
  {
    draining = true;

    // A join that passed the draining check a moment ago may still add a
    // room; keep going until nothing is left. Rooms drain together and one
    // that throws is dropped rather than allowed to abort the pass — a
    // sequential await let the first failure strand every room after it.
    while (LiveRooms() is { Length: > 0 } rooms)
    {
      await Task.WhenAll(Array.ConvertAll(
          rooms,
          room => DrainRoomAsync(room, cancellationToken)));
    }
  }

  /// <summary>
  /// Test hook: completes once every room has run the work queued before the
  /// call AND delivered the activity that work handed to the host. That second
  /// half awaits HOST code with NO bound — unlike <see cref="DrainAsync"/>,
  /// which bounds it twice — so this belongs in tests and nowhere else.
  /// </summary>
  internal async Task SettleAsync()
  {
    foreach (var room in LiveRooms())
    {
      await room.SettleAsync();
    }
  }

  private async Task DrainRoomAsync(
      CollabRoom room,
      CancellationToken cancellationToken)
  {
    try
    {
      await room.DrainAsync(cancellationToken);
    }
    catch (Exception error)
    {
      log?.Invoke(
          $"collab: room \"{room.DocId}\" could not be drained: {error.Message}");
      Forget(room);
    }
  }

  private CollabRoom[] LiveRooms()
  {
    lock (rooms)
    {
      return [.. rooms.Values];
    }
  }

  private bool IsPurging(string docId)
  {
    lock (rooms)
    {
      return purgeLanes.ContainsKey(docId);
    }
  }

  private CollabRoom? RoomFor(string docId)
  {
    lock (rooms)
    {
      if (purgeLanes.ContainsKey(docId))
      {
        return null;
      }

      if (!rooms.TryGetValue(docId, out var room))
      {
        room = new CollabRoom(
            docId,
            store,
            endpoint,
            converter,
            options,
            timeProvider,
            log,
            operationStore,
            activityObserver);
        room.Closed += OnRoomClosed;
        rooms[docId] = room;
      }

      return room;
    }
  }

  /// <summary>
  /// A document whose commit failed is refused for a doubling wait. Without it
  /// every reconnect through the outage would reload that document's baseline
  /// and tail from the store that is already in trouble.
  /// </summary>
  private bool InCommitCooldown(string docId)
  {
    lock (rooms)
    {
      return cooldowns.TryGetValue(docId, out var cooldown) &&
          timeProvider.GetUtcNow() < cooldown.Until;
    }
  }

  private void OnRoomClosed(CollabRoom room)
  {
    lock (rooms)
    {
      if (room.CommitUnavailable)
      {
        var failures = (cooldowns.TryGetValue(room.DocId, out var cooldown)
            ? cooldown.Failures
            : 0) + 1;

        cooldowns[room.DocId] = new CommitCooldown(
            failures,
            timeProvider.GetUtcNow() + options.Backoff(failures));
      }
      else
      {
        // The room served and closed for an ordinary reason, so the store is
        // no longer the problem: the next failure starts its wait over.
        cooldowns.Remove(room.DocId);
      }
    }

    Forget(room);
  }

  private void Forget(CollabRoom room)
  {
    lock (rooms)
    {
      if (rooms.TryGetValue(room.DocId, out var current) &&
          ReferenceEquals(current, room))
      {
        rooms.Remove(room.DocId);
      }
    }
  }
}
