namespace Blok.Server.Yjs;

/// <summary>
/// A collected run of deleted clocks: the content is gone, only the span
/// remains so later clocks still line up. Peers run with gc on, so these
/// arrive on the wire from day one.
/// </summary>
internal sealed class YGc : YStruct
{
  public override bool IsDeleted => true;

  /// <summary>Info byte 0, then the remaining run length.</summary>
  public void Write(Lib0Writer writer, int offset)
  {
    ArgumentNullException.ThrowIfNull(writer);

    writer.WriteUint8(0);
    writer.WriteVarUint((ulong)(Length - offset));
  }

  /// <summary>
  /// Files the run. <paramref name="offset"/> is the part the store already
  /// has, so the run starts where the store's knowledge ends.
  /// </summary>
  public void Integrate(YTransaction transaction, int offset)
  {
    ArgumentNullException.ThrowIfNull(transaction);

    if (offset > 0)
    {
      Id = new YId(Id.Client, Id.Clock + (ulong)offset);
      Length -= offset;
    }

    transaction.Doc.Store.AddStruct(this);
  }
}
