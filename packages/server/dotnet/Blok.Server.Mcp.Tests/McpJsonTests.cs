using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class McpJsonTests
{
  // JSON.parse keeps the last value at the first key's place: {"a":3,"b":2}.
  [Fact]
  public void ARepeatedKeyKeepsItsLastValueAtItsFirstPlace()
  {
    var parsed = McpJson.Parse("""{"a":1,"b":{"c":1,"c":[1,{"d":2,"d":3}]},"a":3}""");

    Assert.Equal("""{"a":3,"b":{"c":[1,{"d":3}]}}""", McpJson.Write(parsed));
  }

  [Fact]
  public void KeepsNumbersStringsAndDepthAsBefore()
  {
    var deep = new string('[', 900) + new string(']', 900);

    const string text = "{\"n\":1.50,\"big\":12345678901234567890,\"s\":\"\\u00e9<\"}";

    Assert.Equal("{\"n\":1.50,\"big\":12345678901234567890,\"s\":\"\u00e9<\"}", McpJson.Write(McpJson.Parse(text)));
    Assert.Equal(1.5, McpJson.Number(McpJson.Parse("1.5")));
    Assert.Equal(deep, McpJson.Write(McpJson.Parse(deep)));
    Assert.Null(McpJson.Parse("null"));
    Assert.ThrowsAny<JsonException>(() => McpJson.Parse("{"));
  }
}
