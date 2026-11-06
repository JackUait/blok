using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using Blok.Server.Mcp.Live;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class RoomConnectionTests
{
  [Fact]
  public void TheDefaultCapIsWsMaxPayload()
  {
    Assert.Equal(100 * 1024 * 1024, RoomConnection.DefaultMaxPayload);
  }

  [Fact]
  public async Task AMessageOverTheCapAcrossChunksClosesWith1009()
  {
    var (client, server) = await PairAsync();
    var messages = new List<byte[]>();
    var closed = new TaskCompletionSource<int>();
    var connection = new RoomConnection(client, maxPayload: 1024);

    connection.Start(messages.Add, code => closed.TrySetResult(code));
    await server.SendAsync(new byte[600], WebSocketMessageType.Binary, false, CancellationToken.None);
    await server.SendAsync(new byte[600], WebSocketMessageType.Binary, true, CancellationToken.None);
    var answer = await server.ReceiveAsync(new byte[16], CancellationToken.None);

    Assert.Equal(WebSocketMessageType.Close, answer.MessageType);
    Assert.Equal(1009, (int?)answer.CloseStatus);
    await server.CloseOutputAsync((WebSocketCloseStatus)1009, null, CancellationToken.None);
    Assert.Equal(1009, await closed.Task.WaitAsync(TimeSpan.FromSeconds(10)));
    Assert.Empty(messages);
  }

  [Fact]
  public async Task AMessageAtTheCapIsDelivered()
  {
    var (client, server) = await PairAsync();
    var delivered = new TaskCompletionSource<byte[]>();
    var connection = new RoomConnection(client, maxPayload: 1024);

    connection.Start(bytes => delivered.TrySetResult(bytes), _ => { });
    await server.SendAsync(new byte[512], WebSocketMessageType.Binary, false, CancellationToken.None);
    await server.SendAsync(new byte[512], WebSocketMessageType.Binary, true, CancellationToken.None);

    Assert.Equal(1024, (await delivered.Task.WaitAsync(TimeSpan.FromSeconds(10))).Length);
  }

  [Fact]
  public async Task AHostCloseIsAnsweredWithTheSameCode()
  {
    var (client, server) = await PairAsync();
    var closed = new TaskCompletionSource<int>();
    var connection = new RoomConnection(client);

    connection.Start(_ => { }, code => closed.TrySetResult(code));
    await server.CloseOutputAsync((WebSocketCloseStatus)4401, null, CancellationToken.None);
    var answer = await server.ReceiveAsync(new byte[16], CancellationToken.None);

    Assert.Equal(4401, (int?)answer.CloseStatus);
    Assert.Equal(4401, await closed.Task.WaitAsync(TimeSpan.FromSeconds(10)));
  }

  private static async Task<(WebSocket Client, WebSocket Server)> PairAsync()
  {
    using var listener = new TcpListener(IPAddress.Loopback, 0);

    listener.Start();
    var connecting = new TcpClient();
    var accept = listener.AcceptTcpClientAsync();

    await connecting.ConnectAsync(IPAddress.Loopback, ((IPEndPoint)listener.LocalEndpoint).Port);
    var accepted = await accept;
    var client = WebSocket.CreateFromStream(connecting.GetStream(), new WebSocketCreationOptions { IsServer = false });
    var server = WebSocket.CreateFromStream(accepted.GetStream(), new WebSocketCreationOptions { IsServer = true });

    return (client, server);
  }
}
