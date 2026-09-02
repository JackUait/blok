using System.Net;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>The /sync/{doc} wire once the door is open: sync, awareness, limits, lifecycle.</summary>
public sealed class SyncEndpointTests
{
  private readonly TicketFixture fixture = TicketFixture.Load();

  [Theory]
  [InlineData("CollabMaxConnectionsPerUserPerDoc", 0)]
  [InlineData("CollabMaxConnectionsPerUserPerDoc", -1)]
  [InlineData("CollabMaxMessageBytes", 0)]
  [InlineData("CollabMaxMessageBytes", -1)]
  [InlineData("CollabKeepAliveInterval", -1)]
  [InlineData("CollabInboundFramesPerSecond", -1)]
  [InlineData("CollabInboundBurstFrames", 0)]
  [InlineData("CollabInboundBurstFrames", -1)]
  [InlineData("CollabInboundResyncsPerMinute", -1)]
  [InlineData("CollabInboundAwarenessBytesPerSecond", -1)]
  [InlineData("CollabMaxConnections", -1)]
  public void RejectsNonPositiveCollabLimits(string option, int value)
  {
    var options = new BlokServerOptions
    {
      CollabEnabled = true,
      DocEndpoint = "https://app.example.com/api/blok-docs",
    };

    switch (option)
    {
      case "CollabMaxConnectionsPerUserPerDoc":
        options.CollabMaxConnectionsPerUserPerDoc = value;
        break;
      case "CollabMaxConnections":
        options.CollabMaxConnections = value;
        break;
      case "CollabMaxMessageBytes":
        options.CollabMaxMessageBytes = value;
        break;
      case "CollabInboundFramesPerSecond":
        options.CollabInboundFramesPerSecond = value;
        break;
      case "CollabInboundBurstFrames":
        options.CollabInboundBurstFrames = value;
        break;
      case "CollabInboundResyncsPerMinute":
        options.CollabInboundResyncsPerMinute = value;
        break;
      case "CollabInboundAwarenessBytesPerSecond":
        options.CollabInboundAwarenessBytesPerSecond = value;
        break;
      default:
        options.CollabKeepAliveInterval = TimeSpan.FromSeconds(value);
        break;
    }

    var error = Assert.Throws<InvalidOperationException>(options.Validate);

    Assert.Contains(option, error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void DefaultsTheCollabLimitsToThePlannedValues()
  {
    var options = new BlokServerOptions();

    Assert.Equal(8, options.CollabMaxConnectionsPerUserPerDoc);
    Assert.Equal(1 << 20, options.CollabMaxMessageBytes);
    Assert.Equal(TimeSpan.FromSeconds(15), options.CollabKeepAliveInterval);
    Assert.Equal(50, options.CollabInboundFramesPerSecond);
    Assert.Equal(100, options.CollabInboundBurstFrames);
    Assert.Equal(60, options.CollabInboundResyncsPerMinute);
    Assert.Equal(128 << 10, options.CollabInboundAwarenessBytesPerSecond);
    // In-process the process-wide ceiling is the host's own Kestrel setting.
    Assert.Equal(0, options.CollabMaxConnections);
  }

  [Fact]
  public async Task AtTheProcessCeilingAnUpgradeIs503BeforeTheRoomIsSeeded()
  {
    await using var app = await SyncApp.StartAsync(
        configure: options => options.CollabMaxConnections = 1);
    await using var held = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(held));
    var getsWhileHeld = app.Fakes.Endpoint.Gets;

    // A different document, so a join would have to seed it: the refusal
    // must come before the consumer is asked for anything.
    await app.AssertRefusedAsync(HttpStatusCode.ServiceUnavailable, doc: "doc-43");
    Assert.Equal(getsWhileHeld, app.Fakes.Endpoint.Gets);

    await held.CloseAsync();
    Assert.Equal((1000, ""), await held.ReceiveCloseAsync());

    // The slot is freed once the request ends, a moment after the close is
    // answered — the same moment Kestrel frees its own — so retry to a deadline.
    await using var admitted = await ConnectWhenAdmittedAsync(app);
    Assert.Equal("seeded", await SyncedTextAsync(admitted));
  }

  private static async Task<SyncClient> ConnectWhenAdmittedAsync(SyncApp app)
  {
    var deadline = Deadline.Token();

    while (true)
    {
      try
      {
        return await app.ConnectAsync();
      }
      catch (UpgradeRefusedException refused) when (
          refused.StatusCode == (int)HttpStatusCode.ServiceUnavailable)
      {
        await Task.Delay(20, deadline);
      }
    }
  }

  [Fact]
  public void MapsTheSyncRoutesOnlyWhenCollaborationIsEnabled()
  {
    using var enabled = BuildApplication(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
    });
    enabled.MapBlokServer("/blok");

    var sync = Assert.Single(
        Endpoints(enabled, "/blok/sync/{doc}"),
        endpoint => endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("GET") == true);
    Assert.NotNull(sync.Metadata.GetMetadata<DisableRequestTimeoutAttribute>());
    Assert.Equal(
        ["OPTIONS", "POST"],
        Methods(enabled, "/blok/sync/{doc}/reset"));

    using var disabled = BuildApplication(_ => { });
    disabled.MapBlokServer("/blok");

    Assert.Empty(Endpoints(disabled, "/blok/sync/{doc}"));
    Assert.Empty(Endpoints(disabled, "/blok/sync/{doc}/reset"));
  }

  [Fact]
  public void TheContainerBuildsOneRoomManagerFromTheCollabOptions()
  {
    var services = new ServiceCollection();
    services.AddBlokServer(options =>
    {
      options.CollabEnabled = true;
      options.DocEndpoint = "https://app.example.com/api/blok-docs";
      options.DocEndpointAuth = "Bearer doc-secret";
      options.CollabDirectory = Path.Combine(
          Path.GetTempPath(),
          $"blok-sync-di-{Guid.NewGuid():N}");
    });
    using var provider = services.BuildServiceProvider();

    var manager = provider.GetRequiredService<CollabRoomManager>();

    Assert.Same(manager, provider.GetRequiredService<ICollabRoomManager>());
    Assert.Same(manager, provider.GetRequiredService<CollabRoomManager>());
  }

  [Fact]
  public async Task AnUpgradeWithoutTheGetMethodIsMethodNotAllowed()
  {
    await using var app = await SyncApp.StartAsync();
    using var client = app.CreateClient();
    using var response = await client.PostAsync($"/sync/{SyncApp.Doc}", content: null);

    Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    Assert.Equal("GET", string.Join(", ", response.Content.Headers.Allow));
  }

  [Fact]
  public async Task TwoClientsConvergeThroughTheRoom()
  {
    await using var app = await SyncApp.StartAsync();
    await using var alice = await app.ConnectAsync();
    await using var bob = await app.ConnectAsync();
    var aliceDoc = await SyncedAsync(alice);
    var bobDoc = await SyncedAsync(bob);

    var update = YDocs.UpdateAppending(aliceDoc, " from alice");
    await alice.SendAsync(new SyncUpdateFrame(update));
    var relayed = await bob.ReceiveAsync<SyncUpdateFrame>();

    Assert.Equal(update, relayed.Update);
    YDocs.Apply(bobDoc, relayed.Update);
    Assert.Equal("seeded from alice", YDocs.Text(bobDoc));
    Assert.Equal(YDocs.Text(aliceDoc), YDocs.Text(bobDoc));
  }

  [Fact]
  public async Task ALateJoinerGetsSyncStep2ThenSyncStep1ForItsSyncStep1()
  {
    await using var app = await SyncApp.StartAsync();
    await using var alice = await app.ConnectAsync();
    var aliceDoc = await SyncedAsync(alice);
    await alice.SendAsync(new SyncUpdateFrame(YDocs.UpdateAppending(aliceDoc, " early")));
    Assert.Equal("seeded early", await SyncedTextAsync(alice));

    await using var late = await app.ConnectAsync();
    var lateDoc = YDocs.NewClient();
    await late.SendAsync(new SyncStep1Frame(YDocs.StateVector(lateDoc)));

    var step2 = await late.ReceiveAsync<SyncStep2Frame>();
    var step1 = await late.ReceiveAsync<SyncStep1Frame>();
    YDocs.Apply(lateDoc, step2.Update);
    Assert.Equal("seeded early", YDocs.Text(lateDoc));
    Assert.Equal(YDocs.StateVector(lateDoc), step1.StateVector);
  }

  [Fact]
  public async Task AwarenessIsRelayedVerbatimAndAJoinQueriesTheOthers()
  {
    await using var app = await SyncApp.StartAsync();
    await using var alice = await app.ConnectAsync();
    await using var bob = await app.ConnectAsync();

    Assert.IsType<QueryAwarenessFrame>(await alice.ReceiveAsync<QueryAwarenessFrame>());

    byte[] awareness = [1, 2, 3, 4, 5];
    await alice.SendAsync(new AwarenessFrame(awareness));
    Assert.Equal(awareness, (await bob.ReceiveAsync<AwarenessFrame>()).Update);

    await bob.SendAsync(new QueryAwarenessFrame());
    Assert.IsType<QueryAwarenessFrame>(await alice.ReceiveAsync<QueryAwarenessFrame>());
  }

  [Fact]
  public async Task TheNinthConnectionForOneUserAndDocIsRefusedWhileAnotherUserStillJoins()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    var clients = new List<SyncClient>();

    try
    {
      for (var index = 0; index < 8; index++)
      {
        var client = await app.ConnectWithTicketAsync(fixture.Compatible);
        clients.Add(client);
        await client.ReceiveAsync<BlokControlFrame>();
      }

      await app.AssertRefusedAsync(
          HttpStatusCode.TooManyRequests,
          protocols: [SyncApp.Protocol, fixture.Compatible]);

      await using var otherUser = await app.ConnectWithTicketAsync(fixture.UserTwo);
      await otherUser.ReceiveAsync<BlokControlFrame>();
    }
    finally
    {
      foreach (var client in clients)
      {
        await client.DisposeAsync();
      }
    }
  }

  [Fact]
  public async Task ClosingAConnectionFreesItsSlot()
  {
    await using var app = await SyncApp.StartAsync(
        "ticket",
        options => options.CollabMaxConnectionsPerUserPerDoc = 1);
    await using var first = await app.ConnectWithTicketAsync(fixture.Compatible);
    await first.ReceiveAsync<BlokControlFrame>();
    await app.AssertRefusedAsync(
        HttpStatusCode.TooManyRequests,
        protocols: [SyncApp.Protocol, fixture.Compatible]);

    await first.CloseAsync();
    Assert.Equal((1000, ""), await first.ReceiveCloseAsync());

    await using var second = await app.ConnectWithTicketAsync(fixture.Compatible);
    await second.ReceiveAsync<BlokControlFrame>();
  }

  [Theory]
  [InlineData("{\"user\":\"\",\"doc\":\"doc-42\",\"write\":true,\"exp\":4102444800}")]
  [InlineData("{\"doc\":\"doc-42\",\"write\":true,\"exp\":4102444800}")]
  public async Task ATicketWithoutAUserIsClosed4401(string payload)
  {
    // Ticket mode is the public mode and its docs require a proxy in front,
    // so the client address is the proxy's: keying the cap or the rate
    // window on it would throttle every user-less holder together. A pass
    // that names nobody is turned away instead.
    var ticket = fixture.Sign(payload);
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectWithTicketAsync(ticket);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4401, "pass names no user"), await client.ReceiveCloseAsync());

    await using var named = await app.ConnectWithTicketAsync(fixture.Compatible);
    await named.ReceiveAsync<BlokControlFrame>();
  }

  [Theory]
  [InlineData("none")]
  [InlineData("proxy")]
  public async Task ConnectionsWithoutAUserIdentityAreNotCapped(string auth)
  {
    // Behind a proxy (or on loopback) every socket shares one address; a cap
    // keyed on it would be a per-doc cap for everyone.
    await using var app = await SyncApp.StartAsync(
        auth,
        options => options.CollabMaxConnectionsPerUserPerDoc = 1);
    await using var first = await app.ConnectAsync(origin: null);
    await using var second = await app.ConnectAsync(origin: null);

    Assert.Equal("seeded", await SyncedTextAsync(first));
    Assert.Equal("seeded", await SyncedTextAsync(second));
  }

  [Fact]
  public async Task AnOversizedFrameCloses1009()
  {
    await using var app = await SyncApp.StartAsync(
        configure: options => options.CollabMaxMessageBytes = 1024);
    await using var client = await app.ConnectAsync();

    await client.SendRawAsync(new byte[1025]);

    Assert.Equal((1009, "message too big"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task AFrameAtTheLimitStillReachesTheRoom()
  {
    await using var app = await SyncApp.StartAsync(
        configure: options => options.CollabMaxMessageBytes = 1024);
    await using var alice = await app.ConnectAsync();
    await using var bob = await app.ConnectAsync();
    // [1][varuint 1021][payload] = 1 + 2 + 1021 bytes.
    var frame = SyncWire.Encode(new AwarenessFrame(new byte[1021]));
    Assert.Equal(1024, frame.Length);

    await alice.SendRawAsync(frame);

    Assert.Equal(1021, (await bob.ReceiveAsync<AwarenessFrame>()).Update.Length);
  }

  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task ATextFrameIsClosed1003BeforeItIsParsed(bool kestrel)
  {
    await using var app = await SyncApp.StartAsync(kestrel: kestrel);
    await using var client = await app.ConnectAsync();

    await client.SendTextAsync("hello");

    Assert.Equal((1003, "binary frames only"), await client.ReceiveCloseAsync());
  }

  /// <summary>
  /// One message carried as thousands of empty continuation frames costs
  /// the sender six bytes a frame and the server a receive a frame; nothing
  /// else meters it, because the budget only sees a message once it ends.
  /// </summary>
  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task AFloodOfEmptyContinuationFramesCloses1008(bool kestrel)
  {
    await using var app = await SyncApp.StartAsync(kestrel: kestrel);
    await using var client = await app.ConnectAsync();

    await client.SendFragmentAsync([1], endOfMessage: false);

    for (var index = 0; index < 10_000; index++)
    {
      await client.SendFragmentAsync([], endOfMessage: false);
    }

    await client.SendFragmentAsync([0], endOfMessage: true);

    Assert.Equal((1008, "inbound rate exceeded"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task AnInboundBurstOverTheBudgetCloses1008()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        configure: options =>
        {
          options.CollabInboundFramesPerSecond = 10;
          options.CollabInboundBurstFrames = 10;
        },
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();

    // The clock never moves, so nothing refills: the eleventh frame is over.
    for (var index = 0; index < 12; index++)
    {
      await client.SendAsync(new AwarenessFrame([(byte)index]));
    }

    Assert.Equal((1008, "inbound rate exceeded"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task ASustainedLegitimateCadenceRefillsTheBudgetAndStaysOpen()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        configure: options =>
        {
          options.CollabInboundFramesPerSecond = 10;
          options.CollabInboundBurstFrames = 10;
        },
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var alice = await app.ConnectAsync();
    await using var bob = await app.ConnectAsync();

    // Ten frames a second for three seconds — three times the burst, never
    // over the rate. Bob's copy is the proof each one reached the room.
    for (var index = 0; index < 30; index++)
    {
      await alice.SendAsync(new AwarenessFrame([(byte)index]));
      Assert.Equal([(byte)index], (await bob.ReceiveAsync<AwarenessFrame>()).Update);
      clock.Advance(TimeSpan.FromMilliseconds(100));
    }

    // A payload's first byte is the client-count varuint, so a one-byte
    // sentinel has to stay under the continuation bit.
    await alice.SendAsync(new AwarenessFrame([0x7f]));
    Assert.Equal([0x7f], (await bob.ReceiveAsync<AwarenessFrame>()).Update);
  }

  [Fact]
  public async Task AResyncStormCloses1008WhileTheFrameBudgetStillHasRoom()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();
    var doc = YDocs.NewClient();
    var resync = new SyncStep1Frame(YDocs.StateVector(doc));

    // Twelve frames is nothing to the 100-frame burst; every one of them asks
    // the room for the whole document.
    for (var index = 0; index < 12; index++)
    {
      await client.SendAsync(resync);
    }

    Assert.Equal((1008, "inbound rate exceeded"), await client.ReceiveCloseAsync());
  }

  /// <summary>
  /// A stock client answers every queryAwareness with EVERY state it holds,
  /// so an unmetered type-3 makes each peer re-encode the whole room — the
  /// same "cheap to send, room-wide to answer" shape as a resync, and it
  /// shares the resync budget.
  /// </summary>
  [Fact]
  public async Task AQueryAwarenessStormCloses1008LikeAResyncStorm()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();

    for (var index = 0; index < 12; index++)
    {
      await client.SendAsync(new QueryAwarenessFrame());
    }

    Assert.Equal((1008, "inbound rate exceeded"), await client.ReceiveCloseAsync());
  }

  /// <summary>
  /// lib0 varuints are not canonical: [0x80, 0x00] also decodes as 0, so the
  /// room answers this as SyncStep1. The budget must classify frames with the
  /// codec's reader, not by comparing raw bytes.
  /// </summary>
  [Fact]
  public async Task AResyncStormEncodedWithOverlongVarUintsIsStillAResyncStorm()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();

    // [type 0][sub-type 0][len 1][empty state vector], type and sub-type
    // written as two-byte varuints.
    byte[] resync = [0x80, 0x00, 0x80, 0x00, 0x01, 0x00];

    for (var index = 0; index < 12; index++)
    {
      await client.SendRawAsync(resync);
    }

    Assert.Equal((1008, "inbound rate exceeded"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task APresenceFloodOverTheAwarenessByteBudgetCloses1008()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();

    // Six frames is nothing to the 100-frame burst, and each one is legal
    // inbound — together they are 600 KB of presence in one instant.
    for (var index = 0; index < 6; index++)
    {
      await client.SendAsync(new AwarenessFrame(new byte[100_000]));
    }

    Assert.Equal((1008, "inbound rate exceeded"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task ADocumentPasteOfTheSameSizeIsNotMeteredAsPresence()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();
    var doc = await SyncedAsync(client);
    var paste = YDocs.UpdateAppending(doc, new string('x', 100_000));

    for (var index = 0; index < 6; index++)
    {
      await client.SendAsync(new SyncUpdateFrame(paste));
    }

    Assert.StartsWith("seeded", await SyncedTextAsync(client), StringComparison.Ordinal);
  }

  [Fact]
  public async Task AnUpdateStormOfTheSameSizeIsNotAResyncStorm()
  {
    var clock = new FakeClock();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<TimeProvider>(clock));
    await using var client = await app.ConnectAsync();
    var doc = await SyncedAsync(client);
    var update = YDocs.UpdateAppending(doc, " once");

    for (var index = 0; index < 12; index++)
    {
      await client.SendAsync(new SyncUpdateFrame(update));
    }

    Assert.Equal("seeded once", await SyncedTextAsync(client));
  }

  /// <summary>
  /// Real Kestrel, because only a real socket blocks the pump behind a full
  /// TCP window. A peer that stops reading cannot see its own close, so it
  /// resumes afterwards: the backlog first, then the 1008.
  /// </summary>
  [Fact]
  public async Task APeerThatStopsReadingIsClosed1008WhileTheOthersKeepReceiving()
  {
    const int frames = 96;
    await using var app = await SyncApp.StartAsync(
        configure: options =>
        {
          options.CollabMaxMessageBytes = 256 * 1024;
          options.CollabInboundFramesPerSecond = 0;
          options.CollabInboundAwarenessBytesPerSecond = 0;
        },
        kestrel: true);
    await using var writer = await app.ConnectAsync();
    await using var stalled = await app.ConnectAsync();
    await using var healthy = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(writer));
    var presence = new AwarenessFrame(new byte[200 * 1024]);

    // ~19 MiB at a peer reading nothing: past 8 × the message cap by more
    // than loopback TCP and Kestrel's output pipe can absorb. Lock-step
    // with the healthy peer, whose copy of each frame is also the proof
    // that the same relay was enqueued at the stalled one.
    for (var index = 0; index < frames; index++)
    {
      await writer.SendAsync(presence);
      Assert.Equal(
          presence.Update.Length,
          (await healthy.ReceiveAsync<AwarenessFrame>()).Update.Length);
    }

    Assert.Equal((1008, "outbound queue overflow"), await stalled.ReceiveCloseAsync());
  }

  [Fact]
  public async Task ASeedFailureIsAcceptedThenClosed4503()
  {
    var fakes = new SyncFakes();
    fakes.Endpoint.LoadFailure = new DocEndpointException("collab: the doc endpoint GET returned 503.", 503);
    await using var app = await SyncApp.StartAsync(fakes: fakes);
    await using var client = await app.ConnectAsync(protocols: [SyncApp.Protocol]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4503, "document unavailable"), await client.ReceiveCloseAsync());

    fakes.Endpoint.LoadFailure = null;
    await using var retry = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(retry));
  }

  [Fact]
  public async Task DrainingRefusesNewUpgradesWith503AndCloses1001()
  {
    await using var app = await SyncApp.StartAsync();
    await using var client = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(client));

    await app.Fakes.Manager.DrainAsync();

    Assert.Equal((1001, "server shutting down"), await client.ReceiveCloseAsync());
    await app.AssertRefusedAsync(HttpStatusCode.ServiceUnavailable);
  }

  private static async Task<Blok.Server.Yjs.YDoc> SyncedAsync(SyncClient client)
  {
    var doc = YDocs.NewClient();
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    var step2 = await client.ReceiveAsync<SyncStep2Frame>();
    YDocs.Apply(doc, step2.Update);
    await client.ReceiveAsync<SyncStep1Frame>();

    return doc;
  }

  private static async Task<string> SyncedTextAsync(SyncClient client)
  {
    var doc = await SyncedAsync(client);

    return YDocs.Text(doc);
  }

  private static WebApplication BuildApplication(Action<BlokServerOptions> configure)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(configure);

    return builder.Build();
  }

  private static RouteEndpoint[] Endpoints(WebApplication app, string pattern)
  {
    return ((IEndpointRouteBuilder)app).DataSources
        .SelectMany(dataSource => dataSource.Endpoints)
        .OfType<RouteEndpoint>()
        .Where(endpoint => endpoint.RoutePattern.RawText == pattern)
        .ToArray();
  }

  private static string[] Methods(WebApplication app, string pattern)
  {
    return Endpoints(app, pattern)
        .SelectMany(endpoint => endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [])
        .Order()
        .ToArray();
  }
}
