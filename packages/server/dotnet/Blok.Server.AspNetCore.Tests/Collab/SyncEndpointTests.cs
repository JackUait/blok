using System.Net;
using System.Net.WebSockets;
using System.Text;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>The /sync/{doc} wire once the door is open: sync, awareness, limits, lifecycle.</summary>
public sealed class SyncEndpointTests
{
  private const string OpOne = "0123456789abcdef0123456789abcdef";

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

  [Theory]
  [InlineData("Bearer doc-secret\n")]
  [InlineData("Bearer doc-secret\r\n")]
  [InlineData("Bearer\rdoc-secret")]
  public void RejectsADocEndpointAuthWithALineBreak(string value)
  {
    // The usual cause is `echo` or a file feeding the environment variable;
    // the client would silently send no Authorization header at all.
    var options = new BlokServerOptions
    {
      CollabEnabled = true,
      DocEndpoint = "https://app.example.com/api/blok-docs",
      DocEndpointAuth = value,
    };

    var error = Assert.Throws<InvalidOperationException>(options.Validate);

    Assert.Contains("trailing newline", error.Message, StringComparison.Ordinal);
  }

  [Fact]
  public void WarnsAtRegistrationWhenNothingGuardsTheSyncRoutesInProcess()
  {
    var open = new CapturingLoggerProvider();
    using var unguarded = BuildApplication(EnableCollab, builder => builder.Logging.AddProvider(open));
    unguarded.MapBlokServer("/blok");

    var warning = Assert.Single(open.Entries, entry => entry.Level == LogLevel.Warning);
    Assert.Contains("IBlokAuthorization", warning.Message, StringComparison.Ordinal);
    Assert.Contains("/blok/sync/{doc}", warning.Message, StringComparison.Ordinal);
    Assert.Contains("/blok/sync/{doc}/reset", warning.Message, StringComparison.Ordinal);
    Assert.Contains("/blok/sync/{doc}/edit", warning.Message, StringComparison.Ordinal);
    Assert.Contains("GET /blok/sync/{doc}/state", warning.Message, StringComparison.Ordinal);
    Assert.Contains("GET /blok/sync/{doc}/history,", warning.Message, StringComparison.Ordinal);
    Assert.Contains("GET /blok/sync/{doc}/history/{lineage}/{sequence}", warning.Message, StringComparison.Ordinal);
    Assert.Contains("DELETE /blok/sync/{doc}/history/{lineage}", warning.Message, StringComparison.Ordinal);
    Assert.Contains("POST /blok/sync/{doc}/history/{lineage}/{sequence}/restore", warning.Message, StringComparison.Ordinal);
    Assert.Contains("GET /blok/sync/{doc}/history/{lineage}/{sequence}/changes", warning.Message, StringComparison.Ordinal);
    // The four route fields shipped in 1.16.1; log queries may key on them.
    var fields = Assert.Single(open.Structured, entry => entry.Id.Id == 2).Fields.ToDictionary();
    Assert.Equal("GET /blok/sync/{doc}", fields["Sync"]);
    Assert.Equal("POST /blok/sync/{doc}/reset", fields["Reset"]);
    Assert.Equal("POST /blok/sync/{doc}/edit", fields["Edit"]);
    Assert.Equal("GET /blok/sync/{doc}/state", fields["State"]);
    Assert.Equal(
        "GET /blok/sync/{doc}/history, GET /blok/sync/{doc}/history/{lineage}/{sequence}, " +
        "DELETE /blok/sync/{doc}/history/{lineage}, POST /blok/sync/{doc}/history/{lineage}/{sequence}/restore, " +
        "GET /blok/sync/{doc}/history/{lineage}/{sequence}/changes",
        fields["History"]);
    // The standalone host forwards only this category to stderr, and its
    // none mode is loopback-only by validation: the warning is in-process only.
    Assert.NotEqual("Blok.Server.Collab", warning.Category);

    var guarded = new CapturingLoggerProvider();
    using var withHook = BuildApplication(EnableCollab, builder =>
    {
      builder.Logging.AddProvider(guarded);
      builder.Services.AddSingleton<IBlokAuthorization>(new RecordingAuthorization());
    });
    withHook.MapBlokServer("/blok");

    var ticket = new CapturingLoggerProvider();
    using var ticketMode = BuildApplication(
        options =>
        {
          EnableCollab(options);
          options.Auth = "ticket";
          options.Secret = fixture.Secret;
          options.AllowedOrigins = [SyncApp.AllowedOrigin];
        },
        builder => builder.Logging.AddProvider(ticket));
    ticketMode.MapBlokServer("/blok");

    Assert.DoesNotContain(guarded.Entries, entry => entry.Level == LogLevel.Warning);
    Assert.DoesNotContain(ticket.Entries, entry => entry.Level == LogLevel.Warning);
  }

  private static void EnableCollab(BlokServerOptions options)
  {
    options.CollabEnabled = true;
    options.DocEndpoint = "https://app.example.com/api/blok-docs";
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
    Assert.Same(manager, provider.GetRequiredService<ICollabDocumentPurger>());
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
  public async Task RecheckRevokesOneReaderWith4403AndKeepsTheOtherConnected()
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var revoked = await app.ConnectWithTicketAsync(fixture.Compatible);
    await revoked.ReceiveAsync<BlokControlFrame>();
    await using var allowed = await app.ConnectWithTicketAsync(fixture.UserTwo);
    await allowed.ReceiveAsync<BlokControlFrame>();
    authorization.DeniedReadUsers.Add("u1");

    var closed = await ((ICollabRoomManager)app.Fakes.Manager).RecheckAccessAsync(SyncApp.Doc);

    Assert.Equal(1, closed);
    var close = await revoked.ReceiveCloseAsync();
    Assert.Equal((4403, "forbidden"), close);
    Assert.NotEqual(4409, close.Status);
    Assert.Equal("seeded", await SyncedTextAsync(allowed));
    await using var refused = await app.ConnectWithTicketAsync(fixture.Compatible);
    Assert.Equal((4403, "forbidden"), await refused.ReceiveCloseAsync());
  }

  [Fact]
  public async Task RecheckExpelsAWriterWhoLostWriteButKeepsAReadOnlyTicket()
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var writer = await app.ConnectWithTicketAsync(fixture.Compatible);
    await writer.ReceiveAsync<BlokControlFrame>();
    await using var reader = await app.ConnectWithTicketAsync(fixture.ReadOnly);
    await reader.ReceiveAsync<BlokControlFrame>();
    await using var peer = await app.ConnectWithTicketAsync(fixture.UserTwo);
    await peer.ReceiveAsync<BlokControlFrame>();
    authorization.DeniedWriteUsers.Add("u1");

    var closed = await ((ICollabRoomManager)app.Fakes.Manager).RecheckAccessAsync(SyncApp.Doc);

    Assert.Equal(1, closed);
    Assert.Equal((4403, "forbidden"), await writer.ReceiveCloseAsync());
    Assert.Equal("seeded", await SyncedTextAsync(reader));
    Assert.Equal("seeded", await SyncedTextAsync(peer));
  }

  [Fact]
  public async Task RecheckFailsClosedWhenAuthorizationThrows()
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var revoked = await app.ConnectWithTicketAsync(fixture.Compatible);
    await revoked.ReceiveAsync<BlokControlFrame>();
    await using var allowed = await app.ConnectWithTicketAsync(fixture.UserTwo);
    await allowed.ReceiveAsync<BlokControlFrame>();
    authorization.FailedReadUsers.Add("u1");

    var closed = await ((ICollabRoomManager)app.Fakes.Manager).RecheckAccessAsync(SyncApp.Doc);

    Assert.Equal(1, closed);
    Assert.Equal((4403, "forbidden"), await revoked.ReceiveCloseAsync());
    Assert.Equal("seeded", await SyncedTextAsync(allowed));
  }

  [Fact]
  public async Task RoomAdmissionRefusesARevocationAfterTheHandshakeWithoutLoading()
  {
    var authorization = new RecordingAuthorization
    {
      RevokeReadAfterWriteForUser = "u1",
    };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    await app.AssertRefusedAsync(
        HttpStatusCode.Forbidden,
        protocols: [SyncApp.Protocol, fixture.Compatible]);

    Assert.Equal(0, app.Fakes.Endpoint.Gets);
    Assert.Equal(0, app.Fakes.Manager.LiveRoomCount);
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

    var awareness = Presence(2);
    await alice.SendAsync(new AwarenessFrame(awareness));
    Assert.Equal(awareness, (await bob.ReceiveAsync<AwarenessFrame>()).Update);

    await bob.SendAsync(new QueryAwarenessFrame());
    Assert.IsType<QueryAwarenessFrame>(await alice.ReceiveAsync<QueryAwarenessFrame>());
  }

  /// <summary>
  /// The same story over a REAL socket: a client that vanishes without a
  /// goodbye — a crash, a killed tab, a dropped network — must not be left
  /// drawn on everyone else until their own 30s sweep expires it.
  /// </summary>
  [Fact]
  public async Task WithdrawsThePresenceOfAConnectionThatJustDisappears()
  {
    await using var app = await SyncApp.StartAsync();
    var alice = await app.ConnectAsync();
    await using var bob = await app.ConnectAsync();

    Assert.IsType<QueryAwarenessFrame>(await alice.ReceiveAsync<QueryAwarenessFrame>());

    await alice.SendAsync(new AwarenessFrame(Presence(2)));
    Assert.Equal(Presence(2), (await bob.ReceiveAsync<AwarenessFrame>()).Update);

    await alice.DisposeAsync();

    // Client 2 at the clock bob holds it at, with a null state: the removal a
    // stock y-protocols client applies.
    Assert.Equal(
        new byte[] { 1, 2, 1, 4, (byte)'n', (byte)'u', (byte)'l', (byte)'l' },
        (await bob.ReceiveAsync<AwarenessFrame>()).Update);
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
    var frame = SyncWire.Encode(new AwarenessFrame(PresenceOfLength(1021)));
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
      await client.SendAsync(new AwarenessFrame(Presence((byte)index)));
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
      await alice.SendAsync(new AwarenessFrame(Presence((byte)index)));
      Assert.Equal(Presence((byte)index), (await bob.ReceiveAsync<AwarenessFrame>()).Update);
      clock.Advance(TimeSpan.FromMilliseconds(100));
    }

    await alice.SendAsync(new AwarenessFrame(Presence(0x7f)));
    Assert.Equal(Presence(0x7f), (await bob.ReceiveAsync<AwarenessFrame>()).Update);
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
      await client.SendAsync(new AwarenessFrame(PresenceOfLength(100_000)));
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
    var presence = new AwarenessFrame(PresenceOfLength(200 * 1024));

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
  public async Task ARevokedReaderDropsQueuedFramesBeforeTheForbiddenClose()
  {
    const int frames = 64;
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        "ticket",
        configure: options =>
        {
          options.CollabMaxMessageBytes = 4 * 1024 * 1024;
          options.CollabInboundFramesPerSecond = 0;
          options.CollabInboundAwarenessBytesPerSecond = 0;
        },
        services: services => services.AddSingleton<IBlokAuthorization>(authorization),
        kestrel: true);
    await using var writer = await app.ConnectWithTicketAsync(fixture.UserTwo);
    await using var healthy = await app.ConnectWithTicketAsync(fixture.UserTwo);
    await using var revoked = await app.ConnectWithTicketAsync(fixture.ReadOnly);
    await writer.ReceiveAsync<BlokControlFrame>();
    await healthy.ReceiveAsync<BlokControlFrame>();
    await revoked.ReceiveAsync<BlokControlFrame>();
    Assert.Equal("seeded", await SyncedTextAsync(writer));
    Assert.Equal("seeded", await SyncedTextAsync(healthy));
    Assert.Equal("seeded", await SyncedTextAsync(revoked));
    var text = new string('x', 400 * 1024);

    for (var index = 0; index < frames; index++)
    {
      var update = YDocs.UpdateAppending(YDocs.NewClient(), text);
      await writer.SendAsync(new SyncUpdateFrame(update));
      Assert.Equal(update, (await healthy.ReceiveAsync<SyncUpdateFrame>()).Update);
    }

    authorization.DeniedReadUsers.Add("u1");
    var closed = await ((ICollabRoomManager)app.Fakes.Manager).RecheckAccessAsync(SyncApp.Doc);
    var received = 0;

    while (await revoked.ReceiveOrCloseAsync() is { } frame)
    {
      Assert.IsType<SyncUpdateFrame>(frame);
      received++;
    }

    Assert.True(received < frames, $"received all {received} queued frames after revocation");
    Assert.Equal(1, closed);
    Assert.Equal(4403, (int?)revoked.Socket.CloseStatus);
    Assert.Equal("forbidden", revoked.Socket.CloseStatusDescription);
    await revoked.CloseAsync();
  }

  /// <summary>
  /// v2 keeps the v1 handshake and changes only what the client may send
  /// back. Both clients start from an empty doc against the same room, so
  /// "the same frames" is assertable as the same bytes.
  /// </summary>
  [Fact]
  public async Task AV2JoinReceivesTheSameHandshakeBytesAsAV1Join()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartV2Async(
        operations,
        new CollabRoomOptions { AnnouncedMaxMessageBytes = 1L << 20 });
    await using var v1 = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    var v1Frames = await HandshakeFramesAsync(v1);
    await using var v2 = await app.ConnectAsync(
        protocols: [SyncApp.ProtocolV2, SyncApp.Protocol]);
    var v2Frames = await HandshakeFramesAsync(v2);

    Assert.Equal(SyncApp.ProtocolV2, v2.SubProtocol);
    Assert.Collection(
        v2Frames,
        frame => Assert.IsType<BlokControlFrame>(frame),
        frame => Assert.IsType<BlokLimitsFrame>(frame),
        frame => Assert.IsType<IdentitiesFrame>(frame),
        frame => Assert.IsType<SyncStep2Frame>(frame),
        frame => Assert.IsType<SyncStep1Frame>(frame));
    Assert.Equal(v1Frames.Select(SyncWire.Encode), v2Frames.Select(SyncWire.Encode));
  }

  /// <summary>
  /// <see cref="SyncClient.ReceiveAsync{T}"/> transparently skips a join-time
  /// identities frame — that is what protects every other test in this file
  /// from needing to know about it, but it also means none of them can prove
  /// the frame is actually sent. This one reads raw, so if the server
  /// stopped sending it, this is the test that would notice.
  /// </summary>
  [Fact]
  public async Task AJoinSendsAnIdentitiesFrame()
  {
    await using var app = await SyncApp.StartAsync();
    await using var client = await app.ConnectAsync(protocols: [SyncApp.Protocol]);

    Assert.IsType<BlokControlFrame>(await client.ReceiveAsync());
    Assert.IsType<IdentitiesFrame>(await client.ReceiveAsync());
  }

  /// <summary>
  /// Every inbound SyncStep1 is answered SyncStep2 then the server's own
  /// SyncStep1, resyncs included — that second answer is how a client which
  /// has just drained its outbox learns the fresh server state vector.
  /// </summary>
  [Fact]
  public async Task AResyncOnAV2SessionIsAnsweredWithSyncStep2ThenAFreshServerSyncStep1()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartV2Async(operations);
    await using var client = await app.ConnectAsync(protocols: [SyncApp.ProtocolV2]);
    var doc = YDocs.NewClient();
    var lineage = (await client.ReceiveAsync<BlokControlFrame>()).Tag.Lineage;
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    YDocs.Apply(doc, (await client.ReceiveAsync<SyncStep2Frame>()).Update);
    var atJoin = (await client.ReceiveAsync<SyncStep1Frame>()).StateVector;
    await client.SendAsync(new OperationFrame(lineage, OpOne, YDocs.UpdateAppending(doc, "!")));
    await client.ReceiveAsync<SyncUpdateFrame>();
    await client.ReceiveAsync<AcknowledgementFrame>();

    await client.SendAsync(new SyncStep1Frame(atJoin));

    await client.ReceiveAsync<SyncStep2Frame>();
    Assert.NotEqual(atJoin, (await client.ReceiveAsync<SyncStep1Frame>()).StateVector);
  }

  /// <summary>
  /// The negotiated protocol is what the journal records, and the handshake
  /// is the only thing that sets it.
  /// </summary>
  [Fact]
  public async Task AV2OperationIsRelayedAcknowledgedAndJournalledAsAClientV2Write()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartV2Async(operations);
    await using var client = await app.ConnectAsync(protocols: [SyncApp.ProtocolV2]);
    var doc = YDocs.NewClient();
    var lineage = await HandshakeV2Async(client, doc);
    var update = YDocs.UpdateAppending(doc, "!");

    await client.SendAsync(new OperationFrame(lineage, OpOne, update));

    // The submitter is in the v2 broadcast: on a v2 session the relay is how
    // a writer sees what the server accepted, and the receipt follows it.
    Assert.Equal(update, (await client.ReceiveAsync<SyncUpdateFrame>()).Update);
    var ack = await client.ReceiveAsync<AcknowledgementFrame>();
    Assert.Equal(lineage, ack.Lineage);
    Assert.Equal(OpOne, ack.OperationId);
    Assert.Equal(1UL, ack.ServerSequence);
    var record = Assert.Single(operations.Committed(SyncApp.Doc));
    Assert.Equal(OpOne, record.OperationId);
    Assert.Equal(CollabOperationSource.ClientV2, record.Source);
  }

  /// <summary>Presence is not a write, so v2 relays it, before its sync exchange too.</summary>
  [Fact]
  public async Task AwarenessFromAV2SessionIsRelayed()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartV2Async(operations);
    await using var peer = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(peer));
    await using var writer = await app.ConnectAsync(protocols: [SyncApp.ProtocolV2]);
    Assert.Equal(SyncApp.ProtocolV2, writer.SubProtocol);

    await writer.SendAsync(new AwarenessFrame(Presence(7)));

    Assert.Equal(Presence(7), (await peer.ReceiveAsync<AwarenessFrame>()).Update);
  }

  /// <summary>
  /// Protocol §7: a raw SyncStep2/Update on a v2 socket carries no operation
  /// id, so it can be answered with neither an acknowledgement nor a
  /// rejection. Nothing is applied, journalled or relayed; the socket goes.
  /// </summary>
  [Theory]
  [InlineData(false)]
  [InlineData(true)]
  public async Task ARawWriteOnAV2SessionIsClosed1008WithoutReachingAPeer(bool asSyncStep2)
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartV2Async(operations);
    await using var writer = await app.ConnectAsync(protocols: [SyncApp.ProtocolV2]);
    var doc = YDocs.NewClient();
    await HandshakeV2Async(writer, doc);
    await using var peer = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(peer));

    // The peer's join queued this at the writer; left in place it would be
    // mistaken below for a frame the raw write produced.
    await writer.ReceiveAsync<QueryAwarenessFrame>();
    var update = YDocs.UpdateAppending(doc, "!");
    var offenderNext = writer.ReceiveOrCloseAsync();
    var peerNext = peer.ReceiveOrCloseAsync();

    await writer.SendAsync(asSyncStep2
      ? new SyncStep2Frame(update)
      : new SyncUpdateFrame(update));

    // Whichever lands first answers it: the writer is excluded from a raw
    // relay, so a leak is only ever visible at the peer.
    var landed = await await Task.WhenAny(offenderNext, peerNext);

    // The loser is never awaited and faults when its socket is disposed;
    // observing it keeps that out of this test's failure output.
    _ = offenderNext.ContinueWith(
        task => _ = task.Exception,
        TaskContinuationOptions.OnlyOnFaulted);
    _ = peerNext.ContinueWith(
        task => _ = task.Exception,
        TaskContinuationOptions.OnlyOnFaulted);

    Assert.True(landed is null, $"expected the close first, got {landed}");
    Assert.Equal(1008, (int)(writer.Socket.CloseStatus ?? WebSocketCloseStatus.Empty));
    Assert.Equal("raw write on a v2 session", writer.Socket.CloseStatusDescription);
    Assert.Empty(operations.Committed(SyncApp.Doc));
  }

  /// <summary>
  /// not-synced is the one transient rejection code: the room was not ready,
  /// the operation was never judged invalid, and the socket stays up for the
  /// client to redrive the same id.
  /// </summary>
  [Fact]
  public async Task AnOperationBeforeTheSyncExchangeIsRejectedAsNotSyncedAndAcceptedAfterIt()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartV2Async(operations);
    await using var client = await app.ConnectAsync(protocols: [SyncApp.ProtocolV2]);
    var doc = YDocs.NewClient();
    var lineage = (await client.ReceiveAsync<BlokControlFrame>()).Tag.Lineage;
    var update = YDocs.UpdateAppending(doc, "!");

    await client.SendAsync(new OperationFrame(lineage, OpOne, update));

    var rejection = await client.ReceiveAsync<RejectionFrame>();
    Assert.Equal("not-synced", rejection.Code);
    Assert.Equal(OpOne, rejection.OperationId);
    Assert.Empty(operations.Committed(SyncApp.Doc));

    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    await client.ReceiveAsync<SyncStep2Frame>();
    await client.ReceiveAsync<SyncStep1Frame>();
    await client.SendAsync(new OperationFrame(lineage, OpOne, update));

    await client.ReceiveAsync<SyncUpdateFrame>();
    Assert.Equal(OpOne, (await client.ReceiveAsync<AcknowledgementFrame>()).OperationId);
    Assert.Single(operations.Committed(SyncApp.Doc));
  }

  [Fact]
  public async Task ADocumentOpenElsewhereCloses4503()
  {
    var operations = new FakeCollabOperationStore { DocumentOpenElsewhere = true };
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<ICollabOperationStore>(operations),
        fakes: new SyncFakes(operationStore: operations));
    await using var client = await app.ConnectAsync(protocols: [SyncApp.Protocol]);

    Assert.Equal((4503, "document unavailable"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task TwoUsersKeepRestoredContentButCannotReopenAfterPermanentPurge()
  {
    var directory = Path.Combine(
        Path.GetTempPath(), $"blok-access-lifecycle-{Guid.NewGuid():N}");
    var authorization = new RecordingAuthorization();
    var hostTrashed = false;
    var hostTombstoneCommitted = false;

    try
    {
      var journal = new LocalCollabOperationStore(directory);
      await using (var app = await SyncApp.StartAsync(
          "ticket",
          services: services =>
          {
            services.AddSingleton<IBlokAuthorization>(authorization);
            services.AddSingleton<ICollabOperationStore>(journal);
          },
          fakes: new SyncFakes(operationStore: journal)))
      {
        await using var alice = await app.ConnectWithTicketAsync(fixture.Compatible);
        await alice.ReceiveAsync<BlokControlFrame>();
        Assert.Equal("seeded", await SyncedTextAsync(alice));
        await using var bob = await app.ConnectAsync(
            protocols: [SyncApp.ProtocolV2, fixture.UserTwo]);
        var bobDoc = YDocs.NewClient();
        var lineage = await HandshakeV2Async(bob, bobDoc);
        Assert.Equal("seeded", YDocs.Text(bobDoc));
        await alice.ReceiveAsync<QueryAwarenessFrame>();

        authorization.DeniedReadUsers.Add("u1");
        Assert.Equal(1, await app.Fakes.Manager.RecheckAccessAsync(SyncApp.Doc));
        var update = YDocs.UpdateAppending(bobDoc, " kept");
        await bob.SendAsync(new OperationFrame(lineage, OpOne, update));
        Assert.Equal(update, (await bob.ReceiveAsync<SyncUpdateFrame>()).Update);
        Assert.Equal(OpOne, (await bob.ReceiveAsync<AcknowledgementFrame>()).OperationId);
        Assert.Null(await alice.ReceiveOrCloseAsync());
        Assert.Equal(4403, (int?)alice.Socket.CloseStatus);
        Assert.Equal("forbidden", alice.Socket.CloseStatusDescription);

        hostTrashed = true;
        authorization.AllowRead = !hostTrashed;
        Assert.Equal(1, await app.Fakes.Manager.RecheckAccessAsync(SyncApp.Doc));
        Assert.Equal((4403, "forbidden"), await bob.ReceiveCloseAsync());
        Assert.False(hostTombstoneCommitted);

        hostTrashed = false;
        authorization.AllowRead = !hostTrashed;
        await using var restored = await app.ConnectWithTicketAsync(fixture.UserTwo);
        await restored.ReceiveAsync<BlokControlFrame>();
        Assert.Equal("seeded kept", await SyncedTextAsync(restored));

        hostTombstoneCommitted = true;
        authorization.AllowRead = false;
        var purger = app.App.Services.GetRequiredService<ICollabDocumentPurger>();
        Assert.Equal(CollabDocumentPurgeOutcome.Purged,
            await purger.PurgeDocumentAsync(
                SyncApp.Doc, _ => ValueTask.FromResult(hostTombstoneCommitted)));
        Assert.Equal((4403, "forbidden"), await restored.ReceiveCloseAsync());
      }

      var restartedJournal = new LocalCollabOperationStore(directory);
      await using var restarted = await SyncApp.StartAsync(
          services: services => services.AddSingleton<ICollabOperationStore>(restartedJournal),
          fakes: new SyncFakes(operationStore: restartedJournal));
      await restarted.AssertRefusedAsync(HttpStatusCode.Forbidden);
      Assert.Equal(0, restarted.Fakes.Endpoint.Gets);
    }
    finally
    {
      if (Directory.Exists(directory))
      {
        Directory.Delete(directory, recursive: true);
      }
    }
  }

  [Fact]
  public async Task PurgeClosesTheSocketAndForbidsNewSyncEditAndReset()
  {
    await using var app = await SyncApp.StartAsync();
    await using var member = await app.ConnectAsync();
    Assert.Equal("seeded", await SyncedTextAsync(member));
    var purger = app.App.Services.GetRequiredService<ICollabDocumentPurger>();
    Assert.Same(app.Fakes.Manager, purger);

    Assert.Equal(CollabDocumentPurgeOutcome.Purged,
        await purger.PurgeDocumentAsync(
            SyncApp.Doc, _ => ValueTask.FromResult(true)));

    Assert.Equal((4403, "forbidden"), await member.ReceiveCloseAsync());
    Assert.False(app.Fakes.Store.Holds(SyncApp.Doc));
    Assert.Equal(0, app.Fakes.Manager.LiveRoomCount);
    await app.AssertRefusedAsync(HttpStatusCode.Forbidden);
    using var client = app.CreateClient();
    using var edit = new HttpRequestMessage(
        HttpMethod.Post, $"/sync/{SyncApp.Doc}/edit")
    {
      Content = new StringContent(
          """{"ops":[{"op":"insert","id":"late","block":{"type":"p","data":{"text":"!"}}}]}""",
          Encoding.UTF8,
          "application/json"),
    };
    edit.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
    edit.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", "late");
    using var editResponse = await client.SendAsync(edit);
    using var reset = new HttpRequestMessage(
        HttpMethod.Post, $"/sync/{SyncApp.Doc}/reset");
    reset.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
    using var resetResponse = await client.SendAsync(reset);

    Assert.Equal(HttpStatusCode.Forbidden, editResponse.StatusCode);
    Assert.Equal(HttpStatusCode.Forbidden, resetResponse.StatusCode);
    Assert.Equal(0, app.Fakes.Manager.LiveRoomCount);
    Assert.Equal(1, app.Fakes.Endpoint.Gets);
  }

  [Fact]
  public async Task RestartedJournalTombstoneRefusesAnOldConsumerDocument()
  {
    var directory = Path.Combine(
        Path.GetTempPath(), $"blok-sync-purge-{Guid.NewGuid():N}");

    try
    {
      var originalJournal = new LocalCollabOperationStore(directory);
      await using (var original = await SyncApp.StartAsync(
          services: services => services.AddSingleton<ICollabOperationStore>(originalJournal),
          fakes: new SyncFakes(operationStore: originalJournal)))
      {
        Assert.Equal(CollabDocumentPurgeOutcome.Purged,
            await original.App.Services.GetRequiredService<ICollabDocumentPurger>()
                .PurgeDocumentAsync(SyncApp.Doc, _ => ValueTask.FromResult(true)));
      }

      var restartedJournal = new LocalCollabOperationStore(directory);
      await using var restarted = await SyncApp.StartAsync(
          services: services => services.AddSingleton<ICollabOperationStore>(restartedJournal),
          fakes: new SyncFakes(operationStore: restartedJournal));
      await restarted.AssertRefusedAsync(HttpStatusCode.Forbidden);

      Assert.Equal(0, restarted.Fakes.Endpoint.Gets);
      Assert.Equal(0, restarted.Fakes.Manager.LiveRoomCount);
    }
    finally
    {
      if (Directory.Exists(directory))
      {
        Directory.Delete(directory, recursive: true);
      }
    }
  }

  [Fact]
  public async Task APurgedDocumentRefusesSyncBeforeUpgrade()
  {
    var operations = new FakeCollabOperationStore { DocumentPurged = true };
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<ICollabOperationStore>(operations),
        fakes: new SyncFakes(operationStore: operations));

    await app.AssertRefusedAsync(HttpStatusCode.Forbidden);
    Assert.Equal(0, app.Fakes.Endpoint.Gets);
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

  /// <summary>
  /// The door advertises v2 only with a registered store, and the room needs
  /// the SAME one — a server whose handshake sees a store its room does not
  /// would negotiate a protocol it cannot durably serve.
  /// </summary>
  private static Task<SyncApp> StartV2Async(
      FakeCollabOperationStore operations,
      CollabRoomOptions? roomOptions = null)
  {
    return SyncApp.StartAsync(
        services: services => services.AddSingleton<ICollabOperationStore>(operations),
        fakes: new SyncFakes(roomOptions, operations));
  }

  /// <summary>
  /// The join frames in order — control, limits, identities, then the
  /// SyncStep2 and SyncStep1 that one SyncStep1 earns. Raw receives: the
  /// type-filtering overload skips a join-time queryAwareness, which is
  /// exactly the frame a v2-only greeting would hide behind.
  /// </summary>
  private static async Task<SyncWireMessage[]> HandshakeFramesAsync(SyncClient client)
  {
    var control = await client.ReceiveAsync();
    var limits = await client.ReceiveAsync();
    var identities = await client.ReceiveAsync();
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(YDocs.NewClient())));

    return [control, limits, identities, await client.ReceiveAsync(), await client.ReceiveAsync()];
  }

  /// <summary>Drives a v2 socket through the handshake and returns the document's lineage.</summary>
  private static async Task<string> HandshakeV2Async(SyncClient client, Blok.Server.Yjs.YDoc doc)
  {
    var lineage = (await client.ReceiveAsync<BlokControlFrame>()).Tag.Lineage;
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    YDocs.Apply(doc, (await client.ReceiveAsync<SyncStep2Frame>()).Update);
    await client.ReceiveAsync<SyncStep1Frame>();

    return lineage;
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

  private static WebApplication BuildApplication(
      Action<BlokServerOptions> configure,
      Action<WebApplicationBuilder>? configureBuilder = null)
  {
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokServer(configure);
    configureBuilder?.Invoke(builder);

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

  /// <summary>
  /// A well-formed one-client awareness payload — the room walks the
  /// y-protocols shape before relaying, so filler bytes no longer pass.
  /// [count 1][clientId][clock 1][varstring "{}"].
  /// </summary>
  private static byte[] Presence(byte clientId)
  {
    return [1, clientId, 1, 2, (byte)'{', (byte)'}'];
  }

  /// <summary>One client (id 1000, clock 1) whose state is a JSON string sized so the payload is exactly <paramref name="length"/> bytes.</summary>
  private static byte[] PresenceOfLength(int length)
  {
    const int Head = 4;

    for (var prefix = 1; prefix <= 4; prefix++)
    {
      var stateLength = length - Head - prefix;

      if (stateLength >= 2 && VarUintLength(stateLength) == prefix)
      {
        var payload = new List<byte> { 1, 0xe8, 0x07, 1 };
        var value = stateLength;

        do
        {
          var current = (byte)(value & 0x7f);
          value >>= 7;
          payload.Add(value == 0 ? current : (byte)(current | 0x80));
        }
        while (value != 0);

        payload.Add((byte)'"');
        payload.AddRange(Enumerable.Repeat((byte)'x', stateLength - 2));
        payload.Add((byte)'"');

        return [.. payload];
      }
    }

    throw new ArgumentOutOfRangeException(nameof(length));
  }

  private static int VarUintLength(int value)
  {
    var bytes = 1;

    while ((value >>= 7) != 0)
    {
      bytes++;
    }

    return bytes;
  }
}
