namespace Blok.Server.Yjs;

/// <summary>
/// A Y.Map. A key's value is the LAST element of its head item's content, not
/// the first: a multi-element content under one key means the newest write is
/// at its end.
///
/// Prelim content is given at CONSTRUCTION rather than through Set on a
/// detached instance as yjs allows: the write API takes the transaction the
/// write belongs to, and a type with no document has none.
/// </summary>
internal sealed class YMap : YAbstractType
{
  private readonly List<KeyValuePair<string, object?>> prelim = [];

  public YMap()
  {
  }

  /// <summary>
  /// The entries this map writes when the item holding it integrates, in the
  /// order given: that order is the order of the child clocks, and therefore
  /// of the bytes. A repeated key overwrites in place, as a JS Map does.
  /// </summary>
  public YMap(IEnumerable<KeyValuePair<string, object?>> entries)
  {
    ArgumentNullException.ThrowIfNull(entries);

    foreach (var entry in entries)
    {
      var position = prelim.FindIndex(
          known => string.Equals(known.Key, entry.Key, StringComparison.Ordinal));

      if (position >= 0)
      {
        prelim[position] = entry;
      }
      else
      {
        prelim.Add(entry);
      }
    }
  }

  public IEnumerable<string> Keys =>
      Map.Where(entry => !entry.Value.Deleted).Select(entry => entry.Key);

  public int Count => Map.Count(entry => !entry.Value.Deleted);

  public bool TryGet(string key, out object? value)
  {
    if (!Map.TryGetValue(key, out var head) || head.Deleted)
    {
      value = null;

      return false;
    }

    value = head.Content.GetContent()[head.Length - 1];

    return true;
  }

  /// <summary>yjs's YMap.set: the key's previous value dies as this one lands.</summary>
  public void Set(YTransaction transaction, string key, object? value)
  {
    RequireAttached();
    MapSet(transaction, key, value);
  }

  /// <summary>yjs's YMap.delete.</summary>
  public void Remove(YTransaction transaction, string key)
  {
    RequireAttached();
    MapDelete(transaction, key);
  }

  /// <summary>yjs's YMap.clear: every live key, deleted in this transaction.</summary>
  public void Clear(YTransaction transaction)
  {
    RequireAttached();

    // Deleting marks the head rather than touching the dictionary, so the
    // keys can be walked while they are being deleted.
    foreach (var key in Keys.ToArray())
    {
      MapDelete(transaction, key);
    }
  }

  internal override void IntegratePrelim(YTransaction transaction)
  {
    var entries = prelim.ToArray();

    prelim.Clear();

    foreach (var (key, value) in entries)
    {
      MapSet(transaction, key, value);
    }
  }
}
