using System.Text.Json.Serialization;

namespace Blok.Server.Documents;

/// <summary>A document's Markdown, and everything that could not be carried across.</summary>
/// <param name="Markdown">The serialized document.</param>
/// <param name="Warnings">Constructs that were dropped or emitted lossily, in document order.</param>
public sealed record BlokMarkdownConversion(
    [property: JsonPropertyName("markdown")] string Markdown,
    [property: JsonPropertyName("warnings")] IReadOnlyList<BlokDegradation> Warnings);

/// <summary>A parsed Markdown document, and everything Markdown could not carry into it.</summary>
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

/// <summary>A construct a Markdown conversion could not carry across as-is.</summary>
/// <param name="Construct">
/// What degraded: a block tool name (<c>callout</c>) on the way out, a Markdown
/// construct (<c>html</c>) on the way in.
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
