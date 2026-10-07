using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Yjs;

namespace Blok.Server.Tests.Collab;

/// <summary>
/// The real HTML reader — the embedded runtime's <c>htmlFieldsToSegments</c>
/// — for tests that hand the converter HTML. One runtime per test process:
/// loading the bundle costs about a second. A hand-written fake would guess
/// what the client's parser answers.
/// </summary>
internal static class RichTextRuntime
{
  private static readonly Lazy<RuntimeRichTextHtmlReader> Shared = new(
      () => new RuntimeRichTextHtmlReader(JintBlokRuntime.FromEmbeddedResource(poolSize: 2)));

  internal static IRichTextHtmlReader Reader => Shared.Value;

  /// <summary><see cref="YDocConverter.Seed(YDoc, JsonArray)"/> with the HTML read first.</summary>
  internal static void Seed(YDoc doc, JsonArray blocks)
  {
    YDocConverter.Seed(
        doc,
        blocks,
        Converting(YDocConverter.CollectSeedHtml(blocks, RichTextFields.BuiltIn)));
  }

  /// <summary><see cref="YDocConverter.ApplyOps(YDoc, IReadOnlyList{CollabEditOp})"/> with the HTML read first.</summary>
  internal static void ApplyOps(YDoc doc, IReadOnlyList<CollabEditOp> ops)
  {
    YDocConverter.ApplyOps(
        doc,
        ops,
        Converting(YDocConverter.CollectOpsHtml(doc, ops, RichTextFields.BuiltIn)));
  }

  /// <summary>The export the room PUTs: legacy HTML slots read to segments.</summary>
  internal static JsonArray Export(YDoc doc, Action<string>? warn = null)
  {
    return (JsonArray)new CollabDocConverter(TimeProvider.System, Reader, log: warn)
        .ExportAsync(doc).AsTask().GetAwaiter().GetResult()["blocks"]!;
  }

  /// <summary>Segments for one HTML string, read by the client's parser.</summary>
  internal static JsonArray Segments(string html)
  {
    return Reader.ReadAsync([new RichTextHtml("paragraph", "text", html)])
        .AsTask().GetAwaiter().GetResult()[0];
  }

  /// <summary>
  /// A format-1 expectation as the export now writes it: every HTML string in
  /// a built-in rich field — top level, or in a database-row's nested
  /// documents — read to segments by the client's reader. Arrays stay.
  /// </summary>
  internal static JsonNode WithSegments(JsonNode blocks)
  {
    var copy = blocks.DeepClone();

    ReadHtmlFields(copy.AsArray());

    return copy;
  }

  private static void ReadHtmlFields(JsonArray blocks)
  {
    foreach (var block in blocks)
    {
      if (block is not JsonObject entry ||
          entry["type"] is not JsonValue typeNode ||
          typeNode.GetValueKind() != System.Text.Json.JsonValueKind.String ||
          entry["data"] is not JsonObject data)
      {
        continue;
      }

      var type = typeNode.GetValue<string>();

      foreach (var key in data.Select(field => field.Key).ToArray())
      {
        if (RichTextFields.BuiltIn.IsRich(type, key) &&
            data[key] is JsonValue html &&
            html.GetValueKind() == System.Text.Json.JsonValueKind.String)
        {
          data[key] = Segments(html.GetValue<string>());
        }
      }

      if (type == "database-row" && data["properties"] is JsonObject properties)
      {
        foreach (var (_, property) in properties)
        {
          if (property is JsonObject document && document["blocks"] is JsonArray nested)
          {
            ReadHtmlFields(nested);
          }
        }
      }
    }
  }

  private static RichTextInput Converting(IReadOnlyList<RichTextHtml> found)
  {
    var segments = Reader.ReadAsync(found).AsTask().GetAwaiter().GetResult();
    var table = new Dictionary<string, JsonArray>(StringComparer.Ordinal);

    for (var index = 0; index < found.Count; index++)
    {
      table[found[index].Html] = segments[index];
    }

    return RichTextInput.Converting(RichTextFields.BuiltIn, table);
  }
}
