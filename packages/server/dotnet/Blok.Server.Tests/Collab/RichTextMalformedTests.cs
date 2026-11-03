using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Host, peer and stored rich text is never trusted: a malformed mark or
/// embed is normalised away, never thrown on, and never kept for a client to
/// choke on. Same rules as the TS converters (final-fix-rules.md).
/// The cases are the "malformed-" ones in rich-text-canonical, which the Go
/// server reads too; RichTextCanonicalTests runs them through Canonicalize
/// and FromDelta.
/// </summary>
public sealed class RichTextMalformedTests
{
  private const string Prefix = "malformed-";

  public static TheoryData<string> Segments()
  {
    return new TheoryData<string>(Cases("inputs.json", "segments").Select(entry => entry.Name));
  }

  [Fact]
  public void TheSharedFixtureHoldsTheMalformedCases()
  {
    Assert.True(Cases("inputs.json", "segments").Count() >= 20);
    Assert.NotEmpty(Cases("inputs.json", "deltas"));
  }

  [Theory]
  [MemberData(nameof(Segments))]
  public void ReadInputNormalisesMalformedValues(string name)
  {
    var input = (AnyArray)Cases("inputs.json", "segments").Single(entry => entry.Name == name).Input!;
    var expected = (AnyObject)RichTextFixtures.ReadEngine("rich-text-canonical/expected.json")!;

    expected.TryGet("segments", out var segments);
    ((AnyObject)segments!).TryGet(name, out var value);

    Assert.Equal(JsJson.Stringify(value), JsJson.Stringify(RichText.ReadInput(input)));
  }

  private static IEnumerable<(string Name, object? Input)> Cases(string file, string group)
  {
    var inputs = (AnyObject)RichTextFixtures.ReadEngine($"rich-text-canonical/{file}")!;

    inputs.TryGet(group, out var cases);

    foreach (var entry in (AnyArray)cases!)
    {
      var item = (AnyObject)entry!;

      item.TryGet("name", out var name);
      item.TryGet("input", out var input);

      if (((string)name!).StartsWith(Prefix, StringComparison.Ordinal))
      {
        yield return ((string)name!, input);
      }
    }
  }
}
