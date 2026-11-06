using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>An MCP live handle's room run: the handle's mcp and approval inputs reach the bundle.</summary>
public sealed class BlokAgentRoomMcpTests
{
  private const string DocId = "mcp-room";
  private static readonly BlokAgentActor Actor = new("agent:alice:desk", "desk (for alice)", "alice");
  private static readonly Lazy<IBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(1, null, null));
  private readonly FakeWorkingSetStore store = new();
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeCollabOperationStore operations = new();
  private readonly ManualTimeProvider time = new();

  private const string Unlock = """{"commands":[{"name":"database.setLock","args":{"id":"db","locked":false}}]}""";

  public BlokAgentRoomMcpTests()
  {
    endpoint.HoldsDocument(DocId, JsonNode.Parse("""
      {"blocks":[{"id":"db","type":"database","content":[],"data":{"title":"Payroll","activeViewId":"v",
      "schema":[{"id":"t","name":"Name","type":"title","position":"a0","databaseLocked":true}],
      "views":[{"id":"v","name":"Table","type":"table","position":"a0","sorts":[],"filters":[],"visibleProperties":[]}]}}]}
      """)!.AsObject());
  }

  private BlokAgentExecutor Create()
  {
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(store, endpoint, converter, new CollabRoomOptions(), time, _ => { }, operations);

    return new BlokAgentExecutor(Runtime.Value, rooms, converter);
  }

  private static BlokAgentOptions Mcp(bool write, JsonObject? approval = null)
  {
    return new BlokAgentOptions
    {
      Mcp = new JsonObject { ["pageTitles"] = "off", ["sync"] = true, ["source"] = false, ["uploads"] = false, ["mode"] = "live", ["write"] = write },
      Approval = approval,
    };
  }

  [Fact]
  public async Task AnUnlockAsksThePersonAndWritesNothing()
  {
    var executor = Create();

    var execution = await executor.ExecuteInRoomAsync(DocId, Unlock, Actor,
        Mcp(true, new JsonObject { ["capabilities"] = new JsonObject { ["elicitation"] = new JsonObject() }, ["clientName"] = "desk" }));

    Assert.NotNull(execution.Ask);
    Assert.Equal("""["database.unlock","db","Payroll"]""", (string?)execution.Ask["key"]);
    Assert.Empty(operations.Committed(DocId));
  }

  [Fact]
  public async Task AReadOnlyHandleIsRefusedWithTheLiveWords()
  {
    var executor = Create();

    var execution = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"doc.setTitle","args":{"title":"T"}}]}""", Actor, Mcp(false));

    Assert.Equal("This handle cannot write to the room.", (string?)JsonNode.Parse(execution.ResultJson)?["error"]?["message"]);
    Assert.Empty(operations.Committed(DocId));
  }

  [Fact]
  public async Task AnAcceptedUnlockApplies()
  {
    var executor = Create();
    var replies = new JsonObject { ["[\"database.unlock\",\"db\",\"Payroll\"]"] = new JsonObject { ["action"] = "accept", ["content"] = new JsonObject { ["unlock"] = true } } };

    var execution = await executor.ExecuteInRoomAsync(DocId, Unlock, Actor,
        Mcp(true, new JsonObject { ["capabilities"] = new JsonObject { ["elicitation"] = new JsonObject() }, ["clientName"] = "desk", ["replies"] = replies }));

    Assert.Null(execution.Ask);
    Assert.True((bool?)JsonNode.Parse(execution.ResultJson)?["ok"], execution.ResultJson);
    Assert.Single(operations.Committed(DocId));
  }
}
