using System.Buffers.Binary;
using Blok.Server.Yjs;

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

  /// <summary>Room-owned, touched only under the lane.</summary>
  internal int MalformedAwarenessFrames { get; set; }

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
/// One doc's sync room: a single-lane actor around a <see cref="YDoc"/>
/// (the doc is not thread-safe, so EVERY doc access — load, seed, apply,
/// observe, export, compaction, eviction — runs inside <see cref="RunAsync{T}"/>).
/// Methods suffixed "Locked" assume the lane is held and must never re-enter it.
///
/// Echo suppression: an emitted update says whether the transaction that made
/// it was LOCAL, and only those are recorded here (the seed and edit ops).
/// Remote updates are appended and relayed by the receive path itself, which
/// knows the sender.
/// </summary>
internal sealed class CollabRoom : IDisposable
{
  /// <summary>Malformed awareness frames one member may send before it is closed.</summary>
  private const int MalformedAwarenessLimit = 3;

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
  private readonly ITimer persistTimer;

  private RoomState state = RoomState.New;
  // Replaced by load-or-seed before the room turns Ready; a tag without a
  // lineage is never persisted and never announced.
  private CollabWorkingSetTag tag = new(
      CollabWorkingSetTag.SchemaV2,
      0,
      CollabWorkingSetTag.NoLineage);
  private YDoc? doc;
  private int frameCount;

  // The blob is behind the doc while blobVersion != persistedVersion; that
  // is the room's "persist behind" flag, and it is what keeps a room that
  // cannot write from being dropped.
  private long blobVersion;
  private long persistedVersion;
  private long persistingVersion;
  private Task? inFlightPersist;
  private int persistFailures;
  private string? version;
  private bool exportDirty;
  private DateTimeOffset? dirtySince;
  private DateTimeOffset? exportRetryAt;
  private int exportFailures;
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
    persistTimer = timeProvider.CreateTimer(
        _ => Post(() =>
        {
          SchedulePersistLocked();

          return Task.CompletedTask;
        }),
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

          if (cancellationToken.IsCancellationRequested)
          {
            // The joiner is gone but the room is Ready: without this the
            // linger would only ever be armed by a leave that never comes.
            UpdateEvictionLocked();
            cancellationToken.ThrowIfCancellationRequested();
          }

          var membership = new CollabMembership(this, member, tag);
          members.Add(membership);
          UpdateEvictionLocked();

          if (member.AcceptsControlFrames)
          {
            Send(membership, SyncWire.Encode(new BlokControlFrame(tag)));

            if (options.AnnouncedMaxMessageBytes is > 0)
            {
              Send(membership, SyncWire.Encode(
                  new BlokLimitsFrame(options.AnnouncedMaxMessageBytes.Value)));
            }
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
            ReceiveLocked(membership, frame);
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
          if (members.Remove(membership))
          {
            UpdateEvictionLocked();
          }

          return Task.CompletedTask;
        },
        CancellationToken.None));
  }

  /// <summary>
  /// Block-level edits from POST /sync/{doc}/edit. Null when the room has
  /// already closed — the caller should retry on a fresh room.
  ///
  /// Materializes the doc the way a join does, so "edit a document nobody has
  /// open" works. The write happens INSIDE the lane as a LOCAL transaction, so
  /// the update observer appends it to the log and broadcasts it to every
  /// member with no relay code here — but that observer
  /// does not run what a member write gets afterwards, so the trio is invoked
  /// explicitly or the edit reaches the connected tabs and nothing else: not
  /// the blob, not the consumer's endpoint.
  /// </summary>
  internal Task<CollabEditResult?> EditAsync(
      IReadOnlyList<CollabEditOp> ops,
      CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(ops);

    return RunAsync<CollabEditResult?>(
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

              return new CollabEditResult(CollabEditStatus.SeedFailed, failure);
            }
          }

          try
          {
            // Ready implies a loaded doc, as every other lane body assumes.
            converter.ApplyOps(doc!, ops);
          }
          catch (CollabEditException refusal)
          {
            return new CollabEditResult(CollabEditStatus.Invalid, refusal);
          }
          finally
          {
            // An edit is a path that can leave a Ready room with no members —
            // the room it just loaded to serve one HTTP request. Without this
            // the linger is never armed and the doc lives until the process
            // does. In the `finally` because a refusal loads the room too.
            UpdateEvictionLocked();
          }

          CompactIfOversizedLocked();
          SchedulePersistLocked();
          MarkDirtyLocked();

          return new CollabEditResult(CollabEditStatus.Applied, null);
        },
        cancellationToken);
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

          // A blob write may still be in the air with the pre-reset log and
          // tag; letting it land after the reset would undo it.
          await SettleInFlightPersistLocked();

          var next = new CollabWorkingSetTag(
              current.Format,
              current.Epoch + 1,
              CollabWorkingSetTag.NewLineage());
          await store.ResetAsync(DocId, next, cancellationToken);
          CloseLocked(CollabCloseReason.Reset);

          return next;
        },
        cancellationToken);
  }

  /// <summary>
  /// The token bounds the FLUSH, not the close: the server is going down, so
  /// a room whose store or endpoint fails still closes — otherwise one sick
  /// room would hold the shutdown open forever.
  /// </summary>
  internal Task DrainAsync(CancellationToken cancellationToken)
  {
    return RunAsync(
        async () =>
        {
          if (state == RoomState.Ready)
          {
            try
            {
              await FlushLocked(cancellationToken);
            }
            catch (Exception error)
            {
              log?.Invoke(
                  $"collab: room \"{DocId}\" could not flush while draining: {error.Message}");
            }
          }

          if (state != RoomState.Closed)
          {
            CloseLocked(CollabCloseReason.Draining);
          }
        },
        CancellationToken.None);
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
    persistTimer.Dispose();
    lifetime.Cancel();
    lifetime.Dispose();
    frameSection.Dispose();

    if (doc is not null)
    {
      doc.UpdateEmitted -= OnLocalUpdate;
      doc = null;
    }
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
      // A random uint32 client id by construction, as a browser draws: two
      // replicas sharing an id would corrupt the doc.
      doc = new YDoc();
      doc.UpdateEmitted += OnLocalUpdate;

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
      else if (CompactIfOversizedLocked())
      {
        await PersistLocked(lifetime.Token);
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

    // A seed is a brand-new CRDT history, so it gets a new lineage — the
    // epoch alone cannot tell it apart from the history a client cached
    // before the blob was lost or reset (see CollabWorkingSetTag). A null
    // document re-seeded under a lineage the store still holds creates no
    // history: minting one there would make every client that synced under
    // it throw away its offline edits.
    if (loaded.Data is not null || tag.Lineage == CollabWorkingSetTag.NoLineage)
    {
      tag = tag with { Lineage = CollabWorkingSetTag.NewLineage() };
    }

    // A null document is the endpoint's "nothing saved yet": an empty doc
    // with an empty log, which re-seeds on the next open. Never seed empty
    // on a failure — that path throws out of LoadAsync.
    if (loaded.Data is not null)
    {
      converter.Seed(doc!, loaded.Data);
    }

    // Awaited on purpose: a seed that cannot be written must fail the join
    // closed rather than serve a doc the store has never seen.
    await PersistLocked(lifetime.Token);
  }

  private void OnLocalUpdate(YUpdateEvent updateEvent)
  {
    // A remote update is appended and relayed by the receive path, which knows
    // who sent it; echoing it here would send it back to its own author.
    if (!updateEvent.Local)
    {
      return;
    }

    AppendLocked(updateEvent.Update);
    BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(updateEvent.Update)), null);
  }

  /// <summary>
  /// The pre-apply screen and the apply. Only Malformed and TooDeep are
  /// refused, and refusing is a log-and-DROP with no close; a NUL-bearing
  /// update is applied like any other (Locked Decision 9).
  /// </summary>
  private bool ApplyRemoteLocked(byte[] update)
  {
    var inspection = UpdateInspector.Inspect(update);

    if (inspection.Verdict != UpdateVerdict.Ok || inspection.Decoded is null)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" dropped an update it could not read: {inspection.Reason}");

      return false;
    }

    try
    {
      return doc!.ApplyUpdate(inspection.Decoded).Outcome == ApplyOutcome.Applied;
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped an update it could not apply: {error.Message}");

      return false;
    }
  }

  private void AppendLocked(byte[] update)
  {
    WriteFramePrefix(frameSection, update.Length);
    frameSection.Write(update);
    frameCount++;
    blobVersion++;
  }

  /// <summary>Writes the blob INSIDE the lane; only the seed and the flush may pay that.</summary>
  private async Task PersistLocked(CancellationToken cancellationToken)
  {
    var pending = blobVersion;
    await store.WriteAsync(DocId, frameSection.ToArray(), tag, cancellationToken);
    persistedVersion = pending;
    persistFailures = 0;
  }

  /// <summary>
  /// Starts the blob write BESIDE the lane, single-flight: the frame section
  /// is snapshotted while the lane is held and the store call runs outside
  /// it, so a slow store never stalls sync. Edits made while a write is in
  /// flight are coalesced into the next one.
  /// </summary>
  private void SchedulePersistLocked()
  {
    if (state != RoomState.Ready ||
        inFlightPersist is not null ||
        blobVersion == persistedVersion)
    {
      return;
    }

    persistingVersion = blobVersion;
    var write = WritePersistAsync(frameSection.ToArray(), tag);
    inFlightPersist = write;
    _ = ObservePersistAsync(write);
  }

  /// <summary>Waits out the off-lane write so nothing written after it can be overtaken.</summary>
  private async Task SettleInFlightPersistLocked()
  {
    if (inFlightPersist is null)
    {
      return;
    }

    var write = inFlightPersist;
    inFlightPersist = null;

    try
    {
      await write;
      persistedVersion = persistingVersion;
      persistFailures = 0;
    }
    catch (Exception error) when (!lifetime.IsCancellationRequested)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" could not persist the working set: {error.Message}");
    }
  }

  private async Task WritePersistAsync(byte[] frames, CollabWorkingSetTag written)
  {
    await store.WriteAsync(DocId, frames, written, lifetime.Token);
  }

  private async Task ObservePersistAsync(Task write)
  {
    Exception? failure = null;

    try
    {
      await write;
    }
    catch (Exception error)
    {
      failure = error;
    }

    Post(() =>
    {
      OnPersistFinishedLocked(write, failure);

      return Task.CompletedTask;
    });
  }

  private void OnPersistFinishedLocked(Task write, Exception? failure)
  {
    if (!ReferenceEquals(write, inFlightPersist))
    {
      return;
    }

    inFlightPersist = null;

    if (failure is null)
    {
      persistedVersion = persistingVersion;
      persistFailures = 0;
      SchedulePersistLocked();

      return;
    }

    if (lifetime.IsCancellationRequested)
    {
      return;
    }

    // The update lives in memory and in every member; the doc stays the
    // authority and the whole log is written again on the retry.
    log?.Invoke(
        $"collab: room \"{DocId}\" could not persist the working set: {failure.Message}");
    persistFailures++;
    persistTimer.Change(Backoff(persistFailures), Timeout.InfiniteTimeSpan);
  }

  private TimeSpan Backoff(int failures)
  {
    var steps = Math.Min(Math.Max(failures - 1, 0), 16);
    var delay = options.RetryBackoff * Math.Pow(2, steps);

    return delay < options.RetryBackoffCap ? delay : options.RetryBackoffCap;
  }

  /// <summary>True when the log was replaced by one full-state frame.</summary>
  private bool CompactIfOversizedLocked()
  {
    if (frameCount < 2 ||
        (frameCount < options.CompactionFrameThreshold &&
            frameSection.Length < options.CompactionByteThreshold))
    {
      return false;
    }

    CompactLocked();

    return true;
  }

  /// <summary>
  /// Replaces the log with the doc's whole state, which INCLUDES whatever the
  /// engine is still holding pending (Locked Decisions 4 and 5): an update
  /// that arrived before the one it depends on survives compaction and lands
  /// on a late joiner, which converges once the dependency arrives.
  /// </summary>
  private void CompactLocked()
  {
    var whole = doc!.EncodeStateAsUpdate();

    frameSection.SetLength(0);
    frameCount = 0;
    AppendLocked(whole);
  }

  private void ReceiveLocked(CollabMembership membership, byte[] frame)
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
        ApplyFromMemberLocked(membership, step2.Update);
        break;
      case SyncUpdateFrame update:
        ApplyFromMemberLocked(membership, update.Update);
        break;
      case AwarenessFrame awareness:
        RelayAwarenessLocked(membership, awareness);
        break;
      case QueryAwarenessFrame:
        BroadcastLocked(SyncWire.Encode(message), membership);
        break;
      default:
        break;
    }
  }

  /// <summary>
  /// Presence is relayed verbatim and never interpreted (plan decision 11) —
  /// from read-only members too, because a viewer belongs in the presence
  /// stack. It is still walked before the relay, because the frame is what
  /// every OTHER member pays: a stock client parses each entry and ends its
  /// session on one it cannot, and y-protocols never checks that a sender
  /// owns the client ids it encodes, so one member could fabricate a hundred
  /// thousand peers inside a frame under the message cap.
  ///
  /// Over the cap the frame is dropped, not the connection: presence is
  /// best-effort, so a genuinely huge room degrades to no presence instead
  /// of a reconnect loop, and the log keeps it visible. A MALFORMED frame is
  /// something no stock client sends, so it counts against the sender and
  /// the third one closes it.
  /// </summary>
  private void RelayAwarenessLocked(CollabMembership membership, AwarenessFrame awareness)
  {
    if (SyncWire.TryValidateAwarenessUpdate(
          awareness.Update,
          options.MaxAwarenessClients,
          out var clients))
    {
      BroadcastLocked(SyncWire.Encode(awareness), membership);

      return;
    }

    if (clients > options.MaxAwarenessClients)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" dropped an awareness frame claiming {clients} clients " +
          $"(the cap is {options.MaxAwarenessClients})");

      return;
    }

    membership.MalformedAwarenessFrames++;
    log?.Invoke(
        $"collab: room \"{DocId}\" dropped a malformed awareness frame " +
        $"({membership.MalformedAwarenessFrames} of {MalformedAwarenessLimit} from this member)");

    if (membership.MalformedAwarenessFrames >= MalformedAwarenessLimit)
    {
      ExpelLocked(membership, CollabCloseReason.BadAwareness);
    }
  }

  private void AnswerSyncStep1Locked(CollabMembership membership, byte[] peerStateVector)
  {
    byte[] diff;
    byte[] stateVector;

    try
    {
      diff = doc!.EncodeStateAsUpdate(peerStateVector);
      stateVector = doc.EncodeStateVector();
    }
    catch (FormatException error)
    {
      // The peer's state vector is the only thing here that can be malformed.
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

  private void ApplyFromMemberLocked(CollabMembership membership, byte[] update)
  {
    if (!membership.Member.CanWrite || !ApplyRemoteLocked(update))
    {
      return;
    }

    AppendLocked(update);
    BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(update)), membership);
    CompactIfOversizedLocked();
    SchedulePersistLocked();
    MarkDirtyLocked();
  }

  /// <summary>Stops serving one member and closes it; the room may be left empty, so the linger is re-armed.</summary>
  private void ExpelLocked(CollabMembership membership, CollabCloseReason reason)
  {
    members.Remove(membership);
    UpdateEvictionLocked();
    CloseMember(membership, reason);
  }

  private void CloseMember(CollabMembership membership, CollabCloseReason reason)
  {
    try
    {
      membership.Member.Close(reason);
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" could not close a member: {error.Message}");
    }
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

  /// <summary>
  /// The one place the linger is armed or disarmed: EVERY path that can leave
  /// the room empty (join, cancelled join, leave, a retried eviction) ends
  /// here, so a Ready room without members always has a timer.
  /// </summary>
  private void UpdateEvictionLocked(TimeSpan? linger = null)
  {
    if (state != RoomState.Ready)
    {
      return;
    }

    evictionTimer.Change(
        members.Count == 0
          ? linger ?? options.EvictionLinger
          : Timeout.InfiniteTimeSpan,
        Timeout.InfiniteTimeSpan);
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

    // A failed export waits out its backoff instead of retrying on every
    // tick for as long as the endpoint stays down.
    if (exportRetryAt is { } retry && retry > due)
    {
      due = retry;
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
      exportFailures++;
      exportRetryAt = timeProvider.GetUtcNow() + Backoff(exportFailures);
    }
    else
    {
      exportFailures = 0;
      exportRetryAt = null;

      if (answered is not null)
      {
        version = answered;
      }
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

    try
    {
      await FlushLocked(CancellationToken.None);
    }
    catch (Exception error)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" could not flush before eviction: {error.Message}");
    }

    if (state != RoomState.Ready || members.Count > 0)
    {
      return;
    }

    if (blobVersion != persistedVersion)
    {
      // Dropping the room now would leave the store holding a blob that is
      // missing these edits — and a blob with any frame in it is
      // authoritative on the next open, so the doc endpoint would never be
      // consulted to fill the gap. The doc stays in memory as the authority
      // until the write lands.
      persistFailures++;
      log?.Invoke(
          $"collab: room \"{DocId}\" is staying loaded until its working set is written");
      UpdateEvictionLocked(Backoff(persistFailures));

      return;
    }

    CloseLocked(null);
  }

  /// <summary>
  /// Compact + persist + export, all awaited; the blob is written even when
  /// the export fails. Failures are logged, not thrown: the caller decides
  /// what an unwritten blob means (eviction retries, a drain closes anyway).
  /// </summary>
  private async Task FlushLocked(CancellationToken cancellationToken)
  {
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(
        lifetime.Token,
        cancellationToken);

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

    // The in-flight write carries an older snapshot, so it has to land
    // before the final one — otherwise it could overwrite it.
    await SettleInFlightPersistLocked();

    if (frameCount > 1)
    {
      CompactLocked();
    }

    if (blobVersion != persistedVersion)
    {
      try
      {
        await PersistLocked(deadline.Token);
      }
      catch (Exception error) when (!lifetime.IsCancellationRequested)
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
      version = await endpoint.SaveAsync(DocId, snapshot, version, deadline.Token) ?? version;
      exportDirty = false;
      dirtySince = null;
      exportFailures = 0;
      exportRetryAt = null;
    }
    catch (Exception error) when (!lifetime.IsCancellationRequested)
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
        CloseMember(membership, reason.Value);
      }
    }

    members.Clear();
    Dispose();
    Closed?.Invoke(this);
  }
}
