using System.Text.Json.Nodes;
using Blok.Server.Runtime;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>Reads HTML rich text fields as segments.</summary>
internal interface IRichTextHtmlReader
{
  /// <summary>Segments for each field, in the same order.</summary>
  ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
      IReadOnlyList<RichTextHtml> fields, CancellationToken cancellationToken = default);
}

/// <summary>
/// The client's own HTML reader (<c>htmlToSegmentsNode</c>), run in the
/// embedded runtime through its <c>htmlFieldsToSegments</c> op, one call per
/// batch. A C# parser would be a second reader that drifts from the client's.
/// </summary>
internal sealed class RuntimeRichTextHtmlReader(IBlokRuntime runtime) : IRichTextHtmlReader
{
  private readonly IBlokRuntime runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));

  public async ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
      IReadOnlyList<RichTextHtml> fields, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(fields);

    if (fields.Count == 0)
    {
      return [];
    }

    var request = new AnyArray();

    foreach (var field in fields)
    {
      var entry = new AnyObject();

      entry.Add("type", field.Type);
      entry.Add("field", field.Field);
      entry.Add("html", field.Html);
      request.Add(entry);
    }

    // JsJson on both sides: it carries a lone surrogate the way JS does,
    // where System.Text.Json refuses one.
    var answer = await runtime.InvokeAsync(
        "htmlFieldsToSegments", JsJson.Stringify(request), cancellationToken);

    if (JsJson.Parse(answer) is not AnyArray entries || entries.Count != fields.Count)
    {
      throw new InvalidDataException("collab: the runtime answered htmlFieldsToSegments with the wrong shape.");
    }

    return entries
        .Select(entry => entry is AnyObject answered &&
            answered.TryGet("segments", out var segments) &&
            segments is AnyArray array
          ? RichText.ToJson(array)
          : throw new InvalidDataException("collab: the runtime answered a field without segments."))
        .ToArray();
  }
}
