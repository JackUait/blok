using System.Text.Json.Nodes;
using Blok.Server.Runtime;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/documents/bundle-smoke.json:
/// node:vm's answer on the bundle, which the Go jsruntime tests (goja) and
/// Jint here must both give byte for byte.
/// </summary>
public sealed class BundleSmokeFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/documents/bundle-smoke.json";

  private static readonly Lazy<JintBlokRuntime> Runtime = new(
      () => JintBlokRuntime.FromEmbeddedResource(poolSize: 1));

  private static readonly Lazy<JsonArray> Cases = new(() =>
  {
    var path = Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);

    return JsonNode.Parse(File.ReadAllText(path))?.AsArray()
        ?? throw new InvalidDataException($"{path} holds JSON null");
  });

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var entry in Cases.Value)
    {
      names.Add(entry!["name"]!.GetValue<string>());
    }

    return names;
  }

  [Fact]
  public void TheFixtureHoldsCases()
  {
    Assert.NotEmpty(Cases.Value);
  }

  [Theory]
  [MemberData(nameof(Names))]
  public async Task MatchesNodeOnTheSmokeFixture(string name)
  {
    var entry = Cases.Value.Single(entry => entry!["name"]!.GetValue<string>() == name)!;

    var output = await Runtime.Value.InvokeAsync(entry["op"]!.GetValue<string>(), entry["input"]!.GetValue<string>());

    Assert.Equal(entry["output"]!.GetValue<string>(), output);
  }
}
