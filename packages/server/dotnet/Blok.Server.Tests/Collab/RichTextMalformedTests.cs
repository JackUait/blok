using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// Host, peer and stored rich text is never trusted: a malformed mark or
/// embed is normalised away, never thrown on, and never kept for a client to
/// choke on. Same rules as the TS converters (final-fix-rules.md).
/// </summary>
public sealed class RichTextMalformedTests
{
  public static TheoryData<string, string> Segments()
  {
    return new TheoryData<string, string>
    {
      // tag:* records keep only string attributes; a non-record drops the mark.
      { """[{"text":"x","marks":{"tag:b":{"x":1}}}]""", """[{"text":"x","marks":{"tag:b":{}}}]""" },
      { """[{"text":"x","marks":{"tag:b":{"x":null,"y":"1","z":{"a":"b"}}}}]""", """[{"text":"x","marks":{"tag:b":{"y":"1"}}}]""" },
      { """[{"text":"x","marks":{"tag:b":"str","bold":true}}]""", """[{"text":"x","marks":{"bold":true}}]""" },
      { """[{"text":"x","marks":{"tag:b":[1]}}]""", """[{"text":"x"}]""" },
      { """[{"text":"x","marks":{"tag:b":5}}]""", """[{"text":"x"}]""" },

      // color and background are strings or absent.
      { """[{"text":"x","marks":{"color":{},"background":5,"bold":true}}]""", """[{"text":"x","marks":{"bold":true}}]""" },
      { """[{"text":"x","marks":{"color":"red","background":["b"]}}]""", """[{"text":"x","marks":{"color":"red"}}]""" },

      // An embed is exactly one of three shapes, or the segment is dropped.
      { """[{"text":"a"},{"embed":{"equation":{"expression":5}}},{"text":"b"}]""", """[{"text":"ab"}]""" },
      { """[{"embed":{"equation":null}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"page":{"id":{}}}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"html":5}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"html":{"a":"b"}}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"glow":"x"}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"equation":{"expression":"e"},"page":{"id":"p"}}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"equation":{"expression":"e","extra":"1"}}},{"text":"b"}]""", """[{"text":"b"}]""" },
      { """[{"embed":{"page":{"id":["p"]}}},{"text":"b"}]""", """[{"text":"b"}]""" },

      // Only the content and the marks survive; other keys are dropped.
      { """[{"text":"a","checked":true},{"embed":{"html":"h"},"glow":1}]""", """[{"text":"a"},{"embed":{"html":"h"}}]""" },
      { """[{"text":"a","marks":"bold"}]""", """[{"text":"a"}]""" },

      // The three valid shapes stay as written.
      {
        """[{"embed":{"equation":{"expression":"e"}}},{"embed":{"page":{"id":"p"}}},{"embed":{"html":"<b>h</b>"}}]""",
        """[{"embed":{"equation":{"expression":"e"}}},{"embed":{"page":{"id":"p"}}},{"embed":{"html":"<b>h</b>"}}]"""
      },
    };
  }

  [Theory]
  [MemberData(nameof(Segments))]
  public void CanonicalizeNormalisesMalformedValues(string input, string expected)
  {
    Assert.Equal(expected, JsJson.Stringify(RichText.Canonicalize((AnyArray)JsJson.Parse(input)!)));
  }

  [Theory]
  [MemberData(nameof(Segments))]
  public void ReadInputNormalisesMalformedValues(string input, string expected)
  {
    Assert.Equal(expected, JsJson.Stringify(RichText.ReadInput((AnyArray)JsJson.Parse(input)!)));
  }

  [Fact]
  public void ADeltaWithMalformedEmbedsAndMarksReadsAsTheValidSegments()
  {
    var delta = new List<YTextDelta>
    {
      new("a", Marks(("tag:b", Record(("x", 1d), ("y", "1"))), ("color", new AnyObject()))),
      new(Record(("equation", Record(("expression", 5d)))), null),
      new(Record(("page", null)), null),
      new(Record(("html", "<i>h</i>")), null),
      new("b", null),
    };

    Assert.Equal(
        """[{"text":"a","marks":{"tag:b":{"y":"1"}}},{"embed":{"html":"<i>h</i>"}},{"text":"b"}]""",
        JsJson.Stringify(RichText.FromDelta(delta)));
  }

  private static AnyObject Marks(params (string Key, object? Value)[] entries)
  {
    return Record(entries);
  }

  private static AnyObject Record(params (string Key, object? Value)[] entries)
  {
    var record = new AnyObject();

    foreach (var (key, value) in entries)
    {
      record.Add(key, value);
    }

    return record;
  }
}
