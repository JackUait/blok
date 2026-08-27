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

/// <summary>A construct a Markdown conversion could not carry across as-is.</summary>
/// <param name="Construct">
/// What degraded: a block tool name (<c>callout</c>) on the way out, a Markdown
/// construct (<c>html</c>) on the way in.
/// </param>
/// <param name="Action">
/// <c>dropped</c> when nothing was emitted, <c>degraded</c> when something was
/// emitted but lossily. A string rather than an enum so a Blok release that
/// names a new outcome cannot fail deserialization in an app already deployed.
/// </param>
/// <param name="Detail">Plain-language explanation of what was lost.</param>
public sealed record BlokDegradation(
    [property: JsonPropertyName("construct")] string Construct,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("detail")] string Detail);
