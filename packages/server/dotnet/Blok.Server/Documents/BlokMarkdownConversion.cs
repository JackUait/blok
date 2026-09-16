using System.Text.Json.Serialization;

namespace Blok.Server.Documents;

/// <summary>A document's Markdown, and everything that could not be carried across.</summary>
/// <param name="Markdown">The serialized document.</param>
/// <param name="Warnings">Constructs that were dropped or emitted lossily, in document order.</param>
public sealed record BlokMarkdownConversion(
    [property: JsonPropertyName("markdown")] string Markdown,
    [property: JsonPropertyName("warnings")] IReadOnlyList<BlokDegradation> Warnings);

/// <summary>A document's readable text, and everything the reader could not read.</summary>
/// <remarks>
/// The companion to <see cref="BlokMarkdownConversion"/> for the plain-text
/// path. <see cref="Text"/> is character-for-character what
/// <see cref="IBlokDocumentConverter.ToPlainTextAsync"/> returns for the same
/// input; only <see cref="Warnings"/> is new.
/// </remarks>
/// <param name="Text">The extracted text.</param>
/// <param name="Warnings">Blocks that were read as nothing, in document order.</param>
public sealed record BlokPlainTextConversion(
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("warnings")] IReadOnlyList<BlokDegradation> Warnings);

/// <summary>A parsed document, and everything its source could not carry into it.</summary>
/// <param name="DocumentJson">The saved document: <c>{"blocks":[…]}</c>.</param>
/// <param name="Warnings">Constructs that arrived degraded, in document order.</param>
public sealed record BlokImportConversion(
    string DocumentJson,
    IReadOnlyList<BlokDegradation> Warnings);

/// <summary>The outcomes <see cref="BlokDegradation.Action"/> is known to name.</summary>
/// <remarks>
/// Constants rather than an enum because the field stays an open string: a Blok
/// release that names a new outcome must not fail deserialization in an app
/// already deployed. Compare against these instead of writing the literals, and
/// treat an <see cref="BlokDegradation.Action"/> matching neither as something
/// happened that this version of the package does not know about.
/// </remarks>
public static class BlokDegradationActions
{
  /// <summary>Nothing was emitted for the construct.</summary>
  public const string Dropped = "dropped";

  /// <summary>Something was emitted, but lossily.</summary>
  public const string Degraded = "degraded";
}

/// <summary>A construct a conversion could not carry across as-is.</summary>
/// <param name="Construct">
/// What degraded: a block tool name (<c>callout</c>) on the way out, a source
/// construct on the way in — a Markdown node (<c>html</c>) or an HTML tag
/// (<c>iframe</c>).
/// </param>
/// <param name="Action">
/// <see cref="BlokDegradationActions.Dropped"/> when nothing was emitted,
/// <see cref="BlokDegradationActions.Degraded"/> when something was emitted but
/// lossily. A string rather than an enum so a Blok release that names a new
/// outcome cannot fail deserialization in an app already deployed.
/// </param>
/// <param name="Detail">Plain-language explanation of what was lost.</param>
public sealed record BlokDegradation(
    [property: JsonPropertyName("construct")] string Construct,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("detail")] string Detail);
