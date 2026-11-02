using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/agent/formula-dates.json, which the
/// Go blokagent package reads too. An agent read computes formula dates in the
/// host's own zone, so the fixture holds Jint's answer per zone. This test checks
/// the zone it runs in, and fails when the fixture lacks it. To add a zone, run with
/// <c>TZ=&lt;zone&gt; BLOK_CAPTURE_AGENT_FIXTURE=1</c>.
/// </summary>
public sealed class AgentFormulaDatesFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/agent/formula-dates.json";

  private static string FixturePath => Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);

  [Fact]
  public async Task ReadsFormulaDatesInTheHostZoneAsTheFixtureSays()
  {
    var fixture = JsonNode.Parse(await File.ReadAllTextAsync(FixturePath))!.AsObject();
    var executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);
    var execution = await executor.ExecuteAsync(
        fixture["document"]!.GetValue<string>(), fixture["batch"]!.GetValue<string>(), new BlokAgentActor("a", "A"));
    var computed = JsonNode.Parse(execution.ResultJson)!["results"]![0]!["blocks"]![0]!["computed"];
    var zones = fixture["zones"]!.AsObject();
    var zone = TimeZoneInfo.Local.Id;

    if (Environment.GetEnvironmentVariable("BLOK_CAPTURE_AGENT_FIXTURE") == "1")
    {
      zones[zone] = computed?.DeepClone();
      var options = new JsonSerializerOptions { WriteIndented = true, IndentSize = 2, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

      await File.WriteAllTextAsync(FixturePath, fixture.ToJsonString(options) + "\n");

      return;
    }

    // A zone the fixture lacks would pass without checking anything.
    var expected = zones[zone]
        ?? throw new Xunit.Sdk.XunitException(
            $"formula-dates.json has no answer for the host zone {zone}. Add it with TZ={zone} BLOK_CAPTURE_AGENT_FIXTURE=1.");

    Assert.True(JsonNode.DeepEquals(expected, computed), $"{zone}: {computed?.ToJsonString()}");
  }
}
