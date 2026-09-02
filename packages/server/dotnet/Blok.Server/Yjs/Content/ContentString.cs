namespace Blok.Server.Yjs;

/// <summary>
/// Ref 4: Y.Text's characters. Length is UTF-16 code units, exactly what a
/// C# string indexes by, so an astral character is two ticks in both worlds
/// and no parallel index is needed.
/// </summary>
internal sealed class ContentString(string text) : YContent
{
  public override byte Ref => 4;

  public override int Length => Text.Length;

  public override bool IsCountable => true;

  internal string Text { get; } = text;

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarString(offset == 0 ? Text : Text[offset..]);
  }
}
