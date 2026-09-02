using System.Collections;

namespace Blok.Server.Yjs;

/// <summary>
/// lib0 Any tag 118: a plain JavaScript object. Insertion-ordered, because
/// the wire writes Object.keys order and a decode -> re-encode must reproduce
/// it byte for byte. A repeated key overwrites in place, as JS assignment
/// does, so the first position wins.
/// </summary>
internal sealed class AnyObject : IReadOnlyList<KeyValuePair<string, object?>>
{
  private readonly List<KeyValuePair<string, object?>> entries = [];
  private readonly Dictionary<string, int> positions = new(StringComparer.Ordinal);

  public int Count => entries.Count;

  public KeyValuePair<string, object?> this[int index] => entries[index];

  public void Add(string key, object? value)
  {
    ArgumentNullException.ThrowIfNull(key);

    if (positions.TryGetValue(key, out var position))
    {
      entries[position] = new KeyValuePair<string, object?>(key, value);

      return;
    }

    positions[key] = entries.Count;
    entries.Add(new KeyValuePair<string, object?>(key, value));
  }

  public bool TryGet(string key, out object? value)
  {
    if (positions.TryGetValue(key, out var position))
    {
      value = entries[position].Value;

      return true;
    }

    value = null;

    return false;
  }

  public IEnumerator<KeyValuePair<string, object?>> GetEnumerator()
  {
    return entries.GetEnumerator();
  }

  IEnumerator IEnumerable.GetEnumerator()
  {
    return GetEnumerator();
  }
}
