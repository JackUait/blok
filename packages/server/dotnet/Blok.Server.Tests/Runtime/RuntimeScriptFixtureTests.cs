using System.Text.Json.Nodes;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Runtime;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/documents/runtime-scripts.json,
/// which the Go jsruntime package reads too. Each case loads a small script in
/// a one-engine runtime and runs its steps in order. Every script counts its
/// own calls, so a `count` step shows whether the engine was kept or rebuilt.
/// </summary>
public sealed class RuntimeScriptFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/documents/runtime-scripts.json";

  private static JsonArray ReadCases()
  {
    var path = Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);

    return JsonNode.Parse(File.ReadAllText(path))?.AsArray()
        ?? throw new InvalidDataException($"{path} holds JSON null");
  }

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var entry in ReadCases())
    {
      names.Add(entry!["name"]!.GetValue<string>());
    }

    return names;
  }

  [Theory]
  [MemberData(nameof(Names))]
  public async Task MatchesTheSharedFixture(string name)
  {
    var entry = ReadCases().Single(entry => entry!["name"]!.GetValue<string>() == name)!;
    var runtime = new JintBlokRuntime(entry["script"]!.GetValue<string>(), poolSize: 1);

    foreach (var step in entry["steps"]!.AsArray())
    {
      JsonObject actual;

      try
      {
        actual = new JsonObject { ["result"] = await runtime.InvokeAsync(step!["op"]!.GetValue<string>(), "{}") };
      }
      catch (BlokDocumentConversionException exception)
      {
        actual = new JsonObject { ["error"] = exception.Reason.ToString() };
      }

      Assert.True(
          JsonNode.DeepEquals(step!["expect"], actual),
          $"{step!["op"]}\n got {actual.ToJsonString()}\nwant {step["expect"]!.ToJsonString()}");
    }
  }
}
