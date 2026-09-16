namespace Blok.Server.Documents;

/// <summary>Why a document conversion could not finish.</summary>
/// <remarks>
/// Carried as a property on <see cref="BlokDocumentConversionException"/> rather
/// than spelled into its message, so a caller explaining a failure to its own
/// users branches on a value instead of matching a string the next Blok release
/// may reword.
/// </remarks>
public enum BlokConversionFailure
{
  /// <summary>
  /// Anything the runtime could not place. A JavaScript error that is not a
  /// rejection of the input lands here — including the stack guard's, which is
  /// what an outline nested past the native stack produces.
  /// </summary>
  Unknown,

  /// <summary>
  /// The input was not a usable document: not JSON at all, or JSON with no
  /// <c>blocks</c> array. Individual malformed BLOCKS never reach this — they
  /// are skipped and reported, so one bad entry cannot cost a whole article.
  /// </summary>
  InvalidDocument,

  /// <summary>
  /// The conversion ran past the timeout it was created with. Raise the
  /// timeout, or convert a smaller document.
  /// </summary>
  TimedOut,

  /// <summary>
  /// The conversion ran past the allocation budget it was created with. The
  /// budget is allocation churn for ONE call, not resident memory, so the fix
  /// is to raise it rather than to add RAM.
  /// </summary>
  DocumentTooLarge,
}

/// <summary>
/// A document conversion failed inside the embedded JavaScript runtime.
/// </summary>
/// <remarks>
/// Blok's own so that a caller explaining the failure to its users never has to
/// reference the engine package or name its exception types. <see cref="Reason"/>
/// is the part to branch on; the engine's exception is kept as
/// <see cref="Exception.InnerException"/> for a log, not for a type test.
/// <para>
/// A caller's own cancellation is NOT reported through this: a cancelled
/// <see cref="CancellationToken"/> still surfaces as an
/// <see cref="OperationCanceledException"/>.
/// </para>
/// </remarks>
public sealed class BlokDocumentConversionException : Exception
{
  /// <inheritdoc/>
  public BlokDocumentConversionException()
      : base(Describe(BlokConversionFailure.Unknown))
  {
  }

  /// <inheritdoc/>
  public BlokDocumentConversionException(string message)
      : base(message)
  {
  }

  /// <inheritdoc/>
  public BlokDocumentConversionException(string message, Exception innerException)
      : base(message, innerException)
  {
  }

  /// <summary>The one this package throws: a reason, and what the engine raised.</summary>
  /// <param name="reason">What went wrong.</param>
  /// <param name="innerException">The engine's own exception.</param>
  public BlokDocumentConversionException(BlokConversionFailure reason, Exception innerException)
      : base(Describe(reason), innerException)
  {
    Reason = reason;
  }

  /// <summary>
  /// What went wrong, as a value to branch on. The three constructors that take
  /// a message leave it <see cref="BlokConversionFailure.Unknown"/>.
  /// </summary>
  public BlokConversionFailure Reason { get; }

  private static string Describe(BlokConversionFailure reason) => reason switch
  {
    BlokConversionFailure.InvalidDocument => "This is not a usable Blok document.",
    BlokConversionFailure.TimedOut => "Converting this document ran past the runtime's timeout.",
    BlokConversionFailure.DocumentTooLarge =>
        "Converting this document ran past the runtime's per-call allocation budget.",
    _ => "The Blok runtime could not convert this document.",
  };
}

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
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
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
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
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
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
  ValueTask<string> InjectTextsAsync(
      string documentJson,
      IReadOnlyList<string> texts,
      bool includeCode = false,
      CancellationToken cancellationToken = default);

  /// <summary>Converts a saved document to HTML.</summary>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
  ValueTask<string> ToHtmlAsync(string documentJson, CancellationToken cancellationToken = default);

  /// <summary>Extracts a saved document's readable text.</summary>
  /// <remarks>
  /// What the editor paints, which is not everything a document holds: an
  /// image's alt text, a video's or file's url, an embed's source, an audio
  /// title and artist, a bookmark's description are all attributes on screen
  /// rather than text in it. <paramref name="includeHiddenText"/> is for the one
  /// caller that wants them — a search index.
  /// </remarks>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="includeHiddenText">
  /// Also emit the media fields the reader otherwise drops, each on its own line
  /// after the block's displayed label: an <c>image</c> alt, a <c>video</c> url,
  /// an <c>embed</c> source, an <c>audio</c> title/artist/url, a <c>file</c>
  /// name and url, a <c>bookmark</c> description and url. Off by default — a
  /// preview wants what the editor paints.
  /// </param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
  ValueTask<string> ToPlainTextAsync(
      string documentJson,
      bool includeHiddenText = false,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Extracts a saved document's readable text AND reports every block the
  /// reader could make nothing of.
  /// </summary>
  /// <remarks>
  /// The reporting companion to <see cref="ToPlainTextAsync"/>, added because
  /// its bare <see cref="string"/> cannot say which of two very different
  /// documents produced an empty one: a document with no text, or a document of
  /// tools this build of Blok has never heard of. Markdown has reported the
  /// same list since it shipped.
  /// <para>
  /// A block type Blok knows but that carries no text by design — a divider, a
  /// spacer, a callout — is NOT reported. Only a type with no reader is, once
  /// per block, in document order, plus one collapsed entry naming how many
  /// entries of the <c>blocks</c> array were too malformed to read at all.
  /// </para>
  /// <para>
  /// Use <see cref="ToPlainTextAsync"/> when an empty string is an acceptable
  /// answer on its own — a preview, a snippet. Use this one when it is not — a
  /// search index deciding whether a document is worth storing, an importer
  /// deciding whether to warn.
  /// </para>
  /// </remarks>
  /// <param name="documentJson">A saved document: <c>{"blocks":[…]}</c>.</param>
  /// <param name="includeHiddenText">
  /// The same option <see cref="ToPlainTextAsync"/> takes, with the same
  /// meaning and the same default.
  /// </param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was. Ask <see cref="ValidateAsync"/> first to get that
  /// answer without an exception.
  /// </exception>
  ValueTask<BlokPlainTextConversion> ToPlainTextWithReportAsync(
      string documentJson,
      bool includeHiddenText = false,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Answers, without throwing, whether an input is a Blok document, whether it
  /// holds any text, and which of its blocks this build of Blok could not read.
  /// </summary>
  /// <remarks>
  /// The question every other method on this interface answers only by
  /// succeeding or by throwing. A host guarding stored content — "is this worth
  /// indexing", "did the editor save anything", "is this payload a document at
  /// all" — asks here instead of running a conversion and catching
  /// <see cref="BlokDocumentConversionException"/>.
  /// <para>
  /// Cheap in the case it is reached for most: input that is not a document is
  /// answered from the JSON alone, without spending an engine. Input that IS a
  /// document costs one walk of its blocks — no Markdown, no HTML, no engine
  /// pool wait beyond the walk.
  /// </para>
  /// <para>
  /// It does not throw for any input, <c>null</c> included; a guard that throws
  /// is not a guard. <see cref="BlokDocumentValidation.Failure"/> carries what
  /// an exception would have carried. The caller's own cancellation is the one
  /// exception, as everywhere else on this interface.
  /// </para>
  /// </remarks>
  /// <param name="documentJson">
  /// Anything at all: a saved document, a fragment, malformed JSON, or
  /// <c>null</c>.
  /// </param>
  /// <param name="cancellationToken">Cancels the inspection.</param>
  ValueTask<BlokDocumentValidation> ValidateAsync(
      string? documentJson,
      CancellationToken cancellationToken = default);

  /// <summary>
  /// Parses Markdown into a saved document, reporting what Markdown could not
  /// carry into it. GitHub Flavored Markdown and <c>$…$</c> math are both
  /// understood; Blok has no raw-HTML block, so markup written into the
  /// Markdown is escaped into literal text and reported.
  /// </summary>
  /// <param name="markdown">The Markdown source.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
  ValueTask<BlokImportConversion> FromMarkdownAsync(string markdown, CancellationToken cancellationToken = default);

  /// <summary>
  /// Parses HTML into a saved document, reporting what the HTML could not carry
  /// into it. The inverse of <see cref="ToHtmlAsync"/>.
  /// </summary>
  /// <remarks>
  /// Covers the structural subset a document body is made of: headings,
  /// paragraphs, lists (nested, ordered, checklists), tables (including merged
  /// cells), images, links and inline marks, code, blockquotes, toggles and
  /// dividers. Layout containers are unwrapped and their children converted in
  /// place. Everything else is reported: embedded media, form controls and
  /// unknown elements come back as a <see cref="BlokDegradation"/> naming the
  /// tag, so a caller storing the result can tell what did not survive. Read
  /// <see cref="BlokImportConversion.Warnings"/> — an import stored without
  /// reading it is how content goes missing quietly.
  /// </remarks>
  /// <param name="html">The HTML source: a fragment or a whole document.</param>
  /// <param name="cancellationToken">Cancels the conversion.</param>
  /// <exception cref="BlokDocumentConversionException">
  /// The conversion failed inside the runtime; <see cref="BlokDocumentConversionException.Reason"/>
  /// says whether the input was unusable, the timeout was reached, or the
  /// allocation budget was.
  /// </exception>
  ValueTask<BlokImportConversion> FromHtmlAsync(string html, CancellationToken cancellationToken = default);
}
