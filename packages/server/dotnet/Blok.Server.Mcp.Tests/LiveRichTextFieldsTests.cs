using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>A live handle reads a custom tool's rich field as rich text, as Node's richTextFieldsFor says.</summary>
public sealed class LiveRichTextFieldsTests(BundleFixture fixture) : IClassFixture<BundleFixture>
{
  private static readonly McpCaller Caller = new(
      "alice", "desk", null, new JsonObject { ["id"] = "agent:alice:desk", ["name"] = "desk", ["kind"] = "agent" }, "desk");

  [Fact]
  public async Task AFieldNamedByRichTextFieldsReadsAsRichText()
  {
    var fields = RichTextFields.With([new("note", ["body"])]);
    var (room, _) = await LiveRoomTests.OpenAsync();
    var seed = new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(fixture.Host.Bundle.Runtime), fields);

    await room.Loop.RunAsync(() => seed.SeedAsync(room.Doc, JsonNode.Parse("""{"blocks":[{"id":"n1","type":"note","data":{"body":"<b>Bold</b> text"}}]}""")!).AsTask());
    var flags = new McpConfig { Sync = new McpSync("ws://127.0.0.1:1/sync", null), RichTextFields = new JsonObject { ["note"] = new JsonArray("body") } }.SurfaceFlags();
    var session = new LiveSession(
        room, fixture.Host.Bundle, flags, Caller, false, "", null,
        new LiveVersionHistory(new McpHttpCaller(), "ws://127.0.0.1:1/sync/doc", null, null))
    { Fields = fields };

    await room.Loop.RunAsync(session.Start);
    var read = await session.ReadAsync(new JsonObject { ["detail"] = "full" }, CancellationToken.None);

    Assert.Equal("""[{"text":"Bold","marks":{"bold":true}},{"text":" text"}]""", read["structuredContent"]?["blocks"]?[0]?["data"]?["body"]?.ToJsonString());
    await room.CloseAsync();
  }

  [Fact]
  public async Task RichTextFieldsCountOnlyForTypesTheManifestDoesNotList()
  {
    var config = new McpConfig
    {
      Sync = new McpSync("ws://127.0.0.1:1/sync", null),
      RichTextFields = new JsonObject { ["note"] = new JsonArray("body"), ["paragraph"] = new JsonArray("caption") },
    };
    var opener = new LiveOpener(config, new McpHttpCaller(), fixture.Host.Bundle, config.SurfaceFlags(), _ => Task.FromResult(new JsonObject()));

    var fields = await opener.RichTextFieldsAsync();

    Assert.True(fields.IsRich("note", "body"));
    Assert.True(fields.IsRich("paragraph", "text"));
    Assert.False(fields.IsRich("paragraph", "caption"));
  }
}
