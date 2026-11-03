using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>Room refusals a scenario cannot stage; the Go blokagent package has the same tests.</summary>
public sealed class BlokAgentRoomRefusalTests
{
  private static readonly BlokAgentActor Actor = new("agent-cs", "Agent");

  /// <summary>Makes host-1, host-2, ... and runs <see cref="During"/> inside each create.</summary>
  private sealed class Creator : IBlokPageCreator
  {
    internal List<string> Created { get; } = [];

    internal Func<ValueTask>? During { get; set; }

    public async ValueTask<string?> CreateAsync(BlokAgentActor actor, CancellationToken cancellationToken = default)
    {
      if (During is { } during)
      {
        await during();
      }

      Created.Add($"host-{Created.Count + 1}");

      return Created[^1];
    }

    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, BlokAgentActor actor, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<BlokPageLocation?>(null);
  }

  // A peer writes while the host makes the page: the room refuses the stale edit, links no
  // page, and the answer lists the page for the host to clean up.
  [Fact]
  public async Task ARoomThatRefusesTheEditAfterThePageWasMadeListsIt()
  {
    await using var room = AgentRoomForTests.Seed($"refusal-{Guid.NewGuid():N}", JsonNode.Parse("""{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}""")!.AsObject());
    var state = await room.Manager.StateAsync(room.DocId);
    var head = $"{state.Head!.Tag.Lineage}:{state.Head.ServerSequence}";
    var pages = new Creator
    {
      During = async () => Assert.Equal(CollabEditStatus.Applied, (await room.Manager.EditAsync(room.DocId,
          [new CollabEditOp.Update("p", new JsonObject { ["text"] = "Peer" })], Guid.NewGuid().ToString("N"),
          System.Security.Cryptography.SHA256.HashData(Guid.NewGuid().ToByteArray()), "human-2")).Status),
    };

    var execution = await room.Executor.ExecuteInRoomAsync(room.DocId,
        $$$"""{"expectRevision":"{{{head}}}","commands":[{"name":"block.insert","args":{"type":"page","id":"np","position":"end"}}]}""",
        Actor, new BlokAgentOptions { PageTitles = true, PageTarget = pages });

    var error = JsonNode.Parse(execution.ResultJson)!["error"]!;
    Assert.Equal("ORPHANED_SIDE_EFFECT", error["code"]!.GetValue<string>());
    Assert.Equal("STALE", error["details"]!["cause"]!["code"]!.GetValue<string>());
    Assert.Equal("""[{"command":"block.insert","type":"page","prepared":{"pageId":"host-1"}}]""", error["details"]!["orphaned"]!.ToJsonString());
    Assert.Equal(["host-1"], pages.Created);
  }

  /// <summary>Drains the rooms right after Jint answers a restore, before the room restores.</summary>
  private sealed class DrainAfterRestoreCheck(IBlokRuntime inner) : IBlokRuntime
  {
    internal Func<ValueTask>? Drain { get; set; }

    public async ValueTask<string> InvokeAsync(string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      var output = await inner.InvokeAsync(operation, inputJson, timeout, cancellationToken);

      if (Drain is { } drain && operation == "agentExecute" && output.Contains("\"restore\":", StringComparison.Ordinal))
      {
        Drain = null;
        await drain();
      }

      return output;
    }
  }

  [Fact]
  public async Task ARestoreTheRoomRefusesIsApplyFailedWithItsStatus()
  {
    DrainAfterRestoreCheck? runtime = null;
    await using var room = AgentRoomForTests.Seed($"refusal-{Guid.NewGuid():N}", JsonNode.Parse("""{"blocks":[{"id":"p","type":"paragraph","data":{"text":"P"}}]}""")!.AsObject(),
        inner => runtime = new DrainAfterRestoreCheck(inner));
    var edit = await room.Executor.ExecuteInRoomAsync(room.DocId, """{"commands":[{"name":"text.replace","args":{"id":"p","with":"Changed"}}]}""", Actor);
    var lineage = edit.Revision[..edit.Revision.LastIndexOf(':')];
    runtime!.Drain = async () => await room.Manager.DrainAsync();

    var execution = await room.Executor.ExecuteInRoomAsync(room.DocId,
        $$$"""{"commands":[{"name":"history.restore","args":{"version":"{{{lineage}}}:0"}}]}""", Actor);

    Assert.Equal(
        """{"ok":false,"error":{"code":"APPLY_FAILED","message":"The room refused the restore (Draining). Nothing was written.","retryable":true,"details":{"status":"Draining"}},"warnings":[]}""",
        execution.ResultJson);
    Assert.Equal(string.Empty, execution.Revision);
  }
}
