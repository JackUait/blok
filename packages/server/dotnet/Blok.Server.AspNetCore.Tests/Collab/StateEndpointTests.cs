using System.Net;
using System.Text;
using Blok.Server.Collab;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Blok.Server.AspNetCore.Tests.Collab;

/// <summary>
/// GET /sync/{doc}/state: the live room's export for a consumer backend, and
/// in journal mode the head that export reflects.
/// </summary>
public sealed class StateEndpointTests
{
  private const string AppendOne =
      """{ "ops": [ { "op": "insert", "id": "new", "block": { "type": "p", "data": { "text": "!" } } } ] }""";

  private readonly TicketFixture fixture = TicketFixture.Load();

  [Fact]
  public async Task StateServesTheLiveDocumentAndTheHeadOfTheLastEdit()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    using var edit = await Edit(app, "state-edit");
    var lineage = Assert.Single(edit.Headers.GetValues("Blok-Doc-Lineage"));

    using var state = await State(app);

    Assert.Equal(HttpStatusCode.OK, state.StatusCode);
    Assert.Equal("""{"text":"seeded!"}""", await state.Content.ReadAsStringAsync());
    Assert.Equal("application/json", state.Content.Headers.ContentType?.MediaType);
    Assert.Equal(lineage, Assert.Single(state.Headers.GetValues("Blok-Doc-Lineage")));
    Assert.Equal("1", Assert.Single(state.Headers.GetValues("Blok-Doc-Sequence")));
    Assert.Equal($"\"{lineage}:1\"", Assert.Single(state.Headers.GetValues("ETag")));
    Assert.Equal("no-store", state.Headers.CacheControl?.ToString());
  }

  /// <summary>
  /// A browser hides every response header CORS does not expose, so a
  /// cross-origin page could not build If-Match from /state or recover from a 412.
  /// </summary>
  [Fact]
  public async Task ACrossOriginPageCanReadTheHeadHeadersOnStateAndEdit()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);

    using var state = await State(app);
    using var applied = await Edit(app, "exposed-edit");
    using var stale = await Edit(app, "exposed-stale", ifMatch: Assert.Single(state.Headers.GetValues("ETag")));

    Assert.Equal(HttpStatusCode.NoContent, applied.StatusCode);
    Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
    Assert.Equal(["Blok-Doc-Lineage", "Blok-Doc-Sequence", "ETag"], ExposedHeaders(state));
    Assert.Equal(["Blok-Doc-Lineage", "Blok-Doc-Sequence", "ETag"], ExposedHeaders(applied));
    Assert.Equal(["Blok-Doc-Lineage", "Blok-Doc-Sequence", "ETag"], ExposedHeaders(stale));
  }

  /// <summary>A host's own CORS layer may expose headers first; ours are added, not swapped in.</summary>
  [Fact]
  public async Task TheHeadHeadersJoinHeadersTheAppAlreadyExposes()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await SyncApp.StartAsync(
        services: collection => collection.AddSingleton<ICollabOperationStore>(operations),
        configureApp: web => web.Use(async (context, next) =>
        {
          context.Response.Headers.AccessControlExposeHeaders = "X-Request-Id, etag";
          await next(context);
        }),
        fakes: new SyncFakes(operationStore: operations));

    using var state = await State(app);
    using var edit = await Edit(app, "joined-edit");

    Assert.Equal(["Blok-Doc-Lineage", "Blok-Doc-Sequence", "X-Request-Id", "etag"], ExposedHeaders(state));
    Assert.Equal(["Blok-Doc-Lineage", "Blok-Doc-Sequence", "X-Request-Id", "etag"], ExposedHeaders(edit));
  }

  private static string[] ExposedHeaders(HttpResponseMessage response)
  {
    Assert.Equal(SyncApp.AllowedOrigin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));

    return response.Headers.TryGetValues("Access-Control-Expose-Headers", out var values)
      ? [.. values.SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries)).Order(StringComparer.Ordinal)]
      : [];
  }

  [Fact]
  public async Task TheStateETagIsAnIfMatchTheNextEditAccepts()
  {
    var operations = new FakeCollabOperationStore();
    await using var app = await StartWithOperationStore(operations);
    using var state = await State(app);
    var etag = Assert.Single(state.Headers.GetValues("ETag"));

    using var edit = await Edit(app, "guarded-edit", ifMatch: etag);

    Assert.Equal(HttpStatusCode.NoContent, edit.StatusCode);
    Assert.Equal("1", Assert.Single(edit.Headers.GetValues("Blok-Doc-Sequence")));
  }

  [Fact]
  public async Task WorkingCopyStateCarriesNoHead()
  {
    await using var app = await SyncApp.StartAsync();
    using var edit = await Edit(app, "plain-edit");

    using var state = await State(app);

    Assert.Equal(HttpStatusCode.OK, state.StatusCode);
    Assert.Equal("""{"text":"seeded!"}""", await state.Content.ReadAsStringAsync());
    Assert.False(state.Headers.Contains("Blok-Doc-Lineage"));
    Assert.False(state.Headers.Contains("Blok-Doc-Sequence"));
    Assert.False(state.Headers.Contains("ETag"));
  }

  [Fact]
  public async Task StateNeedsReadAccessButNotWriteAccess()
  {
    var authorization = new RecordingAuthorization { AllowRead = false };
    await using var app = await SyncApp.StartAsync(
        services: services => services.AddSingleton<IBlokAuthorization>(authorization));

    using var denied = await State(app);

    await AssertError(denied, HttpStatusCode.Forbidden, "forbidden\n");
    Assert.Equal(0, app.Fakes.Endpoint.Gets);

    authorization.AllowRead = true;
    authorization.AllowWrite = false;
    using var allowed = await State(app);

    Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    Assert.DoesNotContain(authorization.Calls, call => call.Method == "write");
  }

  [Fact]
  public async Task InTicketModeAReadPassForThisDocumentIsEnough()
  {
    await using var app = await SyncApp.StartAsync("ticket");

    using var missing = await State(app);
    await AssertError(missing, HttpStatusCode.Unauthorized, "missing pass\n");

    using var otherDocument = await State(app, ticket: fixture.DocMismatch);
    await AssertError(otherDocument, HttpStatusCode.Forbidden, "pass is for another document\n");

    using var readOnly = await State(app, ticket: fixture.ReadOnly);
    Assert.Equal(HttpStatusCode.OK, readOnly.StatusCode);
  }

  [Fact]
  public async Task StateOfAPurgedDocumentIsForbidden()
  {
    var operations = new FakeCollabOperationStore { DocumentPurged = true };
    await using var app = await StartWithOperationStore(operations);

    using var response = await State(app);

    await AssertError(response, HttpStatusCode.Forbidden, "forbidden\n");
  }

  [Fact]
  public async Task StateWhileDrainingIsUnavailable()
  {
    await using var app = await SyncApp.StartAsync();
    await app.Fakes.Manager.DrainAsync(CancellationToken.None);

    using var response = await State(app);

    Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
  }

  [Fact]
  public async Task StateAnswersOnlyGet()
  {
    await using var app = await SyncApp.StartAsync();
    using var client = app.CreateClient();
    using var wrongMethod = await client.PostAsync($"/sync/{SyncApp.Doc}/state", null);

    Assert.Equal(HttpStatusCode.MethodNotAllowed, wrongMethod.StatusCode);
    Assert.Equal("GET, OPTIONS", string.Join(", ", wrongMethod.Content.Headers.Allow));
  }

  private static async Task<HttpResponseMessage> State(
      SyncApp app,
      string doc = SyncApp.Doc,
      string? ticket = null)
  {
    using var request = new HttpRequestMessage(
        HttpMethod.Get,
        $"/sync/{Uri.EscapeDataString(doc)}/state");
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);

    if (ticket is not null)
    {
      request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {ticket}");
    }

    return await app.CreateClient().SendAsync(request);
  }

  private static async Task<HttpResponseMessage> Edit(
      SyncApp app,
      string key,
      string? ifMatch = null)
  {
    using var request = new HttpRequestMessage(HttpMethod.Post, $"/sync/{SyncApp.Doc}/edit")
    {
      Content = new StringContent(AppendOne, Encoding.UTF8, "application/json"),
    };
    request.Headers.TryAddWithoutValidation("Origin", SyncApp.AllowedOrigin);
    request.Headers.TryAddWithoutValidation("Blok-Idempotency-Key", key);

    if (ifMatch is not null)
    {
      request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
    }

    return await app.CreateClient().SendAsync(request);
  }

  private static Task<SyncApp> StartWithOperationStore(FakeCollabOperationStore operations)
  {
    return SyncApp.StartAsync(
        services: collection => collection.AddSingleton<ICollabOperationStore>(operations),
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
