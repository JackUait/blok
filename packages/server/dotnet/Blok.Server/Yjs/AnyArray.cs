using System.Collections;

namespace Blok.Server.Yjs;

/// <summary>lib0 Any tag 117: a plain JavaScript array.</summary>
internal sealed class AnyArray : IReadOnlyList<object?>
{
  private readonly List<object?> items = [];

  public int Count => items.Count;

  public object? this[int index] => items[index];

  public void Add(object? value)
  {
    items.Add(value);
  }

  public IEnumerator<object?> GetEnumerator()
  {
    return items.GetEnumerator();
  }

  IEnumerator IEnumerable.GetEnumerator()
  {
    return GetEnumerator();
  }
}
