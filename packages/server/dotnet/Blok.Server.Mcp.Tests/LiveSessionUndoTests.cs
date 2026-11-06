using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Live;
using Blok.Server.Mcp.Outbound;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>A live handle's undo and redo through the bundle's approval gate.</summary>
public sealed class LiveSessionUndoTests(BundleFixture fixture) : IClassFixture<BundleFixture>
{
  private static readonly McpCaller Caller = new(
      "alice", "desk", null, new JsonObject { ["id"] = "agent:alice:desk", ["name"] = "desk", ["kind"] = "agent" }, "desk");

  private static readonly JsonObject Elicitation = new() { ["elicitation"] = new JsonObject() };

  [Fact]
  public async Task UndoRedoUndoOfALockAsksAgain()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var session = new LiveSession(
        room, fixture.Host.Bundle, new McpConfig { Sync = new McpSync("ws://127.0.0.1:1/sync", null) }.SurfaceFlags(), Caller, true, "", null,
        new LiveVersionHistory(new McpHttpCaller(), "ws://127.0.0.1:1/sync/doc", null, null), TimeSpan.FromMilliseconds(50));

    await room.Loop.RunAsync(() =>
    {
      session.Start();
      room.WriteLocal(new object(), _ => YDocConverter.ApplyOps(room.Doc, [new CollabEditOp.Insert("db", Database(), null, null)]));
    });

    var locked = await RunAsync(session, "database.setLock", new JsonObject { ["id"] = "db", ["locked"] = true });

    Assert.Equal(true, McpJson.Bool(locked.Answer?["structuredContent"]?["ok"]));
    var asked = await RunAsync(session, "history.undo", []);

    Assert.NotNull(asked.Ask);
    var undone = await RunAsync(session, "history.undo", [], Accept(asked.Ask));

    Assert.Equal(true, McpJson.Bool(undone.Answer?["structuredContent"]?["ok"]));
    var redone = await RunAsync(session, "history.redo", []);

    Assert.Equal(true, McpJson.Bool(redone.Answer?["structuredContent"]?["ok"]));
    var again = await RunAsync(session, "history.undo", []);

    Assert.NotNull(again.Ask);
    await room.CloseAsync();
  }

  private static Task<McpExecuteOutcome> RunAsync(LiveSession session, string name, JsonObject args, JsonObject? replies = null) =>
      session.ExecuteAsync(
          new JsonObject { ["commands"] = new JsonArray(new JsonObject { ["name"] = name, ["args"] = args }) },
          Caller, new McpApproval((JsonObject)Elicitation.DeepClone(), replies, "desk"), CancellationToken.None);

  private static JsonObject Accept(JsonObject? ask) => new()
  {
    [McpJson.String(ask?["key"])!] = new JsonObject { ["action"] = "accept", ["content"] = new JsonObject { ["unlock"] = true } },
  };

  private static JsonObject Database() => new()
  {
    ["type"] = "database",
    ["data"] = new JsonObject
    {
      ["title"] = "Payroll",
      ["activeViewId"] = "v",
      ["schema"] = new JsonArray(new JsonObject { ["id"] = "t", ["name"] = "Name", ["type"] = "title", ["position"] = "a0" }),
      ["views"] = new JsonArray(new JsonObject { ["id"] = "v", ["name"] = "Table", ["type"] = "table", ["position"] = "a0", ["sorts"] = new JsonArray(), ["filters"] = new JsonArray(), ["visibleProperties"] = new JsonArray() }),
    },
  };
}
