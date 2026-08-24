using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Tickets;
using Xunit;

namespace Blok.Server.Tests;

public sealed class TicketVerifierTests
{
  private const long FixedNowUnixSeconds = 1_700_000_000;
  private static readonly DateTimeOffset FixedNow =
      DateTimeOffset.FromUnixTimeSeconds(FixedNowUnixSeconds);

  [Fact]
  public void AcceptsTheFixedCompatibleTicket()
  {
    var fixture = LoadFixture();

    var accepted = TicketVerifier.TryVerify(
        fixture.Secret,
        fixture.Compatible,
        FixedNow,
        out var claims);

    Assert.True(accepted);
    Assert.Equal("u1", claims.User);
    Assert.Equal("doc-42", claims.Document);
    Assert.True(claims.Write);
    Assert.Equal(4_102_444_800, claims.Exp);
  }

  [Fact]
  public void RejectsTheFixedInvalidTickets()
  {
    var fixture = LoadFixture();

    foreach (var ticket in new[]
    {
      fixture.Malformed,
      fixture.Expired,
      fixture.Tampered,
      fixture.NoncanonicalHeaderTicket,
    })
    {
      Assert.False(TicketVerifier.TryVerify(fixture.Secret, ticket, FixedNow, out _));
    }
  }

  [Theory]
  [InlineData("")]
  [InlineData("abc")]
  [InlineData("abc.def")]
  [InlineData("abc.def.ghi.jkl")]
  [InlineData("..")]
  [InlineData(".payload.signature")]
  [InlineData("header..signature")]
  [InlineData("header.payload.")]
  public void RejectsTokensWithoutExactlyThreeNonemptySegments(string ticket)
  {
    var fixture = LoadFixture();

    Assert.False(TicketVerifier.TryVerify(fixture.Secret, ticket, FixedNow, out _));
  }

  [Fact]
  public void ExpiresAtTheNamedUnixSecond()
  {
    var fixture = LoadFixture();
    var atBoundary = SignPayload(
        fixture.Secret,
        $"{{\"user\":\"u1\",\"exp\":{FixedNowUnixSeconds}}}");
    var oneSecondLater = SignPayload(
        fixture.Secret,
        $"{{\"user\":\"u1\",\"exp\":{FixedNowUnixSeconds + 1}}}");

    Assert.False(TicketVerifier.TryVerify(fixture.Secret, atBoundary, FixedNow, out _));
    Assert.True(TicketVerifier.TryVerify(fixture.Secret, oneSecondLater, FixedNow, out _));
  }

  [Fact]
  public void RejectsAnEmptyOrWrongSecret()
  {
    var fixture = LoadFixture();

    Assert.False(TicketVerifier.TryVerify("", fixture.Compatible, FixedNow, out _));
    Assert.False(TicketVerifier.TryVerify(
        "a-different-secret-with-at-least-32-characters",
        fixture.Compatible,
        FixedNow,
        out _));
  }

  private static TicketFixture LoadFixture()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets.json");
    var fixture = JsonSerializer.Deserialize<TicketFixture>(File.ReadAllText(path));

    return Assert.IsType<TicketFixture>(fixture);
  }

  private static string SignPayload(string secret, string payload)
  {
    const string header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
    var signingInput = $"{Base64Url(header)}.{Base64Url(payload)}";
    var signature = HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(secret),
        Encoding.UTF8.GetBytes(signingInput));

    return $"{signingInput}.{Base64Url(signature)}";
  }

  private static string Base64Url(string value)
  {
    return Base64Url(Encoding.UTF8.GetBytes(value));
  }

  private static string Base64Url(byte[] value)
  {
    return Convert.ToBase64String(value)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
  }

  private sealed record TicketFixture(
      [property: JsonPropertyName("secret")] string Secret,
      [property: JsonPropertyName("compatible")] string Compatible,
      [property: JsonPropertyName("expired")] string Expired,
      [property: JsonPropertyName("malformed")] string Malformed,
      [property: JsonPropertyName("noncanonicalHeaderTicket")] string NoncanonicalHeaderTicket,
      [property: JsonPropertyName("tampered")] string Tampered);
}
