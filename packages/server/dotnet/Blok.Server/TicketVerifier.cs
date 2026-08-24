using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Blok.Server.Tickets;

internal readonly record struct TicketClaims(
    string User,
    string Document,
    bool Write,
    long Exp);

internal static class TicketVerifier
{
  private const string HeaderSegment = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

  private static readonly JsonSerializerOptions JsonOptions = new()
  {
    PropertyNameCaseInsensitive = true,
  };

  internal static bool TryVerify(
      string secret,
      string ticket,
      DateTimeOffset now,
      out TicketClaims claims)
  {
    claims = default;

    if (string.IsNullOrEmpty(secret))
    {
      return false;
    }

    var segments = ticket.Split('.');

    if (segments.Length != 3 ||
        segments[0].Length == 0 ||
        segments[1].Length == 0 ||
        segments[2].Length == 0)
    {
      return false;
    }

    if (!string.Equals(segments[0], HeaderSegment, StringComparison.Ordinal) ||
        !TryDecodeBase64Url(segments[2], out var signature))
    {
      return false;
    }

    var signingInput = $"{segments[0]}.{segments[1]}";
    var expectedSignature = HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(secret),
        Encoding.UTF8.GetBytes(signingInput));

    if (!SignatureMatches(signature, expectedSignature) ||
        !TryDecodeBase64Url(segments[1], out var payload))
    {
      return false;
    }

    TicketPayload? parsed;

    try
    {
      parsed = JsonSerializer.Deserialize<TicketPayload>(payload, JsonOptions);
    }
    catch (JsonException)
    {
      return false;
    }

    if (parsed is null || parsed.Exp <= now.ToUnixTimeSeconds())
    {
      return false;
    }

    claims = new TicketClaims(
        parsed.User ?? "",
        parsed.Document ?? "",
        parsed.Write,
        parsed.Exp);

    return true;
  }

  private static bool TryDecodeBase64Url(string value, out byte[] decoded)
  {
    decoded = [];

    if (value.Length % 4 == 1 ||
        value.Any(character =>
            !char.IsAsciiLetterOrDigit(character) &&
            character is not ('-' or '_')))
    {
      return false;
    }

    var base64 = value
        .Replace('-', '+')
        .Replace('_', '/')
        .PadRight(value.Length + ((4 - (value.Length % 4)) % 4), '=');

    try
    {
      decoded = Convert.FromBase64String(base64);

      return true;
    }
    catch (FormatException)
    {
      return false;
    }
  }

  private static bool SignatureMatches(
      ReadOnlySpan<byte> supplied,
      ReadOnlySpan<byte> expected)
  {
    Span<byte> normalized = stackalloc byte[32];
    supplied[..Math.Min(supplied.Length, normalized.Length)].CopyTo(normalized);

    var sameLength = supplied.Length == expected.Length;
    var equal = CryptographicOperations.FixedTimeEquals(normalized, expected);

    return sameLength & equal;
  }

  private sealed class TicketPayload
  {
    [JsonPropertyName("user")]
    public string? User { get; init; }

    [JsonPropertyName("doc")]
    public string? Document { get; init; }

    [JsonPropertyName("write")]
    public bool Write { get; init; }

    [JsonPropertyName("exp")]
    public long Exp { get; init; }
  }
}
