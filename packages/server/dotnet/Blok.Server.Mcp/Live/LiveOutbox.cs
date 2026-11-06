using System.Security.Cryptography;

namespace Blok.Server.Mcp.Live;

/// <summary>One pending write: the update bytes and the lineage they were stamped with.</summary>
internal sealed record OutboxRow(string OperationId, string Lineage, int Format, byte[] Bytes);

/// <summary>What became of a batch's rows.</summary>
internal abstract record BatchDelivery
{
  internal sealed record Acked(string? ServerSequence) : BatchDelivery;

  internal sealed record Quarantined(string Reason) : BatchDelivery;

  internal sealed record Timeout : BatchDelivery;
}

/// <summary>
/// The headless room's in-memory operation store and TrackingOutbox in one
/// (operation-store.ts memory mode, tracking-outbox.ts). Loop-owned.
/// </summary>
internal sealed class LiveOutbox
{
  internal const int SupportedFormat = 2;

  private readonly List<OutboxRow> memory = [];
  private readonly Dictionary<string, Fate> fates = new(StringComparer.Ordinal);
  private readonly List<string> order = [];
  private readonly List<Action> listeners = [];
  private string? lineage;
  private string? protocol;
  private string? nextSequence;

  /// <summary>recordSession: rows can only be stamped once the session names a lineage.</summary>
  internal void RecordSession(string sessionLineage, int format, string sessionProtocol)
  {
    if (format != SupportedFormat)
    {
      lineage = null;
      protocol = null;

      return;
    }
    lineage = sessionLineage;
    protocol = sessionProtocol;
  }

  /// <summary>Throws as operation-store.ts does when no v2 session names a lineage.</summary>
  internal OutboxRow AppendLocal(byte[] update)
  {
    if (lineage is null)
    {
      throw new InvalidOperationException("Blok collaboration: a local edit arrived before the session named a lineage");
    }
    if (protocol != "v2")
    {
      throw new InvalidOperationException("Blok collaboration: a v2 operation was appended on a session that is not v2");
    }
    var row = new OutboxRow(Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)), lineage, SupportedFormat, update);

    memory.Add(row);
    fates[row.OperationId] = new Fate.Pending(row.Lineage, row.Format);
    order.Add(row.OperationId);

    return row;
  }

  internal OutboxRow? OldestPending()
  {
    return memory.Count == 0 ? null : memory[0];
  }

  internal void NoteSequence(string serverSequence)
  {
    nextSequence = serverSequence;
  }

  internal void Acknowledge(string operationId)
  {
    memory.RemoveAll(row => row.OperationId == operationId);
    if (fates.GetValueOrDefault(operationId) is Fate.Pending)
    {
      fates[operationId] = new Fate.Acked(nextSequence);
    }
    nextSequence = null;
    Notify();
  }

  /// <returns>How many pending rows moved.</returns>
  internal int QuarantineLineage(string quarantined, string reason, int? keepFormat = null)
  {
    // A quarantined lineage takes no more rows; a stale-format sweep keeps it live.
    if (lineage == quarantined && keepFormat is null)
    {
      lineage = null;
      protocol = null;
    }
    bool Moves(OutboxRow row) => row.Lineage == quarantined && row.Format != keepFormat;
    var moved = memory.RemoveAll(Moves);

    foreach (var (id, fate) in fates.ToList())
    {
      if (fate is Fate.Pending pending && pending.Lineage == quarantined && pending.Format != keepFormat)
      {
        fates[id] = new Fate.Quarantined(reason);
      }
    }
    Notify();

    return moved;
  }

  internal int AppendedCount => order.Count;

  internal IReadOnlyList<string> IdsSince(int mark)
  {
    return order.Skip(mark).ToList();
  }

  internal bool IsAcked(string id)
  {
    return fates.GetValueOrDefault(id) is Fate.Acked;
  }

  /// <summary>Settles once every id is acked or any one is quarantined; acks arrive in order, so the last id's sequence is the batch's.</summary>
  internal Task<BatchDelivery> WaitForAsync(IReadOnlyList<string> ids, LiveLoop loop, TimeSpan timeout, CancellationToken ended)
  {
    var done = new TaskCompletionSource<BatchDelivery>(TaskCreationOptions.RunContinuationsAsynchronously);
    LiveTimer? timer = null;
    CancellationTokenRegistration registration = default;
    Action? listener = null;

    void Finish(BatchDelivery delivery)
    {
      if (listener is not null)
      {
        listeners.Remove(listener);
      }
      timer?.Dispose();
      registration.Dispose();
      done.TrySetResult(delivery);
    }

    bool Check()
    {
      var found = ids.Select(id => fates.GetValueOrDefault(id)).ToList();

      if (found.OfType<Fate.Quarantined>().FirstOrDefault() is { } quarantined)
      {
        Finish(new BatchDelivery.Quarantined(quarantined.Reason));

        return true;
      }
      if (found.All(fate => fate is Fate.Acked))
      {
        Finish(new BatchDelivery.Acked(found.Count == 0 ? null : ((Fate.Acked)found[^1]!).ServerSequence));

        return true;
      }

      return false;
    }

    if (Check())
    {
      return done.Task;
    }
    listener = () => Check();
    listeners.Add(listener);
    timer = loop.Schedule(timeout, () => Finish(new BatchDelivery.Timeout()));
    registration = ended.Register(() => loop.Post(() => Finish(new BatchDelivery.Timeout())));

    return done.Task;
  }

  private void Notify()
  {
    foreach (var listener in listeners.ToList())
    {
      listener();
    }
  }

  private abstract record Fate
  {
    internal sealed record Pending(string Lineage, int Format) : Fate;

    internal sealed record Acked(string? ServerSequence) : Fate;

    internal sealed record Quarantined(string Reason) : Fate;
  }
}
