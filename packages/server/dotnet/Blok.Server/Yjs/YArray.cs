namespace Blok.Server.Yjs;

/// <summary>
/// A Y.Array: the list chain, keeping only countable undeleted items and
/// splatting each item's content, so one item holding three values is three
/// entries.
///
/// Prelim content is given at CONSTRUCTION; see <see cref="YMap"/> for why.
/// </summary>
internal sealed class YArray : YAbstractType
{
  private readonly List<object?> prelim;

  public YArray()
  {
    prelim = [];
  }

  /// <summary>The values this array inserts at 0 when the item holding it integrates.</summary>
  public YArray(IEnumerable<object?> values)
  {
    ArgumentNullException.ThrowIfNull(values);
    prelim = [.. values];
  }

  /// <summary>
  /// Walked rather than read off <see cref="YAbstractType.Length"/> so a read
  /// never depends on the counter integration maintains.
  /// </summary>
  public int Count => Enumerate().Count();

  public object? Get(int index)
  {
    if (index < 0)
    {
      return null;
    }

    var remaining = index;

    for (var item = Start; item is not null; item = item.Right)
    {
      if (item.Deleted || !item.Countable)
      {
        continue;
      }

      if (remaining < item.Length)
      {
        return item.Content.GetContent()[remaining];
      }

      remaining -= item.Length;
    }

    return null;
  }

  public IEnumerable<object?> Enumerate()
  {
    for (var item = Start; item is not null; item = item.Right)
    {
      if (item.Deleted || !item.Countable)
      {
        continue;
      }

      foreach (var value in item.Content.GetContent())
      {
        yield return value;
      }
    }
  }

  /// <summary>
  /// yjs's YArray.insert. Consecutive Any values share one item, so inserting
  /// three strings costs three clock ticks and one struct.
  /// </summary>
  public void Insert(YTransaction transaction, int index, IReadOnlyList<object?> values)
  {
    RequireAttached();
    ListInsertGenerics(transaction, index, values);
  }

  /// <summary>yjs's YArray.delete.</summary>
  public void Delete(YTransaction transaction, int index, int count)
  {
    RequireAttached();
    ListDelete(transaction, index, count);
  }

  internal override void IntegratePrelim(YTransaction transaction)
  {
    var values = prelim.ToArray();

    prelim.Clear();
    ListInsertGenerics(transaction, 0, values);
  }
}
