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

    /**
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

  /**
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

  public async ValueTask<BlokImportConversion> FromMarkdownAsync(
      string markdown,
      CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(markdown);

    var input = JsonSerializer.Serialize(new MarkdownInput(markdown));
    var output = await runtime.InvokeAsync("markdownToBlocks", input, cancellationToken);

    var payload = JsonNode.Parse(output)?.AsObject()
        ?? throw new InvalidOperationException("The Blok runtime returned no document.");
    var warnings = payload["warnings"].Deserialize<List<BlokDegradation>>() ?? [];

    /**
     * The report rides alongside the document on the wire, but it is not part
     * of it — a caller storing the result must not persist the warnings.
     */
    payload.Remove("warnings");

    return new BlokImportConversion(payload.ToJsonString(), warnings);
  }

  private sealed record MarkdownInput(
      [property: JsonPropertyName("markdown")] string Markdown);
}
