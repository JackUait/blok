using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentRoomTests
{
  private const string DocId = "agent-room";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Agent");
  private static readonly Lazy<IBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(1, null, null));
  private readonly FakeWorkingSetStore store = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeCollabOperationStore operations = new();
  private readonly ManualTimeProvider time = new();

  public BlokAgentRoomTests()
  {
    endpoint.HoldsDocument(DocId, JsonNode.Parse("""
      {"blocks":[
        {"id":"p","type":"paragraph","data":{"text":"Hello world"}},
        {"id":"t","type":"toggle","data":{"text":"T"},"content":["k"]},
        {"id":"k","type":"paragraph","data":{"text":"kid"},"parent":"t"}
      ]}
      """)!.AsObject());
  }

  private (BlokAgentExecutor Executor, CollabRoomManager Rooms) Create(ICollabOperationStore? journal)
  {
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(store, endpoint, converter, new CollabRoomOptions(), time, _ => { }, journal);

    return (new BlokAgentExecutor(Runtime.Value, rooms, converter), rooms);
  }

  [Fact]
  public async Task EditsTheLiveRoomAndReturnsTheJournalHead()
  {
    var (executor, rooms) = Create(operations);

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"text.format","args":{"id":"p","range":{"find":"world"},"set":{"bold":true}}}]}""",
        Actor);

    var result = JsonNode.Parse(execution.ResultJson)!;
    Assert.True(result["ok"]!.GetValue<bool>(), execution.ResultJson);
    Assert.Equal(await HeadAsync(rooms), execution.Revision);
    Assert.Equal(execution.Revision, result["revision"]!.GetValue<string>());
    Assert.Null(execution.DocumentJson);
    Assert.Equal("agent-cs", operations.Committed(DocId)[^1].ActorId);
    var p = Block(await StateAsync(rooms), "p");
    Assert.Equal("agent-cs", p["lastEditedBy"]!.GetValue<string>());
    Assert.Equal("""[{"text":"Hello "},{"text":"world","marks":{"bold":true}}]""", p["data"]!["text"]!.ToJsonString());
  }

  [Fact]
  public async Task TheReturnedHeadIsAValidExpectRevision()
  {
    var (executor, rooms) = Create(operations);
    var first = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}""", Actor);

    var second = await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"expectRevision":"{{{first.Revision}}}","commands":[{"name":"doc.setTitle","args":{"title":"Two"}}]}""",
        Actor);

    Assert.True(JsonNode.Parse(second.ResultJson)!["ok"]!.GetValue<bool>(), second.ResultJson);
    Assert.NotEqual(first.Revision, second.Revision);
    Assert.Equal("Two", (await StateAsync(rooms))["title"]!.GetValue<string>());
  }

  [Fact]
  public async Task AStaleJournalHeadWritesNothing()
  {
    var (executor, rooms) = Create(operations);
    var before = (await StateAsync(rooms))["blocks"]!.ToJsonString();

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"expectRevision":"ffffffffffffffffffffffffffffffff:99","commands":[{"name":"block.delete","args":{"id":"p"}}]}""",
        Actor);

    var error = JsonNode.Parse(execution.ResultJson)!["error"]!;
    Assert.Equal("STALE", error["code"]!.GetValue<string>());
    Assert.True(error["retryable"]!.GetValue<bool>());
    Assert.Equal(await HeadAsync(rooms), error["details"]!["revision"]!.GetValue<string>());
    Assert.Equal(before, (await StateAsync(rooms))["blocks"]!.ToJsonString());
  }

  [Fact]
  public async Task AMalformedExpectRevisionIsInvalidArgs()
  {
    var (executor, _) = Create(operations);

    var execution = await executor.ExecuteInRoomAsync(DocId, """{"expectRevision":"h123","commands":[{"name":"doc.read","args":{}}]}""", Actor);

    Assert.Equal("INVALID_ARGS", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
  }

  [Fact]
  public async Task AFailedBatchWritesAndJournalsNothing()
  {
    var (executor, rooms) = Create(operations);
    var before = (await StateAsync(rooms))["blocks"]!.ToJsonString();
    var committed = operations.Committed(DocId).Count;

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"block.delete","args":{"id":"p"}},{"name":"block.delete","args":{"id":"missing"}}]}""",
        Actor);

    Assert.Equal("BLOCK_NOT_FOUND", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
    Assert.Equal(before, (await StateAsync(rooms))["blocks"]!.ToJsonString());
    Assert.Equal(committed, operations.Committed(DocId).Count);
  }

  [Fact]
  public async Task DeletingAToggleKeepsItsChildInTheSlot()
  {
    var (executor, rooms) = Create(operations);

    var execution = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"block.delete","args":{"id":"t"}}]}""", Actor);

    Assert.True(JsonNode.Parse(execution.ResultJson)!["ok"]!.GetValue<bool>(), execution.ResultJson);
    var blocks = (await StateAsync(rooms))["blocks"]!.AsArray();
    Assert.Equal(["p", "k"], blocks.Select(b => b!["id"]!.GetValue<string>()));
    Assert.Null(blocks[1]!["parent"]);
    Assert.Equal("agent-cs", blocks[1]!["lastEditedBy"]!.GetValue<string>());
  }

  [Fact]
  public async Task WorksWithoutAJournal()
  {
    var (executor, rooms) = Create(null);

    var execution = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.setTitle","args":{"title":"Plain"}}]}""", Actor);

    Assert.True(JsonNode.Parse(execution.ResultJson)!["ok"]!.GetValue<bool>(), execution.ResultJson);
    Assert.Equal("Plain", (await StateAsync(rooms))["title"]!.GetValue<string>());
    var refused = await executor.ExecuteInRoomAsync(DocId, """{"expectRevision":"abc:1","commands":[{"name":"doc.setTitle","args":{"title":"No"}}]}""", Actor);
    Assert.Equal("INVALID_ARGS", JsonNode.Parse(refused.ResultJson)!["error"]!["code"]!.GetValue<string>());
    Assert.Equal("Plain", (await StateAsync(rooms))["title"]!.GetValue<string>());
  }

  [Fact]
  public async Task APageRenameWritesTheTitleOfATargetRoom()
  {
    var (executor, rooms) = Create(operations);
    var options = new BlokAgentOptions { PageTitles = true, PageTarget = new RoomTarget(DocId) };

    var execution = await executor.ExecuteAsync(
        """{"blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}""",
        """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""",
        Actor,
        options);

    Assert.True(JsonNode.Parse(execution.ResultJson)!["ok"]!.GetValue<bool>(), execution.ResultJson);
    Assert.Equal("Roadmap", (await StateAsync(rooms))["title"]!.GetValue<string>());
    Assert.Equal("agent-cs", operations.Committed(DocId)[^1].ActorId);
  }

  [Fact]
  public async Task AReadReturnsTheJournalHeadAsItsRevision()
  {
    var (executor, rooms) = Create(operations);
    await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.setTitle","args":{"title":"One"}}]}""", Actor);

    var read = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.read","args":{}}]}""", Actor);

    var result = JsonNode.Parse(read.ResultJson)!;
    Assert.True(result["ok"]!.GetValue<bool>(), read.ResultJson);
    Assert.Equal(await HeadAsync(rooms), read.Revision);
    Assert.Equal(read.Revision, result["results"]![0]!["revision"]!.GetValue<string>());
  }

  [Fact]
  public async Task AnExpectTextMismatchIsStaleWithoutAContentHash()
  {
    var (executor, _) = Create(operations);

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"text.format","args":{"id":"p","range":{"start":0,"end":5,"expectText":"Nope!"},"set":{"bold":true}}}]}""",
        Actor);

    var result = JsonNode.Parse(execution.ResultJson)!;
    Assert.Equal("STALE", result["error"]!["code"]!.GetValue<string>());
    Assert.DoesNotContain("\"revision\":\"h", execution.ResultJson, StringComparison.Ordinal);
  }

  [Fact]
  public async Task AStaleHeadCarriesTheCurrentBlocks()
  {
    var (executor, rooms) = Create(operations);

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"expectRevision":"ffffffffffffffffffffffffffffffff:99","commands":[{"name":"text.insert","args":{"id":"p","at":0,"text":"x"}}]}""",
        Actor);

    var error = JsonNode.Parse(execution.ResultJson)!["error"]!;
    Assert.Equal("STALE", error["code"]!.GetValue<string>());
    Assert.Equal(await HeadAsync(rooms), error["details"]!["revision"]!.GetValue<string>());
    Assert.NotNull(error["details"]!["current"]);
  }

  [Fact]
  public async Task APageRenameFromALiveSourceRoomRunsTheHostAction()
  {
    endpoint.HoldsDocument("source-room", JsonNode.Parse("""{"blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}""")!.AsObject());
    var (executor, rooms) = Create(operations);
    var options = new BlokAgentOptions { PageTitles = true, PageTarget = new RoomTarget(DocId) };

    var execution = await executor.ExecuteInRoomAsync("source-room",
        """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""", Actor, options);

    var result = JsonNode.Parse(execution.ResultJson)!;
    Assert.True(result["ok"]!.GetValue<bool>(), execution.ResultJson);
    Assert.Equal("""{"pageId":"page-2","applied":true}""", result["results"]![0]!.ToJsonString());
    Assert.Equal("Roadmap", (await StateAsync(rooms))["title"]!.GetValue<string>());
  }

  [Fact]
  public async Task AReadWithoutAJournalWritesNothingBack()
  {
    var (executor, rooms) = Create(null);
    await StateAsync(rooms);
    var writes = store.Writes;

    var read = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.read","args":{}}]}""", Actor);

    Assert.True(JsonNode.Parse(read.ResultJson)!["ok"]!.GetValue<bool>(), read.ResultJson);
    Assert.Equal(writes, store.Writes);
  }

  private const string RetypeSeed = """
      {"blocks":[
        {"id":"p","type":"paragraph","data":{"text":[{"text":"Hello world"}]}},
        {"id":"h","type":"header","data":{"text":[{"text":"Head"}],"level":2}}
      ]}
      """;

  /// <summary>Edit-then-retype and retype-then-edit in one batch must leave what the stored runner leaves.</summary>
  [Theory]
  [InlineData("""[{"name":"text.insert","args":{"id":"p","at":5,"text":","}},{"name":"block.convert","args":{"id":"p","type":"header","data":{"level":3}}}]""")]
  [InlineData("""[{"name":"block.convert","args":{"id":"p","type":"header","data":{"level":3}}},{"name":"text.insert","args":{"id":"p","at":5,"text":","}}]""")]
  [InlineData("""[{"name":"text.format","args":{"id":"h","range":{"find":"Head"},"set":{"bold":true}}},{"name":"block.convert","args":{"id":"h","type":"paragraph"}}]""")]
  [InlineData("""[{"name":"text.insert","args":{"id":"p","at":0,"text":"> "}},{"name":"block.convert","args":{"id":"p","type":"quote"}},{"name":"text.delete","args":{"id":"p","range":{"start":0,"end":2}}}]""")]
  public async Task EditAndRetypeInOneBatchMatchesTheStoredRunner(string commands)
  {
    endpoint.HoldsDocument("retype-room", JsonNode.Parse(RetypeSeed)!.AsObject());
    var (executor, rooms) = Create(operations);
    var batch = $$$"""{"commands":{{{commands}}}}""";

    var stored = await executor.ExecuteAsync(RetypeSeed, batch, Actor);
    var live = await executor.ExecuteInRoomAsync("retype-room", batch, Actor);

    Assert.True(JsonNode.Parse(stored.ResultJson)!["ok"]!.GetValue<bool>(), stored.ResultJson);
    Assert.True(JsonNode.Parse(live.ResultJson)!["ok"]!.GetValue<bool>(), live.ResultJson);
    var state = await rooms.StateAsync("retype-room");
    var ids = new HashSet<string>(StringComparer.Ordinal) { "p", "h" };
    Assert.Equal(
        AgentParityNormalizer.Stable(AgentParityNormalizer.Normalize(JsonNode.Parse(stored.DocumentJson!)!.AsObject(), ids)),
        AgentParityNormalizer.Stable(AgentParityNormalizer.Normalize(JsonNode.Parse(state.Json)!.AsObject(), ids)));
  }

  private sealed class RoomTarget(string docId) : IBlokPageTarget
  {
    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<BlokPageLocation?>(new BlokPageLocation.Room(docId));
  }

  private static async Task<JsonNode> StateAsync(CollabRoomManager rooms)
  {
    var state = await rooms.StateAsync(DocId);

    Assert.Equal(CollabStateStatus.Ready, state.Status);

    return JsonNode.Parse(state.Json)!;
  }

  private static async Task<string> HeadAsync(CollabRoomManager rooms)
  {
    var head = (await rooms.StateAsync(DocId)).Head!;

    return $"{head.Tag.Lineage}:{head.ServerSequence}";
  }

  private static JsonNode Block(JsonNode state, string id) =>
      state["blocks"]!.AsArray().Single(b => b!["id"]!.GetValue<string>() == id)!;
}
