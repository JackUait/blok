using System.Text.Json.Nodes;

namespace Blok.Server.Yjs;

/// <summary>
/// Ref 2: the legacy JSON content, one varstring per element. The raw strings
/// are kept verbatim — v1 writes JSON.stringify output and System.Text.Json
/// escapes differently, so a re-encode of a parsed value would not be the
/// bytes that arrived. 'undefined' is a sentinel, not JSON.
/// </summary>
internal sealed class ContentJson(IReadOnlyList<string> values) : YContent
{
  public override byte Ref => 2;

  public override int Length => Values.Count;

  public override bool IsCountable => true;

  /// <summary>The wire strings, unparsed.</summary>
  internal IReadOnlyList<string> Values { get; private set; } = values;

  /// <summary>
  /// Parsed on read only. 'undefined' is the sentinel yjs writes for a value
  /// JSON cannot hold, so it reads back as undefined rather than as a string.
  /// </summary>
  public override IReadOnlyList<object?> GetContent()
  {
    return Values
        .Select(value => value == "undefined"
            ? YUndefined.Instance
            : (object?)JsonNode.Parse(value))
        .ToArray();
  }

  public override YContent Splice(int offset)
  {
    var right = new ContentJson(Values.Skip(offset).ToArray());

    Values = Values.Take(offset).ToArray();

    return right;
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)(Values.Count - offset));

    for (var index = offset; index < Values.Count; index++)
    {
      writer.WriteVarString(Values[index]);
    }
  }

  public override YContent Copy()
  {
    return new ContentJson(Values);
  }

  internal static ContentJson Read(ref Lib0Reader reader)
  {
    var count = ReadLength(ref reader, "ContentJSON element count");
    var values = new List<string>();

    for (var index = 0; index < count; index++)
    {
      // 'undefined' is yjs's sentinel and is deliberately not JSON, so it is
      // the one element that skips the check.
      var raw = reader.ReadVarString();

      if (!string.Equals(raw, "undefined", StringComparison.Ordinal))
      {
        ValidateJson(raw, reader.Position, "ContentJSON element");
      }

      values.Add(raw);
    }

    return new ContentJson(values);
  }
}
