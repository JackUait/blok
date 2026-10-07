using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Three directions per fixture: JSON→doc→JSON (Seed mirrors fromJSON),
/// client update→doc→JSON (Export reads what the JS client wrote), and
/// Seed→EncodeStateAsUpdate→ApplyUpdate→Export (the C# encoder round-trips).
/// </summary>
public sealed class YDocConverterConformanceTests
{
  public static TheoryData<string> Cases()
  {
    return new TheoryData<string>(YDocConverterFixtures.CaseNames());
  }

  [Fact]
  public void ManifestListsExactlyTheCommittedCases()
  {
    var names = YDocConverterFixtures.CaseNames();

    Assert.NotEmpty(names);
    Assert.Equal(
        names,
        YDocConverterFixtures.ManifestCaseNames().Order(StringComparer.Ordinal));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void SeedingInputJsonExportsCanonicalJson(string name)
  {
    var fixture = YDocConverterFixtures.Load(name);
    var doc = new YDoc();

    RichTextRuntime.Seed(doc, fixture.Input);

    AssertJsonEqual(Expected(fixture), RichTextRuntime.Export(doc));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void ApplyingTheClientUpdateExportsCanonicalJson(string name)
  {
    var fixture = YDocConverterFixtures.Load(name);
    var doc = new YDoc();

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(fixture.Update).Outcome);

    AssertJsonEqual(Expected(fixture), RichTextRuntime.Export(doc));
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void SeedRoundTripsThroughStateDiffIntoASecondDoc(string name)
  {
    var fixture = YDocConverterFixtures.Load(name);
    var source = new YDoc();
    var replica = new YDoc();

    RichTextRuntime.Seed(source, fixture.Input);

    var diff = source.EncodeStateAsUpdate(replica.EncodeStateVector());

    Assert.Equal(ApplyOutcome.Applied, replica.ApplyUpdate(diff).Outcome);

    var exported = RichTextRuntime.Export(replica);

    AssertJsonEqual(Expected(fixture), exported);
    AssertJsonEqual(RichTextRuntime.Export(source), exported);
  }

  /// <summary>
  /// The host shape (contract §9): <c>canonical.segments.json</c>, which the
  /// format-2 generator writes next to <c>canonical.json</c> (the editor
  /// reader's HTML). No fallback: until those fixtures exist these tests are
  /// red on purpose.
  /// </summary>
  private static System.Text.Json.Nodes.JsonArray Expected(YDocConverterFixture fixture)
  {
    return fixture.CanonicalSegments ?? throw new InvalidDataException(
        $"collab fixture \"{fixture.Name}\" has no canonical.segments.json; regenerate the " +
        "fixtures with the format-2 client (scripts/generate-collab-fixtures.mjs).");
  }

  private static void AssertJsonEqual(
      System.Text.Json.Nodes.JsonNode expected,
      System.Text.Json.Nodes.JsonNode actual)
  {
    Assert.Equal(
        YDocConverterFixtures.Canonicalize(expected),
        YDocConverterFixtures.Canonicalize(actual));
  }
}
