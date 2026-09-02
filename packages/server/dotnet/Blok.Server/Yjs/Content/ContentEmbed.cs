using System.Text.Json.Nodes;

namespace Blok.Server.Yjs;

/// <summary>
/// Ref 5: one embedded value inside a Y.Text, written as a JSON varstring.
/// The raw string is kept for re-encoding; see <see cref="ContentJson"/>.
/// </summary>
internal sealed class ContentEmbed(string json) : YContent
{
  public override byte Ref => 5;

  public override int Length => 1;

  public override bool IsCountable => true;

  /// <summary>The wire's JSON, unparsed.</summary>
  internal string Json { get; } = json;

  public override IReadOnlyList<object?> GetContent()
  {
    return [JsonNode.Parse(Json)];
  }

  public override void Write(Lib0Writer writer, int offset)
  {
    writer.WriteVarString(Json);
  }
}
