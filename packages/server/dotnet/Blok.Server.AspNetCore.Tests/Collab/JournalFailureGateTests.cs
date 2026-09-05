using System.Net;
using System.Net.WebSockets;
using System.Text;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// The wave's whole guarantee as ONE property: with a store that fails the
/// journal, nothing becomes observable. Five tasks built it a piece at a time
/// and no per-task suite states it end to end, so this test walks every
/// observation route the design names — a relay to a peer, the v2
/// acknowledgement, the HTTP 204, the whole-JSON projection PUT, the
/// checkpoint, the working-set blob (retired for journal rooms) and a later
/// reader of the room's own document — with the journal failing at the append
/// and, separately, at the checkpoint.
///
/// Three documents rather than one: a commit failure discards the room and
/// puts the document in a cooldown, so the socket route, the HTTP route and
/// the checkpoint route cannot share one.
/// </summary>
public sealed class JournalFailureGateTests
{
  private const string SocketDoc = "journal-down-socket";
  private const string HttpDoc = "journal-down-http";
  private const string CheckpointDoc = "journal-down-checkpoint";
  private const string OpOne = "0123456789abcdef0123456789abcdef";
  private const string AppendOne =
      """{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "text": "!" } } } ] }""";

  /// <summary>
  /// The export debounce, the export max delay and the commit cooldown all
  /// borrow this. Short so a projection the room owed would land inside the
  /// test rather than after it — every "no PUT" assertion below is only worth
  /// what this window buys.
  /// </summary>
  private static readonly TimeSpan ExportWindow = TimeSpan.FromMilliseconds(100);

  [Fact]
  public async Task AJournalThatCannotCommitLetsNothingBecomeObservable()
  {
    var journalDown = new IOException("the journal volume is gone");
    var operations = new FakeCollabOperationStore
    {
      FailAppends = doc =>
          string.Equals(doc, SocketDoc, StringComparison.Ordinal) ||
          string.Equals(doc, HttpDoc, StringComparison.Ordinal)
            ? journalDown
            : null,
      FailCheckpoints = doc =>
          string.Equals(doc, CheckpointDoc, StringComparison.Ordinal) ? journalDown : null,
    };
    var fakes = new SyncFakes(
        new CollabRoomOptions
        {
          ExportDebounce = ExportWindow,
          ExportMaxDelay = ExportWindow,
          RetryBackoff = ExportWindow,

          // Long enough that no room in this test evicts: eviction flushes a
          // projection, which would answer the PUT assertions for the wrong
          // reason.
          EvictionLinger = TimeSpan.FromMinutes(5),
        },
        operations);
    fakes.Endpoint.Holds(SocketDoc, "seeded");
    fakes.Endpoint.Holds(HttpDoc, "seeded");
    fakes.Endpoint.Holds(CheckpointDoc, "seeded");
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<ICollabOperationStore>(operations),
        fakes: fakes);

    // ---- the append fails, on a v2 socket ----
    await using var writer = await app.ConnectAsync(SocketDoc, [SyncApp.ProtocolV2]);
    var writerDoc = YDocs.NewClient();
    var lineage = await HandshakeV2Async(writer, writerDoc);
    Assert.Equal("seeded", YDocs.Text(writerDoc));
    await using var peer = await app.ConnectAsync(SocketDoc, [SyncApp.Protocol]);
    await peer.ReceiveAsync<BlokControlFrame>();
    Assert.Equal("seeded", YDocs.Text(await SyncedAsync(peer)));

    // The peer's join queued this at the writer; left in place the receives
    // below would read it as a frame the failed operation produced.
    await writer.ReceiveAsync<QueryAwarenessFrame>();
    var peerNext = peer.ReceiveOrCloseAsync();
    var writerNext = writer.ReceiveOrCloseAsync();

    await writer.SendAsync(
        new OperationFrame(lineage, OpOne, YDocs.UpdateAppending(writerDoc, "!")));

    // Route 1, the relay to a peer, and route 2, the v2 acknowledgement: both
    // answer with the room's close instead of a frame.
    Assert.Null(await peerNext);
    Assert.Null(await writerNext);
    AssertCommitUnavailable(peer);
    AssertCommitUnavailable(writer);
    Assert.Empty(operations.Committed(SocketDoc));
    Assert.Null(operations.Checkpoint(SocketDoc));
    await SettleAsync(app);
    Assert.Equal(0, fakes.Endpoint.SavesFor(SocketDoc));
    Assert.Equal(0, fakes.Store.Writes(SocketDoc));
    Assert.False(fakes.Store.Holds(SocketDoc));

    // Route 7: a later reader reads committed data only, so the bytes applied
    // provisionally before the append are gone with the room.
    Assert.Equal("seeded", await LaterReaderTextAsync(app, SocketDoc));

    // ---- the append fails, on POST /sync/{doc}/edit ----
    await using var httpPeer = await app.ConnectAsync(HttpDoc, [SyncApp.Protocol]);
    await httpPeer.ReceiveAsync<BlokControlFrame>();
    Assert.Equal("seeded", YDocs.Text(await SyncedAsync(httpPeer)));
    var httpPeerNext = httpPeer.ReceiveOrCloseAsync();

    using var refused = await EditAsync(app, HttpDoc, "gate-http-edit");

    // Route 3: the 204 is the endpoint's durable-commit receipt, so a journal
    // that could not commit must not produce one.
    Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
    Assert.Null(await httpPeerNext);
    AssertCommitUnavailable(httpPeer);
    Assert.Empty(operations.Committed(HttpDoc));
    Assert.Null(operations.Checkpoint(HttpDoc));
    await SettleAsync(app);
    Assert.Equal(0, fakes.Endpoint.SavesFor(HttpDoc));
    Assert.Equal(0, fakes.Store.Writes(HttpDoc));
    Assert.False(fakes.Store.Holds(HttpDoc));
    Assert.Equal("seeded", await LaterReaderTextAsync(app, HttpDoc));

    // ---- the checkpoint fails ----
    await using var checkpointWriter = await app.ConnectAsync(CheckpointDoc, [SyncApp.ProtocolV2]);
    var checkpointDoc = YDocs.NewClient();
    var checkpointLineage = await HandshakeV2Async(checkpointWriter, checkpointDoc);
    await using var checkpointPeer = await app.ConnectAsync(CheckpointDoc, [SyncApp.Protocol]);
    await checkpointPeer.ReceiveAsync<BlokControlFrame>();
    var checkpointPeerDoc = await SyncedAsync(checkpointPeer);
    await checkpointWriter.ReceiveAsync<QueryAwarenessFrame>();
    var committed = YDocs.UpdateAppending(checkpointDoc, "!");

    await checkpointWriter.SendAsync(new OperationFrame(checkpointLineage, OpOne, committed));

    // The positive control. A journal that COMMITS opens every route the rest
    // of this test asserts shut, so a gate that passes because nothing ran is
    // visible right here.
    Assert.Equal(committed, (await checkpointWriter.ReceiveAsync<SyncUpdateFrame>()).Update);
    Assert.Equal(1UL, (await checkpointWriter.ReceiveAsync<AcknowledgementFrame>()).ServerSequence);
    YDocs.Apply(checkpointPeerDoc, (await checkpointPeer.ReceiveAsync<SyncUpdateFrame>()).Update);
    Assert.Equal("seeded!", YDocs.Text(checkpointPeerDoc));
    Assert.Single(operations.Committed(CheckpointDoc));

    var checkpointPeerNext = checkpointPeer.ReceiveOrCloseAsync();

    // Routes 4 and 5. A refused checkpoint publishes nothing and earns no
    // projection; the room tolerates two and stops on the third.
    for (var attempt = 1; attempt <= 3; attempt++)
    {
      Assert.False(await fakes.Manager.CheckpointAsync(CheckpointDoc, CancellationToken.None));
      Assert.Null(operations.Checkpoint(CheckpointDoc));
      await SettleAsync(app);
      Assert.Equal(0, fakes.Endpoint.SavesFor(CheckpointDoc));

      if (attempt < 3)
      {
        Assert.False(checkpointPeerNext.IsCompleted);
      }
    }

    Assert.Null(await checkpointPeerNext);
    AssertCommitUnavailable(checkpointPeer);
    Assert.Null(operations.Checkpoint(CheckpointDoc));
    Assert.Equal(0, fakes.Endpoint.SavesFor(CheckpointDoc));

    // Route 6: a journal room keeps no blob, and a checkpoint it could not
    // publish does not bring one back.
    Assert.Equal(0, fakes.Store.Writes(CheckpointDoc));
    Assert.False(fakes.Store.Holds(CheckpointDoc));

    // The committed operation is still there — the guarantee is about what
    // the journal did NOT take, not about losing what it did.
    Assert.Equal("seeded!", await LaterReaderTextAsync(app, CheckpointDoc));
    Assert.Single(operations.Committed(CheckpointDoc));
  }

  private static void AssertCommitUnavailable(SyncClient client)
  {
    Assert.Equal(4503, (int)(client.Socket.CloseStatus ?? WebSocketCloseStatus.Empty));
    Assert.Equal("commit unavailable, retry", client.Socket.CloseStatusDescription);
  }

  /// <summary>Gives an owed projection its whole window, then drains the lane.</summary>
  private static async Task SettleAsync(SyncApp app)
  {
    await Task.Delay(ExportWindow * 4);
    await app.Fakes.Manager.SettleAsync();
  }

  /// <summary>
  /// A fresh reader on a fresh room. A commit failure leaves the document in
  /// a cooldown, so the join is retried until it lands rather than slept past
  /// once — the cooldown runs on the system clock.
  /// </summary>
  private static async Task<string> LaterReaderTextAsync(SyncApp app, string docId)
  {
    var deadline = DateTime.UtcNow + Deadline.Length;

    while (true)
    {
      var reader = await app.ConnectAsync(docId, [SyncApp.Protocol]);

      try
      {
        if (await reader.ReceiveOrCloseAsync() is not null)
        {
          return YDocs.Text(await SyncedAsync(reader));
        }
      }
      finally
      {
        await reader.DisposeAsync();
      }

      if (DateTime.UtcNow > deadline)
      {
        Assert.Fail($"the commit cooldown on \"{docId}\" never lifted");
      }

      await Task.Delay(20);
    }
  }

  private static async Task<YDoc> SyncedAsync(SyncClient client)
  {
    var doc = YDocs.NewClient();
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    YDocs.Apply(doc, (await client.ReceiveAsync<SyncStep2Frame>()).Update);
    await client.ReceiveAsync<SyncStep1Frame>();

    return doc;
  }

  /// <summary>Drives a v2 socket through the handshake and returns the document's lineage.</summary>
  private static async Task<string> HandshakeV2Async(SyncClient client, YDoc doc)
  {
    var lineage = (await client.ReceiveAsync<BlokControlFrame>()).Tag.Lineage;
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    YDocs.Apply(doc, (await client.ReceiveAsync<SyncStep2Frame>()).Update);
    await client.ReceiveAsync<SyncStep1Frame>();

    return lineage;
  }

  private static async Task<HttpResponseMessage> EditAsync(
      SyncApp app,
      string doc,
      string key)
  {
    using var request = new HttpRequestMessage(
        HttpMethod.Post,
        $"/sync/{Uri.EscapeDataString(doc)}/edit")
    {
      Content = new StringContent(AppendOne, Encoding.UTF8, "application/json"),
    };
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
    request.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", key);

    return await app.CreateClient().SendAsync(request);
  }
}
