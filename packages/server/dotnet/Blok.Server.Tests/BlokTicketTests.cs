using System.Text.Json;
using System.Text.Json.Serialization;
using Blok.Server.Tickets;
using Xunit;

namespace Blok.Server.Tests;

public sealed class BlokTicketTests
{
  // Expected passes come from tickets.json only: gitleaks allows tokens there and nowhere else.
  private const long FixtureTtlSeconds = 4_102_444_800;
  private const long NowUnixSeconds = 1_800_000_000;

  [Fact]
  public void APassForANonAsciiUserIsReadBackByTheVerifier()
  {
    var fixture = LoadFixture();
    var clock = new FixedClock(DateTimeOffset.FromUnixTimeSeconds(NowUnixSeconds));

    var ticket = BlokTicket.Create(
        fixture.Secret,
        new BlokTicketClaims { User = "ü😀<", Doc = "doc-ü", Write = true, TtlSeconds = 60 },
        clock);

    Assert.True(TicketVerifier.TryVerify(fixture.Secret, ticket, clock.GetUtcNow(), out var claims));
    Assert.Equal("ü😀<", claims.User);
    Assert.Equal("doc-ü", claims.Document);
    Assert.True(claims.Write);
    Assert.Equal(NowUnixSeconds + 60, claims.Exp);
  }

  [Fact]
  public void MintsTheFixturePassesByteForByte()
  {
    var fixture = LoadFixture();
    var epoch = new FixedClock(DateTimeOffset.UnixEpoch);

    string Mint(string user, string doc, bool write) => BlokTicket.Create(
        fixture.Secret,
        new BlokTicketClaims { User = user, Doc = doc, Write = write, TtlSeconds = FixtureTtlSeconds },
        epoch);

    Assert.Equal(fixture.Compatible, Mint("u1", "doc-42", write: true));
    Assert.Equal(fixture.DocMismatch, Mint("u1", "other-doc", write: true));
    Assert.Equal(fixture.ReadOnly, Mint("u1", "doc-42", write: false));
    Assert.Equal(fixture.UserTwo, Mint("u2", "doc-42", write: true));
  }

  [Fact]
  public void ANullDocLeavesTheClaimOutAndDefaultsToAReadPass()
  {
    var fixture = LoadFixture();
    var clock = new FixedClock(DateTimeOffset.FromUnixTimeSeconds(NowUnixSeconds));

    var ticket = BlokTicket.Create(fixture.Secret, new BlokTicketClaims { User = "u1" }, clock);

    Assert.True(TicketVerifier.TryVerify(fixture.Secret, ticket, clock.GetUtcNow(), out var claims));
    Assert.Equal("", claims.Document);
    Assert.False(claims.Write);
    Assert.Equal(NowUnixSeconds + BlokTicket.DefaultTtlSeconds, claims.Exp);
  }

  // A lone surrogate would be written as U+FFFD: a valid pass for another id.
  // Built in code: [InlineData] stores strings as UTF-8 and loses the surrogate.
  [Theory]
  [InlineData(true)]
  [InlineData(false)]
  public void RejectsALoneSurrogateInTheUserOrTheDoc(bool inUser)
  {
    var fixture = LoadFixture();
    var lone = "a" + (char)0xD800;
    Assert.Equal(2, lone.Length);
    var claims = inUser
        ? new BlokTicketClaims { User = lone, Doc = "doc-42" }
        : new BlokTicketClaims { User = "u1", Doc = lone };

    Assert.Throws<ArgumentException>(() => BlokTicket.Create(fixture.Secret, claims));
  }

  [Fact]
  public void RejectsASecretShorterThanTheServerFloor()
  {
    var claims = new BlokTicketClaims { User = "u1" };

    Assert.Throws<ArgumentException>(() => BlokTicket.Create(new string('s', 31), claims));
    Assert.NotEmpty(BlokTicket.Create(new string('s', BlokTicket.MinimumSecretLength), claims));
  }

#nullable disable
  [Fact]
  public void RejectsNullClaimsOrANullUser()
  {
    var fixture = LoadFixture();

    Assert.Throws<ArgumentNullException>(() => BlokTicket.Create(fixture.Secret, null));
    Assert.Throws<ArgumentNullException>(() => BlokTicket.Create(
        fixture.Secret,
        new BlokTicketClaims { User = null }));
  }
#nullable restore

  [Fact]
  public void RejectsATtlThatIsNotPositive()
  {
    var fixture = LoadFixture();

    Assert.Throws<ArgumentOutOfRangeException>(() => BlokTicket.Create(
        fixture.Secret,
        new BlokTicketClaims { User = "u1", TtlSeconds = 0 }));
  }

  [Fact]
  public void RejectsATtlThatOverflowsExp()
  {
    var fixture = LoadFixture();
    var clock = new FixedClock(DateTimeOffset.FromUnixTimeSeconds(NowUnixSeconds));

    Assert.Throws<OverflowException>(() => BlokTicket.Create(
        fixture.Secret,
        new BlokTicketClaims { User = "u1", TtlSeconds = long.MaxValue },
        clock));
  }

  [Fact]
  public void APassVerifiesUntilTheSecondBeforeExp()
  {
    var fixture = LoadFixture();
    var mintedAt = DateTimeOffset.FromUnixTimeSeconds(NowUnixSeconds);
    var ticket = BlokTicket.Create(
        fixture.Secret,
        new BlokTicketClaims { User = "u1", Doc = "doc-42" },
        new FixedClock(mintedAt));
    var exp = mintedAt.AddSeconds(BlokTicket.DefaultTtlSeconds);

    Assert.True(TicketVerifier.TryVerify(fixture.Secret, ticket, exp.AddSeconds(-1), out _));
    Assert.False(TicketVerifier.TryVerify(fixture.Secret, ticket, exp, out _));
  }

  private static TicketFixture LoadFixture()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "tickets.json");
    var fixture = JsonSerializer.Deserialize<TicketFixture>(File.ReadAllText(path));

    return Assert.IsType<TicketFixture>(fixture);
  }

  private sealed class FixedClock(DateTimeOffset now) : TimeProvider
  {
    public override DateTimeOffset GetUtcNow() => now;
  }

  private sealed record TicketFixture(
      [property: JsonPropertyName("secret")] string Secret,
      [property: JsonPropertyName("compatible")] string Compatible,
      [property: JsonPropertyName("docMismatch")] string DocMismatch,
      [property: JsonPropertyName("readOnly")] string ReadOnly,
      [property: JsonPropertyName("userTwo")] string UserTwo);
}
