namespace Blok.Server.Yjs;

/// <summary>
/// Ref 7: a nested shared type. The wire carries one type ref, and for
/// YXmlElement (3) and YXmlHook (5) one extra string — the node name and the
/// hook name. Reading a type ref outside 0..6 cannot continue: whether that
/// extra string follows is unknowable, and yjs itself throws.
/// </summary>
internal sealed class ContentType(int typeRef, string? name) : YContent
{
  /// <summary>0 Array, 1 Map, 2 Text, 3 XmlElement, 4 XmlFragment, 5 XmlHook, 6 XmlText.</summary>
  private const int MaxTypeRef = 6;

  private const int XmlElementRef = 3;

  private const int XmlHookRef = 5;

  public override byte Ref => 7;

  public override int Length => 1;

  public override bool IsCountable => true;

  internal int TypeRef { get; } = typeRef;

  /// <summary>The node name (ref 3) or hook name (ref 5); null for the rest.</summary>
  internal string? Name { get; } = name;

  /// <summary>
  /// The type instance. Built here rather than at integration because yjs
  /// builds it while reading: a child item names its parent by id and reads
  /// this instance off the already-integrated parent.
  /// </summary>
  internal YAbstractType Type { get; set; } = YAbstractType.CreateType(typeRef, name);

  public override IReadOnlyList<object?> GetContent()
  {
    return [Type];
  }

  public override void Integrate(YTransaction transaction, YItem item)
  {
    ArgumentNullException.ThrowIfNull(transaction);

    Type.Integrate(transaction.Doc, item);
  }

  /// <summary>
  /// Deleting a nested type deletes everything below it (Locked Decision 7):
  /// the list chain and every map head. An already-deleted child older than
  /// this transaction is only queued for merging, never deleted twice.
  /// </summary>
  public override void Delete(YTransaction transaction)
  {
    ArgumentNullException.ThrowIfNull(transaction);

    for (var item = Type.Start; item is not null; item = item.Right)
    {
      Cascade(transaction, item);
    }

    foreach (var head in Type.Map.Values)
    {
      Cascade(transaction, head);
    }
  }

  /// <summary>
  /// Collecting a nested type turns its whole subtree into GC structs, so a
  /// deleted grid stops costing what it held. The map is walked LEFT from
  /// each head: the older values under a key are the rest of that chain.
  /// </summary>
  public override void Gc(StructStore store)
  {
    for (var item = Type.Start; item is not null; item = item.Right)
    {
      item.Gc(store, true);
    }

    Type.Start = null;

    foreach (var head in Type.Map.Values)
    {
      for (YItem? item = head; item is not null; item = item.Left)
      {
        item.Gc(store, true);
      }
    }

    Type.Map.Clear();
  }

  public override YContent Copy()
  {
    return new ContentType(TypeRef, Name);
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)TypeRef);

    if (Name is { } name)
    {
      writer.WriteVarString(name);
    }
  }

  private static void Cascade(YTransaction transaction, YItem item)
  {
    if (!item.Deleted)
    {
      item.Delete(transaction);
    }
    else if (item.Id.Clock < transaction.BeforeState.Get(item.Id.Client))
    {
      transaction.MergeStructs.Add(item);
    }
  }

  internal static ContentType Read(ref Lib0Reader reader)
  {
    var typeRef = reader.ReadVarUint();

    if (typeRef > MaxTypeRef)
    {
      throw new Lib0FormatException(
          $"yjs: {typeRef} at {reader.Position} is not a shared type ref.");
    }

    var named = typeRef is XmlElementRef or XmlHookRef;

    return new ContentType((int)typeRef, named ? reader.ReadVarString() : null);
  }
}
