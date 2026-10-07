using System.Net;
using System.Text;
using Blok.Server.Collab;
using Blok.Server.Documents;
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
  public async Task AStaleIfMatchAnswers412WithTheHeadAndAppliesNothing()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    using var first = await Edit(app, key: "first-edit");
    var lineage = Assert.Single(first.Headers.GetValues("Blok-Doc-Lineage"));
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    await open.ReceiveAsync<BlokControlFrame>();
    var mirror = YDocs.NewClient();
    await open.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await open.ReceiveAsync<SyncStep2Frame>()).Update);
    await open.ReceiveAsync<SyncStep1Frame>();
    var relay = open.ReceiveAsync<SyncUpdateFrame>();

    using var stale = await Edit(
        app,
        key: "stale-edit",
        body: """{ "ops": [ { "op": "insert", "id": "stale", "block": { "type": "p", "data": { "text": "?" } } } ] }""",
        ifMatch: $"\"{lineage}:0\"");

    Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
    Assert.Equal(lineage, Assert.Single(stale.Headers.GetValues("Blok-Doc-Lineage")));
    Assert.Equal("1", Assert.Single(stale.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Single(operations.Committed(SyncApp.Doc));
    Assert.Equal(1, app.Fakes.Converter.ApplyOpsCalls);

    // The next relay is the matching edit's, so the refused one sent nothing.
    using var matching = await Edit(app, key: "matching-edit", ifMatch: $"\"{lineage}:1\"");
    Assert.Equal(HttpStatusCode.NoContent, matching.StatusCode);
    Assert.Equal("2", Assert.Single(matching.Headers.GetValues("Blok-Doc-Sequence")));
    YDocs.Apply(mirror, (await relay).Update);
    Assert.Equal("seeded!!", YDocs.Text(mirror));
  }

  [Fact]
  public async Task IfMatchIsCheckedAgainstTheHeadAColdRoomLoadsFromTheJournal()
  {
    var operations = new FakeCollabOperationStore();
    string lineage;

    await using (var firstApp = await StartWithOperationStore(operations))
    {
      using var first = await Edit(firstApp, key: "before-reload");
      lineage = Assert.Single(first.Headers.GetValues("Blok-Doc-Lineage"));
      await firstApp.Fakes.Manager.DrainAsync(CancellationToken.None);
      Assert.Equal(0, firstApp.Fakes.Manager.LiveRoomCount);
    }

    await using var app = await StartWithOperationStore(operations);
    using var stale = await Edit(app, key: "stale-after-reload", ifMatch: $"\"{lineage}:0\"");
    using var matching = await Edit(app, key: "after-reload", ifMatch: $"\"{lineage}:1\"");

    Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
    Assert.Equal("1", Assert.Single(stale.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal(HttpStatusCode.NoContent, matching.StatusCode);
    Assert.Equal(lineage, Assert.Single(matching.Headers.GetValues("Blok-Doc-Lineage")));
    Assert.Equal("2", Assert.Single(matching.Headers.GetValues("Blok-Doc-Sequence")));
  }

  [Fact]
  public async Task ACommittedKeyReplaysItsReceiptEvenWithAStaleIfMatch()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    using var first = await Edit(app, key: "replayed-edit");
    var lineage = Assert.Single(first.Headers.GetValues("Blok-Doc-Lineage"));
    using var second = await Edit(app, key: "later-edit");

    using var replay = await Edit(app, key: "replayed-edit", ifMatch: $"\"{lineage}:0\"");

    Assert.Equal(HttpStatusCode.NoContent, replay.StatusCode);
    Assert.Equal("1", Assert.Single(replay.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal(2, operations.Committed(SyncApp.Doc).Count);
  }

  [Fact]
  public async Task IfMatchWithoutAJournalAnswers428AndAppliesNothing()
  {
    await using var app = await SyncApp.StartAsync();

    using var response = await Edit(
        app,
        ifMatch: $"\"{new string('0', 32)}:0\"");

    await AssertError(
        response,
        (HttpStatusCode)428,
        "If-Match needs the operation journal, and this server keeps none\n");
    Assert.Equal(0, app.Fakes.Endpoint.Gets);
    Assert.Equal(0, app.Fakes.Converter.ApplyOpsCalls);
  }

  [Theory]
  [InlineData("*")]
  [InlineData("0123456789abcdef0123456789abcdef:1")]
  [InlineData("W/\"0123456789abcdef0123456789abcdef:1\"")]
  [InlineData("\"0123456789abcdef0123456789abcdef:1\", \"0123456789abcdef0123456789abcdef:2\"")]
  [InlineData("\"0123456789abcdef0123456789abcdef\"")]
  [InlineData("\"0123456789abcdef0123456789abcdef:\"")]
  [InlineData("\"0123456789abcdef0123456789abcdef:-1\"")]
  [InlineData("\"0123456789abcdef0123456789abcdef:01\"")]
  [InlineData("\"0123456789abcdef0123456789abcdef:1:2\"")]
  [InlineData("\"0123456789ABCDEF0123456789ABCDEF:1\"")]
  [InlineData("\"not-a-lineage:1\"")]
  [InlineData("\"\"")]
  public async Task AMalformedIfMatchAnswers400BeforeTheRoomIsTouched(string ifMatch)
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);

    using var response = await Edit(app, ifMatch: ifMatch);

    await AssertError(
        response,
        HttpStatusCode.BadRequest,
        "If-Match must be one quoted \"<lineage>:<sequence>\" tag\n");
    Assert.Equal(0, app.Fakes.Endpoint.Gets);
    Assert.Empty(operations.Committed(SyncApp.Doc));
  }

  [Fact]
  public async Task TwoIfMatchHeadersAnswer400()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    var tag = $"\"{new string('0', 32)}:0\"";

    using var response = await Edit(
        app,
        ifMatch: tag,
        configure: request => request.Headers.TryAddWithoutValidation("If-Match", tag));

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    Assert.Empty(operations.Committed(SyncApp.Doc));
  }

  [Fact]
  public async Task ALateDuplicateAppendClosesWithoutRelayingOrWritingBack()
  {
    var operations = new FakeCollabOperationStore
    {
      NextAppendOutcome = CollabOperationAppendOutcome.Duplicate,
    };
    await using var app = await StartWithOperationStore(operations);
    await using var open = await app.ConnectAsync(protocols: [SyncApp.Protocol]);
    await open.ReceiveAsync<BlokControlFrame>();
    var mirror = YDocs.NewClient();
    await open.SendAsync(new SyncStep1Frame(YDocs.StateVector(mirror)));
    YDocs.Apply(mirror, (await open.ReceiveAsync<SyncStep2Frame>()).Update);
    await open.ReceiveAsync<SyncStep1Frame>();
    var nextFrame = open.ReceiveOrCloseAsync();

    using var response = await Edit(app, key: "late-duplicate");

    // The digest matched the request, not the bytes this room just generated,
    // so the room goes instead of relaying an update the journal never took.
    Assert.Null(await nextFrame);
    Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    Assert.Empty(operations.Committed(SyncApp.Doc));
    Assert.Equal(0, app.Fakes.Endpoint.Saves);
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
  public async Task EditRetryAfterRoomRecreationAppliesNothingAgain()
  {
    var operations = new FakeCollabOperationStore();
    string sequence;
    string lineage;

    await using (var firstApp = await StartWithOperationStore(operations))
    {
      using var first = await Edit(firstApp, key: "same-edit", body: AppendOne);

      Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
      Assert.Equal(1, firstApp.Fakes.Converter.ApplyOpsCalls);
      sequence = Assert.Single(first.Headers.GetValues("Blok-Doc-Sequence"));
      lineage = Assert.Single(first.Headers.GetValues("Blok-Doc-Lineage"));
      await firstApp.Fakes.Manager.DrainAsync(CancellationToken.None);
      Assert.Equal(0, firstApp.Fakes.Manager.LiveRoomCount);
    }

    await using var retryApp = await StartWithOperationStore(operations);
    using var retry = await Edit(retryApp, key: "same-edit", body: AppendOneReordered);

    Assert.Equal(HttpStatusCode.NoContent, retry.StatusCode);
    Assert.Equal(0, retryApp.Fakes.Converter.ApplyOpsCalls);
    Assert.Single(operations.Committed(SyncApp.Doc));
    Assert.Equal(sequence, Assert.Single(retry.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal(lineage, Assert.Single(retry.Headers.GetValues("Blok-Doc-Lineage")));
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
  public async Task EditAnswersForbiddenWhenDocumentPurged()
  {
    var operations = new FakeCollabOperationStore { DocumentPurged = true };
    await using var app = await StartWithOperationStore(operations);

    using var response = await Edit(app);

    await AssertError(response, HttpStatusCode.Forbidden, "forbidden\n");
    Assert.Equal(0, app.Fakes.Endpoint.Gets);
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
  public async Task EditRefusesReadDeniedCallerEvenWhenWriteIsAllowed()
  {
    var authorization = new RecordingAuthorization { AllowRead = false, AllowWrite = true };
    await using var app = await SyncApp.StartAsync(
        "ticket",
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    using var response = await Edit(app, ticket: fixture.Compatible);

    await AssertError(response, HttpStatusCode.Forbidden, "forbidden\n");
    Assert.Equal(0, app.Fakes.Endpoint.Gets);
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
  [InlineData(@"a\b")]
  [InlineData("a%5cb")]
  public async Task AnEncodedBackslashDocumentIsRejectedOrCanBePurgedAfterEdit(string doc)
  {
    var authorization = new RecordingAuthorization();
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    using var response = await Edit(app, doc: doc, key: "encoded-backslash");

    if (response.StatusCode == HttpStatusCode.BadRequest)
    {
      await AssertError(
          response,
          HttpStatusCode.BadRequest,
          "document ids must be a single path segment\n");
      Assert.Equal(0, app.Fakes.Endpoint.Gets);

      return;
    }

    Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    var routedDoc = Assert.Single(
        authorization.Calls, call => call.Method == "write").Document;
    Assert.True(routedDoc.Contains('\\') ||
        routedDoc.Contains("%5c", StringComparison.OrdinalIgnoreCase));
    Assert.Equal(1, app.Fakes.Converter.ApplyOpsCalls);
    Assert.True(app.Fakes.Store.Holds(routedDoc));
    var purger = app.App.Services.GetRequiredService<ICollabDocumentPurger>();

    Assert.Equal(
        CollabDocumentPurgeOutcome.Purged,
        await purger.PurgeDocumentAsync(routedDoc, _ => ValueTask.FromResult(true)));
    Assert.False(app.Fakes.Store.Holds(routedDoc));
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

  /// <summary>
  /// Reading the edit's HTML ran past the runtime's limits: a server fault a
  /// retry may heal, so not the caller's 422, and the same key may be sent again.
  /// </summary>
  [Fact]
  public async Task AnEditWhoseHtmlReadRanPastTheRuntimesLimitsIsARetryable503()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    app.Fakes.Converter.NextEditFailure = new CollabTransientException("collab: the runtime timed out");

    using var overloaded = await Edit(app, key: "overloaded-edit");
    using var retried = await Edit(app, key: "overloaded-edit");

    await AssertError(
        overloaded,
        HttpStatusCode.ServiceUnavailable,
        "the server ran past its limits reading this edit's rich text, retry\n");
    Assert.Equal(TimeSpan.FromSeconds(2), overloaded.Headers.RetryAfter?.Delta);
    Assert.Equal(HttpStatusCode.NoContent, retried.StatusCode);
    Assert.Equal("1", Assert.Single(retried.Headers.GetValues("Blok-Doc-Sequence")));
  }

  [Fact]
  public async Task AnEditWhoseHtmlRanPastTheAllocationBudgetIsA413WithoutRetryAfter()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    app.Fakes.Converter.NextEditFailure = new CollabEditException(
        "collab: the rich text HTML in this edit could not be read: too large",
        new BlokDocumentConversionException(BlokConversionFailure.DocumentTooLarge, new InvalidOperationException()));

    using var tooLarge = await Edit(app, key: "too-large-edit");

    await AssertError(
        tooLarge,
        HttpStatusCode.RequestEntityTooLarge,
        "collab: the rich text HTML in this edit could not be read: too large\n");
    Assert.Null(tooLarge.Headers.RetryAfter);
    Assert.Empty(operations.Committed(SyncApp.Doc));
  }

  [Fact]
  public async Task TheRetryAfterOfAnOverloadedEditIsTheRoomsRetryBackoff()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await SyncApp.StartAsync(
        services: collection => collection.AddSingleton<ICollabOperationStore>(operations),
        fakes: new SyncFakes(
            new CollabRoomOptions { RetryBackoff = TimeSpan.FromMilliseconds(4500) },
            operations));
    app.Fakes.Converter.NextEditFailure = new CollabTransientException("collab: the runtime timed out");

    using var overloaded = await Edit(app, key: "slow-edit");

    Assert.Equal(HttpStatusCode.ServiceUnavailable, overloaded.StatusCode);
    Assert.Equal(TimeSpan.FromSeconds(5), overloaded.Headers.RetryAfter?.Delta);
  }

  [Fact]
  public async Task AnEditTheConverterRefusesStaysA422()
  {
    await using var app = await SyncApp.StartAsync();
    app.Fakes.Converter.NextEditFailure = new CollabEditException("collab: the rich text HTML in this edit could not be read: bad");

    using var refused = await Edit(app, key: "refused-edit");

    await AssertError(
        refused,
        HttpStatusCode.UnprocessableEntity,
        "collab: the rich text HTML in this edit could not be read: bad\n");
    Assert.Null(refused.Headers.RetryAfter);
  }

  private static async Task<HttpResponseMessage> Edit(
      SyncApp app,
      string doc = SyncApp.Doc,
      string? ticket = null,
      string body = AppendOne,
      string? key = IdempotencyKey,
      Action<HttpRequestMessage>? configure = null,
      string? ifMatch = null)
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

    if (ifMatch is not null)
    {
      request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
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
