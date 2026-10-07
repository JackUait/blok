using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The C# canonical form must equal the client's character for character:
/// the export, the echo check and the edit no-op check all compare it.
/// Expected values come from the real TS functions (see
/// rich-text-canonical-fixtures.test.ts).
/// </summary>
public sealed class RichTextCanonicalTests
{
  private const string Inputs = "rich-text-canonical/inputs.json";
  private const string Expected = "rich-text-canonical/expected.json";

  public static TheoryData<string> SegmentCases()
  {
    return new TheoryData<string>(CaseNames("segments"));
  }

  public static TheoryData<string> DeltaCases()
  {
    return new TheoryData<string>(CaseNames("deltas"));
  }

  [Theory]
  [MemberData(nameof(SegmentCases))]
  public void CanonicalizeMatchesTheClient(string name)
  {
    var input = (AnyArray)Input("segments", name)!;

    Assert.Equal(ExpectedJson("segments", name), JsJson.Stringify(RichText.Canonicalize(input)));
  }

  [Theory]
  [MemberData(nameof(DeltaCases))]
  public void FromDeltaMatchesTheClient(string name)
  {
    var delta = ((AnyArray)Input("deltas", name)!)
        .Select(op =>
        {
          var entry = (AnyObject)op!;

          entry.TryGet("insert", out var insert);
          entry.TryGet("attributes", out var attributes);

          return new YTextDelta(insert, attributes as AnyObject);
        })
        .ToList();

    Assert.Equal(ExpectedJson("deltas", name), JsJson.Stringify(RichText.FromDelta(delta)));
  }

  [Fact]
  public void FromDeltaNeverChangesTheDeltaItReads()
  {
    var link = new AnyObject();

    link.Add("rel", "r");
    link.Add("href", "h");

    var attributes = new AnyObject();

    attributes.Add("link", link);
    attributes.Add("bold", true);

    var before = JsJson.Stringify(attributes);

    RichText.FromDelta([new YTextDelta("a", attributes)]);
    RichText.Normalize(attributes);

    Assert.Equal(before, JsJson.Stringify(attributes));
  }

  private static IEnumerable<string> CaseNames(string group)
  {
    var inputs = (AnyObject)RichTextFixtures.ReadEngine(Inputs)!;

    inputs.TryGet(group, out var cases);

    return ((AnyArray)cases!).Select(entry =>
    {
      ((AnyObject)entry!).TryGet("name", out var caseName);

      return (string)caseName!;
    });
  }

  private static object? Input(string group, string name)
  {
    var inputs = (AnyObject)RichTextFixtures.ReadEngine(Inputs)!;

    inputs.TryGet(group, out var cases);

    foreach (var entry in (AnyArray)cases!)
    {
      var item = (AnyObject)entry!;

      item.TryGet("name", out var caseName);

      if ((string)caseName! == name)
      {
        item.TryGet("input", out var input);

        return input;
      }
    }

    throw new InvalidDataException($"no {group} case {name}");
  }

  private static string ExpectedJson(string group, string name)
  {
    var expected = (AnyObject)RichTextFixtures.ReadEngine(Expected)!;

    expected.TryGet(group, out var cases);
    ((AnyObject)cases!).TryGet(name, out var value);

    return JsJson.Stringify(value);
  }
}
