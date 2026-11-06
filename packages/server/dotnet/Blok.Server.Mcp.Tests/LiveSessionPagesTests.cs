using System.Text.Json.Nodes;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>A live handle's page inserts: the pages are made before the batch, as a stored handle makes them.</summary>
public sealed class LiveSessionPagesTests(BundleFixture fixture) : IClassFixture<BundleFixture>
{
  private static readonly McpCaller Caller = new(
      "alice", "desk", null, new JsonObject { ["id"] = "agent:alice:desk", ["name"] = "desk", ["kind"] = "agent" }, "desk");

  [Fact]
  public async Task AnInsertedPageTakesTheIdOfThePageMadeForIt()
  {
    var (session, made, room) = await OpenAsync();

    var outcome = await session.ExecuteAsync(Batch(new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["id"] = "pg" } }), Caller, null, CancellationToken.None);

    Assert.Equal(true, McpJson.Bool(outcome.Answer?["structuredContent"]?["ok"]));
    Assert.Equal(["page-1"], made);
    Assert.Equal("page-1", McpJson.String(outcome.Answer?["structuredContent"]?["blocks"]?[0]?["data"]?["pageId"]));
    await room.CloseAsync();
  }

  [Fact]
  public async Task ARefusedBatchMakesNoPage()
  {
    var (session, made, room) = await OpenAsync();

    var outcome = await session.ExecuteAsync(Batch(
        new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page" } },
        new JsonObject { ["name"] = "no.suchCommand", ["args"] = new JsonObject() }), Caller, null, CancellationToken.None);

    Assert.Equal(false, McpJson.Bool(outcome.Answer?["structuredContent"]?["ok"]));
    Assert.Empty(made);
    await room.CloseAsync();
  }

  [Fact]
  public async Task ABatchRefusedAfterItsPageWasPreparedStillMakesThePage()
  {
    var (session, made, room) = await OpenAsync();

    var outcome = await session.ExecuteAsync(Batch(
        new JsonObject { ["name"] = "block.insert", ["args"] = new JsonObject { ["type"] = "page", ["data"] = new JsonObject { ["title"] = "Child" } } }),
        Caller, null, CancellationToken.None);
    var error = outcome.Answer?["structuredContent"]?["error"];

    Assert.Equal("ORPHANED_SIDE_EFFECT", McpJson.String(error?["code"]));
    Assert.Equal(["page-1"], made);
    Assert.Equal("page-1", McpJson.String(error?["details"]?["orphaned"]?[0]?["prepared"]?["pageId"]));
    await room.CloseAsync();
  }

  private async Task<(LiveSession Session, List<string> Made, LiveRoom Room)> OpenAsync()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var flags = new McpConfig { PageTitles = "page-map", Sync = new McpSync("ws://127.0.0.1:1/sync", null) }.SurfaceFlags();
    var made = new List<string>();
    var session = new LiveSession(
        room, fixture.Host.Bundle, flags, Caller, true, "", null,
        new LiveVersionHistory(new McpHttpCaller(), "ws://127.0.0.1:1/sync/doc", null, null), TimeSpan.FromMilliseconds(50))
    {
      CreatePage = (_, _) =>
      {
        made.Add($"page-{made.Count + 1}");

        return Task.FromResult(made[^1]);
      },
    };

    await room.Loop.RunAsync(session.Start);

    return (session, made, room);
  }

  private static JsonObject Batch(params JsonObject[] commands) => new() { ["commands"] = new JsonArray(commands) };
}
