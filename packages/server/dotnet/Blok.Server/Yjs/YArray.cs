namespace Blok.Server.Yjs;

/// <summary>
/// Read side of a Y.Array: the list chain, keeping only countable undeleted
/// items and splatting each item's content, so one item holding three values
/// is three entries.
/// </summary>
internal sealed class YArray : YAbstractType
{
  /// <summary>
  /// Walked rather than read off <see cref="YAbstractType.Length"/>: nothing
  /// maintains that counter until integration lands.
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
}
