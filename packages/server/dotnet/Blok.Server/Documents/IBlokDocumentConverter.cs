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

  /// <summary>
  /// The version the editor stamps into a saved document's <c>version</c>
  /// field. A caller writing documents outside the browser reads it from here
  /// so both sides agree on what a stored document says it is.
  /// </summary>
  /// <param name="cancellationToken">Cancels the lookup.</param>
  ValueTask<string> GetVersionAsync(CancellationToken cancellationToken = default);

  /// <summary>
  /// Blok's saved document format as JSON Schema (draft 2020-12), for a caller
  /// that has to constrain something else to it — a model's structured output,
  /// an importer, a validator.
  /// </summary>
  /// <remarks>
  /// A block belonging to a custom tool validates with an unconstrained
  /// <c>data</c> rather than being rejected: Blok is headless and its block set
  /// is not closed.
  /// </remarks>
  /// <param name="cancellationToken">Cancels the lookup.</param>
  ValueTask<string> GetSchemaAsync(CancellationToken cancellationToken = default);

  /// <summary>
  /// Every translatable string in a saved document, in document order.
  /// </summary>
  /// <remarks>
  /// Made for translating a document without handing a model its JSON:
  /// translate the returned list, then put it back with
  /// <see cref="InjectTextsAsync"/>. The model never sees the structure, so it
  /// cannot break it. Empty values are skipped, and a URL is never prose.
  /// </remarks>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="includeCode">Include a code block's source. Off by default — code is not prose.</param>
  /// <param name="cancellationToken">Cancels the extraction.</param>
  ValueTask<IReadOnlyList<string>> ExtractTextsAsync(
      string documentJson,
      bool includeCode = false,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Puts translated strings back where <see cref="ExtractTextsAsync"/> found
  /// them, returning the saved document to store.
  /// </summary>
  /// <remarks>
  /// A block too malformed to read is carried through untouched rather than
  /// dropped — the result of this call is what gets stored.
  /// </remarks>
  /// <param name="documentJson">The same document the strings were taken from.</param>
  /// <param name="texts">The translations, in the order they were extracted.</param>
  /// <param name="includeCode">The SAME value the extraction ran with.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  /// <exception cref="ArgumentException">
  /// <paramref name="texts"/> does not have one entry per string this document
  /// yields.
  /// </exception>
  ValueTask<string> InjectTextsAsync(
      string documentJson,
      IReadOnlyList<string> texts,
      bool includeCode = false,
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
  /// Parses Markdown into a saved document, reporting what Markdown could not
  /// carry into it. GitHub Flavored Markdown and <c>$…$</c> math are both
  /// understood; Blok has no raw-HTML block, so markup written into the
  /// Markdown is escaped into literal text and reported.
  /// </summary>
  /// <param name="markdown">The Markdown source.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  ValueTask<BlokImportConversion> FromMarkdownAsync(string markdown, CancellationToken cancellationToken = default);
}
