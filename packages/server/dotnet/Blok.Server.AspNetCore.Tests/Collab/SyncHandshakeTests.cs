using System.Net;
using System.Net.WebSockets;
using System.Security.Claims;
using Blok.Server.AspNetCore.Collab;
using Blok.Server.Collab;
using Blok.Server.Tickets;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>The sync door: ticket-in-subprotocol handshake, origin, authorization, limits (plan decisions 7, 9, 18).</summary>
public sealed class SyncHandshakeTests
{
  private const string DisallowedOrigin = "https://evil.example.net";
  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task ACompatibleTicketJoinsWithTheProtocolEchoedAndTheEpochFrameFirst()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectWithTicketAsync(fixture.Compatible);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    var control = await client.ReceiveAsync<BlokControlFrame>();
    AssertFreshTag(control.Tag);
    Assert.Equal("seeded", await SyncedTextAsync(client));
  }

  // The real DI wiring announces BlokServerOptions.CollabMaxMessageBytes, so a
  // deployed join is control frame, then limits frame, then the sync answer.
  [Fact]
  public async Task AnnouncesTheMessageCapRightAfterTheControlFrame()
  {
    var fakes = new SyncFakes(
        new CollabRoomOptions { AnnouncedMaxMessageBytes = 1L << 20 });
    await using var app = await SyncApp.StartAsync("ticket", fakes: fakes);
    await using var client = await app.ConnectWithTicketAsync(fixture.Compatible);

    // Raw receives pin the exact order; nothing else is in flight yet.
    AssertFreshTag(Assert.IsType<BlokControlFrame>(await client.ReceiveAsync()).Tag);
    Assert.Equal(
        1L << 20,
        Assert.IsType<BlokLimitsFrame>(await client.ReceiveAsync()).MaxMessageBytes);
    Assert.Equal("seeded", await SyncedTextAsync(client));
  }

  [Fact]
  public async Task AcceptsTheOfferAsOneCommaJoinedHeaderValue()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(
        protocols: [$"{SyncApp.Protocol}, {fixture.Compatible}"]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    AssertFreshTag((await client.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Fact]
  public async Task AcceptsTheTicketBeforeTheProtocolInTheOffer()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(
        protocols: [fixture.Compatible, SyncApp.Protocol]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    AssertFreshTag((await client.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Theory]
  [InlineData("expired")]
  [InlineData("tampered")]
  [InlineData("noncanonicalHeaderTicket")]
  [InlineData("malformed")]
  public async Task AnInvalidTicketIsAcceptedThenClosed4401(string name)
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectWithTicketAsync(Ticket(name));

    // Refusing the subprotocol would leave the browser with no readable code.
    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4401, "invalid pass"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task AMissingTicketIsAcceptedThenClosed4401()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(protocols: [SyncApp.Protocol]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4401, "missing pass"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task ATicketForAnotherDocumentIsClosed4401()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectWithTicketAsync(fixture.DocMismatch);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4401, "pass is for another document"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task TicketModeRequiresTheSyncProtocolInTheOffer()
  {
    // A 101 that echoes none of the offered protocols is failed by every
    // browser before any close code is delivered, so this one is a plain
    // refusal rather than an accept-then-close.
    await using var app = await SyncApp.StartAsync("ticket");

    await app.AssertRefusedAsync(HttpStatusCode.BadRequest, protocols: [fixture.Compatible]);
  }

  // --- v2 negotiation (Task 1.4) ----------------------------------------
  //
  // AdvertiseV2 stays off until Task 3.3 lands the commit path, so every case
  // here still selects v1 — "v1 only" and "v1+ticket" are already pinned by
  // the tests above; these cover the remaining matrix rows: v2 offered
  // alongside v1 (with and without a registered operation store), and the
  // ticket search excluding both protocol tokens.

  [Fact]
  public async Task OffersV2ThenV1ThenTicketJoinAtV1WhenNoOperationStoreIsRegistered()
  {
    await using var app = await SyncApp.StartAsync("ticket");

    Assert.Null(app.App.Services.GetService<ICollabOperationStore>());

    await using var client = await app.ConnectAsync(
        protocols: [SyncApp.ProtocolV2, SyncApp.Protocol, fixture.Compatible]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    AssertFreshTag((await client.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Fact]
  public async Task OffersV2ThenV1ThenTicketStillJoinAtV1WithAnOperationStoreRegisteredBecauseTheAdvertiseSwitchIsOff()
  {
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<ICollabOperationStore, FakeCollabOperationStore>());

    Assert.NotNull(app.App.Services.GetService<ICollabOperationStore>());

    await using var client = await app.ConnectAsync(
        protocols: [SyncApp.ProtocolV2, SyncApp.Protocol, fixture.Compatible]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    AssertFreshTag((await client.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Fact]
  public async Task TicketSearchExcludesBothProtocolTokensSoTwoProtocolsWithNoTicketIsAMissingPassNotAnInvalidOne()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(
        protocols: [SyncApp.Protocol, SyncApp.ProtocolV2]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4401, "missing pass"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task AnInvalidTicketBetweenTheTwoProtocolTokensIsStillFoundAndRejected()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(
        protocols: [SyncApp.Protocol, fixture.Expired, SyncApp.ProtocolV2]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4401, "invalid pass"), await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task ADocumentIdWithAnEncodedSlashIsClosed4400InsteadOfLookingLikeAPassMismatch()
  {
    var ticket = fixture.Sign(
        "{\"user\":\"u1\",\"doc\":\"a/b\",\"write\":true,\"exp\":4102444800}");
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectWithTicketAsync(ticket, doc: "a/b");

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal(
        (4400, "document ids must be a single path segment"),
        await client.ReceiveCloseAsync());
  }

  [Fact]
  public async Task AReadOnlyTicketJoinsButItsWritesAreDropped()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var reader = await app.ConnectWithTicketAsync(fixture.ReadOnly);
    await using var writer = await app.ConnectWithTicketAsync(fixture.Compatible);
    AssertFreshTag((await reader.ReceiveAsync<BlokControlFrame>()).Tag);
    AssertFreshTag((await writer.ReceiveAsync<BlokControlFrame>()).Tag);
    var readerDoc = await SyncedAsync(reader);

    await reader.SendAsync(new SyncUpdateFrame(YDocs.UpdateAppending(readerDoc, " stolen")));
    // The reader's own frames are handled in order, so this answer proves the
    // update above was already dropped.
    Assert.Equal("seeded", await SyncedTextAsync(reader));

    var writerDoc = await SyncedAsync(writer);
    var update = YDocs.UpdateAppending(writerDoc, " ok");
    await writer.SendAsync(new SyncUpdateFrame(update));
    var relayed = await reader.ReceiveAsync<SyncUpdateFrame>();

    Assert.Equal(update, relayed.Update);
    Assert.Equal("seeded ok", await SyncedTextAsync(writer));
  }

  [Theory]
  [InlineData(DisallowedOrigin)]
  [InlineData(null)]
  public async Task TicketModeRequiresAnAllowedOriginOnTheUpgrade(string? origin)
  {
    await using var app = await SyncApp.StartAsync("ticket");

    await app.AssertRefusedAsync(
        HttpStatusCode.Forbidden,
        protocols: [SyncApp.Protocol, fixture.Compatible],
        origin: origin);
  }

  [Theory]
  [InlineData("none")]
  [InlineData("proxy")]
  public async Task StockClientsJoinWithoutASubprotocolAndNeverSeeTheControlFrame(string auth)
  {
    await using var app = await SyncApp.StartAsync(auth);
    await using var client = await app.ConnectAsync(origin: null);

    Assert.Null(client.SubProtocol);
    var doc = YDocs.NewClient();
    await client.SendAsync(new SyncStep1Frame(YDocs.StateVector(doc)));
    var first = await client.ReceiveAsync();
    var step2 = Assert.IsType<SyncStep2Frame>(first);
    YDocs.Apply(doc, step2.Update);
    Assert.Equal("seeded", YDocs.Text(doc));
    await client.ReceiveAsync<SyncStep1Frame>();
  }

  [Fact]
  public async Task NoAuthModeEchoesTheProtocolWhenOfferedAndSendsTheControlFrame()
  {
    await using var app = await SyncApp.StartAsync();
    await using var client = await app.ConnectAsync(protocols: [SyncApp.Protocol]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    AssertFreshTag((await client.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Fact]
  public async Task NoAuthModeRejectsAPresentDisallowedOrigin()
  {
    await using var app = await SyncApp.StartAsync();

    await app.AssertRefusedAsync(HttpStatusCode.Forbidden, origin: DisallowedOrigin);
    await using var allowed = await app.ConnectAsync();
    Assert.Null(allowed.SubProtocol);
  }

  [Fact]
  public async Task RefusesWithAMessageNamingUseWebSocketsWhenTheMiddlewareIsMissing()
  {
    await using var app = await SyncApp.StartAsync();
    using var client = app.CreateClient();
    using var request = new HttpRequestMessage(HttpMethod.Get, $"/sync/{SyncApp.Doc}");
    request.Headers.TryAddWithoutValidation("Connection", "Upgrade");
    request.Headers.TryAddWithoutValidation("Upgrade", "websocket");
    request.Headers.TryAddWithoutValidation("Sec-WebSocket-Version", "13");
    request.Headers.TryAddWithoutValidation("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==");

    using var response = await client.SendAsync(request);

    Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Contains(
        "app.UseWebSockets()",
        await response.Content.ReadAsStringAsync(),
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task ARejectedHandshakeSpendsTheRateLimitOnItsAddressSoAuthFailuresCannotFlood()
  {
    await using var app = await SyncApp.StartAsync(
        "ticket",
        options => options.RateLimitPerMinute = 1);

    await using (var rejected = await app.ConnectWithTicketAsync(fixture.Expired))
    {
      Assert.Equal((4401, "invalid pass"), await rejected.ReceiveCloseAsync());
    }

    // The address has spent its window on the rejection: the next one never
    // gets a socket at all.
    await app.AssertRefusedAsync(
        HttpStatusCode.TooManyRequests,
        protocols: [SyncApp.Protocol, fixture.Expired]);
  }

  [Fact]
  public async Task RejectionsDoNotSpendTheWindowOfAValidPassHolder()
  {
    await using var app = await SyncApp.StartAsync(
        "ticket",
        options => options.RateLimitPerMinute = 1);

    await using (var rejected = await app.ConnectWithTicketAsync(fixture.Expired))
    {
      Assert.Equal((4401, "invalid pass"), await rejected.ReceiveCloseAsync());
    }

    // Rejections key on the address, an accepted handshake on its user.
    await using var accepted = await app.ConnectWithTicketAsync(fixture.Compatible);
    AssertFreshTag((await accepted.ReceiveAsync<BlokControlFrame>()).Tag);

    await app.AssertRefusedAsync(
        HttpStatusCode.TooManyRequests,
        protocols: [SyncApp.Protocol, fixture.Compatible]);

    await using var otherUser = await app.ConnectWithTicketAsync(fixture.UserTwo);
    AssertFreshTag((await otherUser.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Fact]
  public async Task ASpentWindowIsRefusedBeforeTheApplicationAuthorizationHookRuns()
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        "ticket",
        options => options.RateLimitPerMinute = 1,
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    await using var accepted = await app.ConnectWithTicketAsync(fixture.Compatible);
    AssertFreshTag((await accepted.ReceiveAsync<BlokControlFrame>()).Tag);
    var callsAfterTheFirstJoin = authorization.Calls.Count;

    // The limiter exists to bound the hook's cost, so a spent window must
    // never reach it.
    await app.AssertRefusedAsync(
        HttpStatusCode.TooManyRequests,
        protocols: [SyncApp.Protocol, fixture.Compatible]);

    Assert.Equal(callsAfterTheFirstJoin, authorization.Calls.Count);
  }

  [Fact]
  public async Task ARejectedHandshakeIsTornDownWithoutWaitingOutAPeerThatNeverAnswers()
  {
    var served = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    await using var app = await SyncApp.StartAsync(
        "ticket",
        configureApp: application => application.Use(async (context, next) =>
        {
          try
          {
            await next(context);
          }
          finally
          {
            served.TrySetResult();
          }
        }));
    await using var client = await app.ConnectWithTicketAsync(fixture.Expired);

    // The browser still reads the code, and the socket is not held open for
    // the answer a rejected client has no reason to send.
    Assert.Equal((4401, "invalid pass"), await client.ReceiveCloseAsync(answer: false));
    await served.Task.WaitAsync(TimeSpan.FromSeconds(3), Deadline.Token());
  }

  [Fact]
  public async Task ApplicationAuthorizationDeniedReadIsClosed4403()
  {
    var authorization = new RecordingAuthorization { AllowRead = false };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var client = await app.ConnectWithTicketAsync(fixture.Compatible);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal((4403, "forbidden"), await client.ReceiveCloseAsync());
    Assert.Contains(("read", "u1", SyncApp.Doc), authorization.Calls);
  }

  [Fact]
  public async Task ApplicationAuthorizationDeniedWriteMakesAWriteTicketReadOnly()
  {
    var authorization = new RecordingAuthorization { AllowWrite = false };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var client = await app.ConnectWithTicketAsync(fixture.Compatible);
    AssertFreshTag((await client.ReceiveAsync<BlokControlFrame>()).Tag);
    var doc = await SyncedAsync(client);

    await client.SendAsync(new SyncUpdateFrame(YDocs.UpdateAppending(doc, " stolen")));

    Assert.Equal("seeded", await SyncedTextAsync(client));
    Assert.Contains(("write", "u1", SyncApp.Doc), authorization.Calls);
  }

  [Fact]
  public async Task TheAuthorizationHookSeesTheTicketsUserDocumentAndWriteClaims()
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var writer = await app.ConnectWithTicketAsync(fixture.Compatible);
    AssertFreshTag((await writer.ReceiveAsync<BlokControlFrame>()).Tag);

    var principal = authorization.Principals[0];
    Assert.True(principal.Identity?.IsAuthenticated);
    Assert.Equal("u1", principal.FindFirstValue(ClaimTypes.NameIdentifier));
    Assert.Equal(SyncApp.Doc, principal.FindFirstValue("blok:doc"));
    Assert.Equal("true", principal.FindFirstValue("blok:write"));

    await using var reader = await app.ConnectWithTicketAsync(fixture.ReadOnly);
    AssertFreshTag((await reader.ReceiveAsync<BlokControlFrame>()).Tag);

    Assert.Equal("false", authorization.Principals[^1].FindFirstValue("blok:write"));
  }

  [Fact]
  public async Task RequireAuthorizationOnTheGroupProtectsTheSyncRouteAndTheSignedInUserIsThePrincipal()
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        configure: options => options.CollabMaxConnectionsPerUserPerDoc = 1,
        services: services =>
        {
          services
              .AddAuthentication(HeaderAuthenticationHandler.SchemeName)
              .AddScheme<AuthenticationSchemeOptions, HeaderAuthenticationHandler>(
                  HeaderAuthenticationHandler.SchemeName,
                  _ => { });
          services.AddAuthorization();
          services.AddSingleton<IBlokAuthorization>(authorization);
        },
        configureApp: app =>
        {
          app.UseAuthentication();
          app.UseAuthorization();
        },
        pattern: "/blok",
        requireAuthorization: true);

    await app.AssertRefusedAsync(HttpStatusCode.Unauthorized);

    await using var alice = await app.ConnectAsync(configure: SignedInAs("alice"));
    Assert.Equal("seeded", await SyncedTextAsync(alice));
    Assert.Contains(("read", "alice", SyncApp.Doc), authorization.Calls);
    Assert.Contains(("write", "alice", SyncApp.Doc), authorization.Calls);

    // The cap keys on the signed-in identity, not on the shared address.
    await app.AssertRefusedAsync(HttpStatusCode.TooManyRequests, configure: SignedInAs("alice"));
    await using var bob = await app.ConnectAsync(configure: SignedInAs("bob"));
    Assert.Equal("seeded", await SyncedTextAsync(bob));
  }

  // --- Actor attribution (Task 3.1) --------------------------------------
  //
  // The journal actor is a handshake-level derivation, so these call
  // SyncHandshake.NegotiateAsync directly against a bare HttpContext rather
  // than opening a real socket: nothing downstream of the handshake
  // consumes it yet, and the derivation must be provable independently of
  // whatever else the pipeline happens to guard.

  [Fact]
  public async Task TicketUserBecomesJournalActor()
  {
    var handshake = NewHandshake(TicketOptions());
    var context = NewWebSocketContext(protocols: [SyncApp.Protocol, fixture.Compatible]);

    var accepted = Assert.IsType<SyncAccepted>(await handshake.NegotiateAsync(context, SyncApp.Doc));

    Assert.Equal("u1", accepted.ActorId);
    Assert.Equal(CollabOperationSource.ClientV1, accepted.ProtocolSource);
  }

  [Fact]
  public async Task ApplicationNameIdentifierBecomesJournalActor()
  {
    var handshake = NewHandshake(new BlokServerOptions { Auth = "none" });
    var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "alice")], "test");
    var context = NewWebSocketContext(origin: null, user: new ClaimsPrincipal(identity));

    var accepted = Assert.IsType<SyncAccepted>(await handshake.NegotiateAsync(context, SyncApp.Doc));

    Assert.Equal("alice", accepted.ActorId);
  }

  // A verified ticket never names an empty user in practice — SyncClose.UserlessPass
  // rejects it before a SyncAccepted can exist. This pins the derivation itself, so
  // that gate is not the only thing standing between an empty claim and a fabricated
  // actor.
  [Fact]
  public void TicketWithoutAUserClaimHasNullJournalActor()
  {
    var claims = new TicketClaims(User: "", Document: SyncApp.Doc, Write: true, Exp: 0);

    Assert.Null(SyncHandshake.DeriveActor(claims.User, TicketPrincipal.For(claims)));
  }

  [Fact]
  public async Task NoAuthConnectionHasNullJournalActor()
  {
    var handshake = NewHandshake(new BlokServerOptions { Auth = "none" });
    var context = NewWebSocketContext(origin: null);

    var accepted = Assert.IsType<SyncAccepted>(await handshake.NegotiateAsync(context, SyncApp.Doc));

    Assert.Null(accepted.ActorId);
    Assert.Null(accepted.Principal);
  }

  // In ticket mode Admit sets rateLimitKey = principal, so this is the one mode
  // where Principal and the door's rate-limit key are the same string; the
  // relational assertion below is what makes this about Principal rather than
  // an incidental prefix difference.
  [Fact]
  public async Task TheRateLimitKeyIsNeverTheJournalActor()
  {
    var handshake = NewHandshake(TicketOptions());
    var context = NewWebSocketContext(protocols: [SyncApp.Protocol, fixture.Compatible]);

    var accepted = Assert.IsType<SyncAccepted>(await handshake.NegotiateAsync(context, SyncApp.Doc));

    Assert.Equal("user:u1", accepted.Principal);
    Assert.Equal("u1", accepted.ActorId);
    Assert.NotEqual(accepted.Principal, accepted.ActorId);
  }

  // DeriveActor checks NameIdentifier before Name on purpose (see the comment on
  // DeriveActor) — the opposite of SignedInPrincipal two methods below. No other
  // test can tell the two orders apart, since none gives a principal both claims
  // with different values.
  [Fact]
  public void NameIdentifierWinsOverNameWhenAPrincipalCarriesBoth()
  {
    var identity = new ClaimsIdentity(
        [
          new Claim(ClaimTypes.NameIdentifier, "stable-id"),
          new Claim(ClaimTypes.Name, "Display Name"),
        ],
        "test");

    Assert.Equal("stable-id", SyncHandshake.DeriveActor("", new ClaimsPrincipal(identity)));
  }

  private BlokServerOptions TicketOptions()
  {
    return new BlokServerOptions
    {
      Auth = "ticket",
      Secret = fixture.Secret,
      AllowedOrigins = [SyncApp.AllowedOrigin],
    };
  }

  private static SyncHandshake NewHandshake(BlokServerOptions options)
  {
    return new SyncHandshake(options, new FixedWindowRateLimiter(options, TimeProvider.System), TimeProvider.System);
  }

  /// <summary>
  /// A bare HttpContext good enough for SyncHandshake.NegotiateAsync alone —
  /// no TestServer, no socket. RequestServices is an empty container, which
  /// is what an unregistered IBlokAuthorization/ICollabOperationStore looks
  /// like via GetService.
  /// </summary>
  private static DefaultHttpContext NewWebSocketContext(
      IEnumerable<string>? protocols = null,
      string? origin = SyncApp.AllowedOrigin,
      ClaimsPrincipal? user = null)
  {
    var context = new DefaultHttpContext
    {
      RequestServices = new ServiceCollection().BuildServiceProvider(),
      User = user ?? new ClaimsPrincipal(new ClaimsIdentity()),
    };
    context.Features.Set<IHttpWebSocketFeature>(new FakeWebSocketFeature());
    context.Connection.RemoteIpAddress = IPAddress.Loopback;

    if (protocols is not null)
    {
      context.Request.Headers.SecWebSocketProtocol = string.Join(", ", protocols);
    }

    if (origin is not null)
    {
      context.Request.Headers.Origin = origin;
    }

    return context;
  }

  private sealed class FakeWebSocketFeature : IHttpWebSocketFeature
  {
    public bool IsWebSocketRequest => true;

    public Task<WebSocket> AcceptAsync(WebSocketAcceptContext context)
    {
      throw new NotSupportedException("handshake tests never accept the socket");
    }
  }

  private static Action<Microsoft.AspNetCore.Http.HttpRequest> SignedInAs(string user)
  {
    return request => request.Headers[HeaderAuthenticationHandler.Header] = user;
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

  private string Ticket(string name)
  {
    return name switch
    {
      "expired" => fixture.Expired,
      "tampered" => fixture.Tampered,
      "noncanonicalHeaderTicket" => fixture.NoncanonicalHeaderTicket,
      "malformed" => fixture.Malformed,
      _ => throw new ArgumentOutOfRangeException(nameof(name), name, null),
    };
  }

  /// <summary>
  /// A never-reset doc: schema v2 at epoch 0, under a lineage the room minted
  /// at the seed. The lineage is 16 random bytes, so it is asserted by shape.
  /// </summary>
  private static void AssertFreshTag(CollabWorkingSetTag tag)
  {
    Assert.Equal(CollabWorkingSetTag.SchemaV2, tag.Format);
    Assert.Equal(0, tag.Epoch);
    Assert.Matches("^[0-9a-f]{32}$", tag.Lineage);
  }
}
