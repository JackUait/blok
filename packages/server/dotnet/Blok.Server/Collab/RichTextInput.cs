using System.Text.Json.Nodes;
using Blok.Server.Yjs;

namespace Blok.Server.Collab;

/// <summary>One rich field holding HTML, as the <c>htmlFieldsToSegments</c> runtime op takes it.</summary>
internal sealed record RichTextHtml(string Type, string Field, string Html);

/// <summary>
/// An exported rich field that still holds HTML (a legacy plain text or
/// string). <see cref="YDocConverter.Export(YDoc, RichTextFields, Action{string}?, out IReadOnlyList{RichTextHtmlSlot})"/>
/// leaves the HTML in <c>Target[Key]</c>; the caller converts it and writes
/// the segments there.
/// </summary>
internal sealed record RichTextHtmlSlot(JsonObject Target, string Key, RichTextHtml Html);

/// <summary>
/// What the seed and edit paths do with a rich field. HTML needs the async
/// runtime, which the converter never calls, so the caller runs the same walk
/// twice: once <see cref="Collecting"/> to learn the HTML, then
/// <see cref="Converting"/> with the answers. A string left unanswered is
/// refused, so a path that skipped the conversion fails loudly instead of
/// storing HTML as text.
/// </summary>
internal sealed class RichTextInput
{
  private readonly IReadOnlyDictionary<string, JsonArray>? converted;
  private readonly List<RichTextHtml>? found;
  private readonly HashSet<string>? seen;

  private RichTextInput(
      RichTextFields fields,
      IReadOnlyDictionary<string, JsonArray>? converted,
      bool collect)
  {
    Fields = fields;
    this.converted = converted;

    if (collect)
    {
      found = [];
      seen = new HashSet<string>(StringComparer.Ordinal);
    }
  }

  internal RichTextFields Fields { get; }

  /// <summary>The HTML met so far, each string once, in the order met.</summary>
  internal IReadOnlyList<RichTextHtml> Found => found ?? [];

  internal static RichTextInput Refusing(RichTextFields fields)
  {
    return new RichTextInput(fields, null, collect: false);
  }

  internal static RichTextInput Collecting(RichTextFields fields)
  {
    return new RichTextInput(fields, null, collect: true);
  }

  /// <param name="fields">The rich (type, key) pairs.</param>
  /// <param name="converted">Segments by the exact HTML string they were read from.</param>
  internal static RichTextInput Converting(
      RichTextFields fields, IReadOnlyDictionary<string, JsonArray> converted)
  {
    return new RichTextInput(fields, converted, collect: false);
  }

  /// <summary>
  /// The segments for one HTML string, still to be screened and
  /// canonicalized like any other input. An empty string is an empty text
  /// and needs no runtime.
  /// </summary>
  internal JsonArray Segments(string type, string field, string html)
  {
    if (html.Length == 0)
    {
      return [];
    }

    if (converted is not null && converted.TryGetValue(html, out var segments))
    {
      return segments;
    }

    if (found is not null)
    {
      if (seen!.Add(html))
      {
        found.Add(new RichTextHtml(type, field, html));
      }

      return [];
    }

    throw new InvalidDataException(
        $"collab: rich text field \"{type}.{field}\" holds HTML that was not converted to segments.");
  }
}
