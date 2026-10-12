using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>
/// The C# normalizer must agree with test/unit/agent/parity/normalize.ts on
/// test/fixtures/agent-commands/normalizer-cases.json, or C# parity compares
/// against a golden it cannot reproduce.
/// </summary>
public sealed class AgentParityNormalizerTests
{
  public static TheoryData<string> Cases()
  {
    var data = new TheoryData<string>();

    foreach (var item in CasesFile().OfType<JsonObject>())
    {
      if (item["tsOnly"] is null)
      {
        data.Add(item["name"]!.GetValue<string>());
      }
    }

    return data;
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void MatchesTheTypeScriptNormalizer(string name)
  {
    var item = CasesFile().OfType<JsonObject>().First(c => c["name"]!.GetValue<string>() == name);
    var keep = item["keepIds"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);

    var actual = AgentParityNormalizer.Normalize(item["input"]!.AsObject(), keep);

    Assert.Equal(AgentParityNormalizer.Stable(item["expected"]), AgentParityNormalizer.Stable(actual));
  }

  private static JsonArray CasesFile()
  {
    return JsonNode.Parse(File.ReadAllText(Path.Combine(AgentParityCorpus.Root, "normalizer-cases.json")))!["cases"]!.AsArray();
  }
}
