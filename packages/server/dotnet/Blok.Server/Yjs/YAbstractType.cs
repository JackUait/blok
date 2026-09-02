using System.Text;

namespace Blok.Server.Yjs;

/// <summary>
/// What every shared type has: the item that holds it (null for a root), the
/// map heads for keyed values, and the head of the list chain. A type carries
/// both because a Y.Map's values and a Y.Array's entries live in the same
/// struct store and only differ by whether the item has a parentSub.
/// </summary>
internal abstract class YAbstractType
{
  /// <summary>The <see cref="ContentType"/> item owning this type; null for a root.</summary>
  public YItem? Item { get; set; }

  /// <summary>The document this type belongs to; null until it is integrated.</summary>
  public YDoc? Doc { get; set; }

  /// <summary>The document root name this type answers to; null when nested.</summary>
  public string? RootName { get; set; }

  /// <summary>parentSub to the newest item written for it, deleted or not.</summary>
  public Dictionary<string, YItem> Map { get; } = new(StringComparer.Ordinal);

  /// <summary>Head of the list chain, walked through <see cref="YItem.Right"/>.</summary>
  public YItem? Start { get; set; }

  /// <summary>Countable, undeleted elements; maintained by integration, not by reads.</summary>
  public int Length { get; set; }

  /// <summary>yjs's AbstractType._integrate: a type learns its document and its owner.</summary>
  public void Integrate(YDoc doc, YItem? item)
  {
    Doc = doc;
    Item = item;
  }

  /// <summary>
  /// The instance a <see cref="ContentType"/> ref names. The refs are the wire's
  /// own numbering, checked when the content was read, so an unknown one here
  /// is an engine bug rather than bad input.
  /// </summary>
  public static YAbstractType CreateType(int typeRef, string? name)
  {
    return typeRef switch
    {
      0 => new YArray(),
      1 => new YMap(),
      2 => new YText(),
      3 => new YXmlElement(name),
      4 => new YXmlFragment(),
      5 => new YXmlHook(name),
      6 => new YXmlText(),
      _ => throw new InvalidOperationException($"yjs: {typeRef} is not a shared type ref."),
    };
  }

  /// <summary>
  /// The text of every undeleted <see cref="ContentString"/> in a chain, which
  /// is what a Y.Text exports: embeds carry no text and formatting marks are
  /// not countable.
  /// </summary>
  private protected static string ConcatenateStrings(YItem? start)
  {
    var text = new StringBuilder();

    for (var item = start; item is not null; item = item.Right)
    {
      if (!item.Deleted && item.Countable && item.Content is ContentString content)
      {
        text.Append(content.Text);
      }
    }

    return text.ToString();
  }
}

/// <summary>
/// A root nothing has typed yet. Integration creates one for every root name
/// a remote update mentions, because the wire says which root an item belongs
/// to but never which kind it is; the first <c>GetMap</c>/<c>GetArray</c>/
/// <c>GetText</c> upgrades it in place, as yjs's Doc.get does.
/// </summary>
internal sealed class YUntypedType : YAbstractType
{
}
