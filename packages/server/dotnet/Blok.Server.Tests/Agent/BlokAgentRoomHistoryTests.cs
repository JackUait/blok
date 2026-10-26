using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentRoomHistoryTests
{
  private const string Undo = """{"commands":[{"name":"history.undo","args":{}}]}""";
  private const string Redo = """{"commands":[{"name":"history.redo","args":{}}]}""";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Agent");
  private static readonly string[] LostRace = ["NOTHING_TO_UNDO", "CONFLICT"];
  private static readonly JsonObject Seed = JsonNode.Parse("""
      {"blocks":[
        {"id":"p","type":"paragraph","data":{"text":"Hello"}},
        {"id":"q","type":"paragraph","data":{"text":"Other"}}
      ]}
      """)!.AsObject();

  private static string Insert(string id, string text) =>
      new JsonObject
      {
        ["commands"] = new JsonArray(new JsonObject
        {
          ["name"] = "block.insert",
          ["args"] = new JsonObject { ["id"] = id, ["type"] = "paragraph", ["data"] = new JsonObject { ["text"] = text }, ["position"] = "end" },
        }),
      }.ToJsonString();

  private static string Replace(string id, string text) =>
      new JsonObject
      {
        ["commands"] = new JsonArray(new JsonObject
        {
          ["name"] = "text.replace",
          ["args"] = new JsonObject { ["id"] = id, ["with"] = text },
        }),
      }.ToJsonString();

  private static async Task<JsonObject> RunAsync(AgentRoomForTests room, string batch, BlokAgentActor? actor = null) =>
      JsonNode.Parse((await room.Executor.ExecuteInRoomAsync(room.DocId, batch, actor ?? Actor)).ResultJson)!.AsObject();

  private static async Task<JsonObject> OkAsync(AgentRoomForTests room, string batch)
  {
    var result = await RunAsync(room, batch);

    Assert.True(result["ok"]!.GetValue<bool>(), result.ToJsonString());

    return result;
  }

  private static string Code(JsonObject result) => result["error"]!["code"]!.GetValue<string>();

  private static async Task<string[]> IdsAsync(AgentRoomForTests room) =>
      [.. (await room.ExportAsync())["blocks"]!.AsArray().Select(block => block!["id"]!.GetValue<string>())];

  private static async Task<string> TextAsync(AgentRoomForTests room, string id) =>
      (await room.ExportAsync())["blocks"]!.AsArray().Single(block => block!["id"]!.GetValue<string>() == id)!["data"]!["text"]!.ToJsonString();

  private static AgentRoomForTests Open() => AgentRoomForTests.Seed($"history-{Guid.NewGuid():N}", Seed);

  private static async Task PeerWritesAsync(AgentRoomForTests room, string id, string text)
  {
    var edit = await room.Manager.EditAsync(
        room.DocId,
        [new CollabEditOp.Update(id, new JsonObject { ["text"] = text })],
        Guid.NewGuid().ToString("N"),
        Guid.NewGuid().ToByteArray(),
        "human-2");

    Assert.Equal(CollabEditStatus.Applied, edit.Status);
  }

  private static bool Locked(JsonObject export) =>
      export["blocks"]!.AsArray().Single(block => block!["id"]!.GetValue<string>() == "db")!["data"]!["schema"]!.AsArray()
          .Any(property => property!["databaseLocked"]?.GetValue<bool>() == true);

  // Undoing a lock unlocks, and a room has no person to ask, so it is refused like database.setLock.
  [Fact]
  public async Task RefusesToUndoALockBecauseNoPersonCanApproveTheUnlock()
  {
    await using var room = AgentRoomForTests.Seed($"history-{Guid.NewGuid():N}", JsonNode.Parse("""
        {"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Tasks","activeViewId":"v",
          "views":[{"id":"v","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"}]}}]}
        """)!.AsObject());

    await OkAsync(room, """{"commands":[{"name":"database.setLock","args":{"id":"db","locked":true}}]}""");
    Assert.True(Locked(await room.ExportAsync()));

    var result = await RunAsync(room, Undo);

    Assert.Equal("APPROVAL_REQUIRED", Code(result));
    Assert.Equal("no-channel", result["error"]!["details"]!["reason"]!.GetValue<string>());
    Assert.True(Locked(await room.ExportAsync()));
  }

  // Undoing the delete of a public form brings a public form back: a sharing change no one here can approve.
  [Fact]
  public async Task RefusesToUndoADeleteThatBringsBackAPublicForm()
  {
    await using var room = AgentRoomForTests.Seed($"history-{Guid.NewGuid():N}", JsonNode.Parse("""
        {"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Tasks","activeViewId":"v",
          "views":[{"id":"v","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]},
            {"id":"f","name":"Signup","type":"form","position":"a1","filters":[],"sorts":[],"visibleProperties":[],"form":{"public":true}}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"}]}}]}
        """)!.AsObject());

    await OkAsync(room, """{"commands":[{"name":"database.deleteView","args":{"id":"db","viewId":"f"}}]}""");

    var result = await RunAsync(room, Undo);
    var views = (await room.ExportAsync())["blocks"]!.AsArray().Single(block => block!["id"]!.GetValue<string>() == "db")!["data"]!["views"]!.AsArray();

    Assert.Equal("APPROVAL_REQUIRED", Code(result));
    Assert.Equal("database.share", result["error"]!["details"]!["approval"]!["kind"]!.GetValue<string>());
    Assert.DoesNotContain(views, view => view!["id"]!.GetValue<string>() == "f");
  }

  // Every view that comes back counts, as in the shared runtime: one with no id, or a value Blok cannot read.
  [Theory]
  [InlineData("""{"name":"Signup","type":"form","position":"a1","filters":[],"sorts":[],"visibleProperties":[],"form":{"public":true}}""")]
  [InlineData("""{"id":"f","name":"Signup","type":"form","position":"a1","filters":[],"sorts":[],"visibleProperties":[],"form":{"submissionAccess":"everyone"}}""")]
  [InlineData("""{"id":"f","name":"Signup","type":"form","position":"a1","filters":[],"sorts":[],"visibleProperties":[],"form":{"public":"yes"}}""")]
  public async Task RefusesToUndoADeleteThatBringsBackAViewItCannotShowThePerson(string view)
  {
    await using var room = AgentRoomForTests.Seed($"history-{Guid.NewGuid():N}", JsonNode.Parse($$$"""
        {"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}},{"id":"db","type":"database","content":[],"data":{"title":"Tasks","activeViewId":"v",
          "views":[{"id":"v","name":"Table","type":"table","position":"a0","filters":[],"sorts":[],"visibleProperties":[]},{{{view}}}],
          "schema":[{"id":"t","name":"Name","type":"title","position":"a0"}]}}]}
        """)!.AsObject());

    await OkAsync(room, """{"commands":[{"name":"block.delete","args":{"id":"db"}}]}""");

    var result = await RunAsync(room, Undo);

    Assert.Equal("APPROVAL_REQUIRED", Code(result));
    Assert.DoesNotContain((await room.ExportAsync())["blocks"]!.AsArray(), block => block!["id"]!.GetValue<string>() == "db");
  }

  [Fact]
  public async Task UndoesAndRedoesOnlyTheLastBatch()
  {
    await using var room = Open();

    await OkAsync(room, Insert("a", "first"));
    await OkAsync(room, Insert("b", "second"));
    var undone = await OkAsync(room, Undo);

    Assert.Equal(["p", "q", "a"], await IdsAsync(room));
    Assert.False(string.IsNullOrEmpty(undone["revision"]?.GetValue<string>()));
    await OkAsync(room, Redo);
    Assert.Equal(["p", "q", "a", "b"], await IdsAsync(room));
  }

  [Fact]
  public async Task AnswersNothingToUndoAndNothingToRedo()
  {
    await using var room = Open();

    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo)));
    Assert.Equal("NOTHING_TO_REDO", Code(await RunAsync(room, Redo)));
    await OkAsync(room, Insert("a", "first"));
    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo, new BlokAgentActor("agent-2", "Other"))));
  }

  [Fact]
  public async Task KeepsAPeersEditToAnotherBlock()
  {
    await using var room = Open();

    await OkAsync(room, Replace("p", "Agent"));
    await PeerWritesAsync(room, "q", "Peer");
    await OkAsync(room, Undo);

    Assert.Contains("Hello", await TextAsync(room, "p"), StringComparison.Ordinal);
    Assert.Contains("Peer", await TextAsync(room, "q"), StringComparison.Ordinal);
  }

  [Fact]
  public async Task RefusesWithConflictWhenAPeerChangedTheStepsBlock()
  {
    await using var room = Open();

    await OkAsync(room, Insert("a", "Agent"));
    await PeerWritesAsync(room, "a", "Peer typed here");
    var before = (await room.ExportAsync())["blocks"]!.ToJsonString();

    Assert.Equal("CONFLICT", Code(await RunAsync(room, Undo)));
    Assert.Equal(before, (await room.ExportAsync())["blocks"]!.ToJsonString());
  }

  [Fact]
  public async Task PutsAMovedBlockBackAndTakesBackATitle()
  {
    await using var room = Open();

    await OkAsync(room, """{"commands":[{"name":"block.move","args":{"id":"q","position":{"before":"p"}}}]}""");
    Assert.Equal(["q", "p"], await IdsAsync(room));
    await OkAsync(room, Undo);
    Assert.Equal(["p", "q"], await IdsAsync(room));

    await OkAsync(room, """{"commands":[{"name":"doc.setTitle","args":{"title":"Agent title"}}]}""");
    Assert.Equal("Agent title", (await room.ExportAsync())["title"]?.GetValue<string>());
    await OkAsync(room, Undo);
    Assert.Null((await room.ExportAsync())["title"]);
    await OkAsync(room, Redo);
    Assert.Equal("Agent title", (await room.ExportAsync())["title"]?.GetValue<string>());
  }

  [Fact]
  public async Task ForgetsItsStepsWhenTheDocumentIsPurgedAndMadeAgain()
  {
    await using var room = Open();

    await OkAsync(room, Insert("a", "Agent"));
    await room.Manager.PurgeDocumentAsync(room.DocId, _ => ValueTask.FromResult(true));

    // The id may hold a new document next; the old steps must not reach it.
    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo)));
  }

  [Fact]
  public async Task ForgetsItsStepsWhenAVersionIsRestored()
  {
    await using var room = Open();
    var head = (await room.Manager.StateAsync(room.DocId)).Head!;

    await OkAsync(room, Replace("p", "Agent"));
    var restore = await room.Manager.RestoreAsync(room.DocId, head.Tag.Lineage, head.ServerSequence, Guid.NewGuid().ToString("N"), "human-2");

    Assert.Equal(CollabEditStatus.Applied, restore.Edit?.Status);
    var before = (await room.ExportAsync())["blocks"]!.ToJsonString();

    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo)));
    Assert.Equal(before, (await room.ExportAsync())["blocks"]!.ToJsonString());
  }

  [Fact]
  public async Task ForgetsItsStepsWhenTheRoomIsReset()
  {
    await using var room = Open();

    await OkAsync(room, Replace("p", "Agent"));
    await room.Manager.ResetAsync(room.DocId);
    var before = (await room.ExportAsync())["blocks"]!.ToJsonString();

    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo)));
    Assert.Equal(before, (await room.ExportAsync())["blocks"]!.ToJsonString());
  }

  [Fact]
  public async Task OnePersonCannotUndoTheBatchTheAgentWroteForAnother()
  {
    await using var room = Open();
    var forA = new BlokAgentActor("agent-cs", "Agent", "person-a");
    var forB = new BlokAgentActor("agent-cs", "Agent", "person-b");

    Assert.True((await RunAsync(room, Insert("a", "For A"), forA))["ok"]!.GetValue<bool>());

    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo, forB)));
    Assert.Equal(["p", "q", "a"], await IdsAsync(room));
    Assert.True((await RunAsync(room, Undo, forA))["ok"]!.GetValue<bool>());
  }

  [Fact]
  public async Task RefusesUndoTheContractDoesNotOffer()
  {
    await using var room = AgentRoomForTests.Seed($"history-{Guid.NewGuid():N}", Seed, real => new NoHistoryRuntime(real));

    await OkAsync(room, Insert("a", "Agent"));

    Assert.Equal("COMMAND_UNAVAILABLE", Code(await RunAsync(room, Undo)));
    Assert.Equal(["p", "q", "a"], await IdsAsync(room));
  }

  [Fact]
  public async Task TwoUndosAtOnceTakeTheStepBackOnce()
  {
    await using var room = Open();

    await OkAsync(room, Insert("a", "Agent"));
    var results = await Task.WhenAll(RunAsync(room, Undo), RunAsync(room, Undo));

    Assert.Single(results, result => result["ok"]!.GetValue<bool>());
    Assert.Contains(Code(results.Single(result => !result["ok"]!.GetValue<bool>())), LostRace);
    Assert.Equal(["p", "q"], await IdsAsync(room));
    await OkAsync(room, Redo);
    Assert.Equal(["p", "q", "a"], await IdsAsync(room));
  }

  /// <summary>Answers a history batch as a contract without history.* would; everything else runs for real.</summary>
  private sealed class NoHistoryRuntime(IBlokRuntime inner) : IBlokRuntime
  {
    public ValueTask<string> InvokeAsync(string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      var name = JsonNode.Parse(inputJson)?["batch"]?["commands"]?[0]?["name"]?.GetValue<string>();

      return operation == "agentExecute" && name is "history.undo" or "history.redo"
          ? ValueTask.FromResult("""{"result":{"ok":false,"error":{"code":"COMMAND_UNAVAILABLE","message":"\"history.undo\" is not available here.","retryable":false,"details":{"reason":"runtime"}},"warnings":[]},"document":{"blocks":[]},"edits":[]}""")
          : inner.InvokeAsync(operation, inputJson, timeout, cancellationToken);
    }
  }

  [Fact]
  public async Task UndoStopsAtTheOldestKeptStep()
  {
    await using var room = Open();

    for (var index = 0; index < 105; index++)
    {
      await OkAsync(room, Replace("p", $"T{index}"));
    }
    for (var index = 0; index < 100; index++)
    {
      await OkAsync(room, Undo);
    }

    Assert.Contains("T4", await TextAsync(room, "p"), StringComparison.Ordinal);
    Assert.Equal("NOTHING_TO_UNDO", Code(await RunAsync(room, Undo)));
  }
}
