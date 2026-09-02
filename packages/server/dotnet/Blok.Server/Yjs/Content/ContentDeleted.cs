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

  public override YContent Copy()
  {
    return new ContentDeleted(ticks);
  }

  /// <summary>
  /// The wire's own tombstone: the item arrives already deleted, so the
  /// deletion is recorded in this transaction rather than inferred later.
  /// </summary>
  public override void Integrate(YTransaction transaction, YItem item)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentNullException.ThrowIfNull(item);

    transaction.DeleteSet.Add(item.Id.Client, item.Id.Clock, (ulong)ticks);
    item.MarkDeleted();
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)(Length - offset));
  }
}
