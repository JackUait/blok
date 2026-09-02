namespace Blok.Server.Yjs;

/// <summary>
/// Ref 3: one opaque byte array. The decoder copies it out of the borrowed
/// span, as yjs copies it out of its decoder's buffer.
/// </summary>
internal sealed class ContentBinary(byte[] bytes) : YContent
{
  public override byte Ref => 3;

  public override int Length => 1;

  public override bool IsCountable => true;

  internal byte[] Bytes { get; } = bytes;

  public override IReadOnlyList<object?> GetContent()
  {
    return [Bytes];
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarBytes(Bytes);
  }
}
