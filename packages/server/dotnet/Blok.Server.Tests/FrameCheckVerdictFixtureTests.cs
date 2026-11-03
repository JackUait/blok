using System.Text.Json.Nodes;
using Blok.Server.FrameCheck;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/frame-check-verdicts.json,
/// which the Go server reads too. The expected verdicts come from the HTML
/// and CSP3 specs, not from either server.
/// </summary>
public sealed class FrameCheckVerdictFixtureTests
{
  [Fact]
  public void VerdictsMatchTheSharedFixture()
  {
    var path = Path.Combine(
        YjsEngineFixtures.RepositoryRoot,
        "test/unit/server-conformance/fixtures/frame-check-verdicts.json");
    var cases = JsonNode.Parse(File.ReadAllText(path))!["cases"]!.AsArray();
    var failures = new List<string>();

    Assert.NotEmpty(cases);
    foreach (var entry in cases)
    {
      var headers = entry!["headers"]!.AsArray()
          .Select(pair => new KeyValuePair<string, string>(
              pair![0]!.GetValue<string>(),
              pair[1]!.GetValue<string>()))
          .ToList();
      var verdict = FrameCheckVerdict.Evaluate(
          entry["url"]!.GetValue<string>(),
          entry["embedder"]?.GetValue<string>(),
          headers);
      var expected = entry["verdict"]!.GetValue<string>();

      if (verdict != expected)
      {
        failures.Add($"{entry["name"]}: {verdict}, want {expected}");
      }
    }

    Assert.Empty(failures);
  }
}
