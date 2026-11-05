using System.Net.Sockets;
using System.Security.Claims;
using System.Text;
using Blok.Server.Collab;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// A peer whose TCP connection drops while its frame waits behind a busy
/// room lane. Real Kestrel and a raw socket, so the drop is a real FIN or RST.
/// </summary>
public sealed class SyncDroppedPeerTests
{
  [Theory]
  [InlineData("fin")]
  [InlineData("rst")]
  public async Task AFrameWaitingOnABusyRoomIsDroppedWhenThePeerConnectionDrops(string drop)
  {
    Assert.Equal("seeded", await TextAfterAQueuedFrameAsync(drop));
  }

  /// <summary>The same steps without the drop apply the frame, so the test above can fail.</summary>
  [Fact]
  public async Task AFrameWaitingOnABusyRoomIsAppliedWhenThePeerStays()
  {
    Assert.NotEqual("seeded", await TextAfterAQueuedFrameAsync(null));
  }

  /// <summary>
  /// The raw peer never reads, so it never answers a ping: the keep-alive
  /// aborts the socket while its frame waits on the lane.
  /// </summary>
  [Fact]
  public async Task AFrameWaitingOnABusyRoomAfterAKeepAliveTimeout()
  {
    Assert.Equal("seeded", await TextAfterAQueuedFrameAsync("keepalive"));
  }

  private static async Task<string> TextAfterAQueuedFrameAsync(string? drop)
  {
    var authorization = new GatedAuthorization();
    await using var app = await SyncApp.StartAsync(
        configure: options =>
        {
          if (drop == "keepalive")
          {
            options.CollabKeepAliveInterval = TimeSpan.FromMilliseconds(100);
          }
        },
        services: services => services.AddSingleton<IBlokAuthorization>(authorization),
        kestrel: true);
    using var peer = await RawPeer.ConnectAsync(new Uri(app.App.Urls.Single()));

    // The recheck runs inside the room lane, so a held hook holds the lane.
    authorization.Hold();
    var recheck = ((ICollabRoomManager)app.Fakes.Manager).RecheckAccessAsync(SyncApp.Doc).AsTask();
    await authorization.Entered.WaitAsync(Deadline.Token());

    var update = YDocs.UpdateAppending(YDocs.NewClient(), "late");
    await peer.SendBinaryAsync(SyncWire.Encode(new SyncUpdateFrame(update)));
    // Long enough for the frame to reach the lane wait.
    await Task.Delay(300);

    if (drop == "keepalive")
    {
      // Long enough for the unanswered ping to time out.
      await Task.Delay(1000);
    }
    else if (drop is not null)
    {
      peer.Drop(drop == "rst");
      // Long enough for Kestrel to see the drop.
      await Task.Delay(1000);
    }

    authorization.Release();
    await recheck.WaitAsync(Deadline.Token());

    await using var reader = await app.ConnectAsync();
    var doc = YDocs.NewClient();
    await reader.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    YDocs.Apply(doc, (await reader.ReceiveAsync<SyncStep2Frame>()).Update);

    return YDocs.Text(doc);
  }

  private sealed class GatedAuthorization : IBlokAuthorization
  {
    private readonly TaskCompletionSource entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private TaskCompletionSource? gate;

    internal Task Entered => entered.Task;

    internal void Hold()
    {
      gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    internal void Release()
    {
      gate?.TrySetResult();
    }

    public async ValueTask<bool> CanReadDocumentAsync(
        ClaimsPrincipal user,
        string documentId,
        CancellationToken cancellationToken = default)
    {
      if (gate is { } held)
      {
        entered.TrySetResult();
        await held.Task;
      }

      return true;
    }

    public ValueTask<bool> CanWriteDocumentAsync(
        ClaimsPrincipal user,
        string documentId,
        CancellationToken cancellationToken = default)
    {
      return ValueTask.FromResult(true);
    }
  }

  /// <summary>A hand-rolled WebSocket client over a plain TCP socket.</summary>
  private sealed class RawPeer : IDisposable
  {
    private readonly Socket socket;

    private RawPeer(Socket socket)
    {
      this.socket = socket;
    }

    internal static async Task<RawPeer> ConnectAsync(Uri server)
    {
      var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
      await socket.ConnectAsync(server.Host, server.Port);
      var request =
          $"GET /sync/{SyncApp.Doc} HTTP/1.1\r\n" +
          $"Host: {server.Authority}\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          $"Origin: {SyncApp.AllowedOrigin}\r\n\r\n";
      await socket.SendAsync(Encoding.ASCII.GetBytes(request));
      var head = new StringBuilder();
      var one = new byte[1];

      while (!head.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal))
      {
        Assert.Equal(1, await socket.ReceiveAsync(one));
        head.Append((char)one[0]);
      }

      Assert.StartsWith("HTTP/1.1 101", head.ToString(), StringComparison.Ordinal);

      return new RawPeer(socket);
    }

    internal async Task SendBinaryAsync(byte[] payload)
    {
      var frame = new List<byte> { 0x82 };

      if (payload.Length <= 125)
      {
        frame.Add((byte)(0x80 | payload.Length));
      }
      else
      {
        frame.Add(0x80 | 126);
        frame.Add((byte)(payload.Length >> 8));
        frame.Add((byte)payload.Length);
      }

      byte[] mask = [1, 2, 3, 4];
      frame.AddRange(mask);
      frame.AddRange(payload.Select((value, index) => (byte)(value ^ mask[index % 4])));
      await socket.SendAsync(frame.ToArray());
    }

    /// <summary>A FIN (half close, as a vanished browser tab sends) or an RST.</summary>
    internal void Drop(bool reset)
    {
      if (reset)
      {
        socket.LingerState = new LingerOption(true, 0);
        socket.Close();

        return;
      }

      socket.Shutdown(SocketShutdown.Send);
    }

    public void Dispose()
    {
      socket.Dispose();
    }
  }
}
