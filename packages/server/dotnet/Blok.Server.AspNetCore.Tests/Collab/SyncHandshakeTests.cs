using System.Net;
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
  private static readonly CollabWorkingSetTag FreshTag = new(CollabWorkingSetTag.SchemaV2, 0);
  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task ACompatibleTicketJoinsWithTheProtocolEchoedAndTheEpochFrameFirst()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectWithTicketAsync(fixture.Compatible);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    var control = await client.ReceiveAsync<BlokControlFrame>();
    Assert.Equal(FreshTag, control.Tag);
    Assert.Equal("seeded", await SyncedTextAsync(client));
  }

  [Fact]
  public async Task AcceptsTheOfferAsOneCommaJoinedHeaderValue()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(
        protocols: [$"{SyncApp.Protocol}, {fixture.Compatible}"]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal(FreshTag, (await client.ReceiveAsync<BlokControlFrame>()).Tag);
  }

  [Fact]
  public async Task AcceptsTheTicketBeforeTheProtocolInTheOffer()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var client = await app.ConnectAsync(
        protocols: [fixture.Compatible, SyncApp.Protocol]);

    Assert.Equal(SyncApp.Protocol, client.SubProtocol);
    Assert.Equal(FreshTag, (await client.ReceiveAsync<BlokControlFrame>()).Tag);
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
  public async Task AReadOnlyTicketJoinsButItsWritesAreDropped()
  {
    await using var app = await SyncApp.StartAsync("ticket");
    await using var reader = await app.ConnectWithTicketAsync(fixture.ReadOnly);
    await using var writer = await app.ConnectWithTicketAsync(fixture.Compatible);
    Assert.Equal(FreshTag, (await reader.ReceiveAsync<BlokControlFrame>()).Tag);
    Assert.Equal(FreshTag, (await writer.ReceiveAsync<BlokControlFrame>()).Tag);
    using var readerDoc = await SyncedAsync(reader);

    await reader.SendAsync(new SyncUpdateFrame(YDocs.UpdateAppending(readerDoc, " stolen")));
    // The reader's own frames are handled in order, so this answer proves the
    // update above was already dropped.
    Assert.Equal("seeded", await SyncedTextAsync(reader));

    using var writerDoc = await SyncedAsync(writer);
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
    using var doc = YDocs.NewClient();
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
    Assert.Equal(FreshTag, (await client.ReceiveAsync<BlokControlFrame>()).Tag);
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
  public async Task TheHandshakeSpendsTheRateLimitOnlyWhenAccepted()
  {
    await using var app = await SyncApp.StartAsync(
        "ticket",
        options => options.RateLimitPerMinute = 1);

    for (var index = 0; index < 2; index++)
    {
      await using var rejected = await app.ConnectWithTicketAsync(fixture.Expired);
      Assert.Equal((4401, "invalid pass"), await rejected.ReceiveCloseAsync());
    }

    await using var accepted = await app.ConnectWithTicketAsync(fixture.Compatible);
    Assert.Equal(FreshTag, (await accepted.ReceiveAsync<BlokControlFrame>()).Tag);

    await app.AssertRefusedAsync(
        HttpStatusCode.TooManyRequests,
        protocols: [SyncApp.Protocol, fixture.Compatible]);

    await using var otherUser = await app.ConnectWithTicketAsync(fixture.UserTwo);
    Assert.Equal(FreshTag, (await otherUser.ReceiveAsync<BlokControlFrame>()).Tag);
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
    Assert.Contains(("read", "", SyncApp.Doc), authorization.Calls);
  }

  [Fact]
  public async Task ApplicationAuthorizationDeniedWriteMakesAWriteTicketReadOnly()
  {
    var authorization = new RecordingAuthorization { AllowWrite = false };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));
    await using var client = await app.ConnectWithTicketAsync(fixture.Compatible);
    Assert.Equal(FreshTag, (await client.ReceiveAsync<BlokControlFrame>()).Tag);
    using var doc = await SyncedAsync(client);

    await client.SendAsync(new SyncUpdateFrame(YDocs.UpdateAppending(doc, " stolen")));

    Assert.Equal("seeded", await SyncedTextAsync(client));
    Assert.Contains(("write", "", SyncApp.Doc), authorization.Calls);
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

  private static async Task<YDotNet.Document.Doc> SyncedAsync(SyncClient client)
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
    using var doc = await SyncedAsync(client);

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
}
