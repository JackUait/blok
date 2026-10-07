using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Runs the fixture the TS client diff also runs, so both sides keep the same blocks.
/// </summary>
public sealed class CollabLongestKeptOrderTests
{
  [Fact]
  public void FixtureHasEnoughCasesToPinTheTieBreak()
  {
    Assert.True(LoadFixture().Cases.Length > 5);
  }

  [Fact]
  public void EveryFixtureCaseKeepsExactlyTheExpectedIndexes()
  {
    foreach (var testCase in LoadFixture().Cases)
    {
      Assert.Equal(testCase.Kept, CollabLongestKeptOrder.Of(testCase.Positions));
    }
  }

  private static LisFixture LoadFixture()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "lis-cases.json");
    var fixture = JsonSerializer.Deserialize<LisFixture>(File.ReadAllText(path));

    return Assert.IsType<LisFixture>(fixture);
  }

  private sealed record LisFixture([property: JsonPropertyName("cases")] LisCase[] Cases);

  private sealed record LisCase(
      [property: JsonPropertyName("positions")] int[] Positions,
      [property: JsonPropertyName("kept")] int[] Kept);
}
