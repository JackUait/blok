namespace Blok.Server.Yjs;

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
