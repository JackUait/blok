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
/// time, each bounded by <see cref="CallTimeout"/>, so a slow observer
/// delays only later signals, never a room.
/// </remarks>
internal sealed class CollabChangeSignalHub
{
  /// <summary>Jobs waiting for the pump. Past it the oldest is dropped and logged.</summary>
  internal const int QueueLimit = 1024;

  /// <summary>The window when none or a non-positive one is set.</summary>
  internal static readonly TimeSpan DefaultWindow = TimeSpan.FromSeconds(60);

  /// <summary>The longest window. Past about 49.7 days a timer cannot be armed at all.</summary>
  internal static readonly TimeSpan MaxWindow = TimeSpan.FromDays(1);

  /// <summary>How long one journal read or one observer call may take before the pump moves on.</summary>
  internal static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(30);

  /// <summary>content.edited arrives at most once per this per document and actor.</summary>
  internal static readonly TimeSpan EditedWindow = TimeSpan.FromSeconds(55);

  /// <summary>Past this many throttle stamps, the ones the window no longer covers are swept.</summary>
  private const int EditedStampLimit = 4096;

  /// <summary>Reads (since, sequence] of one lineage, at most maxRecords of them.</summary>
  internal delegate ValueTask<CollabHistoryChangesResult> ReadChanges(
      string documentId,
      string lineage,
      ulong sequence,
      ulong since,
      int maxRecords,
      CancellationToken cancellationToken);

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
  private readonly Dictionary<(string Doc, string Actor), DateTimeOffset> edited = [];
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

  /// <summary>The window a host's setting runs: zero or less is the default, and it never passes <see cref="MaxWindow"/>.</summary>
  internal static TimeSpan WindowOf(TimeSpan setting) =>
      setting <= TimeSpan.Zero ? DefaultWindow : setting > MaxWindow ? MaxWindow : setting;

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

    return signals || events
      ? new CollabChangeSignalHub(observer, signals, events, WindowOf(length), time, read, log)
      : null;
  }

  /// <summary>
  /// A record was journalled. Call from the room's lane. Never throws: the
  /// record is already durable, and a hub failure must not fail its commit.
  /// </summary>
  internal void Committed(string documentId, string lineage, ulong sequence, string? actorId, CollabRecordNote? note)
  {
    try
    {
      if (signals)
      {
        OpenOrExtend(documentId, lineage, sequence, note);
      }

      if (events && !string.IsNullOrEmpty(actorId))
      {
        Edited(documentId, actorId, note);
      }
    }
    catch (Exception error)
    {
      Log($"collab: the change signal for \"{documentId}\" lost a record: {error.Message}");
    }
  }

  private void OpenOrExtend(string documentId, string lineage, ulong sequence, CollabRecordNote? note)
  {
    Window? closed = null;
    Window? opened = null;

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
        opened = window;
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

    if (opened is not null)
    {
      // Armed outside the lock: a timer that fires at once takes it.
      var timer = time.CreateTimer(_ => Close(documentId, opened), null, length, Timeout.InfiniteTimeSpan);

      lock (open)
      {
        opened.Timer = timer;
      }
    }
  }

  /// <summary>content.edited, throttled on its own stamps: a presence heartbeat never mutes it.</summary>
  private void Edited(string documentId, string actorId, CollabRecordNote? note)
  {
    var at = time.GetUtcNow();

    lock (edited)
    {
      if (edited.Count > EditedStampLimit)
      {
        foreach (var (key, stamp) in edited)
        {
          if (at - stamp >= EditedWindow)
          {
            edited.Remove(key);
          }
        }
      }

      if (edited.TryGetValue((documentId, actorId), out var last) && at - last < EditedWindow)
      {
        return;
      }

      edited[(documentId, actorId)] = at;
    }

    Event(new CollabAuditEvent(
        CollabAuditEventTypes.ContentEdited,
        documentId,
        at,
        new CollabAuditActor(actorId, note?.Kind, note?.OnBehalfOf)));
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
      Enqueue(() => BoundedAsync(token => observer.OnEventAsync(auditEvent, token).AsTask()), auditEvent.Type);
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
    lock (open)
    {
      window.Timer?.Dispose();
    }

    Enqueue(() => SignalAsync(documentId, window), "change signal");
  }

  /// <summary>Runs one call, giving up after <see cref="CallTimeout"/>. A call that ignores its token keeps running, unawaited.</summary>
  private async Task<T> BoundedAsync<T>(Func<CancellationToken, Task<T>> call)
  {
    using var deadline = new CancellationTokenSource(CallTimeout, time);

    return await call(deadline.Token).WaitAsync(CallTimeout, time);
  }

  private async Task BoundedAsync(Func<CancellationToken, Task> call)
  {
    using var deadline = new CancellationTokenSource(CallTimeout, time);

    await call(deadline.Token).WaitAsync(CallTimeout, time);
  }

  private async Task SignalAsync(string documentId, Window window)
  {
    var count = (int)Math.Min(window.To - window.From + 1, CollabRoomManager.MaxChangeRecords);
    var result = await BoundedAsync(token =>
        read(documentId, window.Lineage, window.To, window.From - 1, count, token).AsTask());

    if (result.Status != CollabHistoryStatus.Ready)
    {
      Log($"collab: the change signal for {window.From}..{window.To} of \"{documentId}\" was dropped: the history is {result.Status}");

      return;
    }

    var records = result.Changes
        .Select(record => CollabChangeSignals.FromChanges(
            window.Lineage,
            record,
            window.Notes.GetValueOrDefault(record.Sequence)))
        .ToList();

    if (CollabChangeSignals.Collapse(documentId, window.Start, window.Start + length, records) is not { } signal)
    {
      return;
    }

    // A cut read names only the records it folded; the host reads the rest through /history/changes.
    signal = result.Truncated
      ? signal with { Truncated = true }
      : signal with { FromSequence = window.From };

    await BoundedAsync(token => observer.OnChangesAsync(signal, token).AsTask());
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
      catch (TimeoutException)
      {
        Log($"collab: a change signal or audit event was dropped: a journal read or an observer call ran past {CallTimeout.TotalSeconds} seconds");
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
