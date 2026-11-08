using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Mcp.Core;
using Blok.Server.Mcp.Live;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Mcp.Tests;

/// <summary>The agent's live undo steps, as store-applier.ts and the executor's marks keep them.</summary>
public sealed class LiveAgentHistoryTests
{
  private static readonly JsonObject Pair = new() { ["document"] = new JsonObject { ["blocks"] = new JsonArray() }, ["history"] = new JsonObject() };

  [Fact]
  public async Task UndoAndRedoReplayTheStepAsOneWriteEach()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "one");
      var undone = history.Replay(true, Pair);

      Assert.Null(undone);
      Assert.Empty(Ids(room));
      Assert.Equal("l2", room.Revision);
      Assert.Null(history.Replay(false, Pair));
      Assert.Equal(["p1"], Ids(room));
      Assert.Equal("l3", room.Revision);
      Assert.Equal(3, room.Outbox.AppendedCount);
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task APeerRemovingTheStepsBlockIsAConflictAndWritesNothing()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "keep");
      Insert(room, history, origin, "p2", "gone");
      var peer = new YDoc();

      peer.ApplyUpdate(room.Doc.EncodeStateAsUpdate());
      room.ApplyRemote(peer.Transact(tx => YDocConverter.ApplyOps(peer, [new CollabEditOp.Remove("p2")]))!);
      var refused = history.Replay(true, Pair);

      Assert.Equal("CONFLICT", refused?["code"]?.GetValue<string>());
      Assert.Equal(
          "Someone else changed the blocks this step added, removed or moved, so it can no longer be undone. Re-read the document before retrying.",
          refused?["message"]?.GetValue<string>());
      Assert.Equal("l3", room.Revision);
      Assert.Equal(2, room.Outbox.AppendedCount);
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task ARestoreRefusesUndoAndRedoBehindIt()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "one");
      history.MarkRestored("L1:1");

      var undo = history.GateFor(true);
      var redo = history.GateFor(false);

      Assert.Equal("UNDO_OTHER_DOCUMENT", undo.Refusal?["when"]?.GetValue<string>());
      Assert.Equal(
          "The last batch restored a version. history.undo cannot undo a restore. To go back, history.restore \"L1:1\", the version that was current before.",
          undo.Refusal?["error"]?["message"]?.GetValue<string>());
      Assert.Equal("[]", undo.Document["blocks"]?.ToJsonString());
      Assert.Equal("NOTHING_TO_REDO", redo.Refusal?["error"]?["code"]?.GetValue<string>());
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task TheGateGetsTheBundlePairOfTheStepOnTop()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);
      var after = new JsonObject { ["document"] = new JsonObject { ["blocks"] = new JsonArray("after") }, ["history"] = new JsonObject { ["past"] = new JsonArray("before") } };

      Assert.Equal("[]", history.GateFor(true).Document["blocks"]?.ToJsonString());
      Insert(room, history, origin, "p1", "one", after);
      Assert.Equal("[\"after\"]", history.GateFor(true).Document["blocks"]?.ToJsonString());
      Assert.Equal("{\"past\":[\"before\"]}", history.GateFor(true).History.ToJsonString());
      Assert.Equal("[]", history.GateFor(false).Document["blocks"]?.ToJsonString());
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task ACommentBatchIsNoStepSoUndoRevertsTheWriteBeforeIt()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "one");

      Assert.Null(history.GateFor(true).Refusal);
      Assert.Null(history.Replay(true, Pair));
      Assert.Empty(Ids(room));
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task ACommentAfterARestoreLeavesUndoRefused()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "one");
      history.MarkRestored("v1");

      Assert.Equal("UNDO_RESTORED", McpJson.String(history.GateFor(true).Refusal?["error"]?["code"]));
    });
    await room.CloseAsync();
  }

  [Theory]
  [InlineData(false, null)]
  [InlineData(true, "CONFLICT")]
  public async Task APeerFlippingALockTheStepChangedRefusesTheReplay(bool peerLocks, string? refusal)
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);
      // The step unlocked db: the bundle's pair is the document after it and, as the undo target, before it.
      var pair = new JsonObject
      {
        ["document"] = new JsonObject { ["blocks"] = new JsonArray(Database(false)) },
        ["history"] = new JsonObject { ["past"] = new JsonArray(new JsonObject { ["blocks"] = new JsonArray(Database(true)) }) },
      };
      var edits = new JsonArray(new JsonObject { ["op"] = "setData", ["id"] = "db", ["patch"] = new JsonObject() });

      room.WriteLocal(new object(), _ => YDocConverter.ApplyOps(room.Doc, [new CollabEditOp.Insert("db", Database(true), null, null)]));
      history.Apply(edits, () => room.WriteLocal(origin, _ => YDocConverter.ApplyOps(room.Doc, [new CollabEditOp.Update("db", (JsonObject)Database(false)["data"]!)])), pair);
      if (peerLocks)
      {
        room.WriteLocal(new object(), _ => YDocConverter.ApplyOps(room.Doc, [new CollabEditOp.Update("db", (JsonObject)Database(true)["data"]!)]));
      }

      Assert.Equal(refusal, history.Replay(true, Pair)?["code"]?.GetValue<string>());
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task EachGateIsItsOwnJson()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, new object());

      history.MarkRestored(null);
      _ = new JsonObject { ["document"] = history.GateFor(true).Document, ["history"] = history.GateFor(true).History };
      _ = new JsonObject { ["document"] = history.GateFor(false).Document, ["history"] = history.GateFor(false).History };
    });
    await room.CloseAsync();
  }

  private static JsonObject Database(bool locked) => new()
  {
    ["id"] = "db",
    ["type"] = "database",
    ["data"] = new JsonObject
    {
      ["title"] = "Payroll",
      ["activeViewId"] = "v",
      ["schema"] = new JsonArray(new JsonObject { ["id"] = "t", ["name"] = "Name", ["type"] = "title", ["position"] = "a0", ["databaseLocked"] = locked }),
      ["views"] = new JsonArray(new JsonObject { ["id"] = "v", ["name"] = "Table", ["type"] = "table", ["position"] = "a0" }),
    },
  };

  [Fact]
  public async Task AfterTheRoomCopyIsSwappedInOnlyLaterStepsAreUndone()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "refused");
      Insert(room, history, origin, "p2", "refused too");
      Assert.Null(history.Replay(true, Pair));
      room.RebuildFromRoom();
      room.ApplyRemote(new YDoc().EncodeStateAsUpdate());
      var appended = room.Outbox.AppendedCount;

      Assert.Equal("NOTHING_TO_UNDO", history.Replay(true, Pair)?["code"]?.GetValue<string>());
      Assert.Equal("NOTHING_TO_REDO", history.Replay(false, Pair)?["code"]?.GetValue<string>());
      Assert.Equal(appended, room.Outbox.AppendedCount);

      Insert(room, history, origin, "p3", "later");
      Assert.Null(history.Replay(true, Pair));
      Assert.Empty(Ids(room));
      Assert.Null(history.Replay(false, Pair));
      Assert.Equal(["p3"], Ids(room));
    });
    await room.CloseAsync();
  }

  [Fact]
  public async Task ARoomWriteThatThrowsLeavesNoUndoStep()
  {
    var (room, _) = await LiveRoomTests.OpenAsync();
    var origin = new object();

    await room.Loop.RunAsync(() =>
    {
      var history = new LiveAgentHistory(room, origin);

      Insert(room, history, origin, "p1", "one");
      Assert.Throws<InvalidOperationException>(() => history.Apply(
          new JsonArray(),
          () => room.WriteLocal(origin, _ => throw new InvalidOperationException("write failed")),
          Pair));

      Assert.Null(history.Replay(true, Pair));
      Assert.Empty(Ids(room));
      Assert.Equal("NOTHING_TO_UNDO", history.Replay(true, Pair)?["code"]?.GetValue<string>());
    });
    await room.CloseAsync();
  }

  private static void Insert(LiveRoom room, LiveAgentHistory history, object origin, string id, string text, JsonObject? gate = null)
  {
    var edits = new JsonArray(new JsonObject
    {
      ["op"] = "insert",
      ["block"] = new JsonObject { ["id"] = id, ["type"] = "paragraph", ["data"] = new JsonObject(), ["children"] = new JsonArray() },
      ["parentId"] = null,
      ["afterId"] = null,
    });
    var last = Ids(room).LastOrDefault();

    history.Apply(edits, () => room.WriteLocal(origin, _ => YDocConverter.ApplyOps(room.Doc,
        [new CollabEditOp.Insert(id, new JsonObject { ["type"] = "paragraph", ["data"] = new JsonObject { ["note"] = text } }, last, null)])),
        gate ?? Pair);
  }

  private static List<string> Ids(LiveRoom room) =>
      [.. YDocConverter.Export(room.Doc, RichTextFields.BuiltIn, null, out _).OfType<JsonObject>().Select(block => block["id"]!.GetValue<string>())];
}
