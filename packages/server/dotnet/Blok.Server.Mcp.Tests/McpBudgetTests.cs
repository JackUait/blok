using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class McpBudgetTests : IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-budget-").FullName;

  public McpBudgetTests()
  {
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  // A batch past the engine's budget is the agent's to split, not a JSON-RPC -32603.
  [Fact]
  public async Task ABatchPastTheAllocationBudgetIsAToolError()
  {
    // 256 MiB opens a document; 300 inserts of 2000 characters need about 760 MiB.
    var bundle = new McpBundle(JintBlokRuntime.FromEmbeddedResource(1, TimeSpan.FromSeconds(60), 256L << 20));
    await using var core = new McpServerCore(bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var caller = await core.CallerAsync("local", "test", null, CancellationToken.None);
    var open = await core.CallToolAsync("blok_open", new JsonObject { ["documentId"] = "doc", ["write"] = true }, caller, null, CancellationToken.None);
    var commands = new JsonArray([.. Enumerable.Range(0, 300).Select(_ => (JsonNode)new JsonObject
    {
      ["name"] = "block.insert",
      ["args"] = new JsonObject { ["type"] = "paragraph", ["data"] = new JsonObject { ["text"] = new string('a', 2000) } },
    })]);

    var result = await core.CallToolAsync(
        "blok_execute", new JsonObject { ["handle"] = open.Answer!["structuredContent"]!["handle"]!.DeepClone(), ["commands"] = commands }, caller, null, CancellationToken.None);
    var answer = result.Answer!;

    Assert.True((bool?)answer["isError"]);
    Assert.Equal("INVALID_ARGS", (string?)answer["structuredContent"]?["error"]?["code"]);
    Assert.False((bool?)answer["structuredContent"]?["error"]?["retryable"]);
  }
}
