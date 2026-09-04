using System.Net;
using System.Text;
using Blok.Server.Collab;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>POST /sync/{doc}/reset: the operator lever behind plan decision 5.</summary>
public sealed class ResetEndpointTests
{
  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task ResetCommitsTheCurrentEndpointDocumentAndANewLineageBeforeReturning()
  {
    var operations = new FakeCollabOperationStore();
    operations.SetHead(SyncApp.Doc, epoch: 7);
    await using var app = await StartWithOperationStore(operations);
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    var before = (await open.ReceiveAsync<BlokControlFrame>()).Tag;
    using (var editRequest = new HttpRequestMessage(
        HttpMethod.Post,
        $"/sync/{SyncApp.Doc}/edit")
    {
      Content = new StringContent(
          """{ "ops": [ { "op": "insert", "id": "before-reset", "block": { "type": "p", "data": { "text": "journal" } } } ] }""",
          Encoding.UTF8,
          "application/json"),
    })
    {
      editRequest.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
      editRequest.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", "before-reset");
      using var edited = await app.CreateClient().SendAsync(editRequest);
      Assert.Equal(HttpStatusCode.NoContent, edited.StatusCode);
    }

    Assert.Single(operations.Committed(SyncApp.Doc));
    app.Fakes.Endpoint.Holds(SyncApp.Doc, "endpoint reset");
    var enteredReset = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var releaseReset = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeReset = () =>
    {
      enteredReset.TrySetResult();

      return releaseReset.Task;
    };

    var pending = Reset(app);
    var first = await Task.WhenAny(pending, enteredReset.Task);

    Assert.Same(enteredReset.Task, first);
    Assert.False(pending.IsCompleted);
    Assert.Equal(before.Lineage, Assert.IsType<CollabDocumentHead>(operations.Head(SyncApp.Doc)).Lineage);
    var close = open.ReceiveCloseAsync();
    Assert.False(close.IsCompleted);

    releaseReset.SetResult();
    using var response = await pending;

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    var after = Assert.IsType<CollabDocumentHead>(operations.Head(SyncApp.Doc));
    Assert.Equal(before.Epoch + 1, after.Epoch);
    Assert.NotEqual(before.Lineage, after.Lineage);
    Assert.Equal(0ul, after.DurableThrough);
    Assert.Equal((4409, "document reset"), await close);

    await using var fresh = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    var reopened = (await fresh.ReceiveAsync<BlokControlFrame>()).Tag;
    Assert.Equal(after.Epoch, reopened.Epoch);
    Assert.Equal(after.Lineage, reopened.Lineage);
    var mirror = YDocs.NewClient();
    await fresh.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await fresh.ReceiveAsync<SyncStep2Frame>()).Update);
    await fresh.ReceiveAsync<SyncStep1Frame>();
    Assert.Equal("endpoint reset", YDocs.Text(mirror));
  }

  [Fact]
  public async Task ResetAnswersServiceUnavailableWhenDocumentOpenElsewhere()
  {
    var operations = new FakeCollabOperationStore { DocumentOpenElsewhere = true };
    await using var app = await StartWithOperationStore(operations);

    using var response = await Reset(app);

    await AssertError(response, HttpStatusCode.ServiceUnavailable, "the document is unavailable, retry\n");
  }

  [Fact]
  public async Task ResetBumpsTheEpochClosesOpenSocketsAndTheNextJoinReseeds()
  {
    await using var app = await SyncApp.StartAsync();
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    var before = (await open.ReceiveAsync<BlokControlFrame>()).Tag;
    Assert.Equal(0, before.Epoch);

    using var response = await Reset(app);

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    Assert.Equal("", await response.Content.ReadAsStringAsync());
    Assert.Equal((4409, "document reset"), await open.ReceiveCloseAsync());
    AssertResetTag(app.Fakes.Store.Stored(SyncApp.Doc).Tag);

    await using var fresh = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    var after = (await fresh.ReceiveAsync<BlokControlFrame>()).Tag;
    Assert.Equal(1, after.Epoch);

    // The point of the lineage: the re-seeded doc is a different history, and
    // a client holding updates from the old one can only tell by this.
    Assert.NotEqual(before.Lineage, after.Lineage);
  }

  [Fact]
  public async Task ResetWorksWithoutALiveRoom()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Reset(app, doc: "never-opened");

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    AssertResetTag(app.Fakes.Store.Stored("never-opened").Tag);
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

  private static Task<SyncApp> StartWithOperationStore(FakeCollabOperationStore operations)
  {
    return SyncApp.StartAsync(
        services: services => services.AddSingleton<ICollabOperationStore>(operations),
        fakes: new SyncFakes(operationStore: operations));
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

  /// <summary>Epoch 1 after one reset, under the new lineage the reset minted.</summary>
  private static void AssertResetTag(CollabWorkingSetTag tag)
  {
    Assert.Equal(CollabWorkingSetTag.SchemaV2, tag.Format);
    Assert.Equal(1, tag.Epoch);
    Assert.Matches("^[0-9a-f]{32}$", tag.Lineage);
  }
}
