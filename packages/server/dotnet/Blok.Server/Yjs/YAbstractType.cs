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
  /// The tail of yjs's _integrate, where a prelim type writes what it was
  /// built with. Kept apart from <see cref="Integrate"/> because a ROOT
  /// integrates outside any transaction, and this needs one.
  /// </summary>
  internal virtual void IntegratePrelim(YTransaction transaction)
  {
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
  /// Refuses a write to a type that has no document: a write needs a client id
  /// and a clock, and a prelim type has neither. yjs stashes such a write and
  /// replays it at integration; here a prelim type is seeded at construction.
  /// </summary>
  private protected void RequireAttached()
  {
    if (Doc is null)
    {
      throw new InvalidOperationException(
          "yjs: this type is not in a document; seed a prelim type at construction instead.");
    }
  }

  /// <summary>
  /// yjs's <c>new Item(createID(ownClientId, getState(...)), left, left &amp;&amp; left.lastId,
  /// right, right &amp;&amp; right.id, parent, parentSub, content)</c>. The wire's parentSub
  /// bit is set here from the parentSub itself, which is what yjs's writer does; a
  /// DECODED item carries the bit separately because an origin suppresses the bytes.
  /// </summary>
  private protected YItem NewItem(
      YTransaction transaction, YItem? left, YItem? right, string? parentSub, YContent content)
  {
    var doc = transaction.Doc;

    return new YItem
    {
      Id = new YId(doc.ClientId, doc.Store.GetState(doc.ClientId)),
      Length = content.Length,
      Left = left,
      Origin = left?.LastId,
      Right = right,
      RightOrigin = right?.Id,
      Parent = this,
      ParentSub = parentSub,
      WireParentSubBit = parentSub is not null,
      Content = content,
    };
  }

  /// <summary>
  /// yjs's typeMapSet. The new value's left neighbour is the key's current
  /// head, deleted or not, so the key's history stays one chain.
  /// </summary>
  private protected void MapSet(YTransaction transaction, string key, object? value)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentNullException.ThrowIfNull(key);

    var left = Map.GetValueOrDefault(key);

    NewItem(transaction, left, null, key, MapContent(value)).Integrate(transaction, 0);
  }

  /// <summary>yjs's typeMapDelete; an absent or already-deleted key is a no-op.</summary>
  private protected void MapDelete(YTransaction transaction, string key)
  {
    ArgumentNullException.ThrowIfNull(key);

    if (Map.TryGetValue(key, out var head))
    {
      head.Delete(transaction);
    }
  }

  /// <summary>
  /// yjs's typeListInsertGenerics: walk to the index, splitting the item it
  /// falls inside, then insert after whatever is on its left.
  /// </summary>
  private protected void ListInsertGenerics(
      YTransaction transaction, int index, IReadOnlyList<object?> values)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentOutOfRangeException.ThrowIfNegative(index);
    ArgumentOutOfRangeException.ThrowIfGreaterThan(index, Length);

    if (index == 0)
    {
      ListInsertGenericsAfter(transaction, null, values);

      return;
    }

    var current = Start;

    for (; current is not null; current = current.Right)
    {
      if (current.Deleted || !current.Countable)
      {
        continue;
      }

      if (index <= current.Length)
      {
        if (index < current.Length)
        {
          transaction.Doc.Store.GetItemCleanStart(
              transaction, new YId(current.Id.Client, current.Id.Clock + (ulong)index));
        }

        break;
      }

      index -= current.Length;
    }

    ListInsertGenericsAfter(transaction, current, values);
  }

  /// <summary>
  /// yjs's typeListInsertGenericsAfter and the packing rule of Locked Decision
  /// 8: a run of Any values becomes ONE item, and a byte array or a shared
  /// type flushes the run and takes an item of its own.
  /// </summary>
  private protected void ListInsertGenericsAfter(
      YTransaction transaction, YItem? referenceItem, IReadOnlyList<object?> values)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentNullException.ThrowIfNull(values);

    var left = referenceItem;

    // Every item of this insert shares one right neighbour, as yjs does: the
    // ones already placed sit between it and their own left.
    var right = referenceItem is null ? Start : referenceItem.Right;
    var packed = new List<object?>();

    void Place(YContent content)
    {
      left = NewItem(transaction, left, right, null, content);
      left.Integrate(transaction, 0);
    }

    void Flush()
    {
      if (packed.Count > 0)
      {
        Place(new ContentAny([.. packed]));
        packed.Clear();
      }
    }

    foreach (var value in values)
    {
      switch (value)
      {
        case null or bool or double or string or AnyObject or AnyArray:
          packed.Add(value);
          break;

        case byte[] bytes:
          Flush();
          Place(new ContentBinary(bytes));
          break;

        case YAbstractType type:
          Flush();
          Place(new ContentType(type));
          break;

        default:
          throw new ArgumentException(
              $"yjs: {value.GetType().Name} is not a value a list can hold.", nameof(values));
      }
    }

    Flush();
  }

  /// <summary>
  /// yjs's typeListDelete: walk to the index splitting where it lands, then
  /// delete forward, splitting again where the count runs out.
  /// </summary>
  private protected void ListDelete(YTransaction transaction, int index, int length)
  {
    ArgumentNullException.ThrowIfNull(transaction);
    ArgumentOutOfRangeException.ThrowIfNegative(index);
    ArgumentOutOfRangeException.ThrowIfNegative(length);

    if (length == 0)
    {
      return;
    }

    var store = transaction.Doc.Store;
    var current = Start;

    for (; current is not null && index > 0; current = current.Right)
    {
      if (current.Deleted || !current.Countable)
      {
        continue;
      }

      if (index < current.Length)
      {
        store.GetItemCleanStart(
            transaction, new YId(current.Id.Client, current.Id.Clock + (ulong)index));
      }

      index -= current.Length;
    }

    while (length > 0 && current is not null)
    {
      if (!current.Deleted)
      {
        if (length < current.Length)
        {
          store.GetItemCleanStart(
              transaction, new YId(current.Id.Client, current.Id.Clock + (ulong)length));
        }

        length -= current.Length;
        current.Delete(transaction);
      }

      current = current.Right;
    }

    if (length > 0)
    {
      throw new ArgumentOutOfRangeException(
          nameof(length), "yjs: the delete runs past the end of the list.");
    }
  }

  /// <summary>
  /// yjs's typeMapSet content switch. A map value is always ONE tick, so an
  /// Any value is a length-one ContentAny; undefined belongs here too because
  /// yjs tests <c>value == null</c> with the loose operator (Locked Decision 8).
  /// </summary>
  private static YContent MapContent(object? value)
  {
    return value switch
    {
      null or bool or double or string or AnyObject or AnyArray or YUndefined =>
          new ContentAny([value]),
      byte[] bytes => new ContentBinary(bytes),
      YAbstractType type => new ContentType(type),
      _ => throw new ArgumentException(
          $"yjs: {value.GetType().Name} is not a value a map can hold.", nameof(value)),
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
