using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Blok.Server.Runtime;

namespace Blok.Server.Documents;

internal sealed class BlokDocumentConverter(IBlokRuntime runtime) : IBlokDocumentConverter
{
  private readonly IBlokRuntime runtime = runtime
      ?? throw new ArgumentNullException(nameof(runtime));

  private string? version;

  // Constant for the life of the bundle, and read on every document write, so
  // it does not spend a pooled engine more than once.
  public async ValueTask<string> GetVersionAsync(CancellationToken cancellationToken = default)
  {
    if (version is not null)
    {
      return version;
    }

    var reported = await runtime.InvokeAsync("version", "{}", cancellationToken);

    /*
     * `dev` is what the bundle answers when it was built without the VERSION
     * define. Caching it would stamp it into every document this process
     * writes, and nothing downstream could tell it from a real version — so it
     * is never cached and never returned.
     */
    if (reported is "dev" or "")
    {
      throw new InvalidOperationException(
          "The embedded Blok runtime reports no version; it was built without the VERSION define.");
    }

    version = reported;

    return version;
  }

  public async ValueTask<BlokMarkdownConversion> ToMarkdownAsync(
      string documentJson,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    var output = await runtime.InvokeAsync("blocksToMarkdown", documentJson, cancellationToken);

    return JsonSerializer.Deserialize<BlokMarkdownConversion>(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no Markdown conversion.");
  }

  public async ValueTask<BlokMarkdownConversion> ToMarkdownAsync(
      string documentJson,
      IReadOnlyDictionary<string, BlokPageInfo?> pages,
      Func<string, string>? pageHref = null,
      CancellationToken cancellationToken = default)
  {
    var output = await runtime.InvokeAsync(
        "blocksToMarkdownWithPages",
        PagesRequest(documentJson, pages, pageHref),
        cancellationToken);

    return JsonSerializer.Deserialize<BlokMarkdownConversion>(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no Markdown conversion.");
  }

  private string? schema;

  // Constant for the life of the bundle, and large, so it is fetched once.
  public async ValueTask<string> GetSchemaAsync(CancellationToken cancellationToken = default)
  {
    return schema ??= await runtime.InvokeAsync("schema", "{}", cancellationToken);
  }

  public async ValueTask<IReadOnlyList<string>> ExtractTextsAsync(
      string documentJson,
      bool includeCode = false,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    var output = await runtime.InvokeAsync(
        "extractTexts",
        TextsRequest(documentJson, texts: null, includeCode),
        cancellationToken);

    return JsonSerializer.Deserialize<string[]>(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no texts.");
  }

  public async ValueTask<string> InjectTextsAsync(
      string documentJson,
      IReadOnlyList<string> texts,
      bool includeCode = false,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);
    ArgumentNullException.ThrowIfNull(texts);

    var output = await runtime.InvokeAsync(
        "injectTexts",
        TextsRequest(documentJson, texts, includeCode),
        cancellationToken);

    var result = JsonNode.Parse(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no document.");

    if (result["mismatch"] is JsonNode mismatch)
    {
      throw new ArgumentException(
          $"This document yields {mismatch["expected"]} translatable strings, but {mismatch["received"]} were given.",
          nameof(texts));
    }

    return result["document"]?.ToJsonString()
        ?? throw new InvalidOperationException("The Blok runtime returned no document.");
  }

  public async ValueTask<BlokPageIndex> GetPageIndexAsync(
      string documentJson,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    var output = await runtime.InvokeAsync(
        "pageIndex",
        new JsonObject { ["document"] = ParseDocument(documentJson) }.ToJsonString(),
        cancellationToken);

    return JsonSerializer.Deserialize<BlokPageIndex>(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no page index.");
  }

  public async ValueTask<string> RemapPageDocumentAsync(
      string documentJson,
      IReadOnlyDictionary<string, string> blockIds,
      IReadOnlyDictionary<string, string> pageIds,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);
    ArgumentNullException.ThrowIfNull(blockIds);
    ArgumentNullException.ThrowIfNull(pageIds);

    var request = new JsonObject
    {
      ["document"] = ParseDocument(documentJson),
      ["blockIds"] = IdMap(blockIds),
      ["pageIds"] = IdMap(pageIds),
    };
    var output = await runtime.InvokeAsync("remapPageDocument", request.ToJsonString(), cancellationToken);
    var result = JsonNode.Parse(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no document.");

    if (result["unmapped"] is JsonNode unmapped)
    {
      throw new ArgumentException(DescribeUnmapped(unmapped), nameof(blockIds));
    }

    return result["document"]?.ToJsonString()
        ?? throw new InvalidOperationException("The Blok runtime returned no document.");
  }

  private static JsonObject IdMap(IReadOnlyDictionary<string, string> ids)
  {
    var map = new JsonObject();

    foreach (var (oldId, newId) in ids)
    {
      map[oldId] = newId;
    }

    return map;
  }

  private static string DescribeUnmapped(JsonNode unmapped)
  {
    var problems = unmapped.Deserialize<UnmappedIds>()
        ?? throw new InvalidOperationException("The Blok runtime returned no id problems.");
    static string Quoted(IEnumerable<string> ids) => string.Join(", ", ids.Select(id => $"\"{id}\""));
    string[] parts =
    [
      problems.MissingBlockIds.Count > 0 ? $"No new id for {Quoted(problems.MissingBlockIds)}" : string.Empty,
      problems.DuplicateBlockIds.Count > 0 ? $"More than one block maps to {Quoted(problems.DuplicateBlockIds)}" : string.Empty,
      problems.IdlessBlocks > 0 ? $"{problems.IdlessBlocks} block(s) without an id" : string.Empty,
    ];

    return string.Join("; ", parts.Where(part => part.Length > 0)) + ".";
  }

  /// <summary>
  /// The translation operations carry options and a translation list beside the
  /// document, so the document is a field rather than the whole request.
  /// </summary>
  private static string TextsRequest(string documentJson, IReadOnlyList<string>? texts, bool includeCode)
  {
    var request = new JsonObject
    {
      ["document"] = ParseDocument(documentJson),
      ["includeCode"] = includeCode,
    };

    if (texts is not null)
    {
      request["texts"] = new JsonArray([.. texts.Select(text => JsonValue.Create(text))]);
    }

    return request.ToJsonString();
  }

  /// <summary>
  /// Plain text carries an option beside the document for the same reason, and
  /// the runtime reads either shape — the bare document every caller sent
  /// before the option existed, or this envelope.
  /// </summary>
  private static string PlainTextRequest(string documentJson, bool includeHiddenText)
  {
    return new JsonObject
    {
      ["document"] = ParseDocument(documentJson),
      ["includeHiddenText"] = includeHiddenText,
    }.ToJsonString();
  }

  /// <summary>
  /// The page-aware operations take <c>{document, pages}</c>, a different
  /// operation from the bare-document ones, so the shipped overloads never
  /// read page data. A <c>null</c> entry is written as JSON <c>null</c>: it
  /// means "missing", while a left-out id means "unresolved".
  /// </summary>
  private static string PagesRequest(
      string documentJson,
      IReadOnlyDictionary<string, BlokPageInfo?> pages,
      Func<string, string>? pageHref)
  {
    ArgumentNullException.ThrowIfNull(documentJson);
    ArgumentNullException.ThrowIfNull(pages);

    var entries = new JsonObject();

    foreach (var (pageId, info) in pages)
    {
      entries[pageId] = PageEntry(pageId, info, pageHref);
    }

    return new JsonObject
    {
      ["document"] = ParseDocument(documentJson),
      ["pages"] = entries,
    }.ToJsonString();
  }

  private static JsonObject? PageEntry(string pageId, BlokPageInfo? info, Func<string, string>? pageHref)
  {
    if (info is null)
    {
      return null;
    }

    // A denied page sends nothing else, and its link is never built.
    if (info.NoAccess)
    {
      return new JsonObject { ["access"] = "none" };
    }

    var entry = new JsonObject();

    if (info.Title is not null)
    {
      entry["title"] = info.Title;
    }

    if (info.Icon is not null)
    {
      entry["icon"] = info.Icon.IsImage
          ? new JsonObject { ["type"] = "image", ["url"] = info.Icon.Value }
          : new JsonObject { ["type"] = "emoji", ["value"] = info.Icon.Value };
    }

    var href = pageHref?.Invoke(pageId);

    if (!string.IsNullOrEmpty(href))
    {
      entry["href"] = href;
    }

    return entry;
  }

  /*
   * The envelope operations parse the document here rather than in the engine,
   * which would otherwise make ONE bad document report two different failures
   * depending on which reader was asked for it — a JSON exception from this
   * method, or a JavaScript one from the bundle's own `JSON.parse`.
   */
  private static JsonNode? ParseDocument(string documentJson)
  {
    try
    {
      return JsonNode.Parse(documentJson);
    }
    catch (JsonException exception)
    {
      throw new BlokDocumentConversionException(BlokConversionFailure.InvalidDocument, exception);
    }
  }

  public ValueTask<string> ToHtmlAsync(string documentJson, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    return runtime.InvokeAsync("blocksToHtml", documentJson, cancellationToken);
  }

  public ValueTask<string> ToHtmlAsync(
      string documentJson,
      IReadOnlyDictionary<string, BlokPageInfo?> pages,
      Func<string, string>? pageHref = null,
      CancellationToken cancellationToken = default)
  {
    return runtime.InvokeAsync(
        "blocksToHtmlWithPages",
        PagesRequest(documentJson, pages, pageHref),
        cancellationToken);
  }

  public ValueTask<string> ToPlainTextAsync(
      string documentJson,
      bool includeHiddenText = false,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    return runtime.InvokeAsync(
        "blocksToPlainText",
        PlainTextRequest(documentJson, includeHiddenText),
        cancellationToken);
  }

  public async ValueTask<BlokPlainTextConversion> ToPlainTextWithReportAsync(
      string documentJson,
      bool includeHiddenText = false,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    var output = await runtime.InvokeAsync(
        "blocksToPlainTextWithReport",
        PlainTextRequest(documentJson, includeHiddenText),
        cancellationToken);

    return JsonSerializer.Deserialize<BlokPlainTextConversion>(output)
        ?? throw new InvalidOperationException("The Blok runtime returned no plain-text conversion.");
  }

  /*
   * Two halves, and the split is the point. "Is this a document at all" is
   * answered from the JSON, which is why a host may put this in front of every
   * inbound payload without reserving an engine for the rubbish. Only something
   * already shaped like a document is worth asking the runtime about, because
   * only the runtime knows which block types have readers.
   */
  public async ValueTask<BlokDocumentValidation> ValidateAsync(
      string? documentJson,
      CancellationToken cancellationToken = default)
  {
    if (!BlokDocuments.LooksLikeADocument(documentJson))
    {
      return new BlokDocumentValidation { Failure = BlokConversionFailure.InvalidDocument };
    }

    try
    {
      var output = await runtime.InvokeAsync("inspect", documentJson!, cancellationToken);

      return (JsonSerializer.Deserialize<BlokDocumentValidation>(output)
          ?? new BlokDocumentValidation { Failure = BlokConversionFailure.Unknown })
          with
      { IsDocument = true };
    }
    /*
     * Cancellation stays cancellation here as everywhere else; everything the
     * runtime can raise becomes a Failure, because the promise this method
     * makes is that asking never throws.
     */
    catch (BlokDocumentConversionException exception)
    {
      return new BlokDocumentValidation { Failure = exception.Reason };
    }
    catch (JsonException)
    {
      return new BlokDocumentValidation { Failure = BlokConversionFailure.Unknown };
    }
  }

  public async ValueTask<BlokImportConversion> FromMarkdownAsync(
      string markdown,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(markdown);

    return await ImportAsync(
        "markdownToBlocks",
        JsonSerializer.Serialize(new MarkdownInput(markdown)),
        cancellationToken);
  }

  public async ValueTask<BlokImportConversion> FromHtmlAsync(
      string html,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(html);

    return await ImportAsync(
        "htmlToBlocks",
        JsonSerializer.Serialize(new HtmlInput(html)),
        cancellationToken);
  }

  /*
   * Both importers answer with the same envelope — the document plus the report
   * of what the source could not carry — so both read it the same way.
   */
  private async ValueTask<BlokImportConversion> ImportAsync(
      string operation,
      string input,
      CancellationToken cancellationToken)
  {
    var output = await runtime.InvokeAsync(operation, input, cancellationToken);

    var payload = JsonNode.Parse(output)?.AsObject()
        ?? throw new InvalidOperationException("The Blok runtime returned no document.");
    var warnings = payload["warnings"].Deserialize<List<BlokDegradation>>() ?? [];

    /*
     * The report rides alongside the document on the wire, but it is not part
     * of it — a caller storing the result must not persist the warnings.
     */
    payload.Remove("warnings");

    return new BlokImportConversion(payload.ToJsonString(), warnings);
  }

  private sealed record MarkdownInput(
      [property: JsonPropertyName("markdown")] string Markdown);

  private sealed record UnmappedIds(
      [property: JsonPropertyName("missingBlockIds")] IReadOnlyList<string> MissingBlockIds,
      [property: JsonPropertyName("duplicateBlockIds")] IReadOnlyList<string> DuplicateBlockIds,
      [property: JsonPropertyName("idlessBlocks")] int IdlessBlocks);

  private sealed record HtmlInput(
      [property: JsonPropertyName("html")] string Html);
}
