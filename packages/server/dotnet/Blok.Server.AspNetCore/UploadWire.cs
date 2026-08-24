using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using HeaderUtilities = Microsoft.Net.Http.Headers.HeaderUtilities;
using MediaTypeHeaderValue = Microsoft.Net.Http.Headers.MediaTypeHeaderValue;

namespace Blok.Server.AspNetCore;

internal static class UploadWire
{
  private const int MaximumFileNameBytes = 255;
  private const int MaximumMediaTypeLength = 255;

  internal static string SanitizeFileName(string fileName)
  {
    var separator = fileName.LastIndexOfAny(['/', '\\']);

    if (separator >= 0)
    {
      fileName = fileName[(separator + 1)..];
    }

    return fileName is "." or ".." ||
        Encoding.UTF8.GetByteCount(fileName) > MaximumFileNameBytes
      ? ""
      : fileName;
  }

  internal static string SanitizeMediaType(string? mediaType)
  {
    var candidate = mediaType?.Trim() ?? "";

    return candidate.Length is > 0 and <= MaximumMediaTypeLength &&
        MediaTypeHeaderValue.TryParse(candidate, out var parsed) &&
        !HasConflictingParameters(parsed)
      ? candidate
      : "";
  }

  internal static bool HasConflictingParameters(
      MediaTypeHeaderValue mediaType)
  {
    var values = new Dictionary<string, string>(
        StringComparer.OrdinalIgnoreCase);

    foreach (var parameter in mediaType.Parameters)
    {
      var name = parameter.Name.Value ?? "";
      var value = UnquoteMediaParameter(parameter.Value);

      if (values.TryGetValue(name, out var existing) &&
          existing != value)
      {
        return true;
      }

      values[name] = value;
    }

    return false;
  }

  internal static Task WriteResponseAsync(
      HttpContext context,
      string url,
      string fileName,
      long size,
      string mimeType)
  {
    var response = new UploadResponse(
        url,
        fileName == "" ? null : fileName,
        size == 0 ? null : size,
        mimeType == "" ? null : mimeType);
    context.Response.ContentType = "application/json";

    return context.Response.WriteAsync(
        JsonSerializer.Serialize(response) + "\n",
        context.RequestAborted);
  }

  private static string UnquoteMediaParameter(StringSegment value)
  {
    var raw = value.Value ?? "";
    var quoted = raw.Length >= 2 && raw[0] == '"' && raw[^1] == '"';
    var unquoted = HeaderUtilities.RemoveQuotes(value).Value ?? "";

    if (!quoted || unquoted.IndexOf('\\') < 0)
    {
      return unquoted;
    }

    var result = new StringBuilder(unquoted.Length);

    for (var index = 0; index < unquoted.Length; index++)
    {
      if (unquoted[index] == '\\' &&
          index + 1 < unquoted.Length &&
          IsMimeSpecial(unquoted[index + 1]))
      {
        index++;
      }

      result.Append(unquoted[index]);
    }

    return result.ToString();
  }

  private static bool IsMimeSpecial(char value)
  {
    return value is '(' or ')' or '<' or '>' or '@' or ',' or ';' or ':' or
        '\\' or '"' or '/' or '[' or ']' or '?' or '=';
  }

  private sealed record UploadResponse(
      [property: JsonPropertyName("url")] string Url,
      [property: JsonPropertyName("fileName")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? FileName,
      [property: JsonPropertyName("size")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      long? Size,
      [property: JsonPropertyName("mimeType")]
      [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
      string? MimeType);
}
