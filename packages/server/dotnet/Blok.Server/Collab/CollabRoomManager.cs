namespace Blok.Server.Collab;

internal enum CollabJoinStatus
{
  Joined,

  /// <summary>The doc endpoint could not seed the room; the endpoint closes 4503 and the next join retries.</summary>
  SeedFailed,

  /// <summary>The server is shutting down; new sessions are refused.</summary>
  Draining,
}

internal sealed record CollabJoinResult(
    CollabJoinStatus Status,
    CollabMembership? Membership,
    Exception? Error);

/// <summary>
/// Owns one <see cref="CollabRoom"/> per open doc. Rooms remove themselves
/// when they close (eviction, reset, seed failure, drain); a join that races
/// a closing room simply retries on a fresh one.
/// </summary>
internal sealed class CollabRoomManager : ICollabRoomManager
{
  private const int MaxJoinAttempts = 16;

  private readonly Dictionary<string, CollabRoom> rooms = new(StringComparer.Ordinal);
  private readonly ICollabWorkingSetStore store;
  private readonly IDocEndpointClient endpoint;
  private readonly ICollabDocConverter converter;
  private readonly CollabRoomOptions options;
  private readonly TimeProvider timeProvider;
  private readonly Action<string>? log;
  private int closedRoomsMaxLaneDepth;
  private volatile bool draining;

  internal CollabRoomManager(
      ICollabWorkingSetStore store,
      IDocEndpointClient endpoint,
      ICollabDocConverter converter,
      CollabRoomOptions options,
      TimeProvider timeProvider,
      Action<string>? log = null)
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

  /// <summary>Highest lane depth any room ever observed; 1 proves every doc access was serialized.</summary>
  internal int MaxLaneDepth
  {
    get
    {
      var depth = Volatile.Read(ref closedRoomsMaxLaneDepth);

      foreach (var room in LiveRooms())
      {
        depth = Math.Max(depth, room.MaxLaneDepth);
      }

      return depth;
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
  /// </summary>
  internal async ValueTask<CollabWorkingSetTag> ResetAsync(
      string docId,
      CancellationToken cancellationToken = default)
  {
    ArgumentException.ThrowIfNullOrEmpty(docId);

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
            log);
        room.Closed += OnRoomClosed;
        rooms[docId] = room;
      }

      return room;
    }
  }

  private void OnRoomClosed(CollabRoom room)
  {
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

    int seen;

    do
    {
      seen = Volatile.Read(ref closedRoomsMaxLaneDepth);
    }
    while (room.MaxLaneDepth > seen &&
        Interlocked.CompareExchange(ref closedRoomsMaxLaneDepth, room.MaxLaneDepth, seen) != seen);
  }
}
