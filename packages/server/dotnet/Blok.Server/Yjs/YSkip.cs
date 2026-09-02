namespace Blok.Server.Yjs;

/// <summary>
/// A hole an update declares but does not fill. It is never integrated and
/// never enters the store; it exists so an update carrying pending structs can
/// name the clocks it is skipping over.
/// </summary>
internal sealed class YSkip : YStruct
{
  public override bool IsDeleted => true;

  /// <summary>
  /// Info byte 10, then the gap length as a RAW varuint — never the length
  /// encoding, because no run-length scheme can predict a hole's size.
  /// </summary>
  public void Write(Lib0Writer writer, int offset)
  {
    ArgumentNullException.ThrowIfNull(writer);

    writer.WriteUint8(10);
    writer.WriteVarUint((ulong)(Length - offset));
  }
}
