using Blok.Server.Mcp.Core;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.AspNetCore;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>A host's own document store as BlokMcpOptions.DocumentSource.</summary>
public sealed class CustomSourceTests
{
  private const string Stored = """{"title":"Stored","blocks":[{"id":"p1","type":"paragraph","data":{"text":"Stored"}}]}""";

  /// <summary>An in-memory store that records every call and can be told how to answer the next one.</summary>
  private sealed class Store : IBlokMcpDocumentSource
  {
    public Dictionary<string, BlokMcpStoredDocument> Documents { get; } = [];

    public List<string> Calls { get; } = [];

    public List<BlokMcpDocumentCaller> Callers { get; } = [];

    public List<string?> IfVersions { get; } = [];

    public List<string> SavedTexts { get; } = [];

    public Exception? NextLoadThrows { get; set; }

    public Exception? NextSaveThrows { get; set; }

    public string? SaveAnswers { get; set; }

    private int saves;

    public ValueTask<BlokMcpStoredDocument?> LoadAsync(BlokMcpDocumentCaller caller, string documentId, CancellationToken cancellationToken)
    {
      Calls.Add($"load {documentId}");
      Callers.Add(caller);
      if (NextLoadThrows is { } error)
      {
        NextLoadThrows = null;
        throw error;
      }

      return ValueTask.FromResult(Documents.GetValueOrDefault(documentId));
    }

    public ValueTask<string> SaveAsync(BlokMcpDocumentCaller caller, string documentId, string documentText, string? ifVersion, CancellationToken cancellationToken)
    {
      Calls.Add($"save {documentId}");
      Callers.Add(caller);
      IfVersions.Add(ifVersion);
      SavedTexts.Add(documentText);
      if (NextSaveThrows is { } error)
      {
        NextSaveThrows = null;
        throw error;
      }
      var version = SaveAnswers ?? $"v{++saves}";

      Documents[documentId] = new BlokMcpStoredDocument(documentText, version);

      return ValueTask.FromResult(version);
    }
  }

  private sealed class ListingStore : IBlokMcpDocumentSource, IBlokMcpDocumentLister
  {
    public List<(BlokMcpDocumentCaller Caller, BlokMcpListRequest Request)> Lists { get; } = [];

    public ValueTask<BlokMcpStoredDocument?> LoadAsync(BlokMcpDocumentCaller caller, string documentId, CancellationToken cancellationToken)
    {
      return ValueTask.FromResult<BlokMcpStoredDocument?>(null);
    }

    public ValueTask<string> SaveAsync(BlokMcpDocumentCaller caller, string documentId, string documentText, string? ifVersion, CancellationToken cancellationToken)
    {
      return ValueTask.FromResult("v1");
    }

    public ValueTask<BlokMcpDocumentList> ListAsync(BlokMcpDocumentCaller caller, BlokMcpListRequest request, CancellationToken cancellationToken)
    {
      Lists.Add((caller, request));

      return ValueTask.FromResult(new BlokMcpDocumentList([new BlokMcpListedDocument("doc") { Title = "Notes" }, new BlokMcpListedDocument("secret")]) { NextCursor = "page-2" });
    }
  }

  private sealed class Logged : ILoggerProvider, ILogger
  {
    public List<string> Lines { get; } = [];

    public ILogger CreateLogger(string categoryName)
    {
      return this;
    }

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull
    {
      return null;
    }

    public bool IsEnabled(LogLevel logLevel)
    {
      return true;
    }

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
      lock (Lines)
      {
        Lines.Add($"{formatter(state, exception)} {exception}");
      }
    }

    public void Dispose()
    {
    }
  }

  private static async Task<(WebApplication App, HttpClient Client)> StartAsync(IBlokMcpDocumentSource source, Action<BlokMcpOptions>? configure = null, Logged? logged = null)
  {
    var builder = WebApplication.CreateSlimBuilder();

    builder.Logging.ClearProviders();
    if (logged is not null)
    {
      builder.Logging.AddProvider(logged);
    }
    builder.WebHost.UseTestServer();
    builder.Services.AddBlokMcp(options =>
    {
      options.DocumentSource = source;
      options.Principal = "alice";
      options.Authorize = (request, _) => ValueTask.FromResult(request.DocumentId != "secret");
      configure?.Invoke(options);
    });
    var app = builder.Build();

    app.MapBlokMcp();
    await app.StartAsync();

    return (app, app.GetTestClient());
  }

  private static JsonObject Execute(JsonNode handle, params JsonObject[] commands)
  {
    return new JsonObject { ["handle"] = handle.DeepClone(), ["commands"] = new JsonArray(commands) };
  }

  private static JsonObject SetTitle(string title)
  {
    return new JsonObject { ["name"] = "doc.setTitle", ["args"] = new JsonObject { ["title"] = title } };
  }

  private static async Task<JsonObject> OpenAsync(HttpClient client, string id, bool write = true, JsonObject? meta = null)
  {
    return await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = id, ["write"] = write }, meta: meta);
  }

  [Fact]
  public async Task AMissingDocumentOpensEmptyAndItsFirstSaveSaysItMustNotExistYet()
  {
    var store = new Store();
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var opened = await OpenAsync(client, "new");
      var first = await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, SetTitle("One")));
      var second = await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, SetTitle("Two")));

      Assert.False((bool?)opened["exists"]);
      Assert.Equal([null, "v1"], store.IfVersions);
      Assert.Equal("v1", (string?)first["delivery"]?["savedVersion"]);
      Assert.Equal("v2", (string?)second["delivery"]?["savedVersion"]);
      Assert.Equal("""{"title":"One","blocks":[]}""", store.SavedTexts[0]);
    }
  }

  [Fact]
  public async Task TheStoreSeesTheOpenersCallerOnLoadAndSave()
  {
    var store = new Store();

    store.Documents["doc"] = new BlokMcpStoredDocument(Stored, "v1");
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var opened = await OpenAsync(client, "doc", meta: McpTestRpc.ClientMeta("Desktop"));

      await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, SetTitle("Mine")), meta: McpTestRpc.ClientMeta("Other"));

      Assert.Equal(["load doc", "save doc"], store.Calls);
      Assert.All(store.Callers, caller =>
      {
        Assert.Equal("alice", caller.Principal);
        Assert.Equal("Desktop", caller.ClientName);
        Assert.Null(caller.Scopes);
        Assert.Equal("agent:alice:Desktop", caller.Actor.Id);
        Assert.Equal("alice", caller.Actor.OnBehalfOf);
      });
      Assert.Equal(["v1"], store.IfVersions);
    }
  }

  [Fact]
  public async Task APlainThrowOnSaveIsLoggedInFullShownInGenericWordsAndReloads()
  {
    var store = new Store();
    var logged = new Logged();

    store.Documents["doc"] = new BlokMcpStoredDocument(Stored, "v1");
    var (app, client) = await StartAsync(store, logged: logged);

    await using (app)
    {
      var opened = await OpenAsync(client, "doc");

      store.NextSaveThrows = new InvalidOperationException("db password=hunter2");
      var failed = await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, SetTitle("Lost")));
      var read = await McpTestRpc.ToolAsync(client, "blok_read", new JsonObject { ["handle"] = opened["handle"]!.DeepClone() });
      var undo = await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, new JsonObject { ["name"] = "history.undo", ["args"] = new JsonObject() }));

      Assert.Equal("SOURCE_UNAVAILABLE", (string?)failed["error"]?["code"]);
      Assert.Equal("The host could not save this document, so nothing was saved. Try again.", (string?)failed["error"]?["message"]);
      Assert.DoesNotContain("hunter2", failed.ToJsonString(), StringComparison.Ordinal);
      Assert.Contains(logged.Lines, line => line.Contains("hunter2", StringComparison.Ordinal));
      Assert.Equal(["load doc", "save doc", "load doc"], store.Calls);
      Assert.Equal("Stored", (string?)read["page"]?["title"]);
      Assert.Equal("NOTHING_TO_UNDO", (string?)undo["results"]?[0]?["error"]?["code"] ?? (string?)undo["error"]?["code"]);
    }
  }

  [Theory]
  [InlineData(BlokMcpSourceErrorKind.Changed, "", "DOCUMENT_CHANGED", "Someone saved this document since you opened it. Read it again, then retry.")]
  [InlineData(BlokMcpSourceErrorKind.Forbidden, "You may not edit this page.", "FORBIDDEN", "You may not edit this page.")]
  [InlineData(BlokMcpSourceErrorKind.Forbidden, "  ", "FORBIDDEN", "The host does not allow this.")]
  [InlineData(BlokMcpSourceErrorKind.InvalidId, "", "INVALID_ARGS", "The host does not accept this document id.")]
  [InlineData(BlokMcpSourceErrorKind.Unavailable, "", "SOURCE_UNAVAILABLE", "The host could not save this document, so nothing was saved. Try again.")]
  public async Task ARefusalOnSaveMapsToItsCode(BlokMcpSourceErrorKind kind, string message, string code, string shown)
  {
    var store = new Store();

    store.Documents["doc"] = new BlokMcpStoredDocument(Stored, "v1");
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var opened = await OpenAsync(client, "doc");

      store.NextSaveThrows = new BlokMcpSourceException(kind, message);
      var failed = await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, SetTitle("Refused")));

      Assert.Equal(code, (string?)failed["error"]?["code"]);
      Assert.Equal(shown, (string?)failed["error"]?["message"]);
    }
  }

  [Fact]
  public async Task AnUnavailableLoadUsesTheLoadWords()
  {
    var store = new Store { NextLoadThrows = new BlokMcpSourceException(BlokMcpSourceErrorKind.Unavailable) };
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var failed = await OpenAsync(client, "doc");

      Assert.Equal("SOURCE_UNAVAILABLE", (string?)failed["error"]?["code"]);
      Assert.Equal("The host could not load this document. Try again.", (string?)failed["error"]?["message"]);
    }
  }

  [Fact]
  public async Task ALoadOrSaveWithoutAVersionIsAHostBug()
  {
    var store = new Store { SaveAnswers = string.Empty };

    store.Documents["empty"] = new BlokMcpStoredDocument(Stored, string.Empty);
    store.Documents["doc"] = new BlokMcpStoredDocument(Stored, "v1");
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var load = await OpenAsync(client, "empty");
      var opened = await OpenAsync(client, "doc");
      var save = await McpTestRpc.ToolAsync(client, "blok_execute", Execute(opened["handle"]!, SetTitle("Maybe")));

      Assert.Equal("The host could not load this document. Try again.", (string?)load["error"]?["message"]);
      Assert.Equal("SOURCE_UNAVAILABLE", (string?)save["error"]?["code"]);
      Assert.Equal("The host may have saved this document but did not say which version. Read it before you retry.", (string?)save["error"]?["message"]);
    }
  }

  [Theory]
  [InlineData("")]
  [InlineData(".")]
  [InlineData("..")]
  public async Task RefusesDotIdsBeforeTheStoreSeesThem(string id)
  {
    var store = new Store();
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var refused = await McpTestRpc.ToolAsync(client, "blok_open", new JsonObject { ["documentId"] = id });

      // The empty id is refused by the tool's own argument check first.
      Assert.Equal("INVALID_ARGS", (string?)refused["error"]?["code"]);
      Assert.Empty(store.Calls);
    }
  }

  [Theory]
  [InlineData("""{"title":"a","blocks":[],"title":"b"}""", "b")]
  [InlineData("""{"title":"a\ud800b","blocks":[]}""", "a�b")]
  public async Task ReadsTheStoredTextAsJsonParseDoes(string text, string title)
  {
    var store = new Store();

    store.Documents["doc"] = new BlokMcpStoredDocument(text, "v1");
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var opened = await OpenAsync(client, "doc", write: false);
      var read = await McpTestRpc.ToolAsync(client, "blok_read", new JsonObject { ["handle"] = opened["handle"]!.DeepClone() });

      Assert.Equal(title, (string?)read["page"]?["title"]);
    }
  }

  [Theory]
  [InlineData(48, null)]
  [InlineData(49, "The host's document \"doc\" nests deeper than 48 levels of objects and arrays.")]
  [InlineData(0, "The host's document \"doc\" is not a Blok document: expected an object with a \"blocks\" array.")]
  [InlineData(-1, "The host's document \"doc\" is not JSON.")]
  public async Task ChecksEveryStoredDocument(int depth, string? refusal)
  {
    var store = new Store();
    var text = depth switch
    {
      0 => """{"title":"No blocks"}""",
      -1 => "{nope",
      // The document is level 1; each {"a": below it adds one.
      _ => $$"""{"blocks":[],"meta":{{string.Concat(Enumerable.Repeat("{\"a\":", depth - 1))}}"x"{{new string('}', depth - 1)}}}""",
    };

    store.Documents["doc"] = new BlokMcpStoredDocument(text, "v1");
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var opened = await OpenAsync(client, "doc", write: false);

      Assert.Equal(refusal, (string?)opened["error"]?["message"]);
      if (refusal is not null)
      {
        Assert.Equal("SOURCE_UNAVAILABLE", (string?)opened["error"]?["code"]);
      }
    }
  }

  [Fact]
  public async Task ListsForTheCurrentCallerAndDropsIdsAuthorizeRefuses()
  {
    var store = new ListingStore();
    var (app, client) = await StartAsync(store);

    await using (app)
    {
      var listing = await McpTestRpc.ToolAsync(client, "blok_list_documents", new JsonObject { ["query"] = "no" }, meta: McpTestRpc.ClientMeta("Lister"));

      Assert.Equal(["doc"], ((JsonArray)listing["documents"]!).Select(doc => (string?)doc!["id"]));
      Assert.Equal("page-2", (string?)listing["nextCursor"]);
      Assert.Equal("Lister", store.Lists.Single().Caller.ClientName);
      Assert.Equal("no", store.Lists.Single().Request.Query);
    }
  }

  [Fact]
  public async Task AStoreThatCannotListSaysSo()
  {
    var (app, client) = await StartAsync(new Store());

    await using (app)
    {
      var listing = await McpTestRpc.ToolAsync(client, "blok_list_documents", []);

      Assert.False((bool?)listing["supported"]);
    }
  }

  [Fact]
  public async Task CountsAsASourceSoATicketRouteStillNeedsAPerDocumentCheck()
  {
    void TicketsOnly(BlokMcpOptions options)
    {
      options.Authorize = null;
      options.SyncUrl = new Uri("ws://127.0.0.1:9/sync");
      options.TicketUrl = new Uri("http://127.0.0.1:9/tickets");
      options.TicketHostToken = "host-token";
    }

    var standalone = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(new Store(), TicketsOnly));
    var embedded = await Assert.ThrowsAsync<BlokMcpConfigException>(async () =>
    {
      var builder = WebApplication.CreateSlimBuilder();

      builder.Logging.ClearProviders();
      builder.WebHost.UseTestServer();
      builder.Services.AddMcpServer().WithHttpTransport(transport => transport.SessionMode = HttpServerSessionMode.Stateless).WithBlok(options =>
      {
        options.DocumentSource = new Store();
        TicketsOnly(options);
      });
      await using var app = builder.Build();

      app.MapMcp("/mcp");
      await app.StartAsync();
    });

    Assert.Contains("needs a per-document check", standalone.Message, StringComparison.Ordinal);
    Assert.Contains("needs a per-document check", embedded.Message, StringComparison.Ordinal);
  }

  [Theory]
  [InlineData("files")]
  [InlineData("endpoint")]
  public async Task RefusesASecondSource(string other)
  {
    var refused = await Assert.ThrowsAsync<InvalidOperationException>(() => StartAsync(new Store(), options =>
    {
      if (other == "files")
      {
        options.FilesDirectory = ".";
      }
      else
      {
        options.DocumentEndpoint = new Uri("http://127.0.0.1:9/docs");
      }
    }));

    Assert.Equal("Set one document source: DocumentSource, FilesDirectory or DocumentEndpoint.", refused.Message);
  }
}
