using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>The adapter between the room and YDocConverter; the converter's own laws live in its conformance tests.</summary>
public sealed class CollabDocConverterTests
{
  private readonly ManualTimeProvider time = new();

  [Fact]
  public void SeedsTheBlocksOfAnOutputDataObjectAndExportsThemBackWithATimestamp()
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time);
    var document = JsonNode.Parse(
        """{"time":1,"blocks":[{"id":"a","type":"paragraph","data":{"text":"hi"}}],"version":"1.12.0"}""")!;

    converter.Seed(doc, document);
    var exported = Assert.IsType<JsonObject>(converter.Export(doc));

    Assert.Equal(time.GetUtcNow().ToUnixTimeMilliseconds(), exported["time"]?.GetValue<long>());
    var block = Assert.IsType<JsonObject>(Assert.Single(Assert.IsType<JsonArray>(exported["blocks"])));
    Assert.Equal("a", block["id"]?.GetValue<string>());
    Assert.Equal("paragraph", block["type"]?.GetValue<string>());
    Assert.Equal("hi", block["data"]?["text"]?.GetValue<string>());
  }

  [Theory]
  [InlineData("[]")]
  [InlineData("\"text\"")]
  [InlineData("""{"time":1}""")]
  [InlineData("""{"blocks":{}}""")]
  public void RefusesADocumentWithoutABlocksArray(string body)
  {
    var doc = new YDoc();
    var converter = new CollabDocConverter(time);

    Assert.Throws<InvalidDataException>(() => converter.Seed(doc, JsonNode.Parse(body)!));
  }
}
