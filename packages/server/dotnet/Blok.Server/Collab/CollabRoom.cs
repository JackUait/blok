using System.Security.Cryptography;
using System.Text.Json.Nodes;
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

  /// <summary>
  /// Set once the room has queued ITS SyncStep2 to this member. A v2
  /// operation before that point is refused as not-synced. Room-owned,
  /// touched only under the lane.
  /// </summary>
  internal bool Synced { get; set; }

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
///
/// With an <see cref="ICollabOperationStore"/> the room holds one fenced
/// session for its whole life, and a v2 operation is journalled before anyone
/// can see it. Without one the room relays and schedules a blob write exactly
/// as it always did — the commit primitive runs only while a session is open.
/// </summary>
internal sealed class CollabRoom : IDisposable
{
  /// <summary>Malformed awareness frames one member may send before it is closed.</summary>
  private const int MalformedAwarenessLimit = 3;

  /// <summary>Consecutive checkpoint failures the room tolerates before it stops serving.</summary>
  private const int CheckpointFailureLimit = 3;

  private static readonly byte[] QueryAwareness =
      SyncWire.Encode(new QueryAwarenessFrame());

  private readonly ICollabWorkingSetStore store;
  private readonly ICollabOperationStore? operationStore;
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

  // What the last LOCAL transaction emitted, waiting for its caller to decide
  // when it becomes observable.
  private readonly List<byte[]> localUpdates = [];

  private RoomState state = RoomState.New;
  // Replaced by load-or-seed before the room turns Ready; a tag without a
  // lineage is never persisted and never announced.
  private CollabWorkingSetTag tag = new(
      CollabWorkingSetTag.SchemaV2,
      0,
      CollabWorkingSetTag.NoLineage);
  private YDoc? doc;
  private ICollabOperationSession? session;
  private int frameCount;

  // Bytes of the full-state frame the last in-room compaction left at the
  // head of the log; 0 until one has run. Excluded when measuring the log
  // against the byte threshold, or a state that is itself over the
  // threshold would compact again on every update.
  private long baseFrameLength;

  // Highest sequence this room has committed, and the highest a checkpoint
  // covers. Both restart from the head at load: a fresh room inherits the
  // journal's position rather than counting from zero.
  private ulong committedThrough;
  private ulong checkpointedThrough;
  private int checkpointFailures;

  // The blob is behind the doc while blobVersion != persistedVersion; that
  // is the room's "persist behind" flag, and it is what keeps a room that
  // cannot write from being dropped.
  private long blobVersion;
  private long persistedVersion;
  private long persistingVersion;
  private Task? inFlightPersist;
  private int persistFailures;
  private string? version;

  // The consumer's version handle, read BESIDE the room at load. Started
  // there so the version it captures predates anything the host saved after
  // the room began diverging from the record; awaited only where a PUT is
  // built, because the load runs with the lane and the journal fence held and
  // an acknowledgement must never wait on the endpoint.
  private Task<string?>? pendingVersion;
  private bool exportDirty;

  // A checkpoint's projection, still owed. Distinct from exportDirty
  // because ScheduleExport is a no-op behind an in-flight save, so the
  // save's completion is the only place left that can arm it.
  private bool projectionOwed;
  private bool projectionRefused;
  private DateTimeOffset? dirtySince;
  private DateTimeOffset? exportRetryAt;
  private int exportFailures;
  private Task<string?>? inFlightSave;
  private bool disposed;

  internal CollabRoom(
      string docId,
      ICollabWorkingSetStore store,
      IDocEndpointClient endpoint,
      ICollabDocConverter converter,
      CollabRoomOptions options,
      TimeProvider timeProvider,
      Action<string>? log,
      ICollabOperationStore? operationStore = null)
  {
    DocId = docId;
    this.store = store;
    this.operationStore = operationStore;
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

  /// <summary>
  /// Why a load produced no Ready room. Unavailable is "come back later" — the
  /// document is held by another process — and carries no error because
  /// nothing went wrong.
  /// </summary>
  private readonly record struct LoadFailure(bool Unavailable, Exception? Error);

  /// <summary>Raised inside the lane, exactly once, when the room stops serving.</summary>
  internal event Action<CollabRoom>? Closed;

  internal string DocId { get; }

  /// <summary>
  /// True when the room stopped because it could not commit: an append that
  /// failed, one whose outcome cannot be known, or a store that could not
  /// answer at all. Read by the manager when <see cref="Closed"/> fires, to
  /// hold the document off until the store has had time to recover.
  /// </summary>
  internal bool CommitUnavailable { get; private set; }

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
            if (await TryLoadLocked() is { } failure)
            {
              await CloseRoomLocked(null);

              return new CollabJoinResult(
                  failure.Unavailable
                    ? CollabJoinStatus.Unavailable
                    : CollabJoinStatus.SeedFailed,
                  null,
                  failure.Error);
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
        async () =>
        {
          if (state == RoomState.Ready && members.Contains(membership))
          {
            await ReceiveLocked(membership, frame);
          }
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
  /// </summary>
  internal Task<CollabEditResult?> EditAsync(
      IReadOnlyList<CollabEditOp> ops,
      string operationId,
      ReadOnlyMemory<byte> digest,
      string? actorId,
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
            if (await TryLoadLocked() is { } failure)
            {
              await CloseRoomLocked(null);

              return new CollabEditResult(
                  failure.Unavailable
                    ? CollabEditStatus.Unavailable
                    : CollabEditStatus.SeedFailed,
                  failure.Error);
            }
          }

          if (session is not null)
          {
            CollabOperationLookup committed;

            try
            {
              using var deadline = new CancellationTokenSource(options.CommitTimeout, timeProvider);
              using var bounded = CancellationTokenSource.CreateLinkedTokenSource(
                  lifetime.Token,
                  deadline.Token);
              committed = await session.FindCommittedAsync(operationId, digest, bounded.Token);
            }
            catch (Exception error)
            {
              await FailCommitLocked("look up an operation id", error);

              return new CollabEditResult(CollabEditStatus.Unavailable, null);
            }

            switch (committed.Outcome)
            {
              case CollabOperationLookupOutcome.Duplicate:
                return new CollabEditResult(
                    CollabEditStatus.Applied,
                    null,
                    new CollabEditReceipt(tag, committed.ServerSequence));

              case CollabOperationLookupOutcome.Conflict:
                return new CollabEditResult(CollabEditStatus.Conflict, null);
            }
          }

          localUpdates.Clear();

          if (session is null)
          {
            try
            {
              converter.ApplyOps(doc!, ops);
            }
            catch (CollabEditException refusal)
            {
              return new CollabEditResult(CollabEditStatus.Invalid, refusal);
            }
            finally
            {
              PublishLocalUpdatesLocked();
              UpdateEvictionLocked();
            }

            CompactIfOversizedLocked();
            await SettleInFlightPersistLocked();

            try
            {
              await PersistLocked(lifetime.Token);
            }
            catch (Exception error) when (!lifetime.IsCancellationRequested)
            {
              log?.Invoke(
                  $"collab: room \"{DocId}\" could not persist an edit, retrying: {error.Message}");
              SchedulePersistLocked();
            }

            MarkDirtyLocked();

            return new CollabEditResult(CollabEditStatus.Applied, null);
          }

          try
          {
            converter.ApplyOps(doc!, ops);

            // One update is what the append journals; zero or many means the
            // document moved by bytes the journal would never see.
            if (localUpdates.Count != 1)
            {
              throw new InvalidOperationException(
                  $"collab: applying an edit emitted {localUpdates.Count} local updates.");
            }
          }
          catch (CollabEditException refusal)
          {
            localUpdates.Clear();
            UpdateEvictionLocked();

            return new CollabEditResult(CollabEditStatus.Invalid, refusal);
          }
          catch (Exception error)
          {
            // Not a refusal: the converter may have written part of the edit
            // and still failed, and a write-time failure can retain that
            // mutation without emitting an update at all (see YDocConverter).
            // The room is holding state no append can journal, so it goes
            // rather than serving an export or a later edit from it.
            localUpdates.Clear();
            await FailCommitLocked("apply an edit", error);

            return new CollabEditResult(CollabEditStatus.Unavailable, null);
          }

          var update = localUpdates[0];
          var sequence = await AppendCommittedLocked(
              operationId,
              actorId,
              CollabOperationSource.HttpEdit,
              update,
              digest);

          if (sequence is null)
          {
            return new CollabEditResult(CollabEditStatus.Unavailable, null);
          }

          PublishLocalUpdatesLocked();
          CompactIfOversizedLocked();
          SchedulePersistLocked();
          MarkDirtyLocked();
          UpdateEvictionLocked();

          return new CollabEditResult(
              CollabEditStatus.Applied,
              null,
              new CollabEditReceipt(tag, sequence.Value));
        },
        cancellationToken);
  }

  /// <summary>
  /// Publishes a checkpoint through everything committed so far. WHEN this
  /// runs belongs to the checkpoint publisher (plan task 5.1); this is the
  /// room's only route to <see cref="ICollabOperationSession.WriteCheckpointAsync"/>.
  /// False when there is nothing new to publish.
  ///
  /// Refused while the engine holds pending state: a checkpoint is replayed
  /// INSTEAD of the operations it covers, and an encode taken over parked
  /// structs is not a state those operations would rebuild.
  /// </summary>
  internal Task<bool> CheckpointAsync(CancellationToken cancellationToken)
  {
    return RunAsync(
        async () =>
        {
          if (state != RoomState.Ready ||
              session is null ||
              committedThrough == checkpointedThrough ||
              doc!.HasPending)
          {
            return false;
          }

          try
          {
            using var deadline = new CancellationTokenSource(options.CommitTimeout, timeProvider);
            using var bounded = CancellationTokenSource.CreateLinkedTokenSource(
                lifetime.Token,
                deadline.Token);

            await session.WriteCheckpointAsync(
                new CollabOperationCheckpoint(committedThrough, doc.EncodeStateAsUpdate()),
                bounded.Token);
          }
          catch (Exception error) when (
              error is CollabOperationFenceLostException or
                  ArgumentOutOfRangeException or
                  InvalidDataException)
          {
            // A lost fence (another process owns the document), a sequence the
            // store refused (this room's idea of what is committed is wrong)
            // and a journal it cannot read (the crash table's "fail closed;
            // never silently re-seed"). None of the three heals by retrying.
            await FailCommitLocked("publish a checkpoint", error);

            return false;
          }
          catch (Exception error)
          {
            // Everything else — a disk hiccup, a store timeout. A checkpoint
            // is only a replay accelerator, so a failed one leaves the room
            // holding nothing the journal lacks; evicting a roomful of people
            // from a document they can still edit would be the worse answer,
            // and checkpointedThrough is left alone so the next attempt
            // retries. Bounded, though: a session that can never checkpoint
            // again reads exactly like a hiccup, and under a checkpoint
            // cadence that would retry forever.
            if (++checkpointFailures >= CheckpointFailureLimit)
            {
              await FailCommitLocked("publish a checkpoint", error);

              return false;
            }

            log?.Invoke(
                $"collab: room \"{DocId}\" could not publish a checkpoint " +
                $"({checkpointFailures} of {CheckpointFailureLimit}), retrying later: {error.Message}");

            return false;
          }

          checkpointFailures = 0;
          checkpointedThrough = committedThrough;

          // MarkDirty deliberately arms no timer on a journal room, so the
          // projection a checkpoint earns has to be armed here — and marked
          // owed, because this arming is dropped when a save is in flight.
          projectionOwed = true;
          MarkDirtyLocked();
          ScheduleExportLocked();

          return true;
        },
        cancellationToken);
  }

  internal Task<CollabResetResult?> ResetAsync(CancellationToken cancellationToken)
  {
    return RunAsync<CollabResetResult?>(
        async () =>
        {
          if (state == RoomState.Closed)
          {
            return null;
          }

          if (operationStore is not null)
          {
            if (state == RoomState.New)
            {
              try
              {
                if (!await TryOpenJournalLocked())
                {
                  await CloseRoomLocked(null);

                  return new CollabResetResult(CollabResetStatus.Unavailable, null, null);
                }

                // An already-journalled document is HYDRATED here, so the
                // flush below can run at all: nobody is in the room to have
                // projected, and the record this is about to be rebaselined
                // from is only as fresh as the last projection. A document
                // the journal has never held has nothing to project.
                if (session!.OpenResult.Head is not null)
                {
                  NewDocLocked();

                  try
                  {
                    await LoadFromJournalLocked();
                    state = RoomState.Ready;
                  }
                  catch (Exception error)
                  {
                    // A journal this engine cannot replay. The warm load fails
                    // on the same record, so nobody could have been served this
                    // history and none of it is recoverable — and the reset is
                    // about to throw it away regardless. Rebaseline without the
                    // flush rather than refuse the only door left open.
                    log?.Invoke(
                        $"collab: room \"{DocId}\" could not replay its journal before a reset, " +
                        $"so the reset drops it: {error.Message}");
                  }
                }
              }
              catch (Exception error)
              {
                await CloseRoomLocked(null);

                return new CollabResetResult(CollabResetStatus.SeedFailed, null, error);
              }
            }

            if (state == RoomState.Ready)
            {
              // The new lineage is baselined from the consumer's record, and
              // the demotion left that record only as fresh as the last
              // projection. Without this the reset drops every operation
              // acknowledged since then, and an old-lineage operation can
              // never be replayed into the new lineage. A host that saved
              // first answers this PUT 409 and its own copy still wins.
              //
              // NOT under the caller's token: a client that disconnects
              // mid-flush would leave the record stale and the rebaseline
              // would then take it, which is the loss this exists to stop.
              try
              {
                await FlushLocked(CancellationToken.None);
              }
              catch (Exception error)
              {
                log?.Invoke(
                    $"collab: room \"{DocId}\" could not flush before a reset: {error.Message}");
              }
            }

            var head = session!.OpenResult.Head;
            var current = head is null
                ? tag
                : new CollabWorkingSetTag(head.Format, head.Epoch, head.Lineage);

            try
            {
              var next = await ResetJournalLocked(current);
              await CloseRoomLocked(CollabCloseReason.Reset);

              return new CollabResetResult(CollabResetStatus.Reset, next, null);
            }
            catch (Exception error)
            {
              await FailCommitLocked("reset the document", error);

              return new CollabResetResult(CollabResetStatus.Unavailable, null, error);
            }
          }

          var legacyCurrent = tag;

          if (state == RoomState.New)
          {
            var stored = await store.ReadAsync(DocId, cancellationToken);
            legacyCurrent = stored?.Tag ?? legacyCurrent;
          }

          await SettleInFlightPersistLocked();

          var legacyNext = new CollabWorkingSetTag(
              legacyCurrent.Format,
              legacyCurrent.Epoch + 1,
              CollabWorkingSetTag.NewLineage());

          cancellationToken.ThrowIfCancellationRequested();
          await store.ResetAsync(DocId, legacyNext, lifetime.Token);
          await CloseRoomLocked(CollabCloseReason.Reset);

          return new CollabResetResult(CollabResetStatus.Reset, legacyNext, null);
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
            await CloseRoomLocked(CollabCloseReason.Draining);
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
    if (disposed)
    {
      return;
    }

    disposed = true;
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

  private async Task<T> RunAsync<T>(
      Func<Task<T>> operation,
      CancellationToken cancellationToken)
  {
    await lane.WaitAsync(cancellationToken);

    try
    {
      return await operation();
    }
    finally
    {
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

  /// <summary>
  /// A random uint32 client id by construction, as a browser draws: two
  /// replicas sharing an id would corrupt the doc.
  /// </summary>
  private void NewDocLocked()
  {
    doc = new YDoc();
    doc.UpdateEmitted += OnLocalUpdate;
  }

  private async Task<bool> TryOpenJournalLocked()
  {
    var open = await operationStore!.OpenAsync(DocId, lifetime.Token);

    if (open.Session is null)
    {
      log?.Invoke($"collab: document \"{DocId}\" is open in another process");

      return false;
    }

    session = open.Session;

    return true;
  }

  /// <summary>Load-or-seed. Returns the failure instead of throwing so the join can report it.</summary>
  private async Task<LoadFailure?> TryLoadLocked()
  {
    try
    {
      NewDocLocked();

      if (operationStore is not null)
      {
        if (!await TryOpenJournalLocked())
        {
          return new LoadFailure(Unavailable: true, null);
        }

        await LoadFromJournalLocked();
        state = RoomState.Ready;

        return null;
      }

      var stored = await store.ReadAsync(DocId, lifetime.Token);

      if (stored is not null)
      {
        if (stored.Tag.Format != CollabWorkingSetTag.SchemaV2)
        {
          throw new InvalidDataException(
              $"collab: the stored working set for \"{DocId}\" has format {stored.Tag.Format}; " +
              $"this server reads format {CollabWorkingSetTag.SchemaV2}.");
        }

        tag = stored.Tag;
        HydrateLocked(stored.Updates);
      }

      if (frameCount == 0)
      {
        await SeedLocked();
      }
      else if (CompactIfOversizedLocked())
      {
        try
        {
          await PersistLocked(lifetime.Token);
        }
        catch (Exception error) when (!lifetime.IsCancellationRequested)
        {
          // The doc and the stored blob are both fine; the compacted log is
          // retried like any other write once the room is Ready.
          log?.Invoke(
              $"collab: room \"{DocId}\" could not write its compacted working set, retrying: {error.Message}");
          persistFailures++;
          persistTimer.Change(Backoff(persistFailures), Timeout.InfiniteTimeSpan);
        }
      }

      state = RoomState.Ready;

      return null;
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" could not load: {error.Message}");

      return new LoadFailure(Unavailable: false, error);
    }
  }

  /// <summary>
  /// Committed data only: the baseline, then the checkpoint covering every
  /// operation through its sequence, then the tail that came after it. A
  /// document with no head has never been seeded, and seeding it is what mints
  /// its lineage.
  /// </summary>
  private async Task LoadFromJournalLocked()
  {
    var opened = session!.OpenResult;

    if (opened.Head is null)
    {
      await SeedJournalLocked();

      return;
    }

    tag = new CollabWorkingSetTag(
        opened.Head.Format,
        opened.Head.Epoch,
        opened.Head.Lineage);
    committedThrough = opened.Head.DurableThrough;
    checkpointedThrough = opened.Checkpoint?.Through ?? 0;
    StartVersionReadLocked();
    HydrateCommittedLocked(opened.Baseline);

    if (opened.Checkpoint is { } checkpoint)
    {
      HydrateCommittedLocked([checkpoint.State]);
    }

    HydrateCommittedLocked(
        [.. opened.Tail.Select(record => record.Update)]);

    // The previous room may have died with a projection owed — a crash, a
    // drain the endpoint refused, a converter refusal — and nothing else
    // would ever notice. One PUT per room lifetime buys the record catching
    // up whenever a document is opened, and it is what a reset rebaselines
    // from. A SEED does not come through here: its record IS the source.
    MarkDirtyLocked();
  }

  /// <summary>
  /// The consumer's optimistic-concurrency handle, for a room whose content
  /// came from the journal instead of a seed. Nothing else sets it there, and
  /// a journal-backed room makes one write-back in its whole life — so without
  /// this GET no write-back it ever makes carries Blok-Doc-Version, and a
  /// consumer has no basis to refuse a projection built before its own save.
  /// The BODY is discarded: the journal is what the document is.
  /// </summary>
  private void StartVersionReadLocked()
  {
    var reading = ReadProjectionVersionAsync();
    pendingVersion = reading;
    _ = ObserveVersionAsync(reading);
  }

  /// <summary>
  /// Best effort. The endpoint being unreachable must cost the write-back its
  /// header and nothing else — never the join the journal can serve on its own.
  /// </summary>
  private async Task<string?> ReadProjectionVersionAsync()
  {
    try
    {
      return (await endpoint.LoadAsync(DocId, lifetime.Token)).Version;
    }
    catch (Exception error) when (!lifetime.IsCancellationRequested)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" could not read the document version, so its write-back " +
          $"will carry none: {error.Message}");

      return null;
    }
  }

  private async Task ObserveVersionAsync(Task<string?> reading)
  {
    string? answered = null;

    try
    {
      answered = await reading;
    }
    catch (Exception)
    {
      // Only the room's own lifetime ends this read; there is nothing to apply.
    }

    Post(() =>
    {
      ApplyVersionLocked(reading, answered);

      return Task.CompletedTask;
    });
  }

  /// <summary>
  /// Idempotent: whichever of the observer and the settle gets there first
  /// wins. A read may only FILL the handle, never replace one — a projection
  /// the settle gave up waiting for goes out bare, and the version its answer
  /// carries is then newer than anything this read saw. Writing over it would
  /// be permanent: nothing re-reads the endpoint's version after load, so
  /// every later projection would be refusable and the room would sit on its
  /// journal fence retrying a PUT that can never land.
  /// </summary>
  private void ApplyVersionLocked(Task<string?> reading, string? answered)
  {
    if (!ReferenceEquals(reading, pendingVersion))
    {
      return;
    }

    pendingVersion = null;

    if (answered is not null && version is null)
    {
      version = answered;
    }
  }

  /// <summary>
  /// Waits out the load-time version read, where a PUT is about to be built.
  /// It has normally landed long before any projection — the earliest is a
  /// debounce away — so this is usually an already-completed task. Bounded
  /// because the lane is held: past the bound the projection goes without the
  /// header rather than holding the whole document up for it.
  /// </summary>
  private async Task SettleVersionLocked()
  {
    if (pendingVersion is not { } reading)
    {
      return;
    }

    try
    {
      ApplyVersionLocked(reading, await reading.WaitAsync(options.CommitTimeout, timeProvider));
    }
    catch (Exception error)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" is projecting before its version read finished: {error.Message}");
    }
  }

  private void HydrateCommittedLocked(IReadOnlyList<ReadOnlyMemory<byte>> updates)
  {
    foreach (var update in updates)
    {
      var bytes = update.ToArray();

      if (ApplyRemoteLocked(bytes) is null)
      {
        throw new InvalidDataException(
            $"collab: committed data for \"{DocId}\" could not be applied.");
      }

      AppendLocked(bytes);
    }
  }

  /// <summary>
  /// A document the journal has never held. The doc endpoint's JSON becomes the
  /// sequence-zero baseline under a fresh lineage, and the reset is awaited:
  /// a seed the journal did not take must fail the join rather than serve a
  /// history nothing recorded.
  /// </summary>
  private async Task SeedJournalLocked()
  {
    var loaded = await endpoint.LoadAsync(DocId, lifetime.Token);
    version = loaded.Version;
    localUpdates.Clear();

    if (loaded.Data is not null)
    {
      converter.Seed(doc!, loaded.Data);
    }

    var baseline = new List<ReadOnlyMemory<byte>>();

    foreach (var update in localUpdates)
    {
      AppendLocked(update);
      baseline.Add(update);
    }

    localUpdates.Clear();

    var head = await session!.ResetAsync(
        new CollabOperationReset(
            CollabWorkingSetTag.SchemaV2,
            Epoch: 0,
            CollabWorkingSetTag.NewLineage(),
            baseline),
        lifetime.Token);
    tag = new CollabWorkingSetTag(head.Format, head.Epoch, head.Lineage);
  }

  /// <summary>Builds a standalone baseline; seeding the old doc would only make a diff.</summary>
  private async Task<CollabWorkingSetTag> ResetJournalLocked(CollabWorkingSetTag current)
  {
    var loaded = await endpoint.LoadAsync(DocId, lifetime.Token);
    var baseline = new List<ReadOnlyMemory<byte>>();
    var resetDoc = new YDoc();
    resetDoc.UpdateEmitted += update =>
    {
      if (update.Local)
      {
        baseline.Add(update.Update);
      }
    };

    if (loaded.Data is not null)
    {
      converter.Seed(resetDoc, loaded.Data);
    }

    var head = await session!.ResetAsync(
        new CollabOperationReset(
            current.Format,
            current.Epoch + 1,
            CollabWorkingSetTag.NewLineage(),
            baseline),
        lifetime.Token);
    tag = new CollabWorkingSetTag(head.Format, head.Epoch, head.Lineage);

    return tag;
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
      if (ApplyRemoteLocked(frame) is null)
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
    localUpdates.Clear();

    if (loaded.Data is not null)
    {
      converter.Seed(doc!, loaded.Data);
    }

    PublishLocalUpdatesLocked();

    // Awaited on purpose: a seed that cannot be written must fail the join
    // closed rather than serve a doc the store has never seen.
    await PersistLocked(lifetime.Token);
  }

  /// <summary>
  /// Captures what a LOCAL transaction produced; its caller decides when that
  /// becomes observable, which is what lets a journal-backed path commit
  /// first. A remote update is appended and relayed by the receive path, which
  /// knows who sent it; echoing it here would send it back to its own author.
  /// </summary>
  private void OnLocalUpdate(YUpdateEvent updateEvent)
  {
    if (updateEvent.Local)
    {
      localUpdates.Add(updateEvent.Update);
    }
  }

  /// <summary>Appends and relays everything the last local transaction emitted.</summary>
  private void PublishLocalUpdatesLocked()
  {
    foreach (var update in localUpdates)
    {
      AppendLocked(update);
      BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(update)), null);
    }

    localUpdates.Clear();
  }

  /// <summary>
  /// The pre-apply screen and the apply. Only Malformed and TooDeep are
  /// refused, and refusing is a log-and-DROP with no close; a NUL-bearing
  /// update is applied like any other (Locked Decision 9). Answers the
  /// engine's own account of what the apply did, or null when nothing was
  /// applied.
  /// </summary>
  private ApplyResult? ApplyRemoteLocked(byte[] update)
  {
    var inspection = UpdateInspector.Inspect(update);

    if (inspection.Verdict != UpdateVerdict.Ok || inspection.Decoded is null)
    {
      log?.Invoke(
          $"collab: room \"{DocId}\" dropped an update it could not read: {inspection.Reason}");

      return null;
    }

    try
    {
      var applied = doc!.ApplyUpdate(inspection.Decoded);

      return applied.Outcome == ApplyOutcome.Applied ? applied : null;
    }
    catch (Exception error)
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped an update it could not apply: {error.Message}");

      return null;
    }
  }

  /// <summary>
  /// The working-set log. A journal-backed room keeps none: the fenced
  /// session is the only writer of its document bytes, and a second copy
  /// nothing reads would only be a copy no fence covers. Every blob path is
  /// driven by the two counters below — persist scheduling and the flush's
  /// write by <c>blobVersion</c>, compaction and the flush's compaction by
  /// <c>frameCount</c>, the eviction hold by both — so leaving them at zero
  /// is what skips all of them.
  /// </summary>
  private void AppendLocked(byte[] update)
  {
    if (session is not null)
    {
      return;
    }

    CollabWorkingSetCodec.AppendFrame(frameSection, update);
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
    return options.Backoff(failures);
  }

  /// <summary>True when the log was replaced by one full-state frame.</summary>
  private bool CompactIfOversizedLocked()
  {
    if (frameCount < 2 ||
        (frameCount < options.CompactionFrameThreshold &&
            frameSection.Length - baseFrameLength < options.CompactionByteThreshold))
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
    baseFrameLength = frameSection.Length;
  }

  private async Task ReceiveLocked(CollabMembership membership, byte[] frame)
  {
    if (!SyncWire.TryDecode(frame, out var message, out var error))
    {
      log?.Invoke($"collab: room \"{DocId}\" dropped a frame: {error}");

      return;
    }

    // Protocol §7: only an operation frame may carry a v2 client's write. A
    // raw SyncStep2/Update has no operation id, so it can be answered with
    // neither an acknowledgement nor a rejection — nothing is applied,
    // journalled or relayed, and the member goes. The gate is the NEGOTIATED
    // protocol: v1 and stock y-websocket members still write this way.
    if (message is SyncStep2Frame or SyncUpdateFrame &&
        membership.Member.ProtocolSource == CollabOperationSource.ClientV2)
    {
      log?.Invoke($"collab: room \"{DocId}\" closed a v2 member that sent a raw write");
      ExpelLocked(membership, CollabCloseReason.RawWriteOnV2);

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
      case OperationFrame operation:
        await CommitFromMemberLocked(membership, operation);
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

    // After the send, not before: the drop branches above leave the member
    // holding a state this room never gave it, which is what not-synced means.
    membership.Synced = true;
  }

  /// <summary>
  /// A v2 operation. Settle the id, apply provisionally, journal it INSIDE the
  /// lane, and only then let anyone see it: no broadcast, no acknowledgement,
  /// no export and no checkpoint may precede the append returning.
  /// </summary>
  private async Task CommitFromMemberLocked(
      CollabMembership membership,
      OperationFrame operation)
  {
    if (session is null)
    {
      // No journal to commit to. v2 is never negotiated against such a room,
      // so this is a frame no client of this room should have sent.
      log?.Invoke(
          $"collab: room \"{DocId}\" dropped an operation frame; it has no operation store");

      return;
    }

    if (membership.Member.ProtocolSource != CollabOperationSource.ClientV2)
    {
      // Both answers a 102 earns are v2 frames. Sending one to a member that
      // negotiated v1 hands a stock client a frame its provider ends the
      // session on, so this is a drop rather than a rejection.
      log?.Invoke(
          $"collab: room \"{DocId}\" dropped an operation frame from a member that did not negotiate v2");

      return;
    }

    if (!membership.Member.CanWrite)
    {
      RejectLocked(membership, operation, "read-only");

      return;
    }

    if (!membership.Synced)
    {
      // Transient, and the connection stays: the client redrives the same
      // operation once the sync exchange has completed.
      RejectLocked(membership, operation, "not-synced");

      return;
    }

    // Ahead of the lookup: FindCommittedAsync answers for the CURRENT lineage
    // only, so an operation naming an older one would read as uncommitted and
    // be journalled into a history it never belonged to.
    if (!string.Equals(operation.Lineage, tag.Lineage, StringComparison.Ordinal))
    {
      RejectLocked(membership, operation, "lineage-mismatch");

      return;
    }

    var digest = SHA256.HashData(operation.Update);
    CollabOperationLookup committed;

    try
    {
      // Bounded like the append below, and for the same reason: this runs with
      // the lane held, so a store that never answers wedges the document with
      // nothing to end the wait — and the drain waits on that lane too.
      using var deadline = new CancellationTokenSource(options.CommitTimeout, timeProvider);
      using var bounded = CancellationTokenSource.CreateLinkedTokenSource(
          lifetime.Token,
          deadline.Token);

      committed = await session.FindCommittedAsync(
          operation.OperationId,
          digest,
          bounded.Token);
    }
    catch (Exception error)
    {
      // Nothing was applied, but a store that cannot answer cannot commit
      // either; serving on would mean accepting writes it can never journal.
      await FailCommitLocked("look up an operation id", error);

      return;
    }

    switch (committed.Outcome)
    {
      case CollabOperationLookupOutcome.Duplicate:
        // A retry of work that is already durable. The bytes are in the
        // document, so every member has them from the broadcast or from its
        // own sync; only the lost receipt is re-sent.
        AcknowledgeLocked(membership, operation, committed.ServerSequence);

        return;

      case CollabOperationLookupOutcome.Conflict:
        // THIS is why the lookup precedes the apply. Learning it from the
        // append would leave the document holding bytes the journal refuses,
        // whose only cure is discarding the room — so any writer could close
        // the room for everyone by re-sending one id with different bytes.
        RejectLocked(membership, operation, "operation-id-conflict");

        return;

      default:
        break;
    }

    if (ApplyRemoteLocked(operation.Update) is null)
    {
      RejectLocked(membership, operation, "invalid-update");

      return;
    }

    if (await AppendCommittedLocked(
          operation.OperationId,
          membership.Member.ActorId,
          membership.Member.ProtocolSource,
          operation.Update,
          digest) is not { } serverSequence)
    {
      return;
    }

    AppendLocked(operation.Update);

    // The submitter included: on v2 the relayed update is how a writer sees
    // what the server accepted, and the acknowledgement follows it.
    BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(operation.Update)), null);
    AcknowledgeLocked(membership, operation, serverSequence);
    CompactIfOversizedLocked();
    SchedulePersistLocked();
    MarkDirtyLocked();
  }

  /// <summary>
  /// The durable step journal-backed write paths share. It answers the sequence
  /// or closes the room before anything is published.
  /// </summary>
  private async Task<ulong?> AppendCommittedLocked(
      string operationId,
      string? actorId,
      CollabOperationSource source,
      byte[] update,
      ReadOnlyMemory<byte> digest)
  {
    CollabOperationAppendResult appended;

    try
    {
      // Its own budget, like the v2 lookup's and like the session disposal in
      // CloseRoomLocked: each store call this path makes while holding the
      // lane is bounded by CommitTimeout. By OUR token, which is the only
      // cancellation the seam permits us to cause; the lane is held for the
      // whole wait, so a slow store backpressures this document.
      using var deadline = new CancellationTokenSource(options.CommitTimeout, timeProvider);
      using var bounded = CancellationTokenSource.CreateLinkedTokenSource(
          lifetime.Token,
          deadline.Token);

      appended = await session!.AppendAsync(
          new CollabOperationCandidate(
              operationId,
              actorId,
              source,
              update,
              digest),
          bounded.Token);
    }
    catch (Exception error)
    {
      // Including a timeout: the write may still land, so the outcome is
      // unknown rather than failed, and both are handled the same way.
      await FailCommitLocked("journal an operation", error);

      return null;
    }

    if (appended.Outcome != CollabOperationAppendOutcome.Committed)
    {
      // The lookup said the id was free, so the document already holds bytes
      // this outcome cannot prove are journalled. A duplicate is no safer than
      // a conflict here: an HTTP edit digests the canonical request, not the
      // update it generates, so equal digests say the same request was asked
      // for twice — not that the journal holds THESE bytes, which carry this
      // room's random client id.
      await FailCommitLocked(
          "journal an operation",
          new InvalidOperationException(
              $"collab: the store returned {appended.Outcome} for new operation \"{operationId}\"."));

      return null;
    }

    committedThrough = appended.ServerSequence;

    return appended.ServerSequence;
  }

  private void AcknowledgeLocked(
      CollabMembership membership,
      OperationFrame operation,
      ulong serverSequence)
  {
    Send(membership, SyncWire.Encode(new AcknowledgementFrame(
        tag.Lineage,
        operation.OperationId,
        serverSequence)));
  }

  /// <summary>
  /// The refusal carries the lineage the client named, not the room's: on a
  /// lineage mismatch those differ, and the client matches the answer to the
  /// row it sent.
  /// </summary>
  private void RejectLocked(
      CollabMembership membership,
      OperationFrame operation,
      string code)
  {
    log?.Invoke(
        $"collab: room \"{DocId}\" refused operation \"{operation.OperationId}\": {code}");
    Send(membership, SyncWire.Encode(new RejectionFrame(
        operation.Lineage,
        operation.OperationId,
        code)));
  }

  /// <summary>
  /// A commit the room could not complete. The document may already hold bytes
  /// the journal does not, so the room stops here rather than guess: it closes
  /// every member with the retryable close and discards itself, and a fresh
  /// room reloads committed data only.
  /// </summary>
  private async Task FailCommitLocked(string what, Exception error)
  {
    log?.Invoke($"collab: room \"{DocId}\" could not {what}, closing: {error.Message}");
    CommitUnavailable = true;
    await CloseRoomLocked(CollabCloseReason.CommitUnavailable);
  }

  /// <summary>
  /// A SyncStep2 or SyncUpdate: what a blok-sync.v1 member sends, and what a
  /// stock y-websocket member sends having negotiated no subprotocol at all.
  /// A journal-backed room journals it through the same append a v2 operation
  /// uses, under an id the server mints, and sends the writer no receipt.
  /// </summary>
  private async Task ApplyFromMemberLocked(CollabMembership membership, byte[] update)
  {
    if (!membership.Member.CanWrite)
    {
      return;
    }

    // A working-set-only room (S3) has no journal, so nothing here may wait
    // on one: it relays straight off the apply.
    if (session is null)
    {
      if (ApplyRemoteLocked(update) is not null)
      {
        PublishFromMemberLocked(membership, update);
      }

      return;
    }

    if (ApplyRemoteLocked(update) is not { } applied)
    {
      return;
    }

    // The ENGINE decides this, never the bytes. An idle client answering
    // SyncStep1 sends the document's whole deletion history back (yjs writes
    // the delete set undiffed), so "it carries something" journals a no-op
    // per reconnect that grows with the document; and "the state vector
    // moved" is blind to deletions, which move no clock. Both were tried
    // here, and both were wrong. See ApplyResult.Changed.
    if (!applied.Changed)
    {
      return;
    }

    if (await AppendCommittedLocked(
          NewOperationId(),
          membership.Member.ActorId,
          membership.Member.ProtocolSource,
          update,
          SHA256.HashData(update)) is null)
    {
      return;
    }

    // No acknowledgement follows: 103 is a v2 frame, and a v1 provider ends
    // its session on one it cannot parse. A v1 write is journalled and earns
    // no receipt.
    PublishFromMemberLocked(membership, update);
  }

  /// <summary>
  /// The tail of a v1 write: log the frame, relay it to the OTHERS — v1 bytes
  /// do not change, so the submitter is not in the broadcast — and let the
  /// blob catch up.
  /// </summary>
  private void PublishFromMemberLocked(CollabMembership membership, byte[] update)
  {
    AppendLocked(update);
    BroadcastLocked(SyncWire.Encode(new SyncUpdateFrame(update)), membership);
    CompactIfOversizedLocked();
    SchedulePersistLocked();
    MarkDirtyLocked();
  }

  /// <summary>
  /// A v1 member carries no operation id, so the server mints one per update.
  /// The client never re-sends it, so this id names the write in history
  /// rather than keying a retry, and a freshly minted id has nothing to look
  /// up.
  /// </summary>
  private static string NewOperationId()
  {
    return Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
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

  /// <summary>
  /// Records that the consumer's JSON is behind the document. A journal-backed
  /// room stops there: the journal is what the write is durable in, so its
  /// projection is scheduled by a published checkpoint and by eviction/drain,
  /// never once per edit window.
  /// </summary>
  private void MarkDirtyLocked()
  {
    exportDirty = true;
    dirtySince ??= timeProvider.GetUtcNow();

    if (session is null)
    {
      ScheduleExportLocked();
    }
  }

  /// <summary>
  /// The converter refusing the room's own document — an unreadable block
  /// shape, a depth the JSON writer will not take. Retrying cannot heal it,
  /// and on a journal-backed room every operation is already durable, so the
  /// room stops holding itself loaded for a PUT it can never build. Logged
  /// once per room: it takes an operator reset, not a wait.
  /// </summary>
  private void RefuseProjectionLocked(Exception error)
  {
    if (projectionRefused)
    {
      return;
    }

    projectionRefused = true;

    // Says only what is true: no retry produces this JSON. A reset, or a
    // client repairing the block, would — the room cannot tell which.
    log?.Invoke(
        $"collab: room \"{DocId}\" cannot export its document, so the consumer's record " +
        $"stays behind and no retry will change that: {error.Message}");
  }

  /// <summary>
  /// What a projection names. Null on a working-set-only room: it has no
  /// committed sequence, so it has nothing for a consumer to order by.
  /// </summary>
  private DocProjection? ProjectionLocked()
  {
    return session is null ? null : new DocProjection(tag.Lineage, committedThrough);
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

  private async Task TryExportLocked()
  {
    if (state != RoomState.Ready || !exportDirty || inFlightSave is not null)
    {
      return;
    }

    await SettleVersionLocked();
    Task<string?> save;

    // The JSON snapshot is taken under the lane and the PUT runs beside it,
    // so a slow endpoint does not stall sync for the length of a write-back.
    // The settle above is the ONE endpoint-dependent wait still inside the
    // lane: bounded by CommitTimeout and only while a load-time version read
    // is outstanding, but an edit does queue behind it. Single flight keeps
    // PUTs ordered. On a working-set-only room a converter refusal (a peer
    // wrote a shape it cannot read) is a failed export like any other: backed
    // off and retried, never left for the next edit to re-arm.
    try
    {
      var snapshot = converter.Export(doc!);

      // Cleared at the SNAPSHOT, not at the save's completion: this document
      // is what the checkpoint owed, and clearing on completion would re-arm
      // for work that arrived after it and owes nothing.
      projectionOwed = false;
      save = endpoint.SaveAsync(DocId, snapshot, version, ProjectionLocked(), lifetime.Token);
    }
    catch (Exception error)
    {
      if (session is not null)
      {
        RefuseProjectionLocked(error);

        return;
      }

      log?.Invoke($"collab: room \"{DocId}\" could not export, retrying: {error.Message}");
      exportFailures++;
      exportRetryAt = timeProvider.GetUtcNow() + Backoff(exportFailures);
      ScheduleExportLocked();

      return;
    }

    exportDirty = false;
    dirtySince = null;
    inFlightSave = save;
    _ = ObserveSaveAsync(save);
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
      projectionRefused = false;

      if (answered is not null)
      {
        version = answered;
      }
    }

    // Work that arrived while the PUT was in flight. A journal-backed room
    // does not re-arm for a plain edit: that would put the per-edit-window PUT
    // back through the coalescing path. It DOES re-arm for a failure (the
    // projection was never made) and for a checkpoint published mid-flight,
    // whose own arming ScheduleExport dropped.
    if (exportDirty && (failure is not null || projectionOwed || session is null))
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

    if (exportDirty && !projectionRefused)
    {
      // Same reasoning for the consumer's record: a room dropped with an
      // export owed hydrates clean from the blob next time and never exports
      // what the endpoint missed. A refused projection is the exception —
      // waiting cannot produce it, so holding the room only wastes memory.
      exportFailures++;
      log?.Invoke(
          $"collab: room \"{DocId}\" is staying loaded until its export lands");
      UpdateEvictionLocked(Backoff(exportFailures));

      return;
    }

    await CloseRoomLocked(null);
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

    await SettleVersionLocked();
    JsonNode snapshot;

    try
    {
      snapshot = converter.Export(doc!);
      projectionOwed = false;
    }
    catch (Exception error) when (!lifetime.IsCancellationRequested)
    {
      if (session is not null)
      {
        RefuseProjectionLocked(error);
      }
      else
      {
        log?.Invoke($"collab: room \"{DocId}\" could not export during flush: {error.Message}");
      }

      return;
    }

    try
    {
      version = await endpoint.SaveAsync(
          DocId,
          snapshot,
          version,
          ProjectionLocked(),
          deadline.Token) ?? version;
      exportDirty = false;
      dirtySince = null;
      exportFailures = 0;
      exportRetryAt = null;
      projectionRefused = false;
    }
    catch (Exception error) when (!lifetime.IsCancellationRequested)
    {
      log?.Invoke($"collab: room \"{DocId}\" could not export during flush: {error.Message}");
    }
  }

  /// <summary>
  /// Releases the fence with the room: a session left open keeps the document
  /// locked to a process that has stopped serving it. Disposed first, and
  /// never while one of its calls is in flight — every caller here has awaited
  /// its own, the failure path included.
  ///
  /// The wait is bounded because <see cref="IAsyncDisposable"/> carries no
  /// token, so not even the room's lifetime ends it, and this runs with the
  /// lane held — which <see cref="DrainAsync"/> waits on with no token of its
  /// own. Past the bound the session is ABANDONED rather than waited out: it
  /// keeps the fence until its liveness signal lapses, so a fresh room sees
  /// DocumentOpenElsewhere for a bounded time and then recovers, which beats
  /// never recovering.
  /// </summary>
  private async Task CloseRoomLocked(CollabCloseReason? reason)
  {
    if (session is { } closing)
    {
      session = null;

      try
      {
        await closing.DisposeAsync().AsTask().WaitAsync(options.CommitTimeout, timeProvider);
      }
      catch (Exception error)
      {
        log?.Invoke(
            $"collab: room \"{DocId}\" could not release its operation session: {error.Message}");
      }
    }

    CloseLocked(reason);
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
