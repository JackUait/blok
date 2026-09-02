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

  internal string Text { get; private set; } = text;

  public override IReadOnlyList<object?> GetContent()
  {
    // yjs splits the string per UTF-16 code unit, so an astral character reads
    // back as its two halves and the indexes stay clock indexes.
    return Text.Select(unit => (object?)unit.ToString()).ToArray();
  }

  public override YContent Splice(int offset)
  {
    var right = new ContentString(Text[offset..]);

    Text = Text[..offset];

    // Splitting a surrogate pair would make both halves unencodable, so each
    // half keeps its code-unit count and loses the character instead.
    if (offset > 0 && char.IsHighSurrogate(Text[offset - 1]))
    {
      Text = string.Concat(Text.AsSpan(0, offset - 1), "\uFFFD");
      right.Text = string.Concat("\uFFFD", right.Text.AsSpan(Math.Min(1, right.Text.Length)));
    }

    return right;
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarString(offset == 0 ? Text : Text[offset..]);
  }
}
