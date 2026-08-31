using System.Buffers.Binary;
using System.Security.Cryptography;
using YDotNet.Document;
using YDotNet.Document.Events;
using YDotNet.Document.Options;
using YDotNet.Document.Transactions;

namespace Blok.Server.Collab;

/// <summary>
/// A member's handle onto its room; the sync endpoint pumps inbound frames
/// through <see cref="ReceiveAsync"/> and calls <see cref="LeaveAsync"/> when
/// the connection ends.
/// </summary>
internal sealed class CollabMembership
{
  private readonly CollabRoom room;

  internal CollabMembership(
      CollabRoom room,
      ICollabMember member,
      CollabWorkingSetTag tag)
  {
    this.room = room;
    Member = member;
    Tag = tag;
  }

  internal ICollabMember Member { get; }

  /// <summary>The working-set tag the member joined under (already sent as the control frame when negotiated).</summary>
  internal CollabWorkingSetTag Tag { get; }

  public ValueTask ReceiveAsync(
      byte[] frame,
      CancellationToken cancellationToken = default)
  {
    return room.ReceiveAsync(this, frame, cancellationToken);
  }

  public ValueTask LeaveAsync()
  {
    return room.LeaveAsync(this);
  }
}

/// <summary>
/// One doc's sync room: a single-lane actor around a YDotNet <see cref="Doc"/>
/// (the Doc is not thread-safe, so EVERY doc access — load, seed, apply,
/// observe, export, compaction, eviction — runs inside <see cref="RunAsync{T}"/>).
/// Methods suffixed "Locked" assume the lane is held and must never re-enter it.
///
/// Echo suppression: yrs update events carry no origin, so
/// <see cref="applyingRemote"/> is raised around every ApplyV1 and the
/// observer only records LOCAL commits (the seed). Remote updates are
/// appended and relayed by the receive path itself, which knows the sender.
/// </summary>
internal sealed class CollabRoom : IDisposable
{
  // lib0 encoding of an empty state vector: a diff against it is the whole doc.
  private static readonly byte[] EmptyStateVector = [0];
  private static readonly byte[] QueryAwareness =
      SyncWire.Encode(new QueryAwarenessFrame());

  private readonly ICollabWorkingSetStore store;
  private readonly IDocEndpointClient endpoint;
  private readonly ICollabDocConverter converter;
  private readonly CollabRoomOptions options;
  private readonly TimeProvider timeProvider;
  private readonly Action<string>? log;
  private readonly SemaphoreSlim lane = new(1, 1);
  private readonly CancellationTokenSource lifetime = new();
  private readonly HashSet<CollabMembership> members = [];
  private readonly MemoryStream frameSection = new();
  private readonly ITimer exportTimer;
  private readonly ITimer evictionTimer;

  private RoomState state = RoomState.New;
  private CollabWorkingSetTag tag = new(CollabWorkingSetTag.SchemaV2, 0);
  private Doc? doc;
  private IDisposable? updates;
  private bool applyingRemote;
  private int frameCount;
  private bool blobDirty;
  private string? version;
  private bool exportDirty;
  private DateTimeOffset? dirtySince;
  private Task<string?>? inFlightSave;
  private int laneDepth;
  private int maxLaneDepth;

  internal CollabRoom(
      string docId,
      ICollabWorkingSetStore store,
      IDocEndpointClient endpoint,
      ICollabDocConverter converter,
      CollabRoomOptions options,
      TimeProvider timeProvider,
      Action<string>? log)
  {
    DocId = docId;
    this.store = store;
    this.endpoint = endpoint;
    this.converter = converter;
    this.options = options;
    this.timeProvider = timeProvider;
    this.log = log;
    exportTimer = timeProvider.CreateTimer(
        _ => Post(TryExportLocked),
        null,
        Timeout.InfiniteTimeSpan,
        Timeout.InfiniteTimeSpan);
    evictionTimer = timeProvider.CreateTimer(
        _ => Post(EvictLocked),
        null,
        Timeout.InfiniteTimeSpan,
        Timeout.InfiniteTimeSpan);
  }

  private enum RoomState
  {
    New,
    Ready,
    Closed,
  }

  /// <summary>Raised inside the lane, exactly once, when the room stops serving.</summary>
  internal event Action<CollabRoom>? Closed;

  internal string DocId { get; }

  /// <summary>Highest number of concurrent lane entries observed; 1 proves serialization.</summary>
  internal int MaxLaneDepth => Volatile.Read(ref maxLaneDepth);

  /// <summary>Null when the room has already closed — the caller should retry on a fresh room.</summary>
  internal Task<CollabJoinResult?> JoinAsync(
      ICollabMember member,
      CancellationToken cancellationToken)
  {
    return RunAsync(
        async () =>
        {
          if (state == RoomState.Closed)
          {
            return null;
          }

          if (state == RoomState.New)
          {
            var failure = await TryLoadLocked();

            if (failure is not null)
            {
              CloseLocked(null);

              return new CollabJoinResult(CollabJoinStatus.SeedFailed, null, failure);
            }
          }

          cancellationToken.ThrowIfCancellationRequested();

          var membership = new CollabMembership(this, member, tag);
          members.Add(membership);
          evictionTimer.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);

          if (member.AcceptsControlFrames)
          {
            Send(membership, SyncWire.Encode(new BlokControlFrame(tag)));
          }

          BroadcastLocked(QueryAwareness, membership);

          return new CollabJoinResult(CollabJoinStatus.Joined, membership, null);
        },
        cancellationToken);
  }

  internal ValueTask ReceiveAsync(
      CollabMembership membership,
      byte[] frame,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(frame);

    return new ValueTask(RunAsync(
        () =>
        {
          if (state == RoomState.Ready && members.Contains(membership))
          {
            return ReceiveLocked(membership, frame);
          }

          return Task.CompletedTask;
        },
        cancellationToken));
  }

  internal ValueTask LeaveAsync(CollabMembership membership)
  {
    return new ValueTask(RunAsync(
        () =>
        {
          if (members.Remove(membership) &&
              members.Count == 0 &&
              state == RoomState.Ready)
          {
            evictionTimer.Change(options.EvictionLinger, Timeout.InfiniteTimeSpan);
          }

          return Task.CompletedTask;
        },
        CancellationToken.None));
  }

  /// <summary>Null when the room has already closed — the caller should retry on a fresh room.</summary>
  internal Task<CollabWorkingSetTag?> ResetAsync(CancellationToken cancellationToken)
  {
    return RunAsync<CollabWorkingSetTag?>(
        async () =>
        {
          if (state == RoomState.Closed)
          {
            return null;
          }

          var current = tag;

          if (state == RoomState.New)
          {
            var stored = await store.ReadAsync(DocId, cancellationToken);
            current = stored?.Tag ?? current;
          }

          var next = new CollabWorkingSetTag(current.Format, current.Epoch + 1);
          await store.ResetAsync(DocId, next, cancellationToken);
          CloseLocked(CollabCloseReason.Reset);

          return next;
        },
        cancellationToken);
  }

  internal Task DrainAsync(CancellationToken cancellationToken)
  {
    return RunAsync(
        async () =>
        {
          if (state == RoomState.Ready)
          {
            await FlushLocked();
          }

          if (state != RoomState.Closed)
          {
            CloseLocked(CollabCloseReason.Draining);
          }
        },
        cancellationToken);
  }

  /// <summary>Completes once every lane operation queued before it has run.</summary>
  internal Task SettleAsync()
  {
    return RunAsync(() => Task.CompletedTask, CancellationToken.None);
  }

  /// <summary>
  /// Idempotent; also runs when the room closes itself. The lane is left
  /// alone on purpose: a late timer or save continuation may still enter it,
  /// and a SemaphoreSlim holds no unmanaged resources until its wait handle
  /// is read.
  /// </summary>
  public void Dispose()
  {
    exportTimer.Dispose();
    evictionTimer.Dispose();
    lifetime.Cancel();
    lifetime.Dispose();
    frameSection.Dispose();
    updates?.Dispose();
    updates = null;
    doc?.Dispose();
    doc = null;
  }

  private static void WriteFramePrefix(Stream stream, int length)
  {
    Span<byte> prefix = stackalloc byte[sizeof(int)];
    BinaryPrimitives.WriteInt32LittleEndian(prefix, length);
    stream.Write(prefix);
  }

  private async Task<T> RunAsync<T>(
      Func<Task<T>> operation,
      CancellationToken cancellationToken)
  {
    await lane.WaitAsync(cancellationToken);
    var depth = Interlocked.Increment(ref laneDepth);
    RecordLaneDepth(depth);

    try
    {
      return await operation();
    }
    finally
    {
      Interlocked.Decrement(ref laneDepth);
      lane.Release();
    }
  }

  private async Task RunAsync(Func<Task> operation, CancellationToken cancellationToken)
  {
    await RunAsync<object?>(
        async () =>
        {
          await operation();

          return null;
        },
        cancellationToken);
  }

  private void RecordLaneDepth(int depth)
  {
    int seen;

    do
    {
      seen = Volatile.Read(ref maxLaneDepth);
    }
    while (depth > seen &&
        Interlocked.CompareExchange(ref maxLaneDepth, depth, seen) != seen);
  }

  /// <summary>Fire-and-forget lane entry for timer callbacks; nothing here may throw past the lane.</summary>
  private void Post(Func<Task> operation)
  {
    _ = PostAsync(operation);
  }

  private async Task PostAsync(Func<Task> operation)
  {
    try
    {
      await RunAsync(operation, CancellationToken.None);
    }
    catch (ObjectDisposedException)
    {
      // A timer or save continuation that outlived the room.
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" background work failed: {error.Message}");
    }
  }

  /// <summary>Load-or-seed. Returns the failure instead of throwing so the join can report SeedFailed.</summary>
  private async Task<Exception?> TryLoadLocked()
  {
    try
    {
      // YDotNet's default client id is not unique across Docs (a 50-doc
      // probe yielded 15 distinct ids); two replicas sharing an id corrupt
      // the doc. Browsers draw a random uint32, so the seed does the same.
      doc = new Doc(new DocOptions
      {
        Id = BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(sizeof(uint))),
      });
      updates = doc.ObserveUpdatesV1(OnLocalUpdate);

      var stored = await store.ReadAsync(DocId, lifetime.Token);

      if (stored is not null)
      {
        tag = stored.Tag;
        HydrateLocked(stored.Updates);
      }

      if (frameCount == 0)
      {
        await SeedLocked();
      }
      else if (frameCount >= options.CompactionFrameThreshold ||
          frameSection.Length >= options.CompactionByteThreshold)
      {
        CompactLocked();
        await PersistLocked();
      }

      state = RoomState.Ready;

      return null;
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" could not load: {error.Message}");

      return error;
    }
  }

  private void HydrateLocked(byte[] storedFrames)
  {
    if (!CollabWorkingSetCodec.TryDecodeFrames(storedFrames, out var frames))
    {
      throw new InvalidDataException(
          $"collab: the stored working set for \"{DocId}\" is not a valid update log.");
    }

    foreach (var frame in frames)
    {
      if (!ApplyRemoteLocked(frame))
      {
        throw new InvalidDataException(
            $"collab: a stored update for \"{DocId}\" could not be applied.");
      }
    }

    frameSection.Write(storedFrames);
    frameCount = frames.Count;
  }

  private async Task SeedLocked()
  {
    var loaded = await endpoint.LoadAsync(DocId, lifetime.Token);
    version = loaded.Version;

    // A null document is the endpoint's "nothing saved yet": an empty doc
    // with an empty log, which re-seeds on the next open. Never seed empty
    // on a failure — that path throws out of LoadAsync.
    if (loaded.Data is not null)
    {
      converter.Seed(doc!, loaded.Data);
    }

    await PersistLocked();
  }

  private void OnLocalUpdate(UpdateEvent updateEvent)
  {
    if (applyingRemote)
    {
      return;
    }

    AppendLocked(updateEvent.Update);
    BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(updateEvent.Update)), null);
  }

  private bool ApplyRemoteLocked(byte[] update)
  {
    applyingRemote = true;

    try
    {
      using var transaction = doc!.WriteTransaction();

      return transaction.ApplyV1(update) == TransactionUpdateResult.Ok;
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped an update it could not apply: {error.Message}");

      return false;
    }
    finally
    {
      applyingRemote = false;
    }
  }

  private void AppendLocked(byte[] update)
  {
    WriteFramePrefix(frameSection, update.Length);
    frameSection.Write(update);
    frameCount++;
    blobDirty = true;
  }

  private async Task PersistLocked()
  {
    await store.WriteAsync(DocId, frameSection.ToArray(), tag, lifetime.Token);
    blobDirty = false;
  }

  private void CompactLocked()
  {
    byte[] whole;

    using (var transaction = doc!.ReadTransaction())
    {
      whole = transaction.StateDiffV1(EmptyStateVector);
    }

    frameSection.SetLength(0);
    frameCount = 0;
    AppendLocked(whole);
  }

  private async Task ReceiveLocked(CollabMembership membership, byte[] frame)
  {
    if (!SyncWire.TryDecode(frame, out var message, out var error))
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped a frame: {error}");

      return;
    }

    switch (message)
    {
      case SyncStep1Frame step1:
        AnswerSyncStep1Locked(membership, step1.StateVector);
        break;
      case SyncStep2Frame step2:
        await ApplyFromMemberLocked(membership, step2.Update);
        break;
      case SyncUpdateFrame update:
        await ApplyFromMemberLocked(membership, update.Update);
        break;
      case AwarenessFrame:
      case QueryAwarenessFrame:
        BroadcastLocked(SyncWire.Encode(message), membership);
        break;
      default:
        break;
    }
  }

  private void AnswerSyncStep1Locked(CollabMembership membership, byte[] peerStateVector)
  {
    byte[] diff;
    byte[] stateVector;

    try
    {
      using var transaction = doc!.ReadTransaction();
      diff = transaction.StateDiffV1(peerStateVector);
      stateVector = transaction.StateVectorV1();
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped a SyncStep1 it could not answer: {error.Message}");

      return;
    }

    if (diff is not { Length: > 0 } || stateVector is not { Length: > 0 })
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped a SyncStep1 with an unusable state vector");

      return;
    }

    Send(membership, SyncWire.Encode(new SyncStep2Frame(diff)));
    Send(membership, SyncWire.Encode(new SyncStep1Frame(stateVector)));
  }

  private async Task ApplyFromMemberLocked(CollabMembership membership, byte[] update)
  {
    if (!membership.Member.CanWrite || !ApplyRemoteLocked(update))
    {
      return;
    }

    AppendLocked(update);
    BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(update)), membership);

    try
    {
      await PersistLocked();
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
      // The update lives in memory and in every member; the next write
      // carries the whole log again.
      log?.Invoke($"collab: room \"{DocId}\" could not persist the working set: {error.Message}");
    }

    MarkDirtyLocked();
  }

  private void BroadcastLocked(byte[] frame, CollabMembership? except)
  {
    foreach (var membership in members)
    {
      if (!ReferenceEquals(membership, except))
      {
        Send(membership, frame);
      }
    }
  }

  private void Send(CollabMembership membership, byte[] frame)
  {
    try
    {
      membership.Member.Send(frame);
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" could not hand a frame to a member: {error.Message}");
    }
  }

  private void MarkDirtyLocked()
  {
    exportDirty = true;
    dirtySince ??= timeProvider.GetUtcNow();
    ScheduleExportLocked();
  }

  private void ScheduleExportLocked()
  {
    if (inFlightSave is not null || dirtySince is null)
    {
      return;
    }

    var now = timeProvider.GetUtcNow();
    var due = now + options.ExportDebounce;
    var latest = dirtySince.Value + options.ExportMaxDelay;

    if (latest < due)
    {
      due = latest;
    }

    var delay = due - now;
    exportTimer.Change(
        delay < TimeSpan.Zero ? TimeSpan.Zero : delay,
        Timeout.InfiniteTimeSpan);
  }

  private Task TryExportLocked()
  {
    if (state != RoomState.Ready || !exportDirty || inFlightSave is not null)
    {
      return Task.CompletedTask;
    }

    var snapshot = converter.Export(doc!);
    exportDirty = false;
    dirtySince = null;

    // Only the JSON snapshot is taken under the lane; the PUT runs beside
    // it so a slow endpoint never stalls sync. Single flight keeps PUTs
    // ordered.
    var save = endpoint.SaveAsync(DocId, snapshot, version, lifetime.Token);
    inFlightSave = save;
    _ = ObserveSaveAsync(save);

    return Task.CompletedTask;
  }

  private async Task ObserveSaveAsync(Task<string?> save)
  {
    string? answered = null;
    Exception? failure = null;

    try
    {
      answered = await save;
    }
    catch (Exception error)
    {
      failure = error;
    }

    Post(() =>
    {
      OnSaveFinishedLocked(save, answered, failure);

      return Task.CompletedTask;
    });
  }

  private void OnSaveFinishedLocked(Task<string?> save, string? answered, Exception? failure)
  {
    if (!ReferenceEquals(save, inFlightSave))
    {
      return;
    }

    inFlightSave = null;

    if (state != RoomState.Ready)
    {
      return;
    }

    if (failure is not null)
    {
      log?.Invoke($"collab: room \"{DocId}\" export failed, retrying: {failure.Message}");
      exportDirty = true;
      dirtySince ??= timeProvider.GetUtcNow();
    }
    else if (answered is not null)
    {
      version = answered;
    }

    if (exportDirty)
    {
      ScheduleExportLocked();
    }
  }

  private async Task EvictLocked()
  {
    if (state != RoomState.Ready || members.Count > 0)
    {
      return;
    }

    await FlushLocked();
    CloseLocked(null);
  }

  /// <summary>Compact + persist + export; the blob is written even when the export fails.</summary>
  private async Task FlushLocked()
  {
    if (inFlightSave is not null)
    {
      try
      {
        version = await inFlightSave ?? version;
      }
      catch (Exception error)
      {
        log?.Invoke($"collab: room \"{DocId}\" export failed during flush: {error.Message}");
        exportDirty = true;
      }

      inFlightSave = null;
    }

    if (frameCount > 1)
    {
      CompactLocked();
    }

    if (blobDirty)
    {
      try
      {
        await PersistLocked();
      }
      catch (Exception error) when (error is not OperationCanceledException)
      {
        log?.Invoke($"collab: room \"{DocId}\" could not flush the working set: {error.Message}");
      }
    }

    if (!exportDirty)
    {
      return;
    }

    try
    {
      var snapshot = converter.Export(doc!);
      version = await endpoint.SaveAsync(DocId, snapshot, version, lifetime.Token) ?? version;
      exportDirty = false;
      dirtySince = null;
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
      log?.Invoke($"collab: room \"{DocId}\" could not export during flush: {error.Message}");
    }
  }

  private void CloseLocked(CollabCloseReason? reason)
  {
    state = RoomState.Closed;

    if (reason is not null)
    {
      foreach (var membership in members)
      {
        try
        {
          membership.Member.Close(reason.Value);
        }
        catch (Exception error)
        {
          log?.Invoke($"collab: room \"{DocId}\" could not close a member: {error.Message}");
        }
      }
    }

    members.Clear();
    Dispose();
    Closed?.Invoke(this);
  }
}
