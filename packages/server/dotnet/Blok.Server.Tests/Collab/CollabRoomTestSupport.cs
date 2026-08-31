using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Xunit;
using YDotNet.Document;
using YDotNet.Document.Options;
using YDotNet.Document.Transactions;

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

internal sealed record StoredWorkingSet(byte[] Frames, CollabWorkingSetTag Tag);

/// <summary>
/// In-memory working-set store. WriteAsync yields once so that two
/// unserialized callers could interleave — which is what the lane proof
/// counts on. Concurrent entries are tracked as a second witness.
/// </summary>
internal sealed class FakeWorkingSetStore : ICollabWorkingSetStore
{
  private readonly Dictionary<string, StoredWorkingSet> documents = new(StringComparer.Ordinal);
  private int inFlight;

  internal int Reads { get; private set; }

  internal int Writes { get; private set; }

  internal int Resets { get; private set; }

  internal int MaxConcurrentEntries { get; private set; }

  internal Func<Task>? BeforeWrite { get; set; }

  internal void Seed(string docId, IReadOnlyList<byte[]> updates, CollabWorkingSetTag tag)
  {
    documents[docId] = new StoredWorkingSet(CollabWorkingSetCodec.EncodeFrames(updates), tag);
  }

  internal bool Holds(string docId)
  {
    return documents.ContainsKey(docId);
  }

  internal StoredWorkingSet Stored(string docId)
  {
    return documents[docId];
  }

  internal List<byte[]> FramesOf(string docId)
  {
    Assert.True(CollabWorkingSetCodec.TryDecodeFrames(documents[docId].Frames, out var updates));

    return updates;
  }

  public async Task<CollabWorkingSet?> ReadAsync(string docId, CancellationToken cancellationToken = default)
  {
    using var entry = Enter();
    Reads++;
    await Task.Yield();

    return documents.TryGetValue(docId, out var stored)
      ? new CollabWorkingSet(stored.Frames, stored.Tag)
      : null;
  }

  public async Task WriteAsync(
      string docId,
      byte[] updates,
      CollabWorkingSetTag tag,
      CancellationToken cancellationToken = default)
  {
    using var entry = Enter();
    Writes++;

    if (BeforeWrite is not null)
    {
      await BeforeWrite();
    }

    await Task.Yield();
    documents[docId] = new StoredWorkingSet(updates, tag);
  }

  public async Task ResetAsync(
      string docId,
      CollabWorkingSetTag newTag,
      CancellationToken cancellationToken = default)
  {
    using var entry = Enter();
    Resets++;
    await Task.Yield();
    documents[docId] = new StoredWorkingSet([], newTag);
  }

  private Entry Enter()
  {
    var depth = Interlocked.Increment(ref inFlight);
    MaxConcurrentEntries = Math.Max(MaxConcurrentEntries, depth);

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

  internal int Loads { get; private set; }

  internal List<RecordedSave> Saves { get; } = [];

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
    Loads++;

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
    Saves.Add(new RecordedSave(docId, outputData.DeepClone(), version));

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

  public void Seed(Doc doc, JsonNode outputData)
  {
    Seeds++;
    SeededClientIds.Add(doc.Id);
    var text = doc.Text("content");
    using var transaction = doc.WriteTransaction();
    var length = text.Length(transaction);

    if (length > 0)
    {
      text.RemoveRange(transaction, 0, length);
    }

    text.Insert(transaction, 0, outputData["text"]?.GetValue<string>() ?? "");
  }

  public JsonNode Export(Doc doc)
  {
    Exports++;

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
  /// A doc with a unique client id. YDotNet's default ids collide between
  /// fresh Docs, and yrs drops a second update carrying an already-seen
  /// (client, clock) pair — which would silently hide room bugs.
  /// </summary>
  internal static Doc NewClient()
  {
    return new Doc(new DocOptions
    {
      Id = (ulong)Interlocked.Increment(ref nextClientId),
    });
  }

  internal static byte[] UpdateAppending(Doc doc, string value)
  {
    var text = doc.Text("content");
    byte[]? captured = null;
    using var subscription = doc.ObserveUpdatesV1(updateEvent => captured = updateEvent.Update);

    using (var transaction = doc.WriteTransaction())
    {
      text.Insert(transaction, text.Length(transaction), value);
    }

    return captured ?? throw new InvalidOperationException("no update was observed");
  }

  internal static byte[] StateVector(Doc doc)
  {
    using var transaction = doc.ReadTransaction();

    return transaction.StateVectorV1();
  }

  internal static byte[] FullState(Doc doc)
  {
    using var transaction = doc.ReadTransaction();

    return transaction.StateDiffV1([0]);
  }

  internal static void Apply(Doc doc, byte[] update)
  {
    using var transaction = doc.WriteTransaction();
    Assert.Equal(TransactionUpdateResult.Ok, transaction.ApplyV1(update));
  }

  internal static string Text(Doc doc)
  {
    var text = doc.Text("content");
    using var transaction = doc.ReadTransaction();

    return text.String(transaction);
  }

  internal static Doc DocWith(string value)
  {
    var doc = NewClient();
    UpdateAppending(doc, value);

    return doc;
  }
}

internal static class Waits
{
  private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(10);

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
