using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>A host page creator (BlokMcpOptions.PageCreator, --create-page) makes each new page document.</summary>
public sealed class HostPageCreatorTests : IClassFixture<BundleFixture>, IDisposable
{
  private const string ServerStop = "The batch stopped on a server error. Nothing was written.";
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-host-pages-").FullName;
  private readonly BundleFixture fixture;
  private readonly List<(string Principal, string DocumentId, bool Write)> asked = [];
  private readonly List<(string Message, Exception Error)> logged = [];

  public HostPageCreatorTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private McpServerCore Core(IBlokPageCreator creator)
  {
    return new McpServerCore(fixture.Host.Bundle, new McpConfig
    {
      Source = new McpSourceConfig.Files(dir),
      PageTitles = "page-map",
      PageCreator = creator,
      Authorize = (principal, documentId, write, _) =>
      {
        asked.Add((principal, documentId, write));

        return Task.FromResult(true);
      },
      LogError = (message, error) => logged.Add((message, error)),
    }, new McpHttpCaller());
  }

  private static JsonObject InsertPage(string id) => new() { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["id"] = id, ["position"] = "end" } };

  private static async Task<JsonObject> CallAsync(McpServerCore core, McpCaller caller, string name, JsonObject arguments, CancellationToken cancellationToken = default)
  {
    var outcome = await core.CallToolAsync(name, arguments, caller, null, cancellationToken);

    return (JsonObject)outcome.Answer!["structuredContent"]!;
  }

  private static async Task<string> OpenAsync(McpServerCore core, McpCaller caller)
  {
    return (string)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "parent", ["write"] = true }))["handle"]!;
  }

  private static Task<JsonObject> ExecuteAsync(McpServerCore core, McpCaller caller, string handle, CancellationToken cancellationToken, params JsonObject[] commands)
  {
    return CallAsync(core, caller, "blok_execute", new JsonObject { ["handle"] = handle, ["commands"] = new JsonArray([.. commands]) }, cancellationToken);
  }

  private string Parent() => File.ReadAllText(Path.Combine(dir, "parent.json"));

  private string[] PageIds() => [.. JsonNode.Parse(Parent())!["blocks"]!.AsArray().Select(block => McpJson.String(block?["data"]?["pageId"]) ?? string.Empty)];

  [Fact]
  public async Task TheHostsIdBecomesThePageIdAndTheHostIsToldTheParentThePrincipalAndTheOpenersActor()
  {
    var creator = new FakeCreator("host-page-1");
    await using var core = Core(creator);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np"));

    Assert.Equal(true, McpJson.Bool(ran["ok"]));
    Assert.Equal(["host-page-1"], PageIds());
    var request = Assert.Single(creator.Requests);
    Assert.Equal("parent", request.ParentDocumentId);
    Assert.Equal("alice", request.Principal);
    Assert.Equal(new BlokAgentActor(McpJson.String(caller.Actor["id"])!, McpJson.String(caller.Actor["name"])!, "alice"), request.Actor);
    Assert.Matches("^[A-Za-z0-9_-]{10}$", request.SuggestedPageId);
    // The host owns the new page: no authorize, no empty save.
    Assert.DoesNotContain(asked, entry => entry.DocumentId == "host-page-1");
    Assert.False(File.Exists(Path.Combine(dir, "host-page-1.json")));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  public async Task ANullOrEmptyAnswerRefusesWithForbiddenAndSavesNothing(string? answer)
  {
    await using var core = Core(new FakeCreator(answer));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np"));

    Assert.Equal("""{"code":"FORBIDDEN","message":"You may not create a page document here.","retryable":false,"commandIndex":0}""", ran["error"]?.ToJsonString());
    Assert.Equal("""{"blocks":[]}""", Parent());
  }

  [Fact]
  public async Task AThrowOnTheFirstPageAnswersSourceUnavailableAndLogsTheErrorInFull()
  {
    await using var core = Core(new FakeCreator(new InvalidOperationException("database down hunter2")));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np"));

    Assert.Equal("""{"code":"SOURCE_UNAVAILABLE","message":"The host could not create the page.","retryable":true,"commandIndex":0}""", ran["error"]?.ToJsonString());
    Assert.Contains(logged, entry => entry.Error.ToString().Contains("hunter2", StringComparison.Ordinal));
    Assert.DoesNotContain("hunter2", ran.ToJsonString(), StringComparison.Ordinal);
    Assert.Equal("""{"blocks":[]}""", Parent());
  }

  [Fact]
  public async Task AThrowOnTheSecondPageListsTheFirstAsOrphanedWithAServerStopCause()
  {
    await using var core = Core(new FakeCreator("host-1", new InvalidOperationException("database down")));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np0"), InsertPage("np1"));

    Assert.Equal(Orphaned(ServerStop, "APPLY_FAILED", true, "host-1"), ran["error"]?.ToJsonString());
    Assert.NotNull(ran["revision"]);
    Assert.Equal("""{"blocks":[]}""", Parent());
  }

  [Fact]
  public async Task ARefusalOnTheSecondPageListsTheFirstWithForbiddenAsTheCause()
  {
    await using var core = Core(new FakeCreator("host-1", null));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np0"), InsertPage("np1"));

    Assert.Equal(Orphaned("You may not create a page document here.", "FORBIDDEN", false, "host-1"), ran["error"]?.ToJsonString());
  }

  [Fact]
  public async Task ACancelAfterOnePageStopsBeforeTheNextAndReportsItThroughTheBundle()
  {
    using var cancel = new CancellationTokenSource();
    var creator = new FakeCreator("host-1", "host-2") { AfterCreate = cancel.Cancel };
    await using var core = Core(creator);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, cancel.Token, InsertPage("np0"), InsertPage("np1"));

    Assert.Single(creator.Requests);
    Assert.Equal(Cancelled("host-1"), ran["error"]?.ToJsonString());
    Assert.Equal("""{"blocks":[]}""", Parent());
  }

  [Fact]
  public async Task APageTheParentAlreadyLinksIsNoOrphanAndTheCauseIsTheAnswer()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"old","type":"page","data":{"pageId":"linked"}}]}""");
    await using var core = Core(new FakeCreator("linked", new InvalidOperationException("database down")));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np0"), InsertPage("np1"));

    Assert.Equal($$"""{"code":"APPLY_FAILED","message":"{{ServerStop}}","retryable":true,"commandIndex":1}""", ran["error"]?.ToJsonString());
  }

  [Fact]
  public async Task AParagraphWhoseTextIsTheIdDoesNotLinkIt()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"t","type":"paragraph","data":{"text":"linked"}}]}""");
    await using var core = Core(new FakeCreator("linked", new InvalidOperationException("database down")));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np0"), InsertPage("np1"));

    Assert.Equal(Orphaned(ServerStop, "APPLY_FAILED", true, "linked"), ran["error"]?.ToJsonString());
  }

  // Built here, not as theory data: xUnit's serializer turns a lone surrogate into U+FFFD.
  private static readonly string[] BadIds =
  [
    "page\u0007",
    "page\u0085",
    "page\ud800",
    "\udc00",
    ".",
    "..",
    string.Concat(Enumerable.Repeat("😀", 513)),
    new string('a', 513),
  ];

  [Theory]
  [InlineData(0)]
  [InlineData(1)]
  [InlineData(2)]
  [InlineData(3)]
  [InlineData(4)]
  [InlineData(5)]
  [InlineData(6)]
  [InlineData(7)]
  public async Task AnIdThatIsNoValidPageIdIsAHostError(int which)
  {
    var pageId = BadIds[which];
    await using var core = Core(new FakeCreator(pageId));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np"));

    Assert.Equal("SOURCE_UNAVAILABLE", McpJson.String(ran["error"]?["code"]));
    Assert.Contains(logged, entry => entry.Message.Contains("no valid page id", StringComparison.Ordinal));
    Assert.Equal("""{"blocks":[]}""", Parent());
  }

  [Fact]
  public async Task AnIdOf512CodePointsIsAccepted()
  {
    var pageId = string.Concat(Enumerable.Repeat("😀", 512));
    await using var core = Core(new FakeCreator(pageId));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np"));

    Assert.Equal(true, McpJson.Bool(ran["ok"]));
  }

  [Fact]
  public async Task UndoAndRedoOfAHostMadePageAskTheHostOnce()
  {
    var creator = new FakeCreator("host-1", "host-2");
    await using var core = Core(creator);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    await ExecuteAsync(core, caller, handle, CancellationToken.None, InsertPage("np"));
    var undone = await ExecuteAsync(core, caller, handle, CancellationToken.None, new JsonObject { ["name"] = "history.undo", ["args"] = new JsonObject() });
    var redone = await ExecuteAsync(core, caller, handle, CancellationToken.None, new JsonObject { ["name"] = "history.redo", ["args"] = new JsonObject() });

    Assert.Equal(true, McpJson.Bool(undone["ok"]));
    Assert.Equal(true, McpJson.Bool(redone["ok"]));
    Assert.Single(creator.Requests);
    Assert.Equal(["host-1"], PageIds());
  }

  [Fact]
  public async Task TwentySixPageInsertsNeverAskTheHost()
  {
    var creator = new FakeCreator("host-1");
    await using var core = Core(creator);
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller);

    var ran = await ExecuteAsync(core, caller, handle, CancellationToken.None, [.. Enumerable.Range(0, 26).Select(index => InsertPage($"np{index}"))]);

    Assert.Equal(false, McpJson.Bool(ran["ok"]));
    Assert.Empty(creator.Requests);
  }

  internal static string Orphaned(string causeMessage, string cause, bool retryable, params string[] pageIds) =>
      Orphaned(causeMessage, cause, retryable, true, pageIds);

  /// <summary>A cancel's cause carries no commandIndex; only the outer error does.</summary>
  internal static string Cancelled(params string[] pageIds) =>
      Orphaned("The batch was cancelled. Nothing was written.", "CANCELLED", false, false, pageIds);

  private static string Orphaned(string causeMessage, string cause, bool retryable, bool causeIndex, string[] pageIds)
  {
    var causeJson = new JsonObject { ["code"] = cause, ["message"] = causeMessage, ["retryable"] = retryable };

    if (causeIndex)
    {
      causeJson["commandIndex"] = 1;
    }

    return new JsonObject
    {
      ["code"] = "ORPHANED_SIDE_EFFECT",
      ["message"] = $"The batch failed after the host did work for it ({causeMessage}). Clean up the listed items.",
      ["commandIndex"] = 1,
      ["retryable"] = false,
      ["details"] = new JsonObject
      {
        ["orphaned"] = new JsonArray([.. pageIds.Select(pageId => (JsonNode)new JsonObject
        {
          ["command"] = "block.insert", ["type"] = "page", ["prepared"] = new JsonObject { ["pageId"] = pageId },
        })]),
        ["cause"] = causeJson,
      },
    }.ToJsonString();
  }

  /// <summary>Answers each create in turn: an id, null, or a throw.</summary>
  internal sealed class FakeCreator(params object?[] answers) : IBlokPageCreator
  {
    internal List<BlokPageCreateRequest> Requests { get; } = [];

    internal Action? AfterCreate { get; init; }

    public ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Blok's MCP server must ask through the request.");

    public ValueTask<string?> CreateAsync(BlokPageCreateRequest request, CancellationToken cancellationToken = default)
    {
      Requests.Add(request);
      var answer = answers[Math.Min(Requests.Count, answers.Length) - 1];

      AfterCreate?.Invoke();

      return answer is Exception error ? throw error : ValueTask.FromResult((string?)answer);
    }

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("Blok's MCP server never resolves through the creator.");
  }
}
