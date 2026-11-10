using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>The host's history read and window hooks reach an agent's history.versions, history.read and history.restore.</summary>
public sealed partial class BlokAgentVersionHistoryTests
{
  private (BlokAgentExecutor Executor, List<string> Asked) Hooked(bool canRead, TimeSpan? cutAfterEpoch)
  {
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(store, endpoint, converter, new CollabRoomOptions(), time, _ => { }, operations);
    var asked = new List<string>();
    var executor = new BlokAgentExecutor(Runtime.Value, rooms, converter)
    {
      HistoryPolicy = (user, doc, _) =>
      {
        asked.Add($"{user} {doc}");

        return ValueTask.FromResult(new BlokAgentHistoryAccess(
            canRead,
            cutAfterEpoch is { } cut ? time.GetUtcNow() - (DateTimeOffset.UnixEpoch + cut) : null));
      },
    };

    return (executor, asked);
  }

  private static async Task<string> EditTwiceAsync(BlokAgentExecutor executor)
  {
    await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"text.replace","args":{"id":"p","with":"One"}}]}""", Actor);
    var second = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"text.replace","args":{"id":"p","with":"Two"}}]}""", Actor);

    return second.Revision[..second.Revision.LastIndexOf(':')];
  }

  [Fact]
  public async Task AWindowHidesOlderVersionsFromAnAgent()
  {
    operations.RecordSpacing = TimeSpan.FromDays(1);
    // Records 1 and 2 land at the epoch plus 1 and 2 days: the cut hides record 1 and the baseline below it.
    var (executor, asked) = Hooked(canRead: true, TimeSpan.FromDays(1.5));
    var lineage = await EditTwiceAsync(executor);
    var committed = operations.Committed(DocId).Count;

    var listed = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"history.versions","args":{"group":1}}]}""", Actor)).ResultJson)!;
    var read = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.read","args":{"version":"{{{lineage}}}:1"}}]}""", Actor)).ResultJson)!;
    var restore = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.restore","args":{"version":"{{{lineage}}}:1"}}]}""", Actor)).ResultJson)!;

    Assert.True(listed["ok"]!.GetValue<bool>(), listed.ToJsonString());
    Assert.Equal(
        [$"{lineage}:2"],
        listed["results"]![0]!["versions"]!.AsArray().Select(version => version!["version"]!.GetValue<string>()));
    Assert.Equal("INVALID_ARGS", read["error"]!["code"]!.GetValue<string>());
    Assert.Equal("VERSION_NOT_FOUND", restore["error"]!["code"]!.GetValue<string>());
    Assert.Equal(committed, operations.Committed(DocId).Count);
    Assert.Contains($"agent-cs {DocId}", asked);
  }

  [Fact]
  public async Task AReadHookThatSaysNoRefusesAnAgentsListReadAndRestore()
  {
    var (executor, _) = Hooked(canRead: false, null);
    var lineage = await EditTwiceAsync(executor);
    var committed = operations.Committed(DocId).Count;

    var listed = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"history.versions","args":{}}]}""", Actor)).ResultJson)!;
    var read = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.read","args":{"version":"{{{lineage}}}:0"}}]}""", Actor)).ResultJson)!;
    var restore = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        $$$"""{"commands":[{"name":"history.restore","args":{"version":"{{{lineage}}}:0"}}]}""", Actor)).ResultJson)!;

    Assert.False(listed["ok"]!.GetValue<bool>(), listed.ToJsonString());
    Assert.Equal("TOOL_ACTION_FAILED", listed["error"]!["code"]!.GetValue<string>());
    Assert.False(read["ok"]!.GetValue<bool>(), read.ToJsonString());
    Assert.Equal("TOOL_ACTION_FAILED", read["error"]!["code"]!.GetValue<string>());
    Assert.Equal("TOOL_ACTION_FAILED", restore["error"]!["code"]!.GetValue<string>());
    Assert.Equal(committed, operations.Committed(DocId).Count);
  }

  [Fact]
  public async Task AnAgentActingForAPersonIsAskedAboutAsThatPerson()
  {
    var (executor, asked) = Hooked(canRead: true, null);

    await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"history.versions","args":{}}]}""", new BlokAgentActor("agent-cs", "Agent", "person-1"));

    Assert.Equal([$"person-1 {DocId}"], asked);
  }

  /// <summary>A group that straddles the cut shows only its visible records to an agent.</summary>
  [Fact]
  public async Task AnAgentsListShowsNothingOfAHiddenRecord()
  {
    operations.RecordSpacing = TimeSpan.FromMinutes(1);
    // Records 1 and 2 land a minute apart, in one 15-minute group; the cut hides 1.
    var (executor, _) = Hooked(canRead: true, TimeSpan.FromSeconds(90));
    var lineage = await EditTwiceAsync(executor);

    var listed = JsonNode.Parse((await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"history.versions","args":{"group":15}}]}""", Actor)).ResultJson)!;

    var version = Assert.Single(listed["results"]![0]!["versions"]!.AsArray())!;
    Assert.Equal($"{lineage}:2", version["version"]!.GetValue<string>());
    Assert.Equal(120_000L, version["startedAt"]!.GetValue<long>());
  }
}
