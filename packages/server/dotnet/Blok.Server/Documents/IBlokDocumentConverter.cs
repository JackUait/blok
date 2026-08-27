namespace Blok.Server.Documents;

/// <summary>
/// Converts saved Blok documents using Blok's own JavaScript implementation,
/// embedded in this package and run in-process.
/// </summary>
/// <remarks>
/// The point of running the real implementation rather than a port is that a
/// port has to be taught every block tool Blok gains, and silently drops the
/// ones nobody remembered. Obtain an instance from
/// <see cref="BlokDocuments.Create"/>, or from dependency injection when the
/// ASP.NET Core package registered one. Instances are thread-safe and pool
/// their engines, so register one for the lifetime of the process rather than
/// creating them per request.
/// </remarks>
public interface IBlokDocumentConverter
{
  /// <summary>
  /// Converts a saved document to Markdown, reporting whatever could not be
  /// carried across.
  /// </summary>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  ValueTask<BlokMarkdownConversion> ToMarkdownAsync(
      string documentJson,
      CancellationToken cancellationToken = default);

  /// <summary>Converts a saved document to HTML.</summary>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  ValueTask<string> ToHtmlAsync(string documentJson, CancellationToken cancellationToken = default);

  /// <summary>Extracts a saved document's readable text.</summary>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  ValueTask<string> ToPlainTextAsync(string documentJson, CancellationToken cancellationToken = default);

  /// <summary>
  /// Parses Markdown into a saved document: <c>{"blocks":[…]}</c>. GitHub
  /// Flavored Markdown and <c>$…$</c> math are both understood.
  /// </summary>
  /// <param name="markdown">The Markdown source.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  ValueTask<string> FromMarkdownAsync(string markdown, CancellationToken cancellationToken = default);
}
