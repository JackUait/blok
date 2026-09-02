namespace Blok.Server.Yjs;

/// <summary>
/// An item's payload. Yjs numbers the nine kinds 1..9 and packs the number
/// into the low five bits of the item's info byte, so the same byte selects
/// the reader; 0 is a GC struct and 10 a Skip struct, neither of which is
/// item content.
///
/// This wave decodes, measures and re-writes content. Integration, deletion
/// and splicing arrive with the struct store.
/// </summary>
internal abstract class YContent
{
  /// <summary>The wire's content ref, 1..9.</summary>
  public abstract byte Ref { get; }

  /// <summary>How many clock ticks the content occupies.</summary>
  public abstract int Length { get; }

  /// <summary>False for deleted content and formatting marks, which no index counts.</summary>
  public abstract bool IsCountable { get; }

  /// <summary>
  /// Writes the payload as the v1 wire wants it, dropping the first
  /// <paramref name="offset"/> ticks. Only the first struct of a client group
  /// is ever written at an offset.
  /// </summary>
  public abstract void Write(Lib0Writer writer, int offset);

  /// <summary>
  /// The payload as a list of values, one per clock tick, which is what a map
  /// or list read indexes into. Content that occupies ticks without holding
  /// values — a tombstone, a formatting mark — yields nothing.
  /// </summary>
  public abstract IReadOnlyList<object?> GetContent();

  /// <summary>
  /// Cuts the payload at <paramref name="offset"/>, keeping the left part here
  /// and returning the right one. Content that is always one tick long is
  /// never split, and yjs throws there rather than inventing a half.
  /// </summary>
  public virtual YContent Splice(int offset)
  {
    throw new InvalidOperationException(
        $"yjs: content ref {Ref} occupies one tick and cannot be split.");
  }

  /// <summary>Reads the payload the item's info byte selects.</summary>
  public static YContent Read(byte info, ref Lib0Reader reader)
  {
    var contentRef = info & 0x1F;

    return contentRef switch
    {
      1 => new ContentDeleted(ReadLength(ref reader, "ContentDeleted length")),
      2 => ContentJson.Read(ref reader),
      3 => new ContentBinary(reader.ReadVarBytes().ToArray()),
      4 => new ContentString(reader.ReadVarString()),
      5 => new ContentEmbed(reader.ReadVarString()),
      6 => new ContentFormat(reader.ReadVarString(), reader.ReadVarString()),
      7 => ContentType.Read(ref reader),
      8 => ContentAny.Read(ref reader),
      9 => ContentDoc.Read(ref reader),
      _ => throw new Lib0FormatException(
          $"yjs: {contentRef} at {reader.Position - 1} is not an item content ref."),
    };
  }

  /// <summary>
  /// A count or length the rest of the engine holds in an int. lib0 allows
  /// 2^53-1, which no buffer can back, so the cast is guarded here rather
  /// than left to overflow silently.
  /// </summary>
  internal static int ReadLength(ref Lib0Reader reader, string what)
  {
    var value = reader.ReadVarUint();

    return value <= int.MaxValue
        ? (int)value
        : throw new Lib0FormatException(
            $"yjs: the {what} at {reader.Position} is {value}, past int.MaxValue.");
  }
}
