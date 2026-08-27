using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Runtime;

namespace Blok.Server.Documents;

internal sealed class BlokDocumentConverter(IBlokRuntime runtime) : IBlokDocumentConverter
{
  private readonly IBlokRuntime runtime = runtime
      ?? throw new ArgumentNullException(nameof(runtime));

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

  public ValueTask<string> FromMarkdownAsync(string markdown, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(markdown);

    var input = JsonSerializer.Serialize(new MarkdownInput(markdown));

    return runtime.InvokeAsync("markdownToBlocks", input, cancellationToken);
  }

  private sealed record MarkdownInput(
      [property: JsonPropertyName("markdown")] string Markdown);
}
