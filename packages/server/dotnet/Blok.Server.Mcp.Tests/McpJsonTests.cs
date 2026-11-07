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

  // JSON.stringify's bytes: only " \ and controls are escaped, everything else stays raw.
  [Fact]
  public void WritesStringsAsJsonStringifyDoes()
  {
    var text = "A\U0001F600 \u2028\u2029\u007F\u00A0\uFEFF\u00E9<>&'+ \" \\ \b\f\n\r\t\u0001\u001F";
    var node = new JsonObject { ["k\u2028\"" ] = text };

    Assert.Equal(
        "{\"k\u2028\\\"\":\"A\U0001F600 \u2028\u2029\u007F\u00A0\uFEFF\u00E9<>&'+ \\\" \\\\ \\b\\f\\n\\r\\t\\u0001\\u001f\"}",
        McpJson.Write(node));
  }

  // The decided policy for a lone UTF-16 surrogate: it becomes U+FFFD.
  [Fact]
  public void WritesALoneSurrogateAsTheReplacementCharacter()
  {
    Assert.Equal("[\"a\uFFFDb\",\"\uFFFD\"]", McpJson.Write(new JsonArray("a\uD800b", "\uDC00")));
  }

  // System.Text.Json refuses to read "\ud800" as a string; JSON.parse keeps it, and the policy makes it U+FFFD.
  [Fact]
  public void ReadsALoneSurrogateEscapeAsTheReplacementCharacter()
  {
    var parsed = McpJson.Parse("""{"a":"x\ud800y\udc00","b":"\ud83d\ude00\n\u00e9\/"}""");

    Assert.Equal("x\uFFFDy\uFFFD", McpJson.String(parsed!["a"]));
    Assert.Equal("\U0001F600\n\u00e9/", McpJson.String(parsed["b"]));
  }
}
