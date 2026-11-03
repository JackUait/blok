using System.Text.Json.Nodes;
using Blok.Server.FrameCheck;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/frame-check-embedders.json,
/// which the Go server reads too.
/// </summary>
public sealed class FrameCheckEmbedderFixtureTests
{
  [Fact]
  public void EmbeddersMatchTheSharedFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/frame-check-embedders.json");
    var cases = JsonNode.Parse(File.ReadAllText(path))!["cases"]!.AsArray();
    var failures = new List<string>();

    Assert.NotEmpty(cases);
    foreach (var entry in cases)
    {
      var allowedOrigins = entry!["allowedOrigins"]!.AsArray()
          .Select(origin => origin!.GetValue<string>())
          .ToList();
      var embedder = FrameCheckEmbedder.Choose(
          entry["origin"]?.GetValue<string>(),
          entry["secFetchSite"]?.GetValue<string>() ?? "",
          entry["embedder"]?.GetValue<string>() ?? "",
          entry["self"]!.GetValue<string>(),
          origin => origin.Length > 0 && allowedOrigins.Any(candidate =>
              string.Equals(candidate.Trim(), origin, StringComparison.OrdinalIgnoreCase)));
      var expected = entry["want"]?.GetValue<string>();

      if (embedder != expected)
      {
        failures.Add($"{entry["name"]}: {embedder ?? "null"}, want {expected ?? "null"}");
      }
    }

    Assert.Empty(failures);
  }
}
