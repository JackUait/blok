using System.Net;
using Blok.Server.Collab;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>POST /sync/{doc}/reset: the operator lever behind plan decision 5.</summary>
public sealed class ResetEndpointTests
{
  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task ResetBumpsTheEpochClosesOpenSocketsAndTheNextJoinReseeds()
  {
    await using var app = await SyncApp.StartAsync();
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    Assert.Equal(0, (await open.ReceiveAsync<BlokControlFrame>()).Tag.Epoch);

    using var response = await Reset(app);

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    Assert.Equal("", await response.Content.ReadAsStringAsync());
    Assert.Equal((4409, "document reset"), await open.ReceiveCloseAsync());
    Assert.Equal(
        new CollabWorkingSetTag(CollabWorkingSetTag.SchemaV2, 1),
        app.Fakes.Store.Stored(SyncApp.Doc).Tag);

    await using var fresh = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    Assert.Equal(1, (await fresh.ReceiveAsync<BlokControlFrame>()).Tag.Epoch);
  }

  [Fact]
  public async Task ResetWorksWithoutALiveRoom()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Reset(app, doc: "never-opened");

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    Assert.Equal(
        new CollabWorkingSetTag(CollabWorkingSetTag.SchemaV2, 1),
        app.Fakes.Store.Stored("never-opened").Tag);
  }

  [Fact]
  public async Task InTicketModeTheTicketMustBeAWritePassForThisDocument()
  {
    await using var app = await SyncApp.StartAsync("ticket");

    using var missing = await Reset(app);
    await AssertError(missing, HttpStatusCode.Unauthorized, "missing pass\n");

    using var readOnly = await Reset(app, ticket: fixture.ReadOnly);
    await AssertError(readOnly, HttpStatusCode.Forbidden, "write access required\n");

    using var otherDocument = await Reset(app, ticket: fixture.DocMismatch);
    await AssertError(
        otherDocument,
        HttpStatusCode.Forbidden,
        "pass is for another document\n");

    using var accepted = await Reset(app, ticket: fixture.Compatible);
    Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
  }

  [Fact]
  public async Task ResetConsultsApplicationAuthorizationForWrite()
  {
    var authorization = new RecordingAuthorization { AllowWrite = false };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    using var denied = await Reset(app, ticket: fixture.Compatible);

    await AssertError(denied, HttpStatusCode.Forbidden, "forbidden\n");
    Assert.Contains(("write", "u1", SyncApp.Doc), authorization.Calls);

    authorization.AllowWrite = true;
    using var allowed = await Reset(app, ticket: fixture.Compatible);
    Assert.Equal(HttpStatusCode.NoContent, allowed.StatusCode);
  }

  [Fact]
  public async Task ADocumentIdWithAnEncodedSlashIsRefusedWithASingleSegmentReason()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Reset(app, doc: "a/b");

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "document ids must be a single path segment\n");
  }

  [Fact]
  public async Task ResetAnswersTheSharedWriteRouteWireForOtherMethods()
  {
    await using var app = await SyncApp.StartAsync();
    using var client = app.CreateClient();
    using var wrongMethod = await client.GetAsync($"/sync/{SyncApp.Doc}/reset");
    using var preflightRequest = new HttpRequestMessage(
        HttpMethod.Options,
        $"/sync/{SyncApp.Doc}/reset");
    preflightRequest.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
    preflightRequest.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");
    using var preflight = await client.SendAsync(preflightRequest);

    Assert.Equal(HttpStatusCode.MethodNotAllowed, wrongMethod.StatusCode);
    Assert.Equal("OPTIONS, POST", string.Join(", ", wrongMethod.Content.Headers.Allow));
    Assert.Equal(HttpStatusCode.NoContent, preflight.StatusCode);
    Assert.Equal(
        "POST, OPTIONS",
        Assert.Single(preflight.Headers.GetValues("Access-Control-Allow-Methods")));
  }

  private static async Task<HttpResponseMessage> Reset(
      SyncApp app,
      string doc = SyncApp.Doc,
      string? ticket = null)
  {
    using var request = new HttpRequestMessage(
        HttpMethod.Post,
        $"/sync/{Uri.EscapeDataString(doc)}/reset");
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);

    if (ticket is not null)
    {
      request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {ticket}");
    }

    return await app.CreateClient().SendAsync(request);
  }

  private static async Task AssertError(
      HttpResponseMessage response,
      HttpStatusCode status,
      string body)
  {
    Assert.Equal(status, response.StatusCode);
    Assert.Equal(
        "text/plain; charset=utf-8",
        response.Content.Headers.ContentType?.ToString());
    Assert.Equal(body, await response.Content.ReadAsStringAsync());
  }
}
