using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Blok.Server.Outbound;

namespace Blok.Server.FrameCheck;

/// <summary>
/// The few oEmbed fields Blok passes on: plain text, an https thumbnail and
/// capped sizes. The html field never leaves the server (oEmbed §3 calls it
/// an XSS vector). Go's framecheck.ParseOEmbed is the twin;
/// frame-check-oembed.json pins both.
/// </summary>
internal sealed partial record OEmbedAnswer(
    [property: JsonPropertyName("title")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Title,
    [property: JsonPropertyName("provider_name")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ProviderName,
    [property: JsonPropertyName("thumbnail_url")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ThumbnailUrl,
    [property: JsonPropertyName("width")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? Width,
    [property: JsonPropertyName("height")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? Height)
{
  // In UTF-16 units, like every other cap in the server.
  private const int MaximumTextLength = 256;
  private const int MaximumSize = 4096;

  [JsonIgnore]
  internal bool IsEmpty =>
      Title is null && ProviderName is null && ThumbnailUrl is null &&
      Width is null && Height is null;

  [GeneratedRegex(@"^[1-9][0-9]{0,8}\z", RegexOptions.CultureInvariant)]
  private static partial Regex WholeSize();

  internal static OEmbedAnswer Parse(ReadOnlySpan<byte> body)
  {
    var empty = new OEmbedAnswer(null, null, null, null, null);
    JsonDocument document;

    try
    {
      document = JsonDocument.Parse(body.ToArray());
    }
    catch (JsonException)
    {
      return empty;
    }

    using (document)
    {
      if (document.RootElement.ValueKind != JsonValueKind.Object)
      {
        return empty;
      }

      string? title = null;
      string? providerName = null;
      string? thumbnailUrl = null;
      int? width = null;
      int? height = null;

      // A repeated name: the last one wins, even when it is not usable.
      foreach (var property in document.RootElement.EnumerateObject())
      {
        string name;
        try
        {
          name = property.Name;
        }
        catch (InvalidOperationException)
        {
          continue;
        }

        switch (name)
        {
          case "title":
            title = Text(property.Value);
            break;
          case "provider_name":
            providerName = Text(property.Value);
            break;
          case "thumbnail_url":
            thumbnailUrl = SecureUrl(property.Value);
            break;
          case "width":
            width = Size(property.Value);
            break;
          case "height":
            height = Size(property.Value);
            break;
        }
      }

      return new OEmbedAnswer(title, providerName, thumbnailUrl, width, height);
    }
  }

  private static string? String(JsonElement value)
  {
    if (value.ValueKind != JsonValueKind.String)
    {
      return null;
    }

    try
    {
      return value.GetString();
    }
    catch (InvalidOperationException)
    {
      return null;
    }
  }

  private static string? Text(JsonElement value)
  {
    var text = String(value);
    if (string.IsNullOrEmpty(text))
    {
      return null;
    }

    if (text.Length <= MaximumTextLength)
    {
      return text;
    }

    var end = char.IsHighSurrogate(text[MaximumTextLength - 1])
      ? MaximumTextLength - 1
      : MaximumTextLength;
    return text[..end];
  }

  private static string? SecureUrl(JsonElement value)
  {
    var text = String(value);
    return text is null ? null : BrowserUrl.Secure(null, text);
  }

  private static int? Size(JsonElement value)
  {
    if (value.ValueKind != JsonValueKind.Number)
    {
      return null;
    }

    var raw = value.GetRawText();
    return WholeSize().IsMatch(raw)
      ? Math.Min(int.Parse(raw, System.Globalization.CultureInfo.InvariantCulture), MaximumSize)
      : null;
  }
}
