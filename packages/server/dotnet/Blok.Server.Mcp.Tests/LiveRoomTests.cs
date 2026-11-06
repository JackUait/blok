using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using Blok.Server.Collab;
using Blok.Server.Mcp.Live;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The headless room against a scripted host over loopback.</summary>
public sealed class LiveRoomTests
{
  private const string Lineage = "0123456789abcdef0123456789abcdef";

  [Fact]
  public async Task ALocalWriteIsOneTransactionOneRowAndOneOperation()
  {
    var (room, host) = await OpenAsync();
    LocalWrite? seen = null;
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      room.LocalWriteCommitted += write => seen = write;
      room.WriteLocal(origin, tx =>
      {
        room.Doc.GetMap("m").Set(tx, "a", "one");
        room.Doc.GetMap("m").Set(tx, "b", "two");
      });
    });
    var operation = await host.NextAsync<OperationFrame>();

    Assert.NotNull(seen);
    Assert.Same(origin, seen.Origin);
    Assert.Equal(0UL, seen.Transaction.BeforeState.Get(room.Doc.ClientId));
    Assert.Equal(2UL, seen.Transaction.AfterState!.Get(room.Doc.ClientId));
    Assert.Equal(Lineage, operation.Lineage);
    Assert.Equal(seen.Update, operation.Update);
    Assert.Equal(1, room.Outbox.AppendedCount);
    Assert.Equal("l1", room.Revision);
    await room.CloseAsync();
  }

  [Fact]
  public async Task AWriteObserverStillReadsTheContentItDeleted()
  {
    var (room, _) = await OpenAsync();
    var kept = new List<Type>();

    await room.Loop.RunAsync(() =>
    {
      room.WriteLocal(new object(), tx => room.Doc.GetMap("m").Set(tx, "a", "one"));
      room.LocalWriteCommitted += write =>
      {
        foreach (var (client, ranges) in write.Transaction.DeleteSet.Clients)
        {
          foreach (var range in ranges)
          {
            kept.Add(((YItem)room.Doc.Store.Find(new YId(client, range.Clock))).Content.GetType());
          }
        }
      };
      room.WriteLocal(new object(), tx => room.Doc.GetMap("m").Remove(tx, "a"));
    });

    // An undo manager restores deleted items, so their content must outlive the write.
    Assert.Equal([typeof(ContentAny)], kept);
    await room.CloseAsync();
  }

  [Fact]
  public async Task AWriteThatChangesNothingMakesNoRow()
  {
    var (room, _) = await OpenAsync();

    var update = await room.Loop.RunAsync(() => Task.FromResult(room.WriteLocal(new object(), _ => { })));

    Assert.Null(update);
    Assert.Equal(0, room.Outbox.AppendedCount);
    await room.CloseAsync();
  }

  [Fact]
  public async Task HeldDocFramesWaitUntilTheBatchReleasesThem()
  {
    var (room, host) = await OpenAsync();
    var peer = new YDoc();
    var update = peer.Transact(tx => peer.GetMap("m").Set(tx, "peer", "x"))!;

    await room.Loop.RunAsync(room.HoldDocFrames);
    await host.SendAsync(new SyncUpdateFrame(update));
    await host.SendAsync(new QueryAwarenessFrame());
    // Presence still flows while doc frames are held.
    await host.NextAsync<AwarenessFrame>();
    var held = await room.Loop.RunAsync(() => Task.FromResult(room.Doc.GetMap("m").Count));

    await room.Loop.RunAsync(room.ReleaseDocFrames);
    var released = await room.Loop.RunAsync(() => Task.FromResult(room.Doc.GetMap("m").Count));

    Assert.Equal(0, held);
    Assert.Equal(1, released);
    Assert.Equal("l1", room.Revision);
    await room.CloseAsync();
  }

  internal static async Task<(LiveRoom Room, Host Host)> OpenAsync()
  {
    var host = new Host();
    var room = await LiveRoom.OpenAsync(
        (_, _) => host.AcceptAsync(),
        null,
        TimeSpan.FromSeconds(10),
        CancellationToken.None);

    await room.Loop.RunAsync(room.ResetUpdateCount);

    return (room, host);
  }

  internal sealed class Host
  {
    private WebSocket? server;

    internal async Task<RoomConnection> AcceptAsync()
    {
      using var listener = new TcpListener(IPAddress.Loopback, 0);

      listener.Start();
      var connecting = new TcpClient();
      var accept = listener.AcceptTcpClientAsync();

      await connecting.ConnectAsync(IPAddress.Loopback, ((IPEndPoint)listener.LocalEndpoint).Port);
      var accepted = await accept;

      server = WebSocket.CreateFromStream(accepted.GetStream(), new WebSocketCreationOptions { IsServer = true });
      var client = WebSocket.CreateFromStream(connecting.GetStream(), new WebSocketCreationOptions { IsServer = false, SubProtocol = RoomProvider.SubprotocolV2 });

      _ = Task.Run(async () =>
      {
        await NextAsync<SyncStep1Frame>();
        await SendAsync(new BlokControlFrame(new CollabWorkingSetTag(2, 1, Lineage)));
        await SendAsync(new SyncStep2Frame(new YDoc().EncodeStateAsUpdate()));
      });

      return new RoomConnection(client);
    }

    internal async Task SendAsync(SyncWireMessage frame)
    {
      await server!.SendAsync(SyncWire.Encode(frame), WebSocketMessageType.Binary, true, CancellationToken.None);
    }

    internal async Task<T> NextAsync<T>()
        where T : SyncWireMessage
    {
      var buffer = new byte[1 << 16];

      while (true)
      {
        var read = await server!.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        if (SyncWire.TryDecode(buffer.AsSpan(0, read.Count), out var frame, out _) && frame is T wanted)
        {
          return wanted;
        }
      }
    }
  }
}
