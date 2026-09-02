using System.Net;
using System.Security.Claims;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
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
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(protocols: [fixture.Compatible]);

    Assert.Null(client.SubProtocol);
    Assert.Equal((4401, "blok-sync.v1 required"), await client.ReceiveCloseAsync());
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
