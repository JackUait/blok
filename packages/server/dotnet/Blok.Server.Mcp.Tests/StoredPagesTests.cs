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

  private McpServerCore Core()
  {
    return new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir), PageTitles = "page-map" }, new McpHttpCaller());
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
}
