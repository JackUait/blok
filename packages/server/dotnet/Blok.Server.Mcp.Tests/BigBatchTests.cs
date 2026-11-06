using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class BigBatchTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-big-").FullName;
  private readonly BundleFixture fixture;

  public BigBatchTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  [Fact]
  public async Task ThreeHundredInsertsOfTwoThousandCharactersAreAppliedAndSaved()
  {
    await using var core = new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);
    var opened = await core.CallToolAsync("blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }, caller, null, CancellationToken.None);
    var commands = new JsonArray();

    for (var index = 0; index < 300; index++)
    {
      commands.Add(new JsonObject
      {
        ["name"] = "block.insert",
        ["args"] = new JsonObject { ["type"] = "paragraph", ["id"] = $"b{index}", ["position"] = "end", ["data"] = new JsonObject { ["text"] = string.Concat(Enumerable.Repeat($"{index}é", 1000)) } },
      });
    }

    var ran = await core.CallToolAsync("blok_execute", new JsonObject { ["handle"] = opened.Answer?["structuredContent"]?["handle"]?.DeepClone(), ["commands"] = commands }, caller, null, CancellationToken.None);

    Assert.Equal(true, McpJson.Bool(ran.Answer?["structuredContent"]?["ok"]));
    Assert.NotNull(McpJson.String(ran.Answer?["structuredContent"]?["delivery"]?["savedVersion"]));
  }
}
