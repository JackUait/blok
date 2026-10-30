using System.Text.Json.Nodes;
using Blok.Server.Documents;
using Blok.Server.Tests.Yjs;
using Xunit;

namespace Blok.Server.Tests.Documents;

/// <summary>
/// Reads test/unit/server-conformance/fixtures/documents/looks-like-a-document.json,
/// which the Go blokdocs package reads too.
/// </summary>
public sealed class LooksLikeADocumentFixtureTests
{
  private const string RelativePath = "test/unit/server-conformance/fixtures/documents/looks-like-a-document.json";

  private static readonly Lazy<IBlokDocumentConverter> Converter = new(() => BlokDocuments.Create(poolSize: 1));

  public static TheoryData<string> Names()
  {
    var names = new TheoryData<string>();

    foreach (var entry in Cases())
    {
      names.Add(entry.Name);
    }

    return names;
  }

  private static IEnumerable<(string Name, string? Input, bool Expected)> Cases()
  {
    var path = Path.Combine(YjsEngineFixtures.RepositoryRoot, RelativePath);
    var cases = JsonNode.Parse(File.ReadAllText(path))?.AsArray()
        ?? throw new InvalidDataException($"{path} holds JSON null");

    foreach (var entry in cases)
    {
      yield return (
          entry!["name"]!.GetValue<string>(),
          entry["input"]?.GetValue<string>(),
          entry["expected"]!.GetValue<bool>());
    }
  }

  [Theory]
  [MemberData(nameof(Names))]
  public void AnswersLikeTheSharedFixture(string name)
  {
    var entry = Cases().Single(entry => entry.Name == name);

    Assert.Equal(entry.Expected, BlokDocuments.LooksLikeADocument(entry.Input));
  }

  /// <summary>Validation must never throw, so it inherits the shape check's answer.</summary>
  [Theory]
  [MemberData(nameof(Names))]
  public async Task ValidationAgreesWithTheSharedFixture(string name)
  {
    var entry = Cases().Single(entry => entry.Name == name);
    var validation = await Converter.Value.ValidateAsync(entry.Input);

    Assert.Equal(entry.Expected, validation.IsDocument);
  }
}
