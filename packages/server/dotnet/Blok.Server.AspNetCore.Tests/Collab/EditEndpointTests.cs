using System.Net;
using System.Text;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// POST /sync/{doc}/edit: block-level edits from a consumer backend that is
/// not a WebSocket peer. Same door as the reset endpoint, and the same
/// refusals; what is new is that an accepted edit reaches the live members.
/// </summary>
public sealed class EditEndpointTests
{
  private const string AppendOne =
      """{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "z": "ignored", "text": "!" } } } ] }""";
  private const string AppendOneReordered =
      """{"ops":[{"block":{"data":{"text":"!","z":"ignored"},"type":"p"},"id":"new","op":"insert"}]}""";
  private const string IdempotencyKey = "edit-key";

  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task EditRequiresAnIdempotencyKey()
  {
    await using var app = await SyncApp.StartAsync();

    foreach (var key in new[] { null, "", "badkey", new string('a', 129) })
    {
      using var response = await Edit(app, doc: Guid.NewGuid().ToString("N"), key: key);
      Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    using var multiple = await Edit(
        app,
        doc: "key-multiple",
        key: "first",
        configure: request => request.Headers.TryAddWithoutValidation(
            "Blok-Idempotency-Key",
            "second"));
    Assert.Equal(HttpStatusCode.BadRequest, multiple.StatusCode);

    using var accepted = await Edit(app, doc: "key-boundary", key: new string('~', 128));
    Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
  }

  [Fact]
  public async Task EditReturnsOnlyAfterDurableCommit()
  {
    var operations = new FakeCollabOperationStore();
    var enteredAppend = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var releaseAppend = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    operations.BeforeAppend = () =>
    {
      enteredAppend.TrySetResult();

      return releaseAppend.Task;
    };
    await using var app = await StartWithOperationStore(operations);
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    await open.ReceiveAsync<BlokControlFrame>();
    var mirror = YDocs.NewClient();
    await open.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await open.ReceiveAsync<SyncStep2Frame>()).Update);
    await open.ReceiveAsync<SyncStep1Frame>();

    var pending = Edit(app, key: "durable-edit");
    var first = await Task.WhenAny(pending, enteredAppend.Task);

    Assert.Same(enteredAppend.Task, first);
    Assert.False(pending.IsCompleted);
    Assert.Empty(operations.Committed(SyncApp.Doc));
    var relay = open.ReceiveAsync<SyncUpdateFrame>();
    Assert.False(relay.IsCompleted);

    releaseAppend.SetResult();
    using var response = await pending;

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    YDocs.Apply(mirror, (await relay).Update);
    Assert.Equal("seeded!", YDocs.Text(mirror));
    var record = Assert.Single(operations.Committed(SyncApp.Doc));
    Assert.Equal(CollabOperationSource.HttpEdit, record.Source);
    Assert.Matches("^[0-9a-f]{32}$", record.OperationId);
    Assert.NotEqual("durable-edit", record.OperationId);
    Assert.Equal("1", Assert.Single(response.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal(
        Assert.IsType<CollabDocumentHead>(operations.Head(SyncApp.Doc)).Lineage,
        Assert.Single(response.Headers.GetValues("Blok-Doc-Lineage")));
  }

  [Fact]
  public async Task EditJournalsABatchAsOneOperation()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);

    using var response = await Edit(
        app,
        key: "batched-edit",
        body: """{ "ops": [ { "op": "insert", "id": "first", "block": { "type": "p", "data": { "text": "!" } } }, { "op": "insert", "id": "second", "block": { "type": "p", "data": { "text": "?" } } } ] }""");

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    Assert.Single(operations.Committed(SyncApp.Doc));
  }

  [Fact]
  public async Task EditRetryWithSameKeyAppliesOnce()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);

    using var first = await Edit(app, key: "same-edit", body: AppendOne);
    using var retry = await Edit(app, key: "same-edit", body: AppendOneReordered);

    Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
    Assert.Equal(HttpStatusCode.NoContent, retry.StatusCode);
    Assert.Equal(1, app.Fakes.Converter.ApplyOpsCalls);
    Assert.Single(operations.Committed(SyncApp.Doc));
    Assert.Equal(
        Assert.Single(first.Headers.GetValues("Blok-Doc-Sequence")),
        Assert.Single(retry.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal(
        Assert.Single(first.Headers.GetValues("Blok-Doc-Lineage")),
        Assert.Single(retry.Headers.GetValues("Blok-Doc-Lineage")));
  }

  [Fact]
  public async Task SameEditKeyWithDifferentBodyReturns409()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);

    using var first = await Edit(app, key: "reused-edit-key");
    using var conflict = await Edit(
        app,
        key: "reused-edit-key",
        body: """{ "ops": [ { "op": "remove", "id": "new" } ] }""");

    Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
    Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
    Assert.Equal(1, app.Fakes.Converter.ApplyOpsCalls);
    Assert.Single(operations.Committed(SyncApp.Doc));
  }

  [Fact]
  public async Task EditJournalActorComesFromThePrincipal()
  {
    var ticketOperations = new FakeCollabOperationStore();
    await using (var ticketApp = await StartWithOperationStore(
        ticketOperations,
        auth: "ticket"))
    {
      using var response = await Edit(ticketApp, ticket: fixture.Compatible, key: "ticket-actor");
      Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
      Assert.Equal("u1", Assert.Single(ticketOperations.Committed(SyncApp.Doc)).ActorId);
    }

    var principalOperations = new FakeCollabOperationStore();
    await using var principalApp = await StartWithOperationStore(
        principalOperations,
        services: services =>
        {
          services
              .AddAuthentication(HeaderAuthenticationHandler.SchemeName)
              .AddScheme<AuthenticationSchemeOptions, HeaderAuthenticationHandler>(
                  HeaderAuthenticationHandler.SchemeName,
                  _ => { });
          services.AddAuthorization();
        },
        configureApp: app =>
        {
          app.UseAuthentication();
          app.UseAuthorization();
        },
        requireAuthorization: true);

    using var principalResponse = await Edit(
        principalApp,
        key: "principal-actor",
        configure: request => request.Headers.TryAddWithoutValidation(
            HeaderAuthenticationHandler.Header,
            "stable-user"));
    Assert.Equal(HttpStatusCode.NoContent, principalResponse.StatusCode);
    Assert.Equal(
        "stable-user",
        Assert.Single(principalOperations.Committed(SyncApp.Doc)).ActorId);
  }

  [Fact]
  public async Task EditAnswersServiceUnavailableWhenDocumentOpenElsewhere()
  {
    var operations = new FakeCollabOperationStore { DocumentOpenElsewhere = true };
    await using var app = await StartWithOperationStore(operations);

    using var response = await Edit(app);

    await AssertError(response, HttpStatusCode.ServiceUnavailable, "the document is unavailable, retry\n");
  }

  [Fact]
  public async Task AnEditLandsOnEveryOpenSocketAndInTheDocument()
  {
    await using var app = await SyncApp.StartAsync();
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);

    await open.ReceiveAsync<BlokControlFrame>();

    // Synced first: an update is a DIFF, so a document that never received
    // the room's state cannot render one.
    var mirror = YDocs.NewClient();

    await open.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await open.ReceiveAsync<SyncStep2Frame>()).Update);
    await open.ReceiveAsync<SyncStep1Frame>();
    Assert.Equal("seeded", YDocs.Text(mirror));

    using var response = await Edit(app);

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

    // The room's own update observer is the whole relay: an edit written
    // inside the lane broadcasts exactly like a member's write.
    YDocs.Apply(mirror, (await open.ReceiveAsync<SyncUpdateFrame>()).Update);

    Assert.Equal("seeded!", YDocs.Text(mirror));
  }

  [Fact]
  public async Task EditWorksWithoutALiveRoom()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Edit(app, doc: "never-opened");

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
  }

  [Fact]
  public async Task InTicketModeTheTicketMustBeAWritePassForThisDocument()
  {
    await using var app = await SyncApp.StartAsync("ticket");

    using var missing = await Edit(app);
    await AssertError(missing, HttpStatusCode.Unauthorized, "missing pass\n");

    using var readOnly = await Edit(app, ticket: fixture.ReadOnly);
    await AssertError(readOnly, HttpStatusCode.Forbidden, "write access required\n");

    using var otherDocument = await Edit(app, ticket: fixture.DocMismatch);
    await AssertError(
        otherDocument,
        HttpStatusCode.Forbidden,
        "pass is for another document\n");

    using var accepted = await Edit(app, ticket: fixture.Compatible);
    Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
  }

  [Fact]
  public async Task EditConsultsApplicationAuthorizationForWrite()
  {
    var authorization = new RecordingAuthorization { AllowWrite = false };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    using var denied = await Edit(app, ticket: fixture.Compatible);

    await AssertError(denied, HttpStatusCode.Forbidden, "forbidden\n");
    Assert.Contains(("write", "u1", SyncApp.Doc), authorization.Calls);

    authorization.AllowWrite = true;
    using var allowed = await Edit(app, ticket: fixture.Compatible);
    Assert.Equal(HttpStatusCode.NoContent, allowed.StatusCode);
  }

  [Fact]
  public async Task ADocumentIdWithAnEncodedSlashIsRefusedWithASingleSegmentReason()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Edit(app, doc: "a/b");

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "document ids must be a single path segment\n");
  }

  [Theory]
  [InlineData("not json at all")]
  [InlineData("""{ "ops": [] }""")]
  [InlineData("""{ "ops": [ { "op": "fly", "id": "x" } ] }""")]
  [InlineData("""{ "ops": [ { "op": "remove" } ] }""")]
  public async Task AMalformedRequestIsRefusedBeforeTheRoomIsTouched(string body)
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Edit(app, body: body);

    Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    Assert.StartsWith(
        "collab:",
        await response.Content.ReadAsStringAsync(),
        StringComparison.Ordinal);
  }

  /// <summary>
  /// The request parser refuses a NUL before it can reach a document. Escaped
  /// in the JSON rather than written raw: a raw NUL is not valid inside a JSON
  /// string, so the reader would refuse it before the NUL screen ever ran.
  /// </summary>
  [Fact]
  public async Task ANulInTheRequestIsRefused()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Edit(
        app,
        body: """{ "ops": [ { "op": "remove", "id": "a\u0000b" } ] }""");

    Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    Assert.Contains(
        "NUL",
        await response.Content.ReadAsStringAsync(),
        StringComparison.Ordinal);
  }

  /// <summary>
  /// A caller able to POST an unbounded document could grow it past what any
  /// client can ever receive, locking everyone out of the room they filled.
  /// </summary>
  [Fact]
  public async Task ABodyOverTheMessageCeilingIsRefusedWithoutReadingItAll()
  {
    await using var app = await SyncApp.StartAsync(
        configure: options => options.CollabMaxMessageBytes = 512);

    var text = new string('x', 4096);
    using var response = await Edit(
        app,
        body: $$"""{ "ops": [ { "op": "insert", "id": "big", "block": { "type": "p", "data": { "text": "{{text}}" } } } ] }""");

    Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    Assert.Contains(
        "at most 512 bytes",
        await response.Content.ReadAsStringAsync(),
        StringComparison.Ordinal);
  }

  [Fact]
  public async Task ADocumentThatCannotBeSeededAnswersServiceUnavailable()
  {
    await using var app = await SyncApp.StartAsync();

    app.Fakes.Endpoint.LoadFailure = new HttpRequestException("the records are down");

    using var response = await Edit(app, doc: "cannot-load");

    await AssertError(
        response,
        HttpStatusCode.ServiceUnavailable,
        "the document could not be loaded\n");
  }

  [Fact]
  public async Task EditAnswersTheSharedWriteRouteWireForOtherMethods()
  {
    await using var app = await SyncApp.StartAsync();
    using var client = app.CreateClient();
    using var wrongMethod = await client.GetAsync($"/sync/{SyncApp.Doc}/edit");

    Assert.Equal(HttpStatusCode.MethodNotAllowed, wrongMethod.StatusCode);
    Assert.Equal("OPTIONS, POST", string.Join(", ", wrongMethod.Content.Headers.Allow));
  }

  private static async Task<HttpResponseMessage> Edit(
      SyncApp app,
      string doc = SyncApp.Doc,
      string? ticket = null,
      string body = AppendOne,
      string? key = IdempotencyKey,
      Action<HttpRequestMessage>? configure = null)
  {
    using var request = new HttpRequestMessage(
        HttpMethod.Post,
        $"/sync/{Uri.EscapeDataString(doc)}/edit")
    {
      Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);

    if (ticket is not null)
    {
      request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {ticket}");
    }

    if (key is not null)
    {
      request.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", key);
    }

    configure?.Invoke(request);

    return await app.CreateClient().SendAsync(request);
  }

  private static Task<SyncApp> StartWithOperationStore(
      FakeCollabOperationStore operations,
      string auth = "none",
      Action<IServiceCollection>? services = null,
      Action<WebApplication>? configureApp = null,
      bool requireAuthorization = false)
  {
    return SyncApp.StartAsync(
        auth,
        services: collection =>
        {
          collection.AddSingleton<ICollabOperationStore>(operations);
          services?.Invoke(collection);
        },
        configureApp: configureApp,
        requireAuthorization: requireAuthorization,
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
}
