using System.Net.WebSockets;
using System.Threading.Channels;

namespace Blok.Server.Mcp.Live;

/// <summary>
/// One open room socket: a send lane that keeps frame order, and a receive
/// lane that reassembles messages. Callbacks run on the receive task; the
/// provider posts them to its loop.
/// </summary>
internal sealed class RoomConnection
{
  // ws 8.22.0's maxPayload default (websocket.js:688). ClientWebSocket has no total cap.
  internal const int DefaultMaxPayload = 100 * 1024 * 1024;
  private const int MessageTooBig = 1009;
  private const int NoStatus = 1005;
  private const int Abnormal = 1006;
  private static readonly TimeSpan CloseWait = TimeSpan.FromSeconds(10);

  private readonly WebSocket socket;
  private readonly int maxPayload;
  private readonly Channel<Outgoing> outgoing = Channel.CreateUnbounded<Outgoing>(new UnboundedChannelOptions { SingleReader = true });
  private readonly TaskCompletionSource closed = new(TaskCreationOptions.RunContinuationsAsynchronously);
  private Action<byte[]>? onMessage;
  private Action<int>? onClose;
  private int closeSent;

  internal RoomConnection(WebSocket socket, int maxPayload = DefaultMaxPayload)
  {
    this.socket = socket;
    this.maxPayload = maxPayload;
  }

  internal string? Protocol => socket.SubProtocol;

  /// <summary>Starts both lanes. <paramref name="close"/> gets the close code once, unless detached.</summary>
  internal void Start(Action<byte[]> message, Action<int> close)
  {
    onMessage = message;
    onClose = close;
    _ = Task.Run(SendLaneAsync);
    _ = Task.Run(ReceiveLaneAsync);
  }

  internal void Send(byte[] frame)
  {
    outgoing.Writer.TryWrite(new Outgoing(frame, null));
  }

  /// <summary>Stops the callbacks, sends a close after the queued frames, and lets the host answer it.</summary>
  internal void Close(int code)
  {
    Detach();
    QueueClose(code);
  }

  /// <summary>Drops the socket now. For a connection whose lanes never started.</summary>
  internal void Abort()
  {
    Detach();
    socket.Abort();
    socket.Dispose();
  }

  internal void Detach()
  {
    onMessage = null;
    onClose = null;
  }

  private void QueueClose(int? code)
  {
    if (Interlocked.Exchange(ref closeSent, 1) == 0)
    {
      outgoing.Writer.TryWrite(new Outgoing(null, code));
      outgoing.Writer.TryComplete();
    }
  }

  private async Task SendLaneAsync()
  {
    try
    {
      await foreach (var item in outgoing.Reader.ReadAllAsync())
      {
        if (item.Frame is { } frame)
        {
          await socket.SendAsync(frame, WebSocketMessageType.Binary, true, CancellationToken.None);
          continue;
        }
        if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
          await socket.CloseOutputAsync(item.Code is { } code ? (WebSocketCloseStatus)code : WebSocketCloseStatus.Empty, null, CancellationToken.None);
        }
        // The host answers our close; give it time before the TCP goes.
        await Task.WhenAny(closed.Task, Task.Delay(CloseWait));
        socket.Abort();
        socket.Dispose();

        return;
      }
    }
    catch (Exception error) when (error is WebSocketException or ObjectDisposedException or IOException or OperationCanceledException)
    {
      socket.Abort();
    }
  }

  private async Task ReceiveLaneAsync()
  {
    var chunk = new byte[64 * 1024];
    using var message = new MemoryStream();
    var tooBig = false;
    var code = Abnormal;

    try
    {
      while (true)
      {
        var read = await socket.ReceiveAsync(chunk, CancellationToken.None);

        if (read.MessageType == WebSocketMessageType.Close)
        {
          code = (int?)read.CloseStatus ?? NoStatus;
          // As ws does: answer a close with the same code.
          QueueClose(read.CloseStatus is null ? null : code);
          break;
        }
        if (tooBig)
        {
          continue;
        }
        if (message.Length + read.Count > maxPayload)
        {
          // ws refuses the message and closes with 1009 (receiver.js:441).
          tooBig = true;
          message.SetLength(0);
          Detach(onMessageOnly: true);
          QueueClose(MessageTooBig);
          continue;
        }
        message.Write(chunk, 0, read.Count);
        if (!read.EndOfMessage)
        {
          continue;
        }
        var bytes = message.ToArray();

        message.SetLength(0);
        if (read.MessageType == WebSocketMessageType.Binary)
        {
          onMessage?.Invoke(bytes);
        }
      }
    }
    catch (Exception error) when (error is WebSocketException or ObjectDisposedException or IOException or OperationCanceledException)
    {
      code = Abnormal;
    }
    closed.TrySetResult();
    QueueClose(null);
    var close = onClose;

    Detach();
    close?.Invoke(code);
  }

  private void Detach(bool onMessageOnly)
  {
    onMessage = null;
    if (!onMessageOnly)
    {
      onClose = null;
    }
  }

  private sealed record Outgoing(byte[]? Frame, int? Code);
}
