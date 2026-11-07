using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Mcp.Live;

/// <summary>Why a room stopped serving its handle: a relineage reset, or a terminal provider error.</summary>
internal sealed record RoomEnd(bool Reset, string? Terminal);

/// <summary>
/// One committed local write, for observers such as an undo manager.
/// <see cref="Transaction"/> holds BeforeState, AfterState and the DeleteSet;
/// the items it inserted are the store's structs between the two state vectors.
/// </summary>
internal sealed record LocalWrite(object Origin, YTransaction Transaction, byte[] Update);

/// <summary>
/// The headless room member (headless-session.ts): the local doc, the outbox,
/// the provider and the write path. Loop-owned, except <see cref="OpenAsync"/>.
/// </summary>
internal sealed class LiveRoom : IRoomSeam
{
  private readonly LiveLoop loop;
  private readonly Func<long> clock;
  private readonly List<byte[]> held = [];
  private LiveTimer? awarenessCheck;
  private int holds;
  private bool closed;

  private LiveRoom(LiveLoop loop, Func<long> clock)
  {
    this.loop = loop;
    this.clock = clock;
    Doc = NewDoc();
    Awareness = new LiveAwareness(Doc.ClientId, clock);
  }

  /// <summary>Raised on the loop after every local write's transaction, before its row is queued.</summary>
  internal event Action<LocalWrite>? LocalWriteCommitted;

  internal event Action<RoomEnd>? Ended;

  /// <summary>Raised after <see cref="RebuildFromRoom"/> swapped in a new doc.</summary>
  internal event Action? Rebuilt;

  internal LiveLoop Loop => loop;

  internal YDoc Doc { get; private set; }

  public LiveAwareness Awareness { get; private set; }

  internal LiveOutbox Outbox { get; } = new();

  internal RoomProvider Provider { get; private set; } = null!;

  /// <summary>Doc update events seen since the count started, peers' included: the live revision is "l" + this.</summary>
  internal int UpdateCount { get; private set; }

  internal int AppendFailures { get; private set; }

  internal RoomEnd? End { get; private set; }

  internal string Protocol => Provider.Protocol;

  /// <summary>Joins the room and waits for the first sync, as openHeadlessRoom does.</summary>
  internal static async Task<LiveRoom> OpenAsync(
      RoomConnector connect, RoomTicketSource? tickets, TimeSpan syncTimeout, CancellationToken cancellationToken)
  {
    var loop = new LiveLoop();
    var opened = new TaskCompletionSource<LiveRoom>(TaskCreationOptions.RunContinuationsAsynchronously);
    LiveRoom? room = null;

    await loop.RunAsync(() =>
    {
      room = new LiveRoom(loop, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
      var synced = false;
      LiveTimer? timer = null;

      room.Provider = new RoomProvider(loop, room, room.Outbox, connect, tickets, (status, error) =>
      {
        if (status == RoomStatus.Error)
        {
          timer?.Dispose();
          if (synced)
          {
            room.Finish(new RoomEnd(false, error));
          }
          else
          {
            opened.TrySetException(new LiveRoomTerminalException(error));
          }

          return;
        }
        if (status != RoomStatus.Connected || room.Provider.Tag is not { } tag)
        {
          return;
        }
        room.Outbox.RecordSession(tag.Lineage, tag.Format, room.Provider.Protocol);
        if (!synced)
        {
          synced = true;
          timer?.Dispose();
          opened.TrySetResult(room);
        }
      });
      timer = loop.Schedule(syncTimeout, () => opened.TrySetException(new TimeoutException("The room did not finish its first sync in time")));
      room.StartAwarenessCheck();
      room.Provider.Connect();
    });
    using var cancelled = cancellationToken.Register(() => opened.TrySetCanceled(cancellationToken));

    try
    {
      return await opened.Task;
    }
    catch
    {
      await room!.CloseAsync();
      throw;
    }
  }

  internal string Revision => $"l{UpdateCount}";

  /// <summary>Starts the revision count: Node's store session counts from its own creation.</summary>
  internal void ResetUpdateCount()
  {
    UpdateCount = 0;
  }

  /// <summary>
  /// The one local write path: ONE transaction under <paramref name="origin"/>,
  /// then ONE outbox row on v2 (or one Update frame on v1). Returns the update,
  /// or null when the body changed nothing. A failed append is counted, never thrown.
  /// </summary>
  internal byte[]? WriteLocal(object origin, Action<YTransaction> body)
  {
    YTransaction? captured = null;
    var update = Doc.Transact(transaction =>
    {
      captured = transaction;
      body(transaction);
    });

    if (update is null || captured is null)
    {
      return null;
    }
    LocalWriteCommitted?.Invoke(new LocalWrite(origin, captured, update));
    if (Provider.Protocol != "v2")
    {
      Provider.OnLocalUpdate(update);

      return update;
    }
    try
    {
      Outbox.AppendLocal(update);
      // Posted, so whatever the caller does next in this turn (Activity) goes out first.
      loop.Post(Provider.Drain);
    }
    catch (InvalidOperationException error)
    {
      AppendFailures += 1;
      Console.Error.WriteLine($"blok-mcp: a live write could not be queued: {error.Message}");
    }

    return update;
  }

  /// <summary>While held, inbound doc updates wait, so the doc stays as a batch exported it.</summary>
  internal void HoldDocFrames()
  {
    holds += 1;
  }

  internal void ReleaseDocFrames()
  {
    holds -= 1;
    if (holds > 0)
    {
      return;
    }
    var waiting = held.ToList();

    held.Clear();
    foreach (var update in waiting)
    {
      ApplyNow(update);
    }
  }

  internal void SetAwarenessField(string field, JsonNode? value)
  {
    Awareness.SetLocalStateField(field, value);
  }

  internal Task CloseAsync()
  {
    return loop.RunAsync(() =>
    {
      if (closed)
      {
        return;
      }
      closed = true;
      awarenessCheck?.Dispose();
      Provider?.Destroy();
    });
  }

  public byte[] StateVector()
  {
    return Doc.EncodeStateVector();
  }

  public byte[] EncodeStateAsUpdate(byte[]? stateVector)
  {
    return Doc.EncodeStateAsUpdate(stateVector ?? []);
  }

  public void ApplyRemote(byte[] update)
  {
    if (holds > 0)
    {
      held.Add(update);

      return;
    }
    ApplyNow(update);
  }

  public void ResetForRelineage()
  {
    SwapDoc();
    // The agent read the old doc; after the swap its view is gone.
    Finish(new RoomEnd(true, null));
  }

  public void RebuildFromRoom()
  {
    SwapDoc();
    Rebuilt?.Invoke();
  }

  private void SwapDoc()
  {
    var local = Awareness.LocalState;

    held.Clear();
    Doc = NewDoc();
    Awareness = new LiveAwareness(Doc.ClientId, clock);
    if (local is not null)
    {
      Awareness.SetLocalState(local);
    }
  }

  private YDoc NewDoc()
  {
    // No content GC: an undo manager reads deleted items after the write, and YDoc collects them before observers run.
    var doc = new YDoc { Gc = false };

    doc.UpdateEmitted += _ => UpdateCount += 1;

    return doc;
  }

  private void ApplyNow(byte[] update)
  {
    var result = Doc.ApplyUpdate(update);

    if (result.Outcome == ApplyOutcome.Malformed)
    {
      throw new InvalidDataException($"A room update could not be applied: {result.Reason}");
    }
  }

  /// <summary>Ends the room for its handle; the first end wins.</summary>
  internal void EndWith(RoomEnd end)
  {
    Finish(end);
  }

  private void Finish(RoomEnd end)
  {
    if (End is not null)
    {
      return;
    }
    End = end;
    Ended?.Invoke(end);
  }

  private void StartAwarenessCheck()
  {
    awarenessCheck = loop.Schedule(TimeSpan.FromMilliseconds(LiveAwareness.OutdatedTimeoutMs / 10), () =>
    {
      Awareness.Check();
      if (!closed)
      {
        StartAwarenessCheck();
      }
    });
  }
}

/// <summary>The provider ended before the first sync with a terminal error (HeadlessRoomTerminalError).</summary>
internal sealed class LiveRoomTerminalException(string? terminal) : Exception($"The room refused the connection: {terminal ?? "unknown"}")
{
  internal string? Terminal { get; } = terminal;
}
