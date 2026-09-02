using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Fifty seeded delivery schedules, each replayed against one engine document
/// with real yjs as the per-step oracle (state vector, pending flag, JSON
/// hash), then round-tripped through yjs one last time. A failing seed is a
/// bug in the port; the seed number in the failure message is the repro.
/// </summary>
public sealed class FuzzCorpusTests
{
  public static TheoryData<string> SeedNames()
  {
    var names = new TheoryData<string>();

    foreach (var seed in ScenarioSupport.FuzzSeeds())
    {
      names.Add(seed.Name);
    }

    return names;
  }

  [Fact]
  public void TheCorpusHoldsFiftySeeds()
  {
    Assert.Equal(50, ScenarioSupport.FuzzSeeds().Count);
  }

  [Theory]
  [MemberData(nameof(SeedNames))]
  public void EverySeedMatchesTheYjsOracleAtEveryStep(string name)
  {
    var seed = ScenarioSupport.FuzzSeeds().Single(candidate => candidate.Name == name);
    var runner = new ScenarioRunner(seed);

    runner.RunAll();

    Assert.True(runner.Checks > 0, $"{name} asserted nothing");

    var replay = NodeReplay.Run(seed.Roots, [runner.Doc.EncodeStateAsUpdate()], null);

    Assert.Equal(
        YjsEngineFixtures.Canonicalize(JsonRenderer.Render(runner.Doc, seed.Roots)),
        YjsEngineFixtures.Canonicalize(replay.Json));
    Assert.Equal(runner.Doc.EncodeStateVector(), replay.StateVector);
    Assert.Equal(runner.Doc.HasPending, replay.HasPending);
  }
}
