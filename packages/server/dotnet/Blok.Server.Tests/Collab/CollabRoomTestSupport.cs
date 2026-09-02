using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Deterministic clock for the room's debounce/linger timers. Advance fires
/// due callbacks synchronously, in due order, so a test that advances the
/// clock and then settles the room lane has observed everything the timer
/// posted — no real-time waits, no absence windows.
/// </summary>
internal sealed class ManualTimeProvider : TimeProvider
{
  private readonly List<ManualTimer> timers = [];
  private DateTimeOffset now = new(2026, 1, 2, 3, 4, 5, TimeSpan.Zero);

  public override DateTimeOffset GetUtcNow()
  {
    return now;
  }

  public override long GetTimestamp()
  {
    return now.UtcTicks;
  }

  public override ITimer CreateTimer(
      TimerCallback callback,
      object? state,
      TimeSpan dueTime,
      TimeSpan period)
  {
    var timer = new ManualTimer(this, callback, state);
    timer.Change(dueTime, period);

    lock (timers)
    {
      timers.Add(timer);
    }

    return timer;
  }

  internal int ArmedTimerCount
  {
    get
    {
      lock (timers)
      {
        return timers.Count(timer => timer.DueAt is not null);
      }
    }
  }

  internal void Advance(TimeSpan by)
  {
    var target = now + by;

    while (true)
    {
      ManualTimer? next;

      lock (timers)
      {
        next = timers
            .Where(timer => timer.DueAt is not null && timer.DueAt <= target)
            .OrderBy(timer => timer.DueAt)
            .FirstOrDefault();
      }

      if (next is null)
      {
        break;
      }

      now = next.DueAt!.Value;
      next.Fire();
    }

    now = target;
  }

  private void Remove(ManualTimer timer)
  {
    lock (timers)
    {
      timers.Remove(timer);
    }
  }

  private sealed class ManualTimer(
      ManualTimeProvider owner,
      TimerCallback callback,
      object? state) : ITimer
  {
    internal DateTimeOffset? DueAt { get; private set; }

    public bool Change(TimeSpan dueTime, TimeSpan period)
    {
      DueAt = dueTime == Timeout.InfiniteTimeSpan
        ? null
        : owner.now + dueTime;

      return true;
    }

    public void Dispose()
    {
      DueAt = null;
      owner.Remove(this);
    }

    public ValueTask DisposeAsync()
    {
      Dispose();

      return ValueTask.CompletedTask;
    }

    internal void Fire()
    {
      DueAt = null;
      callback(state);
    }
  }
}

/// <summary>
/// Working-set tags for tests. Stored fixtures use one fixed lineage so a
/// hydrated tag can be compared whole; a lineage the ROOM minted is random by
/// design, so it is asserted by shape.
/// </summary>
internal static class Tags
{
  internal const string Lineage = "00112233445566778899aabbccddeeff";

  internal static CollabWorkingSetTag At(long epoch, string lineage = Lineage)
  {
    return new CollabWorkingSetTag(CollabWorkingSetTag.SchemaV2, epoch, lineage);
  }

  /// <summary>Asserts a freshly minted tag and returns its lineage for comparison.</summary>
  internal static string AssertMinted(long epoch, CollabWorkingSetTag tag)
  {
    Assert.Equal(CollabWorkingSetTag.SchemaV2, tag.Format);
    Assert.Equal(epoch, tag.Epoch);
    Assert.Matches("^[0-9a-f]{32}$", tag.Lineage);
    Assert.NotEqual(Lineage, tag.Lineage);

    return tag.Lineage;
  }
}

/// <summary>A directory of its own for one test, removed on dispose.</summary>
internal sealed class TemporaryDirectory : IDisposable
{
  internal string Path { get; } = System.IO.Path.Combine(
      System.IO.Path.GetTempPath(),
      $"blok-collab-{Guid.NewGuid():N}");

  public void Dispose()
  {
    if (Directory.Exists(Path))
    {
      Directory.Delete(Path, recursive: true);
    }
  }
}

internal sealed record StoredWorkingSet(byte[] Frames, CollabWorkingSetTag Tag);

/// <summary>
/// In-memory working-set store. WriteAsync yields once so that two
/// unserialized callers could interleave — which is what the lane proof
/// counts on. Concurrent entries are tracked as a second witness.
///
/// Every field is guarded: one store serves every doc, and rooms for
/// DIFFERENT docs do run at the same time (off-lane writes, a parallel
/// drain). Only same-doc access is serialized, and that is what the lane
/// proof measures.
/// </summary>
internal sealed class FakeWorkingSetStore : ICollabWorkingSetStore
{
  private readonly Dictionary<string, StoredWorkingSet> documents = new(StringComparer.Ordinal);
  private readonly Lock guard = new();
  private readonly List<string> journal = [];
  private int inFlight;
  private int reads;
  private int writes;
  private int resets;
  private int maxConcurrentEntries;
  private long writtenBytes;
  private int largestWriteBytes;
  private int mostFramesWritten;

  internal int Reads => Volatile.Read(ref reads);

  internal int Writes => Volatile.Read(ref writes);

  internal int Resets => Volatile.Read(ref resets);

  internal int MaxConcurrentEntries => Volatile.Read(ref maxConcurrentEntries);

  /// <summary>Total bytes handed to WriteAsync, failed attempts included.</summary>
  internal long WrittenBytes => Interlocked.Read(ref writtenBytes);

  internal int LargestWriteBytes => Volatile.Read(ref largestWriteBytes);

  internal int MostFramesWritten => Volatile.Read(ref mostFramesWritten);

  /// <summary>Every write and reset in the order it LANDED, as "write:{epoch}" / "reset:{epoch}".</summary>
  internal List<string> Journal
  {
    get
    {
      lock (guard)
      {
        return [.. journal];
      }
    }
  }

  internal Func<Task>? BeforeWrite { get; set; }

  /// <summary>When it answers non-null for a doc, that doc's WriteAsync throws it instead of storing.</summary>
  internal Func<string, Exception?>? FailWrites { get; set; }

  /// <summary>
  /// Runs after a reset has been stored and before ResetAsync honours its
  /// token — the way a PUT can land and the awaiting task still throw for a
  /// token that flipped meanwhile.
  /// </summary>
  internal Action? AfterReset { get; set; }

  internal void Seed(string docId, IReadOnlyList<byte[]> updates, CollabWorkingSetTag tag)
  {
    lock (guard)
    {
      documents[docId] = new StoredWorkingSet(CollabWorkingSetCodec.EncodeFrames(updates), tag);
    }
  }

  internal bool Holds(string docId)
  {
    lock (guard)
    {
      return documents.ContainsKey(docId);
    }
  }

  internal StoredWorkingSet Stored(string docId)
  {
    lock (guard)
    {
      return documents[docId];
    }
  }

  internal List<byte[]> FramesOf(string docId)
  {
    Assert.True(CollabWorkingSetCodec.TryDecodeFrames(Stored(docId).Frames, out var updates));

    return updates;
  }

  public async Task<CollabWorkingSet?> ReadAsync(string docId, CancellationToken cancellationToken = default)
  {
    using var entry = Enter();
    Interlocked.Increment(ref reads);
    await Task.Yield();

    lock (guard)
    {
      return documents.TryGetValue(docId, out var stored)
        ? new CollabWorkingSet(stored.Frames, stored.Tag)
        : null;
    }
  }

  public async Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    using var entry = Enter();
    Interlocked.Increment(ref writes);
    Interlocked.Add(ref writtenBytes, updates.Length);
    Assert.True(CollabWorkingSetCodec.TryDecodeFrames(updates, out var frames));

    lock (guard)
    {
      largestWriteBytes = Math.Max(largestWriteBytes, updates.Length);
      mostFramesWritten = Math.Max(mostFramesWritten, frames.Count);
    }

    if (BeforeWrite is not null)
    {
      await BeforeWrite();
    }

    await Task.Yield();

    if (FailWrites?.Invoke(docId) is { } failure)
    {
      throw failure;
    }

    lock (guard)
    {
      documents[docId] = new StoredWorkingSet(updates, tag);
      journal.Add($"write:{tag.Epoch}");
    }
  }

  public async Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    using var entry = Enter();
    Interlocked.Increment(ref resets);
    await Task.Yield();

    lock (guard)
    {
      documents[docId] = new StoredWorkingSet([], newTag);
      journal.Add($"reset:{newTag.Epoch}");
    }

    AfterReset?.Invoke();
    cancellationToken.ThrowIfCancellationRequested();
  }

  private Entry Enter()
  {
    var depth = Interlocked.Increment(ref inFlight);

    lock (guard)
    {
      maxConcurrentEntries = Math.Max(maxConcurrentEntries, depth);
    }

    return new Entry(this);
  }

  private sealed class Entry(FakeWorkingSetStore owner) : IDisposable
  {
    public void Dispose()
    {
      Interlocked.Decrement(ref owner.inFlight);
    }
  }
}

internal sealed record RecordedSave(string DocId, JsonNode Data, string? Version);

internal sealed class FakeDocEndpoint : IDocEndpointClient
{
  private readonly Dictionary<string, LoadedDocument> documents = new(StringComparer.Ordinal);
  private readonly List<RecordedSave> saves = [];
  private readonly Lock guard = new();
  private int loads;

  internal int Loads => Volatile.Read(ref loads);

  /// <summary>A snapshot: a drain saves every room at once.</summary>
  internal List<RecordedSave> Saves
  {
    get
    {
      lock (guard)
      {
        return [.. saves];
      }
    }
  }

  internal Exception? LoadFailure { get; set; }

  internal Exception? NextSaveFailure { get; set; }

  internal string? NextSaveVersion { get; set; }

  /// <summary>When set, LoadAsync waits for it before answering.</summary>
  internal TaskCompletionSource? LoadGate { get; set; }

  /// <summary>When set, SaveAsync waits for it before answering.</summary>
  internal TaskCompletionSource? SaveGate { get; set; }

  internal void Holds(string docId, string text, string? version = null)
  {
    documents[docId] = new LoadedDocument(new JsonObject { ["text"] = text }, version);
  }

  internal void HoldsNothing(string docId, string? version = null)
  {
    documents[docId] = new LoadedDocument(null, version);
  }

  public async Task<LoadedDocument> LoadAsync(string docId, CancellationToken cancellationToken)
  {
    Interlocked.Increment(ref loads);

    if (LoadGate is not null)
    {
      await LoadGate.Task.WaitAsync(cancellationToken);
    }

    if (LoadFailure is not null)
    {
      throw LoadFailure;
    }

    return documents.TryGetValue(docId, out var loaded)
      ? loaded
      : throw new DocEndpointException("collab: the doc endpoint GET returned 404.", 404);
  }

  public async Task<string?> SaveAsync(
      string docId,
      JsonNode outputData,
      string? version,
      CancellationToken cancellationToken)
  {
    lock (guard)
    {
      saves.Add(new RecordedSave(docId, outputData.DeepClone(), version));
    }

    if (SaveGate is not null)
    {
      await SaveGate.Task.WaitAsync(cancellationToken);
    }

    if (NextSaveFailure is not null)
    {
      var failure = NextSaveFailure;
      NextSaveFailure = null;

      throw failure;
    }

    var answer = NextSaveVersion;
    NextSaveVersion = null;

    return answer;
  }
}

/// <summary>
/// Stand-in for YDocConverter: the document is one "content" text root and
/// the OutputData shape is {"text": ...}.
/// </summary>
internal sealed class FakeDocConverter : ICollabDocConverter
{
  internal int Seeds { get; private set; }

  internal int Exports { get; private set; }

  internal List<ulong> SeededClientIds { get; } = [];

  internal int Edits { get; private set; }

  /// <summary>Set to make the next ApplyOps refuse, as an invalid op would.</summary>
  internal CollabEditException? EditFailure { get; set; }

  /// <summary>Thrown by the next Export only, as the real converter does on a block whose shape a peer broke.</summary>
  internal Exception? NextExportFailure { get; set; }

  public void Seed(YDoc doc, JsonNode outputData)
  {
    Seeds++;
    SeededClientIds.Add(doc.ClientId);
    var text = doc.GetText("content");

    doc.Transact(transaction =>
    {
      var length = text.ToString().Length;

      if (length > 0)
      {
        text.Delete(transaction, 0, length);
      }

      text.Insert(transaction, 0, outputData["text"]?.GetValue<string>() ?? "");
    });
  }

  /// <summary>
  /// Enough of the real op semantics for the room's sake: an insert appends
  /// its text, an update replaces the whole root, a remove empties it. A
  /// refusal is expressed the way the real converter expresses one.
  /// </summary>
  public void ApplyOps(YDoc doc, IReadOnlyList<CollabEditOp> ops)
  {
    Edits++;

    if (EditFailure is not null)
    {
      throw EditFailure;
    }

    var text = doc.GetText("content");

    foreach (var op in ops)
    {
      doc.Transact(transaction =>
      {
        switch (op)
        {
          case CollabEditOp.Insert insert:
            text.Insert(
                transaction,
                text.ToString().Length,
                insert.Block["data"]?["text"]?.GetValue<string>() ?? "");

            break;

          case CollabEditOp.Update update:
            text.Delete(transaction, 0, text.ToString().Length);
            text.Insert(transaction, 0, update.Data["text"]?.GetValue<string>() ?? "");

            break;

          default:
            text.Delete(transaction, 0, text.ToString().Length);

            break;
        }
      });
    }
  }

  public JsonNode Export(YDoc doc)
  {
    Exports++;

    if (NextExportFailure is not null)
    {
      var failure = NextExportFailure;
      NextExportFailure = null;

      throw failure;
    }

    return new JsonObject { ["text"] = YDocs.Text(doc) };
  }
}

internal sealed class FakeMember(bool canWrite = true, bool acceptsControlFrames = false) : ICollabMember
{
  public bool CanWrite => canWrite;

  public bool AcceptsControlFrames => acceptsControlFrames;

  internal List<SyncWireMessage> Received { get; } = [];

  internal List<CollabCloseReason> Closes { get; } = [];

  public void Send(byte[] frame)
  {
    Assert.True(SyncWire.TryDecode(frame, out var message, out var error), error);
    Received.Add(message);
  }

  public void Close(CollabCloseReason reason)
  {
    Closes.Add(reason);
  }
}

/// <summary>Client-side Yjs helpers over the same "content" text root.</summary>
internal static class YDocs
{
  private static long nextClientId = 1_000_000;

  /// <summary>
  /// A doc with a unique client id. A random one would collide across a long
  /// run, and yjs drops a second update carrying an already-seen
  /// (client, clock) pair — which would silently hide room bugs.
  /// </summary>
  internal static YDoc NewClient()
  {
    return new YDoc((uint)Interlocked.Increment(ref nextClientId));
  }

  internal static byte[] UpdateAppending(YDoc doc, string value)
  {
    var text = doc.GetText("content");

    return doc.Transact(
            transaction => text.Insert(transaction, text.ToString().Length, value)) ??
        throw new InvalidOperationException("no update was emitted");
  }

  internal static byte[] StateVector(YDoc doc)
  {
    return doc.EncodeStateVector();
  }

  internal static byte[] FullState(YDoc doc)
  {
    return doc.EncodeStateAsUpdate();
  }

  internal static void Apply(YDoc doc, byte[] update)
  {
    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(update).Outcome);
  }

  internal static string Text(YDoc doc)
  {
    return doc.GetText("content").ToString();
  }

  internal static YDoc DocWith(string value)
  {
    var doc = NewClient();
    UpdateAppending(doc, value);

    return doc;
  }

  /// <summary>The text a fresh replica reads after applying <paramref name="frames"/> in order.</summary>
  internal static string Replay(IReadOnlyList<byte[]> frames)
  {
    var replica = NewClient();

    foreach (var frame in frames)
    {
      Apply(replica, frame);
    }

    return Text(replica);
  }
}

/// <summary>
/// Frames from test/unit/server-conformance/fixtures/sync-frames.json, as a
/// stock y-websocket + y-protocols client wrote them.
/// </summary>
internal static class SyncFrames
{
  internal static byte[] Payload(string name)
  {
    var fixture = JsonNode.Parse(File.ReadAllText(FixturePath())) ??
        throw new InvalidDataException("sync-frames.json is empty");

    foreach (var frame in fixture["frames"]!.AsArray())
    {
      if (frame?["name"]?.GetValue<string>() == name)
      {
        return Convert.FromHexString(frame["payloadHex"]!.GetValue<string>());
      }
    }

    throw new InvalidDataException($"sync-frames.json has no frame named {name}");
  }

  private static string FixturePath()
  {
    for (var current = new DirectoryInfo(AppContext.BaseDirectory);
         current is not null;
         current = current.Parent)
    {
      if (File.Exists(Path.Combine(current.FullName, "Blok.Server.slnx")))
      {
        return Path.GetFullPath(Path.Combine(
            current.FullName,
            "..", "..", "..",
            "test", "unit", "server-conformance", "fixtures",
            "sync-frames.json"));
      }
    }

    throw new DirectoryNotFoundException("Could not locate the Blok.Server solution root.");
  }
}

internal static class Waits
{
  private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(10);

  /// <summary>
  /// Waits for work a RETRY timer will do. The retry is armed inside a posted
  /// lane callback, so the test cannot know the clock reading it was armed
  /// from — advancing once may miss it. Advancing on every poll cannot.
  /// </summary>
  internal static Task UntilAdvancingAsync(
      ManualTimeProvider time,
      TimeSpan step,
      Func<bool> condition,
      string what)
  {
    return UntilAsync(
        () =>
        {
          if (condition())
          {
            return true;
          }

          time.Advance(step);

          return condition();
        },
        what);
  }

  internal static async Task UntilAsync(Func<bool> condition, string what)
  {
    var deadline = DateTime.UtcNow + Deadline;

    while (!condition())
    {
      if (DateTime.UtcNow > deadline)
      {
        Assert.Fail($"timed out waiting for {what}");
      }

      await Task.Delay(10);
    }
  }
}

/// <summary>
/// In-memory <see cref="ICollabOperationStore"/>. Appends really do deduplicate
/// by operation id and really do assign sequences from 1, so a test that drives
/// it exercises the contract rather than a stub; the knobs reproduce the three
/// store behaviours a room has to survive — slow, failing, and "committed but
/// could not say so".
/// </summary>
internal sealed class FakeCollabOperationStore : ICollabOperationStore
{
  private readonly Dictionary<string, FakeOperationDocument> documents =
      new(StringComparer.Ordinal);
  private readonly Lock guard = new();

  /// <summary>Awaited inside every append before it commits — a slow store.</summary>
  internal Func<Task>? BeforeAppend { get; set; }

  /// <summary>
  /// When it answers non-null for a doc, that doc's AppendAsync throws it. An
  /// id that is already committed still answers Duplicate/Conflict: the lookup
  /// succeeds even where the write would not.
  /// </summary>
  internal Func<string, Exception?>? FailAppends { get; set; }

  /// <summary>
  /// With <see cref="FailAppends"/> set, journal the record before throwing:
  /// the UNKNOWN outcome — durable to the store, failed to the caller. Retrying
  /// the same operation id must then read as a duplicate.
  /// </summary>
  internal bool CommitBeforeFailing { get; set; }

  /// <summary>Committed records for a doc, oldest first.</summary>
  internal IReadOnlyList<CollabOperationRecord> Committed(string docId)
  {
    lock (guard)
    {
      return documents.TryGetValue(docId, out var document)
        ? [.. document.Records]
        : [];
    }
  }

  internal CollabDocumentHead? Head(string docId)
  {
    lock (guard)
    {
      return documents.TryGetValue(docId, out var document) ? document.Head : null;
    }
  }

  /// <summary>Another process takes the fence while a session is still live.</summary>
  internal void StealFence(string docId)
  {
    lock (guard)
    {
      Document(docId).Fence++;
    }
  }

  public ValueTask<CollabDocumentOpen> OpenAsync(
      string documentId,
      CancellationToken cancellationToken = default)
  {
    cancellationToken.ThrowIfCancellationRequested();

    lock (guard)
    {
      var document = Document(documentId);

      if (document.IsOpen)
      {
        return ValueTask.FromResult(CollabDocumentOpen.DocumentOpenElsewhere);
      }

      document.IsOpen = true;
      document.Fence++;

      var openResult = new CollabOperationOpenResult(
          document.Head,
          [.. document.Baseline],
          document.Checkpoint,
          [.. document.Records.Where(record =>
              record.ServerSequence > (document.Checkpoint?.Through ?? 0))]);

      return ValueTask.FromResult(
          CollabDocumentOpen.Opened(
              new FakeOperationSession(this, documentId, document.Fence, openResult)));
    }
  }

  private FakeOperationDocument Document(string docId)
  {
    if (!documents.TryGetValue(docId, out var document))
    {
      document = new FakeOperationDocument();
      documents[docId] = document;
    }

    return document;
  }

  private sealed class FakeOperationDocument
  {
    internal CollabDocumentHead? Head { get; set; }

    internal List<ReadOnlyMemory<byte>> Baseline { get; set; } = [];

    internal CollabOperationCheckpoint? Checkpoint { get; set; }

    internal List<CollabOperationRecord> Records { get; } = [];

    internal long Fence { get; set; }

    internal bool IsOpen { get; set; }
  }

  private sealed class FakeOperationSession(
      FakeCollabOperationStore store,
      string documentId,
      long fence,
      CollabOperationOpenResult openResult) : ICollabOperationSession
  {
    private bool disposed;

    public CollabOperationOpenResult OpenResult => openResult;

    public async ValueTask<CollabOperationAppendResult> AppendAsync(
        CollabOperationCandidate candidate,
        CancellationToken cancellationToken = default)
    {
      ArgumentNullException.ThrowIfNull(candidate);
      cancellationToken.ThrowIfCancellationRequested();

      var pause = store.BeforeAppend;

      if (pause is not null)
      {
        await pause();
      }

      var failure = store.FailAppends?.Invoke(documentId);

      lock (store.guard)
      {
        var document = Fenced();
        var existing = document.Records.Find(record =>
            string.Equals(record.OperationId, candidate.OperationId, StringComparison.Ordinal));

        if (existing is not null)
        {
          return new CollabOperationAppendResult(
              candidate.Digest.Span.SequenceEqual(existing.Digest.Span)
                ? CollabOperationAppendOutcome.Duplicate
                : CollabOperationAppendOutcome.Conflict,
              existing.ServerSequence);
        }

        if (failure is not null && !store.CommitBeforeFailing)
        {
          throw failure;
        }

        var head = document.Head ?? throw new InvalidOperationException(
            $"collab: \"{documentId}\" was never seeded; reset it first");
        var sequence = head.DurableThrough + 1;

        document.Records.Add(new CollabOperationRecord(
            candidate.OperationId,
            sequence,
            DateTimeOffset.UnixEpoch.AddSeconds(sequence),
            candidate.ActorId,
            candidate.Source,
            candidate.Update,
            candidate.Digest));
        document.Head = head with { DurableThrough = sequence };

        return failure is not null
          ? throw failure
          : new CollabOperationAppendResult(
              CollabOperationAppendOutcome.Committed,
              sequence);
      }
    }

    public ValueTask WriteCheckpointAsync(
        CollabOperationCheckpoint checkpoint,
        CancellationToken cancellationToken = default)
    {
      ArgumentNullException.ThrowIfNull(checkpoint);
      cancellationToken.ThrowIfCancellationRequested();

      lock (store.guard)
      {
        var document = Fenced();

        if (checkpoint.Through == 0 ||
            checkpoint.Through > (document.Head?.DurableThrough ?? 0) ||
            checkpoint.Through <= (document.Checkpoint?.Through ?? 0))
        {
          throw new ArgumentOutOfRangeException(
              nameof(checkpoint),
              checkpoint.Through,
              "a checkpoint must name a committed sequence above the published one");
        }

        document.Checkpoint = checkpoint;
      }

      return ValueTask.CompletedTask;
    }

    public ValueTask<CollabDocumentHead> ResetAsync(
        CollabOperationReset reset,
        CancellationToken cancellationToken = default)
    {
      ArgumentNullException.ThrowIfNull(reset);
      cancellationToken.ThrowIfCancellationRequested();

      lock (store.guard)
      {
        var document = Fenced();

        document.Baseline = [.. reset.Baseline];
        document.Checkpoint = null;
        document.Records.Clear();
        document.Head = new CollabDocumentHead(
            reset.Format,
            reset.Epoch,
            reset.Lineage,
            DurableThrough: 0);

        return ValueTask.FromResult(document.Head);
      }
    }

    public ValueTask DisposeAsync()
    {
      if (!disposed)
      {
        disposed = true;

        lock (store.guard)
        {
          store.Document(documentId).IsOpen = false;
        }
      }

      return ValueTask.CompletedTask;
    }

    private FakeOperationDocument Fenced()
    {
      ObjectDisposedException.ThrowIf(disposed, this);

      var document = store.Document(documentId);

      return document.Fence == fence
        ? document
        : throw new CollabOperationFenceLostException();
    }
  }
}
