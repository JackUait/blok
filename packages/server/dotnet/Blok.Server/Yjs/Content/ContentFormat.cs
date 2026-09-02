namespace Blok.Server.Yjs;

/// <summary>
/// Ref 6: a Y.Text formatting mark — a key and a JSON value. It occupies one
/// clock tick but counts for nothing, so a text index skips it.
/// </summary>
internal sealed class ContentFormat(string key, string json) : YContent
{
  public override byte Ref => 6;

  public override int Length => 1;

  public override bool IsCountable => false;

  internal string Key { get; } = key;

  public override IReadOnlyList<object?> GetContent()
  {
    return [];
  }

  /// <summary>The wire's JSON, unparsed.</summary>
  internal string Json { get; } = json;

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarString(Key);
    writer.WriteVarString(Json);
  }
}
