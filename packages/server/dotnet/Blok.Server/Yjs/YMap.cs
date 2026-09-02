namespace Blok.Server.Yjs;

/// <summary>
/// Read side of a Y.Map. A key's value is the LAST element of its head item's
/// content, not the first: a multi-element content under one key means the
/// newest write is at its end.
/// </summary>
internal sealed class YMap : YAbstractType
{
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
}
