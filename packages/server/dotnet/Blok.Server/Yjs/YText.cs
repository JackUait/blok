namespace Blok.Server.Yjs;

/// <summary>
/// Read side of a Y.Text: the characters, with formatting marks and embeds
/// left out. The write API lands with the transaction.
/// </summary>
internal sealed class YText : YAbstractType
{
  public override string ToString()
  {
    return ConcatenateStrings(Start);
  }
}
