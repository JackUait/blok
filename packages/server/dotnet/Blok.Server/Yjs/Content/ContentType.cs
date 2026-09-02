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

  private const int ArrayRef = 0;

  private const int MapRef = 1;

  private const int TextRef = 2;

  private const int XmlElementRef = 3;

  private const int XmlFragmentRef = 4;

  private const int XmlHookRef = 5;

  private const int XmlTextRef = 6;

  /// <summary>
  /// The write side: an instance the caller built, rather than one this
  /// content creates from a wire ref. The type must not already be in a
  /// document — yjs would integrate it twice and fork its children.
  /// </summary>
  public ContentType(YAbstractType type)
      : this(RefOf(type), NameOf(type))
  {
    if (type.Doc is not null)
    {
      throw new ArgumentException(
          "yjs: this shared type already belongs to a document.", nameof(type));
    }

    // The chained constructor built an instance from the ref; it is replaced
    // here, because the caller's own instance is the one holding the content.
    Type = type;
  }

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

    // Top-down, and inside this transaction: a prelim type's own content is
    // written only once its owner holds a clock, so the children come after it.
    Type.IntegratePrelim(transaction);
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

  /// <summary>The wire's numbering for a type instance; the inverse of CreateType.</summary>
  private static int RefOf(YAbstractType type)
  {
    ArgumentNullException.ThrowIfNull(type);

    return type switch
    {
      YArray => ArrayRef,
      YMap => MapRef,
      YText => TextRef,
      YXmlElement => XmlElementRef,
      YXmlFragment => XmlFragmentRef,
      YXmlHook => XmlHookRef,
      YXmlText => XmlTextRef,
      _ => throw new ArgumentException(
          $"yjs: {type.GetType().Name} has no shared type ref.", nameof(type)),
    };
  }

  /// <summary>The extra string refs 3 and 5 carry; null for every other kind.</summary>
  private static string? NameOf(YAbstractType type)
  {
    return type switch
    {
      YXmlElement element => element.NodeName,
      YXmlHook hook => hook.HookName,
      _ => null,
    };
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
