using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>
/// Binds <see cref="YDocConverter"/> (the lockstep block ⇄ Doc laws) to the
/// room's <see cref="ICollabDocConverter"/>: unwraps the OutputData object
/// on the way in and rebuilds one (time + blocks) on the way out, and reads
/// the HTML in rich text fields through <paramref name="html"/> — the one
/// thing the synchronous converter cannot do itself.
/// </summary>
internal sealed class CollabDocConverter(
    TimeProvider timeProvider,
    IRichTextHtmlReader html,
    RichTextFields? fields = null,
    Action<string>? log = null) : ICollabDocConverter
{
  private readonly RichTextFields fields = fields ?? RichTextFields.BuiltIn;

  public async ValueTask SeedAsync(
      YDoc doc, JsonNode outputData, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(outputData);

    if (outputData is not JsonObject document)
    {
      throw new InvalidDataException("collab: the document is not a JSON object.");
    }

    if (document["blocks"] is not JsonArray blocks)
    {
      throw new InvalidDataException("collab: the document has no blocks array.");
    }

    var input = await Converting(YDocConverter.CollectSeedHtml(blocks, fields), cancellationToken);

    YDocConverter.Seed(doc, blocks, input);
  }

  public async ValueTask ApplyOpsAsync(
      YDoc doc, IReadOnlyList<CollabEditOp> ops, CancellationToken cancellationToken = default)
  {
    // Collecting plans the whole request, so a refusal is thrown before any
    // HTML is read. The doc cannot move during the await: the room's lane
    // is held across it.
    var input = await Converting(YDocConverter.CollectOpsHtml(doc, ops, fields), cancellationToken);

    YDocConverter.ApplyOps(doc, ops, input);
  }

  public async ValueTask<JsonNode> ExportAsync(YDoc doc, CancellationToken cancellationToken = default)
  {
    var time = timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var blocks = YDocConverter.Export(doc, fields, log, out var slots);

    if (slots.Count > 0)
    {
      var read = await Read(slots.Select(slot => slot.Html).ToList(), cancellationToken);

      foreach (var slot in slots)
      {
        slot.Target[slot.Key] = read[slot.Html.Html].DeepClone();
      }
    }

    return new JsonObject
    {
      ["time"] = time,
      ["blocks"] = blocks,
    };
  }

  private async ValueTask<RichTextInput> Converting(
      IReadOnlyList<RichTextHtml> found, CancellationToken cancellationToken)
  {
    return RichTextInput.Converting(fields, await Read(found, cancellationToken));
  }

  /// <summary>Segments by HTML string; each distinct string is read once.</summary>
  private async ValueTask<Dictionary<string, JsonArray>> Read(
      IReadOnlyList<RichTextHtml> found, CancellationToken cancellationToken)
  {
    // An empty string is an empty text; it needs no runtime.
    var distinct = found
        .Where(field => field.Html.Length > 0)
        .DistinctBy(field => field.Html, StringComparer.Ordinal)
        .ToList();
    var segments = await html.ReadAsync(distinct, cancellationToken);
    var read = new Dictionary<string, JsonArray>(StringComparer.Ordinal) { [""] = [] };

    for (var index = 0; index < distinct.Count; index++)
    {
      read[distinct[index].Html] = segments[index];
    }

    return read;
  }
}
