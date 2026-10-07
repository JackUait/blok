namespace Blok.Server.Yjs;

/// <summary>A Y.Text; all of its behaviour lives in <see cref="YTextBase"/>.</summary>
internal sealed class YText : YTextBase
{
  public YText()
      : base(null)
  {
  }

  public YText(string text)
      : base(text)
  {
  }
}
