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
  /// <summary>
  /// HTML characters one runtime call may carry. Each call runs under the
  /// runtime's wall-clock timeout (10 s by default) and its cost grows with
  /// the HTML: about 60 KB took 0.6-0.9 s of CPU and up to 2.4 s of wall on a
  /// loaded host, while 700 KB in one call ran past the timeout. A field is
  /// never split, so a larger one goes in a call of its own.
  /// </summary>
  internal const int MaxCallChars = 64 * 1024;

  private readonly IBlokRuntime runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));

  public async ValueTask<IReadOnlyList<JsonArray>> ReadAsync(
      IReadOnlyList<RichTextHtml> fields, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(fields);

    var read = new List<JsonArray>(fields.Count);
    var start = 0;

    while (start < fields.Count)
    {
      var end = start + 1;
      var chars = fields[start].Html.Length;

      while (end < fields.Count && chars + fields[end].Html.Length <= MaxCallChars)
      {
        chars += fields[end].Html.Length;
        end++;
      }

      read.AddRange(await ReadCallAsync(fields, start, end, cancellationToken));
      start = end;
    }

    return read;
  }

  private async ValueTask<IEnumerable<JsonArray>> ReadCallAsync(
      IReadOnlyList<RichTextHtml> fields, int start, int end, CancellationToken cancellationToken)
  {
    var request = new AnyArray();

    for (var index = start; index < end; index++)
    {
      var entry = new AnyObject();

      entry.Add("type", fields[index].Type);
      entry.Add("field", fields[index].Field);
      entry.Add("html", fields[index].Html);
      request.Add(entry);
    }

    // JsJson on both sides: it carries a lone surrogate the way JS does,
    // where System.Text.Json refuses one.
    var answer = await runtime.InvokeAsync(
        "htmlFieldsToSegments", JsJson.Stringify(request), cancellationToken);

    if (JsJson.Parse(answer) is not AnyArray entries || entries.Count != end - start)
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
