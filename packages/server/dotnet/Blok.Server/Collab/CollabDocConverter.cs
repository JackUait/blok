using System.Text.Json.Nodes;
using Blok.Server.Documents;
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
  /// <summary>
  /// Each seed and migration read call's budget. Both run once per lineage,
  /// and one rich field of about 700 KB ran past the runtime's 10 s default on
  /// a loaded host, which would keep that document from ever opening.
  /// </summary>
  internal static readonly TimeSpan MigrationReadTimeout = TimeSpan.FromSeconds(60);

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

    var found = YDocConverter.CollectSeedHtml(blocks, fields);
    var input = RichTextInput.Converting(fields, await Read(found, cancellationToken, MigrationReadTimeout));

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
    catch (Exception error) when (IsTransient(error, cancellationToken) && !IsTooLarge(error))
    {
      // Nothing is written yet. The room answers this one request with a
      // retry, and keeps every member. Out of allocation budget is not
      // retryable here: the budget is per call, so the same body fails again.
      throw new CollabTransientException(
          $"collab: reading the rich text HTML in this edit ran past the runtime's limits: {error.Message}", error);
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

  public async ValueTask<int> MigrateRichTextAsync(YDoc doc, CancellationToken cancellationToken = default)
  {
    var found = YDocConverter.CollectLegacyRichText(doc, fields);
    var input = RichTextInput.Converting(fields, await Read(found, cancellationToken, MigrationReadTimeout));

    return YDocConverter.MigrateRichText(doc, input);
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
      catch (Exception error) when (IsTransient(error, cancellationToken))
      {
        // The room gives up on a projection it can never build; this one a
        // retry may build, so it must not look like that. Anything else (a
        // JavaScript error, a malformed answer) repeats on every attempt and
        // keeps the refusal path, or a journal room would retry forever.
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

  /// <summary>
  /// The runtime's own limits (JintBlokRuntime classifies them) and a wait
  /// for a pooled engine that someone other than the caller cancelled.
  /// </summary>
  private static bool IsTransient(Exception error, CancellationToken cancellationToken)
  {
    return error switch
    {
      BlokDocumentConversionException conversion =>
          conversion.Reason is BlokConversionFailure.TimedOut or BlokConversionFailure.DocumentTooLarge,
      OperationCanceledException => !cancellationToken.IsCancellationRequested,
      _ => false,
    };
  }

  internal static bool IsTooLarge(Exception? error)
  {
    return error is BlokDocumentConversionException { Reason: BlokConversionFailure.DocumentTooLarge };
  }

  private async ValueTask<RichTextInput> Converting(
      IReadOnlyList<RichTextHtml> found, CancellationToken cancellationToken)
  {
    return RichTextInput.Converting(fields, await Read(found, cancellationToken));
  }

  /// <summary>Segments by HTML string; each distinct string is read once.</summary>
  private async ValueTask<Dictionary<string, JsonArray>> Read(
      IReadOnlyList<RichTextHtml> found, CancellationToken cancellationToken, TimeSpan? timeout = null)
  {
    // An empty string is an empty text; it needs no runtime.
    var distinct = found
        .Where(field => field.Html.Length > 0)
        .DistinctBy(field => field.Html, StringComparer.Ordinal)
        .ToList();
    var segments = distinct.Count == 0 ? [] : await html.ReadAsync(distinct, timeout, cancellationToken);
    var read = new Dictionary<string, JsonArray>(StringComparer.Ordinal) { [""] = [] };

    for (var index = 0; index < distinct.Count; index++)
    {
      read[distinct[index].Html] = segments[index];
    }

    return read;
  }
}
