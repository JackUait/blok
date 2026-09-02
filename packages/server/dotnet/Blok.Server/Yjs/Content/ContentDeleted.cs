namespace Blok.Server.Yjs;

/// <summary>
/// Ref 1: the tombstone a deleted item's content collapses to. It keeps the
/// length so clocks still line up, and counts for nothing.
/// </summary>
internal sealed class ContentDeleted(int length) : YContent
{
  private int ticks = length;

  public override byte Ref => 1;

  public override int Length => ticks;

  public override bool IsCountable => false;

  public override IReadOnlyList<object?> GetContent()
  {
    return [];
  }

  public override YContent Splice(int offset)
  {
    var right = new ContentDeleted(ticks - offset);

    ticks = offset;

    return right;
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)(Length - offset));
  }
}
