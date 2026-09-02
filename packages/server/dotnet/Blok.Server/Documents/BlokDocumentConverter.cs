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
    return version ??= await runtime.InvokeAsync("version", "{}", cancellationToken);
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

  public ValueTask<string> ToHtmlAsync(string documentJson, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    return runtime.InvokeAsync("blocksToHtml", documentJson, cancellationToken);
  }

  public ValueTask<string> ToPlainTextAsync(string documentJson, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);

    return runtime.InvokeAsync("blocksToPlainText", documentJson, cancellationToken);
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
