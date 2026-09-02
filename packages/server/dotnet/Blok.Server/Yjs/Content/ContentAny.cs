namespace Blok.Server.Yjs;

/// <summary>
/// Ref 8: a run of plain values, each a lib0 Any. One run is one struct, so
/// inserting three strings costs three clock ticks and one item.
/// </summary>
internal sealed class ContentAny(IReadOnlyList<object?> values) : YContent
{
  public override byte Ref => 8;

  public override int Length => Values.Count;

  public override bool IsCountable => true;

  internal IReadOnlyList<object?> Values { get; private set; } = values;

  public override IReadOnlyList<object?> GetContent()
  {
    return Values;
  }

  public override YContent Splice(int offset)
  {
    var right = new ContentAny(Values.Skip(offset).ToArray());

    Values = Values.Take(offset).ToArray();

    return right;
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)(Values.Count - offset));

    for (var index = offset; index < Values.Count; index++)
    {
      AnyCodec.Write(writer, Values[index]);
    }
  }

  internal static ContentAny Read(ref Lib0Reader reader)
  {
    var count = ReadLength(ref reader, "ContentAny element count");
    var values = new List<object?>();

    for (var index = 0; index < count; index++)
    {
      values.Add(AnyCodec.Read(ref reader));
    }

    return new ContentAny(values);
  }
}
