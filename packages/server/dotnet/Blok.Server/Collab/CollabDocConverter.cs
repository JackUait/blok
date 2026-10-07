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
    // HTML is read. ApplyOps plans again after the await, against the doc as
    // it is then: a doc that moved in between can only cause a refusal.
    var found = YDocConverter.CollectOpsHtml(doc, ops, fields);
    RichTextInput input;

    try
    {
      input = await Converting(found, cancellationToken);
    }
    catch (Exception error) when (
        error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
    {
      // Nothing is written yet, so this is a refusal of this one request. Any
      // other exception from here is read by the room as a half-written
      // commit, and that closes the room for every member.
      throw new CollabEditException(
          $"collab: the rich text HTML in this edit could not be read: {error.Message}", error);
    }

    YDocConverter.ApplyOps(doc, ops, input);
  }

  public async ValueTask<JsonNode> ExportAsync(YDoc doc, CancellationToken cancellationToken = default)
  {
    var time = timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
    var blocks = YDocConverter.Export(doc, fields, log, out var slots);

    if (slots.Count > 0)
    {
      Dictionary<string, JsonArray> read;

      try
      {
        read = await Read(slots.Select(slot => slot.Html).ToList(), cancellationToken);
      }
      catch (Exception error) when (
          error is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
      {
        // The room gives up on a projection it can never build; this one a
        // retry may build, so it must not look like that.
        throw new CollabTransientException(
            $"collab: the rich text HTML in this document could not be read: {error.Message}", error);
      }

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
