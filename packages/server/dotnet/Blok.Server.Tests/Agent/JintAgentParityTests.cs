using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>One runtime for the whole corpus: each instance parses the bundle.</summary>
public sealed class JintAgentRuntimeFixture
{
  internal IBlokAgentExecutor Executor { get; } = new BlokAgentExecutor(JintBlokRuntime.FromEmbeddedResource(poolSize: 1));
}

/// <summary>The stored C# runner: every corpus case through Jint must equal the json golden.</summary>
public sealed class JintAgentParityTests(JintAgentRuntimeFixture fixture) : IClassFixture<JintAgentRuntimeFixture>
{
  public static TheoryData<string> Cases() => AgentParityCorpus.Names();

  [Theory]
  [MemberData(nameof(Cases))]
  public async Task MatchesTheJsonGolden(string name)
  {
    var c = AgentParityCorpus.Get(name);
    var document = c.Seed.ToJsonString();
    string? error = null;

    foreach (var batch in c.Batches)
    {
      var execution = await fixture.Executor.ExecuteAsync(document, batch.ToJsonString(), new BlokAgentActor("agent-test", "Parity", "human-1"));
      var result = JsonNode.Parse(execution.ResultJson)!;

      if (!result["ok"]!.GetValue<bool>())
      {
        error = result["error"]!["code"]!.GetValue<string>();
        break;
      }

      document = execution.DocumentJson!;
    }

    Assert.Equal(AgentParityCorpus.ExpectedError(c, "jint"), error);

    // A runner that refuses where json succeeds has no golden to match.
    if (error is null && AgentParityCorpus.ExpectedError(c, "json") is null)
    {
      var golden = AgentParityCorpus.Golden(name);

      Assert.NotNull(golden);

      var actual = AgentParityNormalizer.Normalize(JsonNode.Parse(document)!.AsObject(), AgentParityCorpus.CallerChosenIds(c));

      Assert.Equal(AgentParityNormalizer.Stable(golden), AgentParityNormalizer.Stable(actual));
    }
  }
}
