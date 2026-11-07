using System.Text.Json.Nodes;
using Blok.Server.Mcp.Protocol;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>Reads test/unit/server-conformance/fixtures/mcp-depth-clamp.json, which the Go and Rust MCP tests read too.</summary>
public sealed class McpDepthClampTests
{
  private static JsonObject Vectors()
  {
    for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
    {
      var path = Path.Combine(directory.FullName, "test/unit/server-conformance/fixtures/mcp-depth-clamp.json");

      if (File.Exists(path))
      {
        return (JsonObject)JsonNode.Parse(File.ReadAllText(path))!;
      }
    }

    throw new InvalidOperationException("mcp-depth-clamp.json not found");
  }

  [Fact]
  public void ClampsAsTheSharedVectorsSay()
  {
    var vectors = Vectors();

    Assert.Equal(McpDepthClamp.MessageLimit, (int)vectors["hostLimit"]!);
    foreach (var item in vectors["cases"]!.AsArray())
    {
      var input = (string)item!["input"]!;
      var output = (string)item["output"]!;

      Assert.True(output == McpDepthClamp.Clamp(input, (int)item["limit"]!), (string?)item["name"]);
    }
  }

  [Fact]
  public void TakesAHundredThousandLevels()
  {
    var deep = new string('[', 100000) + new string(']', 100000);

    Assert.Equal("""{"a":[[[]]]}""", McpDepthClamp.Clamp("{\"a\":" + deep + "}", 3));
  }
}
