using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// A block type or data key is matched against the rich text fields as exact
/// UTF-16: a lone surrogate is not its U+FFFD replacement. Only a peer's
/// legacy JSON content (ref 2) can carry one. The Go twin is
/// internal/collab/convert/lonesurrogate_test.go.
/// </summary>
public sealed class YDocConverterLoneSurrogateTests
{
  // Facts, not theories: xunit round-trips theory data through UTF-8, which
  // turns a lone surrogate into U+FFFD.
  [Fact]
  public void ATypeOfALoneSurrogateIsNotItsReplacementsRichField()
  {
    Assert.Equal(0, SlotCount(nested: false, "\uFFFD", "text"));
    Assert.Equal(1, SlotCount(nested: false, "\uD800", "text"));
  }

  [Fact]
  public void ANestedDataKeyOfALoneSurrogateIsNotItsReplacementsRichField()
  {
    Assert.Equal(0, SlotCount(nested: true, "callout", "\uFFFD"));
    Assert.Equal(1, SlotCount(nested: true, "callout", "\uD800"));
  }

  private static int SlotCount(bool nested, string type, string field)
  {
    var fields = RichTextFields.With(new Dictionary<string, IList<string>> { [type] = [field] });

    YDocConverter.Export(Room(nested), fields, null, out var slots);

    return slots.Count;
  }

  /// <summary>
  /// As client 1, block "p". Not nested: its type is the JSON content
  /// <c>"\ud800"</c> and data.text a Y.Text of <c>&lt;b&gt;x&lt;/b&gt;</c>.
  /// Nested: a database-row whose data.properties is the JSON content of a
  /// document holding a callout with the data key <c>"\ud800"</c>.
  /// </summary>
  internal static YDoc Room(bool nested)
  {
    var w = new Lib0Writer();

    void Field(string key, byte info, ulong parentClock = 0)
    {
      w.WriteUint8(info);
      w.WriteVarUint(0);
      w.WriteVarUint(1);
      w.WriteVarUint(parentClock);
      w.WriteVarString(key);
    }

    w.WriteVarUint(1);
    w.WriteVarUint(nested ? 6UL : 7UL);
    w.WriteVarUint(1);
    w.WriteVarUint(0);
    w.WriteUint8(0x27);
    w.WriteVarUint(1);
    w.WriteVarString("blocks");
    w.WriteVarString("p");
    w.WriteVarUint(1);
    Field("id", 0x28);
    w.WriteVarUint(1);
    w.WriteUint8(119);
    w.WriteVarString("p");

    if (nested)
    {
      Field("type", 0x28);
      w.WriteVarUint(1);
      w.WriteUint8(119);
      w.WriteVarString("database-row");
    }
    else
    {
      Field("type", 0x22);
      w.WriteVarUint(1);
      w.WriteVarString("\"\\ud800\"");
    }

    Field("data", 0x27);
    w.WriteVarUint(1);

    if (nested)
    {
      Field("properties", 0x22, parentClock: 3);
      w.WriteVarUint(1);
      w.WriteVarString("""{"p":{"blocks":[{"type":"callout","data":{"\ud800":"<b>x</b>"}}]}}""");
    }
    else
    {
      Field("text", 0x27, parentClock: 3);
      w.WriteVarUint(2);
      w.WriteUint8(0x04);
      w.WriteVarUint(0);
      w.WriteVarUint(1);
      w.WriteVarUint(4);
      w.WriteVarString("<b>x</b>");
    }

    w.WriteUint8(0x08);
    w.WriteVarUint(1);
    w.WriteVarString("root");
    w.WriteVarUint(1);
    w.WriteUint8(119);
    w.WriteVarString("p");
    w.WriteVarUint(0);

    var doc = new YDoc(2);

    Assert.Equal(ApplyOutcome.Applied, doc.ApplyUpdate(w.ToArray()).Outcome);

    return doc;
  }
}
