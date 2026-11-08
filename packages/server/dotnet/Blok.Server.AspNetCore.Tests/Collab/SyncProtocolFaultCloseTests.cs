using System.IO.Pipelines;
using System.Net.Sockets;
using System.Text;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// A frame RFC 6455 refuses is closed 1002 by the runtime's WebSocket. Its
/// close frame only reaches Kestrel's output pipe, and the transport writes
/// it to the wire later. Real Kestrel, with every write held back, so that
/// gap is always wide.
/// </summary>
public sealed class SyncProtocolFaultCloseTests
{
  private static readonly TimeSpan WireDelay = TimeSpan.FromMilliseconds(200);

  [Fact]
  public async Task APingOver125BytesIsClosed1002BehindASlowWire()
  {
    await using var app = await SyncApp.StartAsync(
        services: services => services.Configure<KestrelServerOptions>(kestrel =>
            kestrel.ConfigureEndpointDefaults(listen => listen.Use(DelayWrites))),
        kestrel: true);
    var server = new Uri(app.App.Urls.Single());
    using var peer = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    await peer.ConnectAsync(server.Host, server.Port);
    await UpgradeAsync(peer, server);

    // FIN + ping, masked, a 16-bit length of 126.
    var ping = new List<byte> { 0x89, 0x80 | 126, 0, 126, 1, 2, 3, 4 };
    ping.AddRange(new byte[126]);
    await peer.SendAsync(ping.ToArray());

    Assert.Equal(1002, await CloseStatusAsync(peer));
  }

  /// <summary>A close the member sends itself crosses the same slow wire, so the test above can pass.</summary>
  [Fact]
  public async Task ATextFrameIsClosed1003BehindTheSameSlowWire()
  {
    await using var app = await SyncApp.StartAsync(
        services: services => services.Configure<KestrelServerOptions>(kestrel =>
            kestrel.ConfigureEndpointDefaults(listen => listen.Use(DelayWrites))),
        kestrel: true);
    var server = new Uri(app.App.Urls.Single());
    using var peer = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
    await peer.ConnectAsync(server.Host, server.Port);
    await UpgradeAsync(peer, server);

    // FIN + text "x", masked with a zero mask.
    await peer.SendAsync(new byte[] { 0x81, 0x80 | 1, 0, 0, 0, 0, (byte)'x' });

    Assert.Equal(1003, await CloseStatusAsync(peer));
  }

  /// <summary>Holds each write back before it goes to the wire, as a slow link does.</summary>
  private static ConnectionDelegate DelayWrites(ConnectionDelegate next)
  {
    return async connection =>
    {
      var wire = connection.Transport;
      var held = new Pipe();
      var forward = ForwardAsync(held.Reader, wire.Output);
      connection.Transport = new DuplexPipe(wire.Input, held.Writer);

      try
      {
        await next(connection);
      }
      finally
      {
        await held.Writer.CompleteAsync();
        await forward;
      }
    };
  }

  private static async Task ForwardAsync(PipeReader held, PipeWriter wire)
  {
    try
    {
      while (true)
      {
        var result = await held.ReadAsync();

        if (!result.Buffer.IsEmpty)
        {
          await Task.Delay(WireDelay);

          foreach (var segment in result.Buffer)
          {
            await wire.WriteAsync(segment);
          }
        }

        held.AdvanceTo(result.Buffer.End);

        if (result.IsCompleted)
        {
          break;
        }
      }
    }
    catch (Exception error) when (error is IOException or ConnectionAbortedException or InvalidOperationException)
    {
      // The connection was torn down while a write was held back.
    }
    finally
    {
      await held.CompleteAsync();
    }
  }

  private static async Task UpgradeAsync(Socket peer, Uri server)
  {
    var request =
        $"GET /sync/{SyncApp.Doc} HTTP/1.1\r\n" +
        $"Host: {server.Authority}\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        $"Origin: {SyncApp.AllowedOrigin}\r\n\r\n";
    await peer.SendAsync(Encoding.ASCII.GetBytes(request));
    var head = new StringBuilder();
    var one = new byte[1];

    while (!head.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal))
    {
      Assert.Equal(1, await peer.ReceiveAsync(one, Deadline.Token()));
      head.Append((char)one[0]);
    }

    Assert.StartsWith("HTTP/1.1 101", head.ToString(), StringComparison.Ordinal);
  }

  /// <summary>The status of the server's close frame, or null when the stream ends without one.</summary>
  private static async Task<int?> CloseStatusAsync(Socket peer)
  {
    var received = new List<byte>();
    var buffer = new byte[4096];

    while (true)
    {
      if (CloseStatusIn(received) is { } status)
      {
        return status;
      }

      int count;

      try
      {
        count = await peer.ReceiveAsync(buffer, Deadline.Token());
      }
      catch (SocketException)
      {
        return null;
      }

      if (count == 0)
      {
        return null;
      }

      received.AddRange(buffer.AsSpan(0, count).ToArray());
    }
  }

  /// <summary>Walks unmasked server frames; every frame here is under 126 bytes.</summary>
  private static int? CloseStatusIn(List<byte> bytes)
  {
    var at = 0;

    while (at + 2 <= bytes.Count)
    {
      var opcode = bytes[at] & 0x0F;
      var length = bytes[at + 1] & 0x7F;

      if (at + 2 + length > bytes.Count)
      {
        return null;
      }

      if (opcode == 0x8 && length >= 2)
      {
        return (bytes[at + 2] << 8) | bytes[at + 3];
      }

      at += 2 + length;
    }

    return null;
  }

  private sealed class DuplexPipe(PipeReader input, PipeWriter output) : IDuplexPipe
  {
    public PipeReader Input { get; } = input;

    public PipeWriter Output { get; } = output;
  }
}
