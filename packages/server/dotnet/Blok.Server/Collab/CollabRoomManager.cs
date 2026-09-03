namespace Blok.Server.Collab;

internal enum CollabJoinStatus
{
  Joined,

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

  /// <summary>The server is going down; the endpoint answers 503.</summary>
  Draining,

  /// <summary>An op failed validation; nothing was written. The endpoint answers 422.</summary>
  Invalid,

  /// <summary>The doc endpoint could not seed the room; the endpoint answers 503.</summary>
  SeedFailed,

  /// <summary>
  /// The document cannot be served right now: another live process holds its
  /// journal, or a commit failure put it in its retry cooldown. The endpoint
  /// answers 503.
  /// </summary>
  Unavailable,
}

internal sealed record CollabEditResult(CollabEditStatus Status, Exception? Error);

/// <summary>
/// A reset the room refuses to perform.
///
/// TEMPORARY, and Task 3.5 removes it: an operation-store room's reset must be
/// a fenced journal transaction, and the working-set reset this room still
/// knows how to do would close every client with 4409 — which the client reads
/// as "relineage, discard your pending work" — while leaving the journal, the
/// thing the next room actually loads, exactly as it was. Refusing is the safe
/// half of that pair until the real reset exists.
/// </summary>
internal sealed class CollabResetUnavailableException(string docId)
    : Exception(
        $"collab: \"{docId}\" cannot be reset until its journal reset lands (Task 3.5).");

/// <summary>
/// Owns one <see cref="CollabRoom"/> per open doc. Rooms remove themselves
/// when they close (eviction, reset, seed failure, drain); a join that races
/// a closing room simply retries on a fresh one.
/// </summary>
internal sealed class CollabRoomManager : ICollabRoomManager
{
  private const int MaxJoinAttempts = 16;

  private readonly Dictionary<string, CollabRoom> rooms = new(StringComparer.Ordinal);
  private readonly Dictionary<string, CommitCooldown> cooldowns = new(StringComparer.Ordinal);
  private readonly ICollabWorkingSetStore store;
  private readonly ICollabOperationStore? operationStore;
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
      ICollabOperationStore? operationStore = null)
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
      if (draining)
      {
        return new CollabJoinResult(CollabJoinStatus.Draining, null, null);
      }

      if (InCommitCooldown(docId))
      {
        return new CollabJoinResult(CollabJoinStatus.Unavailable, null, null);
      }

      var room = RoomFor(docId);
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

  /// <summary>
  /// Bumps the doc's epoch (plan decision 5): empty log under epoch+1,
  /// members closed with <see cref="CollabCloseReason.Reset"/>, room
  /// dropped; the next join re-seeds from the doc endpoint.
  ///
  /// With an operation store registered this is REFUSED instead, before any
  /// room is touched — see <see cref="CollabResetUnavailableException"/>.
  /// </summary>
  internal async ValueTask<CollabWorkingSetTag> ResetAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

    // Ahead of RoomFor, which CONSTRUCTS and registers: a refusal thrown from
    // inside the room would strand the room the reset itself just created,
    // since only a null answer reaches Forget and a room that never turned
    // Ready arms no eviction timer.
    if (operationStore is not null)
    {
      throw new CollabResetUnavailableException(docId);
    }

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
      var room = RoomFor(docId);
      var tag = await room.ResetAsync(cancellationToken);

      if (tag is not null)
      {
        return tag.Value;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during reset.");
  }

  /// <summary>
  /// Block-level edits from the HTTP edit endpoint. Retries on a room that
  /// closes underneath, exactly as reset does.
  /// </summary>
  internal async ValueTask<CollabEditResult> EditAsync(
      string docId,
      IReadOnlyList<CollabEditOp> ops,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);
    ArgumentNullException.ThrowIfNull(ops);

    for (var attempt = 0; attempt < MaxJoinAttempts; attempt++)
    {
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
      var result = await room.EditAsync(ops, cancellationToken);

      if (result is not null)
      {
        return result;
      }

      Forget(room);
    }

    throw new InvalidOperationException(
        $"collab: the room for \"{docId}\" kept closing during an edit.");
  }

  /// <summary>Consecutive commit failures for one document, and when it may be loaded again.</summary>
  private sealed record CommitCooldown(int Failures, DateTimeOffset Until);

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

  /// <summary>Test hook: completes once every room has run the work queued before the call.</summary>
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

  private CollabRoom RoomFor(string docId)
  {
    lock (rooms)
    {
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
            operationStore);
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
