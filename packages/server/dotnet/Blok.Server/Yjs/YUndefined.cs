namespace Blok.Server.Yjs;

/// <summary>lib0 Any tag 127: JavaScript <c>undefined</c>, distinct from null.</summary>
internal sealed class YUndefined
{
  public static readonly YUndefined Instance = new();

  private YUndefined()
  {
  }

  public override string ToString()
  {
    return "undefined";
  }
}
