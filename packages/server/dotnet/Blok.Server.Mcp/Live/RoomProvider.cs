using Blok.Server.Collab;

namespace Blok.Server.Mcp.Live;

/// <summary>The local document and presence a provider syncs (provider.ts CollabDocSeam, headless subset).</summary>
internal interface IRoomSeam
{
  LiveAwareness Awareness { get; }

  byte[] StateVector();

  byte[] EncodeStateAsUpdate(byte[]? stateVector);

  /// <summary>Applies a peer's or the host's update; throws when the bytes cannot be applied.</summary>
  void ApplyRemote(byte[] update);

  /// <summary>A new, empty doc and awareness that keep the local presence state.</summary>
  void ResetForRelineage();
}

/// <summary>Opens one room socket: the handshake, Origin and ticket subprotocol live in the owner.</summary>
internal delegate Task<RoomConnection> RoomConnector(IReadOnlyList<string> protocols, CancellationToken cancellationToken);

/// <summary>A ticket for the next connection; forceRefresh after a 4401.</summary>
internal delegate Task<string?> RoomTicketSource(bool forceRefresh);

internal enum RoomStatus
{
  Offline,
  Connecting,
  Connected,
  Error,
}

/// <summary>
/// provider.ts for a headless writer, kept line for line where it matters:
/// phases, the pre-control buffer, handshake and first-sync timers, backoff,
/// close codes, relineage, the v2 drain with one operation in flight, the
/// redrive, the residual round, the limits cap and Activity on handshake.
/// Every member runs on the loop.
/// </summary>
internal sealed class RoomProvider
{
  internal const string SubprotocolV1 = "blok-sync.v1";
  internal const string SubprotocolV2 = "blok-sync.v2";
  internal const string RelineageReason = "lineage-reset";
  private const int SupportedFormat = 2;
  private const int MaxHandshakeTimeoutsSinceSync = 3;
  private const int BackoffBaseMs = 1000;
  private const int BackoffCapMs = 30_000;
  private const int ShortReconnectMs = 250;
  private const int EmptyUpdateBytes = 2;
  private const int MaxBufferedInbound = 64;
  private const int CloseNormal = 1000;
  private const int CloseGoingAway = 1001;
  private const int ClosePolicyViolation = 1008;
  private const int CloseMessageTooBig = 1009;
  private const int CloseUnauthorized = 4401;
  private const int CloseLineageReset = 4409;
  private const string TransientRejection = "not-synced";
  private const string LineageMismatch = "lineage-mismatch";
  private const string OversizedReason = "oversized-update";
  private const string StaleLineageReason = "stale-lineage";
  private const string StaleFormatReason = "stale-format";
  private static readonly TimeSpan ActivityHandshakeInterval = TimeSpan.FromSeconds(60);

  private readonly LiveLoop loop;
  private readonly IRoomSeam seam;
  private readonly LiveOutbox outbox;
  private readonly RoomConnector connect;
  private readonly RoomTicketSource? tickets;
  private readonly Action<RoomStatus, string?> onStatus;
  private readonly Func<double> random;
  private readonly Func<DateTimeOffset> now;
  private readonly HashSet<ulong> awarenessClients = [];
  private readonly List<SyncWireMessage> buffered = [];

  private int generation;
  private string phase = "idle";
  private RoomConnection? socket;
  private CancellationTokenSource? connecting;
  private object? origin;
  private string? lineage;
  private LiveTimer? handshakeTimer;
  private LiveTimer? firstSyncTimer;
  private LiveTimer? reconnectTimer;
  private LiveTimer? awarenessTimer;
  private LiveTimer? ackTimer;
  private bool awarenessFull;
  private bool hooked;
  private int attempt;
  private int unauthorizedSinceSync;
  private int oversizedSinceSync;
  private int handshakeTimeoutsSinceSync;
  private int largestSentBytes;
  private int? refusedFrameBytes;
  private long? announcedMaxBytes;
  private bool forceTicketRefresh;
  private bool synced;
  private bool destroyed;
  private string? inFlight;
  private bool resyncOwed;
  private string residual = "none";
  private DateTimeOffset? lastActivitySentAt;

  internal RoomProvider(
      LiveLoop loop, IRoomSeam seam, LiveOutbox outbox, RoomConnector connect, RoomTicketSource? tickets,
      Action<RoomStatus, string?> onStatus, Func<double>? random = null, Func<DateTimeOffset>? now = null)
  {
    this.loop = loop;
    this.seam = seam;
    this.outbox = outbox;
    this.connect = connect;
    this.tickets = tickets;
    this.onStatus = onStatus;
    this.random = random ?? Random.Shared.NextDouble;
    this.now = now ?? (() => DateTimeOffset.UtcNow);
  }

  internal RoomStatus Status { get; private set; } = RoomStatus.Offline;

  internal CollabWorkingSetTag? Tag { get; private set; }

  internal string Protocol { get; private set; } = "v1";

  internal TimeSpan HandshakeTimeout { get; init; } = TimeSpan.FromSeconds(10);

  internal TimeSpan AwarenessThrottle { get; init; } = TimeSpan.FromMilliseconds(100);

  internal TimeSpan AckTimeout { get; init; } = TimeSpan.FromSeconds(15);

  internal void Connect()
  {
    if (destroyed || phase == "terminal" || phase is not ("idle" or "offline") || reconnectTimer is not null)
    {
      return;
    }
    OpenGeneration();
  }

  internal bool SendActivity()
  {
    if (socket is null || phase != "ready")
    {
      return false;
    }
    Send(socket, new ActivityFrame());

    return true;
  }

  internal void Drain()
  {
    if (socket is null || phase != "ready" || Protocol != "v2" || !synced || inFlight is not null)
    {
      return;
    }
    var row = outbox.OldestPending();

    if (row is null)
    {
      RequestResidualSync(socket);

      return;
    }
    if (row.Format != SupportedFormat)
    {
      if (QuarantineTail(row.Lineage, StaleFormatReason, SupportedFormat) > 0)
      {
        loop.Post(Drain);
      }

      return;
    }
    if (row.Lineage != lineage)
    {
      if (QuarantineTail(row.Lineage, StaleLineageReason) > 0)
      {
        loop.Post(Drain);
      }

      return;
    }
    SendOperation(socket, row);
  }

  /// <summary>The v1 seam hook: a local update goes out as a 0/2 Update while hooked.</summary>
  internal void OnLocalUpdate(byte[] update)
  {
    if (!hooked || socket is null || Protocol == "v2")
    {
      return;
    }
    var bytes = SyncWire.Encode(new SyncUpdateFrame(update));

    if (announcedMaxBytes is { } announced && bytes.Length > announced)
    {
      Terminate("oversized-update");

      return;
    }
    SendBytes(socket, bytes);
  }

  internal void Destroy()
  {
    if (destroyed)
    {
      return;
    }
    AnnounceDeparture();
    destroyed = true;
    TeardownGeneration(true);
    reconnectTimer = Clear(reconnectTimer);
    phase = "terminal";
  }

  private void Report(RoomStatus status, string? error = null)
  {
    if (destroyed)
    {
      return;
    }
    Status = status;
    onStatus(status, error);
  }

  private static LiveTimer? Clear(LiveTimer? timer)
  {
    timer?.Dispose();

    return null;
  }

  private void SendBytes(RoomConnection target, byte[] bytes)
  {
    largestSentBytes = Math.Max(largestSentBytes, bytes.Length);
    target.Send(bytes);
  }

  private void Send(RoomConnection target, SyncWireMessage frame)
  {
    SendBytes(target, SyncWire.Encode(frame));
  }

  private void FlushAwareness()
  {
    var full = awarenessFull;
    var clients = awarenessClients.ToList();

    awarenessFull = false;
    awarenessClients.Clear();
    if (socket is null || phase != "ready" || (!full && clients.Count == 0))
    {
      return;
    }
    Send(socket, new AwarenessFrame(seam.Awareness.Encode(full ? null : clients)));
  }

  private void AnnounceDeparture()
  {
    if (socket is null || phase != "ready" || seam.Awareness.EncodeLocalDeparture() is not { } update)
    {
      return;
    }
    Send(socket, new AwarenessFrame(update));
  }

  private void SendActivityOnHandshake()
  {
    var time = now();

    if (lastActivitySentAt is { } last && time - last < ActivityHandshakeInterval)
    {
      return;
    }
    lastActivitySentAt = time;
    SendActivity();
  }

  private void ScheduleAwareness(bool full)
  {
    awarenessFull = awarenessFull || full;
    if (awarenessTimer is not null)
    {
      return;
    }
    awarenessTimer = loop.Schedule(AwarenessThrottle, () =>
    {
      awarenessTimer = null;
      FlushAwareness();
    });
  }

  private void OnAwarenessUpdated(AwarenessChange change, object? changeOrigin)
  {
    if (changeOrigin == origin)
    {
      return;
    }
    foreach (var client in change.Added.Concat(change.Updated).Concat(change.Removed))
    {
      awarenessClients.Add(client);
    }
    ScheduleAwareness(false);
  }

  private void HookSeam()
  {
    hooked = true;
    seam.Awareness.Updated += OnAwarenessUpdated;
  }

  private void Unhook()
  {
    hooked = false;
    seam.Awareness.Updated -= OnAwarenessUpdated;
  }

  private void TeardownGeneration(bool closeSocket)
  {
    Unhook();
    handshakeTimer = Clear(handshakeTimer);
    firstSyncTimer = Clear(firstSyncTimer);
    awarenessTimer = Clear(awarenessTimer);
    ackTimer = Clear(ackTimer);
    inFlight = null;
    resyncOwed = false;
    residual = "none";
    awarenessClients.Clear();
    awarenessFull = false;
    connecting?.Cancel();
    connecting?.Dispose();
    connecting = null;
    if (socket is not null)
    {
      if (closeSocket)
      {
        socket.Close(CloseNormal);
      }
      else
      {
        socket.Detach();
      }
    }
    socket = null;
    origin = null;
    buffered.Clear();
    synced = false;
    phase = "offline";
    seam.Awareness.ClearRemote();
  }

  private void Terminate(string error)
  {
    TeardownGeneration(true);
    reconnectTimer = Clear(reconnectTimer);
    phase = "terminal";
    Report(RoomStatus.Error, error);
  }

  private int NextDelayMs(int? code)
  {
    attempt += code == ClosePolicyViolation ? 2 : 1;
    if (code == CloseGoingAway && attempt == 1)
    {
      return ShortReconnectMs;
    }
    var ceiling = Math.Min(BackoffCapMs, BackoffBaseMs * Math.Pow(2, attempt - 1));

    return (int)Math.Round(ceiling * (0.5 + (random() * 0.5)));
  }

  private void ScheduleReconnect(int? code)
  {
    var delay = NextDelayMs(code);

    Report(RoomStatus.Offline);
    reconnectTimer = loop.Schedule(TimeSpan.FromMilliseconds(delay), () =>
    {
      reconnectTimer = null;
      OpenGeneration();
    });
  }

  private int QuarantineTail(string tailLineage, string reason, int? keepFormat = null)
  {
    return outbox.QuarantineLineage(tailLineage, reason, keepFormat);
  }

  private void FinishRelineage(int? code)
  {
    seam.ResetForRelineage();
    lineage = null;
    Tag = null;
    ScheduleReconnect(code);
  }

  private void Relineage(int? code)
  {
    if (lineage is { } current)
    {
      QuarantineTail(current, RelineageReason);
    }
    FinishRelineage(code);
  }

  private void SendOperation(RoomConnection target, OutboxRow row)
  {
    var bytes = SyncWire.Encode(new OperationFrame(row.Lineage, row.OperationId, row.Bytes));

    if (announcedMaxBytes is { } announced && bytes.Length > announced)
    {
      QuarantineTail(row.Lineage, OversizedReason);

      return;
    }
    SendBytes(target, bytes);
    inFlight = row.OperationId;
    ackTimer = loop.Schedule(AckTimeout, () =>
    {
      ackTimer = null;
      TeardownGeneration(true);
      ScheduleReconnect(null);
    });
  }

  private void RequestResidualSync(RoomConnection target)
  {
    if (!resyncOwed || residual != "none")
    {
      return;
    }
    resyncOwed = false;
    residual = "requested";
    Send(target, new SyncStep1Frame(seam.StateVector()));
  }

  private void HandleResync(byte[] stateVector)
  {
    if (residual != "requested")
    {
      resyncOwed = true;
      Drain();

      return;
    }
    residual = "done";
    var rest = seam.EncodeStateAsUpdate(stateVector);

    if (rest.Length <= EmptyUpdateBytes)
    {
      return;
    }
    try
    {
      outbox.AppendLocal(rest);
      loop.Post(Drain);
    }
    catch (InvalidOperationException error)
    {
      Console.Error.WriteLine($"blok-mcp: could not journal the residual state: {error.Message}");
    }
  }

  private void HandleAcknowledgement(AcknowledgementFrame frame)
  {
    if (Protocol != "v2" || lineage is null || frame.Lineage != lineage)
    {
      return;
    }
    if (inFlight == frame.OperationId)
    {
      inFlight = null;
      ackTimer = Clear(ackTimer);
    }
    outbox.NoteSequence(frame.ServerSequence.ToString(System.Globalization.CultureInfo.InvariantCulture));
    outbox.Acknowledge(frame.OperationId);
    Drain();
  }

  private void HandleRejection(RejectionFrame frame)
  {
    if (Protocol != "v2" || lineage is null || frame.Lineage != lineage)
    {
      return;
    }
    if (inFlight == frame.OperationId)
    {
      inFlight = null;
      ackTimer = Clear(ackTimer);
    }
    if (frame.Code == LineageMismatch)
    {
      TeardownGeneration(true);
      Relineage(null);

      return;
    }
    if (frame.Code == TransientRejection)
    {
      TeardownGeneration(true);
      ScheduleReconnect(null);

      return;
    }
    QuarantineTail(lineage, frame.Code);
  }

  private void MarkSynced()
  {
    if (synced)
    {
      return;
    }
    synced = true;
    firstSyncTimer = Clear(firstSyncTimer);
    attempt = 0;
    unauthorizedSinceSync = 0;
    handshakeTimeoutsSinceSync = 0;
    Report(RoomStatus.Connected);
    Drain();
  }

  private void AnswerResync(RoomConnection target, byte[] stateVector)
  {
    var bytes = SyncWire.Encode(new SyncStep2Frame(seam.EncodeStateAsUpdate(stateVector)));

    if ((announcedMaxBytes is { } announced && bytes.Length > announced) || (refusedFrameBytes is { } refused && bytes.Length >= refused))
    {
      Terminate("oversized-update");

      return;
    }
    SendBytes(target, bytes);
    refusedFrameBytes = null;
    oversizedSinceSync = 0;
  }

  private void HandleFrame(RoomConnection target, SyncWireMessage frame)
  {
    switch (frame)
    {
      case SyncStep2Frame step2:
        seam.ApplyRemote(step2.Update);
        MarkSynced();
        break;
      case SyncUpdateFrame update:
        seam.ApplyRemote(update.Update);
        break;
      case SyncStep1Frame step1:
        if (Protocol == "v2")
        {
          HandleResync(step1.StateVector);
        }
        else
        {
          AnswerResync(target, step1.StateVector);
        }
        break;
      case AwarenessFrame awareness:
        DropOnThrow(() => seam.Awareness.Apply(awareness.Update, origin));
        break;
      case QueryAwarenessFrame:
        ScheduleAwareness(true);
        break;
      case BlokLimitsFrame limits:
        announcedMaxBytes = limits.MaxMessageBytes;
        break;
      case AcknowledgementFrame ack:
        HandleAcknowledgement(ack);
        break;
      case RejectionFrame rejection:
        HandleRejection(rejection);
        break;
      default:
        // Permission denied, identities: a headless member has no use for them.
        break;
    }
  }

  private static void DropOnThrow(Action apply)
  {
    try
    {
      apply();
    }
    catch (Exception error) when (error is not OutOfMemoryException)
    {
      Console.Error.WriteLine($"blok-mcp: dropped a presence frame: {error.Message}");
    }
  }

  private void HandleControl(RoomConnection target, CollabWorkingSetTag tag)
  {
    handshakeTimer = Clear(handshakeTimer);
    if (tag.Format != SupportedFormat)
    {
      Terminate("unsupported-format");

      return;
    }
    if (lineage is not null && lineage != tag.Lineage)
    {
      TeardownGeneration(true);
      Relineage(null);

      return;
    }
    lineage = tag.Lineage;
    Tag = tag;
    Protocol = target.Protocol == SubprotocolV2 ? "v2" : "v1";
    if (phase == "ready")
    {
      return;
    }
    phase = "ready";
    HookSeam();
    SendActivityOnHandshake();
    var replay = buffered.ToList();

    buffered.Clear();
    foreach (var frame in replay)
    {
      if (phase != "ready")
      {
        break;
      }
      HandleFrame(target, frame);
    }
    if (phase != "ready")
    {
      return;
    }
    if (seam.Awareness.StateCount > 0)
    {
      ScheduleAwareness(true);
    }
    if (!synced)
    {
      firstSyncTimer = loop.Schedule(HandshakeTimeout, () =>
      {
        firstSyncTimer = null;
        TeardownGeneration(true);
        ScheduleReconnect(null);
      });
    }
  }

  private void BufferInbound(SyncWireMessage frame)
  {
    if (buffered.Count >= MaxBufferedInbound)
    {
      TeardownGeneration(true);
      ScheduleReconnect(null);

      return;
    }
    buffered.Add(frame);
  }

  private void HandleClose(int code)
  {
    TeardownGeneration(false);
    if (code == CloseMessageTooBig)
    {
      oversizedSinceSync += 1;
      if (largestSentBytes > 0)
      {
        refusedFrameBytes = Math.Min(refusedFrameBytes ?? int.MaxValue, largestSentBytes);
      }
    }
    if (code == CloseUnauthorized)
    {
      unauthorizedSinceSync += 1;
    }
    switch (code)
    {
      case 4400:
        Terminate("bad-request");

        return;
      case 4403:
        Terminate("forbidden");

        return;
      case CloseLineageReset:
        Relineage(code);

        return;
      case CloseUnauthorized when unauthorizedSinceSync > 1:
        Terminate("unauthorized");

        return;
      case CloseMessageTooBig when oversizedSinceSync > 1:
        Terminate("oversized-update");

        return;
      case CloseUnauthorized:
        forceTicketRefresh = true;
        break;
      default:
        break;
    }
    ScheduleReconnect(code);
  }

  private void HandleHandshakeTimeout()
  {
    handshakeTimeoutsSinceSync += 1;
    if (handshakeTimeoutsSinceSync >= MaxHandshakeTimeoutsSinceSync)
    {
      Terminate("handshake-timeout");

      return;
    }
    TeardownGeneration(true);
    ScheduleReconnect(null);
  }

  private void OpenSocket(int opened, string? token)
  {
    var offers = new List<string> { SubprotocolV2, SubprotocolV1 };

    if (token is not null)
    {
      offers.Add(token);
    }
    var cancel = new CancellationTokenSource();
    var generationOrigin = new object();

    connecting = cancel;
    origin = generationOrigin;
    phase = "awaiting-control";
    buffered.Clear();
    largestSentBytes = 0;
    announcedMaxBytes = null;
    handshakeTimer = loop.Schedule(HandshakeTimeout, () =>
    {
      handshakeTimer = null;
      HandleHandshakeTimeout();
    });
    _ = ConnectAsync(opened, offers, cancel);
  }

  private async Task ConnectAsync(int opened, List<string> offers, CancellationTokenSource cancel)
  {
    RoomConnection? connection = null;

    try
    {
      connection = await connect(offers, cancel.Token);
    }
    catch (Exception error) when (error is not OutOfMemoryException)
    {
      connection = null;
    }
    if (IsStale(opened) || cancel.IsCancellationRequested)
    {
      connection?.Close(CloseNormal);

      return;
    }
    connecting = null;
    cancel.Dispose();
    // ws refuses an upgrade that selected no offered version, and the provider sees a 1006.
    if (connection is null || connection.Protocol is not (SubprotocolV2 or SubprotocolV1))
    {
      connection?.Close(CloseNormal);
      HandleClose(1006);

      return;
    }
    socket = connection;
    connection.Start(
        bytes => loop.Post(() => OnMessage(opened, connection, bytes)),
        code => loop.Post(() =>
        {
          if (!IsStale(opened) && socket == connection)
          {
            HandleClose(code);
          }
        }));
    Send(connection, new SyncStep1Frame(seam.StateVector()));
  }

  private bool IsStale(int opened)
  {
    return destroyed || opened != generation;
  }

  private void OnMessage(int opened, RoomConnection target, byte[] bytes)
  {
    if (IsStale(opened) || socket != target)
    {
      return;
    }
    try
    {
      if (!SyncWire.TryDecode(bytes, out var frame, out _) ||
          frame is UnknownFrame or OperationFrame or ActivityFrame)
      {
        return;
      }
      if (frame is BlokControlFrame control)
      {
        HandleControl(target, control.Tag);

        return;
      }
      var beforeControl = phase == "awaiting-control";

      if (beforeControl && frame is AcknowledgementFrame or RejectionFrame or IdentitiesFrame)
      {
        return;
      }
      if (beforeControl)
      {
        BufferInbound(frame);

        return;
      }
      HandleFrame(target, frame);
    }
    catch (Exception error) when (error is not OutOfMemoryException)
    {
      Console.Error.WriteLine($"blok-mcp: could not apply a room frame: {error.Message}");
      Terminate("apply-failed");
    }
  }

  private void OpenGeneration()
  {
    if (destroyed)
    {
      return;
    }
    generation += 1;
    phase = "connecting";
    var opened = generation;
    var force = forceTicketRefresh;

    forceTicketRefresh = false;
    Report(RoomStatus.Connecting);
    if (tickets is null)
    {
      OpenSocket(opened, null);

      return;
    }
    _ = MintThenOpenAsync(opened, force);
  }

  private async Task MintThenOpenAsync(int opened, bool force)
  {
    string? token;

    try
    {
      token = await tickets!(force);
    }
    catch (Exception error) when (error is not OutOfMemoryException)
    {
      if (IsStale(opened))
      {
        return;
      }
      phase = "offline";
      ScheduleReconnect(null);

      return;
    }
    if (IsStale(opened))
    {
      return;
    }
    OpenSocket(opened, token);
  }
}
