using System.Text.Json;
using System.Text.Json.Nodes;

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
  /// <summary>
  /// How deep a JSON payload may nest. JSON.parse has no limit of its own, but
  /// everything downstream of a decoded value walks it recursively, so the
  /// ceiling is set once here and reused wherever the raw string is parsed
  /// back. It sits above the converter's own value depth, so nothing this
  /// accepts is later refused for being too deep.
  /// </summary>
  internal static readonly JsonDocumentOptions JsonLimits = new() { MaxDepth = 512 };

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

  /// <summary>
  /// Runs when the owning item joins the document. Only a nested type (which
  /// learns its document here) and a tombstone (which marks its item deleted)
  /// need it.
  /// </summary>
  public virtual void Integrate(YTransaction transaction, YItem item)
  {
  }

  /// <summary>Runs when the owning item is deleted; a nested type cascades.</summary>
  public virtual void Delete(YTransaction transaction)
  {
  }

  /// <summary>Runs when a deleted item is collected; a nested type collects its subtree.</summary>
  public virtual void Gc(StructStore store)
  {
  }

  /// <summary>
  /// An independent payload for a second integration of the same decoded
  /// update. Splicing, and a nested type learning its document, both mutate
  /// the payload in place, so a re-applied update must not share one.
  /// Immutable payloads return themselves.
  /// </summary>
  public virtual YContent Copy()
  {
    return this;
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
      5 => new ContentEmbed(ReadJson(ref reader, "ContentEmbed")),
      6 => new ContentFormat(reader.ReadVarString(), ReadJson(ref reader, "ContentFormat")),
      7 => ContentType.Read(ref reader),
      8 => ContentAny.Read(ref reader),
      9 => ContentDoc.Read(ref reader),
      _ => throw new Lib0FormatException(
          $"yjs: {contentRef} at {reader.Position - 1} is not an item content ref."),
    };
  }

  /// <summary>
  /// A payload v1 spells as JSON. yjs's decoder runs JSON.parse on it, so a
  /// string that is not JSON is refused by every yjs peer and must be refused
  /// here too: a struct no peer can read would be persisted and re-sent
  /// forever.
  ///
  /// Only the syntax is checked and the wire's own string is returned. v1
  /// carries JSON.stringify's output, which System.Text.Json re-escapes
  /// differently, so re-encoding has to replay the original bytes.
  /// <see cref="JsonDocument"/> is what does the checking because its reader
  /// walks iteratively and agrees with JSON.parse — including on a lone
  /// surrogate escape, duplicate keys and an overflowing exponent, all of
  /// which a browser accepts and <see cref="JsonNode"/> does not.
  /// </summary>
  internal static string ReadJson(ref Lib0Reader reader, string what)
  {
    var raw = reader.ReadVarString();

    ValidateJson(raw, reader.Position, what);

    return raw;
  }

  /// <inheritdoc cref="ReadJson"/>
  internal static void ValidateJson(string raw, int position, string what)
  {
    try
    {
      using var parsed = JsonDocument.Parse(raw, JsonLimits);
    }
    catch (JsonException failure)
    {
      throw new Lib0FormatException(
          $"yjs: the {what} at {position} is not JSON: {failure.Message}");
    }
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
