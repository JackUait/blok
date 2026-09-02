namespace Blok.Server.Yjs;

/// <summary>
/// A subdocument as a value: opaque, and deliberately not a string. yjs hands
/// the guid back inside a Y.Doc, which the client renders as {}; a bare
/// string here would be indistinguishable from a real string value and would
/// export the guid the record never carried.
/// </summary>
internal sealed class YSubdoc(string guid, object? options)
{
  internal string Guid { get; } = guid;

  internal object? Options { get; } = options;
}

/// <summary>
/// Ref 9: a subdocument, opaque here — its guid and its options survive a
/// round trip, its content lives in its own document.
/// </summary>
internal sealed class ContentDoc(string guid, object? options) : YContent
{
  public override byte Ref => 9;

  public override int Length => 1;

  public override bool IsCountable => true;

  internal string Guid { get; } = guid;

  public override IReadOnlyList<object?> GetContent()
  {
    return [new YSubdoc(Guid, Options)];
  }

  internal object? Options { get; } = options;

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarString(Guid);
    AnyCodec.Write(writer, Options);
  }

  internal static ContentDoc Read(ref Lib0Reader reader)
  {
    var guid = reader.ReadVarString();

    return new ContentDoc(guid, AnyCodec.Read(ref reader));
  }
}
