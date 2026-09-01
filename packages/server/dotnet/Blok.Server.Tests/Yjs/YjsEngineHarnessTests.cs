using Xunit;

namespace Blok.Server.Tests.Yjs;

/// <summary>
/// Wave 0 harness checks: the fixture loader sees what the generator wrote,
/// and the C# → Node direction runs (a real yjs doc replays bytes we hand it).
/// </summary>
public sealed class YjsEngineHarnessTests
{
  [Fact]
  public void LoaderFindsEveryManifestedFile()
  {
    var files = YjsEngineFixtures.ManifestFiles();

    Assert.NotEmpty(files);

    foreach (var file in files)
    {
      var path = Path.Combine(YjsEngineFixtures.Root, file);

      Assert.True(File.Exists(path), $"manifest.json lists {file}, which is missing");
      Assert.NotNull(YjsEngineFixtures.ReadJson(file));
    }
  }

  [Fact]
  public void NodeReplayAppliesAnEmptyUpdateAndReportsNoPending()
  {
    // The two-byte empty update: no structs, no delete set.
    byte[] emptyUpdate = [0x00, 0x00];
    var roots = new Dictionary<string, string>(StringComparer.Ordinal) { ["m"] = "map" };
    byte[] emptyStateVector = [0x00];

    var result = NodeReplay.Run(roots, [emptyUpdate], null);

    Assert.Equal("{\"m\":{}}", YjsEngineFixtures.Canonicalize(result.Json));
    Assert.Equal(emptyStateVector, result.StateVector);
    Assert.False(result.HasPending);
    Assert.Null(result.Diff);
  }
}
