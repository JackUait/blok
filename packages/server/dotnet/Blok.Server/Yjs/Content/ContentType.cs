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

  /// <summary>The instantiated type, set when the item is integrated.</summary>
  internal YAbstractType? Type { get; set; }

  public override IReadOnlyList<object?> GetContent()
  {
    return [Type];
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarUint((ulong)TypeRef);

    if (Name is { } name)
    {
      writer.WriteVarString(name);
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
