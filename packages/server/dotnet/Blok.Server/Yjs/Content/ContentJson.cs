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
  internal IReadOnlyList<string> Values { get; } = values;

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)(Values.Count - offset));

    for (var index = offset; index < Values.Count; index++)
    {
      writer.WriteVarString(Values[index]);
    }
  }

  internal static ContentJson Read(ref Lib0Reader reader)
  {
    var count = ReadLength(ref reader, "ContentJSON element count");
    var values = new List<string>();

    for (var index = 0; index < count; index++)
    {
      values.Add(reader.ReadVarString());
    }

    return new ContentJson(values);
  }
}
