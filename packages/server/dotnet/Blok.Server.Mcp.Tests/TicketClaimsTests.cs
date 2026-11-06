using System.Text;
using Blok.Server.Mcp.Live;
using Xunit;

namespace Blok.Server.Mcp.Tests;

public sealed class TicketClaimsTests
{
  private static string Segment(string text)
  {
    return Convert.ToBase64String(Encoding.UTF8.GetBytes(text)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
  }

  [Fact]
  public void DecodesThePayloadAsUtf8()
  {
    var ticket = $"{Segment("{\"alg\":\"HS256\"}")}.{Segment("{\"user\":\"agent:Jöhn:tix\",\"doc\":\"документ-😀\"}")}.sig";
    var claims = LiveOpener.ReadTicketClaims(ticket);

    Assert.NotNull(claims);
    Assert.Equal("agent:Jöhn:tix", (string?)claims["user"]);
    Assert.Equal("документ-😀", (string?)claims["doc"]);
  }

  [Theory]
  [InlineData("not-a-jwt")]
  [InlineData("a.%%%.c")]
  [InlineData("a.bm90IGpzb24.c")]
  public void ReadsNothingFromATicketItCannotDecode(string ticket)
  {
    Assert.Null(LiveOpener.ReadTicketClaims(ticket));
  }
}
