using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Node's JSON.parse reads 1e400 in the arguments as Infinity.</summary>
public sealed class OverflowingNumberTests : IClassFixture<BundleFixture>, IDisposable
{
  private readonly string dir = Directory.CreateTempSubdirectory("blok-mcp-overflow-").FullName;
  private readonly BundleFixture fixture;

  public OverflowingNumberTests(BundleFixture fixture)
  {
    this.fixture = fixture;
    File.WriteAllText(Path.Combine(dir, "doc.json"), """{"blocks":[]}""");
  }

  public void Dispose()
  {
    Directory.Delete(dir, recursive: true);
  }

  [Fact]
  public async Task AListLimitTakesItAndAReadViewRefusesItAsNotFinite()
  {
    await using var core = new McpServerCore(fixture.Host.Bundle, new McpConfig { Source = new McpSourceConfig.Files(dir) }, new McpHttpCaller());
    var caller = await core.CallerAsync("alice", "desk", null, CancellationToken.None);

    foreach (var limit in new[] { "1e400", "-1e400" })
    {
      var listed = await core.CallToolAsync("blok_list_documents", (JsonObject)JsonNode.Parse($$"""{"limit":{{limit}}}""")!, caller, null, CancellationToken.None);

      Assert.NotNull(listed.Answer?["structuredContent"]?["documents"]);
    }
    var opened = await core.CallToolAsync("blok_open", (JsonObject)JsonNode.Parse("""{"documentId":"doc","view":{"limit":1e400}}""")!, caller, null, CancellationToken.None);

    Assert.Equal("doc.read: must be a finite number", McpJson.String(opened.Answer?["structuredContent"]?["error"]?["message"]));
  }
}
