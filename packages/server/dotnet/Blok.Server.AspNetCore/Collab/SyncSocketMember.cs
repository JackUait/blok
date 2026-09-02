using System.Buffers;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Blok.Server.Collab;

namespace Blok.Server.AspNetCore.Collab;

/// <summary>
/// One WebSocket as the room sees it. The room calls <see cref="Send"/> and
/// <see cref="Close"/> inside its lane, so both only enqueue onto an
/// outbound channel that a single pump task drains onto the socket; the
/// receive loop never sends, so the socket's one-sender rule holds.
///
/// Inbound frames are metered by <see cref="SyncInboundBudget"/> before they
/// reach the room; over budget is closed 1008 rather than served.
///
/// Backpressure: a frame is accepted while the backlog queued BEFORE it is
/// within budget, so one large SyncStep2 always fits and memory is bounded by
/// budget + one frame. A consumer that falls further behind is closed 1008
/// rather than buffered without limit — it resyncs on reconnect.
/// </summary>
internal sealed class SyncSocketMember : ICollabMember
{
  private const int ReceiveBufferSize = 16 * 1024;

  /// <summary>
  /// Every receive costs a loop turn however few bytes it carries, so a
  /// message sent as empty or one-byte fragments would spend the server's
  /// CPU for almost nothing — and the budget only sees a message once it
  /// ends. A message may therefore take this many receives plus one per
  /// <see cref="MinBytesPerReceive"/> of its bytes: far more than any real
  /// transport needs (a stream read hands back at least a TCP segment),
  /// and the flood is closed at the seventeenth fragment.
  /// </summary>
  private const int ReceiveSlack = 16;

  private const int MinBytesPerReceive = 64;

  /// <summary>How long a peer gets to answer our close before the socket is torn down.</summary>
  private static readonly TimeSpan DefaultCloseGrace = TimeSpan.FromSeconds(5);

  private readonly Channel<Outbound> outbound = Channel.CreateUnbounded<Outbound>(
      new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
  private readonly long maxQueuedBytes;
  private readonly TimeSpan closeGrace;
  private readonly SyncInboundBudget? inbound;
  private long queuedBytes;
  private StrongBox<SyncCloseFrame>? requestedClose;

  internal SyncSocketMember(
      bool canWrite,
      bool acceptsControlFrames,
      long maxQueuedBytes,
      SyncInboundBudget? inbound = null,
      TimeSpan? closeGrace = null)
  {
    CanWrite = canWrite;
    AcceptsControlFrames = acceptsControlFrames;
    this.maxQueuedBytes = maxQueuedBytes;
    this.inbound = inbound;
    this.closeGrace = closeGrace ?? DefaultCloseGrace;
  }

  public bool CanWrite { get; }

  public bool AcceptsControlFrames { get; }

  /// <summary>The close that won, once one was requested.</summary>
  internal SyncCloseFrame? RequestedClose => Volatile.Read(ref requestedClose)?.Value;

  public void Send(byte[] frame)
  {
    if (RequestedClose is not null)
    {
      return;
    }

    var backlog = Interlocked.Add(ref queuedBytes, frame.Length) - frame.Length;

    if (backlog > maxQueuedBytes)
    {
      RequestClose(SyncClose.SlowConsumer);

      return;
    }

    // False only after a close completed the writer; that frame is moot.
    outbound.Writer.TryWrite(new Outbound(frame, null));
  }

  public void Close(CollabCloseReason reason)
  {
    RequestClose(SyncClose.For(reason));
  }

  /// <summary>Queues the close behind whatever is already queued; later frames are dropped.</summary>
  internal void RequestClose(SyncCloseFrame close)
  {
    var box = new StrongBox<SyncCloseFrame>(close);

    if (Interlocked.CompareExchange(ref requestedClose, box, null) is not null)
    {
      return;
    }

    outbound.Writer.TryWrite(new Outbound(null, close));
    outbound.Writer.TryComplete();
  }

  /// <summary>
  /// Pumps outbound frames and reads inbound ones until the peer closes, the
  /// request aborts, or a requested close goes unanswered for the grace
  /// period. Leaves the room and frees the connection slot BEFORE answering
  /// the peer's close, so a reconnecting client never races its own slot.
  /// </summary>
  internal async Task RunAsync(
      WebSocket socket,
      CollabMembership? membership,
      int maxMessageBytes,
      IDisposable? lease,
      CancellationToken requestAborted)
  {
    using var receiving = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
    var pump = PumpAsync(socket, receiving, requestAborted);

    try
    {
      await ReceiveLoopAsync(socket, membership, maxMessageBytes, receiving.Token);
    }
    finally
    {
      if (membership is not null)
      {
        await membership.LeaveAsync();
      }

      lease?.Dispose();
      RequestClose(SyncClose.Normal);

      try
      {
        await pump.WaitAsync(closeGrace, CancellationToken.None);
      }
      catch (TimeoutException)
      {
        socket.Abort();
      }
    }
  }

  private static bool IsSocketGone(Exception error)
  {
    return error is WebSocketException
        or IOException
        or ObjectDisposedException
        or OperationCanceledException;
  }

  private async Task PumpAsync(
      WebSocket socket,
      CancellationTokenSource receiving,
      CancellationToken cancellationToken)
  {
    try
    {
      await foreach (var item in outbound.Reader.ReadAllAsync(cancellationToken))
      {
        if (item.Frame is not null)
        {
          await socket.SendAsync(
              item.Frame,
              WebSocketMessageType.Binary,
              endOfMessage: true,
              cancellationToken);
          Interlocked.Add(ref queuedBytes, -item.Frame.Length);

          continue;
        }

        var close = item.Close!.Value;
        await socket.CloseOutputAsync(close.Status, close.Reason, cancellationToken);
        // The peer now owes us its close; do not wait for it forever.
        TryCancel(receiving, closeGrace);

        return;
      }
    }
    catch (Exception error) when (IsSocketGone(error))
    {
      TryCancel(receiving, TimeSpan.Zero);
    }
  }

  /// <summary>RunAsync may already have torn the source down after a pump that overran the grace.</summary>
  private static void TryCancel(CancellationTokenSource source, TimeSpan after)
  {
    try
    {
      source.CancelAfter(after);
    }
    catch (ObjectDisposedException)
    {
    }
  }

  private async Task ReceiveLoopAsync(
      WebSocket socket,
      CollabMembership? membership,
      int maxMessageBytes,
      CancellationToken cancellationToken)
  {
    var buffer = ArrayPool<byte>.Shared.Rent(ReceiveBufferSize);
    using var message = new MemoryStream();
    // With no membership (a rejected handshake), or once a close was
    // requested, frames are read only to reach the peer's close.
    var discarding = false;
    var receives = 0;

    try
    {
      while (true)
      {
        var result = await socket.ReceiveAsync(buffer.AsMemory(), cancellationToken);

        if (result.MessageType == WebSocketMessageType.Close)
        {
          return;
        }

        if (membership is null || discarding || RequestedClose is not null)
        {
          discarding = true;

          continue;
        }

        if (result.MessageType == WebSocketMessageType.Text)
        {
          RequestClose(SyncClose.TextFrame);
          discarding = true;

          continue;
        }

        var received = message.Length + result.Count;

        if (++receives > ReceiveSlack + (received / MinBytesPerReceive))
        {
          RequestClose(SyncClose.InboundRateExceeded);
          discarding = true;

          continue;
        }

        if (received > maxMessageBytes)
        {
          RequestClose(SyncClose.TooBig);
          discarding = true;

          continue;
        }

        message.Write(buffer, 0, result.Count);

        if (!result.EndOfMessage)
        {
          continue;
        }

        var frame = message.ToArray();
        message.SetLength(0);
        receives = 0;

        if (inbound?.Allows(frame) == false)
        {
          RequestClose(SyncClose.InboundRateExceeded);
          discarding = true;

          continue;
        }

        await membership.ReceiveAsync(frame, cancellationToken);
      }
    }
    catch (Exception error) when (IsSocketGone(error))
    {
      // The peer vanished or the grace period ran out; the caller cleans up.
    }
    finally
    {
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private readonly record struct Outbound(byte[]? Frame, SyncCloseFrame? Close);
}
