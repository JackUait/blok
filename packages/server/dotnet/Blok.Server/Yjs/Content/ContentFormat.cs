namespace Blok.Server.Yjs;

/// <summary>
/// Ref 6: a Y.Text formatting mark — a key and a JSON value. It occupies one
/// clock tick but counts for nothing, so a text index skips it.
/// </summary>
internal sealed class ContentFormat(string key, string json) : YContent
{
  private object? value;
  private bool parsed;

  public override byte Ref => 6;

  public override int Length => 1;

  public override bool IsCountable => false;

  internal string Key { get; } = key;

  /// <summary>The wire's JSON, unparsed.</summary>
  internal string Json { get; } = json;

  /// <summary>
  /// The value, parsed once per item. yjs compares marks with <c>===</c> in
  /// places, which for an object is identity: two items with equal objects
  /// are different there, and one item compared with itself is the same.
  /// </summary>
  internal object? Value
  {
    get
    {
      if (!parsed)
      {
        value = JsJson.Parse(Json);
        parsed = true;
      }

      return value;
    }
  }

  /// <summary>A mark this engine writes: it keeps the caller's own value, as yjs does.</summary>
  internal static ContentFormat Local(string key, object? value)
  {
    return new ContentFormat(key, JsJson.Stringify(value)) { value = value, parsed = true };
  }

  public override IReadOnlyList<object?> GetContent()
  {
    return [];
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarString(Key);
    writer.WriteVarString(Json);
  }
}
