using System.Text.Json.Serialization;

namespace Blok.Server.Documents;

/// <summary>A document's Markdown, and everything that could not be carried across.</summary>
/// <param name="Markdown">The serialized document.</param>
/// <param name="Warnings">Constructs that were dropped or emitted lossily, in document order.</param>
public sealed record BlokMarkdownConversion(
    [property: JsonPropertyName("markdown")] string Markdown,
    [property: JsonPropertyName("warnings")] IReadOnlyList<BlokDegradation> Warnings);

/// <summary>A construct Markdown could not express as-is.</summary>
/// <param name="Block">The block tool that degraded, e.g. <c>callout</c>.</param>
/// <param name="Action">
/// <c>dropped</c> when nothing was emitted, <c>degraded</c> when something was
/// emitted but lossily. A string rather than an enum so a Blok release that
/// names a new outcome cannot fail deserialization in an app already deployed.
/// </param>
/// <param name="Detail">Plain-language explanation of what was lost.</param>
public sealed record BlokDegradation(
    [property: JsonPropertyName("block")] string Block,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("detail")] string Detail);
