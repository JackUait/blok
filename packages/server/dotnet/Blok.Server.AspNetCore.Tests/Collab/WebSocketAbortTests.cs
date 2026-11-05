using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// Pins what Kestrel's WebSocket hands out after an abort: Go and Rust read
/// ahead too, and must not serve buffered frames once the socket is dead.
/// </summary>
public sealed class WebSocketAbortTests
{
  private const int Frames = 200;

  [Fact]
  public async Task NoBufferedFrameIsReceivedAfterAnAbort()
  {
    var outcome = await ReceiveAfterAbortAsync(keepAlive: false);

    Assert.Equal(0, outcome.Frames);
    Assert.NotNull(outcome.Error);
  }

  [Fact]
  public async Task NoBufferedFrameIsReceivedAfterAKeepAliveTimeout()
  {
    var outcome = await ReceiveAfterAbortAsync(keepAlive: true);

    Assert.Equal(0, outcome.Frames);
    Assert.NotNull(outcome.Error);
  }

  /// <summary>Without the abort every frame arrives, so the tests above can fail.</summary>
  [Fact]
  public async Task EveryFrameIsReceivedWithoutAnAbort()
  {
    var outcome = await ReceiveAfterAbortAsync(keepAlive: null);

    Assert.Equal(Frames, outcome.Frames);
  }

  private sealed record Outcome(int Frames, string? Error);

  private static async Task<Outcome> ReceiveAfterAbortAsync(bool? keepAlive)
  {
    var outcome = new TaskCompletionSource<Outcome>(TaskCreationOptions.RunContinuationsAsynchronously);
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    await using var app = builder.Build();
    app.UseWebSockets();
    app.Map("/probe", async context =>
    {
      var accept = new WebSocketAcceptContext();

      if (keepAlive == true)
      {
        accept.KeepAliveInterval = TimeSpan.FromMilliseconds(100);
        accept.KeepAliveTimeout = TimeSpan.FromMilliseconds(200);
      }

      using var socket = await context.WebSockets.AcceptWebSocketAsync(accept);
      // Long enough for every frame to sit in the transport's buffer.
      await Task.Delay(300);

      if (keepAlive == true)
      {
        var until = DateTime.UtcNow.AddSeconds(5);

        while (socket.State != WebSocketState.Aborted && DateTime.UtcNow < until)
        {
          await Task.Delay(20);
        }

        Assert.Equal(WebSocketState.Aborted, socket.State);
      }
      else if (keepAlive == false)
      {
        socket.Abort();
      }

      var frames = 0;
      string? error = null;
      var buffer = new byte[256];

      try
      {
        for (var i = 0; i < Frames; i++)
        {
          await socket.ReceiveAsync(buffer, CancellationToken.None);
          frames++;
        }
      }
      catch (Exception exception)
      {
        error = exception.GetType().Name + ": " + exception.Message;
      }

      outcome.TrySetResult(new Outcome(frames, error));
    });
    await app.StartAsync();

    var server = new Uri(app.Urls.Single());
    using var peer = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    await peer.ConnectAsync(server.Host, server.Port);
    var request =
        "GET /probe HTTP/1.1\r\n" +
        $"Host: {server.Authority}\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n";
    await peer.SendAsync(Encoding.ASCII.GetBytes(request));
    var head = new StringBuilder();
    var one = new byte[1];

    while (!head.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal))
    {
      Assert.Equal(1, await peer.ReceiveAsync(one));
      head.Append((char)one[0]);
    }

    Assert.StartsWith("HTTP/1.1 101", head.ToString(), StringComparison.Ordinal);

    // The peer never reads again, so it never answers a ping.
    var frame = new List<byte> { 0x82, 0x80 | 100, 1, 2, 3, 4 };
    frame.AddRange(Enumerable.Repeat((byte)0, 100).Select((value, index) => (byte)(value ^ (index % 4 + 1))));
    var all = Enumerable.Repeat(frame, Frames).SelectMany(bytes => bytes).ToArray();
    await peer.SendAsync(all);

    return await outcome.Task.WaitAsync(TimeSpan.FromSeconds(10));
  }
}
