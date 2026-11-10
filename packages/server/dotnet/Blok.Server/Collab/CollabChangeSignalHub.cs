namespace Blok.Server.Collab;

/// <summary>
/// Keeps each document's open change window and hands signals and audit
/// events to the host's observer. Exists only when the observer overrides
/// <see cref="ICollabActivityObserver.OnChangesAsync"/> or
/// <see cref="ICollabActivityObserver.OnEventAsync"/>, so a host that does
/// not pays nothing.
/// </summary>
/// <remarks>
/// The room calls in from its lane and only touches a small lock here. The
/// journal read, the fold and the observer calls run on one pump, one at a
/// time, so a slow observer delays only later signals, never a room.
/// </remarks>
internal sealed class CollabChangeSignalHub
{
  /// <summary>Jobs waiting for the pump. Past it the oldest is dropped and logged.</summary>
  internal const int QueueLimit = 1024;

  /// <summary>Reads (since, sequence] of one lineage, at most maxRecords of them.</summary>
  internal delegate ValueTask<CollabHistoryChangesResult> ReadChanges(
      string documentId,
      string lineage,
      ulong sequence,
      ulong since,
      int maxRecords);

  private sealed class Window(string lineage, ulong from, DateTimeOffset start)
  {
    public string Lineage { get; } = lineage;
    public ulong From { get; } = from;
    public DateTimeOffset Start { get; } = start;
    public ulong To { get; set; } = from;
    public ITimer? Timer { get; set; }
    public bool Closed { get; set; }
    public Dictionary<ulong, CollabRecordNote> Notes { get; } = [];
  }

  private readonly ICollabActivityObserver observer;
  private readonly bool signals;
  private readonly bool events;
  private readonly TimeSpan length;
  private readonly TimeProvider time;
  private readonly ReadChanges read;
  private readonly Action<string>? log;
  private readonly Dictionary<string, Window> open = new(StringComparer.Ordinal);
  private readonly LinkedList<Func<Task>> queue = new();
  private bool pumping;
  private Task dispatch = Task.CompletedTask;

  private CollabChangeSignalHub(
      ICollabActivityObserver observer,
      bool signals,
      bool events,
      TimeSpan length,
      TimeProvider time,
      ReadChanges read,
      Action<string>? log)
  {
    this.observer = observer;
    this.signals = signals;
    this.events = events;
    this.length = length;
    this.time = time;
    this.read = read;
    this.log = log;
  }

  /// <summary>Null unless the observer overrides one of the two members.</summary>
  internal static CollabChangeSignalHub? For(
      ICollabActivityObserver? observer,
      TimeSpan length,
      TimeProvider time,
      ReadChanges read,
      Action<string>? log)
  {
    if (observer is null)
    {
      return null;
    }

    var map = observer.GetType().GetInterfaceMap(typeof(ICollabActivityObserver));
    bool Overrides(string name) =>
        map.InterfaceMethods.Zip(map.TargetMethods)
            .Any(pair => pair.First.Name == name && pair.Second.DeclaringType != typeof(ICollabActivityObserver));

    var signals = Overrides(nameof(ICollabActivityObserver.OnChangesAsync));
    var events = Overrides(nameof(ICollabActivityObserver.OnEventAsync));

    return signals || events ? new CollabChangeSignalHub(observer, signals, events, length, time, read, log) : null;
  }

  /// <summary>A record was journalled. Call from the room's lane.</summary>
  internal void Committed(string documentId, string lineage, ulong sequence, CollabRecordNote? note)
  {
    if (!signals)
    {
      return;
    }

    Window? closed = null;

    lock (open)
    {
      if (open.TryGetValue(documentId, out var window) &&
          !string.Equals(window.Lineage, lineage, StringComparison.Ordinal))
      {
        open.Remove(documentId);
        window.Closed = true;
        closed = window;
        window = null;
      }

      if (window is null)
      {
        window = new Window(lineage, sequence, time.GetUtcNow());
        open[documentId] = window;
        var opened = window;
        window.Timer = time.CreateTimer(_ => Close(documentId, opened), null, length, Timeout.InfiniteTimeSpan);
      }

      window.To = sequence;

      if (note is not null)
      {
        window.Notes[sequence] = note;
      }
    }

    if (closed is not null)
    {
      Deliver(documentId, closed);
    }
  }

  /// <summary>A purged document's open window is dropped: its records are gone.</summary>
  internal void Forget(string documentId)
  {
    lock (open)
    {
      if (open.Remove(documentId, out var window))
      {
        window.Closed = true;
        window.Timer?.Dispose();
      }
    }
  }

  internal void Event(CollabAuditEvent auditEvent)
  {
    if (events)
    {
      Enqueue(() => observer.OnEventAsync(auditEvent, CancellationToken.None).AsTask(), auditEvent.Type);
    }
  }

  /// <summary>Completes once every queued job has run.</summary>
  internal Task SettleAsync()
  {
    lock (queue)
    {
      return dispatch;
    }
  }

  private void Close(string documentId, Window window)
  {
    lock (open)
    {
      if (window.Closed)
      {
        return;
      }

      window.Closed = true;

      if (open.TryGetValue(documentId, out var current) && current == window)
      {
        open.Remove(documentId);
      }
    }

    Deliver(documentId, window);
  }

  private void Deliver(string documentId, Window window)
  {
    window.Timer?.Dispose();
    Enqueue(() => SignalAsync(documentId, window), "change signal");
  }

  private async Task SignalAsync(string documentId, Window window)
  {
    var count = (int)Math.Min(window.To - window.From + 1, int.MaxValue);
    var result = await read(documentId, window.Lineage, window.To, window.From - 1, count);

    if (result.Status != CollabHistoryStatus.Ready)
    {
      log?.Invoke(
          $"collab: the change signal for {window.From}..{window.To} of \"{documentId}\" was dropped: the history is {result.Status}");

      return;
    }

    if (result.Truncated)
    {
      log?.Invoke(
          $"collab: the change signal for {window.From}..{window.To} of \"{documentId}\" lists only the newest records that fit one read");
    }

    var records = result.Changes
        .Select(record => CollabChangeSignals.FromChanges(
            window.Lineage,
            record,
            window.Notes.GetValueOrDefault(record.Sequence)))
        .ToList();

    if (CollabChangeSignals.Collapse(documentId, window.Start, window.Start + length, records) is { } signal)
    {
      await observer.OnChangesAsync(signal with { FromSequence = window.From }, CancellationToken.None);
    }
  }

  private void Enqueue(Func<Task> job, string what)
  {
    var dropped = false;

    lock (queue)
    {
      if (queue.Count == QueueLimit)
      {
        queue.RemoveFirst();
        dropped = true;
      }

      queue.AddLast(job);

      if (!pumping)
      {
        pumping = true;
        dispatch = Task.Run(PumpAsync);
      }
    }

    if (dropped)
    {
      Log($"collab: a change signal or audit event was dropped before {what}; the observer is behind");
    }
  }

  private async Task PumpAsync()
  {
    while (true)
    {
      Func<Task> next;

      lock (queue)
      {
        if (queue.Count == 0)
        {
          pumping = false;

          return;
        }

        next = queue.First!.Value;
        queue.RemoveFirst();
      }

      try
      {
        await next();
      }
      catch (Exception error)
      {
        Log($"collab: the activity observer failed on a change signal or audit event: {error.Message}");
      }
    }
  }

  private void Log(string message)
  {
    try
    {
      log?.Invoke(message);
    }
    catch (Exception)
    {
      // A failed logger must not stop the pump.
    }
  }
}
