using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>The live-room C# runner: every corpus case through a real room must equal the json golden.</summary>
public sealed class RoomAgentParityTests
{
  public static TheoryData<string> Cases() => AgentParityCorpus.Names();

  [Theory]
  [MemberData(nameof(Cases))]
  public async Task MatchesTheJsonGolden(string name)
  {
    var c = AgentParityCorpus.Get(name);
    await using var room = AgentRoomForTests.Seed($"parity-{Guid.NewGuid():N}", c.Seed);
    string? error = null;

    foreach (var batch in c.Batches)
    {
      var execution = await room.Executor.ExecuteInRoomAsync(room.DocId, batch.ToJsonString(), new BlokAgentActor("agent-test", "Parity", "human-1"));
      var result = JsonNode.Parse(execution.ResultJson)!;

      if (!result["ok"]!.GetValue<bool>())
      {
        error = result["error"]!["code"]!.GetValue<string>();
        break;
      }
    }

    Assert.Equal(AgentParityCorpus.ExpectedError(c, "room"), error);

    // Same gate as the Jint runner: content only, the review state is a human's.
    if (error is null && AgentParityCorpus.ExpectedError(c, "json") is null)
    {
      var golden = AgentParityCorpus.Golden(name);

      Assert.NotNull(golden);

      var actual = AgentParityNormalizer.Normalize(await room.ExportAsync(), AgentParityCorpus.CallerChosenIds(c));

      Assert.Equal(AgentParityNormalizer.Stable(golden), AgentParityNormalizer.Stable(actual));
    }
  }
}

/// <summary>A room on the real converter and journal fakes, seeded from a corpus document.</summary>
internal sealed class AgentRoomForTests : IAsyncDisposable
{
  // Each runtime parses the bundle, so the corpus shares one.
  private static readonly Lazy<JintBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(poolSize: 1));

  private AgentRoomForTests(string docId, CollabRoomManager manager, IBlokAgentExecutor executor)
  {
    DocId = docId;
    Manager = manager;
    Executor = executor;
  }

  internal string DocId { get; }

  internal IBlokAgentExecutor Executor { get; }

  internal CollabRoomManager Manager { get; }

  /// <param name="wrap">Puts a test runtime in front of the real one.</param>
  internal static AgentRoomForTests Seed(string docId, JsonObject seed, Func<IBlokRuntime, IBlokRuntime>? wrap = null)
  {
    var endpoint = new FakeDocEndpoint();
    endpoint.HoldsDocument(docId, (JsonObject)seed.DeepClone());

    var converter = new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(Runtime.Value));
    var manager = new CollabRoomManager(
        new FakeWorkingSetStore(),
        endpoint,
        converter,
        new CollabRoomOptions(),
        TimeProvider.System,
        operationStore: new FakeCollabOperationStore());

    return new AgentRoomForTests(docId, manager, new BlokAgentExecutor(wrap?.Invoke(Runtime.Value) ?? Runtime.Value, manager, converter));
  }

  internal async Task<JsonObject> ExportAsync()
  {
    var state = await Manager.StateAsync(DocId);

    Assert.Equal(CollabStateStatus.Ready, state.Status);

    return JsonNode.Parse(state.Json)!.AsObject();
  }

  public ValueTask DisposeAsync() => Manager.DrainAsync();
}
