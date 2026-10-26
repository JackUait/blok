using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>history.versions, history.read, history.changes and history.restore in a room, against the in-memory history journal.</summary>
public sealed class BlokAgentVersionHistoryTests
{
  private const string DocId = "history-room";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Agent");
  private static readonly Lazy<IBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(1, null, null));
  private readonly FakeWorkingSetStore store = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeCollabOperationStore operations = new();
  private readonly ManualTimeProvider time = new();

  public BlokAgentVersionHistoryTests()
  {
    endpoint.HoldsDocument(DocId, JsonNode.Parse("""
      {"blocks":[
        {"id":"p","type":"paragraph","data":{"text":"Hello world"}},
        {"id":"q","type":"paragraph","data":{"text":"Second"}}
      ]}
      """)!.AsObject());
  }

  private (BlokAgentExecutor Executor, CollabRoomManager Rooms) Create(ICollabOperationStore? journal)
  {
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(store, endpoint, converter, new CollabRoomOptions(), time, _ => { }, journal);

    return (new BlokAgentExecutor(Runtime.Value, rooms, converter), rooms);
  }

  private static JsonObject Command(JsonNode contract, string name) =>
      contract["commands"]!.AsArray().Single(entry => entry!["name"]!.GetValue<string>() == name)!.AsObject();

  [Fact]
  public async Task OnlyTheRoomContractOfAHistoryJournalOffersTheReads()
  {
    var (executor, _) = Create(operations);
    var (plain, _) = Create(null);

    var room = JsonNode.Parse(await executor.GetRoomContractAsync())!;
    var stored = JsonNode.Parse(await executor.GetContractAsync())!;
    var noJournal = JsonNode.Parse(await plain.GetRoomContractAsync())!;

    foreach (var name in new[] { "history.versions", "history.read", "history.changes" })
    {
      Assert.True(Command(room, name)["available"]!.GetValue<bool>(), name);
      Assert.Equal("service", Command(stored, name)["unavailableReason"]!.GetValue<string>());
      Assert.Equal("service", Command(noJournal, name)["unavailableReason"]!.GetValue<string>());
    }
  }

  [Fact]
  public async Task ListsReadsAndComparesTheRoomVersions()
  {
    var (executor, rooms) = Create(operations);
    var edit = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}""", Actor);
    Assert.True(JsonNode.Parse(edit.ResultJson)!["ok"]!.GetValue<bool>(), edit.ResultJson);
    var lineage = edit.Revision[..edit.Revision.LastIndexOf(':')];
    var committed = operations.Committed(DocId).Count;

    var listed = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"history.versions","args":{"group":1}}]}""", Actor)).ResultJson)!;
    var read = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.read","args":{"version":"{{{lineage}}}:0"}}]}""", Actor)).ResultJson)!;
    var changes = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.changes","args":{"from":"{{{lineage}}}:0"}}]}""", Actor)).ResultJson)!;

    Assert.True(listed["ok"]!.GetValue<bool>(), listed.ToJsonString());
    var newest = listed["results"]![0]!["versions"]![0]!;
    Assert.Equal(edit.Revision, newest["version"]!.GetValue<string>());
    Assert.Contains("agent-cs", newest["actors"]!.AsArray().Select(actor => actor!.GetValue<string>()));
    Assert.True(read["ok"]!.GetValue<bool>(), read.ToJsonString());
    Assert.Equal($"{lineage}:0", read["results"]![0]!["version"]!.GetValue<string>());
    Assert.Equal("Hello world", read["results"]![0]!["blocks"]![0]!["text"]!.GetValue<string>());
    Assert.Null(read["results"]![0]!["revision"]);
    Assert.True(changes["ok"]!.GetValue<bool>(), changes.ToJsonString());
    var changed = changes["results"]![0]!["changed"]!.AsArray().Single()!;
    Assert.Equal("p", changed["id"]!.GetValue<string>());
    Assert.Equal("Hello world", changed["before"]!["text"]!.GetValue<string>());
    Assert.Equal("Changed", changed["after"]!["text"]!.GetValue<string>());
    Assert.Empty(changes["results"]![0]!["added"]!.AsArray());
    Assert.Equal(committed, operations.Committed(DocId).Count);
    Assert.Equal("Changed", (await rooms.StateAsync(DocId)).Json is { } json
        ? JsonNode.Parse(json)!["blocks"]![0]!["data"]!["text"]![0]!["text"]!.GetValue<string>() : null);
  }

  [Fact]
  public async Task AnUnknownVersionIsInvalidArgs()
  {
    var (executor, _) = Create(operations);
    var lineage = (await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}""", Actor)).Revision.Split(':')[0];

    var execution = await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.read","args":{"version":"{{{lineage}}}:99"}}]}""", Actor);

    var error = JsonNode.Parse(execution.ResultJson)!["error"]!;
    Assert.Equal("INVALID_ARGS", error["code"]!.GetValue<string>());
    Assert.Equal("/commands/0/args/version", error["path"]!.GetValue<string>());
  }

  [Fact]
  public async Task WithoutAHistoryJournalTheReadsAreUnavailable()
  {
    var (executor, _) = Create(null);

    var execution = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"history.versions","args":{}}]}""", Actor);

    var error = JsonNode.Parse(execution.ResultJson)!["error"]!;
    Assert.Equal("COMMAND_UNAVAILABLE", error["code"]!.GetValue<string>());
    Assert.Equal("service", error["details"]!["reason"]!.GetValue<string>());
  }

  [Fact]
  public async Task APurgedRoomIsNotRetryable()
  {
    var (executor, rooms) = Create(operations);
    var lineage = (await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}""", Actor)).Revision.Split(':')[0];
    await rooms.PurgeDocumentAsync(DocId, _ => ValueTask.FromResult(true));

    var listed = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"history.versions","args":{}}]}""", Actor)).ResultJson)!;
    var read = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.read","args":{"version":"{{{lineage}}}:0"}}]}""", Actor)).ResultJson)!;

    Assert.False(listed["error"]!["retryable"]!.GetValue<bool>(), listed.ToJsonString());
    Assert.False(read["error"]!["retryable"]!.GetValue<bool>(), read.ToJsonString());
  }

  [Fact]
  public async Task AStoredDocumentHasNoVersionHistory()
  {
    var (executor, _) = Create(operations);

    var execution = await executor.ExecuteAsync("""{"blocks":[]}""", """{"commands":[{"name":"history.versions","args":{}}]}""", Actor);

    Assert.Equal("COMMAND_UNAVAILABLE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
  }

  [Fact]
  public async Task OnlyTheRoomContractOfAHistoryJournalOffersTheRestore()
  {
    var (executor, _) = Create(operations);
    var (plain, _) = Create(null);

    Assert.True(Command(JsonNode.Parse(await executor.GetRoomContractAsync())!, "history.restore")["available"]!.GetValue<bool>());
    Assert.Equal("service", Command(JsonNode.Parse(await executor.GetContractAsync())!, "history.restore")["unavailableReason"]!.GetValue<string>());
    Assert.Equal("service", Command(JsonNode.Parse(await plain.GetRoomContractAsync())!, "history.restore")["unavailableReason"]!.GetValue<string>());
  }

  [Fact]
  public async Task RestoresAVersionAsOneJournalledEditThatStampsNoBlock()
  {
    var (executor, rooms) = Create(operations);
    var edit = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}""", Actor);
    var lineage = edit.Revision[..edit.Revision.LastIndexOf(':')];
    var committed = operations.Committed(DocId).Count;

    var execution = await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.restore","args":{"version":"{{{lineage}}}:0"}}]}""", Actor);
    var restored = JsonNode.Parse(execution.ResultJson)!;

    Assert.True(restored["ok"]!.GetValue<bool>(), restored.ToJsonString());
    Assert.Equal(edit.Revision, restored["results"]![0]!["previous"]!.GetValue<string>());
    Assert.Equal(committed + 1, operations.Committed(DocId).Count);
    Assert.Equal(execution.Revision, restored["revision"]!.GetValue<string>());
    Assert.NotEqual(edit.Revision, execution.Revision);
    var p = JsonNode.Parse((await rooms.StateAsync(DocId)).Json!)!["blocks"]![0]!.AsObject();
    Assert.Equal("Hello world", p["data"]!["text"]![0]!["text"]!.GetValue<string>());
    // The version had no stamps, and a restore keeps the version's.
    Assert.False(p.ContainsKey("lastEditedWith"), p.ToJsonString());
    var newest = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"history.versions","args":{"group":1}}]}""", Actor)).ResultJson)!["results"]![0]!["versions"]![0]!;
    Assert.Contains("agent-cs", newest["actors"]!.AsArray().Select(actor => actor!.GetValue<string>()));
  }

  [Fact]
  public async Task RestoringAnUnknownVersionIsVersionNotFoundAndWritesNothing()
  {
    var (executor, _) = Create(operations);
    var lineage = (await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}""", Actor)).Revision.Split(':')[0];
    var committed = operations.Committed(DocId).Count;

    var execution = await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.restore","args":{"version":"{{{lineage}}}:99"}}]}""", Actor);

    Assert.Equal("VERSION_NOT_FOUND", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
    Assert.Equal(committed, operations.Committed(DocId).Count);
  }

  [Fact]
  public async Task ARestoreAgainstAStaleRevisionIsStale()
  {
    var (executor, _) = Create(operations);
    var first = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}""", Actor);
    await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.setTitle","args":{"title":"Two"}}]}""", Actor);
    var lineage = first.Revision.Split(':')[0];
    var committed = operations.Committed(DocId).Count;

    var execution = await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"expectRevision":"{{{first.Revision}}}","commands":[{"name":"history.restore","args":{"version":"{{{lineage}}}:0"}}]}""", Actor);

    Assert.Equal("STALE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
    Assert.Equal(committed, operations.Committed(DocId).Count);
  }
}
