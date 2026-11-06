using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class StoredPagesTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-pages-").FullName;
  private readonly BundleFixture fixture;

  public StoredPagesTests(BundleFixture fixture)
  {
    this.fixture = fixture;
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  private McpServerCore Core(McpAuthorize? authorize = null)
  {
    return new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir), PageTitles = "page-map", Authorize = authorize }, new McpHttpCaller());
  }

  private static async Task<string?> OpenAsync(McpServerCore core, McpCaller caller, string documentId, bool write = true)
  {
    return (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = documentId, ["write"] = write }))["handle"];
  }

  private static Task<JsonObject> ExecuteAsync(McpServerCore core, McpCaller caller, string? handle, params JsonObject[] commands)
  {
    return CallAsync(core, caller, "blok_execute", new JsonObject { ["handle"] = handle, ["commands"] = new JsonArray([.. commands]) });
  }

  private static JsonObject Command(string name, JsonObject args)
  {
    return new JsonObject { ["name"] = name, ["args"] = args };
  }

  private static async Task<JsonObject> CallAsync(McpServerCore core, McpCaller caller, string name, JsonObject arguments, JsonNode? replies = null)
  {
    var outcome = await core.CallToolAsync(name, arguments, caller, new McpApproval(new JsonObject { ["elicitation"] = new JsonObject() }, replies, caller.ClientName), CancellationToken.None);

    return outcome.Ask ?? (JsonObject)outcome.Answer!["structuredContent"]!;
  }

  [Fact]
  public async Task AnInsertedPageGetsItsOwnEmptyDocument()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }))["handle"];

    var ran = await CallAsync(core, caller, "blok_execute", new JsonObject
    {
      ["handle"] = handle,
      ["commands"] = new JsonArray(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page" } }),
    });

    Assert.Equal(true, (bool?)ran["ok"]);
    var pageId = (string?)ran["blocks"]?[0]?["data"]?["pageId"];

    Assert.NotNull(pageId);
    Assert.Equal("{\n  \"blocks\": []\n}\n", File.ReadAllText(Path.Combine(dir, $"{pageId}.json")));
  }

  [Fact]
  public async Task ABatchRefusedAfterItPreparedAPageStillMakesItAsNodeDoes()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }))["handle"];

    var ran = await CallAsync(core, caller, "blok_execute", new JsonObject
    {
      ["handle"] = handle,
      ["commands"] = new JsonArray(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["data"] = new JsonObject { ["title"] = "Sub" } } }),
    });

    Assert.Equal("ORPHANED_SIDE_EFFECT", (string?)ran["error"]?["code"]);
    var pageId = (string?)ran["error"]?["details"]?["orphaned"]?[0]?["prepared"]?["pageId"];

    Assert.NotNull(pageId);
    Assert.True(File.Exists(Path.Combine(dir, $"{pageId}.json")));
  }

  [Fact]
  public async Task ABatchThatAsksFirstMakesNoPage()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """
        {"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v",
        "schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],
        "views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}
        """);
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = (string?)(await CallAsync(core, caller, "blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }))["handle"];

    var asked = await CallAsync(core, caller, "blok_execute", new JsonObject
    {
      ["handle"] = handle,
      ["commands"] = new JsonArray(
          new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page" } },
          new JsonObject { ["name"] = "database.setLock", ["args"] = new JsonObject { ["id"] = "db", ["locked"] = false } }),
    });

    Assert.NotNull((string?)asked["key"]);
    Assert.Equal("doc.json", string.Join(",", Directory.GetFiles(dir).Select(Path.GetFileName)));
  }

  [Fact]
  public async Task ANewPageTheHookRefusesFailsItsInsertInsideTheBatch()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
    await using var core = Core((_, documentId, _, _) => Task.FromResult(documentId == "doc"));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller, "doc");

    var ran = await ExecuteAsync(core, caller, handle,
        Command("doc.setTitle", new JsonObject { ["title"] = "T" }),
        Command("block.insert", new JsonObject { ["type"] = "page" }));

    Assert.Equal("FORBIDDEN", (string?)ran["error"]?["code"]);
    Assert.Equal(1, (int?)ran["error"]?["commandIndex"]);
    Assert.NotNull((string?)ran["error"]?["details"]?["pageId"]);
    Assert.NotNull((string?)ran["revision"]);
    Assert.Equal("""{"blocks":[]}""", File.ReadAllText(Path.Combine(dir, "doc.json")));
  }

  [Fact]
  public async Task PageRenameWritesTheTitleIntoThePagesOwnDocument()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"pb","type":"page","data":{"pageId":"child"}}]}""");
    File.WriteAllText(Path.Combine(dir, "child.json"), """{"blocks":[],"title":"Old"}""");
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller, "parent");

    var ran = await ExecuteAsync(core, caller, handle, Command("page.rename", new JsonObject { ["id"] = "pb", ["title"] = "New name" }));

    Assert.Equal(true, (bool?)ran["ok"]);
    Assert.Equal("""[{"pageId":"child","applied":true}]""", ran["results"]?.ToJsonString());
    Assert.Equal(false, (bool?)ran["delivery"]?["durable"]);
    Assert.Equal("{\n  \"title\": \"New name\",\n  \"blocks\": []\n}\n", File.ReadAllText(Path.Combine(dir, "child.json")));
    Assert.Equal("""{"blocks":[{"id":"pb","type":"page","data":{"pageId":"child"}}]}""", File.ReadAllText(Path.Combine(dir, "parent.json")));
  }

  [Fact]
  public async Task PageRenameThenUndoAnswersThatTheStepWroteAnotherDocument()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"pb","type":"page","data":{"pageId":"child"}}]}""");
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller, "parent");

    await ExecuteAsync(core, caller, handle, Command("page.rename", new JsonObject { ["id"] = "pb", ["title"] = "New name" }));
    var undone = await ExecuteAsync(core, caller, handle, Command("history.undo", []));

    Assert.Equal("UNDO_OTHER_DOCUMENT", (string?)undone["error"]?["code"]);
  }

  [Fact]
  public async Task PageSetIconThroughASymlinkToTheOpenDocumentIsRefused()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"pb","type":"page","data":{"pageId":"alias"}}]}""");
    File.CreateSymbolicLink(Path.Combine(dir, "alias.json"), "parent.json");
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller, "parent");

    var ran = await ExecuteAsync(core, caller, handle, Command("page.setIcon", new JsonObject { ["id"] = "pb", ["icon"] = new JsonObject { ["type"] = "emoji", ["value"] = "🌱" } }));

    Assert.Equal("INVALID_ARGS", (string?)ran["error"]?["code"]);
    Assert.Equal("alias", (string?)ran["error"]?["details"]?["pageId"]);
    Assert.Equal(0, (int?)ran["error"]?["commandIndex"]);
  }

  [Fact]
  public async Task PageRenameOfAPageTheHookRefusesIsForbiddenAndNamesThePage()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"pb","type":"page","data":{"pageId":"child"}}]}""");
    File.WriteAllText(Path.Combine(dir, "child.json"), """{"blocks":[],"title":"Old"}""");
    await using var core = Core((_, documentId, _, _) => Task.FromResult(documentId != "child"));
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller, "parent");

    var ran = await ExecuteAsync(core, caller, handle, Command("page.rename", new JsonObject { ["id"] = "pb", ["title"] = "New name" }));

    Assert.Equal("FORBIDDEN", (string?)ran["error"]?["code"]);
    Assert.Equal("You may not open this document with this access.", (string?)ran["error"]?["message"]);
    Assert.Equal("child", (string?)ran["error"]?["details"]?["pageId"]);
    Assert.Equal(0, (int?)ran["error"]?["commandIndex"]);
    Assert.NotNull((string?)ran["revision"]);
    Assert.Equal("""{"blocks":[],"title":"Old"}""", File.ReadAllText(Path.Combine(dir, "child.json")));
  }

  [Fact]
  public async Task APageActionWithOtherCommandsIsRefusedAndWritesNothing()
  {
    File.WriteAllText(Path.Combine(dir, "parent.json"), """{"blocks":[{"id":"pb","type":"page","data":{"pageId":"child"}}]}""");
    await using var core = Core();
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var handle = await OpenAsync(core, caller, "parent");

    var ran = await ExecuteAsync(core, caller, handle,
        Command("page.rename", new JsonObject { ["id"] = "pb", ["title"] = "New name" }),
        Command("doc.setTitle", new JsonObject { ["title"] = "T" }));

    Assert.Equal(false, (bool?)ran["ok"]);
    Assert.False(File.Exists(Path.Combine(dir, "child.json")));
    Assert.Equal("""{"blocks":[{"id":"pb","type":"page","data":{"pageId":"child"}}]}""", File.ReadAllText(Path.Combine(dir, "parent.json")));
  }
}
